// Original local audition models: generic Swole compressor and explicitly PARTIAL
// Eden EQ. Native presets/DSP are not copied; native tone bytes remain read-only.
import {EFFECT_SLOT_ORDER} from './tone-effects.js';
const KEYS=new Set(['Pedal_Swole','Bass_Pedal_EdenWTDI']);
export function compileSwoleEdenGear(gear,definition,{slot='PrePedal1',sampleRate=48000}={}){
 if(!KEYS.has(gear?.Key)||definition?.key!==gear.Key||definition.category!==(gear.Key==='Pedal_Swole'?'Dynamics':'Filter'))return{handled:false,effect:null,disclosure:null};
 if(!Number.isFinite(sampleRate)||sampleRate<8000||sampleRate>384000)throw Error('Choose8000..384000Hz sample rate');
 const controls=definition.knobs;if(!Array.isArray(controls))throw Error('Factual knob catalog required');const invalid=[],used=new Set(),design=[];
 // Validate known unmapped controls too. Unknown extension values are retained,
 // listed as unmapped and never silently coerced/interpreted as native DSP.
 for(const control of controls){const value=gear.KnobValues?.[control.key];if(!Number.isFinite(value)||value<control.min||value>control.max||(control.unit==='enum'&&(!Number.isFinite(control.step)||control.step<=0||Math.abs((value-control.min)/control.step-Math.round((value-control.min)/control.step))>1e-5)))invalid.push(control.key);}
 const read=(suffix,label,unit,min,max)=>{const key=gear.Key+'_'+suffix,control=controls.find(c=>c.key===key);used.add(key);if(!control||control.label!==label||String(control.unit).toLowerCase()!==unit||control.min!==min||control.max!==max){invalid.push(key+' metadata');return min;}return gear.KnobValues?.[key];};
 const common={slot,key:gear.Key,label:definition.label};let effect;
 if(gear.Key==='Pedal_Swole'){
  const smash=(read('Smash','Smash','%',1,100)-1)/99,rate=(read('Rate','Rate','number',1,100)-1)/99;
  effect={...common,kind:'compressor',threshold:-6-30*smash,ratio:1+11*smash,attack:.005,release:.5*(.05/.5)**rate};
  design.push('Original generic compressor: Smash maps to threshold-6..-36dB/ratio1..12; original attack5ms and knee6dB. Existing browser compressor includes automatic makeup and fixed lookahead; no additional makeup stage is added. Unitless Rate controls only original logarithmic recovery500..50ms. These are not recovered native values; Smash is not calibrated monotonic output loudness.');
 }else{
  effect={...common,kind:'filter',mix:1,bands:[['Bass','Bass','lowshelf',80],['Mid','Mid','peaking',600],['Treble','Treble','highshelf',3500]].map(([suffix,label,type,frequency])=>({type,frequency,requestedFrequency:frequency,gain:read(suffix,label,'db',-12,12),Q:1,frequencySource:'original-design'}))};
  design.push('PARTIAL original three-band EQ only: actual authored Bass/Mid/Treble dB gains; original80/600/3500Hz anchors and Q=1. Native frequencies/response are unknown. Gain, Enhance, Bass Boost, Mid-Shift and Compression are stored but NOT modeled.');
 }
 const known=new Set(controls.map(c=>c.key)),unmapped=[...controls.filter(c=>!used.has(c.key)).map(c=>c.key),...Object.keys(gear.KnobValues||{}).filter(key=>!known.has(key))],disclosure={...common,kind:invalid.length?'bypassed':'approximate',message:invalid.length?'Invalid factual controls; entire gear bypassed':gear.Key==='Pedal_Swole'?'Original generic compressor audition; native Swole DSP differs':'PARTIAL original3-band EQ only; Eden preamp/enhance/shift/compression are NOT heard locally',usedControls:[...used],unmappedControls:unmapped,invalidControls:[...new Set(invalid)],originalDesign:design};
 return{handled:true,effect:invalid.length?null:effect,disclosure};
}
export function compileSwoleEden(tone,catalog,options={}){
 if(!Array.isArray(catalog))throw Error('Factual gear catalog required');const effects=[],disclosures=[],claimedSlots=[];
 for(const slot of EFFECT_SLOT_ORDER){const gear=tone?.GearList?.[slot];if(!KEYS.has(gear?.Key))continue;const result=compileSwoleEdenGear(gear,catalog.find(c=>c.key===gear.Key),{...options,slot});if(!result.handled)continue;claimedSlots.push(slot);if(result.effect)effects.push(result.effect);disclosures.push(result.disclosure);}return{effects,disclosures,claimedSlots};
}
export function mergeSwoleEden(base,extra){if(!extra.claimedSlots.length)return base;const claimed=new Set(extra.claimedSlots),index=slot=>{const i=EFFECT_SLOT_ORDER.indexOf(slot);return i<0?999:i;},sort=(a,b)=>index(a.slot)-index(b.slot);return{...base,effects:[...base.effects.filter(e=>!claimed.has(e.slot)),...extra.effects].sort(sort),disclosures:[...base.disclosures.filter(e=>!claimed.has(e.slot)),...extra.disclosures].sort(sort)};}
