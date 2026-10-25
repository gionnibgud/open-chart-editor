import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {EnvelopeProcessor,compileEnvelopeGear} from '../src/tone-envelope.js';
const catalog=JSON.parse(await readFile(new URL('../assets/tone-rack-data.json',import.meta.url),'utf8')).gears;
const gate={kind:'gate',thresholdDb:-50,attack:.001,release:.02,hysteresisDb:2,hold:.02};
const filter={kind:'filter',mode:'lowpass',attack:.001,release:.1,sensitivity:1,minHz:1000,maxHz:1000,mix:1};
const signal=(hz,n=4096,amplitude=.1)=>Float32Array.from({length:n},(_,i)=>amplitude*Math.sin(2*Math.PI*hz*i/48000));
const rms=a=>Math.sqrt(a.reduce((n,v)=>n+v*v,0)/a.length);
function run(p,inputs){const out=inputs.map(a=>new Float32Array(a.length));p.process(inputs,out);return out;}
function ownGear(key){const d=catalog.find(d=>d.key===key);return[d,{Key:key,KnobValues:Object.fromEntries(d.knobs.map(k=>[k.key,k.choices?k.min:(k.min+k.max)/2]))}];}
test('factual native gate/filter controls and all five Auto wah modes compile without source mutation',()=>{
 for(const key of ['Pedal_NoiseGate','Bass_Pedal_BassAutoFilter','Pedal_AutoFilter','Pedal_BobFilter','Rack_SynthFilter','Bass_Pedal_BassWah','Pedal_ModernWah','Pedal_UKWah','Pedal_USWah','Rack_StudioWahFilter']){
  const[d,gear]=ownGear(key);if(key.includes('Wah'))gear.KnobValues[key+'_Auto']=1;const before=structuredClone(gear),result=compileEnvelopeGear(gear,d);assert.ok(result.effect,key);assert.deepEqual(gear,before);assert.ok(result.disclosure.originalDesign.length);new EnvelopeProcessor(result.effect);
 }
 const[d,gear]=ownGear('Pedal_AutoFilter');gear.KnobValues.Pedal_AutoFilter_Attack=NaN;assert.equal(compileEnvelopeGear(gear,d).effect,null);
});
test('gate attenuates quiet input, opens for loud input, and closes after envelope/hold/release',()=>{
 const p=new EnvelopeProcessor(gate,{channels:1});const quiet=new Float32Array(4096).fill(.00005);assert.equal(rms(run(p,[quiet])[0]),0);
 const loud=signal(440);const out=run(p,[loud])[0];assert.ok(rms(out.slice(2048))>.06);assert.deepEqual(loud,signal(440));
 for(let i=0;i<12;i++)run(p,[new Float32Array(4096)]);assert.ok(p.gain<1e-6);assert.equal(p.open,false);
});
test('detector links stereo and preserves exact anti-phase, including weak right-channel content',()=>{
 const x=signal(440),negative=Float32Array.from(x,v=>-v),p=new EnvelopeProcessor(gate);const out=run(p,[x,negative]);assert.ok(out[0].every((v,i)=>v===-out[1][i]));
 const q=new EnvelopeProcessor(gate),weak=new Float32Array(4096).fill(.00001),linked=run(q,[x,weak]);assert.ok(linked[1][4000]>.000009);
});
test('fixed low/high-pass controls produce distinct measurable frequency responses',()=>{
 const measured=(mode,hz)=>{const p=new EnvelopeProcessor({...filter,mode},{channels:1});return rms(run(p,[signal(hz)])[0].slice(1024));};
 assert.ok(measured('lowpass',100)>measured('highpass',100)*5);assert.ok(measured('highpass',6000)>measured('lowpass',6000)*4);
});
test('state survives arbitrary block boundaries and reset is deterministic',()=>{
 const input=signal(613),a=new EnvelopeProcessor({...filter,minHz:100,maxHz:6000},{channels:1}),b=new EnvelopeProcessor({...filter,minHz:100,maxHz:6000},{channels:1});const whole=run(a,[input])[0],parts=new Float32Array(input.length);
 for(let i=0;i<input.length;i+=64)parts.set(run(b,[input.slice(i,i+64)])[0],i);assert.deepEqual(parts,whole);b.reset();assert.deepEqual(run(b,[input])[0],whole);
});
test('dry mix is exact, malformed samples remain finite, bounds reject before processing',()=>{
 const p=new EnvelopeProcessor({...filter,mix:0},{channels:1}),source=signal(440);assert.deepEqual(run(p,[source])[0],source);const malformed=Float32Array.from([NaN,Infinity,-Infinity,1e30,-1e30,0]);const out=run(p,[malformed])[0];assert.ok(out.every(Number.isFinite));assert.ok(out.every(v=>Math.abs(v)<=8));assert.equal(p.invalidSamples,3);
 assert.throws(()=>new EnvelopeProcessor({...filter,attack:NaN}));assert.throws(()=>new EnvelopeProcessor(filter,{channels:3}));assert.throws(()=>p.process([source],[source]));assert.throws(()=>run(p,[new Float32Array(4097)]));
});
test('continuous fractional attack/release/mix survive while fractional enum bypasses whole gear',()=>{
 const[d,gear]=ownGear('Pedal_AutoFilter');gear.KnobValues.Pedal_AutoFilter_Attack=12.375;gear.KnobValues.Pedal_AutoFilter_Release=230.5;gear.KnobValues.Pedal_AutoFilter_Res=66.25;const before=structuredClone(gear),result=compileEnvelopeGear(gear,d);assert.equal(result.effect.attack,.012375);assert.equal(result.effect.release,.2305);assert.equal(result.effect.mix,.6625);assert.deepEqual(gear,before);gear.KnobValues.Pedal_AutoFilter_FilterType=1.5;assert.equal(compileEnvelopeGear(gear,d).effect,null);
});
test('tiny signals survive above denormal guard and twelve serial stages stay finite/bounded',()=>{
 const tiny=signal(440,4096,1e-12),out=run(new EnvelopeProcessor(filter,{channels:1}),[tiny])[0];assert.ok(rms(out)>1e-13);
 const input=[signal(440,4096,8),signal(613,4096,8)],before=input.map(a=>a.slice()),cores=Array.from({length:12},(_,i)=>new EnvelopeProcessor(i%3===0?{...gate,thresholdDb:-120,attack:0,hold:0}:{...filter,mode:i%2?'highpass':'lowpass',sensitivity:16,minHz:20,maxHz:20000,attack:0,release:.001}));let current=input;for(const core of cores){current=run(core,current);assert.ok(current.every(a=>a.every(v=>Number.isFinite(v)&&Math.abs(v)<=8)));}assert.deepEqual(input,before);
});
