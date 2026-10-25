// Production compiler/ownership checks; no browser or AudioContext creation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileStaticFilterGear,compileAdditionalStaticFilters,mergeAdditionalStaticFilters,StaticFilterRack} from '../src/tone-static-extra.js';
import {compileStaticFilterGear as oldCompile} from './fixtures/amp-eq-baseline/src/tone-static-extra.js';
import * as production from '../src/tone-rack.js';
const read=name=>JSON.parse(readFileSync(new URL('../'+name,import.meta.url)));
const catalog=read('assets/tone-rack-data.json').gears;
const inventory=read('tests/fixtures/recovery-tone-inventory.json');
production.registerGearCatalog(catalog);
const definition=catalog.find(gear=>gear.key==='Pedal_AmpEQ');
const own=()=>({Key:'Pedal_AmpEQ',KnobValues:Object.fromEntries(definition.knobs.map(control=>[control.key,control.unit==='enum'?control.min:(control.min+control.max)/2])),opaque:{future:[null,0,false,'0']}});
const compile=(gear,options)=>compileStaticFilterGear(gear,definition,options);

test('all six Amp EQ controls produce distinct original gain/anchor choices with exact fractional values',()=>{
 const gear=own();Object.assign(gear.KnobValues,{Pedal_AmpEQ_Bass:1,Pedal_AmpEQ_BassFreq:1,Pedal_AmpEQ_Mid:75.25,Pedal_AmpEQ_MidShift:2,Pedal_AmpEQ_Treble:100,Pedal_AmpEQ_TrebleFreq:1});
 const before=structuredClone(gear),result=compile(gear);
 assert.equal(result.handled,true);assert.equal(result.disclosure.kind,'approximate');
 assert.deepEqual(result.effect.bands.map(band=>band.gain),[-12,6,12]);
 assert.deepEqual(result.effect.bands.map(band=>band.frequency),[160,1600,5000]);
 assert.deepEqual(result.effect.bands.map(band=>band.type),['lowshelf','peaking','highshelf']);
 assert.ok(result.effect.bands.every(band=>band.frequencySource==='original-design'&&band.Q===1));
 assert.equal(result.effect.gain,1);assert.equal(result.disclosure.usedControls.length,6);
 assert.equal(result.disclosure.unmappedControls.length,0);
 assert.match(result.disclosure.originalDesign.join(' '),/not recovered native frequencies/);
 assert.match(result.disclosure.originalDesign.join(' '),/gain calibration is unknown/);
 assert.deepEqual(gear,before);
 const anchors=[['BassFreq',[80,160],0],['MidShift',[400,800,1600],1],['TrebleFreq',[2500,5000],2]];
 for(const [suffix,expected,index]of anchors)for(let value=0;value<expected.length;value++){
  const selected=own();selected.KnobValues['Pedal_AmpEQ_'+suffix]=value;
  assert.equal(compile(selected).effect.bands[index].frequency,expected[value]);
 }
});

test('continuous controls accept authored fractions independently of UI step and neutral50.5 is unity',()=>{
 for(const suffix of ['Bass','Mid','Treble']){
  const gear=own();gear.KnobValues['Pedal_AmpEQ_'+suffix]=75.125;
  const result=compile(gear),index=['Bass','Mid','Treble'].indexOf(suffix);
  assert.equal(result.effect.bands[index].gain,(75.125-50.5)*24/99);
  assert.ok(result.effect.bands.filter((band,i)=>i!==index).every(band=>band.gain===0));
 }
 assert.deepEqual(compile(own()).effect.bands.map(band=>band.gain),[0,0,0]);
});

test('unknown future control keys and source extensions stay exact and are explicitly unmapped',()=>{
 const gear=own();gear.KnobValues.FutureNativeControl=1375.125;const before=JSON.stringify(gear),result=compile(gear);
 assert.equal(JSON.stringify(gear),before);assert.equal(result.effect.bands.length,3);
 assert.deepEqual(result.disclosure.unmappedControls,['FutureNativeControl']);
 const extended=structuredClone(definition);extended.knobs.push({key:'FutureCatalogControl',label:'Future',min:0,max:1,step:1,unit:'number'});
 assert.deepEqual(compileStaticFilterGear(gear,extended).disclosure.unmappedControls,['FutureCatalogControl','FutureNativeControl']);
});

test('every malformed known range/value/enum bypasses the whole Amp EQ without source mutation',()=>{
 for(const [suffix,value]of [['Bass',0],['Bass',101],['Mid',NaN],['Treble',Infinity],['BassFreq',.5],['BassFreq',2],['MidShift',-1],['MidShift',3],['TrebleFreq','1'],['TrebleFreq',undefined]]){
  const gear=own();gear.KnobValues['Pedal_AmpEQ_'+suffix]=value;const before=structuredClone(gear),result=compile(gear);
  assert.equal(result.effect,null,suffix+':'+value);assert.equal(result.disclosure.kind,'bypassed');assert.ok(result.disclosure.invalidControls.includes('Pedal_AmpEQ_'+suffix));assert.deepEqual(gear,before);
 }
});

test('factual label/unit/range/step/choice drift and duplicate metadata are not silently reinterpreted',()=>{
 const mutations=[d=>d.knobs[0].unit='db',d=>d.knobs[0].min=0,d=>d.knobs[0].max=101,d=>d.knobs[0].step=.5,d=>d.knobs[0].label='Low',d=>d.knobs[1].choices=['Low','High'],d=>d.knobs[1].choices.reverse(),d=>d.knobs.push(structuredClone(d.knobs[0])),d=>d.knobs.splice(2,1),d=>d.category='Pitch',d=>d.type='Racks',d=>d.key='Other'];
 for(const mutate of mutations){const changed=structuredClone(definition);mutate(changed);const before=JSON.stringify(changed),result=compileStaticFilterGear(own(),changed);assert.equal(result.effect,null);assert.equal(result.disclosure.kind,'bypassed');assert.equal(JSON.stringify(changed),before);}
});

test('sample-rate frequency clamps are disclosed while authored enum source remains exact',()=>{
 const gear=own();gear.KnobValues.Pedal_AmpEQ_TrebleFreq=1;const before=JSON.stringify(gear),result=compile(gear,{sampleRate:8000});
 assert.equal(result.effect.bands[2].requestedFrequency,5000);assert.equal(result.effect.bands[2].frequency,3600);
 assert.deepEqual(result.disclosure.frequencyLimits,[{controls:['Pedal_AmpEQ_TrebleFreq'],requestedHz:5000,effectiveHz:3600}]);
 assert.equal(JSON.stringify(gear),before);
 for(const sampleRate of [NaN,7999,384001,Infinity])assert.throws(()=>compile(gear,{sampleRate}));
});

test('the full100-key production catalog changes exactly AmpEQ to84approximations/16bypasses with68of79 historical coverage',()=>{
 const rows=[];
 for(const saved of inventory.rows){const tone=production.createTone('Own production matrix');production.setGear(tone,saved.slot,saved.key);tone.opaque={retained:'future source'};const before=JSON.stringify(tone),next=production.toneAuditionPlan(tone,{adaptiveStatus:{state:'ready'}}),disclosure=next.disclosures.find(row=>row.slot===saved.slot&&row.key===saved.key),effect=next.effects.find(row=>row.slot===saved.slot)??null;
  assert.equal(JSON.stringify(tone),before,saved.key);assert.ok(disclosure,saved.key);
  if(saved.key==='Pedal_AmpEQ'){assert.equal(disclosure.kind,'approximate');assert.equal(effect.bands.length,3);assert.notDeepEqual(disclosure,saved.disclosure);}
  else{assert.deepEqual(disclosure,saved.disclosure,saved.key);assert.deepEqual(effect,saved.effect,saved.key);}
  rows.push({...saved,kind:disclosure.kind});
 }
 const count=selection=>[selection.length,selection.filter(row=>row.kind==='approximate').length,selection.filter(row=>row.kind==='bypassed').length];
 assert.deepEqual(count(rows),[100,84,16]);assert.deepEqual(count(rows.filter(row=>row.inHistorical79Fixture)),[79,68,11]);
 assert.deepEqual(count(rows.filter(row=>row.inHistorical79Fixture&&row.category==='Filter')),[21,20,1]);
 assert.deepEqual(count(rows.filter(row=>row.inHistorical79Fixture&&row.category!=='Filter')),[58,48,10]);
 assert.ok(rows.filter(row=>row.category==='Pitch').every(row=>row.kind==='bypassed'));
});

test('all prior static model compile results are byte-exact and invalid AmpEQ keeps another stage active',()=>{
 for(const saved of inventory.rows.filter(row=>row.key!=='Pedal_AmpEQ')){
  const gear={Key:saved.key,KnobValues:Object.fromEntries(saved.controls.map(control=>[control.key,control.unit==='enum'?control.min:(control.min+control.max)/2]))};
  assert.deepEqual(compileStaticFilterGear(gear,catalog.find(d=>d.key===saved.key)),oldCompile(gear,catalog.find(d=>d.key===saved.key)),saved.key);
 }
 const tone=production.createTone('Own failed EQ coexistence');production.setGear(tone,'PrePedal1','Pedal_AmpEQ');production.setGear(tone,'PostPedal1','Pedal_AnalogueDelay');tone.GearList.PrePedal1.KnobValues.Pedal_AmpEQ_BassFreq=.5;
 const before=JSON.stringify(tone),plan=production.toneAuditionPlan(tone,{adaptiveStatus:{state:'ready'}});
 assert.equal(plan.disclosures.find(row=>row.slot==='PrePedal1').kind,'bypassed');assert.equal(plan.effects.some(row=>row.slot==='PrePedal1'),false);assert.equal(plan.effects.find(row=>row.slot==='PostPedal1').kind,'delay');assert.equal(JSON.stringify(tone),before);
 const base={effects:[{slot:'PostPedal1',kind:'delay'}],disclosures:[]},effect=base.effects[0],merged=mergeAdditionalStaticFilters(base,compileAdditionalStaticFilters(tone,catalog));assert.equal(merged.effects[0],effect);
});

function fakeContext(){const nodes=[],node=()=>{const n={gain:{value:0},frequency:{value:0},Q:{value:0},connections:[],connect(other){this.connections.push(other);return other;},disconnect(){this.connections=[];}};nodes.push(n);return n;};return{nodes,sampleRate:48000,state:'running',createGain:node,createBiquadFilter:node,createWaveShaper:node};}

test('direct static ownership and actual TonePreview generic three-band route dispose every node',()=>{
 const context=fakeContext(),rack=new StaticFilterRack(context,compile(own()).effect);assert.equal(rack.nodeCount,8);rack.dispose();rack.dispose();assert.equal(rack.nodeCount,0);assert.ok(context.nodes.every(node=>node.connections.length===0));
 const c=fakeContext(),tone=production.createTone('Own preview EQ');production.setGear(tone,'PrePedal1','Pedal_AmpEQ');const before=JSON.stringify(tone),preview=new production.TonePreview(c);preview.setTone(tone);
 const pre=preview.preEffects,child=pre.childRacks[0];assert.equal(child.constructor.name,'ToneFilterRack');assert.equal(child.nodes.length,6);assert.equal(pre.stages.length,1);assert.equal(pre.stages[0].kind,'filter');assert.equal(JSON.stringify(tone),before);
 tone.volume=-3;preview.setTone(tone);assert.equal(preview.preEffects,pre);tone.GearList.PrePedal1.KnobValues.Pedal_AmpEQ_Mid=75.125;preview.setTone(tone);assert.equal(child.disposed,true);assert.equal(child.nodes.length,0);preview.dispose();assert.ok(c.nodes.every(node=>node.connections.length===0));
});

test('failed candidate filter construction rolls back new child nodes',()=>{
 const context=fakeContext(),effect=compile(own()).effect;effect.bands[2].frequency=NaN;
 assert.throws(()=>new StaticFilterRack(context,effect));assert.ok(context.nodes.every(node=>node.connections.length===0));
});
