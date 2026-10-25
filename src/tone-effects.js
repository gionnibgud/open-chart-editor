// Original audition-only effects. Branded/native tone definitions stay unchanged.
// Catalog ranges are interoperability metadata; these mappings are deliberately
// generic and do not reproduce branded/native DSP. Source tones are read-only.
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export const EFFECT_SLOT_ORDER=[...Array.from({length:4},(_,i)=>`PrePedal${i+1}`),...Array.from({length:4},(_,i)=>`PostPedal${i+1}`),...Array.from({length:4},(_,i)=>`Rack${i+1}`)];
export function compileToneEffects(tone,catalog){
 if(!Array.isArray(catalog))throw Error('A factual gear descriptor catalog is required');
 const effects=[],disclosures=[];
 for(const slot of EFFECT_SLOT_ORDER){const gear=tone?.GearList?.[slot];if(!gear)continue;const definition=catalog.find(d=>d.key===gear.Key),used=new Set(),invalid=[];
  if(!definition){disclosures.push({slot,key:gear.Key,kind:'bypassed',message:'Unknown gear; stored definition retained, audition bypassed'});continue;}
  const get=(suffix,fallback)=>{const control=definition.knobs.find(k=>k.key.endsWith('_'+suffix));if(!control)return fallback;used.add(control.key);let value=gear.KnobValues?.[control.key];if(!Number.isFinite(value)||value<control.min||value>control.max){invalid.push(control.label);return fallback;}return value;};
  const normalized=(suffix,fallback)=>{const control=definition.knobs.find(k=>k.key.endsWith('_'+suffix));if(!control)return fallback;return clamp((get(suffix,control.min)-(control.min))/(control.max-control.min||1),0,1);};
  const rate=()=>{const control=definition.knobs.find(k=>k.key.endsWith('_Rate')||k.key.endsWith('_Speed'));if(!control)return 1;const suffix=control.key.split('_').at(-1);return control.unit?.toLowerCase()==='hz'?clamp(get(suffix,1),.05,10):.1+normalized(suffix,.3)*9.9;};
  const mix=()=>clamp(get('Mix',50)/100,0,1),filter=(suffix='Filter')=>150+normalized(suffix,.75)*10000;
  let effect=null;const common={slot,key:gear.Key,label:definition.label};
  if(definition.category==='Delay'){
   effect={...common,kind:'delay',time:clamp(get('Time',get('TimeL',250))/1000,.001,2),timeRight:clamp(get('TimeR',get('Time',get('TimeL',250)))/1000,.001,2),feedback:clamp(get('Feedback',25)/100,0,.85),mix:mix(),filter:filter(),depth:normalized('Depth',0)*.003,rate:rate()};
   const f=definition.knobs.find(k=>k.key.endsWith('_Filter'));if(f?.unit==='enum')effect.filter=[1600,4000,10000][Math.round(get('Filter',1))]||4000;
  }else if(definition.category==='Reverb')effect={...common,kind:'reverb',seconds:.15+normalized('Time',.35)*3.85,depth:normalized('Depth',.5),mix:mix(),filter:filter('Tone'),voice:get('Voice',0)};
  else if(definition.category==='Modulation'&&/chorus|flang|phas/i.test(gear.Key))effect={...common,kind:/chorus/i.test(gear.Key)?'chorus':/flang/i.test(gear.Key)?'flanger':'phaser',rate:rate(),depth:normalized('Depth',.5),mix:mix(),feedback:clamp(get('Regen',0)/100,0,.75),lowFilter:40+normalized('LoFilter',0)*600,filter:definition.knobs.some(k=>k.key.endsWith('_HiFilter'))?filter('HiFilter'):filter(),delay:.004+normalized('Delay',.5)*.024,tone:filter('Tone')};
  else if(definition.category==='Tremolo'&&/Trem/i.test(gear.Key)&&!/Auto|TremOle/i.test(gear.Key))effect={...common,kind:'tremolo',rate:rate(),depth:normalized('Depth',1),mix:mix(),wave:get('Waveform',0)};
  else if(definition.category==='Dynamics'&&/StudioCompressor|Pedal_Compression|Limiter/.test(gear.Key))effect={...common,kind:'compressor',threshold:get('Threshold',-6-normalized('Comp',normalized('Limit',.5))*42),ratio:[1.5,2,4,8,20][Math.round(get('Ratio',2))]||4,attack:clamp(get('Attack',10)/1000,0,.25),release:clamp(get('Release',50+normalized('Rate',.5)*500)/1000,.01,1)};
  if(!effect){disclosures.push({...common,kind:'bypassed',message:'No original audition model for this gear; stored settings retained'});continue;}
  effects.push(effect);const unmapped=definition.knobs.filter(k=>!used.has(k.key)).map(k=>k.label);disclosures.push({...common,kind:'approximate',message:'Original generic '+effect.kind+' audition; branded/native DSP differs',unmappedControls:unmapped,invalidControls:invalid});
 }
 return {effects,disclosures,sourcePreserved:true};
}
export function originalReverbImpulse(context,{seconds,depth=.5,filter=6000,voice=0}){
 const rate=context.sampleRate,length=Math.ceil(clamp(seconds,.15,4)*rate),buffer=context.createBuffer(2,length,rate);let seed=(0x7843abcd+Math.round(voice)*197)>>>0,energy=0;
 const coefficient=1-Math.exp(-2*Math.PI*clamp(filter,100,rate*.45)/rate);
 for(let c=0;c<2;c++){const data=buffer.getChannelData(c);let previous=0;for(let i=0;i<length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;const noise=(seed>>>0)/2147483648-1,decay=Math.exp(-6.91*i/length),density=.1+.9*clamp(depth,0,1);previous+=coefficient*(noise-previous);const sample=previous*decay*(i%11<1+density*10?1:0);data[i]=sample;energy+=sample*sample;}data[0]=0;}
 const scale=.8/Math.sqrt(Math.max(1e-12,energy/2));for(let c=0;c<2;c++){const data=buffer.getChannelData(c);for(let i=0;i<length;i++)data[i]*=scale;}return buffer;
}
export class ToneEffectRack{
 constructor(context,plan,{maxImpulseBytes=32*1024*1024,createFilterRack=null,createAdaptiveRack=null,createModulationRack=null,onStatus=()=>{}}={}){
  if(!context||!plan?.effects||plan.effects.length>12)throw Error('Invalid bounded effect plan');this.context=context;this.nodes=[];this.oscillators=[];this.filterRacks=[];this.childRacks=[];this.createFilterRack=createFilterRack;this.createAdaptiveRack=createAdaptiveRack;this.createModulationRack=createModulationRack;this.onStatus=event=>{try{onStatus(event);}catch{}};this.disposed=false;this.input=this.node(context.createGain());this.output=this.node(context.createGain());this.disclosures=structuredClone(plan.disclosures||[]);this.stages=[];let previous=this.input,impulseBytes=0;
  try{for(const effect of plan.effects){if(Object.values(effect).some(v=>typeof v==='number'&&!Number.isFinite(v)))throw Error('Nonfinite effect parameter');if(effect.kind==='reverb'){impulseBytes+=Math.ceil(clamp(effect.seconds,.15,4)*context.sampleRate)*8;if(impulseBytes>maxImpulseBytes){this.disclosures.push({slot:effect.slot,kind:'bypassed',message:'Reverb memory budget exceeded; audition bypassed'});continue;}}
   const stage=this.build(effect);if(!stage)continue;previous.connect(stage.input);previous=stage.output;this.stages.push(stage);
  }previous.connect(this.output);}catch(error){this.dispose();throw error;}
 }
 node(value){this.nodes.push(value);return value;}
 get nodeCount(){return this.nodes.length+this.childRacks.reduce((sum,rack)=>sum+(rack.nodeCount??rack.nodes.length),0);}
 gain(value=1){const n=this.node(this.context.createGain());n.gain.value=value;return n;}
 filter(type,frequency){const n=this.node(this.context.createBiquadFilter());n.type=type;n.frequency.value=clamp(frequency,20,this.context.sampleRate*.45);n.Q.value=.7;return n;}
 lfo(rate,depth,param,wave='sine'){const source=this.node(this.context.createOscillator()),gain=this.gain(depth);source.type=wave.startsWith('pulse-')?'sawtooth':wave;source.frequency.value=clamp(rate,.05,10);
 if(wave.startsWith('pulse-')){const shaper=this.node(this.context.createWaveShaper()),threshold=wave==='pulse-short'?.5:-.5;shaper.curve=Float32Array.from({length:2048},(_,i)=>i*2/2047-1>threshold?1:-1);source.connect(shaper);shaper.connect(gain);}else source.connect(gain);gain.connect(param);source.start();this.oscillators.push(source);return source;}
 build(e){const context=this.context,input=this.gain(),output=this.gain(),stage={input,output,kind:e.kind};
  if(e.kind==='filter'){if(typeof this.createFilterRack!=='function')throw Error('Filter audition factory is unavailable');const rack=this.createFilterRack(context,e);if(!rack?.input||!rack?.output||typeof rack.dispose!=='function'||!Array.isArray(rack.nodes)||rack.nodes.length>11){rack?.dispose?.();throw Error('Invalid bounded filter child rack');}this.filterRacks.push(rack);this.childRacks.push(rack);input.connect(rack.input);rack.output.connect(output);stage.filterRack=rack;return stage;}
  if(e.kind==='adaptive'||e.kind==='modulation'){
   let rack=null;try{
    const factory=e.kind==='adaptive'?this.createAdaptiveRack:this.createModulationRack;
    if(typeof factory!=='function')throw Error('Original '+e.kind+' audition factory is unavailable');
    const changed=event=>this.onStatus({...event,slot:e.slot,key:e.key});
    rack=factory(context,e,{onStatus:changed});
    const count=rack?.nodeCount??rack?.nodes?.length;
    if(!rack?.input||!rack?.output||typeof rack.dispose!=='function'||!Array.isArray(rack.nodes)||!Number.isInteger(count)||count<1||count>8)throw Error('Invalid bounded adaptive child rack');
    input.connect(rack.input);rack.output.connect(output);this.childRacks.push(rack);
    this.disclosures.push(...(rack.disclosures||[]));stage.childRack=rack;return stage;
   }catch(error){rack?.dispose?.();input.disconnect();input.connect(output);
    this.disclosures.push({slot:e.slot,key:e.key,kind:'bypassed',message:'Original '+e.kind+' audition bypassed: '+String(error.message||error)});
    return stage;
   }
  }
  if(e.kind==='compressor'){const n=this.node(context.createDynamicsCompressor());n.threshold.value=clamp(e.threshold,-60,0);n.knee.value=6;n.ratio.value=clamp(e.ratio,1,20);n.attack.value=clamp(e.attack,0,.25);n.release.value=clamp(e.release,.01,1);input.connect(n);n.connect(output);return stage;}
  const dry=this.gain(1-clamp(e.mix,0,1)),wet=this.gain(clamp(e.mix,0,1));input.connect(dry);dry.connect(output);wet.connect(output);
  if(e.kind==='delay'){
   const split=this.node(context.createChannelSplitter(2)),merge=this.node(context.createChannelMerger(2));input.channelCount=2;input.channelCountMode='explicit';input.connect(split);
   for(let c=0;c<2;c++){const delay=this.node(context.createDelay(2.1)),feedback=this.gain(clamp(e.feedback,0,.85)),filter=this.filter('lowpass',e.filter);delay.delayTime.value=clamp(c?e.timeRight:e.time,.001,2);split.connect(delay,c);delay.connect(filter);filter.connect(feedback);feedback.connect(delay);filter.connect(merge,0,c);if(e.depth>0)this.lfo(e.rate,Math.min(e.depth,delay.delayTime.value*.4),delay.delayTime);}
   merge.connect(wet);
  }else if(e.kind==='reverb'){const convolution=this.node(context.createConvolver());convolution.normalize=false;convolution.buffer=originalReverbImpulse(context,e);input.connect(convolution);convolution.connect(wet);}
  else if(e.kind==='chorus'||e.kind==='flanger'){
   const delay=this.node(context.createDelay(.1)),high=this.filter('highpass',e.lowFilter),low=this.filter('lowpass',Math.min(e.filter,e.tone)),feedback=this.gain(e.kind==='flanger'?clamp(e.feedback,0,.75):0);delay.delayTime.value=e.kind==='chorus'?clamp(e.delay,.004,.028):.004;input.connect(high);high.connect(delay);delay.connect(low);low.connect(wet);low.connect(feedback);feedback.connect(delay);this.lfo(e.rate,Math.min(delay.delayTime.value*.8,(e.kind==='chorus'?.008:.003)*clamp(e.depth,0,1)),delay.delayTime);
  }else if(e.kind==='phaser'){
   const high=this.filter('highpass',e.lowFilter),low=this.filter('lowpass',Math.min(e.filter,e.tone));input.connect(high);let previous=high;for(let i=0;i<4;i++){const center=[180,400,900,1800][i],filter=this.filter('allpass',center);previous.connect(filter);previous=filter;this.lfo(e.rate,center*.75*clamp(e.depth,0,1),filter.frequency);}previous.connect(low);low.connect(wet);
  }else if(e.kind==='tremolo'){const modulation=this.gain(1-clamp(e.depth,0,1)/2);input.connect(modulation);modulation.connect(wet);this.lfo(e.rate,clamp(e.depth,0,1)/2,modulation.gain,['sine','triangle','square','pulse-short','pulse-long'][e.wave]||'sine');}
  else{input.disconnect();dry.disconnect();wet.disconnect();this.disclosures.push({slot:e.slot,kind:'bypassed',message:'Unsupported candidate stage'});return null;}
  return stage;
 }
 connect(destination){this.output.connect(destination);return this;}
 dispose(){if(this.disposed)return;this.disposed=true;for(const rack of this.childRacks)rack.dispose();this.childRacks=[];this.filterRacks=[];for(const source of this.oscillators)try{source.stop();}catch{}for(const node of this.nodes){if('buffer'in node)try{node.buffer=null;}catch{}try{node.disconnect();}catch{}}this.oscillators=[];this.nodes=[];this.stages=[];}
}

// Compatibility alias for the original isolated verification harness.
export {ToneEffectRack as EffectRackCandidate};
