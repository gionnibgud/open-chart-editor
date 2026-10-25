import test from 'node:test';
import assert from 'node:assert/strict';
import {gpaBeatMap,notesOnGrid} from '../src/gpa-sync.js';

// Two 4/4 bars at 120 BPM in the chart; audio is slower (bar 0 at 1 s, bar 1 at 3.4 s).
const chart=Array.from({length:8},(_,i)=>({time:i*.5,measure:i%4===0?i/4+1:-1,denominator:4}));

test('beats follow sync points; between points they are spaced evenly',()=>{
 const next=gpaBeatMap(chart,[{time:1,bar:0,fraction:0,msPerBeat:600},{time:3.4,bar:1,fraction:0,msPerBeat:600}]);
 assert.deepEqual(next.slice(0,5).map(b=>b.time),[1,1.6,2.2,2.8,3.4]);
 assert.deepEqual(next.slice(5).map(b=>b.time),[4,4.6,5.2]);
 assert.deepEqual(next.map(b=>b.measure),chart.map(b=>b.measure));
});

test('a point inside a bar uses the bar fraction; earlier beats continue its tempo',()=>{
 const next=gpaBeatMap(chart,[{time:.379,bar:0,fraction:.125,msPerBeat:660}]);
 assert.equal(next[0].time,.049);assert.equal(next[1].time,.709);
});

test('refuses sync beyond the chart, backwards points and a start before the audio',()=>{
 assert.throws(()=>gpaBeatMap(chart,[{time:1,bar:2,fraction:0,msPerBeat:500}]),/reaches bar 3, but this chart has 2 bars/);
 assert.throws(()=>gpaBeatMap(chart,[{time:2,bar:0,fraction:0,msPerBeat:500},{time:1,bar:1,fraction:0,msPerBeat:500}]),/move forward/);
 assert.throws(()=>gpaBeatMap(chart,[{time:.1,bar:1,fraction:0,msPerBeat:500}]),/before the audio starts/);
});

// Hurt-like case: notes at 92 BPM eighths; the score map fits, a stale 120 BPM grid does not.
test('notesOnGrid tells a score map from a stale default grid',()=>{
 const beat=60/92,notes=Array.from({length:32},(_,i)=>({time:i*beat/2}));
 const project=beats=>({beats,arrangements:[{type:'guitar',notes,chords:[]}]});
 const score=Array.from({length:20},(_,i)=>({time:i*beat,measure:i%4===0?i/4+1:-1}));
 const stale=Array.from({length:30},(_,i)=>({time:i*.5,measure:i%4===0?i/4+1:-1}));
 assert.equal(notesOnGrid(project(score)),1);
 assert.ok(notesOnGrid(project(stale))<.5);
});
