import test from 'node:test';import assert from 'node:assert/strict';
import {makeArrangement,makeNote,notePitch,History} from '../src/model.js';import {transposeSelection} from '../src/transpose.js';
test('piano boundary rejects entire selection rather than collapsing voicing intervals',()=>{
 const a=makeArrangement('keys');a.notes=[makeNote(a,0,126),makeNote(a,0,127)];let before=structuredClone(a);assert.throws(()=>transposeSelection(a,a.notes.map(n=>n.id),1),/MIDI pitch/);assert.deepEqual(a,before);
 transposeSelection(a,a.notes.map(n=>n.id),-1);assert.deepEqual(a.notes.map(n=>notePitch(a,n)),[125,126]);assert.deepEqual(a.notes.map(n=>[n.string,n.fret]),[[5,5],[5,6]]);
 a.notes=[makeNote(a,0,0),makeNote(a,0,7)];before=structuredClone(a);assert.throws(()=>transposeSelection(a,a.notes.map(n=>n.id),-1));assert.deepEqual(a,before);
});
test('fretted chord shifts atomically at capo bounds and keeps unrelated template instances',()=>{
 const a=makeArrangement('guitar');a.capo=3;a.chord_templates=[{name:'Own chord',frets:[2,4,-1,-1,-1,-1],fingers:[1,3,-1,-1,-1,-1],source:{own:true}}];
 a.chords=[0,2].map(time=>({time,chord_id:0,notes:[makeNote(a,time,0,2,.5),makeNote(a,time,1,4,.5)]}));a.handshapes=[{start_time:0,end_time:1,chord_id:0},{start_time:2,end_time:3,chord_id:0}];const before=structuredClone(a),ids=a.chords[0].notes.map(n=>n.id),pitches=a.chords[0].notes.map(n=>notePitch(a,n));
 transposeSelection(a,ids,2);assert.deepEqual(a.chords[0].notes.map(n=>notePitch(a,n)),pitches.map(p=>p+2));assert.deepEqual(a.chords[1],before.chords[1]);assert.deepEqual(a.chord_templates[0],before.chord_templates[0]);assert.deepEqual(a.chord_templates[a.chords[0].chord_id].frets,[4,6,-1,-1,-1,-1]);assert.equal(a.handshapes[0].chord_id,a.chords[0].chord_id);assert.equal(a.handshapes[1].chord_id,0);
 const shifted=structuredClone(a);assert.throws(()=>transposeSelection(a,ids,16),/Fret/);assert.deepEqual(a,shifted);
});
test('slide zero is a real endpoint, absent -1 stays absent, bend/timing/source metadata survive',()=>{
 const a=makeArrangement('bass');a.capo=3;const n=makeNote(a,1.23456789,0,2,.875);n.techniques={slide_to:0,slide_unpitch_to:-1,bend:2,bend_values:[{t:.2,v:1.5}],vibrato:120};n._wire={f:2,slu:-1,custom:'own'};a.notes=[n];
 transposeSelection(a,[n.id],1);assert.equal(a.notes[0].techniques.slide_to,1);assert.equal(a.notes[0].techniques.slide_unpitch_to,-1);assert.equal(a.notes[0].time,n.time);assert.equal(a.notes[0].sustain,n.sustain);assert.deepEqual(a.notes[0].techniques.bend_values,n.techniques.bend_values);assert.deepEqual(a.notes[0]._wire,n._wire);
 a.notes[0].techniques.slide_unpitch_to=0;const before=structuredClone(a);assert.throws(()=>transposeSelection(a,[n.id],-1),/Slide destination/);assert.deepEqual(a,before);
});
test('drums never acquire frets and explicit guitar pitch conflicts reject without edits',()=>{
 const drums=makeArrangement('drums');drums.notes=[{id:'hit',time:0,piece:'kick',velocity:90}];const before=structuredClone(drums);assert.throws(()=>transposeSelection(drums,['hit'],1),/Drum hits/);assert.deepEqual(drums,before);
 const a=makeArrangement('guitar');a.notes=[makeNote(a,0,0,2)];a.notes[0].pitch=41;assert.throws(()=>transposeSelection(a,[a.notes[0].id],1),/conflicting/);a.notes[0].pitch=42;transposeSelection(a,[a.notes[0].id],1);assert.equal(a.notes[0].fret,3);assert.equal(a.notes[0].pitch,43);assert.equal(notePitch(a,a.notes[0]),43);
});
test('malformed chord failure rolls back and undo restores every technique and interval',()=>{
 const a=makeArrangement('guitar');a.chords=[{time:0,chord_id:8,notes:[makeNote(a,0,0,4)]}];const before=structuredClone(a);assert.throws(()=>transposeSelection(a,[a.chords[0].notes[0].id],1),/missing template/);assert.deepEqual(a,before);
 const keys=makeArrangement('keys');keys.notes=[makeNote(keys,0,64),makeNote(keys,0,67)];const history=new History({arrangements:[keys]});const original=structuredClone(history.project);history.commit('Transpose',p=>transposeSelection(p.arrangements[0],keys.notes.map(n=>n.id),12));assert.deepEqual(history.project.arrangements[0].notes.map(n=>n.pitch),[76,79]);history.undo();assert.deepEqual(history.project,original);history.redo();assert.deepEqual(history.project.arrangements[0].notes.map(n=>n.pitch),[76,79]);
});
