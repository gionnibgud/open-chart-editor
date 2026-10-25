// Original bounded waveform-similarity search for preview grains. One source
// offset serves all channels; chart/transport time and exported PCM never move.
const sample=(data,position)=>{const index=Math.floor(position),fraction=position-index;return data[index]+(data[index+1]-data[index])*fraction;};
export class GrainAligner{
 constructor(){this.reset();}
 reset(){this.buffer=null;this.channels=null;this.previous=null;this.lastScore=0;}
 select(buffer,at,expected,pitch,{lower=0,upper=buffer?.duration}={}){
  const previous=this.previous;this.previous={at,expected,selected:expected};this.lastScore=0;
  if(buffer!==this.buffer){this.buffer=buffer;this.channels=null;return expected;}
  if(!previous||buffer?.duration<.1||!buffer?.getChannelData||!Number.isFinite(at)||!Number.isFinite(expected)||!(pitch>0&&Number.isFinite(pitch))||!(buffer.sampleRate>=8000)||!Number.isInteger(buffer.length))return expected;
  const hop=at-previous.at,reference=previous.selected+hop*pitch,span=Math.min(.04,.08-hop)*pitch,rate=buffer.sampleRate;
  // Keep source/loop boundary handling in the transport. A wrap, gap or exact
  // normal alignment uses the existing grain unchanged.
  if(!(hop>0&&hop<.07)||expected<previous.expected-1e-8||Math.abs(reference-expected)<1e-8||reference<lower||reference+span>=upper-1/rate||expected<lower||expected+span>=upper-1/rate)return expected;
  try{this.channels??=Array.from({length:Math.min(2,buffer.numberOfChannels)},(_,i)=>buffer.getChannelData(i));}catch{return expected;}
  if(!this.channels.length||this.channels.some(data=>data.length!==buffer.length))return expected;
  const count=128,step=span*rate/(count-1),references=[];let energy=0;
  for(const data of this.channels){const values=new Float64Array(count);let sum=0;for(let i=0;i<count;i++){values[i]=sample(data,reference*rate+i*step);sum+=values[i];}const mean=sum/count;for(let i=0;i<count;i++){values[i]-=mean;energy+=values[i]*values[i];}references.push(values);}
  if(!(energy>1e-9&&Number.isFinite(energy)))return expected;
  const radius=Math.floor(.008*rate),coarse=Math.max(1,Math.floor(.0002*rate)),min=Math.max(-radius,Math.ceil((lower-expected)*rate)),max=Math.min(radius,Math.floor((upper-span-1/rate-expected)*rate));
  let best=0,bestScore=-Infinity;
  const inspect=offset=>{
   if(offset<min||offset>max)return;
   let dot=0,square=0;
   for(let c=0;c<this.channels.length;c++){const data=this.channels[c],ref=references[c];let sum=0,power=0;for(let i=0;i<count;i++){const value=sample(data,expected*rate+offset+i*step);sum+=value;power+=value*value;dot+=ref[i]*value;}square+=Math.max(0,power-sum*sum/count);}
   const score=square>1e-9?dot/Math.sqrt(energy*square):-Infinity;
   if(score>bestScore+1e-8||Math.abs(score-bestScore)<=1e-8&&Math.abs(offset)<Math.abs(best)){bestScore=score;best=offset;}
  };
  inspect(0);for(let offset=min;offset<=max;offset+=coarse)inspect(offset);
  const center=best;for(let offset=center-coarse;offset<=center+coarse;offset++)inspect(offset);
  const fine=best;for(let offset=fine-1;offset<=fine+1;offset+=.125)inspect(offset);
  this.lastScore=bestScore;
  // A conservative match guard avoids adding modulation to inharmonic mixes,
  // speech or transients. This improves strongly periodic material only.
  if(!(bestScore>=.999))return expected;
  const selected=expected+best/rate;this.previous.selected=selected;return selected;
 }
}
