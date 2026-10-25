// original audition. Factual labels/units, original rate/depth
// interpretations; no branded DSP, presets or native-definition mutations.
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const TREMOLO=new Set(['Pedal_AmpVibe','Pedal_MultiVibe','Rack_StereoAnalogVibe']);
export function compileAdditionalModulation(gear,definition,{slot='PrePedal1'}={}){
 if(!definition||definition.key!==gear?.Key)throw Error('Matching factual catalog metadata is required');
 const used=new Set(),invalid=[],design=[],control=s=>definition.knobs.find(k=>k.key===gear.Key+'_'+s);
 const read=(suffix,fallback)=>{const k=control(suffix);if(!k)return fallback;used.add(k.key);const v=gear.KnobValues?.[k.key];if(!Number.isFinite(v)||v<k.min||v>k.max||(k.choices&&!Number.isInteger((v-k.min)/k.step))){invalid.push(k.key);return fallback;}return v;};
 const normalized=s=>{const k=control(s),v=read(s,k?.min);return k?(v-k.min)/(k.max-k.min||1):0;};let effect=null;
 if(TREMOLO.has(gear.Key)){
  effect={kind:'tremolo',rate:.1+9.9*normalized('Speed'),depth:1,mix:read('Mix',50)/100,wave:read('Waveform',0)};
  design.push('Original full-depth amplitude tremolo; unitless Speed maps to0.1..10Hz. Short/Long square variants are original thresholded sine pulses; no native duty-cycle claim.');
 }else if(gear.Key==='Pedal_RingMod'){
  const rate=control('Attack'),mix=control('Sensitivity'),wave=control('Waveform');
  if(rate?.label!=='Rate'||rate.unit.toLowerCase()!=='ms'||mix?.label!=='Mix'||mix.unit!=='%'||!['Sine','Saw'].every((name,i)=>wave?.choices?.[i]===name))throw Error('RingMod requires factual Rate(ms), Mix(%) and Sine/Saw labels');
  effect={kind:'ringmod',rate:1000/read('Attack',50),depth:read('Depth',50)/100,mix:read('Sensitivity',50)/100,wave:read('Waveform',0)};
  design.push('Native key Attack is labelled Rate(ms): original audition interprets this as carrier period. Native Sensitivity is labelled Mix(%). Shared sine/saw carrier preserves channel coherence; native tracking is unestablished.');
 }
 if(invalid.length)effect=null;return {handled:TREMOLO.has(gear.Key)||gear.Key==='Pedal_RingMod',effect:effect?{slot,key:gear.Key,...effect}:null,disclosure:{slot,key:gear.Key,kind:effect?'approximate':'bypassed',message:effect?'Original modulation audition; native DSP differs':invalid.length?'Invalid controls; entire gear bypassed':'No candidate model for this gear',usedControls:[...used],invalidControls:invalid,unmappedControls:definition.knobs.filter(k=>!used.has(k.key)).map(k=>k.key),originalDesign:design}};
}
export class ToneModulationRack{
 constructor(context,effect){
  if(!effect||!['ringmod','tremolo'].includes(effect.kind)||![effect.rate,effect.depth,effect.mix,effect.wave].every(Number.isFinite)||effect.rate<.05||effect.rate>1000||effect.depth<0||effect.depth>1||effect.mix<0||effect.mix>1||!Number.isInteger(effect.wave)||effect.wave<0||effect.wave>(effect.kind==='ringmod'?1:4))throw Error('Choose finite bounded modulation controls');
  this.context=context;this.nodes=[];this.oscillators=[];this.disposed=false;
  const gain=value=>{const n=context.createGain();n.gain.value=value;this.nodes.push(n);return n;};
  try{this.input=gain(1);this.output=gain(1);const dry=gain(1-effect.mix),wet=gain(effect.mix),mod=gain(1-(effect.kind==='ringmod'?effect.depth:effect.depth/2)),depth=gain(effect.kind==='ringmod'?effect.depth:effect.depth/2);
   this.input.connect(dry);dry.connect(this.output);this.input.connect(mod);mod.connect(wet);wet.connect(this.output);
   const source=context.createOscillator();this.nodes.push(source);this.oscillators.push(source);source.frequency.value=effect.rate;const waves=effect.kind==='ringmod'?['sine','sawtooth']:['sine','triangle','square','sine','sine'];source.type=waves[effect.wave];
   if(effect.kind==='tremolo'&&effect.wave>=3){const shaper=context.createWaveShaper();this.nodes.push(shaper);const threshold=effect.wave===3?.5:-.5;shaper.curve=Float32Array.from({length:2048},(_,i)=>i*2/2047-1>threshold?1:-1);source.connect(shaper);shaper.connect(depth);}else source.connect(depth);
   depth.connect(mod.gain);source.start();
  }catch(error){this.dispose();throw error;}
 }
 get nodeCount(){return this.nodes.length;}
 connect(destination){if(this.disposed)throw Error('Modulation audition disposed');this.output.connect(destination);return this;}
 dispose(){if(this.disposed)return;this.disposed=true;for(const source of this.oscillators)try{source.stop();}catch{}for(const node of this.nodes)try{node.disconnect();}catch{}this.nodes=[];this.oscillators=[];}
}
