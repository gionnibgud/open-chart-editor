import test from 'node:test';import assert from 'node:assert/strict';import {History} from '../src/history.js';
const fixture=()=>({vocals:[{id:'a',time:0,length:.3,text:'Own',opaque:{unchanged:[1,2]}},{id:'b',time:1,length:.4,text:'words'}],arrangements:[{notes:[{id:'hidden',time:2,fret:3}]}],_pack:{original:'immutable'}});
test('scoped staged edits compose with full-project reorders and normal Undo/Redo',()=>{
 const h=new History(fixture()),original=structuredClone(h.project),opaque=h.project.vocals[0].opaque,pack=h.project._pack;h.commitAt('Own word',['vocals',0],row=>{row.text='Changed';row.pitch=0;});assert.equal(h.project.vocals[0].opaque,opaque);h.commit('Reorder',p=>p.vocals.reverse());h.undo();h.undo();assert.deepEqual(h.project,original);assert.equal(h.project._pack,pack);h.redo();h.redo();assert.equal(h.project.vocals[1].text,'Changed');assert.equal(h.project.vocals[1].pitch,0);
});
test('a failed staged edit never touches source, hidden content or retained history',()=>{
 const h=new History(fixture()),before=structuredClone(h.project),row=h.project.vocals[0];assert.throws(()=>h.commitAt('Reject',['vocals',0],draft=>{draft.text='Bad';draft.opaque.unchanged.push(3);throw Error('Own rejected edit');}),/rejected/);assert.deepEqual(h.project,before);assert.equal(h.project.vocals[0],row);assert.equal(h.stateId,0);assert.equal(h.undoStack.length,0);
});
test('staging objects retained by the caller cannot mutate the committed source later',()=>{
 const h=new History(fixture());let draft;h.commitAt('Own',['vocals',0],value=>{draft=value;value.text='Committed';value.opaque.unchanged.push(3);});draft.text='Late';draft.opaque.unchanged.push(4);assert.equal(h.project.vocals[0].text,'Committed');assert.deepEqual(h.project.vocals[0].opaque.unchanged,[1,2,3]);h.undo();assert.deepEqual(h.project,fixture());
});
test('asynchronous edits are rejected and later staged work remains isolated',async()=>{
 const h=new History(fixture()),before=structuredClone(h.project);assert.throws(()=>h.commitAt('Async',['vocals',0],async draft=>{draft.text='Pending';await Promise.resolve();draft.text='Later';}),/synchronous/);await Promise.resolve();assert.deepEqual(h.project,before);assert.equal(h.undoStack.length,0);
});
test('a nested legitimate history edit invalidates staging without undoing that independent edit',()=>{
 const h=new History(fixture());assert.throws(()=>h.commitAt('Stale',['vocals',0],draft=>{draft.text='Uncommitted';h.commit('Other edit',p=>p.vocals[1].text='Other');}),/changed/);assert.equal(h.project.vocals[0].text,'Own');assert.equal(h.project.vocals[1].text,'Other');assert.equal(h.undoStack.length,1);h.undo();assert.deepEqual(h.project,fixture());
});
test('scoped capture does not traverse unrelated project branches or immutable source blobs',()=>{
 const p=fixture();let reads=0;Object.defineProperty(p,'unrelatedBranch',{enumerable:true,get(){reads++;throw Error('Unrelated branch traversed');}});const h=new History(p);h.commitAt('Own',['vocals',0],row=>row.text='Changed');h.undo();h.redo();assert.equal(reads,0);assert.equal(h.project.vocals[0].text,'Changed');
});
test('explicit paths reject missing, primitive, opaque and prototype locations',()=>{
 const h=new History(fixture()),before=structuredClone(h.project);for(const path of [[],['missing'],['_pack'],['__proto__'],['constructor'],['vocals',-1],['vocals','0'],['vocals',0,'text']])assert.throws(()=>h.commitAt('Invalid',path,()=>{}));assert.deepEqual(h.project,before);assert.equal(h.undoStack.length,0);
});
test('literal own JSON names remain editable without traversing or changing prototypes',()=>{
 const p=fixture();p.named=JSON.parse('{"__proto__":{"text":"Own"},"constructor":{"text":"Other"}}');const h=new History(p),path=['named','__proto__'];h.commitAt('Own literal',path,row=>{path[1]='constructor';row.text='Changed';row.polluted='Own field';});assert.equal(h.project.named.__proto__.text,'Changed');assert.equal(h.project.named.constructor.text,'Other');assert.equal({}.polluted,undefined);h.undo();assert.equal(h.project.named.__proto__.text,'Own');assert.equal({}.polluted,undefined);
});
test('scoped edits use normal no-op notifications, retention caps and checkpoint/branch identities',()=>{
 const h=new History(fixture(),{maxEntries:2,maxBytes:100000});let calls=0;h.listeners.add(()=>calls++);h.commitAt('Noop',['vocals',0],()=>{});assert.equal(calls,1);assert.equal(h.stateId,0);h.setCheckpoint();for(let i=0;i<3;i++)h.commitAt('Word '+i,['vocals',0],row=>row.text='Own '+i);assert.equal(h.undoStack.length,2);assert.equal(h.checkpointAvailable,false);h.undo();h.commitAt('Branch',['vocals',0],row=>row.length=.2);assert.equal(h.redoStack.length,0);assert.equal(h.steps().at(-1).id,h.stateId);const noRetention=new History(fixture(),{maxBytes:0});noRetention.commitAt('Own',['vocals',0],row=>row.text='Saved edit');assert.equal(noRetention.project.vocals[0].text,'Saved edit');assert.equal(noRetention.undoStack.length,0);
});
