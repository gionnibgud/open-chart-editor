// UNALLOWLISTED async-prepared adapter. No microphone, hardware or network API
// calls at module import. Source tone/native definitions are never changed.
import {EnvelopeProcessorCandidate} from './tone-envelope-candidate.js';
import {BitCrusherProcessorCandidate} from './tone-crusher-candidate.js';
import {assertAdaptiveRetirementCapacityCandidate,retireAdaptiveNodeCandidate,adaptiveRetirementStatusCandidate} from './tone-retirement-candidate.js';
const prepared=new WeakMap();
export async function prepareToneEnvelopeCandidate(context,{retry=false}={}){
 if(!context?.audioWorklet?.addModule){const message='AudioWorklet envelope audition is unavailable';if(context&&(typeof context==='object'||typeof context==='function'))prepared.set(context,{state:'failed',message,promise:null});throw Error(message);}
 if(adaptiveRetirementStatusCandidate(context).unresolved)throw Error('Unacknowledged adaptive retirement requires audio context recreation');
 if(retry&&prepared.get(context)?.state==='failed')prepared.delete(context);
 if(prepared.get(context)?.state==='failed'&&prepared.get(context).promise===null)throw Error(prepared.get(context).message);
 if(!prepared.has(context)){
  const state={state:'preparing',message:'Preparing original envelope audition',promise:null};state.promise=Promise.resolve().then(()=>context.audioWorklet.addModule(new URL('./tone-envelope-worklet-candidate.js',import.meta.url).href)).then(()=>{state.state='ready';state.message='Original envelope audition ready';return true;},error=>{state.state='failed';state.message=String(error.message||error);throw error;});prepared.set(context,state);
 }return prepared.get(context).promise;
}
export const toneEnvelopeStatusCandidate=context=>{if(context?.state==='closed')return{state:'closed',message:'Audio context is closed; create a new context'};if(context&&adaptiveRetirementStatusCandidate(context).unresolved)return{state:'degraded',message:'Adaptive retirement was not acknowledged; recreate the audio context before using more adaptive gears'};const status=prepared.get(context);return status?{state:status.state,message:status.message}:{state:'unprepared',message:'Original envelope audition awaits explicit preparation'};};
export const toneEnvelopeReadyCandidate=context=>toneEnvelopeStatusCandidate(context).state==='ready';
export class ToneEnvelopeRackCandidate{
 constructor(context,effect,{onStatus=()=>{},NodeClass=globalThis.AudioWorkletNode,retirementTimeoutMs=1000}={}){
  if(context&&(typeof context==='object'||typeof context==='function'))assertAdaptiveRetirementCapacityCandidate(context);
  if(!toneEnvelopeReadyCandidate(context)||typeof NodeClass!=='function')throw Error('Prepare original envelope audition explicitly before constructing it');
  if(!Number.isInteger(retirementTimeoutMs)||retirementTimeoutMs<5||retirementTimeoutMs>2000)throw Error('Choose bounded retirement timeout');
  const fields=['kind','thresholdDb','release','attack','hysteresisDb','hold','mode','sensitivity','minHz','maxHz','mix','bits','holdFrames','filterHz','rectify'],dto=Object.fromEntries(fields.filter(key=>Object.hasOwn(effect,key)).map(key=>[key,effect[key]])),Core=dto.kind==='crusher'?BitCrusherProcessorCandidate:EnvelopeProcessorCandidate;new Core(dto,{sampleRate:context.sampleRate,channels:2});
  this.context=context;this.disposed=false;this.bypassed=false;this.nodes=[];this.onStatus=onStatus;this.retirementTimeoutMs=retirementTimeoutMs;this.retired=null;this.disclosures=[{slot:effect.slot,key:effect.key,kind:'approximate',message:'Original adaptive audition; native DSP differs'}];
  try{this.input=context.createGain();this.nodes.push(this.input);this.output=context.createGain();this.nodes.push(this.output);
   this.processor=new NodeClass(context,'oce-envelope-candidate-v1',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'explicit',processorOptions:{effect:dto}});this.nodes.push(this.processor);
   this.processor.port.onmessage=event=>{if(event.data?.type==='error')this.bypass(event.data.message);else this.onStatus(event.data);};this.processor.onprocessorerror=()=>this.bypass('Original envelope processor failed; this gear is bypassed');this.input.connect(this.processor);this.processor.connect(this.output);
  }catch(error){this.dispose();throw error;}
 }
 get nodeCount(){return this.nodes.length;}
 connect(destination){if(this.disposed)throw Error('Envelope audition is disposed');this.output.connect(destination);return this;}
 bypass(message){if(this.disposed||this.bypassed)return;this.input.disconnect();this.stopProcessor();this.input.connect(this.output);this.bypassed=true;this.disclosures[0].kind='bypassed';this.disclosures[0].message=String(message);this.onStatus({type:'bypassed',message});}
 stopProcessor(){if(!this.processor)return this.retired;const node=this.processor;this.nodes=this.nodes.filter(item=>item!==node);this.processor=null;this.retired=retireAdaptiveNodeCandidate(this.context,node,{timeoutMs:this.retirementTimeoutMs,onStatus:this.onStatus});return this.retired;}
 dispose(){if(this.disposed)return this.retired;this.disposed=true;this.stopProcessor();for(const node of this.nodes)try{node.disconnect();}catch{}this.nodes=[];return this.retired;}
}
