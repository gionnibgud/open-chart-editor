// UNALLOWLISTED original static audition candidates. Never native DSP/presets.
// Acoustic mid Hz comes from factual metadata. Shelf anchors, +/-12dB mapping
// and broad 0..12dB booster policy are original choices disclosed per gear.
import {ToneFilterRack} from './tone-filters.js';
import {EFFECT_SLOT_ORDER} from './tone-effects.js';
const KEYS=new Set(['Pedal_AcousticEmulator','Pedal_RangeBooster']);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function staticOutputCurveCandidate(){return Float32Array.from({length:1025},(_,i)=>{const x=i/512-1,a=Math.abs(x);return a<=.5?x:Math.sign(x)*(.5+.45*Math.tanh((a-.5)/.45));});}
export function compileStaticFilterGearCandidate(gear,definition,{slot='PrePedal1',sampleRate=48000}={}){
 if(!KEYS.has(gear?.Key))return{handled:false,effect:null,disclosure:null};
 if(!definition||definition.key!==gear.Key||definition.category!=='Filter'||!Array.isArray(definition.knobs))throw Error('Matching factual Filter metadata required');
 if(!Number.isFinite(sampleRate)||sampleRate<8000||sampleRate>384000)throw Error('Choose sampling rate8000..384000');
 const used=new Set(),invalid=[],limited=[],design=[],bands=[];
 const read=(suffix,label,unit)=>{const key=gear.Key+'_'+suffix,control=definition.knobs.find(k=>k.key===key);used.add(key);if(!control||control.label!==label||String(control.unit).toLowerCase()!==unit||!Number.isFinite(control.min)||!Number.isFinite(control.max)||control.max<=control.min){invalid.push(label+' metadata');return null;}const value=gear.KnobValues?.[key];if(!Number.isFinite(value)||value<control.min||value>control.max){invalid.push(label);return null;}return{control,value};};
 const normalized=(suffix,label)=>{const result=read(suffix,label,'number');return result?(result.value-result.control.min)/(result.control.max-result.control.min):.5;};
 const band=(type,requestedFrequency,gain,source)=>{const frequency=clamp(requestedFrequency,20,sampleRate*.45);if(frequency!==requestedFrequency)limited.push({requestedHz:requestedFrequency,effectiveHz:frequency});bands.push({type,frequency,gain,Q:1,frequencySource:source});};
 let gain=1;
 if(gear.Key==='Pedal_AcousticEmulator'){
  const body=normalized('Body','Body'),mid=normalized('Mid','Mid-range'),tone=normalized('Tone','Tone'),frequency=read('MidShift','Mid Frequency','hz');
  band('lowshelf',180,(body-.5)*24,'original-design');band('peaking',frequency?.value??750,(mid-.5)*24,'catalog-hz');band('highshelf',3500,(tone-.5)*24,'original-design');
  design.push('Original three-band EQ, not physical acoustic-instrument emulation. Unitless Body/Mid-range/Tone map linearly to-12..+12dB about authored midpoint50.5. Original shelf anchors180Hz/3500Hz and mid Q=1; only Mid Frequency uses factual authored Hz.');
 }else{
  const boost=read('Boost','Boost!','%');gain=10**(((boost?(boost.value-boost.control.min)/(boost.control.max-boost.control.min):0)*12)/20);
  design.push('Original broad-band gain: native Boost!1..100% maps to0..+12dB (unity at1%). Native gain range, spectral coloration and nonlinear response are unknown; this is not a frequency-range or amplifier emulation.');
 }
 const effect=invalid.length?null:{slot,key:gear.Key,label:definition.label,kind:'static-filter-candidate',gain,bands};
 const disclosure={slot,key:gear.Key,label:definition.label,kind:effect?'approximate':'bypassed',message:effect?'Original static audition candidate; native DSP differs. Per-stage soft ceiling can reduce peaks at high boost.':'Invalid factual controls; entire gear bypassed',usedControls:[...used],invalidControls:invalid,unmappedControls:definition.knobs.filter(k=>!used.has(k.key)).map(k=>k.key),frequencyLimits:limited,originalDesign:design};
 return{handled:true,effect,disclosure};
}
export function compileAdditionalStaticFiltersCandidate(tone,catalog,options={}){
 if(!Array.isArray(catalog))throw Error('Factual gear catalog required');const effects=[],disclosures=[],claimedSlots=[];
 for(const slot of EFFECT_SLOT_ORDER){const gear=tone?.GearList?.[slot];if(!KEYS.has(gear?.Key))continue;const definition=catalog.find(d=>d.key===gear.Key);if(definition?.category!=='Filter')continue;const result=compileStaticFilterGearCandidate(gear,definition,{...options,slot});claimedSlots.push(slot);if(result.effect)effects.push(result.effect);disclosures.push(result.disclosure);}return{effects,disclosures,claimedSlots};
}
export function mergeAdditionalStaticFiltersCandidate(base,extra){if(!extra.claimedSlots.length)return base;const claimed=new Set(extra.claimedSlots),position=slot=>{const i=EFFECT_SLOT_ORDER.indexOf(slot);return i<0?999:i;},sort=(a,b)=>position(a.slot)-position(b.slot);return{...base,effects:[...base.effects.filter(e=>!claimed.has(e.slot)),...extra.effects].sort(sort),disclosures:[...base.disclosures.filter(e=>!claimed.has(e.slot)),...extra.disclosures].sort(sort)};}
// Finite-signal scalar reference for real Waveshaper proof. Source samples are
// read-only. Table interpolation models the candidate's exact explicit curve.
export function rangeBoosterSampleCandidate(sample,effect,curve=staticOutputCurveCandidate()){
 if(!Number.isFinite(sample)||effect?.key!=='Pedal_RangeBooster'||!Number.isFinite(effect.gain)||effect.gain<1||effect.gain>4)throw Error('Finite range-booster reference required');
 const index=(clamp(sample*effect.gain,-1,1)+1)*.5*(curve.length-1),lo=Math.floor(index),hi=Math.min(curve.length-1,lo+1);return curve[lo]+(curve[hi]-curve[lo])*(index-lo);
}
export class StaticFilterRackCandidate{
 constructor(context,effect){
  if(!KEYS.has(effect?.key)||effect.kind!=='static-filter-candidate'||!Number.isFinite(effect.gain)||effect.gain<1||effect.gain>4||!Array.isArray(effect.bands)||effect.bands.length!==(effect.key==='Pedal_AcousticEmulator'?3:0))throw Error('Bounded static candidate plan required');
  this.context=context;this.nodes=[];this.filterRack=null;this.disposed=false;
  try{this.input=context.createGain();this.nodes.push(this.input);this.output=context.createGain();this.nodes.push(this.output);this.input.gain.value=effect.gain;
   if(effect.bands.length){this.filterRack=new ToneFilterRack(context,{effects:[{kind:'filter',bands:effect.bands}]});this.input.connect(this.filterRack.input);this.filterRack.connect(this.output);}
   else{const guard=context.createWaveShaper();this.nodes.push(guard);guard.curve=staticOutputCurveCandidate();guard.oversample='none';this.input.connect(guard);guard.connect(this.output);}
  }catch(error){this.dispose();throw error;}
 }
 get nodeCount(){return this.nodes.length+(this.filterRack?.nodes.length??0);}
 connect(destination){if(this.disposed)throw Error('Static candidate disposed');this.output.connect(destination);return this;}
 dispose(){if(this.disposed)return;this.disposed=true;this.filterRack?.dispose();this.filterRack=null;for(const node of this.nodes)try{node.disconnect();}catch{}this.nodes=[];}
}
