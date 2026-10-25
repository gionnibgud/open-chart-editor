import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {compileFilterGearCandidate,compileToneFiltersCandidate,ToneFilterRackCandidate,FILTER_CANDIDATE_LIMITS} from '../src/tone-filters-candidate.js';
import {compileToneEffects} from '../src/tone-effects.js';
import {registerGearCatalog,createTone,setGear,TonePreview,toneAuditionPlan} from '../src/tone-rack.js';
const catalog=JSON.parse(await readFile(new URL('../assets/tone-rack-data.json',import.meta.url),'utf8')).gears;
const ownGear=(key,values={})=>{const d=catalog.find(g=>g.key===key);return{Key:key,KnobValues:Object.fromEntries(d.knobs.map(k=>[k.key,values[k.key.slice(key.length+1)]??k.min]))};};
const compile=(key,values={},options={})=>compileFilterGearCandidate(ownGear(key,values),catalog.find(g=>g.key===key),options);
function context(sampleRate=48000){const nodes=[],create=kind=>{const n={kind,frequency:{value:0},gain:{value:1},Q:{value:1},connections:[],disconnects:0,connect(other){this.connections.push(other);return other;},disconnect(){this.disconnects++;this.connections=[];}};nodes.push(n);return n;};return{sampleRate,nodes,createGain:()=>create('gain'),createBiquadFilter:()=>create('biquad'),createWaveShaper:()=>create('guard')};}
test('factual Filter inventory is21; scoped candidate supports11 manual configurations and leaves10 explicit bypasses',()=>{
 const filters=catalog.filter(g=>g.category==='Filter');assert.equal(filters.length,21);const results=filters.map(d=>compile(d.key));assert.equal(results.filter(r=>r.effect).length,11);assert.equal(results.filter(r=>!r.effect).length,10);assert.ok(results.filter(r=>!r.effect).every(r=>r.disclosure.kind==='bypassed'));
});
test('graphic EQ uses catalog Hz labels and complete gain ranges including negative cut',()=>{
 const five=compile('Pedal_EQ5',{'63':15,'250':-15,'750':0,'2200':7,'5700':-4}).effect;
 assert.deepEqual(five.bands.map(b=>[b.frequency,b.gain]),[[63,15],[250,-15],[750,0],[2200,7],[5700,-4]]);
 assert.deepEqual(compile('Bass_Pedal_BassEQ8').effect.bands.map(b=>b.frequency),[30,75,185,460,1100,2700,6800,16000]);
 assert.equal(compile('Pedal_EQ8',{'1600':12}).effect.bands[5].gain,12);
});
test('rack EQ converts factual kHz controls and maps named Q choices as disclosed original design',()=>{
 const p=compile('Rack_StudioEQ',{Bass:0,BassFreq:120,LoMid:0,LoMidFreq:500,LoMidQ:0,HiMid:6,HiMidFreq:4.2,HiMidQ:1,Treble:-3,TrebleFreq:8.2});
 assert.deepEqual(p.effect.bands.map(b=>[b.type,b.frequency,b.gain,b.Q]),[['lowshelf',120,0,1],['peaking',500,0,.7],['peaking',4200,6,2.8],['highshelf',8200,-3,1]]);assert.ok(p.disclosure.originalDesign.some(s=>s.includes('not known native')));
 const graphic=compile('Rack_StudioGraphicEQ',{MidFreq:2.5}).effect;assert.equal(graphic.bands[2].frequency,2500);
});
test('wah uses exact catalog OFF choice; Auto ON bypasses entire gear rather than playing a substituted manual filter',()=>{
 const manual=compile('Pedal_UKWah',{Auto:0,Pedal:100});assert.equal(manual.effect.bands[0].frequency,2400);assert.equal(manual.effect.bands[0].frequencySource,'original-design');assert.equal(manual.disclosure.inactiveControls.length,2);
 const auto=compile('Pedal_UKWah',{Auto:1,Pedal:100});assert.equal(auto.effect,null);assert.match(auto.disclosure.message,/entire gear is bypassed/);
 const d=structuredClone(catalog.find(g=>g.key==='Pedal_UKWah'));d.knobs.find(k=>k.key.endsWith('_Auto')).choices=['ON','OFF'];assert.equal(compileFilterGearCandidate(ownGear(d.key,{Auto:0}),d).effect,null);assert.ok(compileFilterGearCandidate(ownGear(d.key,{Auto:1}),d).effect);
});
test('LoFi labels govern Hi Cut/Lo Cut; native Mix suffix is not misread as a wet percentage',()=>{
 const low=compile('Pedal_LoFiFilter',{FilterType:1,Mix:1}).effect,high=compile('Pedal_LoFiFilter',{FilterType:100,Mix:100}).effect;
 assert.equal(low.mix,1);assert.deepEqual(low.bands.map(b=>b.frequency),[20,18000]);assert.deepEqual(high.bands.map(b=>b.frequency),[1500,1800]);assert.ok(low.bands.every(b=>b.frequencySource==='original-design'));
});
test('sample-rate limits are explicit while native source and unknown settings remain byte-identical',()=>{
 const tone={GearList:{PrePedal1:ownGear('Bass_Pedal_BassEQ8'),Rack1:ownGear('Rack_StudioEQ')},future:{retain:1}},before=JSON.stringify(tone);
 const plan=compileToneFiltersCandidate(tone,catalog,{sampleRate:8000});assert.ok(plan.effects.flatMap(e=>e.bands).every(b=>b.frequency<=3600));assert.ok(plan.disclosures.some(d=>d.frequencyLimits.length));assert.equal(JSON.stringify(tone),before);
});
test('invalid values and non-Hz frequency enum gear bypass honestly; no silent guessed catalog mapping',()=>{
 const bad=compile('Pedal_EQ5',{'63':Infinity});assert.equal(bad.effect,null);assert.equal(bad.disclosure.invalidControls[0],'Pedal_EQ5_63');
 const unknown=compile('Pedal_AmpEQ');assert.equal(unknown.effect,null);assert.ok(unknown.disclosure.unmappedControls.includes('Pedal_AmpEQ_BassFreq'));
 assert.equal(compile('Rack_StudioEQ',{HiMidFreq:4.25,HiMid:1.125}).effect.bands[2].frequency,4250);assert.equal(compile('Rack_StudioEQ',{HiMidFreq:4.25,HiMid:1.125}).effect.bands[2].gain,1.125);assert.equal(compile('Pedal_UKWah',{Auto:.5}).effect,null);assert.equal(compile('Rack_StudioEQ',{LoMidQ:.5}).effect,null);
});
test('candidate leaves existing legacy/non-Filter plans byte-identical and cannot run audio at import',()=>{
 const tone={GearList:{PrePedal1:{Key:'Pedal_AnalogueDelay',KnobValues:{Pedal_AnalogueDelay_Time:250,Pedal_AnalogueDelay_Feedback:25,Pedal_AnalogueDelay_Mix:50}}}},before=JSON.stringify(compileToneEffects(tone,catalog));assert.deepEqual(compileToneFiltersCandidate(tone,catalog),{effects:[],disclosures:[],sourcePreserved:true});assert.equal(JSON.stringify(compileToneEffects(tone,catalog)),before);
});
test('promoted Filter models leave the existing aggregate amplifier/drive parameters byte-identical',()=>{
 registerGearCatalog(catalog);const c=context(),preview=new TonePreview(c),tone=createTone('Original filter audit');preview.setTone(tone);
 const snapshot=()=>({bass:preview.bass.gain.value,treble:preview.treble.gain.value,cab:preview.cab.frequency.value,drive:Buffer.from(preview.drive.curve.buffer).toString('base64')});
 const baseline=snapshot();for(const d of catalog.filter(g=>g.category==='Filter')){const next=structuredClone(tone);setGear(next,d.type==='Racks'?'Rack1':'PrePedal1',d.key);preview.setTone(next);assert.deepEqual(snapshot(),baseline,d.key);const expected=toneAuditionPlan(next,{sampleRate:c.sampleRate});assert.deepEqual(preview.auditionPlan.effects,expected.effects);assert.ok(preview.disclosures.some(item=>item.key===d.key&&item.kind===expected.disclosures.find(item=>item.key===d.key).kind));}preview.dispose();
});
test('bounded graph allocates bands and per-stage guards, clamps frequency, and disposes every node idempotently',()=>{
 const c=context(8000),plan=compileToneFiltersCandidate({GearList:{PrePedal1:ownGear('Bass_Pedal_BassEQ8')}},catalog),rack=new ToneFilterRackCandidate(c,plan);
 assert.equal(c.nodes.filter(n=>n.kind==='biquad').length,8);assert.equal(c.nodes.filter(n=>n.kind==='guard').length,1);assert.ok(c.nodes.filter(n=>n.kind==='biquad').every(n=>n.frequency.value<=3600));const guard=c.nodes.find(n=>n.kind==='guard');assert.ok([...guard.curve].every(v=>Number.isFinite(v)&&Math.abs(v)<.95));assert.equal(guard.curve[512],0);assert.equal(guard.curve[640],.25);
 rack.dispose();rack.dispose();assert.ok(c.nodes.every(n=>n.disconnects===1));assert.equal(rack.nodes.length,0);assert.throws(()=>rack.connect(c.createGain()),/disposed/);
});
test('node cap and malformed nested band values fail atomically with no leaked connected nodes',()=>{
 const plan=compileToneFiltersCandidate({GearList:{PrePedal1:ownGear('Pedal_EQ8')}},catalog),c=context();assert.throws(()=>new ToneFilterRackCandidate(c,plan,{maxNodes:3}),/budget/);assert.ok(c.nodes.every(n=>n.disconnects===1));
 const invalid=structuredClone(plan);invalid.effects[0].bands[0].Q=NaN;const other=context();assert.throws(()=>new ToneFilterRackCandidate(other,invalid),/finite/);assert.ok(other.nodes.every(n=>n.disconnects===1));
 const max={effects:Array.from({length:12},()=>plan.effects[0])},bounded=context(),rack=new ToneFilterRackCandidate(bounded,max);assert.equal(bounded.nodes.length,FILTER_CANDIDATE_LIMITS.maxNodes);rack.dispose();assert.ok(bounded.nodes.every(n=>n.disconnects===1));
});
