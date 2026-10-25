import test from 'node:test';
import assert from 'node:assert/strict';
import {makeProject,makeArrangement,makeNote,shiftTimeline} from '../src/model.js';

// Two empty lead-in bars of 4/4 at 120 BPM (4 s), music from bar 3.
function leadIn(){
 const p=makeProject(),a=makeArrangement('guitar',6);p.duration=20;p.arrangements=[a];
 p.beats=Array.from({length:24},(_,i)=>({time:i*.5,measure:i%4===0?i/4+1:-1}));
 a.notes=[{...makeNote(a,4,0,3,1),techniques:{bend_values:[{t:.5,v:1}]}}];
 a.chords=[{time:6,notes:[makeNote(a,6,1,2),makeNote(a,6,2,2)]}];
 a.anchors=[{time:0,fret:1,width:4},{time:4,fret:3,width:4}];
 a.phrases=[{time:0,name:'COUNT'},{time:4,name:'verse'}];
 p.sections=[{name:'intro',start_time:0},{name:'verse',start_time:8}];
 p.vocals=[{id:'v1',time:5,length:1,lyric:'own'}];
 return p;
}

test('bar 3 to zero: content moves, lead-in beats drop, bars renumber, markers collapse',()=>{
 const p=leadIn(),a=p.arrangements[0];
 assert.deepEqual(shiftTimeline(p,-4),{removedBeats:8});
 assert.equal(p.beats[0].time,0);assert.equal(p.beats[0].measure,1);assert.equal(p.beats.length,16);
 assert.equal(a.notes[0].time,0);assert.equal(a.notes[0].sustain,1);assert.deepEqual(a.notes[0].techniques.bend_values,[{t:.5,v:1}]);
 assert.deepEqual(a.chords[0].notes.map(n=>n.time),[2,2]);assert.equal(a.chords[0].time,2);
 assert.deepEqual(a.anchors,[{time:0,fret:3,width:4}]);
 assert.deepEqual(a.phrases.map(x=>[x.time,x.name]),[[0,'verse']]);
 assert.deepEqual(p.sections.map(x=>[x.start_time,x.name]),[[0,'intro'],[4,'verse']]);
 assert.equal(p.vocals[0].time,1);
});

test('refuses to push notes before zero and leaves the project untouched',()=>{
 const p=leadIn(),before=structuredClone(p);
 assert.throws(()=>shiftTimeline(p,-4.5),/at most 4\.000 s earlier/);
 assert.deepEqual(p,before);
});

test('positive shift pads leading silence and keeps every beat',()=>{
 const p=leadIn();
 assert.deepEqual(shiftTimeline(p,1.25),{removedBeats:0});
 assert.equal(p.beats[0].time,1.25);assert.equal(p.beats.length,24);assert.equal(p.beats[0].measure,1);
 assert.equal(p.arrangements[0].notes[0].time,5.25);assert.equal(p.sections[0].start_time,1.25);
});
