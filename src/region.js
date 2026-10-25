import {clone,uid} from './model.js';
const inRange=(time,start,end)=>time>=start&&time<end;
const check=(start,end)=>{if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start)throw Error('Select a positive time region');};
const shiftNote=(n,offset)=>({...clone(n),id:uid(),time:n.time+offset});
const shiftChord=(c,offset)=>({...clone(c),time:c.time+offset,notes:(c.notes||[]).map(n=>shiftNote(n,offset))});
export function copyRegion(project,arrangementId,start,end){
 check(start,end);const a=project.arrangements.find(a=>a.id===arrangementId);if(!a)throw Error('Arrangement not found');
 return{kind:'oce-region',duration:end-start,sourceType:a.type,sourceStringCount:a.stringCount,
  notes:a.notes.filter(n=>inRange(n.time,start,end)).map(n=>shiftNote(n,-start)),
  chords:a.chords.filter(c=>inRange(c.time,start,end)).map(c=>shiftChord(c,-start)),
  anchors:a.anchors.filter(n=>inRange(n.time,start,end)).map(n=>({...clone(n),time:n.time-start})),
  phrases:a.phrases.filter(n=>inRange(n.time,start,end)).map(n=>({...clone(n),id:uid(),time:n.time-start})),
  handshapes:a.handshapes.filter(h=>h.start_time<end&&h.end_time>start).map(h=>({...clone(h),start_time:Math.max(start,h.start_time)-start,end_time:Math.min(end,h.end_time)-start})),
  templates:clone(a.chord_templates),tones:{changes:(a.tones.changes||[]).filter(n=>inRange(n.time,start,end)).map(n=>({...clone(n),time:n.time-start})),definitions:clone(a.tones.definitions||{})},
  sections:project.sections.filter(n=>inRange(n.start_time,start,end)).map(n=>({...clone(n),start_time:n.start_time-start})),
  vocals:(project.vocals||[]).filter(n=>inRange(n.time,start,end)).map(n=>({...clone(n),id:uid(),time:n.time-start}))};
}
export function clearRegion(project,arrangementId,start,end){
 check(start,end);const a=project.arrangements.find(a=>a.id===arrangementId);if(!a)throw Error('Arrangement not found');
 for(const key of ['notes','chords','anchors','phrases'])a[key]=a[key].filter(n=>!inRange(n.time,start,end));
 a.tones.changes=(a.tones.changes||[]).filter(n=>!inRange(n.time,start,end));
 a.handshapes=a.handshapes.flatMap(h=>{if(h.end_time<=start||h.start_time>=end)return[h];const kept=[];if(h.start_time<start)kept.push({...clone(h),end_time:start});if(h.end_time>end)kept.push({...clone(h),start_time:end});return kept;});
 project.sections=project.sections.filter(n=>!inRange(n.start_time,start,end));
 if(project.vocals)project.vocals=project.vocals.filter(n=>!inRange(n.time,start,end));
 return project;
}
export function copySelection(project,arrangementId,ids){
 const a=project.arrangements.find(a=>a.id===arrangementId),selected=new Set(ids),all=[...a.notes,...a.chords.flatMap(c=>c.notes||[])].filter(n=>selected.has(n.id));
 if(!all.length)return null;let start=Infinity,end=-Infinity;for(const n of all){start=Math.min(start,n.time);end=Math.max(end,n.time+Math.max(.001,n.sustain||0));}
 const full=a.chords.filter(c=>c.notes?.length&&c.notes.every(n=>selected.has(n.id))),fullSet=new Set(full),partial=a.chords.filter(c=>!fullSet.has(c)).flatMap(c=>(c.notes||[]).filter(n=>selected.has(n.id)));
 return{kind:'oce-region',duration:end-start,sourceType:a.type,sourceStringCount:a.stringCount,notes:[...a.notes.filter(n=>selected.has(n.id)),...partial].map(n=>shiftNote(n,-start)),chords:full.map(c=>shiftChord(c,-start)),templates:clone(a.chord_templates),anchors:[],phrases:[],handshapes:[],tones:{changes:[],definitions:{}},sections:[],vocals:[]};
}
export function pasteRegion(project,arrangementId,clipboard,time){
 if(clipboard?.kind!=='oce-region'||!Number.isFinite(time)||time<0)throw Error('Copy a region and choose its destination');
 const a=project.arrangements.find(a=>a.id===arrangementId);if(!a||a.type!==clipboard.sourceType||a.stringCount!==clipboard.sourceStringCount)throw Error('Paste region into an arrangement with the same instrument and string count');
 const templates=clipboard.templates.map(template=>{const comparable=c=>JSON.stringify({name:c.name,frets:c.frets,fingers:c.fingers});let index=a.chord_templates.findIndex(c=>comparable(c)===comparable(template));if(index<0){index=a.chord_templates.length;a.chord_templates.push(clone(template));}return index;});
 const toneNames={};for(const [name,definition]of Object.entries(clipboard.tones.definitions)){let target=name,number=2;while(a.tones.definitions[target]&&JSON.stringify(a.tones.definitions[target])!==JSON.stringify(definition))target=`${name} copy ${number++}`;if(!a.tones.definitions[target])a.tones.definitions[target]=clone(definition);toneNames[name]=target;}
 const notes=clipboard.notes.map(n=>shiftNote(n,time));for(const note of notes)a.notes.push(note);a.notes.sort((x,y)=>x.time-y.time);
 const pastedChords=clipboard.chords.map(c=>({...shiftChord(c,time),chord_id:templates[c.chord_id]}));for(const chord of pastedChords)a.chords.push(chord);
 a.anchors.push(...clipboard.anchors.map(n=>({...clone(n),time:n.time+time})));a.anchors.sort((x,y)=>x.time-y.time);
 a.phrases.push(...clipboard.phrases.map(n=>({...clone(n),id:uid(),time:n.time+time})));a.phrases.sort((x,y)=>x.time-y.time);
 a.handshapes.push(...clipboard.handshapes.map(h=>({...clone(h),chord_id:templates[h.chord_id],start_time:h.start_time+time,end_time:h.end_time+time})));
 a.tones.changes.push(...clipboard.tones.changes.map(t=>({...clone(t),time:t.time+time,name:toneNames[t.name]||t.name})));a.tones.changes.sort((x,y)=>x.time-y.time);
 project.sections.push(...clipboard.sections.map(s=>({...clone(s),start_time:s.start_time+time})));project.sections.sort((x,y)=>x.start_time-y.start_time);
 if(clipboard.vocals.length)(project.vocals||=[]).push(...clipboard.vocals.map(v=>({...clone(v),id:uid(),time:v.time+time})));
 project.duration=Math.max(project.duration,time+clipboard.duration);return[...notes,...pastedChords.flatMap(c=>c.notes||[])];
}
