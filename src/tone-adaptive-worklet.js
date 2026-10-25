// original experiment; loaded only by explicit preparation.
import {EnvelopeProcessor} from './tone-envelope.js';
import {BitCrusherProcessor} from './tone-crusher.js';
class OCEEnvelope extends AudioWorkletProcessor{
 static get parameterDescriptors(){return[{name:'run',defaultValue:1,minValue:0,maxValue:1,automationRate:'k-rate'}];}
 constructor(options){super();this.running=true;this.inputs=[null,null];this.zero=new Float32Array(128);const effect=options.processorOptions.effect,Core=effect.kind==='crusher'?BitCrusherProcessor:EnvelopeProcessor;this.core=new Core(effect,{sampleRate,channels:2});
  this.port.onmessage=event=>{if(event.data?.type==='stop')this.running=false;else if(event.data?.type==='stats')this.port.postMessage({type:'stats',frames:this.core.frames,envelope:this.core.envelope,gain:this.core.gain,invalidSamples:this.core.invalidSamples});};
 }
 process(inputs,outputs,parameters){
  const out=outputs[0];if(!out?.length)return this.running;
  if(!this.running||parameters?.run?.[0]===0){for(const channel of out)channel.fill(0);try{this.port.postMessage({type:'stopped',frames:this.core.frames});}catch{}return false;}
  try{if(out.length!==2||out[0].length>4096)throw Error('Unsupported bounded render quantum');if(this.zero.length!==out[0].length)this.zero=new Float32Array(out[0].length);
   this.inputs[0]=inputs[0]?.[0]||this.zero;this.inputs[1]=inputs[0]?.[1]||this.zero;this.core.process(this.inputs,out);return true;
  }catch(error){for(const channel of out)channel.fill(0);this.running=false;this.port.postMessage({type:'error',message:String(error.message)});return false;}
 }
}
registerProcessor('oce-adaptive-v1',OCEEnvelope);
