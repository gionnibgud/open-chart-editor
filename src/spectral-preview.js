import {spectralSourceRanges} from './spectral-source.js';
const modules=new WeakMap(),abortError=()=>Object.assign(new Error('Spectral preview cancelled'),{name:'AbortError'});
export class SpectralPreview{
 constructor({context,buffer,output,pitch=0,loop=null,sourceTimeAtOutput,onFailure=()=>{},onStatus=()=>{},workerFactory=()=>new Worker(new URL('./spectral-worker.js',import.meta.url),{type:'module'}),nodeFactory=context=>new AudioWorkletNode(context,'oce-spectral-preview-v1',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2]})}={}){Object.assign(this,{context,buffer,output,pitch,loop,sourceTimeAtOutput,onFailure,onStatus,workerFactory,nodeFactory});this.active=true;this.requests=new Map();this.serial=0;this.queueChunks=0;this.outputFrame=0;this.nextFrame=0;this.chunkFrames=4096;this.fftSize=4096;this.hopSize=512;this.pitchRate=2**(pitch/12);this.running=false;this.failed=false;}
 async prepare(){
  if(!this.context?.audioWorklet?.addModule||typeof this.workerFactory!=='function')throw Error('This browser does not support background spectral preview');
  if(![1,2].includes(this.buffer?.numberOfChannels)||this.buffer.sampleRate!==this.context.sampleRate)throw Error('Spectral preview requires mono/stereo audio at the playback context sample rate');
  this.onStatus({mode:'spectral',state:'preparing',message:'Preparing background spectral preview...'});
  if(!modules.has(this.context)){const context=this.context,pending=context.audioWorklet.addModule(new URL('./spectral-worklet.js',import.meta.url));modules.set(context,pending);pending.catch(()=>{if(modules.get(context)===pending)modules.delete(context);});}
  await modules.get(this.context);if(!this.active)throw abortError();
  this.node=this.nodeFactory(this.context);this.node.connect(this.output);this.node.onprocessorerror=()=>this.fail(Error('Spectral output processor failed'));
  this.node.port.onmessage=({data})=>{if(!this.active)return;if(data.type==='consumed'){this.queueChunks--;this.pump().catch(error=>this.fail(error));}else if(data.type==='underrun')this.fail(Error('Spectral preview could not keep up; using fast preview'));else if(data.type==='error')this.fail(Error(data.message));};
  this.worker=this.workerFactory();this.worker.onmessage=({data})=>{const pending=this.requests.get(data.id);if(!pending)return;this.requests.delete(data.id);clearTimeout(pending.timer);data.type==='error'?pending.reject(Error(data.message)):pending.resolve(data);};
  this.worker.onerror=event=>{event.preventDefault?.();this.fail(Error(event.message||'Spectral worker failed'));};this.worker.onmessageerror=()=>this.fail(Error('Spectral worker transfer failed'));
  const settings={sampleRate:this.buffer.sampleRate,channels:this.buffer.numberOfChannels,length:this.buffer.length,pitch:this.pitch,loop:this.loop,fftSize:this.fftSize,hopSize:this.hopSize,chunkFrames:this.chunkFrames};
  await this.request({type:'init',settings});while(this.queueChunks<3){if(!this.active)throw abortError();await this.produce();}return this;
 }
 request(data,transfer=[]){if(!this.active)return Promise.reject(abortError());const id=++this.serial;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.requests.delete(id);reject(Error('Spectral worker did not respond within 5 seconds'));},5000);this.requests.set(id,{resolve,reject,timer});try{this.worker.postMessage({...data,id},transfer);}catch(error){this.requests.delete(id);clearTimeout(timer);reject(error);}});}
 async produce(){
  const end=this.outputFrame+this.chunkFrames,required=Math.ceil((end-1)*this.pitchRate)+1,count=Math.max(0,Math.floor((required+this.fftSize/2)/this.hopSize)+1-this.nextFrame);
  const centers=Float64Array.from({length:count},(_,i)=>this.sourceTimeAtOutput((this.nextFrame+i)*this.hopSize/(this.pitchRate*this.buffer.sampleRate))*this.buffer.sampleRate);
  const ranges=spectralSourceRanges(centers,this.buffer,{fftSize:this.fftSize,loop:this.loop}),blocks=ranges.map(([start,end])=>({start,channels:Array.from({length:this.buffer.numberOfChannels},(_,c)=>this.buffer.getChannelData(c).slice(start,end))}));
  const response=await this.request({type:'process',frames:this.chunkFrames,centers,blocks},[centers.buffer,...blocks.flatMap(b=>b.channels.map(c=>c.buffer))]);if(!this.active)throw abortError();
  this.outputFrame=response.outputFrame;this.nextFrame=response.nextFrame;this.queueChunks++;this.node.port.postMessage({type:'chunk',startFrame:response.startFrame,channels:response.channels},response.channels.map(c=>c.buffer));
 }
 async pump(){if(!this.active||this.pumping)return;this.pumping=true;try{while(this.active&&this.queueChunks<4)await this.produce();}finally{this.pumping=false;}}
 start(at){if(!this.active||this.queueChunks<3)throw Error('Spectral preview must be prepared before playback');const frame=Math.ceil(at*this.context.sampleRate);this.node.port.postMessage({type:'start',atFrame:frame});this.running=true;this.onStatus({mode:'spectral',state:'playing',message:'Spectral preview / original phase processing'});this.pump().catch(error=>this.fail(error));return frame/this.context.sampleRate;}
 fail(error){if(!this.active||this.failed)return;this.failed=true;for(const pending of this.requests.values()){clearTimeout(pending.timer);pending.reject(error);}this.requests.clear();if(this.running)this.onFailure(error);else this.stop();}
 stop(){if(!this.active)return;this.active=false;for(const pending of this.requests.values()){clearTimeout(pending.timer);pending.reject(abortError());}this.requests.clear();this.worker?.terminate();if(this.node){try{this.node.port.postMessage({type:'stop'});this.node.disconnect();this.node.port.close();}catch{}}this.worker=null;this.node=null;this.buffer=null;}
}
