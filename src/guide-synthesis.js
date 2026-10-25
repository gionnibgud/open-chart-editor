import {notePitch} from './model.js';
import {drumDuration,drumEvents} from './drum-guide.js';
import {resolveGuideVoice,resolvedGuideVoiceDTO,guideVoiceDTO} from './guide-voice.js';
// Original guide interpretation shared by live audition and practice rendering.
// This is a listening aid, not an emulation of any native instrument DSP.
export function guideNotes(arrangement){
 const notes=[...(arrangement.notes||[])];
 for(const chord of arrangement.chords||[]){
  const inherited={...(chord.techniques||{})};for(const key of ['palm_mute','fret_hand_mute','accent','tremolo','vibrato','ignore'])if(chord[key]!==undefined)inherited[key]=chord[key];
  if(chord.notes?.length)notes.push(...chord.notes.map(note=>({...note,time:chord.time,velocity:note.velocity??chord.velocity,techniques:{...inherited,...note.techniques}})));
  else for(const [string,fret]of (arrangement.chord_templates?.[chord.chord_id]?.frets||[]).entries())if(fret>=0)notes.push({time:chord.time,string,fret,sustain:chord.sustain??.2,velocity:chord.velocity,techniques:{...inherited}});
 }
 return arrangement.type==='drums'?drumEvents(notes):notes;
}
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const enabled=value=>value===true||typeof value==='number'&&value>0;
export function guideDuration(note,type){if(type==='drums')return drumDuration(note);const sustain=Number.isFinite(note.sustain)&&note.sustain>0?note.sustain:.12;return Math.max(type==='drums'?.05:.08,sustain);}
export function guidePlan(arrangement,note,{rigLibrary=null,voiceDTO=undefined}={}){
 const techniques=note.techniques||{},duration=guideDuration(note,arrangement.type),span=Number.isFinite(note.sustain)&&note.sustain>0?note.sustain:duration,pitch=notePitch(arrangement,note);
 const source=techniques.bend_values,curve=Array.isArray(source)&&source.every((p,i)=>Number.isFinite(p.t)&&p.t>=0&&p.t<=span&&Number.isFinite(p.v)&&p.v>=0&&(!i||p.t>source[i-1].t))?source.map(p=>({...p})):[];
 const scalar=Number.isFinite(techniques.bend)&&techniques.bend>0?techniques.bend:0;
 const slide=['guitar','bass'].includes(arrangement.type)&&Number.isInteger(techniques.slide_to)&&techniques.slide_to>=0&&techniques.slide_to<=24&&Number.isFinite(note.fret)?techniques.slide_to-note.fret:0;
 const strength=techniques.vibrato===true?80:Number.isFinite(techniques.vibrato)?clamp(techniques.vibrato,0,255):0;
 const velocity=Number.isFinite(note.velocity??100)?clamp(note.velocity??100,0,127)/127:0;
 const palm=enabled(techniques.palm_mute),mute=enabled(techniques.fret_hand_mute),tremolo=enabled(techniques.tremolo);
 const voice=voiceDTO===undefined?resolveGuideVoice(arrangement,{rigLibrary,time:Math.max(0,note.time??0)}):resolvedGuideVoiceDTO(voiceDTO),profile=voice.profile||null,silent=!!voice.silent||!!voice.percussion&&arrangement.type!=='drums';
 const bendAt=time=>{if(!curve.length)return scalar*clamp(time/span,0,1);let previous={t:0,v:0};for(const p of curve){if(time<=p.t)return p.t===previous.t?p.v:previous.v+(p.v-previous.v)*(time-previous.t)/(p.t-previous.t);previous=p;}return previous.v;};
 return {pitch,duration,velocity,profile,silent,audible:!silent&&velocity>0,voice:guideVoiceDTO(voice),dynamicPitch:!!(curve.length||scalar||slide||strength),
  pitchAt(time){time=Math.max(0,time);return pitch+bendAt(time)+slide*clamp(time/span,0,1)+(strength ? .25*strength/255*Math.sin(2*Math.PI*5.5*time):0);},
  gainAt(time){if(silent||time<0||time>=duration)return 0;const attack=clamp(time/(profile?.attack??.006),0,1),release=clamp((duration-time)/(profile?.release??.04),0,1),picking=tremolo?.15+.85*(.5+.5*Math.cos(2*Math.PI*8*time)):1,decay=mute?Math.max(20,profile?.decay??0):palm?Math.max(12,profile?.decay??0):profile?.decay??1.6;return velocity*attack*release*Math.exp(-decay*time)*(mute?.25:palm?.6:1)*picking;}
 };
}
// 200 Hz control tables are bounded for long imported sustains. Frequency and
// envelope interpolation are shared with WebAudio AudioParam scheduling.
export function guideTables(plan,{duration=plan.duration,offset=0,sourceAt=t=>offset+t,frequencyAt=pitch=>pitch}={}){
 const count=Math.min(120001,Math.max(2,Math.ceil(duration*200)+1)),frequencies=new Float32Array(count),gains=new Float32Array(count);let audible=false,lastFrequency=1;
 for(let i=0;i<count;i++){const wall=duration*i/(count-1),time=sourceAt(wall),frequency=frequencyAt(plan.pitchAt(time)),valid=Number.isFinite(frequency)&&frequency>0;frequencies[i]=valid?frequency:lastFrequency;if(valid)lastFrequency=frequency;const gain=valid?plan.gainAt(time)*clamp((duration-wall)/.005,0,1)*(offset>0?clamp(wall/.004,0,1):1):0;gains[i]=Number.isFinite(gain)?gain:0;if(gain>0)audible=true;}
 return {frequencies,gains,duration,audible};
}
export function tableValue(values,time,duration){const position=clamp(time/duration,0,1)*(values.length-1),index=Math.floor(position),fraction=position-index;return values[index]+((values[index+1]??values[index])-values[index])*fraction;}
