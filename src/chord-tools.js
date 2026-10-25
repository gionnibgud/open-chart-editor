/** Original chord-zone editing, using the public project/Feedpak representation.
 * Evidence: the prerelease OCE guide (FINDINGS.md section 5.2 in the local
 * editor research) documents beat lengths, gutter and Finger Print Zone Only.
 * Native split-command internals/retail semantics have not been established.
 * Design choices here: fingerprint-only inserts a handshape without a strum;
 * gutter is a fraction of a beat-map interval, not fixed wall-clock seconds;
 * splitting preserves independent note data and keeps zones by default. Only
 * the visible difficulty is edited; the caller's History/difficulty machinery
 * owns undo and snapshotting. No audio, implicit transposition or native flags
 * are invented. Callers must disclose these choices rather than claim parity.
 * Later zone body/type/name controls are also documented by Ubisoft's public
 * OCE Chords tutorial: /rocksmith-oce/tutorials/chords. This original
 * implementation maps only representations supported by Feedpak/RS2014.
 */
import {assertGrid,beatAt,timeAt,makeNote,notePitch,uid} from './model.js';

const copy=value=>structuredClone(value);
function fretted(arrangement){
 if(!arrangement||!['guitar','bass'].includes(arrangement.type))throw Error('Chord zones require a guitar or bass arrangement');
 if(!Number.isInteger(arrangement.stringCount)||arrangement.stringCount<1||arrangement.stringCount>8)throw Error('Invalid fretted string count');
}
function templateAt(arrangement,index){
 fretted(arrangement);
 const template=arrangement.chord_templates?.[index];
 if(!Number.isInteger(index)||!template)throw Error('Choose an existing chord template');
 if(!Array.isArray(template.frets)||template.frets.length!==arrangement.stringCount||template.frets.some(fret=>!Number.isInteger(fret)||fret< -1||fret>24)||template.frets.filter(fret=>fret>=0).length<2)throw Error('Chord template needs at least two valid fretted strings');
 if(template.fingers&&(!Array.isArray(template.fingers)||template.fingers.length!==arrangement.stringCount||template.fingers.some(finger=>!Number.isInteger(finger)||finger< -1||finger>4)))throw Error('Chord template has invalid fingering');
 return template;
}
function zoneEnd(beats,time,lengthBeats,gutterBeats){
 assertGrid(beats);
 if(!Number.isFinite(time)||time<0)throw Error('Chord-zone start must be nonnegative seconds');
 if(!Number.isFinite(lengthBeats)||lengthBeats<=0||lengthBeats>10000)throw Error('Chord length must be positive beats (at most 10000)');
 if(!Number.isFinite(gutterBeats)||gutterBeats<0||gutterBeats>=lengthBeats)throw Error('Gutter must be nonnegative and shorter than the chord zone');
 const end=timeAt(beats,beatAt(beats,time)+lengthBeats-gutterBeats);
 if(!Number.isFinite(end)||end<=time)throw Error('Chord zone must have a positive duration');
 return end;
}
function noConflicts(existing,notes){
 const ids=new Set(existing.filter(n=>n.id).map(n=>n.id)),seen=[...existing];
 for(const note of notes){
  if(note.id&&ids.has(note.id))throw Error('Splitting would duplicate a note identity');
  if(seen.some(n=>n.string===note.string&&Math.abs(n.time-note.time)<.001))throw Error('This operation would overlap an existing note on the same string');
  if(note.id)ids.add(note.id);seen.push(note);
 }
}
/** Default names follow sounding pitch, including tuning/capo/extended strings.
 * Only an ascending perfect-fifth class (7 mod 12) is the documented exception.
 */
export function shouldHideDoubleStop(arrangement,template){
 const notes=template.frets.flatMap((fret,string)=>fret>=0?[{string,fret}]:[]);
 return notes.length===2&&Math.abs(notePitch(arrangement,notes[0])-notePitch(arrangement,notes[1]))%12!==7;
}
export function applyDefaultChordName(arrangement,zoneIndex){
 const zone=zoneAt(arrangement,zoneIndex),template=templateAt(arrangement,zone.chord_id);
 if(!shouldHideDoubleStop(arrangement,template)||template.arp||String(template.displayName||'').endsWith('-arp'))return zone;
 return setChordZoneStyle(arrangement,zoneIndex,{kind:'chord',hideName:true}).zone;
}
/** Existing imported/authored sustain always remains visible and untouched. */
export function chordStrumPresentation(arrangement,chord){
 const zone=(arrangement.handshapes||[]).filter(h=>h.chord_id===chord.chord_id&&chord.time>=h.start_time&&chord.time<h.end_time).sort((a,b)=>b.start_time-a.start_time)[0];
 const repeat=!!zone&&(arrangement.chords||[]).some(c=>c!==chord&&c.chord_id===chord.chord_id&&c.time>=zone.start_time&&c.time<chord.time);
 return {repeat,compact:repeat&&(chord.notes||[]).every(n=>!(n.sustain>0))};
}
export function validateChordAwareSustain(arrangement,note,value){
 if(!Number.isFinite(value)||value<0)throw Error('Sustain must be nonnegative seconds');
 const chord=(arrangement.chords||[]).find(c=>(c.notes||[]).includes(note));
 if(value>0&&chord&&chordStrumPresentation(arrangement,chord).compact)throw Error('Add sustain to the initial strum of this zone. Existing imported strum sustains are preserved.');
 return note;
}
export function setChordAwareSustain(arrangement,note,value){
 validateChordAwareSustain(arrangement,note,value);
 note.sustain=value;return note;
}
function strum(arrangement,beats,index,time,end,sustainBeats,providedTemplate=null){
 const template=providedTemplate||templateAt(arrangement,index);
 const sustain=Math.min(end-time,timeAt(beats,beatAt(beats,time)+sustainBeats)-time);
 const notes=template.frets.flatMap((fret,string)=>{
  if(fret<0)return[];
  const note=makeNote(arrangement,time,string,fret,sustain),finger=template.fingers?.[string];
  if(Number.isInteger(finger)&&finger>=0)note.techniques.left_hand=finger;
  return[note];
 });
 noConflicts([...(arrangement.notes||[]),...(arrangement.chords||[]).flatMap(c=>c.notes||[])],notes);
 return {time,chord_id:index,notes};
}

/** Mutates only after validation. length/gutter/sustain use beat-map intervals.
 * Returns inserted objects, useful for selecting the new zone/strum in the UI.
 */
export function insertChordZone(arrangement,beats,templateIndex,time,{lengthBeats=1,gutterBeats=0,fingerprintOnly=false,sustainBeats=.25}={}){
 const source=templateAt(arrangement,templateIndex),end=zoneEnd(beats,time,lengthBeats,gutterBeats);
 if(typeof fingerprintOnly!=='boolean')throw Error('Fingerprint-only option must be boolean');
 if(!Number.isFinite(sustainBeats)||sustainBeats<0||sustainBeats>10000)throw Error('Strum sustain must be nonnegative beats');
 const sourceDisplay=String(source.displayName||source.name||'Chord'),arpeggio=!fingerprintOnly&&(source.arp||sourceDisplay.endsWith('-arp'));
 const hideName=!fingerprintOnly&&!arpeggio&&(sourceDisplay.endsWith('-nop')||shouldHideDoubleStop(arrangement,source));
 let presentation=source,index=templateIndex;
 if(fingerprintOnly||hideName&&!sourceDisplay.endsWith('-nop')){
  presentation={...copy(source),arp:false,displayName:sourceDisplay.replace(/-(arp|nop)$/,'')+'-nop'};
  index=arrangement.chord_templates.findIndex(t=>JSON.stringify(t)===JSON.stringify(presentation));if(index<0)index=arrangement.chord_templates.length;
 }
 const zone={chord_id:index,start_time:time,end_time:end,kind:fingerprintOnly?'fingerprint':arpeggio?'arpeggio':'chord',hideName,arp:!!arpeggio};
 let chord=null;
 if(!fingerprintOnly){
  chord=strum(arrangement,beats,index,time,end,sustainBeats,presentation);
 }
 if(index===arrangement.chord_templates.length)arrangement.chord_templates.push(presentation);
 (arrangement.handshapes||=[]).push(zone);arrangement.handshapes.sort((a,b)=>a.start_time-b.start_time);
 if(chord){(arrangement.chords||=[]).push(chord);arrangement.chords.sort((a,b)=>a.time-b.time);}
 return {zone,chord,notes:chord?.notes||[]};
}

/** N-style add/remove inside an existing chord context. Our hand-shape zone
 * supplies that context; explicit zone insertion is a separate operation.
 * REA observes a native context guard, but its internal class is unestablished.
 */
export function toggleChordStrum(arrangement,beats,time,{sustainBeats=.25}={}){
 fretted(arrangement);assertGrid(beats);
 if(!Number.isFinite(time)||time<0)throw Error('Strum time must be nonnegative seconds');
 const zone=(arrangement.handshapes||[]).filter(h=>h.start_time<=time&&h.end_time>time).sort((a,b)=>b.start_time-a.start_time)[0];
 if(!zone)throw Error('Insert a chord zone first, then place the cursor inside it to add or remove a strum');
 const index=(arrangement.chords||[]).findIndex(chord=>Math.abs(chord.time-time)<.001);
 if(index>=0){const [chord]=arrangement.chords.splice(index,1);return {removed:true,chord,notes:[]};}
 if(!Number.isFinite(sustainBeats)||sustainBeats<0||sustainBeats>10000)throw Error('Strum sustain must be nonnegative beats');
 const prior=(arrangement.chords||[]).some(c=>c.chord_id===zone.chord_id&&c.time>=zone.start_time&&c.time<time);
 const chord=strum(arrangement,beats,zone.chord_id,time,zone.end_time,prior?0:sustainBeats);
 chord.highDensity=prior;
 (arrangement.chords||=[]).push(chord);arrangement.chords.sort((a,b)=>a.time-b.time);
 return {removed:false,chord,notes:chord.notes};
}

/** Resize one exact zone. Does not change notes or other matching templates. */
export function resizeChordZone(arrangement,beats,zoneIndex,{lengthBeats,gutterBeats=0}={}){
 fretted(arrangement);
 const zone=arrangement.handshapes?.[zoneIndex];
 if(!Number.isInteger(zoneIndex)||!zone)throw Error('Choose an existing hand-shape zone');
 const end=zoneEnd(beats,zone.start_time,lengthBeats,gutterBeats);
 zone.end_time=end;return zone;
}

/** Explicit positive endpoint; the caller snaps it against its visible grid. */
export function setChordZoneEnd(arrangement,zoneIndex,end){
 fretted(arrangement);const zone=arrangement.handshapes?.[zoneIndex];
 if(!Number.isInteger(zoneIndex)||!zone)throw Error('Choose an existing hand-shape zone');
 if(!Number.isFinite(end)||end<=zone.start_time)throw Error('Hand-shape end must follow its start');
 zone.end_time=end;return zone;
}

/** Remove unused templates only. References in hidden difficulties and zones
 * count as use; surviving indices are remapped without changing voicings.
 */
export function deleteChordTemplate(arrangement,index){
 fretted(arrangement);
 if(!Number.isInteger(index)||!arrangement.chord_templates?.[index])throw Error('Choose an existing chord template');
 const contents=[arrangement,...arrangement.difficulties||[]];
 if(contents.some(c=>[...c.chords||[],...c.handshapes||[]].some(event=>event.chord_id===index)))throw Error('This chord template is used by a strum or hand-shape zone, including stored difficulties. Keep it or remove those references first.');
 arrangement.chord_templates.splice(index,1);
 for(const content of contents)for(const event of [...content.chords||[],...content.handshapes||[]])if(event.chord_id>index)event.chord_id--;
 return arrangement.chord_templates;
}

function zoneAt(arrangement,index){
 fretted(arrangement);const zone=arrangement.handshapes?.[index];
 if(!Number.isInteger(index)||!zone||!Number.isFinite(zone.start_time)||!Number.isFinite(zone.end_time)||zone.start_time<0||zone.end_time<=zone.start_time)throw Error('Choose a valid hand-shape zone');
 return zone;
}
/** Entire contained zones and note/strum attacks move together. Notes retain
 * full tails and relative curves; phrases/anchors/tones are separate tracks.
 * Partially overlapping other zones stay in place (an explicit design choice).
 */
export function chordZoneContents(arrangement,index){
 const zone=zoneAt(arrangement,index),inside=time=>time>=zone.start_time&&time<zone.end_time;
 const chords=(arrangement.chords||[]).filter(c=>inside(c.time));
 const notes=[...new Set([...(arrangement.notes||[]).filter(n=>inside(n.time)),...chords.flatMap(c=>c.notes||[])])];
 const zones=arrangement.handshapes.filter(h=>h.start_time>=zone.start_time&&h.end_time<=zone.end_time);
 return {zone,chords,notes,zones};
}
export function moveChordZone(arrangement,index,delta){
 const contents=chordZoneContents(arrangement,index);
 if(!Number.isFinite(delta)||contents.zone.start_time+delta<0)throw Error('Move the complete zone to a nonnegative time');
 const shifted=contents.notes.map(n=>({...n,time:n.time+delta}));
 if(shifted.some(n=>!Number.isFinite(n.time)||n.time<0||!Number.isFinite(n.sustain)||n.sustain<0))throw Error('Zone contains invalid note timing');
 const targetNotes=new Set(contents.notes);
 noConflicts([...(arrangement.notes||[]),...(arrangement.chords||[]).flatMap(c=>c.notes||[])].filter(n=>!targetNotes.has(n)),shifted);
 for(const n of contents.notes)n.time+=delta;
 for(const c of contents.chords)c.time+=delta;
 for(const h of contents.zones){h.start_time+=delta;h.end_time+=delta;}
 arrangement.notes?.sort((a,b)=>a.time-b.time);arrangement.chords?.sort((a,b)=>a.time-b.time);
 const endTime=Math.max(contents.zone.end_time,...contents.notes.map(n=>n.time+n.sustain));
 return {...contents,endTime};
}

export function chordZoneStyle(arrangement,index){
 const zone=arrangement?.handshapes?.[index];if(!zone)throw Error('Choose an existing hand-shape zone');
 const template=arrangement.chord_templates?.[zone.chord_id],display=template?.displayName||'';
 return {kind:zone.kind||((zone.arp||template?.arp||display.endsWith('-arp'))?'arpeggio':'chord'),hideName:zone.hideName??display.endsWith('-nop')};
}
/** Original type/name authoring using audited public native conventions:
 * Feedpak handshape/template arp booleans and RS2014 template displayName
 * -arp/-nop suffixes. Fingerprint uses an ordinary handshape with Nop display;
 * this approximates teaching presentation, not proprietary R+ zone encoding.
 * Sounding events are NEVER removed. Native Arpeggio and Nop masks cannot be
 * combined, so arpeggio+hide is explicitly refused. Templates are cloned and
 * only fully-contained strums owned by this zone are retargeted. Narrower
 * nested zones retain their independent voicings/presentation.
 */
export function setChordZoneStyle(arrangement,index,{kind=chordZoneStyle(arrangement,index).kind,hideName=chordZoneStyle(arrangement,index).hideName}={}){
 const zone=zoneAt(arrangement,index),source=templateAt(arrangement,zone.chord_id);
 if(!['chord','fingerprint','arpeggio'].includes(kind)||typeof hideName!=='boolean')throw Error('Choose chord, fingerprint or arpeggio and a boolean chord-name setting');
 if(kind==='arpeggio'&&hideName)throw Error('Native arpeggio and hidden-name masks cannot be combined. Show the chord name before choosing arpeggio.');
 const contains=(h,c)=>c.time>=h.start_time&&c.time<h.end_time;
 const candidates=(arrangement.chords||[]).filter(c=>c.chord_id===zone.chord_id&&contains(zone,c));
 const owned=candidates.filter(c=>{
  const other=arrangement.handshapes.filter(h=>h!==zone&&h.chord_id===zone.chord_id&&contains(h,c));
  if(other.some(h=>h.start_time<zone.start_time&&h.end_time<zone.end_time||h.start_time>zone.start_time&&h.end_time>zone.end_time||h.start_time===zone.start_time&&h.end_time===zone.end_time))throw Error('Overlapping zones have ambiguous shared strums; separate their bounds or templates before changing type');
  return !other.some(h=>h.start_time>=zone.start_time&&h.end_time<=zone.end_time);
 });
 if(owned.some(c=>(c.notes||[]).some(n=>(n.time??c.time)<zone.start_time||(n.time??c.time)+(n.sustain||0)>zone.end_time+1e-6)))throw Error('A strum crosses this zone boundary; contain its full sustain before changing zone type');
 const template=copy(source),base=String(source.displayName||source.name||'Chord').replace(/-(arp|nop)$/,'');
 template.arp=kind==='arpeggio';template.displayName=base+(kind==='arpeggio'?'-arp':kind==='fingerprint'||hideName?'-nop':'');
 let target=arrangement.chord_templates.findIndex(t=>JSON.stringify(t)===JSON.stringify(template));
 if(target<0){target=arrangement.chord_templates.length;arrangement.chord_templates.push(template);}
 zone.chord_id=target;zone.kind=kind;zone.hideName=hideName;zone.arp=kind==='arpeggio';
 for(const chord of owned)chord.chord_id=target;
 return {zone,template:arrangement.chord_templates[target],chords:owned};
}

/** Convert selected materialized chord instances to independent notes.
 * Parent technique defaults are inherited, with each member's values winning.
 * remove-unused removes matching zones only when no retained strum uses them.
 * Unrelated templates, anchors, zones, and stored difficulties are untouched.
 */
export function splitChordInstances(arrangement,chordIndexes,{handshapes='keep'}={}){
 fretted(arrangement);
 if(!['keep','remove-unused'].includes(handshapes))throw Error('Choose keep or remove-unused for hand shapes');
 const indexes=[...new Set(chordIndexes||[])];
 if(!indexes.length||indexes.some(index=>!Number.isInteger(index)||!arrangement.chords?.[index]))throw Error('Choose existing chord instances to split');
 const selected=indexes.map(index=>arrangement.chords[index]),selectedSet=new Set(selected),notes=[];
 for(const chord of selected){
  templateAt(arrangement,chord.chord_id);
  if(!Number.isFinite(chord.time)||chord.time<0||!Array.isArray(chord.notes)||chord.notes.length<2)throw Error('Split requires a materialized chord with at least two notes');
  const defaults=copy(chord.techniques||{});
  for(const key of ['palm_mute','accent','fret_hand_mute','ignore','link_next'])if(chord[key]!==undefined)defaults[key]=chord[key];
  for(const original of chord.notes){
   const note=copy(original);note.id ||= uid();note.time ??= chord.time;note.sustain ??= 0;
   if(!Number.isInteger(note.string)||note.string<0||note.string>=arrangement.stringCount||!Number.isInteger(note.fret)||note.fret<0||note.fret>24||!Number.isFinite(note.time)||note.time<0||!Number.isFinite(note.sustain)||note.sustain<0)throw Error('Chord member has invalid string, fret or timing');
   note.techniques={...defaults,...copy(note.techniques||{})};notes.push(note);
  }
 }
 const retained=(arrangement.chords||[]).filter(chord=>!selectedSet.has(chord));
 noConflicts([...(arrangement.notes||[]),...retained.flatMap(chord=>chord.notes||[])],notes);
 const contains=(zone,chord)=>zone.chord_id===chord.chord_id&&chord.time>=zone.start_time&&chord.time<zone.end_time;
 const zones=(arrangement.handshapes||[]).filter(zone=>handshapes==='keep'||!selected.some(chord=>contains(zone,chord))||retained.some(chord=>contains(zone,chord)));
 arrangement.chords=retained;arrangement.notes=[...(arrangement.notes||[]),...notes].sort((a,b)=>a.time-b.time||a.string-b.string);
 arrangement.handshapes=zones;
 return notes;
}
