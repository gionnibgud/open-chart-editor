import {test} from 'node:test';import assert from 'node:assert/strict';
import {makeArrangement,makeNote} from '../src/model.js';
import {adjustBendAtCursor} from '../src/bend-tools.js';
function fixture(){const a=makeArrangement();a.notes=[makeNote(a,2,0,5,2)];return a;}
test('B/V create/update a relative cursor point and keep scalar bend equal to curve peak',()=>{
 const a=fixture(),n=a.notes[0];adjustBendAtCursor(a,[n.id],3,.5);
 assert.deepEqual(n.techniques.bend_values,[{t:0,v:0},{t:1,v:.5}]);assert.equal(n.techniques.bend,.5);
 adjustBendAtCursor(a,[n.id],3,.5);assert.equal(n.techniques.bend_values[1].v,1);assert.equal(n.techniques.bend_values.length,2);
 adjustBendAtCursor(a,[n.id],3,-.5);assert.equal(n.techniques.bend,.5);
 adjustBendAtCursor(a,[n.id],3,-1);assert.equal(n.techniques.bend,0);
});
test('curve interpolation, held tails and insertion preserve existing curve points and unknown metadata',()=>{
 const a=fixture(),n=a.notes[0];n.techniques={palm_mute:true,bend:2,bend_values:[{t:0,v:0,own:'attack'},{t:1,v:2,own:'peak'}]};
 adjustBendAtCursor(a,[n.id],2.5,-.5);assert.deepEqual(n.techniques.bend_values,[{t:0,v:0,own:'attack'},{t:.5,v:.5},{t:1,v:2,own:'peak'}]);assert.equal(n.techniques.bend,2);
 adjustBendAtCursor(a,[n.id],4,-.5);assert.equal(n.techniques.bend_values.at(-1).v,1.5);assert.equal(n.techniques.palm_mute,true);
});
test('chord children are edited relative to their own time; notes outside cursor sustain stay unchanged',()=>{
 const a=fixture(),n=a.notes[0],child=makeNote(a,2.5,1,7,1);a.chords=[{time:2.5,chord_id:0,notes:[child]}];const outside=makeNote(a,7,2,9,1);a.notes.push(outside);const before=structuredClone(outside);
 const result=adjustBendAtCursor(a,[n.id,child.id,outside.id],3,.5);assert.equal(result.length,2);assert.equal(child.techniques.bend_values[1].t,.5);assert.deepEqual(outside,before);
});
test('scalar-only first edit, zero-duration attack and maximum bounds are explicit',()=>{
 const a=fixture(),n=a.notes[0];n.techniques.bend=1;adjustBendAtCursor(a,[n.id],3,-.5);assert.equal(n.techniques.bend,.5);
 n.sustain=0;n.techniques={bend:12};adjustBendAtCursor(a,[n.id],2,.5);assert.deepEqual(n.techniques.bend_values,[{t:0,v:12}]);
});
test('bad curves reject all changes atomically; absent selection/outside cursor and keys are rejected',()=>{
 const a=fixture(),n=a.notes[0],bad=makeNote(a,2,1,8,2);bad.techniques.bend_values=[{t:1,v:1},{t:.5,v:1}];a.notes.push(bad);const before=structuredClone(a);
 assert.throws(()=>adjustBendAtCursor(a,[n.id,bad.id],3,.5),/invalid times/);assert.deepEqual(a,before);
 assert.throws(()=>adjustBendAtCursor(a,[n.id],5,.5),/within a selected/);assert.throws(()=>adjustBendAtCursor(a,[],2,.5),/within a selected/);
 assert.throws(()=>adjustBendAtCursor(makeArrangement('keys'),[],0,.5),/guitar or bass/);
});
