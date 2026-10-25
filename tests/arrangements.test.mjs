import {test} from 'node:test';import assert from 'node:assert/strict';import {makeProject,makeArrangement,makeNote,clone,History} from '../src/model.js';import {manageArrangement} from '../src/arrangements.js';
test('duplicate preserves authored DD content but owns new identities and independent manifest pointers',()=>{
 const p=makeProject(),a=p.arrangements[0];a.notes=[makeNote(a,1,0,3,1)];a.notes[0].future={own:true};a.difficulties=[{difficulty:0,notes:clone(a.notes),chords:[]}];a.phrases=[{id:'phrase-own',time:0,name:'A'}];a.phraseIterations=[{phraseId:'phrase-own',time:0}];a._entry={id:a.id,file:'arrangements/original.json',notation:'score/original.json',_songLevel:true,future:'retain'};const original=clone(a);
 const id=manageArrangement(p,a.id,'duplicate',{newName:'Alternative'}),b=p.arrangements[1];assert.equal(b.id,id);assert.deepEqual(p.arrangements[0],original);assert.notEqual(b.notes[0].id,a.notes[0].id);assert.equal(b.difficulties[0].notes[0].id,b.notes[0].id);assert.equal(b.phraseIterations[0].phraseId,b.phrases[0].id);assert.deepEqual(b._entry,{future:'retain'});assert.equal(b.priority,'alternative');b.notes[0].future.own=false;assert.equal(a.notes[0].future.own,true);
});
test('removing a main part removes only its linked scratch and sparse undo restores exact state',()=>{
 const p=makeProject(),main=p.arrangements[0],bass=makeArrangement('bass',5),scratch={...makeArrangement(),editorOnly:true,scratchFor:main.id};p.arrangements.push(bass,scratch);const before=clone(p),h=new History(p);let selected;
 h.commit('Remove main',project=>selected=manageArrangement(project,main.id,'remove'));assert.equal(selected,bass.id);assert.deepEqual(h.project.arrangements.map(a=>a.id),[bass.id]);h.undo();assert.deepEqual(h.project,before);
});
test('last main, invalid rename and outer-list moves fail without data loss',()=>{
 const p=makeProject(),a=p.arrangements[0],before=clone(p);for(const [operation,options]of [['remove',{}],['up',{}],['rename',{newName:'   '}]]){assert.throws(()=>manageArrangement(p,a.id,operation,options));assert.deepEqual(p,before)}
 const second=makeArrangement('keys');p.arrangements.push(second);manageArrangement(p,second.id,'up');assert.equal(p.arrangements[0].id,second.id);manageArrangement(p,second.id,'rename',{newName:'  Own piano  '});assert.equal(second.name,'Own piano');
});
test('lock and hide flags: clones start unlocked and visible, locked parts are not deleted, one part stays visible',()=>{
 const p=makeProject(),a=p.arrangements[0],b=makeArrangement('guitar');p.arrangements.push(b);
 manageArrangement(p,a.id,'lock');manageArrangement(p,a.id,'hide');assert.equal(a.locked,true);assert.equal(a.hidden,true);
 assert.throws(()=>manageArrangement(p,b.id,'hide'),/at least one visible/);
 assert.throws(()=>manageArrangement(p,a.id,'remove'),/locked/);
 const copyId=manageArrangement(p,a.id,'duplicate'),copy=p.arrangements.find(x=>x.id===copyId);assert.equal(copy.locked,undefined);assert.equal(copy.hidden,undefined);
 manageArrangement(p,a.id,'unlock');manageArrangement(p,a.id,'unhide');assert.equal('locked' in a||'hidden' in a,false);
 const scratch={...makeArrangement(),editorOnly:true};p.arrangements.push(scratch);assert.throws(()=>manageArrangement(p,scratch.id,'lock'),/Scratch/);
});
