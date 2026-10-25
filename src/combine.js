// Combine several arrangements of one instrument into a single playable chart, with a
// tone change wherever the playing part switches (for example Guitar Pro tracks that
// split one guitarist's acoustic intro, rhythm, solo and delay parts). Original logic;
// no DOM, audio or network. The source arrangements are never modified.
import {clone,uid} from './model.js';
import {createTone,copyTone} from './tone-rack.js';

const MIN_SPAN=.05,EPS=.001,TONE_LEAD=.5;
const fretted=a=>a.type==='guitar'||a.type==='bass';
const chordTime=c=>c.time??c.t??0;
const chordRef=c=>Number.isInteger(c.chord_id)?c.chord_id:Number.isInteger(c.id)?c.id:null;

/** Why these arrangements cannot be combined, or null. */
export function combineProblem(project,ids){
 if(!Array.isArray(ids)||new Set(ids).size!==ids.length||ids.length<2)return 'Choose at least two different arrangements';
 const parts=ids.map(id=>project.arrangements.find(a=>a.id===id));
 if(parts.some(a=>!a))return 'An arrangement to combine no longer exists';
 const [first]=parts;
 for(const a of parts){
  if(a.editorOnly||a.readOnly)return `${a.name} is a scratch track or a read-only score and cannot be combined`;
  if(a.type!==first.type)return 'Only arrangements of the same instrument type can be combined';
  if((a.difficulties?.length||0)>1)return `${a.name} has several difficulty levels; combine charts before generating levels`;
  if(fretted(a)){
   if(a.stringCount!==first.stringCount)return 'Fretted arrangements must have the same number of strings';
   const open=x=>Array.from({length:x.stringCount},(_,i)=>(x.basePitches?.[i]??0)+(x.tuning?.[i]??0));
   if(JSON.stringify(open(a))!==JSON.stringify(open(first)))return `${a.name} uses a different tuning from ${first.name}`;
   if((a.capo||0)!==(first.capo||0))return `${a.name} uses a different capo from ${first.name}`;
  }
 }
 return null;
}

function lane(a,note){return a.type==='keys'?`p${note.pitch??note.string*24+note.fret}`:a.type==='drums'?`d${note.piece}`:`s${note.string}`;}
function value(a,note){return a.type==='keys'||a.type==='drums'?'':`f${note.fret}`;}

/** Every note and chord of each source as a timed event with its lanes. */
function events(parts){
 const out=[];
 parts.forEach((a,priority)=>{
  for(const note of a.notes||[])out.push({source:a.id,priority,kind:'note',item:note,start:note.time,end:note.time+Math.max(note.sustain||0,MIN_SPAN),lanes:[[lane(a,note),value(a,note),note.time,note.time+(note.sustain||0)]]});
  for(const chord of a.chords||[]){
   const t=chordTime(chord),template=a.chord_templates?.[chordRef(chord)],children=chord.notes?.length?chord.notes:(template?.frets||[]).map((fret,string)=>fret>=0?{string,fret,sustain:0}:null).filter(Boolean);
   const length=Math.max(MIN_SPAN,...children.map(n=>n.sustain||0));
   out.push({source:a.id,priority,kind:'chord',item:chord,start:t,end:t+length,lanes:children.map(n=>[lane(a,n),value(a,n),t,t+(n.sustain||0)])});
  }
 });
 return out.sort((x,y)=>x.start-y.start||x.priority-y.priority);
}

/** Overlaps between the sources: groups of events from two or more parts whose
 * spans intersect. kind: duplicate (identical notes), conflict (different music), and
 * sameString tells whether two parts use the same string/pitch/piece at once. */
export function findOverlaps(project,ids){
 const problem=combineProblem(project,ids);if(problem)throw Error(problem);
 const parts=ids.map(id=>project.arrangements.find(a=>a.id===id)),all=events(parts),parent=all.map((_,i)=>i);
 const find=i=>parent[i]===i?i:(parent[i]=find(parent[i]));
 let active=[];
 all.forEach((event,i)=>{
  active=active.filter(j=>all[j].end>event.start+EPS);
  for(const j of active)if(all[j].source!==event.source)parent[find(i)]=find(j);
  active.push(i);
 });
 const groups=new Map();all.forEach((event,i)=>{const root=find(i);if(!groups.has(root))groups.set(root,[]);groups.get(root).push(event);});
 const overlaps=[];
 for(const group of groups.values()){
  const sources=[...new Set(group.map(e=>e.source))];if(sources.length<2)continue;
  const signature=id=>JSON.stringify(group.filter(e=>e.source===id).flatMap(e=>e.lanes.map(([l,v,s])=>[l,v,Math.round(s*1000)])).sort());
  const duplicate=sources.every(id=>signature(id)===signature(sources[0]));
  let sameString=false,clash=false;
  for(let i=0;i<group.length&&!clash;i++)for(let j=i+1;j<group.length;j++){
   if(group[i].source===group[j].source)continue;
   for(const [l1,v1,s1,e1] of group[i].lanes)for(const [l2,v2,s2,e2] of group[j].lanes){
    if(l1!==l2)continue;
    if(Math.abs(s1-s2)<EPS){sameString=true;if(v1!==v2)clash=true;}
    else if(s1<s2?e1>s2+EPS:e2>s1+EPS)sameString=true;
   }
  }
  const ordered=[...sources].sort((x,y)=>ids.indexOf(x)-ids.indexOf(y));
  overlaps.push({id:'o'+overlaps.length,start:Math.min(...group.map(e=>e.start)),end:Math.max(...group.map(e=>e.end)),sources:ordered,kind:duplicate?'duplicate':'conflict',sameString,clash,events:group.length,decision:'keep:'+ordered[0]});
 }
 return overlaps.sort((a,b)=>a.start-b.start).map((o,i)=>({...o,id:'o'+i}));
}

/** Build the combined arrangement. `decisions` maps overlap IDs to 'keep:<source id>'
 * or 'both' (only when no two parts play different notes on one string at once).
 * `tones` maps source IDs to tone names. Returns {arrangement, report}. */
export function combineArrangements(project,ids,{name='Combined',tones={},decisions={},overlaps=null}={}){
 const problem=combineProblem(project,ids);if(problem)throw Error(problem);
 const parts=ids.map(id=>project.arrangements.find(a=>a.id===id)),byId=new Map(parts.map(a=>[a.id,a]));
 overlaps??=findOverlaps(project,ids);
 const toneOf=id=>String(tones[id]??byId.get(id).name).trim()||byId.get(id).name;
 const all=events(parts),dropped=new Set(),bothRanges=[];
 for(const overlap of overlaps){
  const decision=decisions[overlap.id]??overlap.decision;
  if(decision==='both'){if(overlap.clash)throw Error(`At ${overlap.start.toFixed(2)} s two parts play different notes on the same string; choose which part to keep there`);bothRanges.push(overlap);continue;}
  const keep=decision.slice(5);if(!overlap.sources.includes(keep))throw Error('Choose one of the overlapping parts to keep');
  for(const event of all)if(event.source!==keep&&overlap.sources.includes(event.source)&&event.start>=overlap.start-EPS&&event.start<overlap.end-EPS&&event.end>overlap.start+EPS)dropped.add(event);
 }
 const kept=all.filter(e=>!dropped.has(e));
 const first=parts[0],out=clone(first);
 for(const key of Object.keys(out))if(key.startsWith('_'))delete out[key];
 delete out.difficulties;delete out.activeDifficulty;delete out.locked;delete out.hidden;delete out.combineReview;
 Object.assign(out,{id:uid(),name,priority:'main',notes:[],chords:[],chord_templates:[],handshapes:[],anchors:[],phrases:[],toneChanges:[]});

 // Chord shapes: shared list, identical shapes merged.
 const templateKey=t=>JSON.stringify([t.name,t.displayName,t.frets,t.fingers]),templateIndex=new Map(),remap=new Map();
 for(const a of parts){const map=[];(a.chord_templates||[]).forEach((t,i)=>{const key=templateKey(t);if(!templateIndex.has(key)){const copy=clone(t);delete copy._xml;templateIndex.set(key,out.chord_templates.length);out.chord_templates.push(copy);}map[i]=templateIndex.get(key);});remap.set(a.id,map);}

 for(const event of kept){
  const copy=clone(event.item);delete copy._xml;
  if(event.kind==='note'){copy.id=uid();out.notes.push(copy);continue;}
  const mapped=remap.get(event.source)[chordRef(event.item)];
  if(Number.isInteger(event.item.chord_id)){copy.chord_id=mapped;if(typeof copy.id==='string')copy.id=uid();}else copy.id=mapped;
  copy.notes=(copy.notes||[]).map(n=>({...n,id:uid()}));out.chords.push(copy);
 }
 // Same-string sustains kept from two parts must not run into the next note.
 if(bothRanges.length&&fretted(out)){
  const byString=new Map();for(const n of [...out.notes,...out.chords.flatMap(c=>(c.notes||[]).map(x=>({...x,time:chordTime(c),_ref:x})))]){if(!byString.has(n.string))byString.set(n.string,[]);byString.get(n.string).push(n);}
  for(const list of byString.values()){list.sort((x,y)=>x.time-y.time);for(let i=0;i<list.length-1;i++){const limit=list[i+1].time-list[i].time-.01;if((list[i].sustain||0)>limit){(list[i]._ref||list[i]).sustain=Math.max(0,limit);}}}
 }
 out.notes.sort((x,y)=>x.time-y.time);out.chords.sort((x,y)=>chordTime(x)-chordTime(y));

 // Runs: stretches where one source plays. Inside "keep both" overlaps the current part continues.
 const runs=[];
 for(const event of kept){
  const shared=bothRanges.some(o=>event.start>=o.start-EPS&&event.start<o.end-EPS);
  const last=runs.at(-1);
  if(last&&(last.source===event.source||shared)){last.end=Math.max(last.end,event.end);continue;}
  runs.push({source:event.source,start:event.start,end:event.end});
 }

 // Anchors: each run uses its own part's hand positions.
 if(fretted(out))runs.forEach((run,i)=>{
  const anchors=[...(byId.get(run.source).anchors||[])].sort((x,y)=>x.time-y.time),until=runs[i+1]?.start??Infinity;
  const current=anchors.findLast(x=>x.time<=run.start+EPS);
  if(current)out.anchors.push({...clone(current),time:run.start});
  for(const x of anchors)if(x.time>run.start+EPS&&x.time<until-EPS)out.anchors.push(clone(x));
 });
 // Chord zones go with the chords they cover.
 for(const a of parts){
  const chords=out.chords.filter(c=>kept.some(e=>e.kind==='chord'&&e.source===a.id&&chordTime(e.item)===chordTime(c)));
  for(const zone of a.handshapes||[]){
   if(!chords.some(c=>chordTime(c)>=zone.start_time-EPS&&chordTime(c)<zone.end_time-EPS))continue;
   const copy=clone(zone);if(Number.isInteger(copy.chord_id))copy.chord_id=remap.get(a.id)[copy.chord_id];out.handshapes.push(copy);
  }
 }
 out.handshapes.sort((x,y)=>x.start_time-y.start_time);
 // Phrases: all parts' markers, one per time.
 for(const a of parts)for(const phrase of a.phrases||[])if(!out.phrases.some(p=>Math.abs(p.time-phrase.time)<.01)){const copy=clone(phrase);if(copy.id)copy.id=uid();out.phrases.push(copy);}
 out.phrases.sort((x,y)=>x.time-y.time);

 // Tones: one per source part, switched where the playing part changes.
 const definitions={},changes=[];
 for(const id of ids){
  const a=byId.get(id),tone=toneOf(id),source=a.tones?.definitions?.[a.tones?.base]??Object.values(a.tones?.definitions||{})[0];
  // A copy under the new name (its key follows the name); gear the catalog rejects is kept as it was.
  if(source)try{definitions[tone]=copyTone(source,tone);}catch{definitions[tone]={...clone(source),name:tone};}
 }
 runs.forEach((run,i)=>{
  if(!i)return;const previous=runs[i-1];if(toneOf(previous.source)===toneOf(run.source))return;
  const gap=run.start-previous.end,time=gap>2*TONE_LEAD?run.start-TONE_LEAD:Math.max(previous.end,run.start-Math.max(0,gap)/2);
  changes.push({time:Math.max(0,Math.min(run.start,time)),name:toneOf(run.source)});
 });
 const used=[...new Set([runs.length?toneOf(runs[0].source):toneOf(ids[0]),...changes.map(c=>c.name)])];
 const missingTones=used.filter(n=>!definitions[n]);
 out.tones={base:used[0],changes,definitions:Object.fromEntries(used.map(n=>[n,definitions[n]??createTone(n)]))};

 out.combineReview=overlaps.map(o=>{const decision=decisions[o.id]??o.decision;return {start:o.start,end:o.end,kind:o.kind,sameString:o.sameString,kept:decision==='both'?'both':byId.get(decision.slice(5)).name,sources:o.sources.map(id=>byId.get(id).name)};});
 const report={sources:parts.map(a=>a.name),notes:out.notes.length,chords:out.chords.length,dropped:dropped.size,overlaps:overlaps.length,toneChanges:changes.length,tones:used,missingTones};
 return {arrangement:out,report};
}
