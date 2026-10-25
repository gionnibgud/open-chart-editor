import test from 'node:test';
import assert from 'node:assert/strict';
import {makeProject,makeArrangement,makeNote} from '../src/model.js';
import {renderGuide} from '../src/render-guide.js';
import {practiceDTO,PracticeRenderer} from '../src/render-controller.js';

function ownMixedProject(){
 const project=makeProject();project.duration=.25;project.arrangements=[];
 for(const type of ['guitar','bass'])for(const count of [4,5,6,7,8]){const part=makeArrangement(type,count);part.notes=[makeNote(part,0,0,3,.15)];part.notes[0].velocity=10;project.arrangements.push(part);}
 const keys=makeArrangement('keys');keys.notes=[makeNote(keys,0,60,0,.15)];keys.notes[0].velocity=10;project.arrangements.push(keys);
 const drums=makeArrangement('drums');drums.notes=[makeNote(drums,0,1)];drums.notes[0].velocity=10;project.arrangements.push(drums);
 project._pack={entries:{'notation/own.json':'b3duIHNvdXJjZQ=='},manifest:{own:'retained'}};
 return project;
}
function retained(){return{id:'own-score',name:'Own retained violin',type:'notation',instrument:'violin',_notationOnly:true,readOnly:true,_entry:{id:'own-score',name:'Own retained violin',type:'violin',notation:'notation/own.json'},future:{opaque:['own',0,false]}};}
function samples(wav){const bytes=new Uint8Array(wav),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);return Array.from({length:(bytes.byteLength-44)/2},(_,i)=>view.getInt16(44+i*2,true));}

test('adding one retained score cannot change any PCM sample or active-part gain in a twelve-part mixed practice render',()=>{
 const original=ownMixedProject(),withScore=structuredClone(original);withScore.arrangements.splice(3,0,retained());const before=JSON.stringify(withScore),baseDTO=practiceDTO(original),withDTO=practiceDTO(withScore);
 // Twelve active parts place the existing mix-gain rule below its0.15 cap;
 // an incorrectly counted thirteenth silent part measurably changes gain.
 assert.equal(baseDTO.arrangements.length,12);assert.deepEqual(withDTO,baseDTO);
 const baseline=renderGuide(original,{sampleRate:8000}),annotated=renderGuide(withScore,{sampleRate:8000}),worker=renderGuide(withDTO,{sampleRate:8000});
 assert.ok(samples(baseline).some(value=>Math.abs(value)>20),'Own chart actually synthesizes audible nonzero PCM');assert.deepEqual(annotated,baseline);assert.deepEqual(worker,baseline);assert.equal(JSON.stringify(withScore),before);
});

test('both explicit readOnly and notation-only flags exclude source rows from direct rendering and worker DTOs',()=>{
 const baseline=ownMixedProject(),reference=renderGuide(baseline,{sampleRate:8000});
 for(const extra of [{...retained(),readOnly:false},{...makeArrangement('keys'),readOnly:true,notes:[{time:0,pitch:96,string:4,fret:0,sustain:.2,velocity:127,techniques:{}}]}]){
  const project=structuredClone(baseline);project.arrangements.push(extra);const before=JSON.stringify(project);assert.deepEqual(practiceDTO(project),practiceDTO(baseline));assert.deepEqual(renderGuide(project,{sampleRate:8000}),reference);assert.equal(JSON.stringify(project),before);
 }
});

test('annotation-only projects remain source-exact and render silent PCM without fabricating an instrument',()=>{
 const project=ownMixedProject();project.arrangements=[retained()];const before=JSON.stringify(project),dto=practiceDTO(project);assert.deepEqual(dto.arrangements,[]);const raw=renderGuide(project,{sampleRate:8000}),worker=renderGuide(dto,{sampleRate:8000});assert.ok(samples(raw).every(value=>value===0));assert.deepEqual(raw,worker);assert.equal(JSON.stringify(project),before);
});

test('actual PracticeRenderer posts only active synthesis inputs; retained source and its metadata stay on editor thread',async()=>{
 let worker;const renderer=new PracticeRenderer({workerFactory:()=>worker={postMessage(message){this.message=message;},terminate(){this.terminated=true;}}}),project=ownMixedProject();project.arrangements.push(retained());const before=JSON.stringify(project),pending=renderer.render(project,{sampleRate:8000});
 assert.deepEqual(worker.message.project,practiceDTO(ownMixedProject()));assert.equal(JSON.stringify(worker.message).includes('own-score'),false);assert.equal(JSON.stringify(worker.message).includes('opaque'),false);const bytes=renderGuide(worker.message.project,worker.message.options);worker.onmessage({data:{type:'result',bytes}});assert.deepEqual(await pending,renderGuide(project,{sampleRate:8000}));assert.equal(worker.terminated,true);assert.equal(JSON.stringify(project),before);renderer.dispose();
});
