import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeProject,makeArrangement,makeNote,pitches,setStringCount,notePitch,beatAt,timeAt,applyGrid,setTempo,extendGrid,History,chordFromSelection,updateChordTemplate,validate,normalizeProject} from '../src/model.js';
test('beat coordinate converter preserves off-grid timing across changes and tails',()=>{
 const beats=[{time:0.2},{time:0.7},{time:1.7},{time:2}];
 for(let t=-1;t<4;t+=0.013)assert.ok(Math.abs(timeAt(beats,beatAt(beats,t))-t)<1e-12);
});
test('tempo remap preserves beat positions and sustain lengths; undo restores exact source',()=>{
 const p=makeProject();p.arrangements[0].notes=[makeNote(p.arrangements[0],0.333,0,3,0.777)];const h=new History(p),before=structuredClone(p);
 h.commit('Tempo',p=>setTempo(p,90,{moveNotes:true}));
 assert.ok(Math.abs(beatAt(h.project.beats,h.project.arrangements[0].notes[0].time)-0.666)<1e-12);
 h.undo();assert.deepEqual(h.project,before);h.redo();assert.notDeepEqual(h.project,before);
});
test('grid alignment mode keeps authored recording times fixed and rejects crossing beats',()=>{
 const p=makeProject();const n=makeNote(p.arrangements[0],1,0,5);p.arrangements[0].notes=[n];const next=structuredClone(p.beats);next[1].time=0.6;applyGrid(p,next,false);assert.equal(n.time,1);
 next[1].time=2;assert.throws(()=>applyGrid(p,next),/strictly/);
});
test('extended string addition preserves existing pitches and cannot discard used lower string',()=>{
 for(const type of ['guitar','bass']){
  const a=makeArrangement(type);a.notes=[makeNote(a,0,0,5)];const old=notePitch(a,a.notes[0]);setStringCount(a,a.stringCount+1);assert.equal(notePitch(a,a.notes[0]),old);assert.equal(a.notes[0].string,1);
  a.notes.push(makeNote(a,1,0,3));assert.throws(()=>setStringCount(a,a.stringCount-1),/lose/);
 }
 assert.equal(pitches('guitar',8).length,8);assert.equal(makeArrangement('bass',6).stringCount,6);
});
test('keys pitch packing and explicit hand; drums use distinct kit pieces',()=>{
 const keys=makeArrangement('keys'),n=makeNote(keys,0,60);assert.equal(notePitch(keys,n),60);assert.equal(n.string*24+n.fret,60);
 const drums=makeArrangement('drums'),hit=makeNote(drums,0,0);assert.equal(hit.piece,'kick');assert.equal(hit.velocity,100);
});
test('custom open pitches and nonstandard tuning survive physical string expansion, including high-C bass',()=>{
 for(const [type,count,next]of [['guitar',6,8],['bass',4,6],['bass',5,6]]){const a=makeArrangement(type,count);a.basePitches=a.basePitches.map((p,i)=>p-2+(i===2?1:0));a.tuning=a.tuning.map((_,i)=>i===1?-1:0);a.capo=2;a.notes=Array.from({length:count},(_,s)=>makeNote(a,1,s,3));const before=a.notes.map(n=>notePitch(a,n)),bases=[...a.basePitches];setStringCount(a,next);assert.deepEqual(a.notes.map(n=>notePitch(a,n)),before);for(let i=0;i<count;i++)assert.equal(a.basePitches[a.notes[i].string],bases[i]);if(type==='bass'&&count===5)assert.equal(a.notes[0].string,0)}
});
test('shared current/difficulty note references shift once and optional template fingering stays absent',()=>{const a=makeArrangement(),n=makeNote(a,0,0,3);a.notes=[n];a.difficulties=[{difficulty:0,notes:[n],chords:[]}];a.chord_templates=[{name:'Own shape',frets:[3,5,-1,-1,-1,-1]}];setStringCount(a,7);assert.equal(n.string,1);assert.equal(Object.hasOwn(a.chord_templates[0],'fingers'),false);setStringCount(a,6);assert.equal(n.string,0)});
test('chord creation keeps full string width and removes precisely selected notes',()=>{
 const a=makeArrangement('guitar',8);a.notes=[makeNote(a,0,0,3),makeNote(a,0,7,5),makeNote(a,1,2,4)];
 const c=chordFromSelection(a,a.notes.slice(0,2),'Wide');assert.equal(a.chord_templates[0].frets.length,8);assert.equal(c.notes.length,2);assert.equal(a.notes.length,1);assert.equal(a.handshapes.length,1);
});
test('stock game compatibility reports unsupported instrument/string count without truncating',()=>{
 const p=makeProject();p.arrangements=[makeArrangement('bass',5),makeArrangement('keys'),makeArrangement('drums')];
 assert.equal(validate(p,'cdlc').filter(x=>x.severity==='error').length,3);assert.equal(validate(p,'feedpak').length,0);assert.equal(p.arrangements[0].stringCount,5);
});
test('failed history edit rolls back and imported unknown fields survive normalization',()=>{
 const p=makeProject();p.future={nested:[1,2,3]};const h=new History(p);assert.throws(()=>h.commit('Failed',p=>{p.title='bad';throw Error('no');}));assert.equal(h.project.title,'Untitled');assert.equal(h.undoStack.length,0);assert.deepEqual(normalizeProject(p).future,p.future);
});
test('tempo edits retime inactive difficulties, chord tails, and bend points together',()=>{const p=makeProject(),a=p.arrangements[0];a.notes=[makeNote(a,1,0,3,1)];a.notes[0].techniques.bend_values=[{t:.5,v:1}];a.difficulties=[{difficulty:0,notes:structuredClone(a.notes),chords:[],anchors:[],handshapes:[]}];a.chords=[{time:2,chord_id:0,notes:[makeNote(a,2,0,5,1)]}];setTempo(p,60,{moveNotes:true});assert.equal(a.notes[0].time,2);assert.equal(a.notes[0].techniques.bend_values[0].t,1);assert.equal(a.difficulties[0].notes[0].time,2);assert.equal(a.chords[0].notes[0].time,4);assert.equal(a.chords[0].notes[0].sustain,2);});
test('extending string count preserves chord templates and all authored difficulty voicings',()=>{const a=makeArrangement();a.chord_templates=[{name:'E',frets:[0,2,2,1,0,0],fingers:[-1,2,3,1,-1,-1]}];a.chords=[{time:0,chord_id:0,notes:[makeNote(a,0,0,0)]}];a.difficulties=[{difficulty:0,notes:[makeNote(a,1,0,3)],chords:[]}];setStringCount(a,7);assert.equal(a.chord_templates[0].frets[0],-1);assert.equal(a.chord_templates[0].frets[1],0);assert.equal(a.chords[0].notes[0].string,1);assert.equal(a.difficulties[0].notes[0].string,1);});
test('chord renaming preserves exact children; fingering changes only inherited finger prescriptions',()=>{
 const a=makeArrangement(),n=makeNote(a,1,0,3,0);n.techniques={palm_mute:true,hammer_on:true,bend_values:[{t:0,v:1}]};n._wire={future:'keep'};a.notes=[n,makeNote(a,1,1,5,.731)];chordFromSelection(a,a.notes,'Original');
 const before=structuredClone(a.chords[0].notes),c=a.chord_templates[0];updateChordTemplate(a,0,{...c,name:'Renamed'});assert.deepEqual(a.chords[0].notes,before);
 updateChordTemplate(a,0,{...c,fingers:[1,2,-1,-1,-1,-1]});const expected=structuredClone(before);expected.forEach((n,i)=>n.techniques.left_hand=i+1);assert.deepEqual(a.chords[0].notes,expected);
});
test('imported chord members receive distinct selectable IDs without changing their source wire',()=>{const p=makeProject(),a=p.arrangements[0];a.notes=[{id:'n0',time:0,string:0,fret:3,sustain:0}];a.chords=[{time:2,chord_id:0,notes:[{id:'n0',time:2,string:0,fret:3,_wire:{future:true}},{id:'n1',time:2,string:1,fret:5}]}];const normalized=normalizeProject(p).arrangements[0];assert.equal(new Set([...normalized.notes,...normalized.chords[0].notes].map(n=>n.id)).size,3);assert.deepEqual(normalized.chords[0].notes[0]._wire,{future:true});});
test('importing long backing audio extends the editable beat grid and blank short projects trim it',()=>{const p=makeProject(),long=extendGrid(p.beats,180);assert.equal(long.at(-1).time,180);assert.equal(long.at(-1).measure,91);const short=extendGrid(p.beats,4.1,{trim:true});assert.equal(short.at(-1).time,4);assert.ok(short.length>=2);assert.equal(p.beats.length,121);});
test('loading a source never silently lengthens its declared song duration',()=>{const p=makeProject();p.duration=12;p.arrangements[0].notes=[makeNote(p.arrangements[0],11,0,3,4)];assert.equal(normalizeProject(p).duration,12);assert.ok(validate(normalizeProject(p)).some(issue=>issue.severity==='warning')||normalizeProject(p).arrangements[0].notes[0].sustain===4);});

test('complete project build settings retain user options and initialize imported native volume',()=>{const p=makeProject();p.importedBuildOptions={volume:-9,previewStart:0};assert.deepEqual(normalizeProject(p).cdlcBuildOptions,p.importedBuildOptions);p.cdlcBuildOptions={volume:-11.5,author:'Own author'};assert.deepEqual(normalizeProject(p).cdlcBuildOptions,p.cdlcBuildOptions);p.cdlcBuildOptions=[];assert.throws(()=>normalizeProject(p),/build settings/)});
