import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {compileStaticFilterGear,compileAdditionalStaticFilters,mergeAdditionalStaticFilters,rangeBoosterSample,staticOutputCurve,StaticFilterRack} from '../src/tone-static-extra.js';
import {toneAuditionPlan,registerGearCatalog} from '../src/tone-rack.js';
const catalog=JSON.parse(await readFile(new URL('../assets/tone-rack-data.json',import.meta.url),'utf8')).gears;registerGearCatalog(catalog);
function gear(key){const d=catalog.find(d=>d.key===key);return{Key:key,KnobValues:Object.fromEntries(d.knobs.map(k=>[k.key,k.choices?k.min:(k.min+k.max)/2])),opaque:{original:'native retained'}};}
const compile=g=>compileStaticFilterGear(g,catalog.find(d=>d.key===g.Key));
test('acoustic candidate honors exact fractional authored mid Hz, explicit original gain anchors and native metadata',()=>{
 const g=gear('Pedal_AcousticEmulator');g.KnobValues.Pedal_AcousticEmulator_MidShift=1375.125;g.KnobValues.Pedal_AcousticEmulator_Mid=75.25;const before=JSON.stringify(g),result=compile(g);assert.equal(result.effect.bands[1].frequency,1375.125);assert.equal(result.effect.bands[1].gain,6);assert.equal(result.effect.bands[1].frequencySource,'catalog-hz');assert.deepEqual(result.effect.bands.filter(b=>b.type!=='peaking').map(b=>b.frequency),[180,3500]);assert.ok(result.disclosure.originalDesign[0].includes('not physical'));assert.equal(JSON.stringify(g),before);
 g.KnobValues.Pedal_AcousticEmulator_MidShift=4000;const lowRate=compileStaticFilterGear(g,catalog.find(d=>d.key===g.Key),{sampleRate:8000});assert.equal(lowRate.effect.bands[1].frequency,3600);assert.equal(g.KnobValues.Pedal_AcousticEmulator_MidShift,4000);assert.ok(lowRate.disclosure.frequencyLimits.length);
});
test('range gain is audibly meaningful at quiet levels and soft-bounded on extreme finite input without source changes',()=>{
 const g=gear('Pedal_RangeBooster'),source=Float32Array.from({length:4800},(_,i)=>.015*Math.sin(2*Math.PI*440*i/48000)),before=source.slice(),curve=staticOutputCurve(),rms=a=>Math.sqrt(a.reduce((n,v)=>n+v*v,0)/a.length),outputs=[];
 for(const value of [1,50.5,100]){g.KnobValues.Pedal_RangeBooster_Boost=value;const effect=compile(g).effect;outputs.push(Float32Array.from(source,v=>rangeBoosterSample(v,effect,curve)));for(const sample of [-1e308,-100,-1,0,1,100,1e308])assert.ok(Number.isFinite(rangeBoosterSample(sample,effect,curve))&&Math.abs(rangeBoosterSample(sample,effect,curve))<.863);}
 assert.ok(Math.abs(20*Math.log10(rms(outputs[2])/rms(outputs[0]))-12)<1e-5);assert.ok(Math.abs(20*Math.log10(rms(outputs[1])/rms(outputs[0]))-6)<1e-5);assert.deepEqual(source,before);assert.equal(rangeBoosterSample(0,compile(g).effect,curve),0);
});
test('legacy Filter/other model descriptors stay byte-identical and retain object identity outside three claimed slots',()=>{
 for(const d of catalog.filter(d=>['Filter','Dynamics','Modulation','Delay','Reverb','Tremolo'].includes(d.category))){const tone={GearList:{[d.type==='Racks'?'Rack1':'PrePedal1']:gear(d.key)}},before=JSON.stringify(tone),base=toneAuditionPlan(tone,{adaptiveStatus:{state:'ready'}}),serialized=JSON.stringify(base),extra=compileAdditionalStaticFilters(tone,catalog),merged=mergeAdditionalStaticFilters(base,extra);assert.equal(JSON.stringify(base),serialized);assert.equal(JSON.stringify(tone),before);if(!['Pedal_AcousticEmulator','Pedal_RangeBooster','Pedal_AmpEQ'].includes(d.key)){assert.deepEqual(merged,base);for(let i=0;i<base.effects.length;i++)assert.equal(merged.effects[i],base.effects[i]);}}
 const amp=gear('Pedal_AmpEQ');assert.equal(compile(amp).handled,true);assert.equal(toneAuditionPlan({GearList:{PrePedal1:amp}},{adaptiveStatus:{state:'ready'}}).disclosures[0].kind,'approximate');
});
test('invalid controls or changed factual units bypass the entire candidate, while unrelated slots remain',()=>{
 const g=gear('Pedal_AcousticEmulator');g.KnobValues.Pedal_AcousticEmulator_MidShift=NaN;assert.equal(compile(g).effect,null);assert.equal(compile(g).disclosure.kind,'bypassed');const d=structuredClone(catalog.find(d=>d.key===g.Key));d.knobs.find(k=>k.label==='Mid Frequency').unit='enum';assert.equal(compileStaticFilterGear(gear(g.Key),d).effect,null);assert.throws(()=>compileStaticFilterGear(gear(g.Key),d,{sampleRate:NaN}));
});
test('candidate racks own at most eight nodes, reuse bounded filter graph and dispose/rollback every child',()=>{
 function context(){const nodes=[],node=()=>{const n={gain:{value:0},frequency:{value:0},Q:{value:0},connections:[],connect(x){this.connections.push(x);},disconnect(){this.connections=[];}};nodes.push(n);return n;};return{sampleRate:48000,nodes,createGain:node,createBiquadFilter:node,createWaveShaper:node};}
 for(const key of ['Pedal_AcousticEmulator','Pedal_RangeBooster']){const c=context(),rack=new StaticFilterRack(c,compile(gear(key)).effect);assert.ok(rack.nodeCount<=8);assert.ok(rack.nodeCount>=3);rack.dispose();rack.dispose();assert.equal(rack.nodeCount,0);assert.ok(c.nodes.every(n=>n.connections.length===0));}
 const c=context(),effect=compile(gear('Pedal_AcousticEmulator')).effect;effect.bands[2].frequency=NaN;assert.throws(()=>new StaticFilterRack(c,effect));assert.ok(c.nodes.every(n=>n.connections.length===0));
});

import * as production from '../src/tone-rack.js';
const legacyFixture=JSON.parse(await readFile(new URL('./fixtures/tone-static-legacy-06-plans.json',import.meta.url),'utf8'));
test('cumulative production changes from frozen0.6 are limited to five reviewed gear definitions',()=>{
 for(const row of legacyFixture.rows){
  const d={key:row.key},slot=row.slot,tone=structuredClone(row.tone),source=JSON.stringify(tone),old=row.plan,next=production.toneAuditionPlan(tone,{adaptiveStatus:{state:'ready'}});
  if(!['Pedal_AcousticEmulator','Pedal_RangeBooster','Pedal_Swole','Bass_Pedal_EdenWTDI','Pedal_AmpEQ'].includes(d.key))assert.deepEqual(next,old,d.key);
  else{assert.notDeepEqual(next,old,d.key);assert.equal(next.effects.find(e=>e.slot===slot).kind,d.key==='Pedal_Swole'?'compressor':'filter');assert.equal(next.disclosures.find(e=>e.slot===slot).kind,'approximate');assert.ok(next.disclosures.find(e=>e.slot===slot).usedControls.every(label=>!label.startsWith(d.key)));}
  assert.equal(JSON.stringify(tone),source);
 }
});
function fakePreviewContext(){const nodes=[],node=()=>{const n={gain:{value:1},frequency:{value:0},Q:{value:0},connections:[],connect(other){this.connections.push(other);return other;},disconnect(){this.connections=[];}};nodes.push(n);return n;};return{nodes,sampleRate:48000,state:'running',createGain:node,createBiquadFilter:node,createWaveShaper:node};}
test('production TonePreview uses real owned static children, volume cache, replaced/disposed graph and fractional controls',()=>{
 const context=fakePreviewContext(),tone=production.createTone('Own staged static');production.setGear(tone,'PrePedal1','Pedal_AcousticEmulator');production.setGear(tone,'PostPedal1','Pedal_RangeBooster');tone.GearList.PrePedal1.KnobValues.Pedal_AcousticEmulator_MidShift=1375.125;const original=JSON.stringify(tone),preview=new production.TonePreview(context);preview.setTone(tone);
 const children=[...preview.preEffects.childRacks,...preview.postEffects.childRacks];assert.ok(children.every(child=>child instanceof StaticFilterRack));assert.equal(children.length,2);assert.ok(children.every(child=>child.nodeCount<=8));assert.equal(preview.auditionPlan.effects.find(e=>e.key==='Pedal_AcousticEmulator').bands[1].frequency,1375.125);assert.equal(JSON.stringify(tone),original);
 tone.volume=-3;preview.setTone(tone);assert.equal(preview.preEffects.childRacks[0],children[0]);assert.equal(preview.postEffects.childRacks[0],children[1]);tone.GearList.PrePedal1.KnobValues.Pedal_AcousticEmulator_MidShift=1475.25;preview.setTone(tone);assert.ok(children.every(child=>child.disposed&&child.nodeCount===0));assert.equal(preview.auditionPlan.effects.find(e=>e.key==='Pedal_AcousticEmulator').bands[1].frequency,1475.25);preview.dispose();assert.ok(context.nodes.every(n=>n.connections.length===0));
});
test('production actual preview construction failure rolls back new graph and keeps the previous working graph',()=>{
 const context=fakePreviewContext(),tone=production.createTone('Own rollback');production.setGear(tone,'PrePedal1','Pedal_RangeBooster');const preview=new production.TonePreview(context);preview.setTone(tone);const previous=preview.preEffects,child=previous.childRacks[0];production.setGear(tone,'PrePedal1','Pedal_AcousticEmulator');context.createBiquadFilter=()=>{throw Error('Own allocation failure');};assert.throws(()=>preview.setTone(tone),/Own allocation failure/);assert.equal(preview.preEffects,previous);assert.equal(child.disposed,false);assert.equal(child.nodeCount,3);preview.dispose();assert.ok(context.nodes.every(n=>n.connections.length===0));
});

test('missing asynchronous factual catalog preserves legacy unknown-gear bypass and working delay until registration',async()=>{
 const fresh=await import('../src/tone-rack.js?missing-static-catalog'),tone=fresh.createTone('Own pending static metadata');fresh.setGear(tone,'PostPedal2','Pedal_AnalogueDelay');tone.GearList.PrePedal1=gear('Pedal_AcousticEmulator');tone.GearList.PostPedal1=gear('Pedal_RangeBooster');const source=JSON.stringify(tone),pending=fresh.toneAuditionPlan(tone);assert.ok(pending.effects.some(e=>e.kind==='delay'));assert.equal(pending.effects.filter(e=>['Pedal_AcousticEmulator','Pedal_RangeBooster'].includes(e.key)).length,0);assert.ok(pending.disclosures.filter(d=>['PrePedal1','PostPedal1'].includes(d.slot)).every(d=>d.kind==='bypassed'));
 const empty=compileAdditionalStaticFilters(tone,[]);assert.equal(empty.claimedSlots.length,0);assert.equal(mergeAdditionalStaticFilters(pending,empty),pending);fresh.registerGearCatalog(catalog);const ready=fresh.toneAuditionPlan(tone);assert.equal(ready.effects.filter(e=>['Pedal_AcousticEmulator','Pedal_RangeBooster'].includes(e.key)).length,2);assert.ok(ready.effects.some(e=>e.kind==='delay'));assert.equal(JSON.stringify(tone),source);
});
