import {compileSwoleEden,mergeSwoleEden} from './tone-swole-eden.js';
import {compileAdditionalStaticFilters,mergeAdditionalStaticFilters,StaticFilterRack} from './tone-static-extra.js';
import {compileToneAdaptive,mergeToneAdaptive} from './tone-adaptive-plan.js';
import {ToneEnvelopeRack,toneEnvelopeStatus} from './tone-adaptive-rack.js';
import {ToneModulationRack} from './tone-modulation.js';
import {compileToneEffects,ToneEffectRack,EFFECT_SLOT_ORDER} from './tone-effects.js';
import {compileToneFilters,ToneFilterRack} from './tone-filters.js';
// Original tone authoring and approximate browser preview. Gear IDs/ranges are
// interoperability metadata, not copied presets or amplifier DSP.
const clone = value => structuredClone(value);
const knob = (key,label,min=1,max=100,step=1) => ({key,label,min,max,step});
export const SLOT_CATALOG = [
  {key:'Amp',label:'Amplifier',type:'Amps',required:true},{key:'Cabinet',label:'Cabinet / microphone',type:'Cabinets',required:true},
  ...Array.from({length:4},(_,i)=>({key:`PrePedal${i+1}`,label:`Pre pedal ${i+1}`,type:'Pedals'})),
  ...Array.from({length:4},(_,i)=>({key:`PostPedal${i+1}`,label:`Post pedal ${i+1}`,type:'Pedals'})),
  ...Array.from({length:4},(_,i)=>({key:`Rack${i+1}`,label:`Rack effect ${i+1}`,type:'Racks'})),
];
export const GEAR_CATALOG = [
  {key:'Amp_AT120',label:'AT-120',type:'Amps',category:'Amp',knobs:['Gain','Bass','Mid','Treble'].map(label=>knob(`Amp_AT120_${label}`,label))},
  {key:'Cab_AT0112C_57_Cone',label:'AT-0112C / dynamic cone',type:'Cabinets',category:'Dynamic Cone',knobs:[]},
  {key:'Pedal_Distortion',label:'Distortion',type:'Pedals',category:'Distortion',knobs:['Gain','Tone'].map(label=>knob(`Pedal_Distortion_${label}`,label))},
  {key:'Pedal_AnalogueDelay',label:'Analog delay',type:'Pedals',category:'Delay',knobs:[knob('Pedal_AnalogueDelay_Time','Time',10,1000,10),knob('Pedal_AnalogueDelay_Feedback','Feedback',0,100),knob('Pedal_AnalogueDelay_Mix','Mix')]},
  {key:'Rack_StudioCompressor',label:'Studio compressor',type:'Racks',category:'Dynamics',knobs:[knob('Rack_StudioCompressor_Threshold','Threshold',-50,0,.5),{...knob('Rack_StudioCompressor_Ratio','Ratio',0,4),choices:['1.5:1','2:1','4:1','8:1','20:1']},knob('Rack_StudioCompressor_Attack','Attack',0,250),knob('Rack_StudioCompressor_Release','Release',10,1000,10)]},
];
let catalogRevision=0;
export function registerGearCatalog(gears) {
  if(!Array.isArray(gears))throw Error('Gear catalog must be an array');
  for(const gear of gears){
    if(!gear||typeof gear.key!=='string'||!['Amps','Cabinets','Pedals','Racks'].includes(gear.type)||!Array.isArray(gear.knobs)||gear.knobs.some(k=>!Number.isFinite(k.min)||!Number.isFinite(k.max)||k.max<k.min||!(k.step>0)))throw Error('Invalid gear metadata');
  }
  for(const gear of gears){const index=GEAR_CATALOG.findIndex(item=>item.key===gear.key);if(index<0)GEAR_CATALOG.push(clone(gear));else GEAR_CATALOG[index]=clone(gear);}
  catalogRevision++;return GEAR_CATALOG;
}
export async function loadGearCatalog(url=new URL('../assets/tone-rack-data.json',import.meta.url)) {
  const response=await fetch(url);if(!response.ok)throw Error('Tone gear catalog could not be loaded');
  return registerGearCatalog((await response.json()).gears);
}
export const gearsForSlot = slot => GEAR_CATALOG.filter(gear=>gear.type===SLOT_CATALOG.find(item=>item.key===slot)?.type);
const keyFor = name => String(name).trim().replace(/[^a-zA-Z0-9_]/g,'_')||'Local_Tone';
const syncNames = tone => {tone.Name=tone.name;tone.Key=tone.key;tone.Volume=String(tone.volume);return tone;};
const defaultValue = control => {
  const midpoint=control.min<0&&control.max>0?0:(control.min+control.max)/2;
  return Math.max(control.min,Math.min(control.max,control.min+Math.round((midpoint-control.min)/control.step)*control.step));
};
export function createTone(name='Local tone') {
  if(typeof name!=='string'||!name.trim())throw Error('Tone name is required');
  const tone={name:name.trim(),key:keyFor(name),volume:-12,GearList:{},ToneDescriptors:[],NameSeparator:' - '};
  setGear(tone,'Amp','Amp_AT120');setGear(tone,'Cabinet','Cab_AT0112C_57_Cone');return syncNames(tone);
}
export function setGear(tone,slot,key) {
  const descriptor=SLOT_CATALOG.find(item=>item.key===slot);if(!descriptor)throw Error('Unknown gear slot');
  tone.GearList ||= {};
  if(key==null||key===''){if(descriptor.required)throw Error(`${descriptor.label} is required`);delete tone.GearList[slot];return tone;}
  const gear=GEAR_CATALOG.find(item=>item.key===key);if(!gear||gear.type!==descriptor.type)throw Error('Gear does not fit this slot');
  tone.GearList[slot]={Key:key,Type:gear.type,KnobValues:Object.fromEntries(gear.knobs.map(control=>[control.key,defaultValue(control)]))};return tone;
}
export function setKnob(tone,slot,key,value) {
  const gear=tone.GearList?.[slot],descriptor=GEAR_CATALOG.find(item=>item.key===gear?.Key),control=descriptor?.knobs.find(item=>item.key===key);
  if(!control)throw Error('Choose an existing gear control');
  value=Number(value);if(!Number.isFinite(value)||value<control.min||value>control.max)throw Error(`Control must be between ${control.min} and ${control.max}`);
  const steps=(value-control.min)/control.step;if(control.unit==='enum'&&Math.abs(steps-Math.round(steps))>1e-5)throw Error(`Control requires steps of ${control.step}`);
  gear.KnobValues[key]=value;return tone;
}
export function validateTone(tone,{allowUnknown=true}={}) {
  const issues=[],issue=(message,slot=null,severity='error')=>issues.push({message,slot,severity});
  if(!tone||typeof tone!=='object'){issue('Tone object required');return issues;}
  if(typeof(tone.name??tone.Name)!=='string'||!(tone.name??tone.Name).trim())issue('Tone name is required');
  if(typeof(tone.key??tone.Key)!=='string'||!(tone.key??tone.Key).trim())issue('Tone key is required');
  const volume=Number(tone.volume??tone.Volume);if(!Number.isFinite(volume)||volume< -60||volume>12)issue('Tone volume must be -60 to +12 dB');
  for(const slot of SLOT_CATALOG){
    const gear=tone.GearList?.[slot.key];if(!gear){if(slot.required)issue(`${slot.label} is required`,slot.key);continue;}
    const definition=GEAR_CATALOG.find(item=>item.key===gear.Key);
    if(!definition){issue(`Unknown gear ${gear.Key}`,slot.key,allowUnknown?'warning':'error');continue;}
    if(definition.type!==slot.type)issue('Gear is in the wrong slot',slot.key);
    for(const control of definition.knobs){const value=gear.KnobValues?.[control.key];if(!Number.isFinite(value)||value<control.min||value>control.max)issue(`${control.label} must be ${control.min} to ${control.max}`,slot.key);else if(control.unit==='enum'&&Math.abs((value-control.min)/control.step-Math.round((value-control.min)/control.step))>1e-5)issue(`${control.label} requires steps of ${control.step}`,slot.key);}
  }
  return issues;
}
export function importTone(value) {
  let raw=typeof value==='string'?JSON.parse(value):clone(value);raw=raw.toneData??raw;
  const tone={...raw,name:raw.name??raw.Name,key:raw.key??raw.Key,volume:Number(raw.volume??raw.Volume??-12)};
  const errors=validateTone(tone).filter(issue=>issue.severity==='error');if(errors.length)throw Error(errors.map(issue=>issue.message).join('; '));return syncNames(tone);
}
export function exportTone(tone) {const normalized=importTone(tone);return JSON.stringify(syncNames(normalized),null,2);}
export function copyTone(tone,name) {const next=importTone(tone);if(!name?.trim())throw Error('Copy needs a new name');next.name=name.trim();next.key=keyFor(name);return syncNames(next);}
const tonesFor = arrangement => arrangement.tones ||= {base:'',changes:[],definitions:{}};
const referencedNames = tones => [...new Set([tones.base,...(tones.changes||[]).map(change=>change.name)].filter(Boolean))];
export function assignToneSlots(arrangement,{target='cdlc',slots=null}={}) {
  const tones=tonesFor(arrangement),references=referencedNames(tones),names=slots?[...slots]:references;
  if(new Set(names).size!==names.length)throw Error('Tone slots must be unique');
  if((target==='cdlc'||target==='xml')&&names.length>4)throw Error('Rocksmith 2014 supports at most four named tones per arrangement');
  if(references.some(name=>!names.includes(name)))throw Error('Every allocated tone needs a slot');
  if(names.some(name=>!Object.hasOwn(tones.definitions||{},name)))throw Error('Every tone slot needs a definition');
  tones.slots=names;return names;
}
export function allocateTone(arrangement,time,name,{target='feedpak'}={}) {
  const tones=tonesFor(arrangement);if(!Number.isFinite(time)||time<0)throw Error('Tone time must be nonnegative');
  if(!Object.hasOwn(tones.definitions||{},name))throw Error('Choose an existing tone definition');
  const changes=clone(tones.changes||[]),existing=changes.find(change=>Math.abs(change.time-time)<1e-7);
  if(existing)existing.name=name;else changes.push({time,name});changes.sort((a,b)=>a.time-b.time);
  const staging={tones:{...tones,base:tones.base||name,changes}};assignToneSlots(staging,{target});
  Object.assign(tones,staging.tones);return tones.changes;
}
export function removeTone(arrangement,name,{replacement=null}={}) {
  const tones=tonesFor(arrangement);if(!Object.hasOwn(tones.definitions||{},name))throw Error('Unknown tone definition');
  const used=referencedNames(tones).includes(name);
  if(used&&(!replacement||replacement===name||!Object.hasOwn(tones.definitions,replacement)))throw Error('Choose a replacement for this allocated tone');
  if(tones.base===name)tones.base=replacement;
  tones.changes=(tones.changes||[]).map(change=>change.name===name?{...change,name:replacement}:change);
  delete tones.definitions[name];tones.slots=(tones.slots||[]).map(slot=>slot===name?replacement:slot).filter((slot,index,list)=>slot&&list.indexOf(slot)===index);return tones;
}

// Pure UI disclosure plan; native tone bytes/authoring definitions are never rewritten.
export function toneAuditionPlan(tone,{sampleRate=48000,adaptiveStatus={state:'unprepared'},actualDisclosures=[]}={}){
 let plan=compileToneEffects(tone,GEAR_CATALOG),filters=compileToneFilters(tone,GEAR_CATALOG,{sampleRate}),filterSlots=new Set(filters.disclosures.map(item=>item.slot));
 plan.effects=[...plan.effects,...filters.effects].sort((a,b)=>EFFECT_SLOT_ORDER.indexOf(a.slot)-EFFECT_SLOT_ORDER.indexOf(b.slot));
 plan.disclosures=[...plan.disclosures.filter(item=>!filterSlots.has(item.slot)),...filters.disclosures.map(item=>{const definition=GEAR_CATALOG.find(gear=>gear.key===item.key),caption=key=>definition?.knobs.find(knob=>knob.key===key)?.label||key;return{...item,message:item.kind==='approximate'?item.message+'; filter-stage output is locally bounded':item.message,unmappedControls:item.unmappedControls.map(caption),inactiveControls:item.inactiveControls.map(caption),invalidControls:item.invalidControls.map(caption)};})];
 plan=mergeToneAdaptive(plan,compileToneAdaptive(tone,GEAR_CATALOG,{sampleRate,status:adaptiveStatus}));
 plan=mergeAdditionalStaticFilters(plan,compileAdditionalStaticFilters(tone,GEAR_CATALOG,{sampleRate}));
 plan=mergeSwoleEden(plan,compileSwoleEden(tone,GEAR_CATALOG,{sampleRate}));
 const caption=(slot,key)=>GEAR_CATALOG.find(gear=>gear.key===tone?.GearList?.[slot]?.Key)?.knobs.find(knob=>knob.key===key)?.label||key;
 plan.disclosures=plan.disclosures.map(item=>{const value={...item};for(const field of ['usedControls','invalidControls','unmappedControls','inactiveControls'])if(Array.isArray(value[field]))value[field]=value[field].map(key=>caption(item.slot,key));return value;});
 for(const actual of actualDisclosures){const index=plan.disclosures.findIndex(item=>item.slot===actual.slot&&item.key===actual.key);if(index>=0)plan.disclosures[index]={...plan.disclosures[index],...actual};}
 for(const [slot,gear]of Object.entries(tone?.GearList||{})){
  const definition=GEAR_CATALOG.find(item=>item.key===gear?.Key);
  if(slot==='Amp'||slot==='Cabinet'||definition?.category==='Distortion'){
   const prior=plan.disclosures.findIndex(item=>item.slot===slot);if(prior>=0)plan.disclosures.splice(prior,1);
   const interpreted=slot==='Amp'?['Gain','Bass','Treble']:definition?.category==='Distortion'?['Gain']:[];
   plan.disclosures.push({slot,key:gear?.Key,kind:'approximate',message:slot==='Cabinet'?'Original generic cabinet low-pass; cabinet and microphone models differ':slot==='Amp'?'Original generic amplifier EQ/drive; branded/native amplifier differs':'Original aggregate drive; individual pedal routing and branded response differ',unmappedControls:(definition?.knobs||[]).filter(control=>!interpreted.some(suffix=>control.key.endsWith('_'+suffix))).map(control=>control.label)});
  }
 }
 if(plan.effects.length)plan.disclosures.push({slot:'Output',kind:'approximate',message:'Local effects audition uses an output soft ceiling after tone volume; extreme stacks may be reduced. Native exports are unchanged.'});
 return plan;
}
const previewIdentity=(tone,status)=>JSON.stringify([catalogRevision,status.state,SLOT_CATALOG.map(({key})=>{const gear=tone?.GearList?.[key];return gear?[key,gear.Key,Object.entries(gear.KnobValues||{}).sort(([a],[b])=>a.localeCompare(b))]:null;})]);
export class TonePreview {
  constructor(context,{onStatus=()=>{}}={}) {
    this.context=context;this.onStatus=event=>{try{onStatus({...event,preview:this});}catch{}};this.input=context.createGain();this.output=context.createGain();this.disposed=false;this.preEffects=null;this.postEffects=null;this.identity=null;this.bypassed=false;this.auditionPlan={effects:[],disclosures:[]};this.disclosures=[];
    // Only active effects use this guard. Pre-volume + inverse compensation
    // preserves the public output.gain control while ceiling the final signal.
    this.safetyVolume=context.createGain();this.safety=context.createWaveShaper();this.safetyCompensate=context.createGain();
    this.safety.curve=Float32Array.from({length:4097},(_,i)=>{const x=i/2048-1,a=Math.abs(x);return a<=.5?x:Math.sign(x)*(.5+.45*Math.tanh((a-.5)/.45));});
    this.bass=context.createBiquadFilter();this.bass.type='lowshelf';this.bass.frequency.value=180;
    this.treble=context.createBiquadFilter();this.treble.type='highshelf';this.treble.frequency.value=2800;
    this.drive=context.createWaveShaper();this.drive.oversample='2x';
    this.cab=context.createBiquadFilter();this.cab.type='lowpass';this.cab.frequency.value=6500;
    this.input.connect(this.bass);this.bass.connect(this.treble);this.treble.connect(this.drive);this.drive.connect(this.cab);this.cab.connect(this.output);
  }
  setTone(tone) {
    if(this.disposed)throw Error('Tone preview has been disposed');
    if(tone==null)return this.clearTone();
    if(typeof tone==='string'||tone?.toneData)tone=importTone(tone);
    const identity=previewIdentity(tone,toneEnvelopeStatus(this.context)),volume=Number(tone.volume??tone.Volume??-12);if(!Number.isFinite(volume)||volume< -60||volume>12)throw Error('Tone volume must be -60 to +12 dB');if(identity===this.identity&&!this.bypassed){this.setVolume(volume);return this;}
    const normalized=importTone(tone),plan=toneAuditionPlan(normalized,{sampleRate:this.context.sampleRate,adaptiveStatus:toneEnvelopeStatus(this.context)}),pre=plan.effects.filter(effect=>effect.slot.startsWith('PrePedal')),post=plan.effects.filter(effect=>!effect.slot.startsWith('PrePedal'));
    let preEffects=null,postEffects=null;
    const createFilterRack=(context,effect)=>['Pedal_AcousticEmulator','Pedal_RangeBooster'].includes(effect.key)?new StaticFilterRack(context,effect):new ToneFilterRack(context,{effects:[effect]});
    const createAdaptiveRack=(context,effect,{onStatus})=>new ToneEnvelopeRack(context,effect.processor,{onStatus});
    const createModulationRack=(context,effect)=>new ToneModulationRack(context,effect.modulation);
    const onStatus=event=>{if(!this.disposed)this.onStatus(event);};
    try{if(pre.length)preEffects=new ToneEffectRack(this.context,{effects:pre},{maxImpulseBytes:16*1024*1024,createFilterRack,createAdaptiveRack,createModulationRack,onStatus});if(post.length)postEffects=new ToneEffectRack(this.context,{effects:post},{maxImpulseBytes:16*1024*1024,createFilterRack,createAdaptiveRack,createModulationRack,onStatus});}catch(error){preEffects?.dispose();postEffects?.dispose();throw error;}
    this.input.disconnect();this.cab.disconnect();this.safetyVolume.disconnect();this.safety.disconnect();this.safetyCompensate.disconnect();this.preEffects?.dispose();this.postEffects?.dispose();this.preEffects=preEffects;this.postEffects=postEffects;
    if(preEffects){this.input.connect(preEffects.input);preEffects.connect(this.bass);}else this.input.connect(this.bass);
    if(preEffects||postEffects){
     if(postEffects){this.cab.connect(postEffects.input);postEffects.connect(this.safetyVolume);}else this.cab.connect(this.safetyVolume);
     this.safetyVolume.connect(this.safety);this.safety.connect(this.safetyCompensate);this.safetyCompensate.connect(this.output);
    }else this.cab.connect(this.output);
    this.identity=identity;this.bypassed=false;this.auditionPlan=plan;this.disclosures=[...plan.disclosures];
    for(const actual of [...(preEffects?.disclosures||[]),...(postEffects?.disclosures||[])]){const index=this.disclosures.findIndex(item=>item.slot===actual.slot&&(!actual.key||item.key===actual.key));if(index>=0)this.disclosures[index]=actual;else this.disclosures.push(actual);}
    const knobs=normalized.GearList.Amp?.KnobValues||{};
    const find=(suffix,fallback)=>{const value=Object.entries(knobs).find(([key])=>key.endsWith(suffix))?.[1];return Number.isFinite(value)?Math.max(0,Math.min(100,value)):fallback;};
    this.bass.gain.value=(find('_Bass',50)-50)*.12;this.treble.gain.value=(find('_Treble',50)-50)*.12;
    let amount=find('_Gain',1)/20;
    for(const [slot,gear]of Object.entries(normalized.GearList))if(slot!=='Amp'&&GEAR_CATALOG.find(item=>item.key===gear?.Key)?.category==='Distortion')amount+=Object.entries(gear.KnobValues||{}).find(([key])=>key.endsWith('_Gain'))?.[1]/10||0;
    const curve=new Float32Array(2048),drive=Math.max(.1,amount);
    for(let index=0;index<curve.length;index++){const x=index*2/(curve.length-1)-1;curve[index]=Math.tanh(x*drive)/Math.tanh(drive);}
    this.drive.curve=curve;this.setVolume(normalized.volume);return this;
  }
  getDisclosures(){return this.disclosures.slice();}
  setVolume(decibels){if(!Number.isFinite(decibels)||decibels< -60||decibels>12)throw Error('Tone volume must be -60 to +12 dB');const gain=10**(decibels/20);this.output.gain.value=gain;this.safetyVolume.gain.value=gain;this.safetyCompensate.gain.value=1/gain;}
  clearTone(){
    if(this.disposed)throw Error('Tone preview has been disposed');if(this.bypassed)return this;
    this.input.disconnect();this.cab.disconnect();this.safetyVolume.disconnect();this.safety.disconnect();this.safetyCompensate.disconnect();this.preEffects?.dispose();this.postEffects?.dispose();this.preEffects=null;this.postEffects=null;
    this.input.connect(this.output);this.output.gain.value=1;this.identity=null;this.bypassed=true;this.auditionPlan={effects:[],disclosures:[]};this.disclosures=[];return this;
  }
  connect(destination){this.output.connect(destination);return this;}
  dispose(){if(this.disposed)return;this.disposed=true;this.preEffects?.dispose();this.postEffects?.dispose();this.preEffects=null;this.postEffects=null;for(const node of [this.input,this.output,this.bass,this.treble,this.drive,this.cab,this.safetyVolume,this.safety,this.safetyCompensate])node.disconnect();}

}
