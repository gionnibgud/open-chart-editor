import {TAU,principal,Fourier} from './spectral-fft.js';
// Original stereo-linked phase processing. All persistent arrays are bounded by
// FFT size; source PCM is supplied read-only by the worker's current range cache.
export class SpectralFrames{
 constructor({channels=2,fftSize=4096,hopSize=512,pitchRate=1,transientReset=true,phaseLock=true}={}){
  Object.assign(this,{channels,fftSize,hopSize,pitchRate,transientReset,phaseLock});this.half=fftSize/2;this.bins=this.half+1;this.fft=new Fourier(fftSize);
  this.window=Float64Array.from({length:fftSize},(_,i)=>.5-.5*Math.cos(TAU*i/fftSize));this.weights=Float64Array.from(this.window,n=>n*n);
  const arrays=n=>Array.from({length:channels},()=>new Float64Array(n));this.re=arrays(fftSize);this.im=arrays(fftSize);this.previousPhase=arrays(this.bins);this.phase=arrays(this.bins);this.previousMagnitude=arrays(this.bins);this.magnitude=arrays(this.bins);this.inputPhase=arrays(this.bins);this.instantaneous=arrays(this.bins);this.deltas=new Float64Array(channels);this.frame=0;this.transientHold=0;this.resets=0;
 }
 process(center,analysisHop,read,{reset=false}={}){
  if(!Number.isFinite(center)||!Number.isFinite(analysisHop)||analysisHop<=0)throw Error('Invalid spectral analysis center');
  const {channels,fftSize,half,bins,hopSize,pitchRate,re,im,magnitude,inputPhase,previousMagnitude,previousPhase,phase,instantaneous,deltas}=this;let increase=0,total=0;
  for(let c=0;c<channels;c++){
   for(let i=0;i<fftSize;i++){const value=read(c,center+i-half);if(!Number.isFinite(value))throw Error('Malformed spectral source PCM');re[c][i]=value*this.window[i];im[c][i]=0;}this.fft.transform(re[c],im[c]);
   for(let k=0;k<bins;k++){const value=Math.hypot(re[c][k],im[c][k]);magnitude[c][k]=value;inputPhase[c][k]=Math.atan2(im[c][k],re[c][k]);increase+=Math.max(0,value-previousMagnitude[c][k]);total+=value;}
  }
  reset=reset||this.frame===0||(this.transientReset&&increase/Math.max(1e-12,total)>.48);if(reset&&this.frame)this.resets++;this.transientHold=reset?Math.ceil(fftSize/analysisHop):Math.max(0,this.transientHold-1);
  for(let k=0;k<bins;k++){
   const expected=TAU*k/fftSize*analysisHop;let sin=0,cos=0,ref=0;
   for(let c=0;c<channels;c++){const weight=magnitude[c][k]*previousMagnitude[c][k],delta=principal(inputPhase[c][k]-previousPhase[c][k]-expected);deltas[c]=delta;sin+=weight*Math.sin(delta);cos+=weight*Math.cos(delta);if(magnitude[c][k]>magnitude[ref][k])ref=c;}
   const common=Math.atan2(sin,cos);let coherent=true;for(let c=0;c<channels;c++)if(magnitude[c][k]>=1e-7&&Math.abs(principal(deltas[c]-common))>=.02)coherent=false;
   for(let c=0;c<channels;c++){instantaneous[c][k]=TAU*k/fftSize+(coherent?common:deltas[c])/analysisHop;phase[c][k]=reset?inputPhase[c][k]:phase[c][k]+instantaneous[c][k]*hopSize;}
   if(coherent){const reference=phase[ref][k];for(let c=0;c<channels;c++)phase[c][k]=reference+principal(inputPhase[c][k]-inputPhase[ref][k]);}
   for(let c=0;c<channels;c++){previousPhase[c][k]=inputPhase[c][k];previousMagnitude[c][k]=magnitude[c][k];}
  }
  if(this.phaseLock)for(let c=0;c<channels;c++){
   const peaks=[];for(let k=1;k<half;k++)if(magnitude[c][k]>magnitude[c][k-1]&&magnitude[c][k]>=magnitude[c][k+1])peaks.push({bin:k,output:phase[c][k],input:inputPhase[c][k]});
   if(peaks.length){let index=0;for(let k=0;k<bins;k++){while(index+1<peaks.length&&Math.abs(peaks[index+1].bin-k)<Math.abs(peaks[index].bin-k))index++;const peak=peaks[index];if(this.transientHold===0&&Math.abs(instantaneous[c][k]-instantaneous[c][peak.bin])>TAU/fftSize*.35)continue;phase[c][k]=peak.output+principal(inputPhase[c][k]-peak.input);}}
  }
  for(let k=0;k<bins;k++)for(let c=0;c<channels;c++){
   const level=k*pitchRate<half?magnitude[c][k]:0;re[c][k]=level*Math.cos(phase[c][k]);im[c][k]=k===0||k===half?0:level*Math.sin(phase[c][k]);if(k>0&&k<half){re[c][fftSize-k]=re[c][k];im[c][fftSize-k]=-im[c][k];}
  }
  for(let c=0;c<channels;c++){this.fft.transform(re[c],im[c],true);for(let i=0;i<fftSize;i++)re[c][i]*=this.window[i];}this.frame++;return re;
 }
}

export class SpectralStream{
 constructor({sampleRate=48000,channels=2,pitch=0,fftSize=4096,hopSize=512,chunkFrames=4096,readSample,loop=null}={}){
  if(!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>192000||![1,2].includes(channels)||!Number.isFinite(pitch)||pitch<-24||pitch>24||typeof readSample!=='function')throw Error('Invalid spectral stream settings');
  if(!Number.isInteger(fftSize)||fftSize<512||fftSize>8192||(fftSize&(fftSize-1))||!Number.isInteger(hopSize)||hopSize<32||hopSize>fftSize/4||!Number.isInteger(chunkFrames)||chunkFrames<128||chunkFrames>8192)throw Error('Invalid spectral stream buffer size');
  Object.assign(this,{sampleRate,channels,fftSize,hopSize,chunkFrames,readSample,loop});this.pitchRate=2**(pitch/12);let capacity=1;while(capacity<fftSize*2+Math.ceil(chunkFrames*this.pitchRate)+8)capacity*=2;this.capacity=capacity;this.mask=capacity-1;this.rings=Array.from({length:channels},()=>new Float32Array(capacity));this.norm=new Float32Array(capacity);this.processor=new SpectralFrames({channels,fftSize,hopSize,pitchRate:this.pitchRate});this.outputFrame=0;this.nextFrame=0;this.freed=0;this.previousCenter=null;this.cycle=null;
 }
 requiredFrames(frames=this.chunkFrames){const required=Math.ceil((this.outputFrame+frames-1)*this.pitchRate)+1;return Math.max(0,Math.floor((required+this.fftSize/2)/this.hopSize)+1-this.nextFrame);}
 process(centers,frames=this.chunkFrames){
  if(!Number.isInteger(frames)||frames<1||frames>this.chunkFrames||centers.length!==this.requiredFrames(frames))throw Error('Spectral chunk center plan does not match output');
  const start=this.outputFrame,end=start+frames;
  for(const center of centers){
   const delta=this.previousCenter===null?(centers.length>1?centers[1]-centers[0]:this.hopSize):center-this.previousCenter;
   const cycle=this.loop?.enabled?(center/this.sampleRate<this.loop.end?0:1+Math.floor((center/this.sampleRate-this.loop.end)/(this.loop.end-this.loop.start))):0,reset=this.cycle!==null&&cycle!==this.cycle;
   const pcm=this.processor.process(center,delta,this.readSample,{reset}),synthesis=this.nextFrame*this.hopSize-this.fftSize/2;
   for(let i=0;i<this.fftSize;i++){const target=synthesis+i;if(target<0||target<this.freed)continue;if(target-this.freed>=this.capacity)throw Error('Spectral ring capacity exceeded');const index=target&this.mask;this.norm[index]+=this.processor.weights[i];for(let c=0;c<this.channels;c++)this.rings[c][index]+=pcm[c][i];}
   this.nextFrame++;this.previousCenter=center;this.cycle=cycle;
  }
  const at=(c,index)=>{const slot=index&this.mask;return this.norm[slot]>1e-8?this.rings[c][slot]/this.norm[slot]:0;};
  const output=Array.from({length:this.channels},(_,c)=>Float32Array.from({length:frames},(_,i)=>{const position=(start+i)*this.pitchRate,j=Math.floor(position),fraction=position-j,value=at(c,j)*(1-fraction)+at(c,j+1)*fraction;if(!Number.isFinite(value))throw Error('Spectral output exceeds finite PCM range');return value;}));
  const release=Math.floor(end*this.pitchRate);while(this.freed<release){const index=this.freed++&this.mask;this.norm[index]=0;for(const data of this.rings)data[index]=0;}this.outputFrame=end;
  return {channels:output,startFrame:start,nextFrame:this.nextFrame,outputFrame:this.outputFrame,workingBytes:this.capacity*(this.channels+1)*4+this.fftSize*(this.channels*64+16)};
 }
}
