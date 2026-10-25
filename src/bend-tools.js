/** Original cursor-relative bend authoring. The guide documents B/V along a
 * sustain, not an exact interpolation algorithm. Existing explicit curves are
 * interpolated linearly and held after their final point. A scalar-only bend
 * supplies the first edited value; adding its first explicit curve anchors a
 * neutral attack when the cursor is later than the attack. This is an authoring
 * choice, not a reconstruction of the proprietary scalar-only playback curve.
 * Public bend_values times are seconds relative to each note, including chord
 * children. bend remains the curve's peak, matching native export semantics.
 */
const EPS=1e-6;
function curveOf(note){
 const scalar=Number(note.techniques?.bend||0),curve=structuredClone(note.techniques?.bend_values||[]);
 if(!Number.isFinite(scalar)||scalar<0||scalar>12||!Array.isArray(curve)||curve.some((p,i)=>!Number.isFinite(p.t)||p.t<0||p.t>note.sustain+EPS||!Number.isFinite(p.v)||p.v<0||p.v>12||(i>0&&p.t<=curve[i-1].t)))throw Error('Existing bend curve has invalid times or semitone values');
 return {scalar,curve};
}
function valueAt(curve,time,scalar){
 if(!curve.length)return scalar;
 let previous={t:0,v:0};
 for(const point of curve){
  if(Math.abs(point.t-time)<=EPS)return point.v;
  if(point.t>time)return previous.v+(point.v-previous.v)*(time-previous.t)/(point.t-previous.t);
  previous=point;
 }
 return previous.v;
}
/** Atomic across all affected notes. Other selected notes remain unchanged
 * when their sustains do not contain the cursor. Returns affected notes.
 */
export function adjustBendAtCursor(arrangement,selectedIds,cursor,delta){
 if(!['guitar','bass'].includes(arrangement?.type))throw Error('Fretted bend curves require guitar or bass notes');
 if(!Number.isFinite(cursor)||cursor<0||!Number.isFinite(delta)||delta===0||Math.abs(delta)>12)throw Error('Choose a nonnegative cursor and a nonzero bend step of at most 12 semitones');
 const ids=new Set(selectedIds||[]),notes=[...(arrangement.notes||[]),...(arrangement.chords||[]).flatMap(c=>c.notes||[])].filter(n=>ids.has(n.id));
 const plans=[];
 for(const note of notes){
  if(!Number.isFinite(note.time)||!Number.isFinite(note.sustain)||note.time<0||note.sustain<0)throw Error('Selected note has invalid timing');
  if(cursor<note.time-EPS||cursor>note.time+note.sustain+EPS)continue;
  const time=Math.max(0,Math.min(note.sustain,cursor-note.time)),{scalar,curve}=curveOf(note);
  const value=Math.min(12,Math.max(0,valueAt(curve,time,scalar)+delta));
  const point=curve.find(p=>Math.abs(p.t-time)<=EPS);
  if(point)point.v=value;
  else{
   if(!curve.length&&time>EPS)curve.push({t:0,v:0});
   curve.push({t:time,v:value});curve.sort((a,b)=>a.t-b.t);
  }
  plans.push({note,curve,bend:Math.max(...curve.map(p=>p.v))});
 }
 if(!plans.length)throw Error('Place the cursor within a selected note sustain to edit its bend');
 for(const {note,curve,bend}of plans)note.techniques={...note.techniques,bend,bend_values:curve};
 return plans.map(p=>p.note);
}
