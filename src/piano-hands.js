// Original user-controlled hand assignment; the split is an authoring choice,
// not an inference about the player's fingering or the R+ Workshop algorithm.
import {notePitch} from './model.js';
export function assignHands(arrangement,{ids=null,mode='split',split=60}={}){
 if(arrangement.type!=='keys')throw Error('Hand assignment requires a pitched piano-roll arrangement');
 if(!['split','lh','rh','clear'].includes(mode))throw Error('Choose split, left, right or unassigned');
 if(mode==='split'&&(!Number.isInteger(split)||split<0||split>127))throw Error('The hand split must be an integer MIDI pitch from 0 to 127');
 const selected=ids==null?null:new Set(ids),all=[...(arrangement.notes||[]),...(arrangement.chords||[]).flatMap(c=>c.notes||[])],notes=all.filter(n=>selected==null||selected.has(n.id));
 if(!notes.length)throw Error('Choose notes to assign');
 if(selected&&notes.length!==selected.size)throw Error('Hand assignment selection contains missing or ambiguous IDs');
 const planned=notes.map(note=>{const pitch=notePitch(arrangement,note);if(mode==='split'&&(!Number.isInteger(pitch)||pitch<0||pitch>127))throw Error('Resolve invalid MIDI pitches before assigning by split');return[note,mode==='split'?(pitch<split?'lh':'rh'):mode]});
 for(const [note,hand]of planned){if(hand==='clear'){delete note.hand;if(note.techniques)delete note.techniques.hand;}else note.hand=hand;}
 return{count:notes.length,mode,split:mode==='split'?split:null};
}
