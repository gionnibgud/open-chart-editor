import {test} from 'node:test';import assert from 'node:assert/strict';
import {makeArrangement,makeNote,notePitch,chordFromSelection,clone} from '../src/model.js';
import {moveStrings} from '../src/string-move.js';
test('adjacent string movement preserves either fret position or sounding pitch across tuning and capo',()=>{
 const a=makeArrangement('bass',5);a.capo=2;a.tuning=[-1,0,1,0,0];const n=makeNote(a,1,0,8,1);n.pitch=notePitch(a,n);a.notes=[n];const originalPitch=n.pitch;
 moveStrings(a,[n.id],1,{preservePitch:true});assert.equal(a.notes[0].string,1);assert.equal(a.notes[0].fret,2);assert.equal(notePitch(a,a.notes[0]),originalPitch);
 moveStrings(a,[n.id],1);assert.equal(a.notes[0].fret,2);assert.equal(notePitch(a,a.notes[0]),originalPitch+6);
});
test('whole selection rejects boundary and collision failures without partial mutation',()=>{
 const a=makeArrangement();a.notes=[makeNote(a,1,0,3),makeNote(a,1,1,4)];let before=clone(a);
 assert.throws(()=>moveStrings(a,[a.notes[0].id],1),/same string/);assert.deepEqual(a,before);
 assert.throws(()=>moveStrings(a,a.notes.map(n=>n.id),-1),/whole selection/);assert.deepEqual(a,before);
 assert.throws(()=>moveStrings(a,[a.notes[1].id],1,{preservePitch:true}),/frets/);assert.deepEqual(a,before);
});
test('slides keep interval and zero endpoints, absent -1 and bend data survive',()=>{
 const a=makeArrangement('guitar',8),n=makeNote(a,2,1,0,1);n.techniques={slide_to:0,slide_unpitch_to:-1,bend:2,bend_values:[{t:0,v:0},{t:1,v:2}],opaque:'own'};a.notes=[n];const curve=clone(n.techniques.bend_values);
 moveStrings(a,[n.id],-1,{preservePitch:true});assert.equal(a.notes[0].fret,5);assert.equal(a.notes[0].techniques.slide_to,5);assert.equal(a.notes[0].techniques.slide_unpitch_to,-1);assert.deepEqual(a.notes[0].techniques.bend_values,curve);assert.equal(a.notes[0].time,2);
});
test('selected chord changes its own template and zone without rewriting reused occurrences',()=>{
 const a=makeArrangement(),notes=[makeNote(a,1,0,8),makeNote(a,1,1,7)];a.notes=notes;const chord=chordFromSelection(a,notes,'Original');a.chord_templates[0].fingers=[0,3,-1,-1,-1,-1];a.chords.push({...clone(chord),time:3,notes:chord.notes.map(n=>({...clone(n),id:n.id+'other',time:3}))});const original=clone(a.chord_templates[0]);
 moveStrings(a,notes.map(n=>n.id),1,{preservePitch:true});assert.notEqual(a.chords[0].chord_id,0);assert.equal(a.chords[1].chord_id,0);assert.deepEqual(a.chord_templates[0],original);assert.equal(a.handshapes[0].chord_id,a.chords[0].chord_id);assert.deepEqual(a.chords[0].notes.map(n=>n.fret),[3,2]);assert.deepEqual(a.chord_templates[a.chords[0].chord_id].fingers,[-1,0,3,-1,-1,-1]);
});
