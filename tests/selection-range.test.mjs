import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rangeForSelectedNotes,resizeSelectionEdges} from '../src/selection-range.js';
const project={duration:4,beats:[0,.5,1,1.5,2,2.25,2.5,2.75,3,3.25,3.5,3.75,4].map((time,index)=>({time,measure:({0:1,4:2,7:3,12:4})[index]??-1}))};
const arrangement={phrases:[{time:0},{time:1.5},{time:3.5}]};
const close=(actual,expected)=>{assert.ok(Math.abs(actual.start-expected.start)<1e-8,`${actual.start} != ${expected.start}`);assert.ok(Math.abs(actual.end-expected.end)<1e-8,`${actual.end} != ${expected.end}`);};
test('snap expands/shrinks strict boundaries through a tempo ramp rather than fixed wall time',()=>{
 const p={duration:3,beats:[0,.5,1.1,1.8,2.6].map(time=>({time}))};
 close(resizeSelectionEdges(p,arrangement,{start:.5,end:1.1}),{start:.375,end:1.275});
 close(resizeSelectionEdges(p,arrangement,{start:.5,end:1.1},{mode:'shrink'}),{start:.65,end:.95});
});
test('measure edges follow authored pickup/mixed-meter boundaries rather than assuming four beats',()=>{
 assert.deepEqual(resizeSelectionEdges(project,arrangement,{start:.5,end:2},{unit:'measure'}),{start:0,end:2.75});
 assert.deepEqual(resizeSelectionEdges(project,arrangement,{start:0,end:4},{unit:'measure',mode:'shrink'}),{start:2,end:2.75});
 const pickup={duration:4,beats:[{time:0,measure:0},{time:.5,measure:1},{time:1,measure:-1},{time:2.5,measure:2},{time:4,measure:3}]};
 assert.deepEqual(resizeSelectionEdges(pickup,arrangement,{start:.1,end:.4},{unit:'measure'}),{start:0,end:.5});
});
test('phrase boundaries are sorted/deduplicated and add bounded song edges',()=>{
 const a={phrases:[{time:3.5},{time:1.5},{time:1.5},{time:9}]};
 assert.deepEqual(resizeSelectionEdges(project,a,{start:1.5,end:3.5},{unit:'phrase'}),{start:0,end:4});
 assert.deepEqual(resizeSelectionEdges(project,a,{start:0,end:3.5},{unit:'phrase',mode:'shrink',edge:'right'}),{start:0,end:1.5});
 assert.deepEqual(resizeSelectionEdges(project,{phrases:[]},{start:1,end:2},{unit:'phrase'}),{start:0,end:4});
});
test('one-edge operations preserve the opposite edge and ranges are half-open attack windows',()=>{
 const range={start:.5,end:1};
 assert.deepEqual(resizeSelectionEdges(project,arrangement,range,{edge:'right'}),{start:.5,end:1.125});
 const left=resizeSelectionEdges(project,arrangement,range,{edge:'left'});assert.deepEqual(left,{start:.375,end:1});
 const events=[{id:'left',time:.375},{id:'inside',time:.5},{id:'right',time:1}];
 assert.deepEqual(events.filter(n=>n.time>=left.start&&n.time<left.end).map(n=>n.id),['left','inside']);
});
test('empty selection starts at bounded cursor and selected attacks include their final snap cell',()=>{
 assert.deepEqual(rangeForSelectedNotes(project,[],8),{start:4,end:4});
 assert.deepEqual(resizeSelectionEdges(project,arrangement,{start:0,end:0}),{start:0,end:.125});
 assert.deepEqual(resizeSelectionEdges(project,arrangement,{start:4,end:4}),{start:3.9375,end:4});
 assert.deepEqual(rangeForSelectedNotes(project,[{time:.5},{time:1}],0),{start:.5,end:1.125});
});
test('song boundaries clamp and impossible shrink refuses atomically without changing source',()=>{
 const range={start:.5,end:1},before=structuredClone({project,arrangement,range});
 assert.throws(()=>resizeSelectionEdges(project,arrangement,range,{mode:'shrink',unit:'measure'}),/opposite edge/);
 assert.throws(()=>resizeSelectionEdges(project,arrangement,{start:1,end:1},{mode:'shrink'}),/empty/);
 assert.deepEqual({project,arrangement,range},before);
 assert.deepEqual(resizeSelectionEdges(project,arrangement,{start:-3,end:12}),{start:0,end:4});
});
test('bad inputs reject rather than producing NaN or inverted ranges',()=>{
 for(const options of [{mode:'guess'},{edge:'up'},{unit:'barline?'},{division:0},{division:Infinity}])assert.throws(()=>resizeSelectionEdges(project,arrangement,{start:0,end:1},options));
 assert.throws(()=>resizeSelectionEdges(project,arrangement,{start:2,end:1}),/start/);
 assert.throws(()=>rangeForSelectedNotes(project,[{time:NaN}],0),/finite/);
});
test('large selected charts do not depend on JavaScript argument-stack limits',()=>{
 const notes=Array.from({length:150000},(_,i)=>({time:.5+i/200000}));
 close(rangeForSelectedNotes(project,notes,0),{start:.5,end:1.25});
});
