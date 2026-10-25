import test from 'node:test';
import assert from 'node:assert/strict';
import {makeProject,makeNote} from '../src/model.js';
import {findOceIssues} from '../src/oce-checks.js';
test('optional OCE checks find phrase, zone and section authoring problems without mutating charts',()=>{
 const p=makeProject(),a=p.arrangements[0];a.phrases=[{name:'Verse',time:0},{name:'Verse',time:2},{name:'End',time:4}];a.notes=[makeNote(a,1,0,3,2),makeNote(a,1,1,5,.2)];a.chord_templates=[{frets:[7,9,-1,-1,-1,-1]}];a.handshapes=[{chord_id:0,start_time:0,end_time:3}];a.anchors=[{time:0,fret:3,width:4},{time:1.5,fret:7,width:4}];p.sections=[{name:'noguitar',start_time:.5}];const before=structuredClone(p),codes=new Set(findOceIssues(p).map(i=>i.code));
 for(const suffix of ['emptyEnds','phraseConsistency','crossingSustain','stacked','crossingZone','zoneAnchor','zoneVoicing','noGuitar','sectionPhrase'])assert.ok(codes.has(`oce.${suffix}`),suffix);assert.deepEqual(p,before);
});
test('empty boundary phrases, contained chords and aligned sections satisfy documented structure',()=>{
 const p=makeProject(),a=p.arrangements[0];a.phrases=[{name:'Count',time:0},{name:'Original',time:2},{name:'End',time:4}];a.chord_templates=[{name:'Own',frets:[3,5,-1,-1,-1,-1],fingers:[1,3,-1,-1,-1,-1]}];a.chords=[{time:2,chord_id:0,notes:[makeNote(a,2,0,3,.5),makeNote(a,2,1,5,.5)]}];a.handshapes=[{chord_id:0,start_time:2,end_time:3}];a.anchors=[{time:2,fret:3,width:4}];p.sections=[{name:'verse',start_time:2}];assert.deepEqual(findOceIssues(p),[]);
});
test('pitched non-fretted and scratch arrangements do not receive guitar conventions',()=>{
 const p=makeProject();p.arrangements[0].editorOnly=true;assert.deepEqual(findOceIssues(p),[]);p.arrangements[0].editorOnly=false;p.arrangements[0].type='keys';assert.deepEqual(findOceIssues(p),[]);
});
test('epsilon-near lookup retains floating-point gutter edges and malformed timeline fallback',()=>{
 for(const time of [1.6,'1.6']){
  const p=makeProject(),a=p.arrangements[0];a.notes=[{...makeNote(a,1.6,0,3,.1),time}];a.handshapes=[{chord_id:0,start_time:1.2,end_time:3*.4+.399}];a.chord_templates=[{frets:[3,-1,-1,-1,-1,-1]}];a.anchors=[{time:0,fret:3,width:4},{time:NaN,fret:9,width:4}];const before=structuredClone(p);assert.ok(Math.abs(Number(time)-a.handshapes[0].end_time)<.001);assert.ok(findOceIssues(p).some(i=>i.code==='oce.zoneGutter'));assert.deepEqual(p,before);
 }
});
