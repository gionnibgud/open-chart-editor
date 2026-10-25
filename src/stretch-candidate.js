// Experimental original offline phase-vocoder candidate. Deliberately separate
// from AudioEngine: measurements do not establish a streaming preview feature.
import {TAU,principal,Fourier} from './spectral-fft.js';
const interpolate=(data,position)=>{if(position<0||position>=data.length)return 0;const i=Math.floor(position),f=position-i;return data[i]*(1-f)+(data[i+1]??data[i])*f;};

export function renderStretchCandidate(buffer,{speed=1,pitch=0,start=0,duration=(buffer.length/buffer.sampleRate-start)/speed,loop=null,fftSize=4096,hopSize=512,transientReset=true,phaseLock=true}={}){
 const rate=buffer?.sampleRate,channels=buffer?.numberOfChannels;
 if(!Number.isInteger(rate)||rate<8000||rate>192000||!Number.isInteger(buffer.length)||buffer.length<1||![1,2].includes(channels))throw Error('Candidate requires finite mono/stereo PCM at 8000–192000 Hz');
 if(!Number.isFinite(speed)||speed<.1||speed>2||!Number.isFinite(pitch)||pitch<-24||pitch>24||!Number.isFinite(start)||start<0||!Number.isFinite(duration)||duration<=0||duration>30)throw Error('Candidate supports bounded chunks up to 30 seconds, speed .1–2 and pitch ±24');
 if(!Number.isInteger(fftSize)||fftSize<512||fftSize>8192||(fftSize&(fftSize-1))||!Number.isInteger(hopSize)||hopSize<32||hopSize>fftSize/4)throw Error('Invalid candidate FFT/hop size');
 const source=Array.from({length:channels},(_,c)=>buffer.getChannelData(c));if(source.some(data=>data.length!==buffer.length))throw Error('Candidate PCM contains malformed samples');
 const sourceDuration=buffer.length/rate;
 if(loop?.enabled&&(!Number.isFinite(loop.start)||!Number.isFinite(loop.end)||loop.start<0||loop.end>sourceDuration||loop.end<=loop.start||start<loop.start||start>=loop.end))throw Error('Candidate loop must contain the start within source PCM');
 const frames=Math.ceil(duration*rate),pitchRate=2**(pitch/12),intermediateFrames=Math.ceil(frames*pitchRate),memory=(intermediateFrames+fftSize)*(channels+1)*4+frames*channels*4+fftSize*(channels*64+16);
 if(memory>128*1024*1024)throw Error('Candidate working PCM exceeds 128 MiB');
 const read=(channel,position)=>{if(loop?.enabled){const lower=loop.start*rate,upper=loop.end*rate;position=lower+((position-lower)%(upper-lower)+(upper-lower))%(upper-lower);}const value=interpolate(source[channel],position);if(!Number.isFinite(value))throw Error('Candidate PCM contains malformed samples');return value;};
 if(speed===1&&pitch===0)return {sampleRate:rate,channels:source.map((_,c)=>Float32Array.from({length:frames},(_,i)=>read(c,start*rate+i))),diagnostics:{fftSize,hopSize,frames:0,transientResets:0,workingBytes:frames*channels*4,bypass:true}};
 const fft=new Fourier(fftSize),half=fftSize/2,bins=half+1,window=Float64Array.from({length:fftSize},(_,i)=>.5-.5*Math.cos(TAU*i/fftSize));
 const intermediate=Array.from({length:channels},()=>new Float32Array(intermediateFrames+fftSize)),normalizer=new Float32Array(intermediateFrames+fftSize),re=Array.from({length:channels},()=>new Float64Array(fftSize)),im=Array.from({length:channels},()=>new Float64Array(fftSize));
 const previousPhase=Array.from({length:channels},()=>new Float64Array(bins)),phase=Array.from({length:channels},()=>new Float64Array(bins)),previousMagnitude=Array.from({length:channels},()=>new Float64Array(bins));
 const magnitude=Array.from({length:channels},()=>new Float64Array(bins)),inputPhase=Array.from({length:channels},()=>new Float64Array(bins));
 const instantaneous=Array.from({length:channels},()=>new Float64Array(bins)),deltas=new Float64Array(channels);
 const analysisHop=hopSize*speed/pitchRate,frameCount=Math.ceil((intermediateFrames+half)/hopSize);let resets=0,lastCycle=null,transientHold=0;
 for(let frame=0;frame<frameCount;frame++){
  const center=frame*analysisHop,synthesis=frame*hopSize-half;let increase=0,total=0;
  for(let c=0;c<channels;c++){
   for(let i=0;i<fftSize;i++){re[c][i]=read(c,start*rate+center+i-half)*window[i];im[c][i]=0;}
   fft.transform(re[c],im[c]);
   for(let k=0;k<bins;k++){const value=Math.hypot(re[c][k],im[c][k]);magnitude[c][k]=value;inputPhase[c][k]=Math.atan2(im[c][k],re[c][k]);increase+=Math.max(0,value-previousMagnitude[c][k]);total+=value;}
  }
  const cycle=loop?.enabled?Math.floor((start+center/rate-loop.start)/(loop.end-loop.start)):0;
  const reset=frame===0||cycle!==lastCycle||(transientReset&&increase/Math.max(1e-12,total)>.48);if(reset&&frame)resets++;lastCycle=cycle;transientHold=reset?Math.ceil(fftSize/analysisHop):Math.max(0,transientHold-1);
  for(let k=0;k<bins;k++){
   const expected=TAU*k/fftSize*analysisHop;let sin=0,cos=0,ref=0;
   for(let c=0;c<channels;c++){const weight=magnitude[c][k]*previousMagnitude[c][k],delta=principal(inputPhase[c][k]-previousPhase[c][k]-expected);deltas[c]=delta;sin+=weight*Math.sin(delta);cos+=weight*Math.cos(delta);if(magnitude[c][k]>magnitude[ref][k])ref=c;}
   const common=Math.atan2(sin,cos);let coherent=true;for(let c=0;c<channels;c++)if(magnitude[c][k]>=1e-7&&Math.abs(principal(deltas[c]-common))>=.02)coherent=false;
   for(let c=0;c<channels;c++){instantaneous[c][k]=TAU*k/fftSize+(coherent?common:deltas[c])/analysisHop;phase[c][k]=reset?inputPhase[c][k]:phase[c][k]+instantaneous[c][k]*hopSize;}
   // Correlated stereo retains its interchannel phase. Independent overlapping
   // voices keep their own frequencies instead of being pulled to an average.
   if(coherent){const reference=phase[ref][k];for(let c=0;c<channels;c++)phase[c][k]=reference+principal(inputPhase[c][k]-inputPhase[ref][k]);}
   for(let c=0;c<channels;c++){previousPhase[c][k]=inputPhase[c][k];previousMagnitude[c][k]=magnitude[c][k];}
  }
  if(phaseLock){
   // Keep each channel's local spectral peaks together without mixing voices
   // from the other channel. Neighbor bins must also agree on frequency.
   for(let c=0;c<channels;c++){
    const peaks=[];for(let k=1;k<half;k++)if(magnitude[c][k]>magnitude[c][k-1]&&magnitude[c][k]>=magnitude[c][k+1])peaks.push({bin:k,output:phase[c][k],input:inputPhase[c][k]});
    if(peaks.length){let index=0;for(let k=0;k<bins;k++){while(index+1<peaks.length&&Math.abs(peaks[index+1].bin-k)<Math.abs(peaks[index].bin-k))index++;const peak=peaks[index];if(transientHold===0&&Math.abs(instantaneous[c][k]-instantaneous[c][peak.bin])>TAU/fftSize*.35)continue;phase[c][k]=peak.output+principal(inputPhase[c][k]-peak.input);}}
   }
  }
  for(let k=0;k<bins;k++)for(let c=0;c<channels;c++){
   const level=k*pitchRate<half?magnitude[c][k]:0;re[c][k]=level*Math.cos(phase[c][k]);im[c][k]=k===0||k===half?0:level*Math.sin(phase[c][k]);
   if(k>0&&k<half){re[c][fftSize-k]=re[c][k];im[c][fftSize-k]=-im[c][k];}
  }
  for(let c=0;c<channels;c++){fft.transform(re[c],im[c],true);for(let i=0;i<fftSize;i++){const target=synthesis+i;if(target>=0&&target<intermediate[c].length)intermediate[c][target]+=re[c][i]*window[i];}}
  for(let i=0;i<fftSize;i++){const target=synthesis+i;if(target>=0&&target<normalizer.length)normalizer[target]+=window[i]**2;}
 }
 for(let c=0;c<channels;c++)for(let i=0;i<intermediate[c].length;i++)intermediate[c][i]=normalizer[i]>1e-8?intermediate[c][i]/normalizer[i]:0;
 return {sampleRate:rate,channels:intermediate.map(data=>Float32Array.from({length:frames},(_,i)=>interpolate(data,i*pitchRate))),diagnostics:{fftSize,hopSize,frames:frameCount,transientResets:resets,phaseLock,workingBytes:memory,bypass:false}};
}
