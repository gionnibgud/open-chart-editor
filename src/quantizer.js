import {beatAt,timeAt,snapTime} from './model.js';
// Swing delays odd subdivisions inside each pair. Triplet grids stay straight;
// changing snap never rewrites authored beat markers or backing audio.
export function snapFraction(step,division,swing=.5){
 if(!Number.isInteger(division)||division<1||division>64)throw Error('Snap division must be an integer from 1 to 64');
 if(!Number.isFinite(swing)||swing<.5||swing>.9)throw Error('Swing must be between 50 and 90 percent');
 return step/division+(division%2===0&&step%2!==0?(swing-.5)*2/division:0);
}
export function createQuantizer(beats,{division=4,mode='grid',swing=.5,onsets=[]}={}){
 if(!['grid','onsets'].includes(mode))throw Error('Choose grid or audio-onset snap');
 if(division!==0)snapFraction(0,division,swing);
 const times=mode==='onsets'?[...new Set(onsets.map(o=>typeof o==='number'?o:o.time).filter(t=>Number.isFinite(t)&&t>=0))].sort((a,b)=>a-b):[];
 const nearestOnset=time=>{let lo=0,hi=times.length;while(lo<hi){const mid=(lo+hi)>>1;if(times[mid]<time)lo=mid+1;else hi=mid;}const left=times[lo-1],right=times[lo];return left===undefined?right:right===undefined?left:time-left<right-time-1e-12?left:right;};
 const snap=time=>{
  if(!Number.isFinite(time))throw Error('Snap time must be finite');
  if(!division)return Math.max(0,time);
  if(mode==='onsets')return times.length?nearestOnset(time):Math.max(0,time);
  if(swing===.5||division%2)return snapTime(beats,time,division);
  const position=beatAt(beats,time),base=Math.floor(position),candidates=[];
  for(let step=0;step<=division;step++)candidates.push(base+snapFraction(step,division,swing));
  let best=candidates[0];for(const candidate of candidates)if(Math.abs(candidate-position)<=Math.abs(best-position))best=candidate;
  return Math.max(0,timeAt(beats,best));
 };
 return Object.assign(snap,{available:mode!=='onsets'||times.length>0,onsetCount:times.length});
}
export function resnapSelection(arrangement,ids,snap){
 const selected=new Set(ids),pending=[];let notes=0,chords=0;
 const plan=(object,time)=>{if(!Number.isFinite(object.time)||object.time<0||!Number.isFinite(time)||time<0)throw Error('Cannot resnap invalid or negative event times');pending.push([object,time]);};
 for(const note of arrangement.notes||[])if(selected.has(note.id)){plan(note,snap(note.time));notes++;}
 for(const chord of arrangement.chords||[])if((chord.notes||[]).some(n=>selected.has(n.id))){
  const time=snap(chord.time),delta=time-chord.time;plan(chord,time);chords++;
  for(const note of chord.notes||[]){plan(note,(note.time??chord.time)+delta);notes++;}
 }
 if(!pending.length)throw Error('Select notes or chord members to resnap');
 // Validate the whole operation before mutating any event. Tails and relative
 // articulation curves keep their durations; every chord moves as one event.
 const changed=pending.filter(([object,time])=>object.time!==time).length;
 for(const [object,time]of pending)object.time=time;
 arrangement.notes.sort((a,b)=>a.time-b.time);arrangement.chords.sort((a,b)=>a.time-b.time);
 return {notes,chords,changed};
}
