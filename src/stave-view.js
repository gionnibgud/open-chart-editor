// Standard-notation (stave) view of a chart, drawn on the roll's own time axis
// so it scrolls, zooms and plays in step with it (proportional spacing, not
// engraved spacing). Notes are read at their sounding pitch through the part's
// tuning, capo and string count; guitar and bass are written an octave above
// sounding, as their notation usually is. Edits made here map back to a string
// and fret that the part's tuning can play.
import {notePitch} from './model.js';

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
// Order accidentals enter a key signature, as letter indexes.
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6], FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];
// Major keys by fifths (-7..7) and their relative minors.
const MAJOR_BY_FIFTHS = {'-7': 'Cb', '-6': 'Gb', '-5': 'Db', '-4': 'Ab', '-3': 'Eb', '-2': 'Bb', '-1': 'F', 0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#'};
const MINOR_BY_FIFTHS = {'-7': 'Abm', '-6': 'Ebm', '-5': 'Bbm', '-4': 'Fm', '-3': 'Cm', '-2': 'Gm', '-1': 'Dm', 0: 'Am', 1: 'Em', 2: 'Bm', 3: 'F#m', 4: 'C#m', 5: 'G#m', 6: 'D#m', 7: 'A#m'};
// Krumhansl-Kessler profiles for a key guess when the chart names none.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
// Diatonic step (octave*7 + letter) of each clef's bottom line.
export const CLEF_BOTTOM = {treble: 4 * 7 + 2, bass: 2 * 7 + 4, percussion: 4 * 7 + 2};
// Drum kit on a five-line percussion staff (common drum-notation key); `d` is
// the treble-position diatonic step, `x` an x-shaped head (cymbals, hi-hat).
export const DRUM_POSITIONS = Object.freeze({
 kick: {d: 31}, snare: {d: 35}, snare_xstick: {d: 35, x: true},
 tom_floor: {d: 32}, tom_low: {d: 33}, tom_mid: {d: 36}, tom_hi: {d: 37},
 hh_pedal: {d: 29, x: true}, hh_closed: {d: 39, x: true}, hh_open: {d: 39, x: true, open: true},
 ride: {d: 38, x: true}, ride_bell: {d: 38, x: true, bell: true}, bell: {d: 38, x: true, bell: true},
 crash_l: {d: 40, x: true}, crash_r: {d: 41, x: true}, splash: {d: 41, x: true}, china: {d: 42, x: true}, stack: {d: 42, x: true},
});
export const DRUM_STEPS = [...new Set(Object.values(DRUM_POSITIONS).map(p => p.d))].sort((a, b) => a - b);

export const THEMES = Object.freeze({
 dark: {paper: '#17181d', ink: '#d9dde6', staff: '#6c7383', muted: '#8a93a6', select: '#ffd166', playhead: '#4fb3ff', bar: '#9aa3b5', cursor: '#7fd39a'},
 light: {paper: '#fbfaf6', ink: '#17181d', staff: '#5d6470', muted: '#6c7383', select: '#c77700', playhead: '#1f7ad1', bar: '#3c424d', cursor: '#24995a'},
});

/** Stave layout for an arrangement: which staves, clefs and written transposition. */
export function staveLayout(a) {
 if (a?.type === 'drums') return {staves: [{clef: 'percussion'}], transpose: 0, kind: 'drums'};
 if (a?.type === 'keys') return {staves: [{clef: 'treble', hand: 'rh'}, {clef: 'bass', hand: 'lh'}], transpose: 0, kind: 'keys'};
 if (a?.type === 'bass') return {staves: [{clef: 'bass'}], transpose: 12, kind: 'bass'};
 return {staves: [{clef: 'treble'}], transpose: 12, kind: 'guitar'};
}

/** A known key signature ({fifths, minor}) as {name, fifths}, or null. */
export function keyFromSignature(signature) {
 if (!signature || !Number.isInteger(signature.fifths) || Math.abs(signature.fifths) > 7) return null;
 return {name: (signature.minor ? MINOR_BY_FIFTHS : MAJOR_BY_FIFTHS)[signature.fifths], fifths: signature.fifths};
}

/** Key signature for a set of pitches: {name, fifths}. */
export function guessKey(pitches) {
 const counts = Array(12).fill(0);
 for (const pitch of pitches) if (Number.isFinite(pitch)) counts[((pitch % 12) + 12) % 12]++;
 // Too few notes cannot establish a key; stay in C rather than guess a signature.
 if (counts.reduce((sum, c) => sum + c, 0) < 16) return {name: 'C', fifths: 0};
 let best = null;
 const mean = values => values.reduce((s, v) => s + v, 0) / values.length;
 for (let tonic = 0; tonic < 12; tonic++) for (const [profile, minor] of [[MAJOR, false], [MINOR, true]]) {
  const rotated = counts.map((_, pc) => profile[(pc - tonic + 12) % 12]), ma = mean(counts), mb = mean(rotated);
  let num = 0, da = 0, db = 0;
  for (let pc = 0; pc < 12; pc++) {num += (counts[pc] - ma) * (rotated[pc] - mb); da += (counts[pc] - ma) ** 2; db += (rotated[pc] - mb) ** 2;}
  const score = num / (Math.sqrt(da * db) || 1);
  // Fifths of the relative major: C=0 ... ; a minor key shares its relative major's signature.
  const major = minor ? (tonic + 3) % 12 : tonic, fifths = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5][major];
  if (!best || score > best.score) best = {score, fifths, minor};
 }
 return {name: (best.minor ? MINOR_BY_FIFTHS : MAJOR_BY_FIFTHS)[best.fifths], fifths: best.fifths};
}

/** Alteration per letter (-1, 0, 1) in a key signature. */
export function keyAlterations(fifths) {
 const alter = Array(7).fill(0);
 if (fifths > 0) for (const letter of SHARP_ORDER.slice(0, fifths)) alter[letter] = 1;
 if (fifths < 0) for (const letter of FLAT_ORDER.slice(0, -fifths)) alter[letter] = -1;
 return alter;
}

/** Written spelling of a MIDI pitch in a key: {letter, alter, octave, step}. */
export function spell(pitch, fifths = 0) {
 const pc = ((pitch % 12) + 12) % 12, alter = keyAlterations(fifths);
 // Prefer the key's own letter for this pitch class, then sharps in sharp keys, flats in flat keys.
 let letter = alter.findIndex((a, l) => (LETTER_PC[l] + a + 12) % 12 === pc), acc = letter >= 0 ? alter[letter] : 0;
 if (letter < 0) {
  const natural = LETTER_PC.indexOf(pc);
  if (natural >= 0) [letter, acc] = [natural, 0];
  else if (fifths < 0) [letter, acc] = [LETTER_PC.indexOf((pc + 1) % 12), -1];
  else [letter, acc] = [LETTER_PC.indexOf((pc + 11) % 12), 1];
 }
 const octave = Math.floor((pitch - acc) / 12) - 1;
 return {letter, alter: acc, octave, step: octave * 7 + letter, name: LETTERS[letter] + (acc > 0 ? '#' : acc < 0 ? 'b' : '') + octave};
}

/** MIDI pitch for a staff step in a key (the key signature's alteration applies). */
export function pitchAtStep(step, fifths = 0) {
 const letter = ((step % 7) + 7) % 7, octave = Math.floor(step / 7);
 return (octave + 1) * 12 + LETTER_PC[letter] + keyAlterations(fifths)[letter];
}

/** Notated value for a length in beats: {beats, dots, value} with value 4=whole ... 0.125=32nd. */
export function noteValue(beats) {
 const options = [];
 for (const value of [4, 2, 1, 0.5, 0.25, 0.125]) {options.push({value, dots: 0, beats: value}); if (value > 0.125) options.push({value, dots: 1, beats: value * 1.5});}
 const target = Math.max(0.125, Number.isFinite(beats) ? beats : 1);
 return options.reduce((best, o) => Math.abs(Math.log(o.beats / target)) < Math.abs(Math.log(best.beats / target)) ? o : best);
}

/** Sounding pitch of a chart note; drums return null (they use DRUM_POSITIONS). */
export const soundingPitch = (a, n) => a?.type === 'drums' ? null : notePitch(a, n);

/** Open-string sounding pitches of a fretted part (base + tuning + capo), low string first. */
export function openStrings(a) {
 const bases = a.basePitches?.length ? a.basePitches : null;
 return Array.from({length: a.stringCount || 6}, (_, s) => notePitch(a, {string: s, fret: 0}) ?? (bases ? bases[s] : 40));
}

/**
 * A string and fret that sound `pitch` on this part's tuning, or null.
 * Keeps `preferString` when it can, never uses a string in `occupied`, and
 * otherwise picks the playable position closest to `nearFret`.
 */
export function fretFor(a, pitch, {preferString = null, occupied = new Set(), nearFret = null, maxFret = 24} = {}) {
 const open = openStrings(a), capo = a.capo || 0, candidates = [];
 for (let s = 0; s < open.length; s++) {
  const fret = pitch - open[s];
  if (fret < 0 || fret + capo > maxFret || occupied.has(s)) continue;
  candidates.push({string: s, fret});
 }
 if (!candidates.length) return null;
 const kept = candidates.find(c => c.string === preferString);
 if (kept) return kept;
 const target = Number.isFinite(nearFret) ? nearFret : 5;
 return candidates.sort((x, y) => Math.abs(x.fret - target) - Math.abs(y.fret - target) || x.fret - y.fret)[0];
}

/** Next drum piece up or down the staff from `piece` (by staff position), or null at the edge. */
export function drumStepPiece(piece, direction) {
 const here = DRUM_POSITIONS[piece]?.d ?? DRUM_STEPS[0], steps = direction > 0 ? DRUM_STEPS.filter(d => d > here) : DRUM_STEPS.filter(d => d < here).reverse();
 return steps.length ? drumPieceAt(steps[0]) : null;
}
/** The usual drum piece written at a staff step (closest position). */
export function drumPieceAt(step) {
 const preferred = ['kick', 'tom_floor', 'tom_low', 'snare', 'tom_mid', 'tom_hi', 'ride', 'hh_closed', 'crash_l', 'crash_r', 'china', 'hh_pedal'];
 return preferred.reduce((best, piece) => Math.abs(DRUM_POSITIONS[piece].d - step) < Math.abs(DRUM_POSITIONS[best].d - step) ? piece : best);
}

const LINE_STEPS = [0, 2, 4, 6, 8];

/**
 * Lay out every visible note: stave index, staff step, accidental shown, notated value.
 * `notes` are chart notes (chord members included); `beatLength(t)` gives seconds per beat at t;
 * `barOf(t)` gives the bar index for accidental memory.
 */
export function layoutNotes(a, notes, {fifths = 0, beatLength = () => 0.5, barOf = () => 0} = {}) {
 const layout = staveLayout(a), out = [], memory = new Map(), keyAlter = keyAlterations(fifths);
 const onsets = [...new Set(notes.map(n => Math.round(n.time * 1000)))].sort((x, y) => x - y);
 for (const n of [...notes].sort((x, y) => x.time - y.time)) {
  let stave = 0, step, x = false, accidental = null;
  if (layout.kind === 'drums') {
   const position = DRUM_POSITIONS[n.piece] || {d: 35};
   step = position.d; x = !!position.x;
  } else {
   const pitch = soundingPitch(a, n);
   if (!Number.isFinite(pitch)) continue;
   if (layout.kind === 'keys') stave = n.hand === 'lh' || (n.hand !== 'rh' && pitch < 60) ? 1 : 0;
   const written = spell(pitch + layout.transpose, fifths);
   step = written.step;
   // Accidentals hold to the end of the bar, per staff step and stave.
   const key = `${stave}:${barOf(n.time)}:${written.step}`, expected = memory.has(key) ? memory.get(key) : keyAlter[written.letter];
   if (written.alter !== expected) accidental = written.alter;
   memory.set(key, written.alter);
  }
  // Written length: keys use their sustain; tab notes (whose sustain is ring time, often
  // none) run to the next onset, and drum hits to the next hit, at most a beat.
  const next = onsets.find(o => o > Math.round(n.time * 1000) + 1), beat = beatLength(n.time), gap = next != null ? next / 1000 - n.time : beat;
  const seconds = layout.kind === 'keys' ? (n.sustain > 0.02 ? n.sustain : Math.min(gap, beat * 4)) : layout.kind === 'drums' ? Math.min(gap, beat) : Math.min(Math.max(gap, n.sustain || 0), beat * 4);
  out.push({note: n, stave, step, x, accidental, value: noteValue(seconds / Math.max(0.01, beatLength(n.time)))});
 }
 return out;
}

/** Vertical metrics for the staves in a panel of `height` px. */
export function staveMetrics(layout, height, {top = 34} = {}) {
 const count = layout.staves.length, half = Math.max(3.5, Math.min(8, (height - top - 24) / (count * 14)));
 const span = 8 * half, gap = count > 1 ? Math.max(9 * half, (height - top - 24 - count * span) / Math.max(1, count - 1)) : 0;
 // Centre the staves in the panel, leaving room for ledger lines above and below.
 const used = count * span + (count - 1) * gap, first = top + Math.max(4 * half, (height - top - used) / 2);
 const staves = layout.staves.map((stave, i) => {
  const bottom = first + span + i * (span + gap);
  return {...stave, bottom, top: bottom - span, bottomStep: CLEF_BOTTOM[stave.clef]};
 });
 return {half, staves, yOf: (stave, step) => staves[stave].bottom - (step - staves[stave].bottomStep) * half,
  stepAt: (stave, y) => Math.round((staves[stave].bottom - y) / half) + staves[stave].bottomStep,
  staveAt: y => staves.reduce((best, s, i) => Math.abs((s.top + s.bottom) / 2 - y) < Math.abs((staves[best].top + staves[best].bottom) / 2 - y) ? i : best, 0)};
}

const GLYPH = {treble: '\u{1D11E}', bass: '\u{1D122}', percussion: '\u{1D125}', sharp: '♯', flat: '♭', natural: '♮'};

/**
 * Draw the stave panel. `view` supplies the roll's time mapping and state:
 * {width, height, left, xOf(t), start, end, beats, notes(layout entries), selection,
 *  playhead, cursor, fifths, keyName, theme, label}
 */
export function drawStave(ctx, view) {
 const theme = THEMES[view.theme] || THEMES.dark, layout = staveLayout(view.arrangement), m = staveMetrics(layout, view.height);
 ctx.fillStyle = theme.paper; ctx.fillRect(0, 0, view.width, view.height);
 const left = view.left, clefX = 6;
 // Bar lines and beat ticks on the roll's beat map.
 ctx.lineWidth = 1;
 for (const beat of view.beats) {
  const x = view.xOf(beat.time);
  if (x < left || x > view.width) continue;
  if (beat.measure >= 0) {
   ctx.strokeStyle = theme.bar;
   for (const s of m.staves) {ctx.beginPath(); ctx.moveTo(x + .5, s.top); ctx.lineTo(x + .5, s.bottom); ctx.stroke();}
   ctx.fillStyle = theme.muted; ctx.font = '10px system-ui, sans-serif'; ctx.fillText(String(beat.measure), x + 3, m.staves[0].top - 6 * m.half - 4);
  }
 }
 // Staff lines.
 ctx.strokeStyle = theme.staff;
 for (const s of m.staves) for (const step of LINE_STEPS) {
  const y = Math.round(s.bottom - step * m.half) + .5;
  ctx.beginPath(); ctx.moveTo(clefX, y); ctx.lineTo(view.width, y); ctx.stroke();
 }
 if (m.staves.length > 1) {ctx.beginPath(); ctx.moveTo(clefX + .5, m.staves[0].top); ctx.lineTo(clefX + .5, m.staves.at(-1).bottom); ctx.stroke();}
 // Notes (clipped to the music area so they slide under the clef column).
 ctx.save(); ctx.beginPath(); ctx.rect(left, 0, view.width - left, view.height); ctx.clip();
 const groups = new Map();
 for (const entry of view.notes) {
  const x = view.xOf(entry.note.time);
  if (x < left - 40 || x > view.width + 40) continue;
  const key = `${entry.stave}:${Math.round(entry.note.time * 1000)}`;
  if (!groups.has(key)) groups.set(key, {x, stave: entry.stave, entries: []});
  groups.get(key).entries.push(entry);
 }
 const hits = [];
 for (const group of groups.values()) {
  const s = m.staves[group.stave], ys = group.entries.map(e => m.yOf(group.stave, e.step)), middle = s.bottom - 4 * m.half;
  const up = layout.kind === 'drums' || ys.reduce((sum, y) => sum + y, 0) / ys.length >= middle, value = group.entries.reduce((v, e) => e.value.beats > v.beats ? v : e.value, group.entries[0].value);
  const rx = m.half * 1.25, ry = m.half * 0.9, stemX = group.x + (up ? rx - .5 : -rx + .5);
  // A note a step from its neighbour in the chord goes to the other side of the stem.
  const order = group.entries.map((e, i) => i).sort((p, q) => group.entries[p].step - group.entries[q].step), shift = new Map();
  let previous = null;
  for (const i of up ? order : [...order].reverse()) {const step = group.entries[i].step, flip = previous !== null && Math.abs(step - previous.step) === 1 && !previous.flip; shift.set(i, flip ? (up ? 2 : -2) * rx - (up ? 1 : -1) : 0); previous = {step, flip};}
  for (const [i, entry] of group.entries.entries()) {
   const y = ys[i], selected = view.selection.has(entry.note.id), nx = group.x + shift.get(i);
   ctx.strokeStyle = ctx.fillStyle = selected ? theme.select : theme.ink;
   // Ledger lines above and below the staff.
   ctx.lineWidth = 1;
   for (let step = (entry.step - s.bottomStep) & ~1; step < 0; step += 2) ledger(ctx, group.x, s.bottom - step * m.half, rx);
   for (let step = (entry.step - s.bottomStep) & ~1; step > 8; step -= 2) ledger(ctx, group.x, s.bottom - step * m.half, rx);
   if (entry.x) {
    ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(nx - rx * .8, y - ry); ctx.lineTo(nx + rx * .8, y + ry); ctx.moveTo(nx - rx * .8, y + ry); ctx.lineTo(nx + rx * .8, y - ry); ctx.stroke();
    if (DRUM_POSITIONS[entry.note.piece]?.open) {ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(group.x, s.top - 2 * m.half, m.half * .6, 0, Math.PI * 2); ctx.stroke();}
   } else {
    ctx.save(); ctx.translate(nx, y); ctx.rotate(-0.35); ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    if (value.value >= 2) {ctx.lineWidth = 1.4; ctx.stroke();} else ctx.fill();
    ctx.restore();
   }
   if (entry.value.dots) {ctx.beginPath(); ctx.arc(nx + rx + 4, y - ((entry.step - s.bottomStep) % 2 === 0 ? m.half * .5 : 0), 1.6, 0, Math.PI * 2); ctx.fill();}
   if (entry.accidental !== null) {
    ctx.font = `${Math.round(m.half * 3.4)}px "Segoe UI Symbol", "Noto Music", serif`; ctx.textBaseline = 'middle';
    ctx.fillText(entry.accidental > 0 ? GLYPH.sharp : entry.accidental < 0 ? GLYPH.flat : GLYPH.natural, group.x - rx - m.half * 2.4, y);
    ctx.textBaseline = 'alphabetic';
   }
   hits.push({id: entry.note.id, x: nx, y, r: Math.max(rx, 6)});
  }
  // One stem per chord, with flags for eighths and shorter.
  if (value.value < 4) {
   const tip = up ? Math.min(...ys) - 7 * m.half : Math.max(...ys) + 7 * m.half, base = up ? Math.max(...ys) : Math.min(...ys);
   const selected = group.entries.some(e => view.selection.has(e.note.id));
   ctx.strokeStyle = ctx.fillStyle = selected ? theme.select : theme.ink; ctx.lineWidth = 1.2;
   ctx.beginPath(); ctx.moveTo(stemX, base); ctx.lineTo(stemX, tip); ctx.stroke();
   const flags = value.value <= 0.125 ? 3 : value.value <= 0.25 ? 2 : value.value <= 0.5 ? 1 : 0;
   for (let f = 0; f < flags; f++) {
    const y0 = tip + (up ? 1 : -1) * f * m.half * 1.6;
    ctx.beginPath(); ctx.moveTo(stemX, y0); ctx.quadraticCurveTo(stemX + m.half * 2.2, y0 + (up ? 1 : -1) * m.half * 1.6, stemX + m.half * 1.6, y0 + (up ? 1 : -1) * m.half * 3.2); ctx.stroke();
   }
  }
 }
 // Playhead and edit cursor.
 for (const [time, colour, dash] of [[view.cursor, theme.cursor, [3, 3]], [view.playhead, theme.playhead, []]]) {
  if (!Number.isFinite(time)) continue;
  const x = view.xOf(time); if (x < left || x > view.width) continue;
  ctx.strokeStyle = colour; ctx.setLineDash(dash); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + .5, 4); ctx.lineTo(x + .5, view.height - 4); ctx.stroke(); ctx.setLineDash([]);
 }
 ctx.restore();
 // Clef column: paper behind clef and key signature so notes scroll under it.
 ctx.fillStyle = theme.paper; ctx.fillRect(0, 0, left, view.height);
 ctx.strokeStyle = theme.staff; ctx.lineWidth = 1;
 for (const s of m.staves) for (const step of LINE_STEPS) {const y = Math.round(s.bottom - step * m.half) + .5; ctx.beginPath(); ctx.moveTo(clefX, y); ctx.lineTo(left, y); ctx.stroke();}
 ctx.fillStyle = theme.ink;
 for (const s of m.staves) {
  const size = s.clef === 'treble' ? m.half * 9.5 : s.clef === 'bass' ? m.half * 7.2 : m.half * 6;
  ctx.font = `${Math.round(size)}px "Segoe UI Symbol", "Noto Music", serif`; ctx.textBaseline = 'alphabetic';
  const baseline = s.clef === 'treble' ? s.bottom + m.half * 1.6 : s.clef === 'bass' ? s.bottom - m.half * 1.2 : s.bottom - m.half * 1.4;
  ctx.fillText(GLYPH[s.clef], clefX + 4, baseline);
  if (s.clef !== 'percussion') drawKeySignature(ctx, s, m.half, view.fifths, clefX + m.half * 7.5);
  if (layout.transpose === 12) {ctx.font = '9px system-ui, sans-serif'; ctx.fillText('8', clefX + 4 + m.half * 1.6, s.bottom + m.half * 4.2);}
 }
 ctx.fillStyle = theme.muted; ctx.font = '11px system-ui, sans-serif';
 ctx.fillText(view.label, clefX + 2, 13);
 return {hits, metrics: m};
}

function ledger(ctx, x, y, rx) {ctx.beginPath(); ctx.moveTo(x - rx * 1.7, Math.round(y) + .5); ctx.lineTo(x + rx * 1.7, Math.round(y) + .5); ctx.stroke();}

// Accidental positions (staff steps above the bottom line) for the usual key-signature layout.
const KEY_STEPS = {treble: {sharp: [8, 5, 9, 6, 3, 7, 4], flat: [4, 7, 3, 6, 2, 5, 1]}, bass: {sharp: [6, 3, 7, 4, 1, 5, 2], flat: [2, 5, 1, 4, 0, 3, -1]}};
function drawKeySignature(ctx, s, half, fifths, x) {
 if (!fifths) return;
 const sharp = fifths > 0, steps = KEY_STEPS[s.clef][sharp ? 'sharp' : 'flat'].slice(0, Math.abs(fifths));
 ctx.font = `${Math.round(half * 3.4)}px "Segoe UI Symbol", "Noto Music", serif`; ctx.textBaseline = 'middle';
 steps.forEach((step, i) => ctx.fillText(sharp ? GLYPH.sharp : GLYPH.flat, x + i * half * 1.9, s.bottom - step * half));
 ctx.textBaseline = 'alphabetic';
}

/** Width of the clef + key signature column for `fifths` accidentals. */
export const clefColumn = (half, fifths) => Math.round(half * 9 + Math.abs(fifths) * half * 1.9 + 10);

/** The note under (x, y), from the hit list drawStave returned. */
export function hitNote(hits, x, y) {
 let best = null;
 for (const hit of hits) {const d = Math.hypot(hit.x - x, hit.y - y); if (d <= hit.r + 3 && (!best || d < best.d)) best = {id: hit.id, d};}
 return best?.id ?? null;
}
