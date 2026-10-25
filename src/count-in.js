// Original local-preview pre-roll. Source chart/audio/export times never move.
import { assertGrid } from './model.js';

export function planCountIn(project,cursor,{bars=1,beats=null,speed=1}={}){
 const grid=project?.beats;assertGrid(grid||[]);
 if(!Number.isFinite(cursor)||cursor<0||!Number.isFinite(speed)||speed<.1||speed>2)throw Error('Invalid count-in position or playback speed');
 let index=0;while(index<grid.length-2&&grid[index+1].time<=cursor)index++;
 const numerator=grid[index].numerator||4,denominator=grid[index].denominator||4;
 if(!Number.isInteger(numerator)||numerator<1||numerator>32||![1,2,4,8,16,32].includes(denominator))throw Error('Invalid count-in meter');
 const count=beats==null?bars*numerator:beats;
 if((beats==null&&(!Number.isInteger(bars)||bars<1))||!Number.isInteger(count)||count<1||count>128)throw Error('Count-in must contain 1 to 128 meter pulses');
 const pulseSeconds=(grid[index+1].time-grid[index].time)/speed;
 return {numerator,denominator,pulseSeconds,duration:count*pulseSeconds,events:Array.from({length:count},(_,i)=>({offset:i*pulseSeconds,accent:i%numerator===0,beat:i%numerator+1,bar:Math.floor(i/numerator)+1,index:i,total:count}))};
}

export class CountIn {
 constructor({audio,onTick=()=>{},onState=()=>{},setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id)}={}){
  if(!audio||typeof audio.init!=='function'||typeof audio.play!=='function')throw Error('Count-in needs a local audio transport');
  this.audio=audio;this.onTick=onTick;this.onState=onState;this.setTimer=setTimer;this.clearTimer=clearTimer;
  this.state='idle';this.generation=0;this.timers=new Set();this.voices=new Set();this.pending=null;
 }
 get isCounting(){return this.state!=='idle';}
 clearScheduled(){for(const timer of this.timers)this.clearTimer(timer);this.timers.clear();for(const voice of this.voices){try{voice.source.stop();}catch{}try{voice.source.disconnect();voice.gain.disconnect();}catch{}}this.voices.clear();}
 cancel(){
  this.generation++;const wasCounting=this.isCounting;this.clearScheduled();
  if(this.state==='starting')this.audio.pause();
  this.state='idle';this.pending?.resolve(false);this.pending=null;
  if(wasCounting)this.onState('idle');return wasCounting;
 }
 click(at,accent){
  const context=this.audio.context,source=context.createOscillator(),gain=context.createGain(),voice={source,gain};
  source.type='triangle';source.frequency.value=accent?1320:880;
  gain.gain.setValueAtTime(.2,at);gain.gain.exponentialRampToValueAtTime(.0001,at+.045);
  source.connect(gain);gain.connect(this.audio.buses?.master||context.destination);this.voices.add(voice);
  source.onended=()=>{this.voices.delete(voice);source.disconnect();gain.disconnect();};source.start(at);source.stop(at+.05);
 }
 async start({project,cursor=0,bars=1,beats=null,speed=this.audio.speed||1,onStart=()=>this.audio.play(cursor)}={}){
  const plan=planCountIn(project,cursor,{bars,beats,speed});this.cancel();
  const generation=++this.generation;this.state='counting';this.onState('counting');
  let resolve;const done=new Promise(complete=>{resolve=complete;});this.pending={resolve,generation};
  try{
   await this.audio.init();if(generation!==this.generation)return done;
   const base=this.audio.context.currentTime+.025;
   for(const event of plan.events){
    this.click(base+event.offset,event.accent);
    const timer=this.setTimer(()=>{this.timers.delete(timer);if(generation===this.generation)this.onTick(event);},(event.offset+.025)*1000);this.timers.add(timer);
   }
   const timer=this.setTimer(async()=>{
    this.timers.delete(timer);if(generation!==this.generation)return;
    this.state='starting';
    try{
     const started=await onStart(()=>generation===this.generation);if(generation!==this.generation)return;
     this.clearScheduled();this.pending=null;this.state='idle';this.onState('idle');resolve(started!==false);
    }catch(error){if(generation===this.generation){this.clearScheduled();this.pending=null;this.state='idle';this.onState('idle');resolve(Promise.reject(error));}}
   },(plan.duration+.025)*1000);this.timers.add(timer);
  }catch(error){if(generation===this.generation){this.cancel();throw error;}}
  return done;
 }
}
