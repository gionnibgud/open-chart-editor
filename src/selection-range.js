/** Original explicit selection-edge tools.
 * OCE evidence names selection expand/shrink and snap/measure/phrase units
 * (local PARITY F13/FINDINGS section 3). Exact native edge rules are unobserved.
 * Our rules: [start,end) attacks; move the chosen edge to the next STRICT unit
 * boundary, clamp to song bounds, and refuse a shrink that crosses its opposite
 * edge. Measures follow authored downbeats, phrases follow authored markers;
 * snap uses beat coordinates through tempo ramps. No musical data is mutated.
 */
import {assertGrid,beatAt,timeAt} from './model.js';
const EPS=1e-9;
const finite=(value,label)=>{if(!Number.isFinite(value))throw Error(`${label} must be finite seconds`);return value;};
function context(project,division){
 assertGrid(project.beats);const duration=finite(project.duration,'Song duration');if(duration<0)throw Error('Song duration must be nonnegative');
 if(!Number.isFinite(division)||division<1/1024||division>1024)throw Error('Snap division must be between 1/1024 and 1024');
 return {duration,clamp:value=>Math.max(0,Math.min(duration,value))};
}
function snapBoundary(project,time,direction,division){
 const scaled=beatAt(project.beats,time)*division;
 const step=direction<0?Math.ceil(scaled-EPS)-1:Math.floor(scaled+EPS)+1;
 return timeAt(project.beats,step/division);
}
function markerBoundaries(project,arrangement,unit){
 const values=unit==='measure'?project.beats.filter(beat=>beat.measure>=0).map(beat=>beat.time):(arrangement.phrases||[]).map(phrase=>phrase.time??phrase.start_time);
 for(const value of values)finite(value,`${unit} boundary`);
 return [...new Set([0,project.duration,...values.filter(value=>value>=0&&value<=project.duration)])].sort((a,b)=>a-b);
}
export function rangeForSelectedNotes(project,notes,cursor,{division=4}={}){
 const {clamp}=context(project,division);cursor=clamp(finite(cursor,'Cursor'));
 if(!notes.length)return {start:cursor,end:cursor};
 let start=Infinity,last=-Infinity;for(const note of notes){const attack=clamp(finite(note.time,'Selected note onset'));start=Math.min(start,attack);last=Math.max(last,attack);}
 return {start,end:clamp(snapBoundary(project,last,1,division))};
}
export function resizeSelectionEdges(project,arrangement,range,{mode='expand',edge='both',unit='snap',division=4}={}){
 const {clamp}=context(project,division);
 if(!['expand','shrink'].includes(mode)||!['left','right','both'].includes(edge)||!['snap','measure','phrase'].includes(unit))throw Error('Choose expand/shrink, left/right/both edges and a supported unit');
 let start=finite(range?.start,'Selection start'),end=finite(range?.end,'Selection end');
 if(start>end)throw Error('Selection start must not follow its end');start=clamp(start);end=clamp(end);
 if(mode==='shrink'&&start===end)throw Error('An empty selection cannot shrink');
 const markers=unit==='snap'?null:markerBoundaries(project,arrangement,unit);
 const boundary=(time,direction)=>clamp(unit==='snap'?snapBoundary(project,time,direction,division):direction<0?(markers.findLast(value=>value<time-EPS)??0):(markers.find(value=>value>time+EPS)??project.duration));
 const nextStart=edge==='right'?start:boundary(start,mode==='expand'?-1:1);
 const nextEnd=edge==='left'?end:boundary(end,mode==='expand'?1:-1);
 if(mode==='shrink'&&nextStart>=nextEnd-EPS)throw Error('Selection cannot shrink past its opposite edge');
 return {start:nextStart,end:nextEnd};
}
