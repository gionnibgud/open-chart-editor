/** Original OPTIONAL sustain editing policy, not an asserted retail algorithm.
 * Observations: Ubisoft OCE Basics documents snapped sustain endpoints,
 * Gutter and its G toggle; Additional Features describes avoiding collisions.
 * https://www.ubisoft.com/en-us/game/rocksmith/plus/rocksmith-oce/tutorials/basics
 * https://www.ubisoft.com/en-us/game/rocksmith/plus/rocksmith-oce/tutorials/additional-features
 * Retained prerelease analysis also observes a configurable gutter subtraction;
 * neither it nor the tutorials establish retail per-voice/link exceptions.
 * Design choices: opt-in guitar/bass next-same-string clamp, beat-map gutter
 * only for explicitly snapped edits, outgoing linked voices exempt, and no
 * trimming of pre-existing overlap during extension. Exact numeric edits can
 * omit snapped. Imported data is never normalized on load or policy changes.
 * Only visible notes/chord children participate; stored DD, templates, opaque
 * fields and curves remain untouched. A curve that would be cut is refused.
 * The caller owns History/dirty state. Plan the WHOLE selection, then apply;
 * do not call the single-note convenience function in a mutation loop.
 */
import {assertGrid,beatAt,timeAt} from './model.js';
import {validateChordAwareSustain} from './chord-tools.js';

const EPS=1e-7;
function voices(arrangement){
 const result=(arrangement.notes||[]).map(note=>({note,parent:null,time:note.time}));
 for(const parent of arrangement.chords||[])for(const note of parent.notes||[])result.push({note,parent,time:note.time??parent.time});
 return result;
}
function linked({note,parent}){
 for(const key of ['link_next','linkNext','ln']){
  // Explicit child false wins over a parent default for the same key.
  const value=note.techniques?.[key]??note[key]??parent?.techniques?.[key]??parent?.[key];
  if(value===true||typeof value==='number'&&value>0)return true;
 }
 return false;
}
function curveFloor({note,parent}){
 const curve=note.techniques?.bend_values??parent?.techniques?.bend_values??[];
 if(!Array.isArray(curve)||curve.some(p=>!Number.isFinite(p.t)||p.t<0))throw Error('Existing bend curve has invalid timing; repair it before changing sustain');
 return curve.reduce((latest,p)=>Math.max(latest,p.t),0);
}
function optionsOf(options,arrangement){
 const {enabled=false,clampNext=true,gutterBeats=0,snapped=false,beats,endTime=null}=options;
 if(typeof enabled!=='boolean'||typeof clampNext!=='boolean'||typeof snapped!=='boolean'||!Number.isFinite(gutterBeats)||gutterBeats<0||gutterBeats>16||endTime!==null&&(!Number.isFinite(endTime)||endTime<0))throw Error('Invalid sustain policy settings');
 if(enabled&&!['guitar','bass'].includes(arrangement?.type))throw Error('Sustain collision policy requires guitar or bass');
 if(enabled&&snapped&&gutterBeats>0)assertGrid(beats);
 return {enabled,clampNext,gutterBeats,snapped,beats,endTime};
}
/** requested is a duration in seconds, not an absolute endpoint. Result plans
 * expose flags for caller status messages. No mutation, even on validation
 * failure. Repeated references to one note are rejected as ambiguous.
 */
export function planSustainEdits(arrangement,edits,options={}){
 const policy=optionsOf(options,arrangement),all=voices(arrangement),seen=new Set(),byNote=new Map(),attacks=new Map();
 for(const voice of all){
  if(byNote.has(voice.note))throw Error('Visible chart repeats a note object');
  byNote.set(voice.note,voice);
  if(Number.isFinite(voice.time)){
   if(!attacks.has(voice.note.string))attacks.set(voice.note.string,[]);
   attacks.get(voice.note.string).push(voice.time);
  }
 }
 for(const times of attacks.values())times.sort((a,b)=>a-b);
 if(!Array.isArray(edits))throw Error('Supply sustain edits as an array');
 return edits.map(({note,requested})=>{
  const voice=byNote.get(note);
  if(!voice||seen.has(note))throw Error('Choose each existing visible note only once');
  seen.add(note);
  const old=note.sustain??0,start=voice.time;
  if(!Number.isFinite(start)||start<0||!Number.isFinite(old)||old<0||!Number.isFinite(requested)||requested<0)throw Error('Sustain and attack must be finite nonnegative seconds');
  let value=requested,nextAttack=null,clamped=false,gutterApplied=false,retainedOverlap=false;
  const isLinked=linked(voice);
  if(policy.enabled&&!isLinked&&Math.abs(requested-old)>EPS){
   let end=start+requested;
   if(policy.clampNext){
    if(!Number.isInteger(note.string)||note.string<0||note.string>=arrangement.stringCount)throw Error('Selected note has an invalid string');
    const times=attacks.get(note.string)||[];let lo=0,hi=times.length;
    while(lo<hi){const mid=(lo+hi)>>>1;if(times[mid]<=start+EPS)lo=mid+1;else hi=mid;}
    nextAttack=times[lo]??null;
    if(nextAttack!==null&&end>nextAttack){end=nextAttack;clamped=true;}
   }
   if(policy.endTime!==null&&end>policy.endTime){end=policy.endTime;clamped=true;}
   if(policy.snapped&&policy.gutterBeats>0&&requested>0){
    end=timeAt(policy.beats,beatAt(policy.beats,end)-policy.gutterBeats);gutterApplied=true;
   }
   value=Math.max(0,end-start);
   // An extension may stop growing, but must not secretly shorten old data.
   if(requested>old&&value<old){value=old;retainedOverlap=true;}
  }
  if(value+EPS<curveFloor(voice))throw Error('Sustain edit would cut an existing bend curve; edit the curve first');
  validateChordAwareSustain(arrangement,note,value);
  return {note,requested,value,previous:old,nextAttack,linked:isLinked,clamped,gutterApplied,retainedOverlap};
 });
}
/** Atomic validation and assignment. The plan is deliberately recalculated
 * inside this function so a caller cannot apply a stale detached plan.
 */
export function applySustainEdits(arrangement,edits,options={}){
 const plans=planSustainEdits(arrangement,edits,options);
 for(const plan of plans)plan.note.sustain=plan.value;
 return plans;
}
export function applySustainEdit(arrangement,note,requested,options={}){
 return applySustainEdits(arrangement,[{note,requested}],options)[0];
}
/** Shift a logical tail endpoint by beats across tempo changes. For an active
 * gutter, restore its beat offset before stepping; callers pass gutterApplied
 * only if THIS tail was previously authored with that setting. No guessing of
 * imported grid alignment or repeated cumulative gutter subtraction.
 */
export function steppedSustain(beats,start,sustain,deltaBeats,{gutterApplied=false,gutterBeats=0}={}){
 assertGrid(beats);
 if(![start,sustain,deltaBeats,gutterBeats].every(Number.isFinite)||start<0||sustain<0||gutterBeats<0||typeof gutterApplied!=='boolean')throw Error('Invalid sustain step');
 return Math.max(0,timeAt(beats,beatAt(beats,start+sustain)+(gutterApplied&&sustain>0?gutterBeats:0)+deltaBeats)-start);
}
