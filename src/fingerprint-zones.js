/** Original bulk handshape tools, not a recovered native algorithm.
 * Public OCE Chords tutorial: fingerprints describe one held shape; notes
 * must belong to it and contained chord zones must fit entirely inside it.
 * July 2023 release notes mention missing chord-data autocomplete, but do not
 * establish its grouping algorithm. Our explicit design generates from existing
 * valid chord templates/strums only, never guesses chords, names or fingerings.
 * Close repeated matching strums form a group; tail/gap/gutter use authored beats.
 * Existing overlapping fingerprint/arpeggio zones are protected. Compatible
 * ordinary chord zones may be contained. Sounding events, template references,
 * other difficulties and original source data are never rewritten or removed.
 * Fingerprint presentation uses the existing original -nop template mapping.
 */
import {assertGrid,beatAt,timeAt} from './model.js';
const epsilon=1e-9;
function context(arrangement,range,duration){
 if(!['guitar','bass'].includes(arrangement?.type))throw Error('Fingerprint zones require a guitar or bass arrangement');
 if(!Number.isFinite(duration)||duration<=0)throw Error('Song duration must be positive');
 const start=range?.start??0,end=range?.end??duration;
 if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>duration||end<=start)throw Error('Choose a positive time region inside the song');
 return {start,end};
}
function shape(arrangement,index){
 const template=arrangement.chord_templates?.[index],count=arrangement.stringCount;
 if(!Number.isInteger(index)||!template||!Array.isArray(template.frets)||template.frets.length!==count||template.frets.some(f=>!Number.isInteger(f)||f< -1||f>24)||template.frets.filter(f=>f>=0).length<2)throw Error('A source chord has an invalid handshape template');
 const fingers=template.fingers||Array(count).fill(-1);
 if(fingers.length!==count||fingers.some(f=>!Number.isInteger(f)||f< -1||f>4))throw Error('A source template has invalid fingering');
 return {template,frets:template.frets,fingers,key:JSON.stringify([template.frets,fingers])};
}
function compatible(note,held){
 const finger=note.techniques?.left_hand;
 return Number.isInteger(note.string)&&held.frets[note.string]===note.fret&&note.fret>=0&&(!(finger>=0)||!(held.fingers[note.string]>=0)||finger===held.fingers[note.string]);
}
function kind(arrangement,zone){
 const template=arrangement.chord_templates?.[zone.chord_id];
 if(zone.kind)return zone.kind;
 if(zone.arp||template?.arp||String(template?.displayName||'').endsWith('-arp'))return 'arpeggio';
 return 'chord'; // -nop alone may be an ordinary hidden-name double stop.
}
function intervalIndex(items){
 const sorted=items.toSorted((a,b)=>a.start-b.start),prefix=[];let max=-Infinity;
 for(const item of sorted){max=Math.max(max,item.end);prefix.push(max);}
 return (start,end)=>{let left=0,right=sorted.length;while(left<right){const mid=(left+right)>>>1;if(sorted[mid].start<end)left=mid+1;else right=mid;}const result=[];for(let i=left-1;i>=0&&prefix[i]>start;i--)if(sorted[i].end>start)result.push(sorted[i]);return result;};
}
export function generateFingerprintZones(arrangement,beats,{duration,range=null,maxGapBeats=1,tailBeats=1,gutterBeats=0}={}){
 const bounds=context(arrangement,range,duration);assertGrid(beats);
 for(const [name,value]of Object.entries({maxGapBeats,tailBeats,gutterBeats}))if(!Number.isFinite(value)||value<0||value>10000)throw Error(`${name} must be between 0 and 10000 beats`);
 if(tailBeats<=0||gutterBeats>=tailBeats)throw Error('Tail must be positive and longer than the gutter');
 const chords=(arrangement.chords||[]).toSorted((a,b)=>a.time-b.time),groups=[];
 for(const chord of chords){
  if(!Number.isFinite(chord.time)||chord.time<0)throw Error('A source strum has invalid timing');
  const held=shape(arrangement,chord.chord_id),last=groups.at(-1);
  if(last&&last.held.key===held.key&&beatAt(beats,chord.time)-beatAt(beats,last.chords.at(-1).time)<=maxGapBeats+epsilon)last.chords.push(chord);
  else groups.push({held,chords:[chord]});
 }
 const notes=[...(arrangement.notes||[]).map(note=>({note,start:note.time,end:note.time+Math.max(epsilon,note.sustain||0)})),...chords.flatMap(chord=>(chord.notes||[]).map(note=>({note,start:chord.time,end:chord.time+Math.max(epsilon,note.sustain||0)})))];
 if(notes.some(n=>!Number.isFinite(n.start)||!Number.isFinite(n.end)||n.start<0))throw Error('A sounding note has invalid timing');
 const noteIntervals=intervalIndex(notes),zones=arrangement.handshapes||[];
 if(zones.some(z=>!Number.isFinite(z.start_time)||!Number.isFinite(z.end_time)||z.end_time<=z.start_time))throw Error('An existing handshape zone has invalid timing');
 const zoneIntervals=intervalIndex(zones.map(zone=>({zone,start:zone.start_time,end:zone.end_time}))),planned=[];
 const report={created:0,skippedExisting:0,skippedConflict:0,skippedOutside:0};
 for(let i=0;i<groups.length;i++){
  const group=groups[i],start=group.chords[0].time,last=group.chords.at(-1).time;
  // Scope is strict: no partial group or source chord zone is silently clipped.
  if(start<bounds.start||last>=bounds.end){report.skippedOutside++;continue;}
  let end=Math.min(bounds.end,timeAt(beats,beatAt(beats,last)+tailBeats-gutterBeats));
  const childZones=zoneIntervals(start,end);
  let conflict=false;
  for(const {zone}of childZones){
   if(kind(arrangement,zone)!=='chord'){conflict=true;break;}
   if(shape(arrangement,zone.chord_id).key!==group.held.key||zone.start_time<start){conflict=true;break;}
   end=Math.max(end,zone.end_time);
  }
  end=Math.min(end,bounds.end,groups[i+1]?timeAt(beats,beatAt(beats,groups[i+1].chords[0].time)-gutterBeats):duration);
  const sounding=noteIntervals(start,end);
  // A later incompatible attack shortens the proposed zone; a preceding held
  // incompatible note prevents generation. No sounding event is shortened.
  for(const item of sounding)if(!compatible(item.note,group.held)){if(item.start<=start)conflict=true;else end=Math.min(end,item.start);}
  const overlaps=zoneIntervals(start,end);
  const duplicate=overlaps.some(({zone})=>kind(arrangement,zone)==='fingerprint'&&shape(arrangement,zone.chord_id).key===group.held.key&&zone.start_time<=start&&zone.end_time>=end);
  if(duplicate){report.skippedExisting++;continue;}
  if(overlaps.some(({zone})=>kind(arrangement,zone)!=='chord'||zone.start_time<start||zone.end_time>end||shape(arrangement,zone.chord_id).key!==group.held.key))conflict=true;
  if(conflict||end<=last||end<=start){report.skippedConflict++;continue;}
  planned.push({held:group.held,start,end});
 }
 // All input validation/planning precedes mutation, including template clones.
 const templates=[...(arrangement.chord_templates||[])],newZones=[];
 for(const plan of planned){
  const template={...structuredClone(plan.held.template),arp:false,displayName:String(plan.held.template.displayName||plan.held.template.name||'Chord').replace(/-(arp|nop)$/,'')+'-nop'};
  let index=templates.findIndex(t=>JSON.stringify(t)===JSON.stringify(template));if(index<0){index=templates.length;templates.push(template);}
  newZones.push({chord_id:index,start_time:plan.start,end_time:plan.end,kind:'fingerprint',hideName:false,arp:false});
 }
 if(newZones.length){arrangement.chord_templates=templates;arrangement.handshapes=[...zones,...newZones].sort((a,b)=>a.start_time-b.start_time);}
 report.created=newZones.length;return report;
}
export function removeFingerprintZones(arrangement,{duration,range=null,mode='fingerprints'}={}){
 const bounds=context(arrangement,range,duration);
 if(!['fingerprints','all-zones'].includes(mode))throw Error('Choose fingerprints only or all handshape zones');
 const original=arrangement.handshapes||[],retained=original.filter(zone=>!(zone.start_time>=bounds.start&&zone.start_time<bounds.end&&(mode==='all-zones'||kind(arrangement,zone)==='fingerprint')));
 if(retained.length!==original.length)arrangement.handshapes=retained;
 return {removed:original.length-retained.length};
}
