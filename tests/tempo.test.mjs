import test from 'node:test';
import assert from 'node:assert/strict';
import { detectOnsets, suggestTempo, alignBeats, fitAnchors, addBeat, removeBeat, rampGrid, setMeter } from '../src/tempo.js';
test('quarter-note BPM remains correct through denominator changes within a ramp',()=>{const beats=Array.from({length:17},(_,i)=>({time:i*.5,measure:i%4===0?i/4+1:-1,denominator:i<8?4:8}));const flat=rampGrid(beats,0,16,120,120);assert.equal(flat[16].time,6);assert.equal(flat[1].time,.5);assert.equal(flat[9].time-flat[8].time,.25);const rising=rampGrid(beats,0,16,120,240);assert.ok(Math.abs(rising[16].time-6*Math.log(2))<1e-12);});

const grid = (count = 17, spacing = 0.5) => Array.from({ length: count }, (_, i) => ({ time: i * spacing, measure: i % 4 === 0 ? i / 4 + 1 : -1 }));
function impulses(times, duration = 12, rate = 8000) {
  const samples = new Float32Array(duration * rate);
  for (const time of times) for (let n = 0; n < rate * 0.008; n++) {
    const index = Math.round(time * rate) + n;
    if (index < samples.length) samples[index] = (1 - n / (rate * 0.008)) * (n % 2 ? -1 : 1);
  }
  // Antiphase stereo must survive analysis without cancellation.
  return { sampleRate: rate, length: samples.length, numberOfChannels: 2, getChannelData: channel => channel ? samples.map(n => -n) : samples };
}

test('transient detection locates original antiphase stereo impulses and silence', () => {
  const times = [0.123,0.623,1.123,1.623], onsets = detectOnsets(impulses(times, 2));
  assert.equal(onsets.length, times.length);
  onsets.forEach((onset, index) => assert.ok(Math.abs(onset.time - times[index]) < 0.01));
  assert.deepEqual(detectOnsets(impulses([], 1)), []);
});
test('bounded tempo suggestion recovers tempo and offset with missing beats', () => {
  const times = Array.from({ length: 23 }, (_, i) => 0.143 + i * 0.5).filter((_, i) => ![7,15].includes(i));
  const result = suggestTempo(impulses(times), { minBpm: 70, maxBpm: 180 });
  assert.ok(Math.abs(result.bpm - 120) < 0.3, `Estimated ${result.bpm}`);
  assert.ok(Math.abs(result.offset - 0.143) < 0.01);
  assert.ok(result.confidence > 0.85);
  const fixed = suggestTempo(impulses(times), { bpm: 120 });
  assert.equal(fixed.bpm, 120); assert.ok(fixed.beats.length > 20);
});
test('manual transient anchors fit variable spacing without changing source arrays', () => {
  const source = grid(9), fitted = fitAnchors(source, [{ index: 0, time: 0.1 },{ index: 4, time: 2.1 },{ index: 8, time: 5.1 }]);
  assert.ok(Math.abs(fitted[2].time - 1.1) < 1e-9);
  assert.ok(Math.abs(fitted[6].time - 3.6) < 1e-9);
  assert.equal(source[0].time, 0); assert.equal(fitted[4].anchor, true);
  assert.throws(() => fitAnchors(source,[{index:2,time:0},{index:4,time:1}]), /before audio start/);
});
test('alignment respects locked anchors and cannot collapse adjacent beats', () => {
  const source = grid(5); source[1].locked = true;
  const result = alignBeats(source, [{time:0.03,strength:1},{time:0.55,strength:1},{time:1.08,strength:1},{time:1.49,strength:1}], {maxShift:0.15});
  assert.equal(result[0].time, 0.03); assert.equal(result[1].time, 0.5); assert.equal(result[2].time, 1.08);
  const cramped = alignBeats(grid(4, 0.05), [{time:0.05,strength:1}], {maxShift:1});
  assert.ok(cramped.every((beat, i) => !i || beat.time > cramped[i-1].time));
});
test('analytic tempo ramp accelerates continuously and preserves following intervals', () => {
  const source = grid(13), next = rampGrid(source, 2, 10, 60, 180);
  const gaps = next.slice(3,11).map((beat, i) => beat.time - next[i+2].time);
  assert.ok(gaps.every((gap, i) => !i || gap < gaps[i-1]));
  assert.ok(Math.abs((next[10].time - next[2].time) - 4*Math.log(3)) < 1e-9);
  assert.equal(next[12].time - next[11].time, 0.5);
  assert.deepEqual(rampGrid(source,0,12,120,120),source);
});
test('meter changes number bars and denominator pulses while marker edits keep order', () => {
  let beats = setMeter(grid(15),3,4);
  assert.deepEqual(beats.filter(beat => beat.measure >= 0).map(beat => beat.measure),[1,2,3,4,5]);
  beats = setMeter(beats,6,8,6);
  assert.equal(beats[6].bar,3); assert.equal(beats[6].beat,1); assert.equal(beats[11].beat,6); assert.equal(beats[12].bar,4);
  assert.equal(beats[10].denominator,8);
  beats = addBeat(beats,0.25); assert.equal(beats[1].time,0.25);
  beats = removeBeat(beats,1); assert.equal(beats[1].time,0.5);
  assert.throws(()=>addBeat(beats,0.5),/distinct/);assert.throws(()=>removeBeat(grid(2),0),/at least two/);
  assert.throws(()=>setMeter(beats,4,3),/Invalid time signature/);
});
