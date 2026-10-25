// Original atomic string-position editing; no proprietary command code.
import {clone,synchronizeChordVoicings} from './model.js';
import {validCapo} from './fret-display.js';
export function moveStrings(arrangement,selectedIds,direction,{preservePitch=false}={}){
 if(!['guitar','bass'].includes(arrangement.type))throw Error('String movement requires a guitar or bass arrangement');
 if(![1,-1].includes(direction))throw Error('Choose one adjacent string up or down');
 const ids=new Set(selectedIds),notes=[...(arrangement.notes||[]),...(arrangement.chords||[]).flatMap(c=>c.notes||[])],chosen=notes.filter(n=>ids.has(n.id));
 if(!ids.size)throw Error('Select notes to move between strings');
 if(chosen.length!==ids.size||new Set(chosen.map(n=>n.id)).size!==chosen.length)throw Error('String movement needs unique existing note IDs');
 const maxFret=24-validCapo(arrangement.capo||0),updates=new Map(),fingers=new Map();
 for(const chord of arrangement.chords||[])for(const note of chord.notes||[])fingers.set(note.id,arrangement.chord_templates?.[chord.chord_id]?.fingers?.[note.string]??-1);
 const open=string=>{const pitch=arrangement.basePitches?.[string],offset=arrangement.tuning?.[string]??0;if(!Number.isInteger(pitch)||!Number.isInteger(offset))throw Error('String movement needs valid base pitches and tuning');return pitch+offset+(arrangement.capo||0)};
 const fret=value=>{if(!Number.isInteger(value)||value<0||value>maxFret)throw Error(`The whole selection must fit frets 0 to ${maxFret} on the destination strings`);return value};
 for(const note of chosen){
  const string=note.string+direction;if(!Number.isInteger(note.string)||note.string<0||note.string>=arrangement.stringCount||string<0||string>=arrangement.stringCount)throw Error('The whole selection must fit on the adjacent strings');
  const source=open(note.string),target=open(string),shift=preservePitch?source-target:0,next=clone(note);fret(note.fret);
  if(Object.hasOwn(note,'pitch')){if(note.pitch!==source+note.fret)throw Error('Explicit pitch conflicts with fret and tuning; resolve it before moving strings');next.pitch=preservePitch?note.pitch:target+note.fret;}
  next.string=string;next.fret=fret(note.fret+shift);
  if(fingers.has(note.id)){next.techniques||={};next.techniques.left_hand??=fingers.get(note.id);}
  for(const key of ['slide_to','slide_unpitch_to'])if(Object.hasOwn(next.techniques||{},key)&&next.techniques[key]!==-1)next.techniques[key]=fret(fret(next.techniques[key])+shift);
  updates.set(note.id,next);
 }
 const candidate={...arrangement,notes:(arrangement.notes||[]).map(n=>updates.get(n.id)||n),chords:(arrangement.chords||[]).map(c=>(c.notes||[]).some(n=>ids.has(n.id))?{...c,notes:c.notes.map(n=>updates.get(n.id)||n)}:c),chord_templates:[...(arrangement.chord_templates||[])],handshapes:(arrangement.handshapes||[]).map(h=>({...h}))};
 const lanes=new Map();for(const note of [...candidate.notes,...candidate.chords.flatMap(c=>c.notes||[])]){const lane=lanes.get(note.string)||[];lane.push(note);lanes.set(note.string,lane);}
 for(const lane of lanes.values()){lane.sort((a,b)=>a.time-b.time);for(let i=1;i<lane.length;i++)if(Math.abs(lane[i].time-lane[i-1].time)<.001&&(ids.has(lane[i].id)||ids.has(lane[i-1].id)))throw Error('String movement would place two notes on the same string at the same time');}
 synchronizeChordVoicings(candidate,ids);
 for(const key of ['notes','chords','chord_templates','handshapes'])arrangement[key]=candidate[key];
 return{count:chosen.length,direction,preservePitch};
}
