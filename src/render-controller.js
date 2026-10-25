// Only synthesis inputs cross the worker boundary. Song audio, native packages,
// undo stacks and opaque authoring data remain on the editor thread.
import {guideVoiceTimelineDTO} from './guide-voice.js';
const pick=(source,keys)=>Object.fromEntries(keys.filter(key=>source?.[key]!==undefined).map(key=>[key,source[key]]));
const techniqueKeys=['bend','slide_to','vibrato','palm_mute','fret_hand_mute','tremolo','accent','ignore'];
function techniques(source){const result=pick(source,techniqueKeys);if(Array.isArray(source?.bend_values))result.bend_values=source.bend_values.map(p=>pick(p,['t','v']));return result;}
function note(source){return {...pick(source,['time','sustain','pitch','string','fret','velocity','piece','ghost','flam','choke']),techniques:techniques(source.techniques)};}
export function practiceDTO(project,{rigLibrary=null}={}){
 return {_practiceDTO:1,duration:project.duration,arrangements:(project.arrangements||[]).filter(a=>!a.editorOnly&&a.readOnly!==true&&a._notationOnly!==true).map(a=>({
  ...pick(a,['type','stringCount','capo','centOffset']),basePitches:a.basePitches?.slice(),tuning:a.tuning?.slice(),
  _guideVoiceTimeline:guideVoiceTimelineDTO(a,{rigLibrary}),
  notes:(a.notes||[]).map(note),chord_templates:(a.chord_templates||[]).map(t=>({frets:t.frets?.slice()})),
  chords:(a.chords||[]).map(c=>({...pick(c,['time','chord_id','sustain','velocity',...techniqueKeys]),techniques:techniques(c.techniques),notes:c.notes?.map(note)}))
 }))};
}
const aborted=message=>Object.assign(new Error(message),{name:'AbortError'});
export class PracticeRenderer{
 constructor({workerFactory=()=>new Worker(new URL('./render-worker.js',import.meta.url),{type:'module'})}={}){this.workerFactory=workerFactory;this.active=null;this.disposed=false;}
 get busy(){return !!this.active;}
 render(project,{sampleRate=48000,onProgress=()=>{},isCurrent=()=>true,rigLibrary=null}={}){
  if(this.disposed)return Promise.reject(aborted('Practice renderer was closed'));
  this.cancel();
  return new Promise((resolve,reject)=>{
   let worker;try{worker=this.workerFactory();}catch(error){reject(new Error(`Background audio rendering is unavailable: ${error.message}. Import recorded audio instead.`));return;}
   const job={worker,reject};this.active=job;
   const finish=(error,result)=>{if(this.active!==job)return;this.active=null;worker.terminate();error?reject(error):resolve(result);};
   worker.onmessage=({data})=>{if(this.active!==job)return;if(!isCurrent()){finish(aborted('Practice render discarded because the project changed'));return;}if(data.type==='progress')onProgress(data.progress);else if(data.type==='result')finish(null,data.bytes);else if(data.type==='error')finish(new Error(data.message));};
   worker.onerror=event=>{event.preventDefault?.();finish(new Error(`Background practice rendering failed: ${event.message||'worker error'}`));};
   worker.onmessageerror=()=>finish(new Error('Background practice render could not be transferred'));
   try{worker.postMessage({project:practiceDTO(project,{rigLibrary}),options:{sampleRate}});}catch(error){finish(error);}
  });
 }
 cancel(message='Practice render cancelled'){const job=this.active;if(!job)return false;this.active=null;job.worker.terminate();job.reject(aborted(message));return true;}
 dispose(){this.disposed=true;this.cancel('Practice renderer was closed');}
}
