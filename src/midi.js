// Original Web MIDI authoring. Importing this module never requests devices.
import { DRUMS, makeNote, pitches } from './model.js';

export const GM_DRUMS = Object.freeze({30:'stack',35:'kick',36:'kick',37:'snare_xstick',38:'snare',40:'snare',41:'tom_floor',42:'hh_closed',43:'tom_low',44:'hh_pedal',45:'tom_mid',46:'hh_open',47:'tom_mid',48:'tom_hi',49:'crash_l',50:'tom_hi',51:'ride',52:'china',53:'ride_bell',55:'splash',57:'crash_r',59:'ride',80:'bell'});
const idOf = arrangement => arrangement.id ?? arrangement;

export function midiRealization(arrangement, pitch, { occupiedStrings = [], lastFret = 0 } = {}) {
  if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127) return { ok:false, reason:'MIDI pitch must be 0 to 127' };
  if (arrangement.type === 'drums') {
    const piece=GM_DRUMS[pitch],lane=DRUMS.indexOf(piece);
    return lane<0 ? {ok:false,reason:`GM drum note ${pitch} has no supported kit piece`} : {ok:true,lane,piece,fret:0};
  }
  if (arrangement.type === 'guitar' || arrangement.type === 'bass') {
    const capo=arrangement.capo??0,maxFret=arrangement.maxFret??24;
    if(!Number.isInteger(capo)||capo<0||capo>24||!Number.isInteger(maxFret)||maxFret<0||maxFret>24)return {ok:false,reason:'Choose a whole capo and fret limit from 0 to 24 before recording'};
    const fretLimit=Math.min(maxFret,24-capo);
    const base=arrangement.basePitches||pitches(arrangement.type,arrangement.stringCount),candidates=[];
    for(let string=0;string<arrangement.stringCount;string++){
      const fret=pitch-(base[string]+(arrangement.tuning?.[string]||0)+(arrangement.capo||0));
      if(Number.isInteger(fret)&&fret>=0&&fret<=fretLimit&&!occupiedStrings.includes(string))candidates.push({ok:true,lane:string,fret,score:fret+Math.abs(fret-lastFret)*.3});
    }
    candidates.sort((a,b)=>a.score-b.score||b.lane-a.lane);
    return candidates[0]||{ok:false,reason:`Pitch ${pitch} cannot fit an available string in this tuning/capo/fret range`};
  }
  return {ok:true,lane:pitch,fret:0};
}

export class MidiRecorder {
  constructor({ arrangement, getTime, onNote, quantize = time=>time, onAudition = ()=>{}, onUnmappable = ()=>{} } = {}) {
    if(!arrangement||typeof getTime!=='function'||typeof onNote!=='function')throw Error('MIDI recording needs arrangement, clock and note callback');
    this.arrangement=arrangement;this.getTime=getTime;this.onNote=onNote;this.quantize=quantize;this.onAudition=onAudition;this.onUnmappable=onUnmappable;
    this.active=new Map();this.pedals=new Set();this.recording=true;this.auditioning=false;this.lastFret=0;this.lastTime=null;
  }
  get isRecording(){return this.recording;}
  get isAuditioning(){return this.auditioning;}
  startAudition(){if(this.pendingCount)this.flush();this.recording=false;this.auditioning=true;this.lastTime=null;return this;}
  get pendingCount(){return [...this.active.values()].reduce((count,queue)=>count+queue.length,0);}
  time(){const time=Number(this.getTime());if(!Number.isFinite(time)||time<0)throw Error('MIDI transport time must be finite and nonnegative');return time;}
  currentArrangement(){const arrangement=typeof this.arrangement==='function'?this.arrangement():this.arrangement;if(!arrangement)throw Error('Choose an arrangement before recording');return arrangement;}
  start(){if(this.pendingCount)this.flush();this.recording=true;this.auditioning=false;this.lastTime=null;return this;}
  // A rejected source edit remains pending for explicit recovery; Stop still
  // disables capture so later MIDI cannot silently append more notes.
  stop(){try{return this.flush();}finally{this.recording=false;this.auditioning=false;}}
  finish(entry,time){
    const start=Math.max(0,Number(this.quantize(entry.started))),end=Math.max(start,Number(this.quantize(Math.max(entry.started,time))));
    if(!Number.isFinite(start)||!Number.isFinite(end))throw Error('MIDI quantization must return finite seconds');
    const note=entry.note;note.time=start;note.sustain=entry.arrangement.type==='drums'?0:end-start;
    this.onNote(note,entry.arrangement);return note;
  }
  flush(channel=null,time=this.pendingCount?this.time():0){
    this.onAudition({type:'flush',channel});
    if(this.auditioning&&channel===null)this.onAudition({type:'stop'});
    const notes=[];
    for(const [key,queue]of this.active){
      const retained=[];
      for(const entry of queue){if(channel==null||entry.channel===channel){notes.push(this.finish(entry,time));this.onAudition({type:'noteoff',pitch:entry.pitch,channel:entry.channel,velocity:0});}else retained.push(entry);}
      if(retained.length)this.active.set(key,retained);else this.active.delete(key);
    }
    if(channel==null)this.pedals.clear();else this.pedals.delete(channel);
    return notes;
  }
  releasePedal(channel,time){
    const notes=[];this.pedals.delete(channel);
    for(const [key,queue]of this.active){
      const retained=[];
      for(const entry of queue){if(entry.channel===channel&&entry.released)notes.push(this.finish(entry,time));else retained.push(entry);}
      if(retained.length)this.active.set(key,retained);else this.active.delete(key);
    }
    return notes;
  }
  handleMessage(eventOrBytes){
    const data=eventOrBytes?.data??eventOrBytes;
    if(!data||data.length<1)return {handled:false,status:'invalid',reason:'MIDI bytes required'};
    const status=data[0],command=status&0xf0,channel=status&15;
    if(![0x80,0x90,0xb0].includes(command))return {handled:false,status:'ignored'};
    if(data.length<3||![data[1],data[2]].every(value=>Number.isInteger(value)&&value>=0&&value<=127))return {handled:false,status:'invalid',reason:'Incomplete or invalid MIDI message'};
    if(!this.recording){
      if(!this.auditioning)return {handled:false,status:'stopped'};
      const pitch=data[1],velocity=data[2];
      if(command===0xb0){if(![64,120,121,123].includes(pitch))return {handled:false,status:'ignored'};this.onAudition({type:'control',controller:pitch,value:velocity,channel});return {handled:true,status:'audition-control'};}
      if(command===0x80||velocity===0){this.onAudition({type:'noteoff',pitch,channel,velocity:0});return {handled:true,status:'audition-noteoff'};}
      const arrangement=this.currentArrangement();
      if(arrangement.readOnly){const result={handled:true,status:'unmappable',reason:'Retained source notation is read-only; choose an editable instrument for MIDI audition'};this.onUnmappable(result);return result;}
      const piece=arrangement.type==='drums'?GM_DRUMS[pitch]:null;
      if(arrangement.type==='drums'&&!piece){const result={handled:true,status:'unmappable',pitch,channel,reason:`GM drum note ${pitch} has no supported kit piece`};this.onUnmappable(result);return result;}
      this.onAudition({type:'noteon',pitch,channel,velocity,arrangement,note:piece?{piece,velocity}:{pitch,velocity}});
      return {handled:true,status:'auditioned',pitch,channel,piece};
    }
    const time=this.time();
    if(this.lastTime!=null&&time<this.lastTime-.001){this.flush(null,this.lastTime);this.onUnmappable({reason:'Transport moved backwards; held notes were ended at the previous recording position',status:'transport-moved'});}
    this.lastTime=time;
    const pitch=data[1],velocity=data[2],key=`${channel}:${pitch}`;
    if(command===0xb0){
      if([64,120,121,123].includes(pitch))this.onAudition({type:'control',controller:pitch,value:velocity,channel});
      if(pitch===120||pitch===123)return {handled:true,status:'all-notes-off',notes:this.flush(channel,time)};
      if(pitch===121)return {handled:true,status:'controllers-reset',notes:this.releasePedal(channel,time)};
      if(pitch!==64)return {handled:false,status:'ignored'};
      if(velocity>=64){this.pedals.add(channel);return {handled:true,status:'pedal-down'};}
      return {handled:true,status:'pedal-up',notes:this.releasePedal(channel,time)};
    }
    if(command===0x80||velocity===0){
      this.onAudition({type:'noteoff',pitch,channel,velocity:0});
      const queue=this.active.get(key),entry=queue?.find(item=>!item.released);
      if(!entry)return {handled:true,status:'unmatched-noteoff'};
      if(entry.arrangement.type!=='guitar'&&entry.arrangement.type!=='bass'&&entry.arrangement.type!=='drums'&&this.pedals.has(channel)){entry.released=true;return {handled:true,status:'sustained'};}
      queue.splice(queue.indexOf(entry),1);if(!queue.length)this.active.delete(key);
      return {handled:true,status:'recorded',note:this.finish(entry,time)};
    }
    const arrangement=this.currentArrangement(),occupiedStrings=[...this.active.values()].flat().filter(entry=>idOf(entry.arrangement)===idOf(arrangement)).map(entry=>entry.note.string);
    const realization=midiRealization(arrangement,pitch,{occupiedStrings,lastFret:this.lastFret});
    if(!realization.ok){const result={handled:true,status:'unmappable',pitch,channel,reason:realization.reason};this.onUnmappable(result);return result;}
    const note=makeNote(arrangement,time,realization.lane,realization.fret,0);note.velocity=velocity;note.midi={pitch,channel,velocity};
    if(!['guitar','bass','drums'].includes(arrangement.type)){note.pitch=pitch;note.string=Math.floor(pitch/24);note.fret=pitch%24;note.hand=pitch<60?'lh':'rh';}
    this.onAudition({type:'noteon',pitch,channel,velocity,note,arrangement});
    const entry={pitch,channel,started:time,note,arrangement,released:false};
    if(arrangement.type==='drums')return {handled:true,status:'recorded',note:this.finish(entry,time)};
    this.lastFret=realization.fret;
    if(!this.active.has(key))this.active.set(key,[]);this.active.get(key).push(entry);
    return {handled:true,status:'note-on',note};
  }
}

// One browser MIDIInput can be shared by overlapping mounts/connections. Keep
// native open/close serialized and close only after the last lease is released.
// Web MIDI has no abortable open: a canceled pending open is closed on resolve,
// unless a newer lease now owns it. Failures are observed without orphan promises.
const midiInputLeases=new WeakMap();
function acquireMidiLease(input){
 let record=midiInputLeases.get(input);
 if(!record){record={input,owners:new Set(),ready:null,closing:null,opened:false};midiInputLeases.set(input,record);}
 const token={};record.owners.add(token);
 if(!record.ready){
  const ready=(async()=>{if(record.closing)await record.closing;await input.open?.();record.opened=true;})();
  record.ready=ready;
  ready.catch(()=>{if(record.ready===ready)record.ready=null;record.opened=false;});
 }
 const ready=record.ready;let released=false;
 return{ready,release(){if(released)return;released=true;record.owners.delete(token);if(!record.owners.size)ready.then(()=>closeUnusedMidiLease(record)).catch(()=>{});}};
}
function closeUnusedMidiLease(record){
 if(record.owners.size||!record.opened||record.closing)return;
 record.opened=false;record.ready=null;
 const closing=Promise.resolve().then(()=>record.input.close?.()).catch(()=>{}).finally(()=>{if(record.closing===closing)record.closing=null;});
 record.closing=closing;
}

export async function connectMidiInput(recorder,{inputId=null,requestAccess=null,onState=()=>{}}={}) {
 const request=requestAccess??globalThis.navigator?.requestMIDIAccess?.bind(globalThis.navigator);
 if(!request)throw Error('Web MIDI is unavailable in this browser; use a MIDI file import');
 const access=await request({sysex:false});let selected=null,selectedLease=null,selectedId=inputId,closed=false,selectionRequest=0;const pending=new Set();
 const inputs=()=>[...access.inputs.values()].filter(input=>input.state!=='disconnected').map(input=>({id:input.id,name:input.name||input.id,manufacturer:input.manufacturer||'',state:input.state||'connected'}));
 const handle=event=>recorder.handleMessage(event);
 const releasePending=()=>{for(const lease of pending)lease.release();pending.clear();};
 const detach=()=>{
  if(!selected)return;
  if(selected.removeEventListener)selected.removeEventListener('midimessage',handle);else if(selected.onmidimessage===handle)selected.onmidimessage=null;
  selected=null;selectedLease?.release();selectedLease=null;
 };
 async function selectInput(id){
  if(closed)throw Error('MIDI connection is closed');
  const input=access.inputs.get(id);if(!input||input.state==='disconnected')throw Error('Choose a connected MIDI input');
  if(input===selected)return;
  const requestId=++selectionRequest;
  recorder.flush();detach();releasePending();selectedId=id;
  const lease=acquireMidiLease(input);pending.add(lease);
  try{
   await lease.ready;
   if(closed||requestId!==selectionRequest){lease.release();return;}
   selected=input;selectedLease=lease;if(input.addEventListener)input.addEventListener('midimessage',handle);else input.onmidimessage=handle;
  }catch(error){lease.release();throw error;}
  finally{pending.delete(lease);}
 }
 const stateChanged=()=>{
  if(closed)return;
  if(selected?.state==='disconnected'){const id=selected.id;try{recorder.flush();}finally{detach();onState({type:'input-disconnected',inputId:id});}}
  if(!selected&&selectedId&&access.inputs.get(selectedId)?.state!=='disconnected'&&access.inputs.has(selectedId))selectInput(selectedId).catch(error=>recorder.onUnmappable({status:'device-error',reason:error.message}));
 };
 if(access.addEventListener)access.addEventListener('statechange',stateChanged);else access.onstatechange=stateChanged;
 try{const id=inputId??inputs()[0]?.id;if(id)await selectInput(id);}catch(error){releasePending();if(access.removeEventListener)access.removeEventListener('statechange',stateChanged);else if(access.onstatechange===stateChanged)access.onstatechange=null;throw error;}
 return{get inputs(){return inputs();},get selectedInputId(){return selected?.id??null;},selectInput,disconnect(){if(closed)return;closed=true;selectionRequest++;try{recorder.stop();}finally{releasePending();detach();if(access.removeEventListener)access.removeEventListener('statechange',stateChanged);else if(access.onstatechange===stateChanged)access.onstatechange=null;}}};
}
