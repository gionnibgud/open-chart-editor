// Original optional authoring checks, informed by Ubisoft's public OCE
// Additional Features tutorial. These are documented conventions, not a claim
// that the current executable's complete validator has been reproduced.
import {PointIndex} from './viewport.js';
export function findOceIssues(project){
 const issues=[],epsilon=.001;
 for(const a of project.arrangements||[]){
  if(!['guitar','bass'].includes(a.type)||a.editorOnly)continue;
  const standalone=a.notes||[],chords=a.chords||[],notes=[...standalone,...chords.flatMap(c=>c.notes||[])],phrases=[...(a.phrases||[])].sort((x,y)=>x.time-y.time),zones=a.handshapes||[],anchors=[...(a.anchors||[])].sort((x,y)=>x.time-y.time),templates=a.chord_templates||[];
  const add=(code,message,item={},severity='error')=>issues.push({code:`oce.${code}`,message,severity,arrangement:a.id,note:item.id,time:item.time??item.start_time??0});
  const indexes=new Map();
  const range=(items,start,end)=>{
   if(Number.isNaN(start)||Number.isNaN(end))return [];
   if(!indexes.has(items))indexes.set(items,items.every(n=>Number.isFinite(n.time))?new PointIndex(items):null);
   const index=indexes.get(items);return index?index.between(start,end):items.filter(n=>n.time>=start&&n.time<end);
  };
  const within=(items,start,end)=>range(items,start-epsilon,end-epsilon);
  const near=(items,time)=>{const numeric=Number(time);if(!Number.isFinite(numeric))return items.filter(n=>Math.abs(n.time-time)<epsilon);const pad=Math.max(epsilon*2,Math.abs(numeric)*Number.EPSILON*2);return range(items,numeric-pad,numeric+pad).filter(n=>Math.abs(n.time-time)<epsilon);};
  const numericPhrases=phrases.every(p=>Number.isFinite(p.time)),numericAnchors=anchors.every(a=>Number.isFinite(a.time));
  const nextPhrase=time=>{if(!numericPhrases||!Number.isFinite(Number(time)))return phrases.find(p=>p.time>time);let lo=0,hi=phrases.length;while(lo<hi){const mid=(lo+hi)>>>1;if(phrases[mid].time<=time)lo=mid+1;else hi=mid;}return phrases[lo];};
  const anchorBefore=time=>{if(!numericAnchors||!Number.isFinite(Number(time)))return anchors.findLast(a=>a.time<=time);let lo=0,hi=anchors.length;while(lo<hi){const mid=(lo+hi)>>>1;if(anchors[mid].time<=time)lo=mid+1;else hi=mid;}return anchors[lo-1];};
  if(!(project.sections||[]).length)add('sections','Add song sections for clearer navigation.',{},'warning');
  if(notes.length&&!phrases.length)add('phrases','Define empty boundaries and musical phrases.');
  const phraseContent=new Map();
  phrases.forEach((phrase,i)=>{
   const end=phrases[i+1]?.time??project.duration+epsilon*2,content=within(notes,phrase.time,end),count=content.length,previous=phraseContent.get(phrase.name);
   if((i===0||i===phrases.length-1)&&count)add('emptyEnds','Keep opening and closing phrases empty.',phrase);
   if(previous!==undefined&&Boolean(previous)!==Boolean(count))add('phraseConsistency','Repeated phrase names need consistent musical content.',phrase);
   phraseContent.set(phrase.name,count);
   if(end-phrase.time<1)add('shortPhrase','Consider combining this short phrase.',phrase,'warning');
   if(count&&!anchors.some(anchor=>anchor.time>=phrase.time-epsilon&&anchor.time<=Math.min(...content.map(n=>n.time))+epsilon))add('phraseAnchor','Place an anchor before this phrase’s notes.',phrase);
  });
  for(const note of notes){
   const boundary=nextPhrase(note.time+epsilon);
   if(boundary&&note.time+(note.sustain||0)>boundary.time+epsilon)add('crossingSustain','Shorten sustain at the phrase boundary.',note);
  }
  const groups=new Map();for(const note of standalone){const key=Math.round(note.time/epsilon);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(note);}
  for(const group of groups.values())if(group.length>1&&!near(chords,group[0].time).length)add('stacked','Convert simultaneous fretted voices into a chord.',group[0]);
  for(const zone of zones){
   const start=zone.start_time,end=zone.end_time,content=within(notes,start,end),template=templates[zone.chord_id];
   if(range(phrases,start+epsilon,end-epsilon).some(p=>p.time>start+epsilon))add('crossingZone','Split this hand shape at the phrase boundary.',zone);
   const startAnchor=anchorBefore(start+epsilon);
   if(range(anchors,start+epsilon,end-epsilon).some(anchor=>anchor.time>start+epsilon&&anchor.fret!==startAnchor?.fret))add('zoneAnchor','Avoid hand-position changes inside a chord zone.',zone);
   if(!content.length)add('emptyZone','This hand shape contains no notes.',zone,'warning');
   if(template&&content.some(n=>template.frets?.[n.string]!==n.fret))add('zoneVoicing','Match notes to their surrounding hand shape.',zone);
   const strums=within(chords,start,end);
   if(template&&strums.some(chord=>{const other=templates[chord.chord_id];return other&&JSON.stringify(other.frets)!==JSON.stringify(template.frets)||other&&other.fingers&&template.fingers&&JSON.stringify(other.fingers)!==JSON.stringify(template.fingers)}))add('fingerprint','Reconcile chord and fingerprint fingering.',zone);
   if(near(notes,end).length)add('zoneGutter','Leave a gap before the following note.',zone);
  }
  anchors.forEach((anchor,i)=>{if(notes.length&&!within(notes,anchor.time,anchors[i+1]?.time??project.duration+epsilon*2).length)add('emptyAnchor','Remove or reposition this unused anchor.',anchor,'warning');});
  const changes=[...(a.tones?.changes||[])].sort((x,y)=>x.time-y.time);
  changes.forEach((change,i)=>{if(i&&change.time-changes[i-1].time<.25)add('rapidTone','Review these closely spaced tone changes.',change,'warning');});
  const sections=[...(project.sections||[])].sort((x,y)=>(x.time??x.start_time)-(y.time??y.start_time));
  sections.forEach((section,i)=>{const time=section.time??section.start_time;if(phrases.length&&!near(phrases,time).length)add('sectionPhrase','Align this section with a phrase boundary.',section,'warning');if(section.name==='noguitar'&&within(notes,time,sections[i+1]?.time??sections[i+1]?.start_time??project.duration+epsilon*2).length)add('noGuitar','Remove notes from the no-guitar section.',section,'warning');});
 }
 return issues;
}
