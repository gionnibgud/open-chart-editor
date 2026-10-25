import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {execFileSync} from 'node:child_process';
import {makeProject,makeArrangement,makeNote,History} from '../src/model.js';
import {findChartIssues} from '../src/validation.js';
import {guideNotes} from '../src/guide-synthesis.js';
import {planAnchorCoverage,applyAnchorCoverage} from '../src/anchor-fit-candidate.js';
function fixture(){const p=makeProject(),a=p.arrangements[0];p.duration=8;a.anchors=[{id:'own-anchor',time:0,fret:1,width:4,opaque:{source:[1,2]}}];a.phrases=[{time:0,name:'Own A'},{time:3,name:'Own B'}];a.notes=[makeNote(a,1,0,3,.5),makeNote(a,4,1,12,.7)];a.chord_templates=[{name:'Own',frets:[5,7,-1,-1,-1,-1],fingers:[1,3,-1,-1,-1,-1]}];a.chords=[{time:2,chord_id:0,notes:[{...makeNote(a,2,0,5,.8),techniques:{left_hand:0},opaque:{own:'thumb'}},makeNote(a,2,1,7,.5)]}];a.activeDifficulty=4;a.difficulties=[{difficulty:0,notes:[makeNote(a,.5,0,18,.2)],chords:[],anchors:[{time:0,fret:18,width:4}],handshapes:[],opaque:{source:'hidden'}},{difficulty:4,notes:structuredClone(a.notes),chords:structuredClone(a.chords),anchors:structuredClone(a.anchors),handshapes:[]}];return p;}
test('reproduces existing uncovered attacks/phrase starts and repairs only current visible anchors',()=>{
 const p=fixture(),a=p.arrangements[0],before=structuredClone(a);assert.ok(findChartIssues(p).some(i=>i.code==='note.anchor'));assert.ok(findChartIssues(p).some(i=>i.code==='phrase.anchor'));
 const preview=planAnchorCoverage(a,{duration:p.duration});assert.deepEqual(a,before);assert.equal(preview.additions.length,3);assert.equal(preview.conflicts.length,0);const repaired=applyAnchorCoverage(a,preview,{duration:8}),result={...p,arrangements:[{...repaired,difficulties:[]}]};assert.equal(findChartIssues(result).filter(i=>['note.anchor','phrase.anchor'].includes(i.code)).length,0);assert.deepEqual({...repaired,anchors:before.anchors},before);assert.deepEqual(a,before);assert.equal(repaired.difficulties,a.difficulties);assert.deepEqual(repaired.anchors[0],a.anchors[0]);
});
test('repairs coincident authored anchor fields while retaining all opaque attributes and independent source',()=>{
 const a=fixture().arrangements[0];a.anchors.push({id:'own-bad-position',time:2,fret:1,width:4,_xml:'<anchor own="retained"/>',opaque:{source:['keep']}});const source=structuredClone(a),preview=planAnchorCoverage(a,{duration:8}),repaired=applyAnchorCoverage(a,preview,{duration:8});assert.equal(preview.changes.length,1);assert.deepEqual(repaired.anchors.find(x=>x.time===2),{...source.anchors[1],fret:5});assert.deepEqual(a,source);
});
test('simultaneous independent/chord voices share one bounded window; impossible selected span blocks the whole plan',()=>{
 const a=fixture().arrangements[0];a.notes.push(makeNote(a,2,2,14,.2));const before=structuredClone(a),preview=planAnchorCoverage(a,{duration:8});assert.equal(preview.conflicts.length,1);assert.equal(preview.conflicts[0].requiredWidth,10);assert.equal(preview.canApply,false);assert.throws(()=>applyAnchorCoverage(a,preview,{duration:8}),/conflicts/);assert.deepEqual(a,before);const broad=planAnchorCoverage(a,{duration:8,maxWidth:10});assert.equal(broad.conflicts.length,0);assert.equal(applyAnchorCoverage(a,broad,{duration:8}).anchors.find(x=>x.time===2).width,10);
});
test('existing explicitly wide covered positions stay exact even when proposed new widths are narrower',()=>{
 const a=fixture().arrangements[0];a.anchors=[{time:0,fret:1,width:16,opaque:{keep:true}},{time:3,fret:1,width:16}];const before=structuredClone(a),preview=planAnchorCoverage(a,{duration:8});assert.equal(preview.changes.length,0);assert.equal(preview.additions.length,0);assert.equal(applyAnchorCoverage(a,preview,{duration:8}),a);assert.deepEqual(a,before);
});
test('implicit template chords, eight strings, thumb and open strings use canonical frets without musical changes',()=>{
 const a=makeArrangement('guitar',8);a.capo=2;a.notes=[{...makeNote(a,.5,7,0,.2),techniques:{left_hand:0}}];a.chord_templates=[{name:'Own wide strings',frets:[4,-1,-1,-1,-1,-1,-1,6],fingers:[0,-1,-1,-1,-1,-1,-1,3]}];a.chords=[{time:1,chord_id:0}];a.anchors=[];a.phrases=[];const before=structuredClone(a),preview=planAnchorCoverage(a,{duration:2}),result=applyAnchorCoverage(a,preview,{duration:2});assert.deepEqual(result.anchors,[{time:1,fret:4,width:4}]);assert.deepEqual({...result,anchors:before.anchors},before);
});
test('invalid coordinates/duplicate markers reject atomically and immutable previews reject stale or foreign application',()=>{
 const a=fixture().arrangements[0],preview=planAnchorCoverage(a,{duration:8});assert.throws(()=>applyAnchorCoverage(a,preview,{duration:9}),/duration changed/);assert.throws(()=>applyAnchorCoverage(a,preview),/duration changed/);assert.ok(Object.isFrozen(preview));assert.ok(Object.isFrozen(preview.additions));assert.throws(()=>preview.additions.push({}),TypeError);assert.throws(()=>applyAnchorCoverage(a,structuredClone(preview),{duration:8}),/original/);a.notes[0].fret=4;assert.throws(()=>applyAnchorCoverage(a,preview,{duration:8}),/changed/);
 for(const alter of [a=>a.anchors.push({...a.anchors[0]}),a=>a.notes[0].fret=25,a=>{a.capo=2;a.notes[0].fret=23;},a=>a.notes[0].time=Infinity]){const source=fixture().arrangements[0];alter(source);const before=structuredClone(source);assert.throws(()=>planAnchorCoverage(source,{duration:8}));assert.deepEqual(source,before);}
});
test('phrase markers on open-only/capo24 parts get valid relative positions without inventing fretted notes',()=>{
 const a=makeArrangement();a.capo=24;a.notes=[makeNote(a,1,0,0,.2)];a.anchors=[];a.phrases=[{time:0,name:'Own open phrase'}];const p=planAnchorCoverage(a,{duration:2}),r=applyAnchorCoverage(a,p,{duration:2});assert.deepEqual(r.anchors,[{time:0,fret:0,width:4}]);assert.deepEqual(r.notes,a.notes);
});
test('one History operation reverses only visible anchors, retaining hidden DD and opaque source exactly',()=>{
 const p=fixture(),before=structuredClone(p),h=new History(p),preview=planAnchorCoverage(p.arrangements[0],{duration:p.duration});h.commit('Repair own coverage',p=>p.arrangements[0]=applyAnchorCoverage(p.arrangements[0],preview,{duration:p.duration}));const after=structuredClone(h.project);assert.deepEqual(after.arrangements[0].difficulties,before.arrangements[0].difficulties);h.undo();assert.deepEqual(h.project,before);h.redo();assert.deepEqual(h.project,after);
});
test('real native XML converts generated relative anchors through capo exactly once',()=>{
 const p=fixture(),a=p.arrangements[0];a.capo=2;const repaired=applyAnchorCoverage(a,planAnchorCoverage(a,{duration:8}),{duration:8});p.arrangements[0]=repaired;const rows=JSON.parse(execFileSync('python',['-c',`import json,sys,xml.etree.ElementTree as E
from pack_io import save_xml
p=json.load(sys.stdin);r=E.fromstring(save_xml(p,p['arrangements'][0]['id']))
print(json.dumps([[float(x.get('time')),int(x.get('fret')),int(x.get('width'))] for x in r.findall('./levels/level[@difficulty="4"]/anchors/anchor')]))`],{cwd:new URL('..',import.meta.url),input:JSON.stringify(p),encoding:'utf8',timeout:30000}));assert.deepEqual(rows,repaired.anchors.map(x=>[x.time,x.fret+2,x.width]));
});
test('100000 attacks use sorted onset groups rather than repeated full-chart scans',t=>{
 const a=makeArrangement();a.anchors=[];a.phrases=[];a.notes=Array.from({length:100000},(_,i)=>makeNote(a,i/10,i%6,1+i%20,.05));const start=performance.now(),preview=planAnchorCoverage(a,{duration:10001}),result=applyAnchorCoverage(a,preview,{duration:10001}),elapsedMs=performance.now()-start;assert.equal(preview.counts.voices,100000);assert.equal(preview.conflicts.length,0);assert.equal(result.notes,a.notes);assert.ok(result.anchors.length>1000);assert.ok(elapsedMs<10000,'Bounded fitting should finish without quadratic scans');t.diagnostic(JSON.stringify({attacks:100000,anchors:result.anchors.length,elapsedMs}));
});
test('stale child times stay untouched while anchor placement follows the actual guide/parent attack and native XML constraints',()=>{
 const p=fixture(),a=p.arrangements[0],child=a.chords[0].notes[0];child.time=6;const original=structuredClone(a),preview=planAnchorCoverage(a,{duration:8});assert.equal(guideNotes(a).find(n=>n.id===child.id).time,2);assert.equal(preview.counts.childTimeWarnings,1);assert.equal(preview.warnings[0].code,'anchor.childTime');assert.ok(preview.additions.some(x=>x.time===2));assert.equal(preview.additions.some(x=>x.time===6),false);p.arrangements[0]=applyAnchorCoverage(a,preview,{duration:8});assert.deepEqual(a,original);assert.equal(p.arrangements[0].chords[0].notes[0].time,6);
 const native=JSON.parse(execFileSync('python',['-c',`import json,sys,xml.etree.ElementTree as E
from pack_io import save_xml,ProjectError
p=json.load(sys.stdin)
try:
 save_xml(p,p['arrangements'][0]['id']);error=None
except ProjectError as e:error=str(e)
for chord in p['arrangements'][0]['chords']:
 for child in chord['notes']:child.pop('time',None)
r=E.fromstring(save_xml(p,p['arrangements'][0]['id']));level=r.find('./levels/level[@difficulty="4"]')
print(json.dumps({'staleError':error,'chordAttacks':[float(c.get('time')) for c in level.findall('./chords/chord')],'independentChildTimes':[n.get('time') for n in level.findall('./chords/chord/chordNote')],'anchorTimes':[float(x.get('time')) for x in level.findall('./anchors/anchor')]}))`],{cwd:new URL('..',import.meta.url),input:JSON.stringify(p),encoding:'utf8',timeout:30000}));assert.match(native.staleError,/time must equal its chord attack/);assert.deepEqual(native.chordAttacks,[2]);assert.deepEqual(native.independentChildTimes,[null,null]);assert.ok(native.anchorTimes.includes(2));assert.equal(native.anchorTimes.includes(6),false);
});
test('different simultaneous frets on one string block repair even within a covered width',()=>{
 const a=fixture().arrangements[0];a.anchors=[{time:0,fret:1,width:24}];a.notes.push(makeNote(a,2,0,6,.1));const before=structuredClone(a),preview=planAnchorCoverage(a,{duration:8});assert.equal(preview.conflicts.length,1);assert.equal(preview.conflicts[0].code,'anchor.ambiguousString');assert.deepEqual(preview.conflicts[0].strings,[0]);assert.throws(()=>applyAnchorCoverage(a,preview,{duration:8}),/conflicts/);assert.deepEqual(a,before);
});
test('generated additions cannot exceed the total anchor budget and rejection leaves the complete source exact',()=>{
 const a=makeArrangement();a.anchors=Array.from({length:200000},(_,time)=>({time,fret:1,width:4}));a.notes=[makeNote(a,199999.5,0,10,.1)];a.phrases=[];const before=JSON.stringify(a);assert.throws(()=>planAnchorCoverage(a,{duration:200001}),/200,000-anchor budget/);assert.equal(JSON.stringify(a),before);
});
