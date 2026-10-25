// Original audition-only filters. Catalog IDs, labels and ranges are
// interoperability facts; filter slopes/Q and manual wah ranges below are our
// generic design, not reconstructed branded/native DSP or factory presets.
import {EFFECT_SLOT_ORDER} from './tone-effects.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const GRAPHIC=new Set(['Pedal_EQ5','Pedal_EQ8','Bass_Pedal_BassEQ8']);
const PARAMETRIC=new Set(['Rack_StudioEQ','Rack_StudioGraphicEQ']);
const MANUAL_WAH=new Set(['Bass_Pedal_BassWah','Pedal_ModernWah','Pedal_UKWah','Pedal_USWah','Rack_StudioWahFilter']);
export const FILTER_LIMITS=Object.freeze({maxStages:12,maxBandsPerStage:8,maxNodes:110,maxGainDb:15,minQ:.25,maxQ:8});
function sampleRate(value){if(!Number.isFinite(value)||value<8000||value>384000)throw Error('Filter audition requires a sample rate from8000 to384000 Hz');return value;}
export function compileFilterGear(gear,definition,{slot='PrePedal1',sampleRate:rate=48000}={}){
 sampleRate(rate);
 if(!definition||definition.category!=='Filter'||definition.key!==gear?.Key)throw Error('Matching Filter catalog metadata is required');
 const used=new Set(),inactive=new Set(),invalid=[],limited=[],design=[],bands=[];
 const control=suffix=>definition.knobs.find(k=>k.key===definition.key+'_'+suffix);
 const read=suffix=>{const k=control(suffix);if(!k)throw Error('Missing catalog control '+suffix);used.add(k.key);const v=gear.KnobValues?.[k.key];if(!Number.isFinite(v)||v<k.min||v>k.max||(k.choices?.length&&(!(k.step>0)||!Number.isInteger((v-k.min)/k.step)))){invalid.push(k.key);return k.min;}return v;};
 const norm=suffix=>{const k=control(suffix),v=read(suffix);return (v-k.min)/(k.max-k.min||1);};
 const choice=suffix=>{const k=control(suffix),v=read(suffix);return k.choices?.[(v-k.min)/k.step]?.trim().toLowerCase();};
 const hz=suffix=>{const k=control(suffix),v=read(suffix);if(k.unit?.toLowerCase()==='hz')return v;if(k.unit?.toLowerCase()==='khz')return v*1000;throw Error('No factual Hz unit for '+k.key);};
 const add=(type,frequency,gain=0,Q=1,frequencySource='catalog',controls=[])=>{const effective=clamp(frequency,20,rate*.45);if(effective!==frequency)limited.push({controls,requestedHz:frequency,effectiveHz:effective});bands.push({type,frequency:effective,requestedFrequency:frequency,gain,Q,frequencySource,controls});};
 let supported=true,reason=null;
 if(GRAPHIC.has(definition.key)){
  design.push('Independent peaking bands use original fixed Q=1; native bandwidth/phase response is unestablished.');
  for(const k of definition.knobs){const label=k.label.match(/^([\d.]+)\s*(k?hz)$/i);if(!label||k.unit?.toLowerCase()!=='db')throw Error('Graphic EQ lacks factual Hz/dB metadata');const frequency=Number(label[1])*(label[2].toLowerCase()==='khz'?1000:1);const suffix=k.key.slice(definition.key.length+1);add('peaking',frequency,read(suffix),1,'catalog-label',[k.key]);}
 }else if(PARAMETRIC.has(definition.key)){
  const graphic=definition.key==='Rack_StudioGraphicEQ';
  design.push('Original low/high shelves and peaking middle bands; native filter slopes are unestablished.');
  if(!graphic)design.push('Wide/Narrow catalog choices map to original Q=0.7/2.8, not known native numeric Q.');
  for(const name of graphic?['Bass','LoMid','Mid','HiMid','Treble']:['Bass','LoMid','HiMid','Treble']){
   const frequency=hz(name+'Freq'),gain=read(name);let Q=1;
   if(!graphic&&['LoMid','HiMid'].includes(name)){const width=choice(name+'Q');if(width==='wide')Q=.7;else if(width==='narrow')Q=2.8;else{supported=false;reason='Unknown Q choice; native settings retained and audition bypassed';}}
   add(name==='Bass'?'lowshelf':name==='Treble'?'highshelf':'peaking',frequency,gain,Q,'catalog',[control(name+'Freq').key,control(name).key,...(!graphic&&['LoMid','HiMid'].includes(name)?[control(name+'Q').key]:[])]);
  }
 }else if(MANUAL_WAH.has(definition.key)){
  const auto=choice('Auto');
  if(auto!=='off'){supported=false;reason='Automatic/envelope wah is not implemented; this entire gear is bypassed, without substituting a manual sound';inactive.add(control('Pedal').key);}
  else{
   const t=norm('Pedal'),low=definition.key.startsWith('Bass_')?150:300,high=definition.key.startsWith('Bass_')?1800:2400;
   add('bandpass',low*(high/low)**t,0,2,'original-design',[control('Auto').key,control('Pedal').key]);
   for(const k of definition.knobs)if(!used.has(k.key))inactive.add(k.key);
   design.push(`Original manual logarithmic ${low}..${high} Hz bandpass with Q=2. Native wah frequency range and response are unknown. Sensitivity/rate/envelope controls are inactive in manual mode.`);
  }
 }else if(definition.key==='Pedal_LoFiFilter'){
  const hi=norm('FilterType'),lo=norm('Mix');
  add('highpass',20*(1500/20)**lo,0,.7,'original-design',[control('Mix').key]);
  add('lowpass',18000*(1800/18000)**hi,0,.7,'original-design',[control('FilterType').key]);
  design.push('Catalog labels mean Hi Cut/Lo Cut despite the native key suffixes FilterType/Mix. Original logarithmic cutoff ranges: high-cut18k..1.8kHz; low-cut20..1500Hz. No wet/dry interpretation.');
 }else{supported=false;reason='No original audition model for this Filter gear; native definition retained unchanged';}
 if(invalid.length){supported=false;reason='Invalid catalog control values; entire filter gear bypassed';}
 const disclosure={slot,key:definition.key,label:definition.label,kind:supported?'approximate':'bypassed',message:supported?'Original generic filter audition; branded/native DSP differs':reason,usedControls:[...used],inactiveControls:[...inactive],unmappedControls:definition.knobs.filter(k=>!used.has(k.key)&&!inactive.has(k.key)).map(k=>k.key),invalidControls:invalid,frequencyLimits:limited,originalDesign:design};
 return {effect:supported?{slot,key:definition.key,label:definition.label,kind:'filter',mix:1,bands}:null,disclosure};
}
export function compileToneFilters(tone,catalog,options={}){
 if(!Array.isArray(catalog))throw Error('Filter catalog is required');const effects=[],disclosures=[];
 for(const slot of EFFECT_SLOT_ORDER){const gear=tone?.GearList?.[slot],definition=catalog.find(g=>g.key===gear?.Key);if(definition?.category!=='Filter')continue;const result=compileFilterGear(gear,definition,{...options,slot});if(result.effect)effects.push(result.effect);disclosures.push(result.disclosure);}
 return{effects,disclosures,sourcePreserved:true};
}
function ceilingCurve(){return Float32Array.from({length:1025},(_,i)=>{const x=i/512-1,a=Math.abs(x);return a<=.5?x:Math.sign(x)*(.5+.45*Math.tanh((a-.5)/.45));});}
export class ToneFilterRack{
 constructor(context,plan,{maxNodes=FILTER_LIMITS.maxNodes}={}){
  sampleRate(context?.sampleRate);if(!Array.isArray(plan?.effects)||plan.effects.length>12||!Number.isInteger(maxNodes)||maxNodes<2||maxNodes>110)throw Error('Invalid bounded filter rack plan');
  this.context=context;this.nodes=[];this.stages=[];this.disposed=false;this.maxNodes=maxNodes;
  try{this.input=this.make(()=>context.createGain());this.output=this.make(()=>context.createGain());let previous=this.input;
   for(const effect of plan.effects){if(effect.kind!=='filter'||!Array.isArray(effect.bands)||!effect.bands.length||effect.bands.length>8)throw Error('Unsupported bounded filter stage');
    const stage=[];for(const b of effect.bands){if(!['peaking','lowshelf','highshelf','lowpass','highpass','bandpass'].includes(b.type)||![b.frequency,b.gain,b.Q].every(Number.isFinite)||Math.abs(b.gain)>15||b.Q<.25||b.Q>8||b.frequency<20)throw Error('Invalid finite filter band');const node=this.make(()=>context.createBiquadFilter());node.type=b.type;node.frequency.value=clamp(b.frequency,20,context.sampleRate*.45);node.gain.value=b.gain;node.Q.value=b.Q;previous.connect(node);previous=node;stage.push(node);}
    // Original per-stage guard prevents extreme multi-EQ stacks from growing
    // between stages. It is audition-only; normal tone JSON is never rewritten.
    const guard=this.make(()=>context.createWaveShaper());guard.curve=ceilingCurve();guard.oversample='none';previous.connect(guard);previous=guard;stage.push(guard);this.stages.push(stage);
   }previous.connect(this.output);
  }catch(error){this.dispose();throw error;}
 }
 make(factory){if(this.nodes.length>=this.maxNodes)throw Error('Filter audition node budget exceeded');const node=factory();this.nodes.push(node);return node;}
 connect(destination){if(this.disposed)throw Error('Filter rack disposed');this.output.connect(destination);return this;}
 dispose(){if(this.disposed)return;this.disposed=true;for(const node of this.nodes)try{node.disconnect();}catch{}this.nodes=[];this.stages=[];}
}
