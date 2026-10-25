// UNALLOWLISTED original quantization/sample-hold experiment. Native key names
// are misleading: use factual catalog labels, never infer Attack/Release DSP.
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function compileBitCrusherCandidate(gear,definition,{slot='PrePedal1',sampleRate=48000}={}){
 if(gear?.Key!=='Pedal_BitCruncher'||definition?.key!==gear.Key)throw Error('Matching BitCruncher catalog is required');
 if(!Number.isFinite(sampleRate)||sampleRate<8000||sampleRate>384000)throw Error('Choose bounded audition sample rate');
 const labels={Mix:'Mix',Attack:'Filter',Release:'Downsample',FilterType:'Bit Depth',Sens:'Rectify'},values={},invalid=[],used=[];
 for(const[suffix,label]of Object.entries(labels)){const k=definition.knobs.find(k=>k.key===gear.Key+'_'+suffix);if(!k||k.label!==label)throw Error('Factual BitCruncher label changed: '+suffix);used.push(k.key);const v=gear.KnobValues?.[k.key];if(!Number.isFinite(v)||v<k.min||v>k.max)invalid.push(k.key);values[suffix]=v;}
 const filter=definition.knobs.find(k=>k.key.endsWith('_Attack')),rectify=definition.knobs.find(k=>k.key.endsWith('_Sens')),frequency=300*60**((values.Attack-filter.min)/(filter.max-filter.min));
 return{effect:invalid.length?null:{slot,key:gear.Key,kind:'crusher',bits:Math.round(values.FilterType),holdFrames:1+Math.round(values.Release),filterHz:Math.min(frequency,sampleRate*.45),rectify:(values.Sens-rectify.min)/(rectify.max-rectify.min),mix:values.Mix/100},disclosure:{slot,key:gear.Key,kind:invalid.length?'bypassed':'approximate',message:invalid.length?'Invalid controls; entire gear bypassed':'Original bit-crusher audition; native DSP differs',usedControls:used,invalidControls:invalid,unmappedControls:[],originalDesign:['Original signed mid-tread2..8-bit quantizer; fractional bit depth rounds only for audition. Downsample maps to1+round(value) sample-hold frames. Native Filter maps to original300..18000Hz first-order lowpass, bounded by sample rate. Rectify blends original signal toward absolute value. Quantization/sample-hold aliasing is intentional; no native distortion/filter claim.']}};
}
export class BitCrusherProcessorCandidate{
 constructor(effect,{sampleRate=48000,channels=2}={}){
  if(!Number.isFinite(sampleRate)||sampleRate<8000||sampleRate>384000||![1,2].includes(channels))throw Error('Choose bounded sample rate/channels');
  if(effect?.kind!=='crusher'||![effect.bits,effect.holdFrames,effect.filterHz,effect.rectify,effect.mix].every(Number.isFinite)||!Number.isInteger(effect.bits)||effect.bits<2||effect.bits>8||!Number.isInteger(effect.holdFrames)||effect.holdFrames<1||effect.holdFrames>33||effect.filterHz<20||effect.filterHz>20000||effect.rectify<0||effect.rectify>1||effect.mix<0||effect.mix>1)throw Error('Choose bounded finite crusher controls');
  this.effect=Object.freeze({...effect});this.sampleRate=sampleRate;this.channels=channels;this.held=new Float64Array(channels);this.low=new Float64Array(channels);this.coefficient=1-Math.exp(-2*Math.PI*Math.min(effect.filterHz,sampleRate*.45)/sampleRate);this.scale=2**(effect.bits-1);this.stats={frames:0,invalidSamples:0};this.reset();
 }
 reset(){this.held.fill(0);this.low.fill(0);this.remaining=0;this.frames=0;this.invalidSamples=0;this.stats.frames=0;this.stats.invalidSamples=0;}
 process(inputs,outputs){
  if(!Array.isArray(inputs)||!Array.isArray(outputs)||inputs.length!==this.channels||outputs.length!==this.channels)throw Error('Provide owned Float32 input/output channels');
  const size=inputs[0]?.length;if(!Number.isInteger(size)||size>4096)throw Error('Use separate equally sized buffers up to4096 frames');for(let c=0;c<this.channels;c++){if(!(inputs[c] instanceof Float32Array)||!(outputs[c] instanceof Float32Array)||inputs[c].length!==size||outputs[c].length!==size)throw Error('Use equally sized Float32 channel buffers');for(let d=0;d<this.channels;d++)if(outputs[c].buffer===inputs[d]?.buffer)throw Error('Input/output buffers must be separate');}
  const e=this.effect;for(let i=0;i<size;i++){
   for(let c=0;c<this.channels;c++){const raw=inputs[c][i],x=Number.isFinite(raw)?clamp(raw,-8,8):0;if(!Number.isFinite(raw))this.invalidSamples++;
    if(this.remaining===0){const limited=clamp(x,-1,1),rectified=limited*(1-e.rectify)+Math.abs(limited)*e.rectify;this.held[c]=clamp(Math.round(rectified*this.scale),-this.scale,this.scale-1)/this.scale;}
    this.low[c]+=this.coefficient*(this.held[c]-this.low[c]);if(Math.abs(this.low[c])<1e-20)this.low[c]=0;outputs[c][i]=clamp(x*(1-e.mix)+this.low[c]*e.mix,-8,8);
   }this.remaining=this.remaining===0?e.holdFrames-1:this.remaining-1;this.frames++;
  }this.stats.frames=this.frames;this.stats.invalidSamples=this.invalidSamples;return this.stats;
 }
}
