// A bounded PCM delivery queue. It has no source/chart clock of its own: the
// engine schedules one context start frame shared with guide and metronome.
class SpectralOutput extends AudioWorkletProcessor{
 constructor(){super();this.queue=[];this.queuedFrames=0;this.startFrame=null;this.stopped=false;this.underrun=0;this.reported=false;this.port.onmessage=({data})=>{
  if(data.type==='stop'){this.stopped=true;this.queue=[];this.queuedFrames=0;}
  else if(data.type==='start')this.startFrame=data.atFrame;
  else if(data.type==='chunk'){
   const length=data.channels?.[0]?.length;if(!Number.isInteger(data.startFrame)||data.startFrame<0||!length||length>8192||data.channels.length>2||data.channels.some(c=>!(c instanceof Float32Array)||c.length!==length)||this.queuedFrames+length>32768){this.port.postMessage({type:'error',message:'Spectral output queue bounds exceeded'});return;}
   this.queue.push({...data,length});this.queuedFrames+=length;
  }
 };}
 process(_inputs,outputs){const output=outputs[0];if(this.stopped)return false;
  for(let i=0;i<output[0].length;i++){
   const position=this.startFrame===null?-1:currentFrame+i-this.startFrame;
   if(position<0){for(const channel of output)channel[i]=0;continue;}
   while(this.queue.length&&this.queue[0].startFrame+this.queue[0].length<=position){const item=this.queue.shift();this.queuedFrames-=item.length;this.port.postMessage({type:'consumed',frames:item.length});}
   const head=this.queue[0],valid=head&&position>=head.startFrame&&position<head.startFrame+head.length;
   for(let c=0;c<output.length;c++)output[c][i]=valid?(head.channels[c]||head.channels[0])[position-head.startFrame]:0;
   if(valid)this.underrun=0;else if(++this.underrun>=1024&&!this.reported){this.reported=true;this.port.postMessage({type:'underrun',frame:position});}
  }
  return true;
 }
}
registerProcessor('oce-spectral-preview-v1',SpectralOutput);
