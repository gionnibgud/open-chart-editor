// Original explicit connected-MIDI cue for audition or recording, with no chart mutation.
// No devices/context creation, chart edits, imported DSP or automatic scheduling.
// Held voices sustain until MIDI noteoff/pedal/control; this is not a short blip.
import {guideFrequency} from './audio.js';
import {drumSamples,drumDuration} from './drum-guide.js';
import {GM_DRUMS} from './midi.js';
import {resolveGuideVoice,guideHarmonics} from './guide-voice.js';
const integer=(v,a,b)=>Number.isInteger(v)&&v>=a&&v<=b;
const heldGain=(voice,time)=>{const elapsed=Math.max(0,time-voice.startedAt);return elapsed<voice.attack?voice.peak*elapsed/voice.attack:voice.target+(voice.peak-voice.target)*Math.exp(-(elapsed-voice.attack)/voice.tau);};
const ceiling=()=>Float32Array.from({length:1025},(_,i)=>.9*Math.tanh((i/512-1)/.9));
export class MidiAudition{
 constructor({getState=()=>({enabled:false}),maxActive=64,maxOwned=96}={}){
  if(typeof getState!=='function'||!integer(maxActive,1,64)||!integer(maxOwned,maxActive,96))throw Error('Bounded MIDI audition configuration required');
  this.getState=getState;this.maxActive=maxActive;this.maxOwned=maxOwned;this.active=new Map();this.owned=new Set();this.pedals=new Set();this.context=null;this.destination=null;this.guard=null;this.running=false;this.disposed=false;
 }
 get activeCount(){return [...this.active.values()].reduce((sum,q)=>sum+q.length,0);}
 get ownedCount(){return this.owned.size;}
 start({context,destination}={}){
  if(this.disposed)throw Error('MIDI audition disposed');this.stop();
  if(context?.state!=='running'||!Number.isFinite(context.sampleRate)||context.sampleRate<=0||!destination)return{ok:false,reason:'Explicit MIDI audition needs a ready audio context and guide bus'};
  this.context=context;this.destination=destination;this.running=true;return{ok:true};
 }
 cleanup(voice){if(voice.cleaned)return;voice.cleaned=true;this.owned.delete(voice);const key=voice.channel+':'+voice.pitch,queue=this.active.get(key);if(queue){const rest=queue.filter(v=>v!==voice);if(rest.length)this.active.set(key,rest);else this.active.delete(key);}voice.oscillator.onended=null;for(const n of [voice.oscillator,voice.gain])try{n.disconnect();}catch{} }
 release(voice,{immediate=false}={}){
  if(voice.cleaned||voice.retired)return;voice.retired=true;const now=this.context.currentTime;
  try{const parameter=voice.gain.gain;let held=false;if(typeof parameter.cancelAndHoldAtTime==='function')try{parameter.cancelAndHoldAtTime(now);held=true;}catch{}if(!held){parameter.cancelScheduledValues(now);
   // Canceling a future ramp endpoint also removes its preceding trajectory.
   // Restore that truncated ramp, including release exactly at its endpoint;
   // after attack the completed ramp/target remain and only need a held value.
   const value=heldGain(voice,now);if(now<=voice.startedAt+voice.attack)parameter.linearRampToValueAtTime(value,now);else parameter.setValueAtTime(value,now);
  }if(immediate)voice.gain.gain.setValueAtTime(0,now);else voice.gain.gain.setTargetAtTime(0,now,voice.release/4);voice.oscillator.stop(now+(immediate?0:voice.release+.01));}catch{this.cleanup(voice);}
  if(immediate)this.cleanup(voice);
 }
 releaseWhere(predicate,{immediate=false}={}){
  for(const [key,queue]of this.active){const retain=[];for(const voice of queue)if(predicate(voice))this.release(voice,{immediate});else retain.push(voice);if(retain.length)this.active.set(key,retain);else this.active.delete(key);}
 }
 stop(){
  this.running=false;for(const voice of this.owned){try{voice.gain.gain.cancelScheduledValues(this.context?.currentTime??0);voice.gain.gain.setValueAtTime(0,this.context?.currentTime??0);voice.oscillator.stop(this.context?.currentTime??0);}catch{}this.cleanup(voice);}this.active.clear();this.pedals.clear();if(this.guard)try{this.guard.disconnect();}catch{}this.guard=null;this.context=null;this.destination=null;
 }
 handle(event){
  if(this.disposed||!this.running)return{status:'stopped'};
  if(event?.type==='stop'){this.stop();return{status:'stopped'};}
  const state=this.getState()||{};if(!Number.isFinite(this.context.currentTime)||this.context.currentTime<0)return{status:'invalid-clock'};if(!state.enabled||this.context.state!=='running'){this.stop();return{status:'disabled'};}
  if(event?.type==='flush'){
   const channel=event.channel;if(channel!==null&&!integer(channel,0,15))return{status:'invalid'};
   if(channel===null)this.pedals.clear();else this.pedals.delete(channel);
   this.releaseWhere(voice=>channel===null||voice.channel===channel);return{status:'flushed'};
  }
  const channel=event?.channel;if(!integer(channel,0,15))return{status:'invalid'};
  if(event.type==='control'){
   const {controller,value}=event;if(![64,120,121,123].includes(controller)||!integer(value,0,127))return{status:'invalid'};
   if(controller===64&&value>=64){this.pedals.add(channel);return{status:'pedal-down'};}
   if(controller===64||controller===121){this.pedals.delete(channel);this.releaseWhere(v=>v.channel===channel&&v.released);return{status:'pedal-up'};}
   this.pedals.delete(channel);this.releaseWhere(v=>v.channel===channel,{immediate:controller===120});return{status:'channel-off'};
  }
  const pitch=event.pitch;if(!integer(pitch,0,127))return{status:'invalid'};const key=channel+':'+pitch;
  if(event.type==='noteoff'||event.type==='noteon'&&event.velocity===0){const queue=this.active.get(key),voice=queue?.find(v=>!v.released);if(!voice)return{status:'unmatched-noteoff'};voice.released=true;if(voice.oneShot)return{status:'percussion-one-shot'};if(this.pedals.has(channel))return{status:'pedal-held'};this.release(voice);const remain=queue.filter(v=>!v.retired);if(remain.length)this.active.set(key,remain);else this.active.delete(key);return{status:'released'};}
  if(event.type!=='noteon')return{status:'ignored'};
  if(!integer(event.velocity,1,127)||!event.arrangement||event.arrangement.readOnly)return{status:'unsupported'};
  if(this.activeCount>=this.maxActive||this.ownedCount>=this.maxOwned)return{status:'voice-limit'};
  if(event.arrangement.type==='drums'){
   const piece=GM_DRUMS[pitch];if(!piece)return{status:'unmapped-drum',pitch};
   if(['hh_closed','hh_pedal'].includes(piece))this.releaseWhere(voice=>voice.piece==='hh_open',{immediate:true});
   let source,gain,createdGuard=false;
   try{
    if(!this.guard){this.guard=this.context.createWaveShaper();createdGuard=true;this.guard.curve=ceiling();this.guard.oversample='none';this.guard.connect(this.destination);}
    const pcm=drumSamples(piece,this.context.sampleRate),buffer=this.context.createBuffer(1,pcm.length,this.context.sampleRate);buffer.getChannelData(0).set(pcm);
    source=this.context.createBufferSource();source.buffer=buffer;gain=this.context.createGain();const now=this.context.currentTime,span=drumDuration({piece}),peak=event.velocity/127*.25;
    gain.gain.setValueAtTime(peak,now);gain.gain.setValueAtTime(peak,now+Math.max(0,span-.005));gain.gain.linearRampToValueAtTime(0,now+span);source.connect(gain);gain.connect(this.guard);
    const voice={oscillator:source,gain,channel,pitch,piece,oneShot:true,startedAt:now,peak,attack:.001,target:peak,tau:.2,released:false,retired:false,cleaned:false,release:.02};source.onended=()=>this.cleanup(voice);source.start(now,0,span);this.owned.add(voice);const queue=this.active.get(key)||[];queue.push(voice);this.active.set(key,queue);return{status:'sounding-drum',piece,velocity:event.velocity};
   }catch(error){for(const node of [source,gain])try{node?.disconnect();}catch{}try{source?.stop();}catch{}if(createdGuard){try{this.guard?.disconnect();}catch{}this.guard=null;}throw error;}
  }
  const shift=state.pitchShift??0,cents=event.arrangement.centOffset??0,frequency=guideFrequency(pitch+shift,cents,this.context.sampleRate);
  if(!frequency)return{status:'unsampleable'};
  const voiceSetting=resolveGuideVoice(event.arrangement,{rigLibrary:state.rigLibrary,time:Math.max(0,state.chartTime??event.note?.time??0)});if(voiceSetting.silent||voiceSetting.percussion)return{status:'silent'};
  let oscillator,gain,createdGuard=false;
  try{
   if(!this.guard){this.guard=this.context.createWaveShaper();createdGuard=true;this.guard.curve=ceiling();this.guard.oversample='none';this.guard.connect(this.destination);}
   oscillator=this.context.createOscillator();gain=this.context.createGain();oscillator.frequency.value=frequency;oscillator.type='triangle';
   const profile=voiceSetting.profile;if(profile){const coeff=guideHarmonics(profile,frequency,this.context.sampleRate),real=new Float32Array(coeff.length+1),imag=new Float32Array(coeff.length+1);imag.set(coeff,1);oscillator.setPeriodicWave(this.context.createPeriodicWave(real,imag,{disableNormalization:true}));}
   const now=this.context.currentTime,peak=event.velocity/127*.18,attack=Math.max(.001,profile?.attack??.006);gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(peak,now+attack);gain.gain.setTargetAtTime(peak*.45,now+attack,.2);oscillator.connect(gain);gain.connect(this.guard);
   const voice={oscillator,gain,channel,pitch,startedAt:now,peak,attack,target:peak*.45,tau:.2,released:false,retired:false,cleaned:false,release:Math.max(.02,Math.min(.5,profile?.release??.06))};oscillator.onended=()=>this.cleanup(voice);oscillator.start(now);this.owned.add(voice);const queue=this.active.get(key)||[];queue.push(voice);this.active.set(key,queue);return{status:'sounding',frequency,profile:profile?.id??null};
  }catch(error){for(const n of [oscillator,gain])try{n?.disconnect();}catch{}try{oscillator?.stop();}catch{}if(createdGuard){try{this.guard?.disconnect();}catch{}this.guard=null;}throw error;}
 }
 dispose(){if(this.disposed)return;this.stop();this.disposed=true;}
}
