import test from 'node:test';
import assert from 'node:assert/strict';
import {makeArrangement,makeNote,chordFromSelection} from '../src/model.js';
import {suggestChordNames} from '../src/chord-names.js';
test('exact recognition uses sounding pitches, inversion bass and editable alternatives',()=>{
 const a=makeArrangement('keys'),notes=[48,52,55].map(pitch=>({pitch}));assert.equal(suggestChordNames(a,notes)[0],'C');assert.equal(suggestChordNames(a,[{pitch:52},{pitch:55},{pitch:60}])[0],'C/E');assert.equal(suggestChordNames(a,[{pitch:57},{pitch:60},{pitch:64}])[0],'Am');assert.deepEqual(suggestChordNames(a,[{pitch:60}]),[]);
 assert.ok(suggestChordNames(a,[48,52,55,57].map(pitch=>({pitch}))).includes('Am7/C'));
});
test('names follow the tuning but read the shape over a capo, as official charts do',()=>{
 const a=makeArrangement('guitar',8);a.capo=2;const notes=[makeNote(a,0,2,1),makeNote(a,0,3,0),makeNote(a,0,5,5)];assert.equal(suggestChordNames(a,notes)[0],'F');a.tuning[2]=-1;assert.ok(!suggestChordNames(a,notes).includes('F'));
 const eb=makeArrangement('guitar');eb.tuning=eb.tuning.map(()=>-1);
 assert.equal(suggestChordNames(eb,[[0,3],[1,2],[2,0],[3,0],[4,3],[5,3]].map(([s,f])=>makeNote(eb,0,s,f)))[0],'F#','a G shape in Eb tuning sounds F#');
});
test('chord creation retains authored fingers including thumb zero',()=>{
 const a=makeArrangement(),notes=[makeNote(a,0,0,3),makeNote(a,0,1,5)];notes[0].techniques.left_hand=0;notes[1].techniques.left_hand=3;a.notes=notes;chordFromSelection(a,notes,'Own');assert.deepEqual(a.chord_templates[0].fingers,[0,3,-1,-1,-1,-1]);
});

// Rocksmith naming on real shapes: (string, fret) with string 0 the lowest.
const shape=(a,pairs)=>pairs.map(([string,fret])=>makeNote(a,0,string,fret));
test('Rocksmith-convention names for common six-string shapes',()=>{
 const g=makeArrangement('guitar',6),name=pairs=>suggestChordNames(g,shape(g,pairs))[0];
 assert.equal(name([[0,0],[1,2],[2,2]]),'E5');
 assert.equal(name([[1,3],[2,2],[3,0],[4,1],[5,0]]),'C');
 // Official guitar charts mostly drop the slash; the slash name stays offered.
 assert.equal(name([[0,2],[2,0],[3,2],[4,3],[5,2]]),'D');assert.ok(suggestChordNames(g,shape(g,[[0,2],[2,0],[3,2],[4,3],[5,2]])).includes('D/F#'));
 assert.equal(name([[1,0],[2,2],[3,0],[4,1],[5,0]]),'Am7');
 assert.equal(name([[1,3],[2,2],[3,3],[4,1]]),'C7','fifth may be omitted, as in official charts');
 assert.equal(name([[1,7],[2,6],[3,7],[4,8]]),'E7(#9)');
 assert.equal(name([[0,0],[2,2]]),'E8','octave shapes use the official "8" suffix');
 assert.deepEqual(suggestChordNames(g,shape(g,[[2,2],[3,1]])),[],'other two-note shapes stay unnamed');
});
test('extended range: seven and eight string guitars, five string bass',()=>{
 const seven=makeArrangement('guitar',7),eight=makeArrangement('guitar',8),bass=makeArrangement('bass',5);
 assert.equal(suggestChordNames(seven,shape(seven,[[0,0],[1,2],[2,2]]))[0],'B5');
 assert.equal(suggestChordNames(eight,shape(eight,[[0,0],[1,2],[2,2]]))[0],'F#5');
 assert.equal(suggestChordNames(eight,shape(eight,[[0,0],[1,2],[2,2],[3,0]]))[0],'F#m','low F# minor across the extended strings');
 assert.equal(suggestChordNames(eight,shape(eight,[[0,0],[1,2],[2,2],[3,1]]))[0],'F#');
 assert.equal(suggestChordNames(bass,shape(bass,[[0,0],[1,2]]))[0],'B5');
});
