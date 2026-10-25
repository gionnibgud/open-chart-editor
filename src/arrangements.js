// Original part management. Removal is reversible through the caller's History;
// embedded source members stay opaque until the package writer assigns pointers.
import {clone,uid} from './model.js';
function part(project,id){const index=project.arrangements.findIndex(a=>a.id===id);if(index<0)throw Error('Choose an existing arrangement');return{index,arrangement:project.arrangements[index]}}
function name(value){if(typeof value!=='string'||!value.trim()||value.trim().length>128)throw Error('Arrangement name must contain 1 to 128 characters');return value.trim()}
export function manageArrangement(project,id,operation,{newName}={}){
 const {index,arrangement}=part(project,id);
 if(operation==='rename'){arrangement.name=name(newName);return id;}
 if(['up','down'].includes(operation)){const next=index+(operation==='up'?-1:1);if(next<0||next>=project.arrangements.length)throw Error('This arrangement is already at that end of the list');[project.arrangements[index],project.arrangements[next]]=[project.arrangements[next],project.arrangements[index]];return id;}
 if(operation==='remove'){
  if(!arrangement.editorOnly&&project.arrangements.filter(a=>!a.editorOnly).length<=1)throw Error('Keep at least one main arrangement');
  const removed=new Set([id,...project.arrangements.filter(a=>a.editorOnly&&a.scratchFor===id).map(a=>a.id)]),remaining=project.arrangements.filter(a=>!removed.has(a.id));if(!remaining.length)throw Error('Keep at least one arrangement');
  project.arrangements=remaining;return remaining[Math.min(index,remaining.length-1)].id;
 }
 if(operation!=='duplicate')throw Error('Choose a supported arrangement operation');
 if(arrangement.editorOnly)throw Error('Duplicate a main arrangement; copy scratch notes into a main part first');
 const copy=clone(arrangement);copy.id=uid();copy.name=name(newName||arrangement.name+' copy');
 if(['guitar','bass'].includes(copy.type))copy.priority='alternative';
 const ids=new Map(),replacement=id=>{if(!id)return uid();if(!ids.has(id))ids.set(id,uid());return ids.get(id)};
 for(const content of [copy,...copy.difficulties||[]])for(const note of [...content.notes||[],...(content.chords||[]).flatMap(c=>c.notes||[])])note.id=replacement(note.id);
 for(const phrase of copy.phrases||[])if(phrase.id)phrase.id=replacement(phrase.id);
 for(const iteration of copy.phraseIterations||[])if(typeof iteration.phraseId==='string'&&ids.has(iteration.phraseId))iteration.phraseId=ids.get(iteration.phraseId);
 if(copy._entry){for(const key of ['id','file','drum_tab','notation','_songLevel'])delete copy._entry[key];}
 delete copy._notationOriginal;delete copy._notationFingerprint;
 project.arrangements.splice(index+1,0,copy);return copy.id;
}
