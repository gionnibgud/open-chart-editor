import {notePitch} from './model.js';
import {drumSamples,drumGain,drumEnvelope} from './drum-guide.js';
import {guideNotes,guidePlan,guideTables,tableValue} from './guide-synthesis.js';
import {encodeWav,guideFrequency} from './audio.js';
import {guideVoiceTimelineDTO,guideVoiceAtTimeline,guideHarmonics} from './guide-voice.js';
// Deterministic original practice backing. Shared pitch/dynamics interpretation
// is a listening aid, not native amplifier, articulation, or instrument DSP.
export function renderGuide(project,{sampleRate=48000,duration=project.duration,onProgress=()=>{},rigLibrary=null}={}){
 if(!Number.isFinite(duration)||!(duration>0&&duration<=600))throw Error('Guide rendering supports projects up to ten minutes; import recorded audio for longer songs');
 if(!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>192000)throw Error('Guide sample rate must be a whole number from 8000 to 192000 Hz');
 const frames=Math.ceil(duration*sampleRate);if(frames*4+44>128*1024*1024)throw Error('Guide PCM exceeds 128 MiB; choose a lower sample rate or shorter duration');
 const channels=[new Float32Array(frames),new Float32Array(frames)],arrangements=project.arrangements.filter(a=>!a.editorOnly&&a.readOnly!==true&&a._notationOnly!==true);
 const batches=arrangements.map(a=>({a,notes:guideNotes(a),voiceTimeline:project._practiceDTO===1?a._guideVoiceTimeline:guideVoiceTimelineDTO(a,{rigLibrary})})),total=batches.reduce((n,b)=>n+b.notes.length,0);let completed=0;onProgress(0);
 for(const {a,notes,voiceTimeline} of batches)for(const n of notes){
  if((completed++%128)===0)onProgress(Math.min(.95,completed/Math.max(1,total)*.95));
  if(!Number.isFinite(n.time))continue;const plan=guidePlan(a,n,{voiceDTO:guideVoiceAtTimeline(voiceTimeline,n.time)}),begin=Math.max(0,n.time),end=Math.min(duration,n.time+plan.duration),offset=begin-n.time,span=end-begin;
  if(!(span>0)||!plan.velocity)continue;
  const start=Math.round(begin*sampleRate),length=Math.min(frames-start,Math.round(span*sampleRate)),pitch=notePitch(a,n),isDrum=a.type==='drums';
  const percussion=isDrum?drumSamples(n.piece,sampleRate):null;const tables=isDrum?null:guideTables(plan,{duration:span,offset,frequencyAt:p=>guideFrequency(p,a.centOffset??0,sampleRate)});if(tables&&!tables.audible)continue;
  const harmonics=plan.profile?guideHarmonics(plan.profile,tables.frequencies.reduce((max,value)=>Math.max(max,value),0),sampleRate):null;
  const level=Math.min(.15,.5/Math.sqrt(Math.max(1,arrangements.length))),pan=a.type==='bass'||isDrum?0:a.type==='keys'?Math.max(-1,Math.min(1,(pitch-60)/100)):Math.max(-1,Math.min(1,((Number.isFinite(n.string)?n.string:0)-2.5)/10));let phase=0;
  for(let i=0;i<length;i++){
   const wall=i/sampleRate,t=offset+wall;let value;
   if(isDrum)value=(percussion[Math.floor(t*sampleRate)]||0)*plan.velocity*drumGain(n)*drumEnvelope(wall,span,offset);
   else{const frequency=tableValue(tables.frequencies,wall,span),gain=tableValue(tables.gains,wall,span);let wave=0;if(harmonics){for(let h=0;h<harmonics.length;h++)if(harmonics[h])wave+=harmonics[h]*Math.sin(phase*(h+1));}else wave=Math.sin(phase)+(frequency*2<sampleRate/2?.22*Math.sin(phase*2):0);value=wave*gain;phase=(phase+2*Math.PI*frequency/sampleRate)%(2*Math.PI);}
   value*=level;channels[0][start+i]+=value*(1-pan);channels[1][start+i]+=value*(1+pan);
  }
 }
 onProgress(.97);const bytes=encodeWav({sampleRate,length:frames,numberOfChannels:2,getChannelData:i=>channels[i]});onProgress(1);return bytes;
}
