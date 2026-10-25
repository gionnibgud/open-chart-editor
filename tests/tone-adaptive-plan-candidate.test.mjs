import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {compileToneAdaptive,mergeToneAdaptive} from '../src/tone-adaptive-plan.js';
import {compileToneFilters} from '../src/tone-filters.js';import {compileToneEffects} from '../src/tone-effects.js';
const catalog=JSON.parse(await readFile(new URL('../assets/tone-rack-data.json',import.meta.url),'utf8')).gears;
function gear(key){const d=catalog.find(d=>d.key===key);return{Key:key,KnobValues:Object.fromEntries(d.knobs.map(k=>[k.key,k.choices?k.min:(k.min+k.max)/2]))};}
test('pending/failed adaptive preparation preserves working delay/EQ and source while exposing actual availability',()=>{
 const tone={GearList:{PrePedal1:gear('Pedal_NoiseGate'),PrePedal2:gear('Pedal_EQ5'),PostPedal1:gear('Pedal_AnalogueDelay')}},before=structuredClone(tone),base={effects:[...compileToneEffects(tone,catalog).effects,...compileToneFilters(tone,catalog).effects],disclosures:[]};
 for(const state of ['unprepared','preparing','failed','degraded','closed']){const extra=compileToneAdaptive(tone,catalog,{status:{state,message:'own failure'}}),merged=mergeToneAdaptive(base,extra);assert.deepEqual(merged.effects.map(e=>e.key),['Pedal_EQ5','Pedal_AnalogueDelay']);assert.equal(extra.disclosures[0].kind,['failed','degraded','closed'].includes(state)?'bypassed':'pending');if(state==='failed')assert.ok(extra.disclosures[0].message.includes('own failure'));}assert.deepEqual(tone,before);
});
test('ready envelope filter uses namespaced adaptive wrapper rather than colliding with manual filter bands',()=>{
 const tone={GearList:{PrePedal1:gear('Pedal_AutoFilter'),Rack1:gear('Pedal_RingMod')}},plan=compileToneAdaptive(tone,catalog,{status:{state:'ready'}});assert.equal(plan.effects[0].kind,'adaptive');assert.equal(plan.effects[0].processor.kind,'filter');assert.equal(plan.effects[0].processor.mode,'lowpass');assert.equal(plan.effects[1].kind,'modulation');assert.equal(plan.effects[1].modulation.kind,'ringmod');
});
test('Auto=OFF leaves existing manual wah descriptor/object exact; Auto=ON claims only its slot',()=>{
 const wah=gear('Pedal_UKWah'),tone={GearList:{PrePedal1:wah}},base=compileToneFilters(tone,catalog),extra=compileToneAdaptive(tone,catalog,{status:{state:'ready'}}),merged=mergeToneAdaptive(base,extra);assert.deepEqual(extra.claimedSlots,[]);assert.equal(merged.effects[0],base.effects[0]);assert.equal(merged.disclosures[0],base.disclosures[0]);wah.KnobValues.Pedal_UKWah_Auto=1;const ready=compileToneAdaptive(tone,catalog,{status:{state:'ready'}});assert.deepEqual(ready.claimedSlots,['PrePedal1']);assert.equal(ready.effects[0].kind,'adaptive');
});
test('invalid enum bypasses whole claimed gear while other candidate effects remain available',()=>{
 const tone={GearList:{PrePedal1:gear('Pedal_AutoFilter'),PostPedal1:gear('Pedal_MultiVibe')}};tone.GearList.PrePedal1.KnobValues.Pedal_AutoFilter_FilterType=1.5;const plan=compileToneAdaptive(tone,catalog,{status:{state:'ready'}});assert.deepEqual(plan.effects.map(e=>e.key),['Pedal_MultiVibe']);assert.equal(plan.disclosures[0].kind,'bypassed');
});
