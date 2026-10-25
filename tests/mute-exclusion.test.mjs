// Actual extracted UI handlers + real sparse History/model helpers; no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {History,synchronizeChordVoicings} from '../src/model.js';
import {snapshotDifficulty} from '../src/difficulty.js';
import {techniqueEnabled,setTechniqueFlag} from '../src/technique-tags.js';
import {muteFixture,activeNotes,expectedMute} from './fixtures/mute-exclusion/fixture.mjs';
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const base=read('./fixtures/mute-exclusion/before-main.js'),source=read('../src/main.js');
function handler(text,ids,initial=muteFixture()){
 const lines=text.split(/\r?\n/),extract=prefix=>{const found=lines.filter(line=>line.trim().startsWith(prefix));assert.equal(found.length,1,prefix);return found[0];};
 const selected=[extract('const editableNotes='),extract('const selected='),extract('const change='),extract('function editSelection('),extract('function toggleTechnique(')].join('\n');
 return new Function('initial','ids','History','snapshotDifficulty','synchronizeChordVoicings','techniqueEnabled','setTechniqueFlag',`
  let history=new History(initial),selection=new Set(ids),dirty=false;
  const project=()=>history.project,arrangement=()=>project().arrangements[0],countIn={cancel(){}},audio={setProject(){}},syncProjectAudio=()=>{},render=()=>{},queueDraft=()=>{};
  ${selected}
  return {toggle:toggleTechnique,project,history,selected,select(ids){selection=new Set(ids);}};
 `)(initial,ids,History,snapshotDifficulty,synchronizeChordVoicings,techniqueEnabled,setTechniqueFlag);
}
const note=(project,id)=>activeNotes(project.arrangements[0]).find(note=>note.id===id);

test('saved baseline reproduces PM/FHM contradiction; production actual handler clears the opposite only when enabling',()=>{
 const initial=muteFixture(),before=structuredClone(initial),baseline=handler(base,['own-fhm'],structuredClone(initial));baseline.toggle('palm_mute');
 assert.deepEqual(baseline.project(),expectedMute(initial,['own-fhm'],'palm_mute',true,{excludeOpposite:false}));assert.equal(techniqueEnabled(note(baseline.project(),'own-fhm'),'fret_hand_mute'),true);
 const next=handler(source,['own-fhm'],initial);next.toggle('palm_mute');assert.deepEqual(next.project(),expectedMute(before,['own-fhm'],'palm_mute',true));
});
test('PM enable clears canonical FHM and positive legacy alias; FHM enable clears positive PM without changing frets',()=>{
 for(const [id,key]of [['own-fhm','palm_mute'],['own-pm','fret_hand_mute']]){
  const initial=muteFixture(),before=structuredClone(initial),opaque=initial._pack,h=handler(source,[id],initial);h.toggle(key);
  assert.deepEqual(h.project(),expectedMute(before,[id],key,true));assert.equal(h.history.undoStack.length,1);assert.equal(h.project()._pack,opaque);
  h.history.undo();assert.deepEqual(h.project(),before);assert.equal(h.project()._pack,opaque);h.history.redo();assert.deepEqual(h.project(),expectedMute(before,[id],key,true));
 }
});

test('turning either mute off preserves the other imported contradictory mute and all other fields',()=>{
 for(const key of ['palm_mute','fret_hand_mute']){const initial=muteFixture(),before=structuredClone(initial),h=handler(source,['own-contradictory'],initial);h.toggle(key);assert.deepEqual(h.project(),expectedMute(before,['own-contradictory'],key,false));assert.equal(techniqueEnabled(note(h.project(),'own-contradictory'),key==='palm_mute'?'fret_hand_mute':'palm_mute'),true);}
});

test('positive legacy FHM alias is active; zero/negative native sentinels are inactive and PM enable clears both FHM forms',()=>{
 for(const [canonical,alias]of [[-1,8],[0,3],[-1,-1],[0,0]]){
  const initial=muteFixture(),n=note(initial,'own-fhm');n.techniques.fret_hand_mute=canonical;n.techniques.mute=alias;n.techniques.palm_mute=-1;snapshotDifficulty(initial.arrangements[0]);const before=structuredClone(initial),h=handler(source,['own-fhm'],initial);
  assert.equal(techniqueEnabled(n,'fret_hand_mute'),alias>0);h.toggle('palm_mute');assert.deepEqual(h.project(),expectedMute(before,['own-fhm'],'palm_mute',true));
 }
});

test('mixed selection retains aggregate every policy and performs one atomic Undo/Redo for both notes',()=>{
 const initial=muteFixture(),before=structuredClone(initial),ids=['own-fhm','own-pm'],h=handler(source,ids,initial);h.toggle('palm_mute');const expected=expectedMute(before,ids,'palm_mute',true);assert.deepEqual(h.project(),expected);
 assert.equal(h.history.undoStack.length,1);assert.ok(ids.every(id=>techniqueEnabled(note(h.project(),id),'palm_mute')));h.history.undo();assert.deepEqual(h.project(),before);h.history.redo();assert.deepEqual(h.project(),expected);
 h.toggle('palm_mute');assert.deepEqual(h.project(),expectedMute(expected,ids,'palm_mute',false));
});

test('partial chord-child selection changes only selected child and active DD mirror; sibling/template/source remain exact',()=>{
 const initial=muteFixture(),before=structuredClone(initial),h=handler(source,['own-child-b'],initial);h.toggle('fret_hand_mute');const expected=expectedMute(before,['own-child-b'],'fret_hand_mute',true);assert.deepEqual(h.project(),expected);assert.equal(h.history.undoStack.length,1);h.history.undo();assert.deepEqual(h.project(),before);h.history.redo();assert.deepEqual(h.project(),expected);
});

test('empty selection retains existing guard and creates no history state or model mutation',()=>{
 const initial=muteFixture(),before=structuredClone(initial),h=handler(source,[],initial);assert.throws(()=>h.toggle('palm_mute'),/Select one or more notes first/);assert.deepEqual(h.project(),before);assert.equal(h.history.undoStack.length,0);assert.equal(h.history.stateId,0);
});

test('imported contradictions remain unchanged until a mute command; other techniques retain prior behavior',()=>{
 const initial=muteFixture(),before=structuredClone(initial),h=handler(source,['own-contradictory'],initial);assert.deepEqual(h.project(),before);
 h.toggle('accent');assert.deepEqual(h.project(),expectedMute(before,['own-contradictory'],'accent',true));assert.ok(techniqueEnabled(note(h.project(),'own-contradictory'),'palm_mute')&&techniqueEnabled(note(h.project(),'own-contradictory'),'fret_hand_mute'));
 h.history.undo();assert.deepEqual(h.project(),before);h.toggle('vibrato');assert.deepEqual(h.project(),expectedMute(before,['own-contradictory'],'vibrato',true));h.toggle('vibrato');assert.deepEqual(h.project(),expectedMute(expectedMute(before,['own-contradictory'],'vibrato',true),['own-contradictory'],'vibrato',false));
});
