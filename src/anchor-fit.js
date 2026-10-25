/** Original anchor coverage repair; source music and hidden levels stay read-only.
 * Whole CURRENT visible level, in canonical capo-relative frets. Existing
 * covered positions survive; repair only uncovered attacks/phrase starts.
 * This is a coverage policy, not native computed-anchor or ergonomic inference.
 * Sustains, slide endpoints, thumb choice and hidden levels are never rewritten.
 */
export const ANCHOR_FIT_LIMITS=Object.freeze({events:2000000,anchors:200000,phrases:200000});
const previews=new WeakMap(),copy=value=>structuredClone(value),finite=value=>typeof value==='number'&&Number.isFinite(value);
function array(value,label){if(value===undefined)return[];if(!Array.isArray(value))throw Error(label+' must be an array');return value;}
function signature(a){try{return JSON.stringify({id:a.id,type:a.type,stringCount:a.stringCount,capo:a.capo,activeDifficulty:a.activeDifficulty,notes:a.notes,chords:a.chords,chord_templates:a.chord_templates,anchors:a.anchors,phrases:a.phrases});}catch{throw Error('Anchor fitting requires a serializable visible-level snapshot');}}
function freeze(value){if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}
export function planAnchorCoverage(a,{duration,minWidth=4,maxWidth=4,phraseStarts=true}={}){
 if(!a||!['guitar','bass'].includes(a.type))throw Error('Anchor fitting requires a guitar or bass arrangement');
 if(!Number.isInteger(a.stringCount)||a.stringCount<1||a.stringCount>8)throw Error('Choose a valid fretted string layout');
 const capo=a.capo??0;if(!Number.isInteger(capo)||capo<0||capo>24)throw Error('Capo must be a whole fret from0 to24');
 if(!finite(duration)||duration<=0)throw Error('Choose a positive song duration');
 if(!Number.isInteger(minWidth)||!Number.isInteger(maxWidth)||minWidth<1||maxWidth<minWidth||maxWidth>24)throw Error('Choose whole anchor widths from1 to24, with maximum at least minimum');
 if(typeof phraseStarts!=='boolean')throw Error('Phrase-start repair must be an explicit boolean');
 const notes=array(a.notes,'Notes'),chords=array(a.chords,'Chords'),templates=array(a.chord_templates,'Chord templates'),anchors=array(a.anchors,'Anchors'),phrases=array(a.phrases,'Phrases');
 if(anchors.length>ANCHOR_FIT_LIMITS.anchors||phrases.length>ANCHOR_FIT_LIMITS.phrases)throw Error('Anchor/phrase count exceeds the bounded fitting limit');
 const maxFret=24-capo,minAnchor=capo>0?0:1,groups=new Map(),changes=[],additions=[],conflicts=[],childTimeSamples=[];let eventCount=0,positiveAttacks=0,childTimeWarnings=0;
 function group(time,label){if(!finite(time)||time<0||time>duration)throw Error(label+' time must be finite and inside the song');let g=groups.get(time);if(!g){g={time,low:Infinity,high:-Infinity,voices:0,phrase:false};groups.set(time,g);}return g;}
 function voice(n,parentTime,label){
  if(!n||typeof n!=='object')throw Error(label+' must be a note object');if(++eventCount>ANCHOR_FIT_LIMITS.events)throw Error('Note count exceeds the bounded fitting limit');
  if(!Number.isInteger(n.string)||n.string<0||n.string>=a.stringCount||!Number.isInteger(n.fret)||n.fret<0||n.fret>maxFret)throw Error(label+' needs a valid string and capo-relative fret within physical fret24');
  if(parentTime!==undefined&&n.time!==undefined){
   if(!finite(n.time)||n.time<0||n.time>duration)throw Error(label+' stored child time must be finite and inside the song');
   if(Math.abs(n.time-parentTime)>1e-7){childTimeWarnings++;if(childTimeSamples.length<8)childTimeSamples.push({parentTime,storedChildTime:n.time,label});}
  }
  // Explicit chord children sound at their parent attack in guide/native
  // representations. Preserve a stale stored child field rather than moving it.
  const g=group(parentTime!==undefined?parentTime:n.time,label);g.voices++;g.strings??=[];
  if(g.strings[n.string]!==undefined&&g.strings[n.string]!==n.fret){g.ambiguousStrings??=new Set();g.ambiguousStrings.add(n.string);}else g.strings[n.string]=n.fret;
  if(n.fret>0){g.low=Math.min(g.low,n.fret);g.high=Math.max(g.high,n.fret);positiveAttacks++;}
 }
 for(const [index,n]of notes.entries())voice(n,undefined,'Note'+index);
 for(const [index,chord]of chords.entries()){
  if(!chord||typeof chord!=='object')throw Error('Chord'+index+' must be an object');group(chord.time,'Chord'+index);
  const children=array(chord.notes,'Chord children');
  if(children.length)for(const child of children)voice(child,chord.time,'Chord'+index+' voice');
  else{const template=templates[chord.chord_id];if(!Number.isInteger(chord.chord_id)||!template||!Array.isArray(template.frets)||template.frets.length!==a.stringCount)throw Error('Implicit chord needs a valid template');for(const [string,fret]of template.frets.entries()){if(fret===-1)continue;voice({string,fret},chord.time,'Implicit chord'+index+' voice');}}
 }
 for(const [index,anchor]of anchors.entries()){
  if(!anchor||!Number.isInteger(anchor.fret)||anchor.fret<minAnchor||anchor.fret>maxFret||!Number.isInteger(anchor.width??4)||(anchor.width??4)<=0)throw Error('Existing anchor'+index+' needs a valid relative fret and positive integer width');
  const g=group(anchor.time,'Anchor'+index);if(g.anchorIndex!==undefined)throw Error('Duplicate existing anchor times require manual resolution');g.anchorIndex=index;
 }
 if(phraseStarts)for(const [index,phrase]of phrases.entries())group(phrase?.time,'Phrase'+index).phrase=true;
 const suggested=anchors.map(copy),ordered=[...groups.values()].sort((x,y)=>x.time-y.time);let active=null,coveredGroups=0;
 function add(position,reason){if(suggested.length>=ANCHOR_FIT_LIMITS.anchors)throw Error('Suggested anchor count exceeds the 200,000-anchor budget; repair a smaller authored arrangement');suggested.push(position);additions.push({...position,reason});active=position;}
 for(const g of ordered){
  if(g.anchorIndex!==undefined)active=suggested[g.anchorIndex];
  if(g.ambiguousStrings?.size){const strings=[...g.ambiguousStrings].sort((a,b)=>a-b);conflicts.push({time:g.time,code:'anchor.ambiguousString',strings,message:'Simultaneous voices prescribe different frets on string(s) '+strings.map(s=>s+1).join(', ')+'. Resolve the voices before repairing anchor coverage.'});continue;}
  const hasFrets=g.low!==Infinity,covered=hasFrets&&active&&g.low>=active.fret&&g.high<active.fret+(active.width??4);
  if(covered)coveredGroups++;
  if(hasFrets&&!covered){
   const span=g.high-g.low+1;
   if(span>maxWidth){conflicts.push({time:g.time,code:'anchor.span',low:g.low,high:g.high,requiredWidth:span,maxWidth,message:'Simultaneous positive frets span '+span+' positions; maximum suggested width is '+maxWidth+'. Increase the chosen maximum or edit the voicing/anchors manually.'});continue;}
   const position={time:g.time,fret:g.low,width:Math.max(minWidth,span)};
   if(g.anchorIndex!==undefined){const before=copy(suggested[g.anchorIndex]);suggested[g.anchorIndex]={...before,...position};changes.push({index:g.anchorIndex,before,after:copy(suggested[g.anchorIndex]),reason:'uncovered attack'});active=suggested[g.anchorIndex];}
   else add(position,'uncovered attack');
  }else if(g.phrase&&g.anchorIndex===undefined){
   const position={time:g.time,fret:active?.fret??Math.min(1,maxFret),width:active?.width??minWidth};add(position,'phrase start');
  }
 }
 suggested.sort((x,y)=>x.time-y.time);
 const warnings=childTimeWarnings?[{code:'anchor.childTime',count:childTimeWarnings,samples:childTimeSamples,message:'Chord coverage uses the parent attack. Stored differing child times are retained; resolve them separately before XML/CDLC export.'}]:[];
 const snapshot=signature(a),result=freeze({version:1,scope:'current-visible-level',policy:'Preserve covered authored positions; choose the lowest positive onset fret for missing coverage. Open strings do not prescribe a hand position. No ergonomic/native fallback equivalence claimed.',arrangementId:a.id??null,options:{duration,minWidth,maxWidth,phraseStarts},changes,additions,conflicts,warnings,counts:{voices:eventCount,positiveAttacks,alreadyCoveredAttackGroups:coveredGroups,added:additions.length,changed:changes.length,totalAnchors:suggested.length,childTimeWarnings,hiddenLevelsUntouched:a.difficulties?.length??0},canApply:conflicts.length===0});
 previews.set(result,{snapshot,duration,anchors:suggested});return result;
}
export function applyAnchorCoverage(a,preview,{duration}={}){
 const prepared=previews.get(preview);if(!prepared)throw Error('Use an original anchor coverage preview');
 if(signature(a)!==prepared.snapshot||duration!==prepared.duration)throw Error('The visible source or song duration changed; preview anchor coverage again');
 if(preview.conflicts.length)throw Error('Resolve the reported fret-span conflicts before applying anchor coverage');
 if(!preview.additions.length&&!preview.changes.length)return a;
 return {...a,anchors:copy(prepared.anchors)};
}
