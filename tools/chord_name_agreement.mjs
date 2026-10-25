// How often does suggestChordNames reproduce the official Rocksmith chord name?
// Reads chordTemplates from a local scrape (read-only); prints agreement counts only.
// Usage: node tools/chord_name_agreement.mjs [SONGS_ROOT] [MAX_FILES]
import {readdirSync,readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {makeArrangement} from '../src/model.js';
import {suggestChordNames} from '../src/chord-names.js';
const root=process.argv[2]||'I:/Docker/RocksmithScrape/Songs',limit=Number(process.argv[3]||800);
const GUITAR=[40,45,50,55,59,64],BASS=[28,33,38,43],keys=makeArrangement('keys'),fretted=makeArrangement('guitar',6);
const files=[];(function walk(dir){for(const name of readdirSync(dir)){if(files.length>=limit)return;const path=join(dir,name);if(statSync(path).isDirectory())walk(path);else if(/^Official_(?!Vocals).*\.xml$/.test(name))files.push(path);}})(root);
const tally={named:0,exact:0,inSuggestions:0,sameChord:0,unnamedOfficial:0,unnamedAgree:0},misses=new Map(),structural=new Map();
const PC={C:0,D:2,E:4,F:5,G:7,A:9,B:11},spell=n=>n?.replace(/([A-G])([#b]?)/g,(m,l,a)=>String((PC[l]+(a==='#'?1:a==='b'?-1:0)+12)%12)+'|');
for(const file of files){
 const xml=readFileSync(file,'utf8'),bass=/<arrangement>[^<]*Bass/i.test(xml),base=bass?BASS:GUITAR;
 const tuning=xml.match(/<tuning\b([^>]*)>/)?.[1]||'',offset=i=>Number(tuning.match(new RegExp(`string${i}="(-?\\d+)"`))?.[1]||0);
 const capo=Number(xml.match(/<capo>(\d+)<\/capo>/)?.[1]||0);
 for(const [,attrs] of xml.matchAll(/<chordTemplate\b([^>]*)\/>/g)){
  const name=(attrs.match(/chordName="([^"]*)"/)?.[1]||'').trim(),notes=[];
  for(let i=0;i<base.length;i++){const fret=Number(attrs.match(new RegExp(`fret${i}="(-?\\d+)"`))?.[1]??-1);if(fret>=0)notes.push({pitch:base[i]+offset(i)+fret+(fret>0?capo:0)});}
  if(notes.length<2)continue;
  const suggestions=suggestChordNames(fretted,notes.map(n=>({...n,string:0,fret:0})));
  if(!name){tally.unnamedOfficial++;if(!suggestions.length)tally.unnamedAgree++;continue;}
  tally.named++;if(spell(suggestions[0])===spell(name))tally.sameChord++;else{const k=`${name} -> ${suggestions[0]??'(none)'}`;structural.set(k,(structural.get(k)||0)+1);}if(suggestions[0]===name)tally.exact++;else{if(suggestions.includes(name))tally.inSuggestions++;const key=`${name} -> ${suggestions[0]??'(none)'}`;misses.set(key,(misses.get(key)||0)+1);}
 }
}
const pct=(a,b)=>`${(100*a/b).toFixed(1)}%`;
console.log(`files ${files.length} | named ${tally.named}: first suggestion exact ${pct(tally.exact,tally.named)}, official name among suggestions ${pct(tally.exact+tally.inSuggestions,tally.named)}`);
console.log(`officially unnamed ${tally.unnamedOfficial}: editor also suggests nothing ${pct(tally.unnamedAgree,tally.unnamedOfficial)}`);
console.log('same chord ignoring sharp/flat spelling: '+pct(tally.sameChord,tally.named));console.log('most common real differences:',[...structural].sort((a,b)=>b[1]-a[1]).slice(0,16).map(([k,v])=>`${k} x${v}`).join(' | '));console.log('most common differences:',[...misses].sort((a,b)=>b[1]-a[1]).slice(0,14).map(([k,v])=>`${k} x${v}`).join(' | '));
