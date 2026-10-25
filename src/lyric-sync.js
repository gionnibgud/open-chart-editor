// Lyric sheet and tap timing for the Lyrics tab. Original editor logic; no DOM, audio or
// network. Text is Unicode throughout: any script works. Only the optional syllable
// suggestion is language-specific (English words written in plain a-z letters); every
// other word is left exactly as typed.
//
// Wire convention (Rocksmith vocal XML, FeedPak lyrics, FeedBack's renderer): a syllable
// that continues the same word ends with "-", the last syllable of a line ends with "+".

export const MAX_SHEET_TEXT=1048576;
export const LINE_CHARACTERS=48;          // longer lines are flagged as hard to read on screen
const MIN_LENGTH=.05,AUTO_LENGTH=.4,QUICK_TAP=.12,MAX_AUTO_LENGTH=2;

const chars=text=>[...text].length;
export const bare=wire=>wire.endsWith('-')||wire.endsWith('+')?wire.slice(0,-1):wire;

/** Lyric sheet text to wire syllables. Lines are lines of text (blank lines are
 * ignored), words are separated by whitespace and "-" inside a word marks a syllable. */
export function sheetSyllables(text){
 if(typeof text!=='string'||text.length>MAX_SHEET_TEXT)throw Error('Lyric text must be at most 1 MiB');
 const out=[];let line=0;
 for(const row of text.split(/\r?\n/)){
  const words=row.trim().split(/\s+/u).filter(Boolean).map(word=>word.split('-').filter(Boolean)).filter(parts=>parts.length);
  if(!words.length)continue;
  words.forEach((parts,w)=>parts.forEach((part,p)=>{
   const lastOfWord=p===parts.length-1,lastOfLine=lastOfWord&&w===words.length-1;
   out.push({text:part+(lastOfLine?'+':lastOfWord?'':'-'),line,word:w});
  }));
  line++;
 }
 return out;
}

/** Wire syllables back to sheet text. */
export function sheetText(wires){
 let text='';
 wires.forEach((wire,i)=>{
  text+=bare(wire);
  if(i===wires.length-1)return;
  text+=wire.endsWith('-')?'-':wire.endsWith('+')?'\n':' ';
 });
 return text;
}

/** Group wire syllables into lines (index ranges). A line ends at a "+" syllable. */
export function lines(wires){
 const out=[];let start=0;
 wires.forEach((wire,i)=>{if(wire.endsWith('+')||i===wires.length-1){out.push({start,end:i,text:sheetText(wires.slice(start,i+1)).replace(/\n/g,' ')});start=i+1;}});
 return out;
}

// --- English syllable suggestion -------------------------------------------------
// An original, rule-based splitter for sung English. It is a suggestion the author
// accepts or dismisses; it does not claim dictionary accuracy.

const ENGLISH=/^[A-Za-z]+(?:'[A-Za-z]+)?$/;
const VOWEL=new Set('aeiou');
const KEEP_TOGETHER=['th','ch','sh','ph','wh','qu'];        // never split, go with the next syllable
const KEEP_BEFORE=['ck','ng','gh','x'];                       // stay with the previous syllable
const BLEND=['bl','br','cl','cr','dr','fl','fr','gl','gr','pl','pr','sc','sk','sl','sm','sn','sp','st','sw','tr','tw'];
const ONSET=['str','spr','scr','spl','thr','chr','shr','squ'];
const SPLIT_PAIRS=['ia','io','iu','ua','uo','ii'];
const SINGLE_SUFFIX=/(tion|sion|cion|tious|cious|cial|tial|geous|geon)$/;
const SUFFIXES=['ing','ness','ful','less','ment','ly','ed'];
// Common lyric words the rules get wrong (mostly compounds with a silent e inside).
const WORDS={someone:'some-one',something:'some-thing',sometimes:'some-times',somebody:'some-bod-y',somewhere:'some-where',everyone:'ev-ery-one',everything:'ev-ery-thing',everybody:'ev-ery-bod-y',everywhere:'ev-ery-where',anyone:'an-y-one',anything:'an-y-thing',forever:'for-ev-er',quiet:'qui-et',people:'peo-ple',maybe:'may-be',lonely:'lone-ly',tomorrow:'to-mor-row',heaven:'heav-en',every:'ev-ery'};

function nuclei(word){
 const groups=[];let i=0;
 const vowelAt=j=>(VOWEL.has(word[j])&&!(word[j]==='u'&&word[j-1]==='q'))||(word[j]==='y'&&j>0&&!VOWEL.has(word[j+1]||''));
 while(i<word.length){
  if(!vowelAt(i)){i++;continue;}
  let j=i;while(j+1<word.length&&vowelAt(j+1)&&!(word[j]==='y'))j++;
  // Vowel pairs usually sung as two syllables (pi-an-o, li-on, cru-el).
  let k=i;
  for(;k<j;k++)if(SPLIT_PAIRS.includes(word.slice(k,k+2))&&!(word.slice(k,k+2)==='ue'&&k+2===word.length)){groups.push([i,k]);i=k+1;break;}
  if(k<j)continue;
  groups.push([i,j]);i=j+1;
 }
 // Silent final e (time, fire), and -es / -ed that add no syllable (times, walked).
 const last=groups.at(-1),n=word.length;
 if(groups.length>1&&last[0]===last[1]&&last[0]===n-1&&word[n-1]==='e'&&!/[^aeiouy]le$/.test(word))groups.pop();
 else if(groups.length>1&&last[0]===last[1]&&last[0]===n-2&&word[n-2]==='e'){
  if(word.endsWith('es')&&!/(s|x|z|ch|sh|ce|ge)es$/.test(word))groups.pop();
  if(word.endsWith('ed')&&!/[td]ed$/.test(word))groups.pop();
 }
 return groups;
}

function splitStem(word){
 const groups=nuclei(word);if(groups.length<2)return [word];
 const cuts=[];
 for(let g=0;g<groups.length-1;g++){
  const from=groups[g][1]+1,to=groups[g+1][0],cluster=word.slice(from,to);let cut;
  if(!cluster.length)cut=from;
  else if(g===groups.length-2&&/[^aeiouy]le$/.test(word)&&to===word.length-1)cut=to-2;   // lit-tle, ta-ble
  else if(g===0&&word[0]==='a'&&groups[0][1]===0&&BLEND.includes(cluster))cut=from;            // a-cross, a-gree
  else if(cluster.length===1)cut=KEEP_BEFORE.includes(cluster)?to:from;
  else if(KEEP_TOGETHER.includes(cluster))cut=from;
  else if(KEEP_BEFORE.includes(cluster.slice(0,2)))cut=from+2;
  else if(cluster.length>=3&&ONSET.includes(cluster.slice(-3)))cut=to-3;
  else if(cluster.length>=3&&KEEP_TOGETHER.includes(cluster.slice(-2)))cut=to-2;
  else cut=from+1;
  cuts.push(cut);
 }
 const parts=[];let at=0;for(const cut of cuts){if(cut>at&&cut<word.length){parts.push(word.slice(at,cut));at=cut;}}parts.push(word.slice(at));
 return parts.filter(Boolean);
}

/** Suggested sung syllables for one English word, preserving its letters and case.
 * Returns [word] unchanged for anything that is not plain English letters. */
export function suggestSyllables(word){
 if(typeof word!=='string'||!ENGLISH.test(word)||word.length<4)return [word];
 const lower=word.toLowerCase();
 if(lower.includes("'"))return [word];
 let parts=WORDS[lower]?WORDS[lower].split('-'):null;
 if(!parts&&!SINGLE_SUFFIX.test(lower))for(const suffix of SUFFIXES){
  if(!lower.endsWith(suffix)||lower.length-suffix.length<3)continue;
  let stem=lower.slice(0,-suffix.length),tail=suffix;
  if(suffix==='ed'&&!/[td]$/.test(stem))continue;                 // walked: one syllable
  if(/([bdfgklmnprstz])\1$/.test(stem)&&!/(ll|ss|ff|zz)$/.test(stem)){tail=stem.at(-1)+tail;stem=stem.slice(0,-1);}   // run-ning
  if(!nuclei(stem).length)continue;
  parts=[...splitStem(stem),tail];break;
 }
 if(!parts){
  const match=lower.match(SINGLE_SUFFIX);
  if(match&&lower.length>match[0].length){
   const stem=lower.slice(0,-match[0].length);
   parts=nuclei(stem).length?[...splitStem(stem),match[0]]:[lower];
  }else parts=splitStem(lower);
 }
 parts=parts.filter(Boolean);
 if(parts.some(part=>!nuclei(part).length&&part!=='ing'))parts=mergeEmpty(parts);
 // Restore the original case letter by letter.
 let at=0;return parts.map(part=>{const piece=word.slice(at,at+part.length);at+=part.length;return piece;});
}
function mergeEmpty(parts){const out=[];for(const part of parts){if(out.length&&!nuclei(part).length)out[out.length-1]+=part;else if(!nuclei(part).length&&!out.length)out.push(part);else if(out.length&&!nuclei(out.at(-1)).length){out[out.length-1]+=part;}else out.push(part);}return out;}

/** Suggest hyphenation for a whole sheet. Words that already contain "-" are the
 * author's own split and stay as typed; so do words in any other script. */
export function suggestSheet(text){
 if(typeof text!=='string'||text.length>MAX_SHEET_TEXT)throw Error('Lyric text must be at most 1 MiB');
 const changes=[];
 const result=text.split(/(\r?\n)/).map((row,r)=>/\r?\n/.test(row)?row:row.split(/(\s+)/u).map(token=>{
  if(!token||/^\s+$/u.test(token)||token.includes('-'))return token;
  const lead=token.match(/^[^\p{L}]*/u)[0],trail=token.match(/[^\p{L}']*$/u)[0],core=token.slice(lead.length,token.length-trail.length);
  const parts=suggestSyllables(core);if(parts.length<2)return token;
  const split=lead+parts.join('-')+trail;changes.push({line:r>>1,from:token,to:split});return split;
 }).join('')).join('');
 return {text:result,changes};
}

// --- Syllables: timed vocals plus the untimed rest of the sheet ---------------------

/** Timed vocals in time order (stable), then the untimed tail of the sheet. */
export function syllables(vocals=[],untimed=[]){
 const timed=vocals.map((row,i)=>({row,i})).sort((a,b)=>a.row.time-b.row.time||a.i-b.i).map(({row})=>({id:row.id,text:row.text,time:row.time,length:row.length??0,timed:true}));
 return [...timed,...untimed.map(text=>({text,timed:false}))];
}

/** Apply edited sheet text. Timed syllables keep their timing and take the new text in
 * order; extra sheet syllables become untimed; timed syllables beyond the sheet are
 * listed for removal (the caller asks first). */
export function reconcileSheet(vocals,text){
 const wires=sheetSyllables(text).map(s=>s.text),timed=syllables(vocals).filter(s=>s.timed);
 const renames=[];for(let i=0;i<Math.min(wires.length,timed.length);i++)if(timed[i].text!==wires[i])renames.push({id:timed[i].id,text:wires[i]});
 return {renames,untimed:wires.slice(timed.length),removed:timed.slice(wires.length).map(s=>s.id)};
}

// --- Tap timing ----------------------------------------------------------------------

/** Holding the tap key marks a syllable: key down = start, key up = end. A quick tap
 * (under 0.12 s) gets its length from the next tap's start. Latency is subtracted. */
export class TapSession{
 constructor({start=0,end=Infinity,latency=0}={}){
  if(!Number.isInteger(start)||start<0)throw Error('Choose a syllable to start tapping from');
  this.start=start;this.end=end;this.latency=Number.isFinite(latency)?latency:0;this.taps=[];this.held=null;
 }
 get next(){return this.start+this.taps.length;}
 get done(){return this.next>this.end;}
 /** Start a syllable. A press before the previous tap (while a rewind replays it) is
  * ignored and returns null. */
 down(time){
  if(this.done||this.held!==null||!Number.isFinite(time))return null;
  time=Math.max(0,time-this.latency);
  const previous=this.taps.at(-1);if(previous&&time<previous.time+.02)return null;if(previous?.auto)previous.length=Math.max(MIN_LENGTH,Math.min(MAX_AUTO_LENGTH,time-previous.time-.02));
  this.held={index:this.next,time};return this.held;
 }
 up(time){
  if(this.held===null||!Number.isFinite(time))return null;
  time=Math.max(0,time-this.latency);const held=time-this.held.time,tap={index:this.held.index,time:this.held.time,length:held<QUICK_TAP?AUTO_LENGTH:held,auto:held<QUICK_TAP};
  this.taps.push(tap);this.held=null;return tap;
 }
 /** Remove the last tap. Returns the time to rewind to (2 s before it), or null. */
 undo(){this.held=null;const tap=this.taps.pop();if(!tap)return null;return Math.max(0,tap.time-2);}
 result(){return this.taps.map(({index,time,length})=>({index,time,length}));}
}

/** Write taps into the project. Re-tapped syllables keep their ID, text and pitch;
 * untimed ones become new vocals. Later syllables that would now start before the
 * previous one ends are nudged forward so the lyric order never changes. */
export function commitTaps(vocals,untimed,taps,{uid,duration=Infinity}={}){
 if(typeof uid!=='function')throw Error('A fresh vocal ID generator is required');
 const list=syllables(vocals,untimed),byIndex=new Map(taps.map(t=>[t.index,t]));
 const timedCount=list.filter(s=>s.timed).length;
 for(const tap of taps){if(tap.index<0||tap.index>=list.length)throw Error('A tap refers to a syllable that no longer exists');if(tap.index>timedCount+taps.filter(t=>t.index>=timedCount&&t.index<tap.index).length)throw Error('Untimed syllables must be tapped in order');}
 const original=new Map(vocals.map(row=>[row.id,row])),used=new Set(vocals.map(row=>row.id)),out=[];let lastTapped=-1;
 list.forEach((item,i)=>{
  const tap=byIndex.get(i);
  if(item.timed){const row={...original.get(item.id)};if(tap){row.time=tap.time;row.length=tap.length;lastTapped=i;}out.push(row);}
  else if(tap){let id=uid();while(used.has(id))id=uid();used.add(id);out.push({id,time:tap.time,length:tap.length,text:item.text});lastTapped=i;}
 });
 let nudged=0;
 for(let i=1;i<out.length;i++){
  const floor=out[i-1].time+Math.max(out[i-1].length,0)+.01;
  if(i>lastTapped&&out[i].time<floor){out[i].time=floor;nudged++;}
  else if(i<=lastTapped&&out[i].time<out[i-1].time)throw Error('Taps must be in time order');
 }
 for(const row of out){if(row.time+row.length>duration+1e-6){row.length=Math.max(0,duration-row.time);if(row.time>duration)throw Error('A syllable would start after the end of the song');}}
 const consumed=taps.filter(t=>t.index>=timedCount).length;
 return {vocals:out,untimed:untimed.slice(consumed),nudged,timed:taps.length};
}

// --- Display and corrections ---------------------------------------------------------

/** For a karaoke display: the line holding `time`, the next line, and progress. */
export function karaoke(vocals,time){
 const list=syllables(vocals),wires=list.map(s=>s.text),rows=lines(wires);
 if(!rows.length)return null;
 let index=rows.findIndex(row=>time<list[row.end].time+list[row.end].length);if(index<0)index=rows.length-1;
 const at=rows[index],words=list.slice(at.start,at.end+1).map(s=>({text:bare(s.text),join:s.text.endsWith('-'),sung:time>=s.time,active:time>=s.time&&time<s.time+s.length}));
 return {line:index,words,next:rows[index+1]?.text??'',characters:chars(at.text)};
}

/** Line ranges that are too long to read on one screen line. */
export function longLines(wires,limit=LINE_CHARACTERS){return lines(wires).filter(row=>chars(row.text)>limit);}

/** Move selected syllable starts to the nearest onset within `window` seconds,
 * keeping each syllable's end. Returns updates for the ones that moved. */
export function snapStarts(rows,onsets,{window=.15}={}){
 const sorted=[...onsets].filter(Number.isFinite).sort((a,b)=>a-b);if(!sorted.length)return [];
 const nearest=t=>{let lo=0,hi=sorted.length;while(lo<hi){const mid=(lo+hi)>>1;if(sorted[mid]<t)lo=mid+1;else hi=mid;}return [sorted[lo-1],sorted[lo]].filter(v=>v!==undefined).sort((a,b)=>Math.abs(a-t)-Math.abs(b-t))[0];};
 const out=[];for(const row of rows){const onset=nearest(row.time),end=row.time+(row.length??0);if(onset===undefined||Math.abs(onset-row.time)>window||onset>=end-MIN_LENGTH||Math.abs(onset-row.time)<.001)continue;out.push({id:row.id,time:onset,length:end-onset});}
 return out;
}

/** The [start, end] syllable indexes of the line containing `index`. */
export function lineOf(wires,index){return lines(wires).find(row=>index>=row.start&&index<=row.end)??null;}
