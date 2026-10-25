import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {History,snapshotProject} from '../src/history.js';
function fixture(count=8){return {title:'Original history study',unknown:{nested:['untouched',{fraction:1/3}]},arrangements:[{id:'lead',notes:Array.from({length:count},(_,i)=>({id:`n${i}`,time:i/7+.000000123,fret:i%20,sustain:.125000003,techniques:{bend_values:[{t:.0000002,v:.5}]},opaqueNote:{retain:true}}))}]};}
test('sparse note edits preserve exact timing, techniques and unknown fields through undo/redo',()=>{
 const project=fixture(),original=structuredClone(project),history=new History(project);
 history.commit('Detailed note edit',p=>{p.arrangements[0].notes[3].time=1.123456789;p.arrangements[0].notes[3].techniques.bend_values[0].v=1.75;p.arrangements[0].notes[3].opaqueNote.extra={keep:7};});
 const edited=structuredClone(project);assert.equal(history.undoStack[0].patches.length,3);history.undo();assert.deepEqual(history.project,original);history.redo();assert.deepEqual(history.project,edited);
});
test('insert/delete/reorder arrays undo with object identities correctly matched',()=>{
 const project=fixture(),original=structuredClone(project),history=new History(project);
 history.commit('Insert note',p=>p.arrangements[0].notes.splice(2,0,{id:'new',time:.25,techniques:{tap:true}}));
 history.commit('Delete note',p=>p.arrangements[0].notes.splice(5,1));
 const beforeReverse=structuredClone(project);history.commit('Reverse and edit',p=>{p.arrangements[0].notes.reverse();p.arrangements[0].notes[0].fret=24;});
 assert.equal(history.undoStack.at(-1).patches[0].op,'order');const final=structuredClone(project);
 history.undo();assert.deepEqual(project,beforeReverse);history.undo();history.undo();assert.deepEqual(project,original);history.redo();history.redo();history.redo();assert.deepEqual(project,final);
});
test('failed compound edits roll back deletion and insertion without adding history',()=>{
 const project=fixture(),original=structuredClone(project),history=new History(project);
 assert.throws(()=>history.commit('Broken edit',p=>{delete p.unknown;p.arrangements[0].notes.splice(1,3);p.arrangements[0].notes[0].techniques={slap:true};throw Error('Abort authoring');}),/Abort authoring/);
 assert.deepEqual(history.project,original);assert.deepEqual(project,original);assert.equal(history.undoStack.length,0);
});
test('new edit discards redo branch and bounded history retains latest actions',()=>{
 const history=new History(fixture(),{maxEntries:3,maxBytes:4096});let notifications=0;history.listeners.add(()=>notifications++);
 for(let i=0;i<5;i++)history.commit(`Title ${i}`,p=>p.title=`Title ${i}`);
 assert.equal(history.undoStack.length,3);history.undo();history.commit('Different branch',p=>p.unknown.branch=true);assert.equal(history.redoStack.length,0);assert.equal(notifications,7);assert.ok(history.retainedBytes<=4096);
 const disabled=new History(fixture(),{maxEntries:0});disabled.commit('No retained undo',p=>p.title='Changed');assert.equal(disabled.undoStack.length,0);assert.equal(disabled.project.title,'Changed');
});
test('5000-note chart and 20MB source payload retain only sparse per-edit history',t=>{
 const project=fixture(5000);project._pack={entries:{'audio/original.wav':'A'.repeat(20*1024*1024)}};project._import={xml:'Original immutable source'};
 const snapshot=snapshotProject(project);assert.equal(snapshot._pack,project._pack);assert.equal(snapshot._import,project._import);assert.notEqual(snapshot.arrangements,project.arrangements);
 const history=new History(project),started=performance.now();
 for(let i=0;i<20;i++)history.commit(`Fret ${i}`,p=>{p.arrangements[0].notes[2345].fret=i;});
 const commitMs=performance.now()-started,undoStarted=performance.now();for(let i=0;i<20;i++)history.undo();const undoMs=performance.now()-undoStarted;
 assert.ok(history.retainedBytes<16000,`Retained ${history.retainedBytes} bytes for 20 tiny edits`);assert.equal(project._pack,snapshot._pack);assert.equal(project.arrangements[0].notes[2345].fret,5);
 t.diagnostic(JSON.stringify({notes:5000,opaqueSourceBytes:20*1024*1024,edits:20,retainedPatchBytes:history.retainedBytes,commitMs,undoMs}));
});
