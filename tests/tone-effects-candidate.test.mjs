import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {compileToneEffects} from '../src/tone-effects-candidate.js';
const catalog=JSON.parse(await readFile(new URL('../assets/tone-rack-data.json',import.meta.url))).gears;
const gear=key=>{const definition=catalog.find(g=>g.key===key);return {Key:key,KnobValues:Object.fromEntries(definition.knobs.map(k=>[k.key,k.min+Math.round((k.max-k.min)/2/k.step)*k.step]))};};
test('factual milliseconds, Hertz, percentage feedback and compressor enum ratios map without native mutation',()=>{
 const tone={opaque:{keep:'private'},GearList:{PrePedal1:gear('Pedal_AnalogueDelay'),Rack1:gear('Rack_StudioCompressor'),PostPedal1:gear('Pedal_Chorus')}};tone.GearList.PrePedal1.KnobValues.Pedal_AnalogueDelay_Time=400;tone.GearList.PrePedal1.KnobValues.Pedal_AnalogueDelay_Feedback=100;tone.GearList.PostPedal1.KnobValues.Pedal_Chorus_Rate=2.5;tone.GearList.Rack1.KnobValues.Rack_StudioCompressor_Ratio=3;const before=JSON.stringify(tone),plan=compileToneEffects(tone,catalog);
 assert.deepEqual(plan.effects.map(e=>e.kind),['delay','chorus','compressor']);assert.equal(plan.effects[0].time,.4);assert.equal(plan.effects[0].feedback,.85);assert.equal(plan.effects[1].rate,2.5);assert.equal(plan.effects[2].ratio,8);assert.equal(JSON.stringify(tone),before);
});
test('unknown or unsupported gear is explicitly bypassed; partially mapped controls remain disclosed',()=>{
 const plan=compileToneEffects({GearList:{PrePedal1:{Key:'Unknown'},PrePedal2:gear('Pedal_NoiseGate'),Rack1:gear('Rack_StudioChorus')}},catalog);assert.equal(plan.effects.length,1);assert.equal(plan.disclosures.filter(d=>d.kind==='bypassed').length,2);assert.ok(plan.disclosures.find(d=>d.key==='Rack_StudioChorus').unmappedControls.includes('Stereo'));assert.ok(!plan.disclosures.find(d=>d.key==='Rack_StudioChorus').unmappedControls.includes('Delay'));
});
test('malformed controls use finite bounded audition defaults and retain original invalid native payload',()=>{
 const tone={GearList:{PrePedal1:gear('Pedal_ModDelay')}};tone.GearList.PrePedal1.KnobValues.Pedal_ModDelay_Time=NaN;tone.GearList.PrePedal1.KnobValues.Pedal_ModDelay_Feedback=Infinity;const plan=compileToneEffects(tone,catalog);assert.ok(plan.disclosures[0].invalidControls.includes('Time'));assert.ok(plan.effects.every(e=>Object.values(e).filter(v=>typeof v==='number').every(Number.isFinite)));assert.ok(Number.isNaN(tone.GearList.PrePedal1.KnobValues.Pedal_ModDelay_Time));
});
