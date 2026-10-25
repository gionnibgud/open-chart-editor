// Original exact pitch-class recognizer. Suggestions are editable labels,
// not a harmonic-analysis authority; ambiguous voicings return alternatives.
import {notePitch} from './model.js';

// Root spelling as official Rocksmith charts use it most (C#, Eb, F#, Ab, Bb).
const names=['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
// A slash bass is spelled in the chord's key family (E/G#, not E/Ab; C/Bb, not C/A#).
const sharps=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'],flats=['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
const sharpRoots=new Set([1,2,4,6,7,9,11]);
const bassName=(root,pc)=>(sharpRoots.has(root)?sharps:flats)[pc];

/** Chord suffixes in Rocksmith's own spelling, most used first. Counts are
 * official chord templates per suffix in a 4,000-arrangement census
 * (tools/chord_name_census.py; tools/chord_name_agreement.mjs scores the names). `optional` intervals may be absent, as
 * official charts often drop the fifth but keep the name. Names come from
 * sounding pitch classes, so any string count (4-8), tuning or capo works. */
export const CHORD_SUFFIXES=Object.freeze([
 ['',[0,4,7],[],13217],['5',[0,7],[],5489],['m',[0,3,7],[],5120],
 ['7',[0,4,10],[7],4419],['m7',[0,3,10],[7],3865],['Maj7',[0,4,11],[7],2280],
 ['sus4',[0,5,7],[],1180],['7sus4',[0,5,10],[7],1065],['sus2',[0,2,7],[],1032],
 ['6',[0,4,9],[7],948],['7sus2',[0,2,10],[7],603],['dim7',[0,3,6,9],[],414],
 ['dim',[0,3,6],[],398],['7(b9)',[0,1,4,10],[7],361],['m7(b5)',[0,3,6,10],[],346],
 ['m6',[0,3,9],[7],303],['aug',[0,4,8],[],229],['7(#5)',[0,4,8,10],[],207],
 ['7(b5)',[0,4,6,10],[],165],['7(#9)',[0,3,4,10],[7],150],['m(Maj7)',[0,3,7,11],[],131],
 ['(add9)',[0,2,4,7],[],73],['7(no 3)',[0,7,10],[],42],['m9',[0,2,3,10],[7],37],
 ['(add11)',[0,4,5,7],[],35],['m(add9)',[0,2,3,7],[],29],['9',[0,2,4,10],[7],27],
 ['m(add11)',[0,3,5,7],[],22],['Maj7(no 3)',[0,7,11],[],17],['13',[0,4,9,10],[2,7],16],
 ['m11',[0,3,5,10],[2,7],15],['Maj7(#11)',[0,4,6,11],[7],14],['6/9',[0,2,4,9],[7],13],
 ['(b5)',[0,4,6],[],11],['6(no 3)',[0,7,9],[],10],['Maj7sus2',[0,2,7,11],[],8],
 ['Maj9',[0,2,4,11],[7],4],['6sus4',[0,5,9],[7],4],['sus2(add11)',[0,2,5,7],[],3],['m(b13)',[0,3,7,8],[],3],
 // Two notes of one pitch class (octaves) are named with "8" in official charts.
 ['8',[0],[],701],
]);

export function suggestChordNames(arrangement,notes,{limit=8}={}){
 // Rocksmith names fretted chords by sound in the tuning but by shape over a capo.
 const capo=arrangement?.type==='keys'?0:arrangement?.capo||0;
 const pitches=notes.map(n=>notePitch(arrangement,n)-capo).filter(Number.isFinite);if(pitches.length<2)return[];
 const pcs=[...new Set(pitches.map(p=>((p%12)+12)%12))],bass=((Math.min(...pitches)%12)+12)%12,candidates=[],fretted=arrangement?.type!=='keys';
 for(let root=0;root<12;root++)CHORD_SUFFIXES.forEach(([suffix,required,optional],rank)=>{
  const allowed=new Set([...required,...optional].map(interval=>(root+interval)%12));
  if(!required.every(interval=>pcs.includes((root+interval)%12))||!pcs.every(pc=>allowed.has(pc)))return;
  const entry={root,rootInBass:root===bass,rank,omitted:required.length+optional.length-pcs.length};
  candidates.push({...entry,name:names[root]+suffix+(root===bass?'':'/'+bassName(root,bass))});
  // Official guitar/bass charts more often drop the slash (1,305 vs 503 in the census).
  if(root!==bass&&fretted)candidates.push({...entry,name:names[root]+suffix,plain:true});
 });
 // Common Rocksmith names first; a root in the bass is worth about eight places, so a
 // common slash name beats a rare bass-rooted one (C(add9)/G over G6sus4).
 const score=c=>c.rank+(c.rootInBass?0:8);
 return candidates.sort((a,b)=>score(a)-score(b)||Number(!!b.plain)-Number(!!a.plain)||a.omitted-b.omitted||a.root-b.root).slice(0,limit).map(candidate=>candidate.name);
}
