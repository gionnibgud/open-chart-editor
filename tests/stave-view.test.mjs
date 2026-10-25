import test from 'node:test';
import assert from 'node:assert/strict';
import {makeArrangement,makeNote,notePitch} from '../src/model.js';
import {staveLayout,guessKey,keyAlterations,spell,pitchAtStep,noteValue,fretFor,openStrings,drumStepPiece,drumPieceAt,layoutNotes,layoutRests,writtenNote,melodicInstrument,staveMetrics,CLEF_BOTTOM,DRUM_POSITIONS,hitNote} from '../src/stave-view.js';

test('spelling follows the key signature', () => {
 assert.equal(spell(60, 0).name, 'C4');
 assert.equal(spell(61, 0).name, 'C#4', 'sharps by default');
 assert.equal(spell(61, -2).name, 'Db4', 'flats in a flat key');
 assert.equal(spell(70, -2).name, 'Bb4');
 assert.equal(spell(66, 1).name, 'F#4', 'the key\'s own sharp');
 assert.equal(spell(59, -7).name, 'Cb4', 'Cb major spells B3 as Cb4');
 assert.deepEqual(keyAlterations(2), [1, 0, 0, 1, 0, 0, 0], 'D major: F# and C#');
 assert.equal(pitchAtStep(spell(66, 1).step, 1), 66, 'a staff step in G major reads back as F#');
});

test('key guess', () => {
 const cMajor = [60, 62, 64, 65, 67, 69, 71, 72, 64, 67, 60];
 assert.deepEqual(guessKey([...cMajor, ...cMajor]), {name: 'C', fifths: 0});
 const bbMinor = [58, 61, 65, 58, 61, 65, 63, 66, 68, 70];
 assert.deepEqual(guessKey([...bbMinor, ...bbMinor]), {name: 'Bbm', fifths: -5});
 assert.deepEqual(guessKey(bbMinor), {name: 'C', fifths: 0}, 'too few notes to set a key signature');
 assert.deepEqual(guessKey([]), {name: 'C', fifths: 0});
});

test('note values from lengths in beats', () => {
 assert.deepEqual(noteValue(1), {value: 1, dots: 0, beats: 1});
 assert.deepEqual(noteValue(1.5), {value: 1, dots: 1, beats: 1.5});
 assert.deepEqual(noteValue(0.48), {value: 0.5, dots: 0, beats: 0.5});
 assert.deepEqual(noteValue(4.2), {value: 4, dots: 0, beats: 4});
});

test('layouts: guitar and bass written an octave up, keys on a grand staff, drums on percussion', () => {
 assert.deepEqual(staveLayout(makeArrangement('guitar')).staves.map(s => s.clef), ['treble']);
 assert.equal(staveLayout(makeArrangement('guitar')).transpose, 12);
 assert.deepEqual(staveLayout(makeArrangement('bass')).staves.map(s => s.clef), ['bass']);
 assert.deepEqual(staveLayout(makeArrangement('keys')).staves.map(s => s.clef), ['treble', 'bass']);
 assert.equal(staveLayout(makeArrangement('drums')).kind, 'drums');
});

test('tunings: open strings and fret placement follow the part tuning and capo', () => {
 const standard = makeArrangement('guitar');
 assert.deepEqual(openStrings(standard), [40, 45, 50, 55, 59, 64]);
 const dropD = makeArrangement('guitar'); dropD.tuning = [-2, 0, 0, 0, 0, 0];
 assert.equal(openStrings(dropD)[0], 38);
 assert.deepEqual(fretFor(dropD, 38), {string: 0, fret: 0}, 'low D exists only in drop D');
 assert.equal(fretFor(standard, 38), null, 'and not in standard tuning');
 const eb = makeArrangement('guitar'); eb.tuning = eb.tuning.map(() => -1);
 assert.deepEqual(fretFor(eb, 55, {preferString: 0}), {string: 0, fret: 16}, 'keeps the preferred string when playable');
 const seven = makeArrangement('guitar', 7);
 assert.equal(openStrings(seven)[0], 35, '7-string low B');
 assert.deepEqual(fretFor(seven, 35), {string: 0, fret: 0});
 const bass5 = makeArrangement('bass', 5);
 assert.equal(openStrings(bass5)[0], 23, '5-string bass low B');
 const capo = makeArrangement('guitar'); capo.capo = 2;
 assert.deepEqual(fretFor(capo, 42), {string: 0, fret: 0}, 'capo 2: the open low string sounds F#');
 assert.equal(fretFor(capo, 40), null, 'nothing below the capo');
 assert.deepEqual(fretFor(standard, 64, {occupied: new Set([5])}).string !== 5, true, 'an occupied string is skipped');
 assert.equal(fretFor(standard, 64 + 24, {maxFret: 24}).fret, 24);
});

test('notes read at sounding pitch through the tuning', () => {
 const eb = makeArrangement('guitar'); eb.tuning = eb.tuning.map(() => -1);
 const n = makeNote(eb, 0, 0, 3);
 assert.equal(notePitch(eb, n), 42, 'G shape on the low string sounds F# in Eb tuning');
 const [entry] = layoutNotes(eb, [n], {fifths: 0});
 assert.equal(entry.step, spell(54, 0).step, 'written an octave above sounding');
 assert.equal(entry.accidental, 1, 'F# needs a sharp in C');
});

test('accidentals hold to the end of the bar and reset at the next', () => {
 const keys = makeArrangement('keys'), notes = [0, 0.5, 2.5].map(t => makeNote(keys, t, 61, 0, 0.25));
 const entries = layoutNotes(keys, notes, {fifths: 0, beatLength: () => 0.5, barOf: t => Math.floor(t / 2)});
 assert.deepEqual(entries.map(e => e.accidental), [1, null, 1]);
 const naturals = layoutNotes(keys, [makeNote(keys, 0, 61, 0, .25), makeNote(keys, .5, 60, 0, .25)], {fifths: 0, beatLength: () => .5, barOf: () => 0});
 assert.deepEqual(naturals.map(e => e.accidental), [1, 0], 'a natural cancels the sharp in the same bar');
});

test('keys split by hand, then middle C', () => {
 const keys = makeArrangement('keys'), low = makeNote(keys, 0, 55), high = makeNote(keys, 0, 64);
 low.hand = null; delete high.hand;
 const lh = makeNote(keys, 1, 72); lh.hand = 'lh';
 assert.deepEqual(layoutNotes(keys, [low, high, lh]).map(e => e.stave), [1, 0, 1]);
});

test('drums: positions on the percussion staff and stepping between pieces', () => {
 const drums = makeArrangement('drums'), kick = makeNote(drums, 0, 0); kick.piece = 'kick';
 const hat = makeNote(drums, 0, 0); hat.piece = 'hh_closed';
 const entries = layoutNotes(drums, [kick, hat]);
 assert.equal(entries.find(e => e.note === kick).step, DRUM_POSITIONS.kick.d);
 assert.equal(entries.find(e => e.note === hat).x, true, 'hi-hat uses an x head');
 assert.equal(drumStepPiece('kick', 1), 'tom_floor');
 assert.equal(drumStepPiece('kick', -1), 'hh_pedal');
 assert.equal(drumPieceAt(DRUM_POSITIONS.snare.d), 'snare');
});

test('staff metrics map steps to y and back', () => {
 const m = staveMetrics(staveLayout(makeArrangement('keys')), 260);
 for (const [stave, step] of [[0, CLEF_BOTTOM.treble], [0, 40], [1, CLEF_BOTTOM.bass], [1, 12]]) assert.equal(m.stepAt(stave, m.yOf(stave, step)), step);
 assert.ok(m.staves[0].bottom < m.staves[1].top, 'treble above bass');
 assert.equal(m.staveAt(m.staves[1].bottom), 1);
 assert.equal(hitNote([{id: 'a', x: 10, y: 10, r: 6}, {id: 'b', x: 40, y: 10, r: 6}], 38, 12), 'b');
 assert.equal(hitNote([{id: 'a', x: 10, y: 10, r: 6}], 60, 60), null);
});

test('single-line pitched instruments get their own clef and written transposition', () => {
 const part = instrument => makeArrangement('keys', null, {instrument});
 assert.deepEqual(staveLayout(part('flute')), {staves: [{clef: 'treble'}], transpose: 0, kind: 'melodic', instrument: 'flute'});
 assert.equal(staveLayout(part('viola')).staves[0].clef, 'alto');
 assert.equal(staveLayout(part('Alto Sax')).transpose, 9, 'an alto sax reads a major 6th above sounding');
 assert.equal(staveLayout(part('piano')).staves.length, 2, 'piano keeps the grand staff');
 const named = makeArrangement('keys'); named.name = 'Flute in C';
 assert.equal(melodicInstrument(named), 'flute', 'an unlabelled part is recognised by its name');
 assert.equal(writtenNote(staveLayout(part('clarinet'))), 'written a major 2nd above sounding');
 assert.equal(writtenNote(staveLayout(part('flute'))), '');
 // A flute note sits on one treble stave whatever its register, using its sustain as the written length.
 const flute = part('flute'), low = makeNote(flute, 0, 55, 0, 1), high = makeNote(flute, 1, 84, 0, 0.5);
 const laid = layoutNotes(flute, [low, high], {beatLength: () => 0.5});
 assert.deepEqual(laid.map(e => [e.stave, e.value.value]), [[0, 2], [0, 1]]);
 assert.equal(CLEF_BOTTOM.alto, 24, 'the alto clef bottom line is F3');
});

test('rests fill the gaps between written notes without crossing a bar line', () => {
 const beats = Array.from({length: 13}, (_, i) => ({time: i * 0.5, measure: i % 4 === 0 ? i / 4 + 1 : -1}));
 const flute = makeArrangement('keys', null, {instrument: 'flute'});
 // Bar 1: a quarter on beat 1 and an eighth on beat 3; bar 2 empty; bar 3 a half note on beat 1.
 const notes = [makeNote(flute, 0, 72, 0, 0.5), makeNote(flute, 1, 72, 0, 0.25), makeNote(flute, 4, 72, 0, 1)];
 const rests = layoutRests(layoutNotes(flute, notes, {beatLength: () => 0.5}), beats, {staves: 1});
 assert.deepEqual(rests.map(r => [r.time, r.value.value, !!r.bar]), [[0.5, 1, false], [1.25, 0.5, false], [1.5, 1, false], [2, 4, true], [5, 2, false]]);
 assert.equal(layoutRests([], beats, {staves: 2}).filter(r => r.bar).length, 6, 'each empty bar, per stave');
});
