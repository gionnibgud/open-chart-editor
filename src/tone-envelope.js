// original experiment. No native DSP code or assets.
// One-pole filter slopes, sensitivity mapping, hysteresis and gate timing are
// original choices. Factual control names/ranges come from the local catalog.
export const ENVELOPE_LIMITS=Object.freeze({maxChannels:2,maxFrames:4096,minRate:8000,maxRate:384000,maxInput:8});
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const AUTO_FILTERS=new Set(['Bass_Pedal_BassAutoFilter','Pedal_AutoFilter','Pedal_BobFilter','Rack_SynthFilter']);
const WAH=new Set(['Bass_Pedal_BassWah','Pedal_ModernWah','Pedal_UKWah','Pedal_USWah','Rack_StudioWahFilter']);
export function compileEnvelopeGear(gear,definition,{slot='PrePedal1'}={}){
 if(!gear||!definition||definition.key!==gear.Key)throw Error('Matching factual gear metadata is required');
 const used=new Set(),invalid=[],design=[],control=suffix=>definition.knobs.find(k=>k.key===definition.key+'_'+suffix);
 const read=(suffix,fallback)=>{const k=control(suffix);if(!k)return fallback;used.add(k.key);const v=gear.KnobValues?.[k.key];if(!Number.isFinite(v)||v<k.min||v>k.max||(k.choices&&(!Number.isInteger((v-k.min)/k.step)))){invalid.push(k.key);return fallback;}return v;};
 const normalized=(suffix,fallback)=>{const k=control(suffix);return k?clamp((read(suffix,k.min)-k.min)/(k.max-k.min||1),0,1):fallback;};
 const choice=suffix=>{const k=control(suffix),v=read(suffix,k?.min);return k?.choices?.[(v-k.min)/k.step]?.trim().toLowerCase();};
 const sensitivity=()=>.25*64**normalized('Sens',.5);
 let effect=null,handled=false,reason='No original envelope model for this gear';
 if(gear.Key==='Pedal_NoiseGate'){
  handled=true;
  effect={kind:'gate',thresholdDb:read('Thresh',-65),release:.01+.49*normalized('Rate',.5),attack:.001,hysteresisDb:2,hold:.02};
  design.push('Original stereo-linked peak follower, 1ms attack, 20ms hold and 2dB hysteresis; Rate maps to an original 10..500ms release.');
 }else if(AUTO_FILTERS.has(gear.Key)){
  handled=true;
  const mode=choice(gear.Key==='Pedal_BobFilter'?'Filter':'FilterType'),bass=gear.Key.startsWith('Bass_');
  if(!['lp','bp','hp'].includes(mode))reason='Unknown LP/BP/HP choice';
  else effect={kind:'filter',mode:({lp:'lowpass',bp:'bandpass',hp:'highpass'})[mode],attack:read('Attack',10)/1000,release:read('Release',150)/1000,sensitivity:sensitivity(),minHz:bass?60:100,maxHz:bass?2200:6000,mix:read(control('Mix')?'Mix':'Res',50)/100};
  design.push('Original first-order envelope filter; catalog Mix is wet/dry even where its native key ends in Res. Sensitivity scales detection 0.25..16; original cutoff ranges are 60..2200Hz bass or 100..6000Hz guitar. No native resonance or slope claim.');
 }else if(WAH.has(gear.Key)){
  const auto=choice('Auto');handled=auto==='on'||invalid.length>0;
  if(auto!=='on')reason='Manual mode belongs to the existing manual filter model';
  else{const bass=gear.Key.startsWith('Bass_'),hasAttack=!!control('Attack'),hasRelease=!!control('Release');
   effect={kind:'filter',mode:'bandpass',attack:hasAttack?read('Attack',10)/1000:.01,release:hasRelease?read('Release',150)/1000:.02+.48*normalized('Speed',.5),sensitivity:sensitivity(),minHz:bass?150:300,maxHz:bass?1800:2400,mix:1};
   design.push('Original linked envelope-driven first-order bandpass; manual Pedal is inactive in Auto mode. Missing attack uses original10ms; unitless Speed maps to original20..500ms release. Native wah tracking and response are unknown.');
  }
 }
 if(invalid.length){effect=null;reason='Invalid catalog controls; entire gear bypassed';}
 return {handled,effect:effect?{slot,key:gear.Key,...effect}:null,disclosure:{slot,key:gear.Key,kind:effect?'approximate':'bypassed',message:effect?'Original envelope audition; native DSP differs':reason,usedControls:[...used],invalidControls:invalid,unmappedControls:definition.knobs.filter(k=>!used.has(k.key)).map(k=>k.key),originalDesign:design}};
}
export class EnvelopeProcessor{
 constructor(effect,{sampleRate=48000,channels=2}={}){
  if(!Number.isFinite(sampleRate)||sampleRate<8000||sampleRate>384000||![1,2].includes(channels))throw Error('Choose a bounded sample rate and one or two channels');
  if(!effect||!['gate','filter'].includes(effect.kind))throw Error('Choose an envelope gate or filter');
  const required=effect.kind==='gate'?['thresholdDb','release','attack','hysteresisDb','hold']:['release','attack','sensitivity','minHz','maxHz','mix'];
  if(required.some(k=>!Number.isFinite(effect[k])))throw Error('Envelope controls must be finite');
  if(effect.attack<0||effect.attack>1||effect.release<.001||effect.release>2)throw Error('Envelope timing is out of bounds');
  if(effect.kind==='gate'&&(effect.thresholdDb< -120||effect.thresholdDb>0||effect.hysteresisDb<0||effect.hysteresisDb>12||effect.hold<0||effect.hold>.5))throw Error('Gate controls are out of bounds');
  if(effect.kind==='filter'&&(!['lowpass','highpass','bandpass'].includes(effect.mode)||effect.sensitivity<0||effect.sensitivity>16||effect.minHz<20||effect.maxHz<effect.minHz||effect.maxHz>20000||effect.mix<0||effect.mix>1))throw Error('Filter controls are out of bounds');
  this.effect=Object.freeze({...effect});this.sampleRate=sampleRate;this.channels=channels;this.low=new Float64Array(channels);this.high=new Float64Array(channels);this.attack=effect.attack?Math.exp(-1/(effect.attack*sampleRate)):0;this.release=Math.exp(-1/(effect.release*sampleRate));this.openThreshold=10**((effect.thresholdDb??-60)/20);this.closeThreshold=this.openThreshold*10**(-(effect.hysteresisDb??2)/20);this.stats={frames:0,envelope:0,gain:0,invalidSamples:0};this.reset();
 }
 reset(){this.envelope=0;this.gain=0;this.open=false;this.holdFrames=0;this.frames=0;this.invalidSamples=0;this.coefficient=0;this.highCoefficient=0;this.low.fill(0);this.high.fill(0);this.stats.frames=0;this.stats.envelope=0;this.stats.gain=0;this.stats.invalidSamples=0;}
 process(inputs,outputs){
  if(!Array.isArray(inputs)||!Array.isArray(outputs)||inputs.length!==this.channels||outputs.length!==this.channels)throw Error('Provide owned Float32 input/output channels');
  const size=inputs[0]?.length;if(!Number.isInteger(size)||size>4096)throw Error('Use separate equally sized channel buffers up to4096 frames');for(let c=0;c<this.channels;c++){if(!(inputs[c] instanceof Float32Array)||!(outputs[c] instanceof Float32Array)||inputs[c].length!==size||outputs[c].length!==size)throw Error('Use equally sized Float32 channel buffers');for(let d=0;d<this.channels;d++)if(outputs[c].buffer===inputs[d]?.buffer)throw Error('Input/output buffers must be separate');}
  const e=this.effect,openThreshold=this.openThreshold,closeThreshold=this.closeThreshold;
  for(let i=0;i<size;i++){
   let peak=0;for(let c=0;c<this.channels;c++){const v=inputs[c][i];if(!Number.isFinite(v))this.invalidSamples++;else peak=Math.max(peak,Math.min(8,Math.abs(v)));}
   const coefficient=peak>this.envelope?this.attack:this.release;this.envelope=peak+coefficient*(this.envelope-peak);if(this.envelope<1e-20)this.envelope=0;
   if(e.kind==='gate'){
    if(this.envelope>=openThreshold){this.open=true;this.holdFrames=Math.round(e.hold*this.sampleRate);}else if(this.holdFrames>0)this.holdFrames--;else if(this.envelope<=closeThreshold)this.open=false;
    const target=this.open?1:0,smooth=target>this.gain?this.attack:this.release;this.gain=target+smooth*(this.gain-target);if(this.gain<1e-20)this.gain=0;
   }else if(this.frames%16===0){
    const position=Math.sqrt(clamp(this.envelope*e.sensitivity,0,1)),frequency=clamp(e.minHz*(e.maxHz/e.minHz)**position,20,this.sampleRate*.4);
    this.coefficient=1-Math.exp(-2*Math.PI*frequency/this.sampleRate);this.highCoefficient=1-Math.exp(-2*Math.PI*Math.min(frequency*Math.SQRT2,this.sampleRate*.45)/this.sampleRate);
   }
   for(let c=0;c<this.channels;c++){
    const raw=inputs[c][i],x=Number.isFinite(raw)?clamp(raw,-8,8):0;let y;
    if(e.kind==='gate')y=x*this.gain;
    else{this.low[c]+=this.coefficient*(x-this.low[c]);if(Math.abs(this.low[c])<1e-20)this.low[c]=0;let wet=this.low[c];if(e.mode==='highpass')wet=x-wet;else if(e.mode==='bandpass'){const hp=x-wet;this.high[c]+=this.highCoefficient*(hp-this.high[c]);if(Math.abs(this.high[c])<1e-20)this.high[c]=0;wet=2*this.high[c];}y=x*(1-e.mix)+wet*e.mix;}
    outputs[c][i]=clamp(y,-8,8);
   }this.frames++;
  }this.stats.frames=this.frames;this.stats.envelope=this.envelope;this.stats.gain=this.gain;this.stats.invalidSamples=this.invalidSamples;return this.stats;
 }
}
