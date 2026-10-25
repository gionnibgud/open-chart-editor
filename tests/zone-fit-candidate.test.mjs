import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planZoneFit,applyZoneFit} from '../src/zone-fit-candidate.js';
const beats=Array.from({length:25},(_,i)=>({time:i*.5}));
function song(zones){return {id:'own',type:'guitar',stringCount:6,notes:[],chords:[],chord_templates:[{name:'Own',displayName:'Own',frets:[3,5,-1,-1,-1,-1]}],handshapes:zones.map(z=>({chord_id:0,...z})),phrases:[{time:0,name:'own'}],_wire:{opaque:'keep'},difficulties:[]};}
const opts={beats,duration:12,range:{start:0,end:12}};

test('plans separate modes, next matching onset and original phrase boundaries without changing source',()=>{
 const a=song([{start_time:0,end_time:1},{start_time:2,end_time:2.5,kind:'fingerprint'},{start_time:4,end_time:4.5,kind:'arpeggio'},{start_time:7,end_time:8,hideName:true}]);
 a.phrases.push({time:6,name:'next'});const before=structuredClone(a);
 const p=planZoneFit(a,{...opts,mode:'chord'});
 assert.deepEqual(p.changes.map(c=>[c.index,c.newEnd,c.boundary]),[[0,4,'next matching zone'],[2,6,'phrase'],[3,12,'song']]);
 assert.deepEqual(a,before);assert.ok(Object.isFrozen(p.changes[0]));
 const f=planZoneFit(a,{...opts,mode:'fingerprint'});assert.deepEqual(f.changes.map(c=>[c.index,c.newEnd]),[[1,6]]);
});

test('musical gutter follows the supplied nonuniform beat map',()=>{
 const a=song([{start_time:.5,end_time:1},{start_time:3,end_time:3.5}]);a.phrases.push({time:2,name:'next'});
 const map=[{time:0},{time:.5},{time:1},{time:2},{time:3},{time:4}];
 const p=planZoneFit(a,{beats:map,duration:4,zoneIndices:[0],gutterBeats:.25});
 assert.equal(p.changes[0].newEnd,1.75);assert.equal(p.changes[0].boundaryTime,2);
});

test('existing standalone tails, strum children and bend extents are protected with skip or whole-plan rejection',()=>{
 for(const content of ['note','strum','curve']){
  const a=song([{start_time:0,end_time:3},{start_time:2,end_time:3.5},{start_time:5,end_time:5.5}]);
  if(content==='note')a.notes=[{time:1,sustain:1.5}];
  if(content==='strum')a.chords=[{time:1,notes:[{sustain:1.5,string:0,fret:3}]}];
  if(content==='curve')a.notes=[{time:1,sustain:0,techniques:{bend_values:[{t:0,v:0},{t:1.5,v:1}]}}];
  const before=structuredClone(a),p=planZoneFit(a,opts);
  assert.equal(p.skipped.find(s=>s.index===0).protectedUntil,3.5); // also protects the overlapping next zone
  assert.ok(p.skipped.find(s=>s.index===0).reason.includes('cut'));
  assert.ok(p.changes.some(c=>c.index===2));assert.deepEqual(a,before);
  assert.throws(()=>planZoneFit(a,{...opts,conflicts:'reject'}),/Zone 0/);assert.deepEqual(a,before);
 }
});

test('a tail alone can prevent a fit even without an overlapping zone',()=>{
 const a=song([{start_time:0,end_time:4}]);a.phrases.push({time:2,name:'next'});a.notes=[{time:1,sustain:2}];
 const p=planZoneFit(a,opts);assert.equal(p.skipped[0].protectedUntil,3);assert.equal(p.skipped[0].newEnd,2);
});

test('implicit strum tails and bend endpoints protect their exact full extent',()=>{
 for(const event of [{chord:{time:1,sustain:1.1}},{note:{time:1,sustain:0,techniques:{bend_values:[{t:1.0000000001,v:1}]}}}]){
  const a=song([{start_time:0,end_time:4}]);a.phrases.push({time:2,name:'next'});
  if(event.chord)a.chords=[event.chord];else a.notes=[event.note];
  const p=planZoneFit(a,opts);assert.equal(p.changes.length,0);assert.ok(p.skipped[0].protectedUntil>2);
 }
});

test('same-start nested original zones cap inner extension while duplicate bounds are explicit conflicts',()=>{
 const a=song([{start_time:0,end_time:5},{start_time:0,end_time:3},{start_time:6,end_time:7}]);
 const p=planZoneFit(a,{...opts,zoneIndices:[1]});assert.equal(p.changes[0].newEnd,5);assert.equal(p.changes[0].boundary,'containing handshape');
 a.handshapes.push({...a.handshapes[1]});const duplicate=planZoneFit(a,opts);
 assert.equal(duplicate.skipped.filter(s=>s.reason.includes('Duplicate')).length,2);
});

test('contained child zones cannot be cut; unselected children remain unchanged',()=>{
 const a=song([{start_time:0,end_time:4},{start_time:1,end_time:3,kind:'fingerprint'}]);a.phrases.push({time:2,name:'next'});
 const before=structuredClone(a),p=planZoneFit(a,{...opts,zoneIndices:[0]});
 assert.equal(p.skipped[0].protectedUntil,3);assert.equal(p.changes.length,0);
 applyZoneFit(a,p,{beats,duration:12});assert.deepEqual(a,before);
});

test('scope is explicit, half-open and intersects selected indices; zero or reversed outputs are skipped',()=>{
 const a=song([{start_time:0,end_time:1},{start_time:2,end_time:3},{start_time:4,end_time:5}]);
 const p=planZoneFit(a,{...opts,range:{start:0,end:4},zoneIndices:[1,2]});assert.deepEqual(p.changes.map(c=>c.index),[1]);
 const blocked=planZoneFit(a,{...opts,zoneIndices:[0],gutterBeats:10});assert.equal(blocked.changes.length,0);assert.ok(blocked.skipped[0].reason.includes('positive'));
 for(const extra of [{range:null},{zoneIndices:[99]},{range:{start:4,end:2}},{mode:'guess'},{gutterBeats:-1},{duration:NaN}]){
  const o={...opts,...extra};if(extra.range===null)delete o.range;assert.throws(()=>planZoneFit(a,o));
 }
});

test('copy-on-write apply changes working endpoints only even when stored DD/source objects alias them',()=>{
 const a=song([{start_time:0,end_time:1}]);const original=a.handshapes;
 a.difficulties=[{difficulty:0,handshapes:original,notes:[{id:'hidden',time:4,sustain:2}]}];a._wire.handshapes=original;a.activeDifficulty=0;
 const hidden=structuredClone(a.difficulties),source=structuredClone(a._wire),notes=structuredClone(a.notes),chords=structuredClone(a.chords);
 const p=planZoneFit(a,{...opts,zoneIndices:[0]});assert.equal(applyZoneFit(a,p,{beats,duration:12}).changed,1);
 assert.equal(a.handshapes[0].end_time,12);assert.notEqual(a.handshapes,original);
 assert.deepEqual(a.difficulties,hidden);assert.deepEqual(a._wire,source);assert.deepEqual(a.notes,notes);assert.deepEqual(a.chords,chords);
 assert.throws(()=>applyZoneFit(a,p,{beats,duration:12}),/stale/);
});

test('stale working notes, presentation, grid, phrases, duration, source and hidden levels reject without partial writes',()=>{
 const cases=[a=>a.notes.push({time:1,sustain:3}),a=>a.handshapes[0].kind='fingerprint',a=>a.chord_templates[0].displayName='Changed',a=>a.phrases.push({time:3}),a=>a._wire.opaque='Changed',a=>a.difficulties.push({difficulty:1,notes:[]})];
 for(const mutate of cases){const a=song([{start_time:0,end_time:1}]),p=planZoneFit(a,opts);mutate(a);const before=structuredClone(a);assert.throws(()=>applyZoneFit(a,p,{beats,duration:12}),/stale/);assert.deepEqual(a,before);}
 const a=song([{start_time:0,end_time:1}]),p=planZoneFit(a,opts),changed=structuredClone(beats);changed[1].time=.6;
 assert.throws(()=>applyZoneFit(a,p,{beats:changed,duration:12}),/stale/);assert.throws(()=>applyZoneFit(a,p,{beats,duration:13}),/stale/);
 assert.throws(()=>applyZoneFit(a,structuredClone(p),{beats,duration:12}),/fresh/);
 assert.throws(()=>applyZoneFit(a,p),/stale/);
});

test('malformed data rejects transactionally and empty valid scopes remain harmless',()=>{
 for(const mutate of [a=>a.notes.push({time:1,sustain:-1}),a=>a.chords.push({time:1,notes:[{time:NaN}]}),a=>a.handshapes[0].end_time=0]){
  const a=song([{start_time:0,end_time:1}]);mutate(a);const before=structuredClone(a);assert.throws(()=>planZoneFit(a,opts));assert.deepEqual(a,before);
 }
 const a=song([{start_time:0,end_time:1}]);assert.equal(planZoneFit(a,{...opts,range:{start:2,end:4}}).changes.length,0);
});

test('indexed original boundary policy agrees with an independent small quadratic oracle',()=>{
 let seed=81421;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
 for(let run=0;run<50;run++){
  const zones=[],seen=new Set();
  while(zones.length<30){const start=Math.floor(random()*30)/4,end=start+(1+Math.floor(random()*14))/4,key=`${start}/${end}`;if(seen.has(key))continue;seen.add(key);zones.push({start_time:start,end_time:end,kind:random()<.4?'fingerprint':random()<.4?'arpeggio':'chord'});}
  const a=song(zones);a.phrases=[{time:0},{time:5},{time:9}];const p=planZoneFit(a,opts);
  for(const row of [...p.changes,...p.skipped,...p.unchanged]){
   const z=a.handshapes[row.index],mode=z.kind==='fingerprint'?'fingerprint':'chord';
   const phrase=a.phrases.map(p=>p.time).filter(t=>t>z.start_time).sort((x,y)=>x-y)[0]??12;
   const next=a.handshapes.filter(h=>(h.kind==='fingerprint'?'fingerprint':'chord')===mode&&h.start_time>z.start_time).map(h=>h.start_time);
   const parents=a.handshapes.filter((h,i)=>i!==row.index&&h.start_time<=z.start_time&&h.end_time>=z.end_time).map(h=>h.end_time);
   assert.equal(row.boundaryTime,Math.min(12,phrase,...next,...parents));
  }
 }
});

test('100000 zones use indexed fitting rather than a per-zone full scan',{timeout:15000},()=>{
 const a=song(Array.from({length:100000},(_,i)=>({start_time:i*.1,end_time:i*.1+.025}))),duration=10001;
 a.notes=Array.from({length:100000},(_,i)=>({id:`own${i}`,time:i*.1+.005,sustain:.005}));
 const map=[{time:0},{time:.5},{time:duration}];
 const p=planZoneFit(a,{beats:map,duration,range:{start:0,end:duration}});
 assert.equal(p.changes.length,100000);assert.equal(p.skipped.length,0);assert.equal(p.changes[0].newEnd,.1);
 assert.equal(a.handshapes[0].end_time,.025);
});
