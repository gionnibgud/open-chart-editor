import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applySustainEdit,applySustainEdits,planSustainEdits,steppedSustain} from '../src/sustain-policy.js';

const beats=[{time:0},{time:.5},{time:1},{time:2},{time:3},{time:4}];
const note=(string,time,sustain=0,techniques={})=>({string,time,sustain,fret:3,techniques,opaque:{future:true}});
const arrangement=()=>({type:'guitar',stringCount:8,notes:[],chords:[],chord_templates:[{name:'Original'}],handshapes:[],difficulties:[{difficulty:9,notes:[note(0,.1)]}]});
const policy={enabled:true,clampNext:true};

test('default policy preserves explicit durations including existing overlaps',()=>{
 const a=arrangement(),n=note(0,0);a.notes=[n,note(0,1)];
 assert.equal(applySustainEdit(a,n,3).value,3);
 const before=structuredClone(a);assert.deepEqual(planSustainEdits(a,[],policy),[]);assert.deepEqual(a,before);
});
test('next attack clamps each selected voice independently, including selected colliders and chord members',()=>{
 const a=arrangement(),n=note(0,0),m=note(1,0),later=note(0,1),child=note(1,2);delete child.time;
 a.notes=[n,m,later];a.chords=[{time:2,notes:[child]}];
 const result=applySustainEdits(a,[{note:n,requested:5},{note:m,requested:5},{note:later,requested:5}],policy);
 assert.deepEqual(result.map(p=>p.value),[1,2,5]);assert.equal(child.time,undefined);assert.equal(later.sustain,5);
});
test('same-time voices and attacks on other strings do not limit a tail; visible DD only',()=>{
 const a=arrangement(),n=note(7,0);a.notes=[n,note(7,0),note(6,.1)];
 assert.equal(applySustainEdit(a,n,3,policy).value,3);
});
test('beat gutter follows requested tail across a tempo change; exact numeric edits omit gutter',()=>{
 const a=arrangement(),n=note(0,.5);a.notes=[n];
 assert.equal(applySustainEdit(a,n,1.5,{...policy,beats,gutterBeats:.25,snapped:true}).value,1.25);
 assert.equal(applySustainEdit(a,n,1.5,{...policy,beats,gutterBeats:.25}).value,1.5);
});
test('gutter applies before next attack using its local beat interval, with zero-duration floor',()=>{
 const a=arrangement(),n=note(0,.5);a.notes=[n,note(0,2)];
 assert.equal(applySustainEdit(a,n,4,{...policy,beats,gutterBeats:.25,snapped:true}).value,1.25);
 assert.equal(applySustainEdit(a,n,.01,{...policy,beats,gutterBeats:1,snapped:true}).value,0);
});
test('existing overlap is retained on extension, while explicit shortening remains possible',()=>{
 const a=arrangement(),n=note(0,0,3);a.notes=[n,note(0,1)];
 const result=applySustainEdit(a,n,4,policy);assert.equal(result.value,3);assert.equal(result.retainedOverlap,true);
 assert.equal(applySustainEdit(a,n,.5,policy).value,.5);
});
test('unchanged endpoint never reapplies gutter or normalizes an imported overlap',()=>{
 const a=arrangement(),n=note(0,0,3);a.notes=[n,note(0,1)];
 assert.equal(applySustainEdit(a,n,3,{...policy,beats,gutterBeats:.25,snapped:true}).value,3);
});
test('outgoing linked child and inherited chord flags exempt automatic gutter and clamp',()=>{
 for(const key of ['link_next','linkNext','ln']){
  const a=arrangement(),n=note(0,0,0,{[key]:true}),child=note(1,0);a.notes=[n,note(0,1),note(1,1)];a.chords=[{time:0,techniques:{[key]:true},notes:[child]}];
  const results=applySustainEdits(a,[{note:n,requested:3},{note:child,requested:3}],{...policy,beats,gutterBeats:.25,snapped:true,endTime:2});
  assert.deepEqual(results.map(p=>p.value),[3,3]);assert.ok(results.every(p=>p.linked));
 }
});
test('explicit child false overrides matching inherited link default',()=>{
 const a=arrangement(),n=note(0,0,0,{link_next:false});a.chords=[{time:0,techniques:{link_next:true},notes:[n]}];a.notes=[note(0,1)];
 assert.equal(applySustainEdit(a,n,3,policy).value,1);
});
test('bend loss refuses an entire selection before any mutation, even when the failing member is last',()=>{
 const a=arrangement(),n=note(0,0),bent=note(1,0,2,{bend:1,bend_values:[{t:0,v:0},{t:2,v:1}]});a.notes=[n,bent,note(1,1)];const before=structuredClone(a);
 assert.throws(()=>applySustainEdits(a,[{note:n,requested:2},{note:bent,requested:.5}],policy),/bend curve/);assert.deepEqual(a,before);
 assert.throws(()=>applySustainEdit(a,bent,0),/bend curve/);assert.deepEqual(a,before);
});
test('initial-strum rule is validated across a batch before mutating ordinary notes',()=>{
 const a=arrangement(),initial=note(0,0),repeat=note(0,1),single=note(2,0);a.notes=[single];a.chords=[{chord_id:0,time:0,notes:[initial]},{chord_id:0,time:1,notes:[repeat]}];a.handshapes=[{chord_id:0,start_time:0,end_time:3}];const before=structuredClone(a);
 assert.throws(()=>applySustainEdits(a,[{note:single,requested:1},{note:repeat,requested:1}],policy),/initial strum/);assert.deepEqual(a,before);
 repeat.sustain=.25;assert.equal(applySustainEdit(a,repeat,.5,policy).value,.5);
});
test('unknown metadata, curves, hidden DD, chord templates and inherited attack remain exact',()=>{
 const a=arrangement(),n=note(0,0,1,{bend_values:[{t:.5,v:1}],future:{own:2}});delete n.time;a.chords=[{time:.5,notes:[n],future:7}];const before=structuredClone(a);
 const plans=planSustainEdits(a,[{note:n,requested:2}],policy);assert.deepEqual(a,before);assert.equal(plans[0].value,2);
 applySustainEdits(a,[{note:n,requested:2}],policy);before.chords[0].notes[0].sustain=2;assert.deepEqual(a,before);
});
test('invalid settings, foreign notes, duplicate edits, malformed timing and non-fretted policy refuse atomically',()=>{
 const a=arrangement(),n=note(0,0);a.notes=[n];const before=structuredClone(a);
 for(const options of [{enabled:'yes'},{enabled:true,gutterBeats:-1},{enabled:true,snapped:true,gutterBeats:.25},{enabled:true,endTime:NaN}])assert.throws(()=>applySustainEdit(a,n,2,options));
 assert.throws(()=>applySustainEdit(a,note(0,0),2,policy),/existing/);
 assert.throws(()=>applySustainEdits(a,[{note:n,requested:1},{note:n,requested:2}],policy),/once/);
 assert.throws(()=>applySustainEdit(a,n,NaN,policy));assert.deepEqual(a,before);
 a.type='keys';assert.throws(()=>applySustainEdit(a,n,1,policy),/guitar or bass/);assert.equal(applySustainEdit(a,n,1).value,1);
});
test('optional song boundary clamps new extensions but preserves existing tails beyond it',()=>{
 const a=arrangement(),n=note(0,0);a.notes=[n];assert.equal(applySustainEdit(a,n,4,{...policy,endTime:2}).value,2);
 n.sustain=3;assert.equal(applySustainEdit(a,n,4,{...policy,endTime:2}).value,3);
});
test('logical endpoint stepping crosses tempo changes and avoids cumulative gutter drift with explicit provenance',()=>{
 assert.equal(steppedSustain(beats,.5,.5,1),1.5);
 const a=arrangement(),n=note(0,.5,.5);a.notes=[n];const options={...policy,beats,gutterBeats:.25,snapped:true};
 applySustainEdit(a,n,steppedSustain(beats,n.time,n.sustain,1),options);assert.equal(n.sustain,1.25);
 applySustainEdit(a,n,steppedSustain(beats,n.time,n.sustain,1,{gutterApplied:true,gutterBeats:.25}),options);assert.equal(n.sustain,2.25);
 assert.equal(steppedSustain(beats,.5,n.sustain,-10),0);
});
