/** Original editor-only drum lane discovery. Native kit[] is legend metadata,
 * not a sound/GM mapping. Unknown piece IDs retain their exact identity.
 * This module has no DOM, audio, network, persistence or host effects.
 */
import {DRUMS} from './model.js';

export const DRUM_LAYOUT_LIMITS=Object.freeze({maxPieces:1024,maxRecords:2000000,maxKitEntries:4096,maxLevels:4096});
const validId=value=>typeof value==='string'&&value.length>0;
const compare=(a,b)=>a<b?-1:a>b?1:0;

/** Canonical lanes stay in existing editor order; declared custom IDs follow
 * source legend order; remaining observed IDs sort by exact JS code units.
 * All working/stored DD notes and explicit chord members contribute, so a
 * difficulty switch does not reshuffle lanes. Duplicate hits remain untouched.
 * Over-limit input throws; there is no silent truncation or mutation.
 */
export function deriveDrumLayout(arrangement,options={}){
 if(!arrangement||arrangement.type!=='drums')throw Error('Choose a drum arrangement');
 const limits={...DRUM_LAYOUT_LIMITS,...options};
 for(const key of Object.keys(DRUM_LAYOUT_LIMITS))if(!Number.isSafeInteger(limits[key])||limits[key]<1||limits[key]>DRUM_LAYOUT_LIMITS[key])throw Error(`Invalid drum layout ${key} limit`);
 if(limits.maxPieces<DRUMS.length)throw Error('Drum layout piece limit must include all canonical lanes');
 const warnings=[],warningSet=new Set(),warn=message=>{if(!warningSet.has(message)){warningSet.add(message);if(warnings.length<32)warnings.push(message);}};
 const labels=new Map(),declared=new Set(),declaredCustom=[],observed=new Set(),canonical=new Set(DRUMS);
 const kit=arrangement._wire?.kit;
 if(kit!==undefined&&!Array.isArray(kit))warn('Invalid source drum kit legend was not interpreted; source metadata remains unchanged');
 if(Array.isArray(kit)){
  if(kit.length>limits.maxKitEntries)throw Error('Drum kit legend exceeds the bounded layout limit');
  for(const entry of kit){
   if(!entry||!validId(entry.id)){warn('Invalid source drum kit ID was not interpreted; source metadata remains unchanged');continue;}
   const id=entry.id;
   if(!declared.has(id)){declared.add(id);if(!canonical.has(id))declaredCustom.push(id);}
   const name=typeof entry.name==='string'&&entry.name.trim()?entry.name:undefined;
   if(name!==undefined){if(!labels.has(id))labels.set(id,name);else if(labels.get(id)!==name)warn('Duplicate drum kit labels conflict; the first valid source label is displayed');}
  }
 }
 const levels=arrangement.difficulties;
 if(levels!==undefined&&!Array.isArray(levels))warn('Invalid stored drum levels were not interpreted for lane discovery');
 if(Array.isArray(levels)&&levels.length>limits.maxLevels)throw Error('Drum difficulty count exceeds the bounded layout limit');
 let records=0;
 const count=()=>{if(++records>limits.maxRecords)throw Error('Drum records exceed the bounded layout limit');};
 const see=note=>{
  count();
  const id=note?.piece??note?.p;
  if(!validId(id)){warn('A drum hit has no valid piece ID; it cannot be assigned an editor lane');return;}
  observed.add(id);
  if(observed.size>limits.maxPieces)throw Error('Drum piece count exceeds the bounded layout limit');
 };
 for(const owner of [arrangement,...(Array.isArray(levels)?levels:[])]){
  if(!owner||typeof owner!=='object'){warn('Invalid stored drum level was not interpreted for lane discovery');continue;}
  if(owner.notes!==undefined&&!Array.isArray(owner.notes))warn('Invalid drum note list was not interpreted for lane discovery');
  for(const note of Array.isArray(owner.notes)?owner.notes:[])see(note);
  if(owner.chords!==undefined&&!Array.isArray(owner.chords))warn('Invalid drum group list was not interpreted for lane discovery');
  for(const chord of Array.isArray(owner.chords)?owner.chords:[]){
   count();
   if(chord?.notes!==undefined&&!Array.isArray(chord.notes))warn('Invalid drum group members were not interpreted for lane discovery');
   for(const note of Array.isArray(chord?.notes)?chord.notes:[])see(note);
  }
 }
 const customObserved=[...observed].filter(id=>!canonical.has(id)&&!declared.has(id)).sort(compare);
 const ids=[...DRUMS,...declaredCustom,...customObserved];
 if(ids.length>limits.maxPieces)throw Error('Drum piece count exceeds the bounded layout limit');
 const lanes=ids.map(id=>Object.freeze({id,label:labels.get(id)??(canonical.has(id)?id.replaceAll('_',' '):id),canonical:canonical.has(id),declared:declared.has(id),used:observed.has(id)}));
 if(ids.length>DRUMS.length)warn('Custom drum IDs are preserved as distinct editor lanes. Their names do not establish a timbre, GM mapping or native highway/scoring support');
 const index=new Map(ids.map((id,i)=>[id,i]));
 return Object.freeze({ids:Object.freeze(ids),lanes:Object.freeze(lanes),warnings:Object.freeze(warnings),hasCustom:ids.length>DRUMS.length,
  indexOf:piece=>index.get(typeof piece==='object'&&piece!==null?(piece.piece??piece.p):piece)??-1,
  pieceAt:lane=>Number.isInteger(lane)&&lane>=0&&lane<ids.length?ids[lane]:null,
  labelFor:piece=>lanes[index.get(piece)]?.label??(validId(piece)?piece:'Unknown drum piece')});
}

/** Disclosure for existing original guide fallback. This does not select or
 * alter a sound, infer a physical instrument, or rewrite a source piece ID. */
export function drumGuideCue(piece){
 const canonical=DRUMS.includes(piece);
 return {piece,canonical,generic:!canonical,label:canonical?piece.replaceAll('_',' '):'Generic percussion guide cue',
  warning:canonical?null:'Custom piece audition uses a generic original percussion cue; its source timbre and native grading are not established'};
}
