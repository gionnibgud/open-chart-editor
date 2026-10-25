/** Original zone endpoint fitting. Purpose informed by retained
 * prerelease evidence; this is NOT its decompiled algorithm or exact parity.
 * Public times are seconds. Gutter is a fraction of the supplied beat map.
 * No musical events, templates, stored difficulties or source fields change.
 */
import {assertGrid,beatAt,timeAt} from './model.js';
import {chordZoneStyle} from './chord-tools.js';

export const ZONE_FIT_LIMITS=Object.freeze({zones:200000,events:2000000,beats:200000,phrases:200000});
const previews=new WeakMap();
const finite=value=>typeof value==='number'&&Number.isFinite(value);
function lower(values,value){let l=0,r=values.length;while(l<r){const m=(l+r)>>>1;if(values[m]<value)l=m+1;else r=m;}return l;}
function upper(values,value){let l=0,r=values.length;while(l<r){const m=(l+r)>>>1;if(values[m]<=value)l=m+1;else r=m;}return l;}
function maxIndex(values){
 let size=1;while(size<values.length)size*=2;
 const tree=new Float64Array(size*2);tree.fill(-Infinity);tree.set(values,size);
 for(let i=size-1;i;i--)tree[i]=Math.max(tree[i*2],tree[i*2+1]);
 return (start,end)=>{let result=-Infinity;for(let l=start+size,r=end+size;l<r;l>>=1,r>>=1){if(l&1)result=Math.max(result,tree[l++]);if(r&1)result=Math.max(result,tree[--r]);}return result;};
}
function array(value,label){if(value===undefined)return [];if(!Array.isArray(value))throw Error(`${label} must be an array`);return value;}
function signature(value){try{return JSON.stringify(value);}catch{throw Error('Zone fitting requires a serializable project snapshot');}}
function context(arrangement,options){
 const {beats,duration,mode='both',gutterBeats=0,boundary='both',conflicts='skip'}=options;
 if(!arrangement||!['guitar','bass'].includes(arrangement.type))throw Error('Zone fitting requires a guitar or bass arrangement');
 if(!finite(duration)||duration<=0)throw Error('Choose a positive song duration');
 if(!['chord','fingerprint','both'].includes(mode))throw Error('Choose chord, fingerprint or both modes');
 if(!['phrase','handshape','both'].includes(boundary))throw Error('Choose phrase, handshape or both boundaries');
 if(!['skip','reject'].includes(conflicts))throw Error('Choose skip or reject for fitting conflicts');
 if(!finite(gutterBeats)||gutterBeats<0||gutterBeats>10000)throw Error('Gutter must be between0 and10000 beat intervals');
 if(!Array.isArray(beats)||beats.length>ZONE_FIT_LIMITS.beats)throw Error('Choose a bounded beat map');
 assertGrid(beats);if(beats[0].time<0)throw Error('Beat times must be nonnegative');
 const phrases=array(options.phrases??arrangement.phrases,'Phrases');
 if(phrases.length>ZONE_FIT_LIMITS.phrases||phrases.some(p=>!p||!finite(p.time)||p.time<0||p.time>duration))throw Error('Phrase boundaries must be finite and inside the song');
 const range=options.range;
 if(range&&(!finite(range.start)||!finite(range.end)||range.start<0||range.end>duration||range.end<=range.start))throw Error('Choose a positive fitting range inside the song');
 const indices=options.zoneIndices;
 if(indices!==undefined&&(!Array.isArray(indices)||!indices.length))throw Error('Choose at least one zone index');
 if(!range&&indices===undefined)throw Error('Choose an explicit fitting range or zone indices');
 return {beats,duration,mode,gutterBeats,boundary,conflicts,phrases,range,indices};
}
function contentIndex(arrangement){
 const events=[];let count=0;
 const bounded=()=>{if(++count>ZONE_FIT_LIMITS.events)throw Error('Musical records exceed the bounded fitting limit');};
 function noteEnd(note,parent){
  bounded();if(!note||typeof note!=='object')throw Error('A note has invalid timing');
  const time=note.time??note.t??parent,sustain=note.sustain??note.sus??0;
  if(!finite(time)||time<0||!finite(sustain)||sustain<0)throw Error('Note times and sustains must be finite and nonnegative');
  let end=time+sustain;
  for(const point of array(note.techniques?.bend_values??note.techniques?.bnv,'Bend points')){
   bounded();if(!point||!finite(point.t)||point.t<0)throw Error('A bend point has invalid relative timing');
   end=Math.max(end,time+point.t);
  }
  if(!finite(end))throw Error('A note end exceeds the finite fitting range');
  events.push({time,end});return end;
 }
 for(const note of array(arrangement.notes,'Notes'))noteEnd(note);
 for(const chord of array(arrangement.chords,'Chords')){
  bounded();if(!chord||!finite(chord.time??chord.t)||(chord.time??chord.t)<0)throw Error('A strum has invalid timing');
  const time=chord.time??chord.t,sustain=chord.sustain??chord.sus??0;
  if(!finite(sustain)||sustain<0||!finite(time+sustain))throw Error('A strum sustain has invalid timing');
  let end=time+sustain;
  for(const child of array(chord.notes,'Strum members'))end=Math.max(end,noteEnd(child,time));
  events.push({time,end});
 }
 events.sort((a,b)=>a.time-b.time);
 return {times:events.map(e=>e.time),query:maxIndex(events.map(e=>e.end))};
}
function containingEnds(zones){
 const values=[...new Set(zones.map(z=>z.end))].sort((a,b)=>a-b),tree=new Int32Array(values.length+1),parents=new Float64Array(zones.length);parents.fill(Infinity);
 const add=index=>{for(let i=index+1;i<tree.length;i+=i&-i)tree[i]++;};
 const sum=end=>{let n=0;for(let i=end;i;i-=i&-i)n+=tree[i];return n;};
 let seen=0;
 for(const zone of [...zones].sort((a,b)=>a.start-b.start||b.end-a.end||a.index-b.index)){
  const rank=lower(values,zone.end),before=sum(rank);
  if(before<seen){let target=before+1,index=0,step=1;while(step*2<tree.length)step*=2;for(;step;step>>=1){const next=index+step;if(next<tree.length&&tree[next]<target){index=next;target-=tree[next];}}parents[zone.index]=values[index];}
  add(rank);seen++;
 }
 return parents;
}

/** Original selection is onset-owned [start,end). Explicit indices and range
 * intersect when both supplied. Chord mode includes arpeggios; a hidden name
 * alone does not turn an ordinary chord zone into a fingerprint.
 * Next matching-mode start always bounds fitting. Optional original phrase
 * and containing ORIGINAL handshape bounds cap extension; song end always caps.
 * Existing attacks/tails/curves/contained zones are protected. Conflicts skip
 * with a reason (default), or reject the whole plan without any mutation.
 */
export function planZoneFit(arrangement,options={}){
 const cfg=context(arrangement,options),shapes=array(arrangement.handshapes,'Hand shapes');
 if(shapes.length>ZONE_FIT_LIMITS.zones)throw Error('Zone count exceeds the bounded fitting limit');
 const selected=cfg.indices===undefined?null:new Set(cfg.indices);
 if(selected&&[...selected].some(i=>!Number.isInteger(i)||i<0||i>=shapes.length))throw Error('Choose existing zone indices');
 const zones=shapes.map((h,index)=>{
  if(!h||!finite(h.start_time)||h.start_time<0||!finite(h.end_time)||h.end_time<=h.start_time)throw Error('Every zone must have finite positive bounds');
  const style=chordZoneStyle(arrangement,index);if(!['chord','fingerprint','arpeggio'].includes(style.kind))throw Error('A zone has an unsupported presentation kind');
  return {index,start:h.start_time,end:h.end_time,mode:style.kind==='fingerprint'?'fingerprint':'chord'};
 });
 const groups=new Map(),duplicates=new Map();
 for(const z of zones){if(!groups.has(z.start))groups.set(z.start,[]);groups.get(z.start).push(z.end);const key=JSON.stringify([z.start,z.end]);duplicates.set(key,(duplicates.get(key)||0)+1);}
 const starts=[...groups.keys()].sort((a,b)=>a-b);
 for(const [key,ends] of groups)groups.set(key,[...new Set(ends)].sort((a,b)=>a-b));
 const zoneMax=maxIndex(starts.map(start=>groups.get(start).at(-1))),parents=containingEnds(zones),content=contentIndex(arrangement);
 const kindStarts=Object.fromEntries(['chord','fingerprint'].map(kind=>[kind,[...new Set(zones.filter(z=>z.mode===kind).map(z=>z.start))].sort((a,b)=>a-b)]));
 const phraseStarts=[...new Set(cfg.phrases.map(p=>p.time))].sort((a,b)=>a-b);
 const changes=[],skipped=[],unchanged=[];
 for(const z of zones){
  if(selected&&!selected.has(z.index)||cfg.range&&(z.start<cfg.range.start||z.start>=cfg.range.end)||cfg.mode!=='both'&&cfg.mode!==z.mode)continue;
  let cap=cfg.duration,reason='song';
  const bound=(end,label)=>{if(end<cap){cap=end;reason=label;}};
  if(cfg.boundary!=='handshape')bound(phraseStarts[upper(phraseStarts,z.start)]??cfg.duration,'phrase');
  if(cfg.boundary!=='phrase')bound(parents[z.index],'containing handshape');
  bound(kindStarts[z.mode][upper(kindStarts[z.mode],z.start)]??Infinity,'next matching zone');
  const candidate=cfg.gutterBeats?timeAt(cfg.beats,beatAt(cfg.beats,cap)-cfg.gutterBeats):cap;
  const ends=groups.get(z.start),sameStart=lower(ends,z.end)-1;
  const required=Math.max(z.start,content.query(lower(content.times,z.start),lower(content.times,z.end)),zoneMax(upper(starts,z.start),lower(starts,z.end)),sameStart>=0?ends[sameStart]:-Infinity);
  const conflict=duplicates.get(JSON.stringify([z.start,z.end]))>1?'Duplicate zone bounds need an explicit edit':!finite(candidate)||candidate<=z.start?'Gutter leaves no positive zone':candidate<required?'Fitting would cut existing musical tails, curves or contained zones':null;
  const row={index:z.index,start:z.start,oldEnd:z.end,newEnd:candidate,boundary:reason,boundaryTime:cap,protectedUntil:required,mode:z.mode};
  if(conflict){if(cfg.conflicts==='reject')throw Error(`Zone ${z.index}: ${conflict}`);skipped.push(Object.freeze({...row,reason:conflict}));}
  else if(candidate===z.end)unchanged.push(Object.freeze(row));
  else changes.push(Object.freeze(row));
 }
 const plan=Object.freeze({policy:'original-zone-fit-v1',mode:cfg.mode,gutterBeats:cfg.gutterBeats,boundary:cfg.boundary,changes:Object.freeze(changes),skipped:Object.freeze(skipped),unchanged:Object.freeze(unchanged),counts:Object.freeze({changed:changes.length,skipped:skipped.length,unchanged:unchanged.length,total:zones.length})});
 previews.set(plan,{arrangement:signature(arrangement),beats:signature(cfg.beats),phrases:signature(cfg.phrases),duration:cfg.duration,phraseFromArrangement:options.phrases===undefined});
 return plan;
}

/** Caller supplies CURRENT context, including grid/duration, so replacing a
 * project beat array while a dialog is open cannot apply a stale preview.
 * Copy-on-write working zones protect aliases into stored DD/source arrays.
 * History and active-level snapshotting remain caller responsibilities.
 */
export function applyZoneFit(arrangement,plan,{beats,phrases,duration}={}){
 const saved=previews.get(plan);if(!saved)throw Error('Choose a fresh zone fitting preview');
 const currentPhrases=phrases??(saved.phraseFromArrangement?arrangement.phrases??[]:undefined);
 if(signature(arrangement)!==saved.arrangement||signature(beats)!==saved.beats||signature(currentPhrases)!==saved.phrases||duration!==saved.duration)throw Error('Zone fitting preview is stale; preview again against the current project');
 const updates=new Map(plan.changes.map(row=>[row.index,row.newEnd]));
 if(updates.size)arrangement.handshapes=arrangement.handshapes.map((zone,index)=>updates.has(index)?{...zone,end_time:updates.get(index)}:zone);
 return {...plan.counts};
}
