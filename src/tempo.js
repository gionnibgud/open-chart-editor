// Original, offline beat-map helpers. Audio estimates are reviewable suggestions.
import { assertGrid } from './model.js';

const copy = beats => beats.map(beat => ({ ...beat }));
const finite = value => Number.isFinite(value);
const validBpm = bpm => { if (!(finite(bpm) && bpm >= 10 && bpm <= 500)) throw Error('Tempo must be between 10 and 500 BPM'); };

export function detectOnsets(buffer, { hopSeconds = 0.005, windowSeconds = 0.02, sensitivity = 0.12, minGap = 0.06 } = {}) {
  if (!buffer || !(buffer.sampleRate > 0) || !(buffer.numberOfChannels > 0) || !Number.isInteger(buffer.length)) throw Error('Decoded audio buffer required');
  if (![hopSeconds, windowSeconds, sensitivity, minGap].every(finite) || !(hopSeconds > 0 && windowSeconds >= hopSeconds && sensitivity > 0 && minGap >= 0)) throw Error('Invalid onset analysis options');
  const hop = Math.max(1, Math.round(buffer.sampleRate * hopSeconds)), count = Math.ceil(buffer.length / hop);
  const energy = new Float64Array(count), novelty = new Float64Array(count);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    for (let i = 0; i < samples.length; i++) energy[Math.floor(i / hop)] += samples[i] * samples[i] / hop;
  }
  const history = Math.max(1, Math.round(windowSeconds / hopSeconds)); let previous = 0, maximum = 0;
  for (let i = 0; i < count; i++) {
    novelty[i] = Math.max(0, energy[i] - previous / history);
    maximum = Math.max(maximum, novelty[i]);
    previous += energy[i] - (i >= history ? energy[i - history] : 0);
  }
  if (maximum < 1e-12) return [];
  const background = [...novelty].sort((a, b) => a - b)[Math.floor(count / 2)] || 0;
  const threshold = Math.max(maximum * sensitivity, background * 4), onsets = [];
  for (let i = 0; i < count; i++) {
    if (novelty[i] < threshold || novelty[i] < (novelty[i - 1] || 0) || novelty[i] <= (novelty[i + 1] || 0)) continue;
    const onset = { time: i * hop / buffer.sampleRate, strength: novelty[i] / maximum };
    const previousOnset = onsets.at(-1);
    if (previousOnset && onset.time - previousOnset.time < minGap) {
      if (onset.strength > previousOnset.strength) onsets[onsets.length - 1] = onset;
    } else onsets.push(onset);
  }
  return onsets;
}

export function suggestTempo(buffer, { minBpm = 50, maxBpm = 220, bpm = null, ...options } = {}) {
  validBpm(minBpm); validBpm(maxBpm); if (minBpm > maxBpm) throw Error('Minimum BPM exceeds maximum');
  if (bpm != null) validBpm(bpm);
  const onsets = detectOnsets(buffer, options), duration = buffer.length / buffer.sampleRate;
  if (onsets.length < 2) return { bpm: null, offset: null, confidence: 0, onsets, beats: [] };
  // Pairwise differences allow missing beats. Bound the candidate and scoring work.
  const sample = onsets.length > 2000 ? onsets.filter((_, i) => i % Math.ceil(onsets.length / 2000) === 0) : onsets;
  const histogram = new Map();
  if (bpm == null) for (let i = 0; i < sample.length; i++) for (let j = i + 1; j < Math.min(sample.length, i + 9); j++) {
    const distance = sample[j].time - sample[i].time;
    for (let beats = 1; beats <= 8; beats++) {
      const candidate = 60 * beats / distance;
      if (candidate < minBpm || candidate > maxBpm) continue;
      const key = Math.round(candidate * 10) / 10;
      histogram.set(key, (histogram.get(key) || 0) + Math.sqrt(sample[i].strength * sample[j].strength) / beats);
    }
  }
  const candidates = bpm != null ? [bpm] : [...histogram].sort((a, b) => b[1] - a[1]).slice(0, 80).map(([value]) => value);
  if (!candidates.length) return { bpm: null, offset: null, confidence: 0, onsets, beats: [] };
  const score = candidate => {
    const period = 60 / candidate, tolerance = Math.min(0.045, period * 0.12);
    let best = { score: -Infinity, offset: 0, coverage: 0 };
    for (const anchor of sample.slice(0, 32)) {
      const offset = ((anchor.time % period) + period) % period;
      let explained = 0, total = 0; const occupied = new Set();
      for (const onset of sample) {
        const index = Math.round((onset.time - offset) / period), residual = Math.abs(onset.time - offset - index * period);
        const weight = Math.sqrt(onset.strength); total += weight;
        if (residual < tolerance) { explained += weight * (1 - residual / tolerance); occupied.add(index); }
      }
      const expected = Math.max(1, Math.round((sample.at(-1).time - sample[0].time) / period) + 1);
      const coverage = Math.min(1, occupied.size / expected), value = 0.7 * explained / total + 0.3 * coverage;
      if (value > best.score) best = { score: value, offset, coverage };
    }
    return { ...best, bpm: candidate };
  };
  let best = candidates.map(score).sort((a, b) => b.score - a.score || a.bpm - b.bpm)[0];
  if (bpm == null) for (let candidate = Math.max(minBpm, best.bpm - 0.5), end = Math.min(maxBpm, best.bpm + 0.5); candidate <= end; candidate += 0.02) {
    const next = score(candidate); if (next.score > best.score) best = next;
  }
  const period = 60 / best.bpm, beats = [];
  for (let time = best.offset; time <= duration + 1e-8; time += period) beats.push({ time, measure: -1 });
  return { bpm: best.bpm, offset: best.offset, confidence: Math.max(0, Math.min(1, best.score)), onsets, beats: beats.length >= 2 ? setMeter(beats, 4, 4) : beats };
}

export function alignBeats(beats, onsets, { maxShift = 0.12, strengthWeight = 0.15, preserveAnchors = true } = {}) {
  assertGrid(beats); if (!(finite(maxShift) && maxShift >= 0)) throw Error('Invalid maximum alignment distance');
  const candidates = onsets.filter(onset => finite(onset.time) && onset.time >= 0).sort((a, b) => a.time - b.time), next = copy(beats);
  let cursor = 0;
  for (let i = 0; i < next.length; i++) {
    if (preserveAnchors && (beats[i].anchor || beats[i].locked)) continue;
    while (cursor < candidates.length && candidates[cursor].time < beats[i].time - maxShift) cursor++;
    let best = null, score = Infinity;
    for (let j = cursor; j < candidates.length && candidates[j].time <= beats[i].time + maxShift; j++) {
      const onset = candidates[j];
      if (i > 0 && onset.time <= next[i - 1].time || i < beats.length - 1 && onset.time >= beats[i + 1].time) continue;
      const value = Math.abs(onset.time - beats[i].time) - maxShift * strengthWeight * (onset.strength || 0);
      if (value < score) { best = onset; score = value; }
    }
    if (best) next[i].time = best.time;
  }
  assertGrid(next); return next;
}

export function fitAnchors(beats, anchors) {
  assertGrid(beats);
  if (!Array.isArray(anchors) || anchors.length < 2) throw Error('Choose at least two transient anchors');
  const ordered = anchors.map(anchor => ({ ...anchor })).sort((a, b) => a.index - b.index);
  for (let i = 0; i < ordered.length; i++) {
    const anchor = ordered[i], previous = ordered[i - 1];
    if (!Number.isInteger(anchor.index) || anchor.index < 0 || anchor.index >= beats.length || !finite(anchor.time) || anchor.time < 0 || previous && (anchor.index <= previous.index || anchor.time <= previous.time)) throw Error('Anchor indices and times must strictly increase');
  }
  const next = copy(beats), anchoredIndices = new Set(ordered.map(anchor => anchor.index)); let segment = 0;
  for (let index = 0; index < next.length; index++) {
    while (segment < ordered.length - 2 && index > ordered[segment + 1].index) segment++;
    const a = ordered[segment], b = ordered[segment + 1];
    next[index].time = a.time + (index - a.index) * (b.time - a.time) / (b.index - a.index);
    if (anchoredIndices.has(index)) next[index].anchor = true;
  }
  if (next[0].time < 0) throw Error('Anchor extrapolation would put a beat before audio start');
  assertGrid(next); return next;
}

function renumberMeters(beats) {
  let numerator = 4, denominator = 4, bar = 1, beatInBar = 0;
  return beats.map((beat, index) => {
    if (beat.meterStart || index === 0) {
      if (index > 0 && beatInBar !== 0) bar++;
      numerator = beat.numerator || numerator; denominator = beat.denominator || denominator; beatInBar = 0;
    }
    const next = { ...beat, numerator, denominator, bar, beat: beatInBar + 1, measure: beatInBar === 0 ? bar : -1 };
    beatInBar++;
    if (beatInBar === numerator) { bar++; beatInBar = 0; }
    return next;
  });
}

export function addBeat(beats, time) {
  assertGrid(beats); if (!(finite(time) && time >= 0) || beats.some(beat => Math.abs(beat.time - time) < 1e-6)) throw Error('Beat time must be distinct and nonnegative');
  const next = copy(beats); let index = next.findIndex(beat => beat.time > time); if (index < 0) index = next.length;
  next.splice(index, 0, { time, measure: -1 }); assertGrid(next); return renumberMeters(next);
}
export function removeBeat(beats, index) {
  assertGrid(beats); if (beats.length <= 2 || !Number.isInteger(index) || index < 0 || index >= beats.length) throw Error('Keep at least two beat markers');
  const next = copy(beats), [removed] = next.splice(index, 1);
  if (removed.meterStart && next[index]) { next[index].meterStart = true; next[index].numerator = removed.numerator; next[index].denominator = removed.denominator; }
  assertGrid(next); return renumberMeters(next);
}

export function rampGrid(beats, start, end, startBpm, endBpm) {
  assertGrid(beats); validBpm(startBpm); validBpm(endBpm);
  if (!(Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end < beats.length)) throw Error('Choose a valid beat range for the tempo ramp');
  const next = copy(beats), difference = endBpm - startBpm, positions=[0];
  for(let i=start;i<end;i++)positions.push(positions.at(-1)+4/(beats[i].denominator||4));
  const intervals=positions.at(-1);
  // Tempo varies linearly in musical beat position; integrate 60/BPM analytically.
  for (let index = start + 1; index <= end; index++) {
    const x = positions[index-start];
    const elapsed = Math.abs(difference) < 1e-9 ? 60 * x / startBpm : 60 * intervals / difference * Math.log((startBpm + difference * x / intervals) / startBpm);
    next[index].time = next[start].time + elapsed;
  }
  const displacement = next[end].time - beats[end].time;
  for (let index = end + 1; index < next.length; index++) next[index].time += displacement;
  assertGrid(next); return next;
}

export function setMeter(beats, numerator, denominator, startIndex = 0) {
  assertGrid(beats);
  if (!Number.isInteger(numerator) || numerator < 1 || numerator > 32 || ![1,2,4,8,16,32].includes(denominator) || !Number.isInteger(startIndex) || startIndex < 0 || startIndex >= beats.length) throw Error('Invalid time signature or start marker');
  const next = copy(beats); Object.assign(next[startIndex], { numerator, denominator, meterStart: true });
  return renumberMeters(next);
}
