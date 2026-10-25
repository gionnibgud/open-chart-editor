// Production original adaptive graph integration tests. Mock nodes; no browser/hardware.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {TonePreview,toneAuditionPlan,registerGearCatalog,createTone,setGear} from '../src/tone-rack.js';
import {ToneEffectRack} from '../src/tone-effects.js';
import {prepareToneEnvelope,toneEnvelopeStatus} from '../src/tone-adaptive-rack.js';
import {adaptiveRetirementStatus} from '../src/tone-retirement.js';
registerGearCatalog(JSON.parse(await readFile(new URL('../assets/tone-rack-data.json',import.meta.url),'utf8')).gears);
class Node {
 constructor(){this.connections=[];this.gain={value:1};this.frequency={value:0};this.Q={value:0};this.delayTime={value:0};}
 connect(node){this.connections.push(node);return node;}
 disconnect(){this.connections=[];}
 start(){this.started=true;}
 stop(){this.stopped=true;}
}
function fake(){const nodes=[],calls=[];return{sampleRate:48000,currentTime:0,state:'running',destination:new Node(),nodes,calls,audioWorklet:{async addModule(url){calls.push(url);}},...Object.fromEntries(['createGain','createBiquadFilter','createWaveShaper','createOscillator','createDelay','createChannelSplitter','createChannelMerger'].map(name=>[name,()=>{const node=new Node();nodes.push(node);return node;}]))};}
class Worklet extends Node {
 constructor(context,id,options){super();if(context.failConstruction)throw Error('own construction failure');this.id=id;this.options=options;this.parameters=new Map([['run',{setValueAtTime(){}}]]);this.port={postMessage:data=>{if(data.type==='stop')queueMicrotask(()=>this.port.onmessage?.({data:{type:'stopped',frames:128}}));},close:()=>{this.portClosed=true;}};context.nodes.push(this);}
}
const originalWorklet=globalThis.AudioWorkletNode;globalThis.AudioWorkletNode=Worklet;
test.after(()=>{globalThis.AudioWorkletNode=originalWorklet;});
const ownTone=()=>{const tone=createTone('Own adaptive');setGear(tone,'PrePedal1','Pedal_NoiseGate');setGear(tone,'PostPedal1','Pedal_AnalogueDelay');return tone;};

test('actual pending/ready cache transition creates one owned processor; native tone and volume-only graph stay exact',async()=>{
 const context=fake(),tone=ownTone(),before=JSON.stringify(tone),preview=new TonePreview(context);
 preview.setTone(tone);assert.equal(preview.preEffects,null);assert.ok(preview.getDisclosures().some(d=>d.slot==='PrePedal1'&&d.kind==='pending'));const pendingDrive=preview.drive.curve;
 await prepareToneEnvelope(context);preview.setTone(tone);assert.notEqual(preview.drive.curve,pendingDrive);const child=preview.preEffects.childRacks[0];assert.equal(child.processor.id,'oce-adaptive-v1');assert.equal(child.nodeCount,3);
 const drive=preview.drive.curve;tone.volume=-3;preview.setTone(tone);assert.equal(preview.preEffects.childRacks[0],child);assert.equal(preview.drive.curve,drive);assert.ok(Math.abs(preview.output.gain.value-10**(-3/20))<1e-12);tone.volume=-12;assert.equal(JSON.stringify(tone),before);
 preview.dispose();await child.retired;assert.equal(adaptiveRetirementStatus(context).pending,0);assert.equal(adaptiveRetirementStatus(context).acknowledged,1);
});
test('processor failure retains live slot disclosure, preserves working delay and does not rebuild failed gear on forced UI render',async()=>{
 const context=fake(),tone=ownTone(),events=[];await prepareToneEnvelope(context);const preview=new TonePreview(context,{onStatus:event=>events.push(event)});preview.setTone(tone);
 const child=preview.preEffects.childRacks[0],disclosure=preview.getDisclosures().find(d=>d.slot==='PrePedal1'),delay=preview.postEffects,processor=child.processor;
 processor.onprocessorerror();assert.equal(disclosure.kind,'bypassed');assert.equal(child.bypassed,true);assert.equal(preview.postEffects,delay);assert.equal(events[0].slot,'PrePedal1');assert.equal(events[0].preview,preview);
 preview.setTone(tone);assert.equal(preview.preEffects.childRacks[0],child);assert.equal(preview.getDisclosures().find(d=>d.slot==='PrePedal1'),disclosure);
 const pure=toneAuditionPlan(tone,{adaptiveStatus:toneEnvelopeStatus(context),actualDisclosures:preview.getDisclosures()});assert.equal(pure.disclosures.find(d=>d.slot==='PrePedal1').kind,'bypassed');
 await child.retired;preview.dispose();assert.equal(adaptiveRetirementStatus(context).unresolved,0);
});
test('worklet module or construction failure bypasses only adaptive gear and preserves native definitions and delay',async()=>{
 for(const failure of ['module','construction']){const context=fake(),tone=ownTone(),before=JSON.stringify(tone);if(failure==='module'){context.audioWorklet.addModule=async()=>{throw Error('own load failure');};await assert.rejects(prepareToneEnvelope(context));}else{await prepareToneEnvelope(context);context.failConstruction=true;}
  const preview=new TonePreview(context);assert.doesNotThrow(()=>preview.setTone(tone));assert.ok(preview.postEffects.stages.some(s=>s.kind==='delay'));assert.ok(preview.getDisclosures().some(d=>d.slot==='PrePedal1'&&d.kind==='bypassed'));assert.equal(JSON.stringify(tone),before);preview.dispose();
 }
});
test('factory failure routes transparent stage and parent counts/disposes each child exactly once',()=>{
 const context=fake();let count=0;const child={input:new Node(),output:new Node(),nodes:[new Node(),new Node()],nodeCount:2,disclosures:[{slot:'Rack1',kind:'approximate'}],dispose(){count++;}};
 const rack=new ToneEffectRack(context,{effects:[{slot:'PrePedal1',key:'own',kind:'adaptive',processor:{}},{slot:'Rack1',kind:'modulation',modulation:{}}]},{createAdaptiveRack(){throw Error('own gear failure');},createModulationRack(){return child;}});
 assert.equal(rack.stages.length,2);assert.deepEqual(rack.stages[0].input.connections,[rack.stages[0].output]);assert.equal(rack.nodeCount,rack.nodes.length+2);assert.equal(rack.disclosures[0].kind,'bypassed');rack.dispose();rack.dispose();assert.equal(count,1);assert.equal(rack.nodeCount,0);
});
test('pure adaptive control disclosures use factual labels and Auto OFF preserves manual wah',()=>{
 const tone=createTone('Own');setGear(tone,'PrePedal1','Pedal_UKWah');tone.GearList.PrePedal1.KnobValues.Pedal_UKWah_Auto=0;const before=JSON.stringify(tone),manual=toneAuditionPlan(tone,{adaptiveStatus:{state:'ready'}});assert.equal(manual.effects[0].kind,'filter');
 const key='Pedal_UKWah_Auto';tone.GearList.PrePedal1.KnobValues[key]=1;const pending=toneAuditionPlan(tone);assert.equal(pending.effects.length,0);assert.equal(pending.disclosures.find(d=>d.slot==='PrePedal1').kind,'pending');assert.ok(pending.disclosures.find(d=>d.slot==='PrePedal1').usedControls.every(label=>!label.startsWith('Pedal_')));
 tone.GearList.PrePedal1.KnobValues[key]=0;assert.equal(JSON.stringify(tone),before);
});
