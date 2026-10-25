import test from 'node:test';
import assert from 'node:assert/strict';
import {makeArrangement,makeNote,synchronizeChordVoicings,History} from '../src/model.js';
function fixture(){const a=makeArrangement();a.chord_templates=[{name:'Original shape',frets:[3,5,-1,-1,-1,-1],fingers:[1,3,-1,-1,-1,-1],privateMetadata:{original:true}}];a.chords=[0,2].map(time=>({time,chord_id:0,notes:[makeNote(a,time,0,3,1),makeNote(a,time,1,5,1)]}));a.handshapes=[{chord_id:0,start_time:0,end_time:1},{chord_id:0,start_time:2,end_time:3}];return a;}
test('editing one chord voice creates a local template and retains other strums and opaque fields',()=>{
 const a=fixture(),source=structuredClone(a.chord_templates[0]),note=a.chords[0].notes[0];note.techniques={palm_mute:true,bend_values:[{t:0,v:0},{t:1,v:1}]};note.fret=7;
 synchronizeChordVoicings(a,[note.id]);assert.deepEqual(a.chord_templates[0],source);assert.equal(a.chords[1].chord_id,0);assert.deepEqual(a.chord_templates[a.chords[0].chord_id].frets,[7,5,-1,-1,-1,-1]);assert.deepEqual(a.chords[0].notes[0].techniques.bend_values,[{t:0,v:0},{t:1,v:1}]);assert.equal(a.handshapes[0].chord_id,a.chords[0].chord_id);assert.equal(a.handshapes[1].chord_id,0);
});
test('shared zones retain their original shape when only some strums change',()=>{
 const a=fixture();a.handshapes=[{chord_id:0,start_time:0,end_time:3}];const n=a.chords[0].notes[0];n.techniques.left_hand=2;synchronizeChordVoicings(a,[n.id]);assert.equal(a.handshapes[0].chord_id,0);assert.equal(a.chord_templates[a.chords[0].chord_id].fingers[0],2);
});
test('matching edited voices reuse a variant and undo restores source exactly',()=>{
 const a=fixture(),h=new History({arrangements:[a]}),before=structuredClone(h.project);
 h.commit('Transpose all strums',p=>{const a=p.arrangements[0],notes=a.chords.flatMap(c=>c.notes);for(const n of notes)n.fret++;synchronizeChordVoicings(a,notes.map(n=>n.id));});
 assert.equal(a.chord_templates.length,2);assert.equal(a.chords[0].chord_id,a.chords[1].chord_id);h.undo();assert.deepEqual(h.project,before);h.redo();assert.equal(h.project.arrangements[0].chords[0].notes[0].fret,4);
});
