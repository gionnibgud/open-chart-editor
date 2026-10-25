import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDifficultyLadder, snapshotDifficulty, switchDifficulty, addDifficulty, removeDifficulty, updatePhraseDifficulties, copyPhraseDifficulty, clearPhraseDifficulty } from '../src/difficulty.js';
function fixture() {
  return { notes: Array.from({length:16},(_,i)=>({id:`n${i}`,time:i/2,string:i%2,fret:3+i%5,sustain:0.25,techniques:{}})), chords:[],anchors:[{time:0,fret:3,width:5}],handshapes:[],chord_templates:[],phrases:[{time:0,name:'A'},{time:4,name:'B'}] };
}

function phraseFixture() {
  const source={difficulty:0,notes:[{id:'old',time:1,string:0,fret:3,sustain:.5,techniques:{}},{id:'copy',time:5,string:0,fret:7,sustain:4,techniques:{vibrato:80},future:{retain:true}}],chords:[{id:'chord',time:6,chord_id:0,notes:[{id:'voice',time:6,string:1,fret:9,sustain:2,techniques:{palm_mute:true}}]}],anchors:[{id:'a0',time:0,fret:3,width:4},{id:'a6',time:6,fret:7,width:5}],handshapes:[{id:'shape-source',chord_id:0,start_time:3,end_time:10,future:'source'}]};
  const target={difficulty:7,notes:[{id:'copy',time:1,string:0,fret:2,sustain:0,techniques:{}},{id:'discard',time:5,string:0,fret:2,sustain:0,techniques:{}},{id:'after',time:9,string:0,fret:4,sustain:0,techniques:{}}],chords:[],anchors:[{id:'a1',time:1,fret:1,width:4},{id:'a5',time:5,fret:2,width:4}],handshapes:[{id:'shape-target',chord_id:0,start_time:2,end_time:10,future:'target'}]};
  return {id:'arr',notes:structuredClone(target.notes),chords:[],anchors:structuredClone(target.anchors),handshapes:structuredClone(target.handshapes),chord_templates:[{name:'Own',frets:[7,9,-1,-1,-1,-1]}],phrases:[{id:'p0',time:0,name:'Before',future:1},{id:'p1',time:4,name:'Selected'},{id:'p2',time:8,name:'After',future:2}],difficulties:[source,target],activeDifficulty:7,_wire:{original:'unchanged'}};
}

test('phrase copy preserves full voices/tails/metadata and isolates other phrases and levels',()=>{
  const arr=phraseFixture(),before=structuredClone(arr);
  const result=copyPhraseDifficulty(arr,{phraseIndex:1,sourceDifficulty:0,targetDifficulty:7,duration:12});
  assert.deepEqual(arr.difficulties[0],before.difficulties[0]);
  assert.deepEqual(arr.chord_templates,before.chord_templates);assert.deepEqual(arr._wire,before._wire);
  assert.deepEqual(arr.phrases[0],before.phrases[0]);assert.deepEqual(arr.phrases[2],before.phrases[2]);
  assert.deepEqual(arr.notes.filter(n=>n.time<4||n.time>=8),before.notes.filter(n=>n.time<4||n.time>=8));
  const copied=arr.notes.find(n=>n.time===5);
  assert.equal(copied.sustain,4);assert.deepEqual(copied.future,{retain:true});assert.equal(copied.techniques.vibrato,80);
  assert.notEqual(copied.id,'copy');assert.equal(new Set(arr.notes.map(n=>n.id)).size,arr.notes.length);
  assert.equal(arr.chords[0].notes[0].techniques.palm_mute,true);
  assert.deepEqual(arr.handshapes.map(h=>[h.start_time,h.end_time,h.future]),[[2,4,'target'],[4,8,'source'],[8,10,'target']]);
  assert.deepEqual(arr.anchors.map(a=>[a.time,a.fret]),[[1,1],[4,3],[6,7],[8,2]]);
  assert.deepEqual(result.copied,{notes:1,chords:1,anchors:2,handshapes:1});
});

test('phrase clear snapshots live edits and preserves boundary anchors/zones and inactive working view',()=>{
  const arr=phraseFixture();arr.notes[0].fret=19;
  clearPhraseDifficulty(arr,{phraseIndex:1,difficulty:7,duration:12});
  assert.deepEqual(arr.notes.map(n=>[n.time,n.fret]),[[1,19],[9,4]]);
  assert.deepEqual(arr.handshapes.map(h=>[h.start_time,h.end_time]),[[2,4],[8,10]]);
  assert.deepEqual(arr.anchors.map(a=>[a.time,a.fret]),[[1,1],[8,2]]);
  const live=structuredClone(arr.notes);
  clearPhraseDifficulty(arr,{phraseIndex:1,difficulty:0,duration:12});
  assert.deepEqual(arr.notes,live);assert.equal(arr.activeDifficulty,7);
  assert.deepEqual(arr.difficulties[0].notes.map(n=>n.time),[1]);
});

test('phrase operations reject invalid targets, boundaries and cross-boundary dependencies atomically',()=>{
  for(const options of [{sourceDifficulty:99,targetDifficulty:7,phraseIndex:1},{sourceDifficulty:0,targetDifficulty:0,phraseIndex:1},{sourceDifficulty:0,targetDifficulty:7,phraseIndex:99},{sourceDifficulty:0,targetDifficulty:7,phraseIndex:1,duration:5}]){
    const arr=phraseFixture(),before=structuredClone(arr);assert.throws(()=>copyPhraseDifficulty(arr,options));assert.deepEqual(arr,before);
  }
  const arr=phraseFixture();arr.difficulties[0].notes[0].techniques.link_next=true;
  const before=structuredClone(arr);assert.throws(()=>copyPhraseDifficulty(arr,{sourceDifficulty:0,targetDifficulty:7,phraseIndex:1,duration:12}),/linked note group/);assert.deepEqual(arr,before);
  arr.phrases[1].time=0;const duplicated=structuredClone(arr);
  assert.throws(()=>clearPhraseDifficulty(arr,{difficulty:7,phraseIndex:1}),/unique/);assert.deepEqual(arr,duplicated);
  const childLink=phraseFixture();childLink.difficulties[0].notes[0].tie_to='voice';const original=structuredClone(childLink);
  assert.throws(()=>copyPhraseDifficulty(childLink,{sourceDifficulty:0,targetDifficulty:7,phraseIndex:1}),/linked note group/);assert.deepEqual(childLink,original);
});

test('phrase copy remaps explicit internal links only when target IDs collide',()=>{
  const arr=phraseFixture();arr.difficulties[0].notes.push({id:'linked',time:6,string:0,fret:8,sustain:.5,tie_to:'copy',techniques:{}});
  copyPhraseDifficulty(arr,{phraseIndex:1,sourceDifficulty:0,targetDifficulty:7,duration:12});
  const inserted=arr.notes.find(n=>n.time===5),linked=arr.notes.find(n=>n.id==='linked');
  assert.notEqual(inserted.id,'copy');assert.equal(linked.tie_to,inserted.id);
  assert.equal(arr.notes.find(n=>n.time===1).id,'copy');
  assert.equal(arr.difficulties[0].notes.find(n=>n.id==='linked').tie_to,'copy');
});
test('generated authored levels nest event sets and preserve complete source records', () => {
  const arrangement=fixture(), source=structuredClone(arrangement);
  const levels=generateDifficultyLadder(arrangement,{levels:4,retainDownbeats:false});
  assert.deepEqual(levels.map(level=>level.notes.length),[4,8,12,16]);
  for(let i=1;i<levels.length;i++)for(const note of levels[i-1].notes)assert.ok(levels[i].notes.some(candidate=>candidate.id===note.id));
  assert.deepEqual(arrangement.notes,source.notes);assert.deepEqual(levels[3].notes,source.notes);
  levels[0].notes[0].fret=24;assert.notEqual(arrangement.notes[0].fret,24);
  const repeat=fixture();generateDifficultyLadder(repeat,{levels:4,retainDownbeats:false});
  assert.deepEqual(levels[1],repeat.difficulties[1]);
});
test('tie chains, bends and full chord voicings remain atomic during thinning', () => {
  const arrangement=fixture();arrangement.notes[0].techniques={link_next:true,bend:2};
  arrangement.notes[0].bendValues=[{time:0,step:0},{time:.2,step:2}];
  arrangement.notes[2].techniques={link_next:true};
  arrangement.chord_templates=[{frets:[3,5,-1,-1,-1,-1]}];
  arrangement.chords=[{id:'c0',time:0,chord_id:0,notes:[{string:0,fret:3,sustain:1,techniques:{link_next:true}},{string:1,fret:5,sustain:1,techniques:{}}]}];
  arrangement.handshapes=[{chord_id:0,start_time:0,end_time:2}];
  const levels=generateDifficultyLadder(arrangement,{levels:4,beats:[{time:0,measure:1}]});
  for(const level of levels){
    assert.ok(level.notes.some(note=>note.id==='n0'));assert.ok(level.notes.some(note=>note.id==='n2'));assert.ok(level.notes.some(note=>note.id==='n4'));
    assert.deepEqual(level.notes.find(note=>note.id==='n0').bendValues,[{time:0,step:0},{time:.2,step:2}]);
    assert.equal(level.chords[0].notes.length,2);assert.equal(level.handshapes.length,1);
  }
  assert.deepEqual(arrangement.chord_templates,[{frets:[3,5,-1,-1,-1,-1]}]);
});
test('arbitrary authored levels snapshot edits and switch independently', () => {
  const arrangement=fixture();generateDifficultyLadder(arrangement,{levels:2});
  addDifficulty(arrangement,{difficulty:7});arrangement.notes[0].fret=19;
  switchDifficulty(arrangement,0);assert.notEqual(arrangement.notes[0].fret,19);
  switchDifficulty(arrangement,7);assert.equal(arrangement.notes[0].fret,19);
  snapshotDifficulty(arrangement);assert.equal(arrangement.difficulties.find(level=>level.difficulty===7).notes[0].fret,19);
  removeDifficulty(arrangement,7);assert.equal(arrangement.activeDifficulty,1);
  assert.throws(()=>switchDifficulty(arrangement,99),/existing/);
});
test('phrase maximum levels reflect actual authored events without renumbering levels', () => {
  const arrangement=fixture();arrangement.difficulties=[{difficulty:0,notes:[{time:0}],chords:[]},{difficulty:9,notes:[{time:5}],chords:[]}];
  updatePhraseDifficulties(arrangement);
  assert.deepEqual(arrangement.phrases.map(phrase=>phrase.maxDifficulty),[0,9]);
  arrangement.activeDifficulty=9;arrangement.notes=[{time:5}];removeDifficulty(arrangement,0);
  assert.equal(arrangement.difficulties[0].difficulty,9);assert.throws(()=>removeDifficulty(arrangement,9),/at least one/);
});
test('long authored link chains remain intact without recursive stack growth', () => {
  const arrangement=fixture();arrangement.notes=Array.from({length:12000},(_,i)=>({id:`t${i}`,time:i*.1,string:0,fret:5,sustain:.1,techniques:{link_next:i<11999}}));
  const levels=generateDifficultyLadder(arrangement,{levels:3,retainDownbeats:false});
  assert.deepEqual(levels.map(level=>level.notes.length),[12000,12000,12000]);
});
