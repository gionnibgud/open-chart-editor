import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {GEAR_CATALOG,registerGearCatalog,createTone,validateTone,setGear,setKnob,importTone,exportTone,copyTone,allocateTone,removeTone,assignToneSlots,gearsForSlot,TonePreview,toneAuditionPlan} from '../src/tone-rack.js';
test('authored neutral tone uses real compatible identifiers and roundtrips builder DTO shape',()=>{
 const tone=createTone('Original clean');assert.deepEqual(validateTone(tone),[]);
 assert.equal(tone.GearList.Amp.Key,'Amp_AT120');assert.equal(tone.GearList.Cabinet.Key,'Cab_AT0112C_57_Cone');
 assert.equal(tone.GearList.Amp.KnobValues.Amp_AT120_Bass,51);
 const serialized=JSON.parse(exportTone(tone));assert.equal(serialized.Name,'Original clean');assert.equal(serialized.Volume,'-12');
 assert.deepEqual(importTone(serialized),tone);
});
test('catalog contains factual ranges without source default presets',async()=>{
 const data=JSON.parse(await readFile(new URL('../assets/tone-rack-data.json',import.meta.url),'utf8'));registerGearCatalog(data.gears);
 assert.equal(GEAR_CATALOG.length,613);assert.equal(gearsForSlot('Amp').length,63);
 assert.equal(gearsForSlot('Cabinet').length,450);assert.ok(!JSON.stringify(data).includes('DefaultValue'));
 const tone=createTone('Bass');setGear(tone,'PrePedal1','Bass_Pedal_BassEQ8');setKnob(tone,'PrePedal1','Bass_Pedal_BassEQ8_75',-6);
 assert.deepEqual(validateTone(tone),[]);assert.throws(()=>setGear(tone,'Amp','Bass_Pedal_BassEQ8'),/fit/);
});
test('knob edits enforce real ranges, enum steps and optional slot removal',()=>{
 const tone=createTone();setGear(tone,'Rack1','Rack_StudioCompressor');setKnob(tone,'Rack1','Rack_StudioCompressor_Ratio',4);
 assert.throws(()=>setKnob(tone,'Rack1','Rack_StudioCompressor_Ratio',2.5),/steps/);
 assert.throws(()=>setKnob(tone,'Amp','Amp_AT120_Gain',101),/between/);
 setGear(tone,'Rack1',null);assert.equal(tone.GearList.Rack1,undefined);assert.throws(()=>setGear(tone,'Amp',null),/required/);
});
test('continuous native float knobs survive import/export and edits without UI-step quantization',()=>{
 const tone=createTone('Original fractional controls');setGear(tone,'Rack1','Rack_StudioEQ');setKnob(tone,'Rack1','Rack_StudioEQ_TrebleFreq',4.25);setKnob(tone,'Rack1','Rack_StudioEQ_Treble',1.125);assert.deepEqual(validateTone(tone),[]);const exported=JSON.parse(exportTone(tone)),restored=importTone(exported);assert.equal(restored.GearList.Rack1.KnobValues.Rack_StudioEQ_TrebleFreq,4.25);assert.equal(restored.GearList.Rack1.KnobValues.Rack_StudioEQ_Treble,1.125);assert.deepEqual(restored,tone);assert.throws(()=>setKnob(tone,'Rack1','Rack_StudioEQ_HiMidQ',.5),/steps/);
});
test('allocation limits referenced CDLC tones while FeedBack remains unrestricted',()=>{
 const definitions=Object.fromEntries(['A','B','C','D','E'].map(name=>[name,createTone(name)]));
 const arrangement={tones:{base:'A',definitions,changes:[]}};
 for(const [index,name]of ['B','C','D'].entries())allocateTone(arrangement,index+1,name,{target:'cdlc'});
 assert.throws(()=>allocateTone(arrangement,4,'E',{target:'cdlc'}),/four/);assert.equal(arrangement.tones.changes.length,3);
 allocateTone(arrangement,4,'E');assert.equal(assignToneSlots(arrangement,{target:'feedpak'}).length,5);
 assert.throws(()=>assignToneSlots(arrangement),/four/);assert.throws(()=>allocateTone(arrangement,-1,'A'),/nonnegative/);
});
test('tone removal protects allocations, replaces references and copies independently',()=>{
 const original=createTone('A'),copy=copyTone(original,'B');setKnob(copy,'Amp','Amp_AT120_Gain',99);
 assert.notEqual(copy.GearList.Amp.KnobValues.Amp_AT120_Gain,original.GearList.Amp.KnobValues.Amp_AT120_Gain);
 const arrangement={tones:{base:'A',definitions:{A:original,B:copy},changes:[{time:3,name:'A'}],slots:['A','B']}};
 assert.throws(()=>removeTone(arrangement,'A'),/replacement/);removeTone(arrangement,'A',{replacement:'B'});
 assert.equal(arrangement.tones.base,'B');assert.equal(arrangement.tones.changes[0].name,'B');assert.deepEqual(arrangement.tones.slots,['B']);
});


test('tone preview volume cache updates gain without redoing drive and no-tone clears to transparent unity',()=>{
 const node=()=>({gain:{value:0},frequency:{value:0},connections:[],connect(target){this.connections.push(target);},disconnect(){this.connections=[];}}),context={createGain:node,createBiquadFilter:node,createWaveShaper:node};
 const preview=new TonePreview(context),tone=createTone('Own');preview.setTone(tone);const curve=preview.drive.curve;tone.volume=-6;preview.setTone(tone);assert.equal(preview.drive.curve,curve);assert.ok(Math.abs(preview.output.gain.value-10**(-6/20))<1e-12);const other=createTone('Other');other.volume=-3;setKnob(other,'Amp','Amp_AT120_Gain',99);preview.setTone(JSON.stringify({toneData:other}));assert.notEqual(preview.drive.curve,curve);assert.ok(Math.abs(preview.output.gain.value-10**(-3/20))<1e-12);preview.clearTone();assert.equal(preview.output.gain.value,1);assert.deepEqual(preview.input.connections,[preview.output]);assert.equal(preview.disclosures.length,0);assert.equal(preview.bypassed,true);preview.dispose();preview.dispose();assert.throws(()=>preview.setTone(tone),/disposed/);
});
test('pure audition disclosures tolerate absent/malformed slots and retain unknown definitions',()=>{
 for(const tone of [null,{}, {GearList:{Amp:null,Cabinet:null}}, {GearList:{PrePedal1:{Key:'OwnUnknown',KnobValues:{Original:123}}}}])assert.doesNotThrow(()=>toneAuditionPlan(tone));
 const tone={GearList:{PrePedal1:{Key:'OwnUnknown',KnobValues:{Original:123},opaque:{bytes:'unchanged'}}}},before=JSON.stringify(tone),plan=toneAuditionPlan(tone);assert.equal(plan.disclosures[0].kind,'bypassed');assert.equal(JSON.stringify(tone),before);
});
