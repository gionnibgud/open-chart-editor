import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeArrangement,makeNote,History,makeProject,chordFromSelection,matchingChordTemplate} from '../src/model.js';
import {insertChordZone,resizeChordZone,setChordZoneEnd,splitChordInstances,toggleChordStrum,deleteChordTemplate,chordZoneContents,moveChordZone,chordZoneStyle,setChordZoneStyle,shouldHideDoubleStop,applyDefaultChordName,chordStrumPresentation,setChordAwareSustain} from '../src/chord-tools.js';
const beats=[{time:0},{time:.5},{time:1},{time:2},{time:3},{time:4}];
function fixture(count=6,type='guitar'){
 const a=makeArrangement(type,count);
 a.chord_templates=[{name:'Original',frets:Array.from({length:count},(_,i)=>i<2?(i===0?3:5):-1),fingers:Array.from({length:count},(_,i)=>i<2?i+1:-1)}];return a;
}
test('fingerprint-only zone uses musical length and gutter across a tempo change without sounding notes',()=>{
 const a=fixture(),before=structuredClone(a);const result=insertChordZone(a,beats,0,.5,{lengthBeats:3,gutterBeats:.25,fingerprintOnly:true});
 assert.equal(result.zone.start_time,.5);assert.equal(result.zone.end_time,2.75);assert.equal(result.zone.kind,'fingerprint');assert.equal(result.chord,null);assert.deepEqual(result.notes,[]);
 assert.deepEqual(a.notes,before.notes);assert.deepEqual(a.chords,before.chords);assert.deepEqual(a.chord_templates[0],before.chord_templates[0]);
});
test('sounding chord insertion inherits frets/fingers and bounded beat-relative sustain for extended strings',()=>{
 for(const [count,type]of [[8,'guitar'],[5,'bass']]){
  const a=fixture(count,type);a.chord_templates[0].frets[count-1]=7;a.chord_templates[0].fingers[count-1]=4;
  const {zone,chord,notes}=insertChordZone(a,beats,0,1,{lengthBeats:1,gutterBeats:.5,sustainBeats:2});
  assert.equal(zone.end_time,1.5);assert.equal(chord.notes,notes);assert.equal(notes.length,3);
  assert.deepEqual(notes.map(n=>[n.string,n.fret,n.sustain,n.techniques.left_hand]),[[0,3,.5,1],[1,5,.5,2],[count-1,7,.5,4]]);
  assert.equal(new Set(notes.map(n=>n.id)).size,3);
 }
});
test('resize changes only the selected zone endpoint and uses start-relative beat coordinates',()=>{
 const a=fixture();insertChordZone(a,beats,0,.75,{fingerprintOnly:true});insertChordZone(a,beats,0,4,{fingerprintOnly:true});
 const other=structuredClone(a.handshapes[1]);resizeChordZone(a,beats,0,{lengthBeats:2,gutterBeats:.25});
 assert.equal(a.handshapes[0].end_time,2.25);assert.deepEqual(a.handshapes[1],other);
});
test('invalid options, chord templates and collisions reject without partial mutation',()=>{
 for(const options of [{lengthBeats:0},{gutterBeats:4},{gutterBeats:-1},{sustainBeats:NaN},{fingerprintOnly:'yes'}]){
  const a=fixture(),before=structuredClone(a);assert.throws(()=>insertChordZone(a,beats,0,0,options));assert.deepEqual(a,before);
 }
 const a=fixture();a.notes=[makeNote(a,0,0,7)];const before=structuredClone(a);assert.throws(()=>insertChordZone(a,beats,0,0),/overlap/);assert.deepEqual(a,before);
 assert.throws(()=>insertChordZone(makeArrangement('keys'),beats,0,0),/guitar or bass/);
 assert.throws(()=>insertChordZone(a,beats,4,0),/existing chord template/);
});
test('split preserves member identity, sustain, finger, curves and opaque metadata; inherits parent technique defaults',()=>{
 const a=fixture(),{chord}=insertChordZone(a,beats,0,0);chord.techniques={accent:true,palm_mute:true};
 chord.notes[0].techniques={...chord.notes[0].techniques,palm_mute:false,bend_values:[{t:0,v:0},{t:.1,v:1}]};chord.notes[0].future={own:'metadata'};
 const source=structuredClone(chord.notes),zones=structuredClone(a.handshapes),templates=structuredClone(a.chord_templates);
 a.difficulties=[{difficulty:0,notes:[],chords:[],handshapes:[]}];const levels=structuredClone(a.difficulties);
 const notes=splitChordInstances(a,[0]);assert.equal(a.chords.length,0);assert.deepEqual(notes.map(n=>n.id),source.map(n=>n.id));
 assert.deepEqual(notes[0].future,source[0].future);assert.deepEqual(notes[0].techniques.bend_values,source[0].techniques.bend_values);
 assert.equal(notes[0].techniques.palm_mute,false);assert.equal(notes[1].techniques.palm_mute,true);assert.equal(notes[0].techniques.accent,true);
 assert.equal(notes[0].sustain,source[0].sustain);assert.deepEqual(a.handshapes,zones);assert.deepEqual(a.chord_templates,templates);assert.deepEqual(a.difficulties,levels);
});
test('remove-unused zones preserves a shared zone while retained strums still use it',()=>{
 const a=fixture();insertChordZone(a,beats,0,0);const chord=structuredClone(a.chords[0]);chord.time=.25;chord.notes=chord.notes.map(n=>({...n,id:n.id+'-repeat',time:.25}));a.chords.push(chord);
 splitChordInstances(a,[0],{handshapes:'remove-unused'});assert.equal(a.handshapes.length,1);
 splitChordInstances(a,[0],{handshapes:'remove-unused'});assert.equal(a.handshapes.length,0);assert.equal(a.notes.length,4);
});
test('splitting refuses conflict/malformed members atomically and ignores duplicate selected indexes',()=>{
 const a=fixture();insertChordZone(a,beats,0,0);a.notes.push(makeNote(a,0,0,9));let before=structuredClone(a);
 assert.throws(()=>splitChordInstances(a,[0]),/overlap/);assert.deepEqual(a,before);
 a.notes=[];a.chords[0].notes[0].fret=99;before=structuredClone(a);assert.throws(()=>splitChordInstances(a,[0]),/invalid string, fret or timing/);assert.deepEqual(a,before);
 a.chords[0].notes[0].fret=3;assert.equal(splitChordInstances(a,[0,0]).length,2);
});
test('zone and split operations are undoable through the existing history transaction boundary',()=>{
 const project=makeProject();project.arrangements=[fixture()];const history=new History(project),source=structuredClone(project);
 history.commit('Chord zone',p=>insertChordZone(p.arrangements[0],beats,0,0));history.commit('Split chord',p=>splitChordInstances(p.arrangements[0],[0]));
 assert.equal(history.project.arrangements[0].notes.length,2);history.undo();assert.equal(history.project.arrangements[0].chords.length,1);
 history.undo();assert.deepEqual(history.project,source);history.redo();assert.equal(history.project.arrangements[0].handshapes.length,1);
});
test('N toggles exactly one strum using the containing zone template and retains the zone on removal',()=>{
 const a=fixture();a.chord_templates.push({...structuredClone(a.chord_templates[0]),name:'Second',frets:[5,7,-1,-1,-1,-1]});
 insertChordZone(a,beats,1,0,{fingerprintOnly:true});const zone=structuredClone(a.handshapes);
 const inserted=toggleChordStrum(a,beats,.25,{templateIndex:0});assert.equal(inserted.removed,false);assert.equal(inserted.chord.chord_id,a.handshapes[0].chord_id);assert.deepEqual(inserted.notes.map(n=>n.fret),[5,7]);
 assert.equal(a.handshapes.length,1);const removed=toggleChordStrum(a,beats,.25001);assert.equal(removed.removed,true);assert.equal(a.chords.length,0);assert.deepEqual(a.handshapes,zone);
});
test('N outside a containing zone rejects without inventing context; conflicting notes reject atomically',()=>{
 const a=fixture(),empty=structuredClone(a);assert.throws(()=>toggleChordStrum(a,beats,0),/Insert a chord zone/);assert.deepEqual(a,empty);
 const added=insertChordZone(a,beats,0,0,{lengthBeats:1,gutterBeats:.25});assert.equal(added.zone.end_time,.375);
 toggleChordStrum(a,beats,0);a.notes=[makeNote(a,.25,0,12)];const before=structuredClone(a);assert.throws(()=>toggleChordStrum(a,beats,.25),/overlap/);assert.deepEqual(a,before);
});
test('explicit zone endpoint rejects a nonpositive duration without altering notes',()=>{
 const a=fixture();insertChordZone(a,beats,0,.5);const notes=structuredClone(a.chords);
 assert.throws(()=>setChordZoneEnd(a,0,.5),/follow its start/);setChordZoneEnd(a,0,2.125);assert.equal(a.handshapes[0].end_time,2.125);assert.deepEqual(a.chords,notes);
});
test('unused-template deletion remaps surviving references and protects all stored levels and zones',()=>{
 const a=fixture();a.chord_templates.push({...structuredClone(a.chord_templates[0]),name:'Used'});insertChordZone(a,beats,1,0);
 a.difficulties=[{difficulty:0,notes:[],chords:[],handshapes:[{chord_id:1,start_time:0,end_time:1}]}];
 const before=structuredClone(a);assert.throws(()=>deleteChordTemplate(a,1),/used by a strum/);assert.deepEqual(a,before);
 deleteChordTemplate(a,0);assert.equal(a.chord_templates[0].name,'Used');assert.equal(a.chords[0].chord_id,0);assert.equal(a.handshapes[0].chord_id,0);assert.equal(a.difficulties[0].handshapes[0].chord_id,0);
 a.chords=[];a.handshapes=[];assert.throws(()=>deleteChordTemplate(a,0),/stored difficulties/);
});
test('zone body move preserves contained strums, standalone notes, nested zones and relative curves',()=>{
 const a=fixture(),{chord,zone}=insertChordZone(a,beats,0,.5,{lengthBeats:2});
 a.notes=[makeNote(a,1,3,8,.6),makeNote(a,4,4,9,.5)];a.notes[0].techniques.bend_values=[{t:0,v:0},{t:.5,v:1}];a.handshapes.push({chord_id:0,start_time:.75,end_time:1.25});
 const ids=[...chord.notes,a.notes[0]].map(n=>n.id),outside=structuredClone(a.notes[1]),curve=structuredClone(a.notes[0].techniques.bend_values);
 assert.equal(chordZoneContents(a,0).notes.length,3);const result=moveChordZone(a,0,1);
 assert.equal(zone.start_time,1.5);assert.equal(zone.end_time,3);assert.equal(chord.time,1.5);assert.equal(a.handshapes[1].start_time,1.75);assert.equal(result.endTime,3);
 assert.deepEqual(result.notes.map(n=>n.id),[ids[2],ids[0],ids[1]]);assert.deepEqual(a.notes.find(n=>n.id===ids[2]).techniques.bend_values,curve);assert.deepEqual(a.notes.find(n=>n.time===4),outside);
});
test('zone move refuses negative starts and note collisions atomically',()=>{
 const a=fixture();insertChordZone(a,beats,0,0,{lengthBeats:1});a.notes=[makeNote(a,2,0,7)];const before=structuredClone(a);
 assert.throws(()=>moveChordZone(a,0,-1),/nonnegative/);assert.throws(()=>moveChordZone(a,0,2),/overlap/);assert.deepEqual(a,before);
});
test('zone type/name presentation clones shared templates and leaves all musical note values intact',()=>{
 const a=fixture();insertChordZone(a,beats,0,0,{lengthBeats:1});insertChordZone(a,beats,0,2,{lengthBeats:1});
 const original=structuredClone(a.chord_templates[0]),notes=structuredClone(a.chords.map(c=>c.notes));
 setChordZoneStyle(a,0,{kind:'arpeggio',hideName:false});assert.equal(chordZoneStyle(a,0).kind,'arpeggio');assert.equal(a.handshapes[0].arp,true);assert.equal(a.chord_templates[a.handshapes[0].chord_id].displayName,'Original-arp');assert.equal(a.chords[0].chord_id,a.handshapes[0].chord_id);
 assert.equal(a.chords[1].chord_id,0);assert.deepEqual(a.chord_templates[0],original);assert.deepEqual(a.chords.map(c=>c.notes),notes);
 const before=structuredClone(a);assert.throws(()=>setChordZoneStyle(a,0,{kind:'arpeggio',hideName:true}),/cannot be combined/);assert.deepEqual(a,before);
 setChordZoneStyle(a,0,{kind:'fingerprint',hideName:false});assert.equal(a.chord_templates[a.handshapes[0].chord_id].displayName,'Original-nop');assert.equal(a.handshapes[0].arp,false);
 setChordZoneStyle(a,0,{kind:'chord',hideName:true});assert.equal(chordZoneStyle(a,0).hideName,true);assert.deepEqual(a.chords.map(c=>c.notes),notes);
});
test('outer zone style preserves more-specific nested-zone strum references',()=>{
 const a=fixture();insertChordZone(a,beats,0,0,{lengthBeats:4});const added=toggleChordStrum(a,beats,1);a.handshapes.push({chord_id:0,start_time:.75,end_time:1.5});
 setChordZoneStyle(a,0,{kind:'arpeggio',hideName:false});assert.equal(a.chords[0].chord_id,1);assert.equal(added.chord.chord_id,0);assert.equal(a.handshapes[1].chord_id,0);
});
test('one-beat default and sounding perfect-fifth exception obey alternate tuning and capo',()=>{
 const a=fixture();const inserted=insertChordZone(a,beats,0,0);assert.equal(inserted.zone.end_time,.5);assert.equal(inserted.zone.hideName,false);
 a.tuning[0]=-2;a.capo=2;assert.equal(shouldHideDoubleStop(a,a.chord_templates[0]),true);
 const second=insertChordZone(a,beats,0,2);assert.equal(second.zone.hideName,true);assert.ok(a.chord_templates[second.zone.chord_id].displayName.endsWith('-nop'));assert.equal(a.chord_templates[0].displayName,undefined);
});
test('repeated strums get no newly authored sustain, draw compactly, and imported sustain is never destroyed',()=>{
 const a=fixture();insertChordZone(a,beats,0,0,{lengthBeats:4});const initial=a.chords[0],repeat=toggleChordStrum(a,beats,.5).chord;
 assert.ok(initial.notes.every(n=>n.sustain>0));assert.ok(repeat.notes.every(n=>n.sustain===0));assert.deepEqual(chordStrumPresentation(a,repeat),{repeat:true,compact:true});
 repeat.notes[0].sustain=.77;const before=structuredClone(repeat);assert.deepEqual(chordStrumPresentation(a,repeat),{repeat:true,compact:false});assert.deepEqual(repeat,before);
});
test('F reuses exact frets and entered fingers; differing fingering or explicit rename remains independent',()=>{
 const a=fixture();a.notes=[makeNote(a,0,0,3,.2),makeNote(a,0,1,5,.2)];a.notes[0].techniques.left_hand=1;a.notes[1].techniques.left_hand=2;
 assert.equal(matchingChordTemplate(a,a.notes),0);const chord=chordFromSelection(a,a.notes,'Ignored only when reuse requested');assert.equal(chord.chord_id,0);assert.equal(a.chord_templates.length,1);assert.equal(chord.notes[1].techniques.left_hand,2);
 const next=chord.notes.map(n=>({...structuredClone(n),id:n.id+'-second',time:1}));next[1].techniques.left_hand=3;a.notes.push(...next);assert.equal(matchingChordTemplate(a,next),-1);const second=chordFromSelection(a,next,'Own alternative');assert.equal(second.chord_id,1);
 const copied=chord.notes.map(n=>({...structuredClone(n),id:n.id+'-third',time:2}));a.notes.push(...copied);const renamed=chordFromSelection(a,copied,'Own explicit rename',{reuseTemplate:false});assert.equal(a.chord_templates[renamed.chord_id].name,'Own explicit rename');
});
test('default double-stop naming on an F-created zone uses a cloned native presentation',()=>{
 const a=makeArrangement();a.notes=[makeNote(a,0,0,3,.5),makeNote(a,0,1,3,.5)];const chord=chordFromSelection(a,a.notes,'Own pair');applyDefaultChordName(a,0);
 assert.equal(a.handshapes[0].hideName,true);assert.equal(a.chord_templates[chord.chord_id].displayName,'Own pair-nop');assert.equal(a.chord_templates[0].displayName,'Own pair');
});
test('repeated zero-sustain guard refuses new tails while allowing imported tails and ordinary notes',()=>{
 const a=fixture();insertChordZone(a,beats,0,0,{lengthBeats:4});const repeated=toggleChordStrum(a,beats,.5).chord,n=repeated.notes[0];
 assert.throws(()=>setChordAwareSustain(a,n,.75),/sustain/i);assert.equal(n.sustain,0);
 n.sustain=.6;setChordAwareSustain(a,n,.8);assert.equal(n.sustain,.8);
 const ordinary=makeNote(a,2,0,4,.1);a.notes.push(ordinary);setChordAwareSustain(a,ordinary,.9);assert.equal(ordinary.sustain,.9);
 assert.throws(()=>setChordAwareSustain(a,ordinary,-1),/nonnegative/i);assert.equal(ordinary.sustain,.9);
});
