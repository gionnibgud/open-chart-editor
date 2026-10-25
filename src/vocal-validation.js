/** Original read-only vocal diagnostics, shared with the Arrangement Error Finder.
 * pack_io.validate_project defines required nonnegative finite time/length,
 * string text and optional integer MIDI pitch0..127. The native SNG writer
 * uses48 bytes including its terminator; the backend rejects raw UTF8>47 at
 * CDLC packaging. XML itself can store longer text, so its native limit is
 * advisory here. Trailing +/- and every other source character count as-is.
 * No font, linebreak, duplicate-onset, overlap or native pitch-effect guesses.
 */
export const NATIVE_VOCAL_UTF8_LIMIT=47;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

// Count strict Unicode scalar UTF8 without allocating one byte buffer per row.
// TextEncoder replaces lone surrogates; Python's backend encoder rejects them.
function textFacts(text){
 let bytes=0,valid=true,nul=-1,xmlInvalid=null;
 for(let i=0;i<text.length;i++){
  const value=text.charCodeAt(i);
  if(value===0&&nul<0)nul=i;
  if(value!==0&&((value<0x20&&![9,10,13].includes(value))||value===0xfffe||value===0xffff)&&xmlInvalid===null)xmlInvalid={value,index:i};
  if(value<0x80)bytes++;
  else if(value<0x800)bytes+=2;
  else if(value>=0xd800&&value<=0xdbff){
   const next=text.charCodeAt(i+1);if(!(next>=0xdc00&&next<=0xdfff)){valid=false;continue;}
   bytes+=4;i++;
  }else if(value>=0xdc00&&value<=0xdfff)valid=false;
  else bytes+=3;
 }
 return {bytes:valid?bytes:null,nul,xmlInvalid};
}

/** Existing issue shape plus vocalId/vocalIndex, never fake arrangement/note
 * fields. Invalid rows/time navigate to0 via their index; a missing/invalid
 * project is left to the shared project validator. No input normalization.
 * Complexity O(events + UTF16 text length); no sorting or pairwise scans.
 */
export function findVocalIssues(project,options={}){
 if(typeof options==='string')options={target:options};
 const target=options.target??'feedpak',native=target==='cdlc'||target==='xml'||target==='vocal_xml';
 const nativeSeverity=target==='cdlc'?'error':'warning';
 const epsilon=finite(options.epsilon)&&options.epsilon>=0?options.epsilon:.001;
 const issues=[];
 if(!object(project)||project.vocals===undefined)return issues;
 function emit(code,message,{row,index=null,field='',severity='error',extra}={}){
  const issue={code,severity,message,path:index===null?'vocals':`vocals[${index}]${field?'.'+field:''}`,time:finite(row?.time)&&row.time>=0?row.time:0,vocalIndex:index};
  if(typeof row?.id==='string'&&row.id)issue.vocalId=row.id;
  if(extra)Object.assign(issue,extra);
  issues.push(issue);
 }
 if(!Array.isArray(project.vocals)){
  emit('vocals.invalid','Vocals must be an array.');return issues;
 }
 for(let index=0;index<project.vocals.length;index++){
  const row=project.vocals[index];
  if(!object(row)){emit('vocal.invalid','Vocal event must be an object.',{index});continue;}
  const at={row,index},validTime=finite(row.time)&&row.time>=0,validLength=finite(row.length)&&row.length>=0;
  if(!validTime)emit('vocal.time','Vocal time must be finite and non-negative.',{...at,field:'time'});
  if(!validLength)emit('vocal.length','Vocal length must be finite and non-negative; zero length is allowed.',{...at,field:'length'});
  if(validTime&&validLength){
   const end=row.time+row.length;
   if(!finite(end))emit('vocal.end','Vocal end must remain finite.',{...at,field:'length'});
   else if(finite(project.duration)&&project.duration>=0&&end>project.duration+epsilon)emit('vocal.afterSong','Vocal event extends beyond the song duration.',{...at,field:'length',severity:'warning',extra:{end}});
  }
  if(row.pitch!==undefined&&row.pitch!==null&&(!Number.isInteger(row.pitch)||row.pitch<0||row.pitch>127))emit('vocal.pitch','Optional vocal pitch must be an integer MIDI note from 0 to 127.',{...at,field:'pitch'});
  if(typeof row.text!=='string'){
   emit('vocal.text','Vocal lyric text must be a string.',{...at,field:'text'});continue;
  }
  if(!row.text.trim()&&row._pitchOnly!==true)emit('vocal.emptyText','This vocal event has no lyric text; keep it intentionally blank or enter a syllable.',{...at,field:'text',severity:'warning'});
  const {bytes,nul,xmlInvalid}=textFacts(row.text);
  if(bytes===null)emit('vocal.encoding','Vocal text contains an unpaired Unicode surrogate and cannot be serialized as strict UTF-8.',{...at,field:'text'});
  else if(native&&bytes>NATIVE_VOCAL_UTF8_LIMIT)emit('vocal.nativeLength',`RS2014 native compilation limit is 47 UTF-8 bytes per vocal syllable; this text uses ${bytes}. Split it before compiling; XML can retain the full text.`,{...at,field:'text',severity:nativeSeverity,extra:{utf8Bytes:bytes,nativeLimit:NATIVE_VOCAL_UTF8_LIMIT}});
  if(native&&nul>=0){
   const message=target==='cdlc'?'Embedded NUL terminates the native RS2014 lyric field and loses following text; it is also forbidden in XML 1.0.':'NUL (U+0000) is forbidden in XML 1.0 lyric text; editable JSON/Feedpak can retain it.';
   emit(target==='cdlc'?'vocal.nativeNul':'vocal.xmlCharacter',message,{...at,field:'text',extra:{codePoint:0,characterIndex:nul}});
  }
  if(native&&xmlInvalid){const label='U+'+xmlInvalid.value.toString(16).toUpperCase().padStart(4,'0');emit('vocal.xmlCharacter',`${label} is forbidden in XML 1.0 lyric text; editable JSON/Feedpak can retain it.`,{...at,field:'text',extra:{codePoint:xmlInvalid.value,characterIndex:xmlInvalid.index}});}
 }
 return issues;
}

export default findVocalIssues;
