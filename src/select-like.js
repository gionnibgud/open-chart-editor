import {notePitch} from './model.js';

// Match authored identities within the visible difficulty. Timing, dynamics,
// techniques and opaque source data do not affect the match or get rewritten.
export function selectLike(arrangement,ids){
 const selected=new Set(ids),notes=[...(arrangement.notes||[]),...(arrangement.chords||[]).flatMap(c=>c.notes||[])];
 const identity=arrangement.type==='drums'?n=>n.piece:arrangement.type==='keys'?n=>notePitch(arrangement,n):n=>`${n.string}:${n.fret}`;
 const keys=new Set(notes.filter(n=>selected.has(n.id)).map(identity));
 return new Set(notes.filter(n=>keys.has(identity(n))).map(n=>n.id));
}
