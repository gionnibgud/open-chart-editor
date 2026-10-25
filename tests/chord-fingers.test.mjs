import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {makeProject,makeNote,updateChordTemplate,History} from '../src/model.js';

const newFingers=[0,2,-1,-1,-1,-1];
function fixture(){
 const p=makeProject(),a=p.arrangements[0];p.title='Own inherited chord finger regression';a.id='own-part';a.notes=[];a.anchors=[{time:0,fret:1,width:5}];a.handshapes=[];
 a.chord_templates=[{name:'Own',displayName:'Own',frets:[3,5,-1,-1,-1,-1],fingers:[1,3,-1,-1,-1,-1],opaque:{source:[{own:true}]}}];
 const chord=(id,time,finger)=>({id,time,chord_id:0,opaque:{own:id},notes:[0,1].map(string=>({...makeNote(a,time,string,[3,5][string],.5),id:id+'-'+string,techniques:{accent:true,...(finger===undefined&&string===0?{}:{left_hand:string===0?finger:3})},_wire:{fg:string===0?1:3,own:{source:id}},_xml:`<chordNote string="${string}" own="${id}"/>`,opaque:{own:[id,string]}}))});
 a.chords=[chord('inherited',1,1),chord('override',2,4),chord('clear',3,-1),chord('absent',4,undefined)];
 a.activeDifficulty=4;a.difficulties=[{difficulty:0,notes:[],chords:[chord('hidden-inherited',5,1)],anchors:structuredClone(a.anchors),handshapes:[],opaque:{original:true}},{difficulty:2,notes:[],chords:[chord('hidden-override',6,4)],anchors:structuredClone(a.anchors),handshapes:[]},{difficulty:4,notes:[],chords:structuredClone(a.chords),anchors:structuredClone(a.anchors),handshapes:[]}];return p;
}
function update(a,fingers=newFingers,frets=a.chord_templates[0].frets){updateChordTemplate(a,0,{name:'Own',displayName:'Own',frets:structuredClone(frets),fingers:structuredClone(fingers)});}
const values=content=>content.chords.map(c=>c.notes.map(n=>n.techniques.left_hand));
test('template changes synchronize inherited/absent child fingers and preserve genuine overrides across every DD level',()=>{
 const p=fixture(),a=p.arrangements[0];update(a);assert.deepEqual(values(a),[[0,2],[4,2],[-1,2],[0,2]]);assert.deepEqual(values(a.difficulties[0]),[[0,2]]);assert.deepEqual(values(a.difficulties[1]),[[4,2]]);assert.deepEqual(values(a.difficulties[2]),values(a));
});
test('clearing a template finger propagates unset while explicit different voices remain prescribed',()=>{
 const a=fixture().arrangements[0];update(a,[-1,-1,-1,-1,-1,-1]);assert.deepEqual(values(a),[[-1,-1],[4,-1],[-1,-1],[-1,-1]]);
});
test('renaming a template without changing its fingers leaves every child byte unchanged',()=>{
 const a=fixture().arrangements[0],before=structuredClone(a);updateChordTemplate(a,0,{name:'Own renamed',displayName:'Own display',frets:structuredClone(a.chord_templates[0].frets),fingers:structuredClone(a.chord_templates[0].fingers)});assert.deepEqual(a.chords,before.chords);assert.deepEqual(a.difficulties,before.difficulties);
});
test('new template voices receive fingers while existing source metadata and independent templates remain exact',()=>{
 const a=fixture().arrangements[0],before=structuredClone(a);a.chord_templates.push({name:'Unrelated',frets:[1,1,-1,-1,-1,-1],fingers:[1,1,-1,-1,-1,-1]});const unrelated={time:7,chord_id:1,notes:[makeNote(a,7,0,1,.3),makeNote(a,7,1,1,.3)]};a.chords.push(unrelated);const sourceOther=structuredClone(unrelated);
 update(a,[0,2,4,-1,-1,-1],[3,5,7,-1,-1,-1]);assert.deepEqual(a.chords[0].notes.map(n=>n.techniques.left_hand),[0,2,4]);assert.deepEqual(a.chords[0].notes[0]._wire,before.chords[0].notes[0]._wire);assert.deepEqual(a.chords[0].notes[0].opaque,before.chords[0].notes[0].opaque);assert.equal(a.chords[0].notes[0]._xml,before.chords[0].notes[0]._xml);assert.equal(a.chords[0].notes[0].sustain,.5);assert.equal(a.chords[0].notes[0].techniques.accent,true);assert.deepEqual(a.chord_templates[0].opaque,before.chord_templates[0].opaque);assert.deepEqual(unrelated,sourceOther);
});
test('invalid requests or malformed later source level cannot leave a partial template/current-level update',()=>{
 for(const invalid of [[0,2],[0,2,-1,-1,-1,5]]){const a=fixture().arrangements[0],before=structuredClone(a);assert.throws(()=>update(a,invalid));assert.deepEqual(a,before);}
 const a=fixture().arrangements[0];a.difficulties[1].chords[0].notes={malformed:true};const before=structuredClone(a);assert.throws(()=>update(a));assert.deepEqual(a,before);
});
test('template/child changes form one reversible History operation with all opaque and hidden-level data intact',()=>{
 const p=fixture(),before=structuredClone(p),h=new History(p);h.commit('Change inherited chord fingers',p=>update(p.arrangements[0]));const after=structuredClone(h.project);assert.notDeepEqual(after,before);h.undo();assert.deepEqual(h.project,before);h.redo();assert.deepEqual(h.project,after);
});
test('real stock XML writes new inherited fingers in template and current/hidden child records, retaining explicit overrides',()=>{
 const p=fixture();update(p.arrangements[0]);const result=JSON.parse(execFileSync(process.env.OCE_PYTHON||'python',['-c',`import json,sys,xml.etree.ElementTree as E
from pack_io import save_xml
p=json.load(sys.stdin);r=E.fromstring(save_xml(p,p['arrangements'][0]['id']))
print(json.dumps({'template':[int(r.find('./chordTemplates/chordTemplate').get('finger'+str(i),-1)) for i in range(6)],'levels':{l.get('difficulty'):[[int(n.get('leftHand',-1)) for n in c.findall('chordNote')] for c in l.findall('./chords/chord')] for l in r.findall('./levels/level')}}))`],{cwd:new URL('..',import.meta.url),input:JSON.stringify(p),encoding:'utf8',timeout:30000}));
 assert.deepEqual(result.template,newFingers);assert.deepEqual(result.levels['0'],[[0,2]]);assert.deepEqual(result.levels['2'],[[4,2]]);assert.deepEqual(result.levels['4'],[[0,2],[4,2],[-1,2],[0,2]]);
});
