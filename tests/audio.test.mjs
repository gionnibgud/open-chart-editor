import test from 'node:test';
import assert from 'node:assert/strict';
import { midiFrequency, guideFrequency, speedAtTime, distanceAtTime, advanceTransport, granularSample, waveformPeaks, encodeWav, channelMatrix, AudioEngine } from '../src/audio.js';

test('pitch reference and independent ramp transport integration', () => {
  assert.equal(midiFrequency(69), 440);
  assert.equal(midiFrequency(81), 880);
  const ramp = { enabled: true, startSpeed: 0.5, endSpeed: 1, duration: 10 };
  assert.equal(speedAtTime(5, 1, ramp), 0.75);
  assert.equal(distanceAtTime(10, 1, ramp), 7.5);
  assert.equal(distanceAtTime(15, 1, ramp), 12.5);
  assert.equal(distanceAtTime(4, 0.25), 1);
});
test('transport loops preserve overshoot and clamp end of song', () => {
  assert.equal(advanceTransport(3, 10, { enabled: true, start: 2, end: 5 }), 4);
  assert.equal(advanceTransport(3, 10, null, 9), 9);
  assert.equal(advanceTransport(3, 1, { enabled: true, start: 2, end: 5 }), 4);
});
test('interpolated samples do not access outside the source', () => {
  const samples = new Float32Array([0, 1, 0, -1]);
  assert.equal(granularSample(samples, 0.5), 0.5);
  assert.equal(granularSample(samples, -1), 0);
  assert.equal(granularSample(samples, 4), 0);
});
test('editor transport runs without audio until a playback gesture', () => {
  const engine = new AudioEngine();
  engine.setProject({ duration: 10, arrangements: [] });
  engine.seek(3); assert.equal(engine.currentTime, 3);
  engine.setPitch(-12); engine.setSpeed(0.5);
  assert.equal(engine.pitch, -12); assert.equal(engine.speed, 0.5);
  engine.stop(); assert.equal(engine.currentTime, 0);
  assert.throws(() => engine.setGain('unknown', 1), /Unknown audio bus/);
});

function mockContext() {
  const sources = [], voices = [];
  const parameter = () => ({ value: 0, setTargetAtTime(value) {this.value=value;}, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setValueCurveAtTime(values,at,duration) { (this.curves??=[]).push({values:Float32Array.from(values),at,duration}); } });
  const node = () => ({ connect() {}, disconnect() {}, stop() { this.stopped = true; }, start(...args) { this.started = args; } });
  return {
    currentTime: 0, destination: {}, sources, voices, async resume() {}, async close() {},
    createStereoPanner() { return {...node(),pan:parameter()}; },
    createChannelSplitter() { return node(); },createChannelMerger() { return node(); },
    createBiquadFilter() { return {...node(),frequency:parameter(),Q:parameter(),gain:parameter()}; },
    createGain() { return { ...node(), gain: parameter() }; },
    createBufferSource() { const n = { ...node(), playbackRate: parameter() }; sources.push(n); return n; },
    createPeriodicWave(real,imag,options) { return {real,imag,options}; },
    createOscillator() { const n = { ...node(), frequency: parameter(), setPeriodicWave(wave) {this.wave=wave;} }; voices.push(n); return n; },
  };
}
test('scheduled song pitch is independent of transport speed and pause cancels sources', async () => {
  const context = mockContext(), engine = new AudioEngine({ context });
  engine.buffer = { duration: 20 };
  engine.speed = 0.5; engine.pitch = 12;
  await engine.play(2);
  try {
    assert.ok(context.sources.length >= 4);
    assert.equal(context.sources[0].playbackRate.value, 2);
    assert.ok(Math.abs(context.sources[1].started[1] - 2.01) < 1e-9);
    context.currentTime = engine.startedAt + 2;
    assert.equal(engine.currentTime, 3);
  } finally { engine.pause(); }
  assert.ok(context.sources.every(source => source.stopped));
  assert.equal(engine.currentTime, 3);
});
test('guide audition includes native chord templates and chart beat accents', async () => {
  const context = mockContext(), engine = new AudioEngine({ context });
  engine.setProject({ duration: 5, beats: [{ time: 0, measure: 1 }], arrangements: [{ type: 'guitar', stringCount: 6, basePitches: [40,45,50,55,59,64], notes: [], chord_templates: [{ frets: [0,2,-1,-1,-1,-1] }], chords: [{ time: 0, chord_id: 0 }] }] });
  engine.setGain('metronome',1);engine.setEnabled('metronome',true);
  await engine.play();
  try { context.voices.map(v=>v.frequency.value).forEach((value,i)=>assert.ok(Math.abs(value-[midiFrequency(88),midiFrequency(40),midiFrequency(47)][i])<1e-3)); }
  finally { engine.pause(); }
});
test('pause cancels playback pending browser audio permission', async () => {
  const context = mockContext(); let resumed;
  context.resume = () => new Promise(resolve => { resumed = resolve; });
  const engine = new AudioEngine({ context }); engine.buffer = { duration: 5 };
  const pending = engine.play();
  engine.pause(); resumed(); await pending;
  assert.equal(engine.isPlaying, false); assert.equal(context.sources.length, 0);
});
test('waveform takes per-bin absolute peaks across channels and stays bounded', () => {
  const data = [new Float32Array([0, 0.5, -0.9, 0]), new Float32Array([-1, 0, 0, 0.75])];
  const buffer = { numberOfChannels: 2, length: 4, getChannelData: channel => data[channel] };
  assert.deepEqual([...waveformPeaks(buffer, 2)], [1, Math.fround(0.9)]);
  assert.equal(waveformPeaks(buffer, 20000).length, 4);
  const large = { numberOfChannels: 1, length: 10000, getChannelData: () => new Float32Array(10000) };
  assert.equal(waveformPeaks(large).length, 4096);
});
test('original WAV encoder interleaves stereo PCM with standard headers', () => {
  const channels = [new Float32Array([-1, 1]), new Float32Array([0.5, -0.5])];
  const wav = encodeWav({ numberOfChannels: 2, length: 2, sampleRate: 48000, getChannelData: channel => channels[channel] });
  const view = new DataView(wav);
  assert.equal(new TextDecoder().decode(wav.slice(0, 4)), 'RIFF');
  assert.equal(view.getUint32(24, true), 48000); assert.equal(view.getUint16(22, true), 2);
  assert.deepEqual([44,46,48,50].map(offset => view.getInt16(offset, true)), [-32768,16384,32767,-16384]);
});
test('mixer mute/solo preserves desired faders and honors the master bus',async()=>{
 const context=mockContext(),engine=new AudioEngine({context});engine.setGain('song',.6);engine.setGain('guide',.4);engine.setGain('master',.5);await engine.init(false);
 engine.setMute('song',true);assert.equal(engine.getEffectiveGain('song'),0);assert.equal(engine.gains.song,.6);engine.setGain('song',.8);assert.equal(engine.getEffectiveGain('song'),0);engine.setMute('song',false);assert.equal(engine.getOutputGain('song'),.4);
 engine.setSolo('guide',true);assert.equal(engine.getEffectiveGain('song'),0);assert.equal(engine.getEffectiveGain('guide'),.4);engine.setSolo('song',true);assert.equal(engine.getEffectiveGain('song'),.8);
 engine.setMute('master',true);assert.equal(engine.getOutputGain('song'),0);assert.equal(engine.getOutputGain('guide'),0);engine.setMute('master',false);assert.equal(engine.getOutputGain('guide'),.2);assert.throws(()=>engine.setSolo('master',true),/Solo applies/);
});
test('routing toggles and mixer restoration never discard remembered metronome level',()=>{
 const engine=new AudioEngine();engine.setGain('metronome',.35);assert.equal(engine.getEffectiveGain('metronome'),0);engine.setEnabled('metronome',true);assert.equal(engine.getEffectiveGain('metronome'),.35);engine.setEnabled('metronome',false);assert.equal(engine.gains.metronome,.35);engine.setSolo('guide',true);engine.setMute('song',true);
 const saved=engine.getMixerState(),restored=new AudioEngine();restored.restoreMixerState(saved);assert.deepEqual(restored.getMixerState(),saved);saved.gains.song=0;assert.notEqual(restored.gains.song,0);
});
const decodedBuffer=duration=>({duration,sampleRate:8000,numberOfChannels:1,length:4,getChannelData:()=>new Float32Array([0,.5,-.5,0])});
test('newest decode wins over older buffers and resets invalidate pending results',async()=>{
 const context=mockContext(),pending=new Map();context.decodeAudioData=data=>new Promise(resolve=>pending.set(new Uint8Array(data)[0],resolve));const engine=new AudioEngine({context});
 const first=engine.loadArrayBuffer(new Uint8Array([1]).buffer);await Promise.resolve();const second=engine.loadArrayBuffer(new Uint8Array([2]).buffer);await Promise.resolve();pending.get(2)(decodedBuffer(2));await second;pending.get(1)(decodedBuffer(1));assert.equal((await first).stale,true);assert.equal(engine.audioDuration,2);
 const third=engine.loadArrayBuffer(new Uint8Array([3]).buffer);await Promise.resolve();engine.clearAudio();pending.get(3)(decodedBuffer(3));assert.equal((await third).stale,true);assert.equal(engine.buffer,null);assert.equal(engine.peaks,null);
});
test('slow file reads and disposal cannot resurrect stale audio or old decode errors',async()=>{
 const context=mockContext();let finishRead,rejectDecode;context.decodeAudioData=async()=>decodedBuffer(2);const engine=new AudioEngine({context});
 const oldFile=engine.loadFile({arrayBuffer:()=>new Promise(resolve=>{finishRead=resolve;})});await engine.loadArrayBuffer(new Uint8Array([2]).buffer);finishRead(new Uint8Array([1]).buffer);assert.equal((await oldFile).stale,true);assert.equal(engine.audioDuration,2);
 context.decodeAudioData=()=>new Promise((_,reject)=>{rejectDecode=reject;});const pending=engine.loadArrayBuffer(new Uint8Array([3]).buffer);await Promise.resolve();await engine.dispose();rejectDecode(Error('Closed old audio context'));assert.equal((await pending).stale,true);assert.equal(engine.context,null);
});

test('transcription routing cancels centered content and isolates stereo channels',async()=>{
 const apply=(mode,left,right)=>{const m=channelMatrix(mode);return [m[0]*left+m[1]*right,m[2]*left+m[3]*right];};
 assert.deepEqual(apply('center-cancel',.8,.8),[0,0]);assert.deepEqual(apply('left',.7,-.2),[.7,.7]);assert.deepEqual(apply('right',.7,-.2),[-.2,-.2]);assert.deepEqual(apply('stereo',.7,-.2),[.7,-.2]);
 const engine=new AudioEngine({context:mockContext()});engine.setSongFX({channel:'center-cancel',eq:[1,2,3,4,5]});await engine.init(false);
 assert.deepEqual(engine.songGraph.matrix.map(n=>n.gain.value),[.5,-.5,.5,-.5]);assert.deepEqual(engine.songGraph.filters.map(n=>n.gain.value),[1,2,3,4,5]);
 engine.setSongFX({bypass:true});assert.deepEqual(engine.songGraph.matrix.map(n=>n.gain.value),[1,0,0,1]);assert.deepEqual(engine.songGraph.filters.map(n=>n.gain.value),[0,0,0,0,0]);engine.setSongFX({bypass:false});assert.deepEqual(engine.songGraph.filters.map(n=>n.gain.value),[1,2,3,4,5]);
 assert.throws(()=>engine.setSongFX({channel:'invalid'}));assert.throws(()=>engine.setSongFX({eq:[NaN]}));
});
test('pan and transcription preferences survive session restore without changing source audio or export',async()=>{
 const buffer=decodedBuffer(3),engine=new AudioEngine({context:mockContext()});engine.buffer=buffer;const source=engine.exportWav();engine.setPan('song',-.7);engine.setPan('master',2);engine.setSongFX({preset:'bass',channel:'left'});await engine.init(false);
 assert.equal(engine.panners.song.pan.value,-.7);assert.equal(engine.pans.master,1);assert.deepEqual(engine.exportWav(),source);assert.equal(engine.buffer,buffer);
 const state=engine.getMixerState(),other=new AudioEngine();other.restoreMixerState(state);assert.deepEqual(other.getMixerState(),state);state.songFX.eq[0]=99;assert.notEqual(other.songFX.eq[0],99);
});
test('indexed guide scheduling uses half-open boundaries and invalidates after authoring edits',async()=>{
 const context=mockContext(),engine=new AudioEngine({context});let reads=0;const notes=Array.from({length:30000},(_,i)=>({id:'own'+i,time:i*.02,pitch:60+i%12,sustain:.3})),arr={type:'keys',chords:[],get notes(){reads++;return notes;}};engine.setProject({duration:600,beats:[]},arr);await engine.init(false);
 const events=[];engine.voice=(...args)=>events.push(args);engine.startedAt=0;engine.scheduleGuide(10,10.02,0,.02);engine.scheduleGuide(10.02,10.04,.02,.02);assert.equal(events.length,2);assert.equal(reads,1);assert.deepEqual(events.map(e=>e[0]),[68,69]);
 notes[500].pitch=90;engine.setProject({duration:600,beats:[]},arr);engine.scheduleGuide(10,10.02,.04,.02);assert.equal(events.at(-1)[0],90);assert.equal(reads,2);
});
test('indexed loop split schedules chord children and beat edges exactly once with ramp durations',async()=>{
 const context=mockContext(),engine=new AudioEngine({context});engine.setProject({duration:8,beats:[{time:2,measure:2},{time:4,measure:3}]},{type:'guitar',basePitches:[40,45],tuning:[0,0],capo:0,notes:[],chord_templates:[{frets:[2,4]}],chords:[{time:2,chord_id:0,notes:[]},{time:3.99,chord_id:0,notes:[{time:3.99,string:0,fret:3,sustain:.5}]}]});engine.setEnabled('metronome',true);await engine.init(false);engine.loop={start:2,end:4,enabled:true};engine.ramp={enabled:true,startSpeed:.5,endSpeed:1,duration:10};engine.startedAt=0;
 const events=[];engine.voice=(...args)=>events.push(args);engine.scheduleGuide(3.98,2.02,1,.04);assert.deepEqual(events.map(e=>e[0]),[43,88,42,49]);assert.equal(events.filter(e=>e[0]===88).length,1);assert.ok(events.every(e=>Number.isFinite(e[1])&&Number.isFinite(e[2])));
});

test('cent tuning scales guide frequencies exactly without changing MIDI identity or source playback pitch',async()=>{
 assert.equal(guideFrequency(69,1200),880);assert.equal(guideFrequency(69,-1200),220);const cents=1200*Math.log2(443/440);assert.ok(Math.abs(guideFrequency(69,cents)-443)<1e-10);
 const context=mockContext();context.sampleRate=48000;const engine=new AudioEngine({context});engine.pitch=12;engine.buffer={duration:4};engine.startedAt=0;engine.setProject({duration:4,beats:[{time:0,measure:1}]},{type:'keys',centOffset:1200,notes:[{time:0,pitch:69,sustain:1}],chords:[]});engine.setEnabled('metronome',true);await engine.init(false);engine.scheduleGuide(0,.02,0,.02);assert.deepEqual(context.voices.map(v=>v.frequency.value),[midiFrequency(88),1760]);engine.grain(0,0);assert.equal(context.sources[0].playbackRate.value,2);
});
test('cent overflow, malformed tuning and frequencies at Nyquist never create unsafe oscillators',async()=>{
 const context=mockContext();context.sampleRate=8000;const engine=new AudioEngine({context});await engine.init(false);
 for(const cents of [NaN,Infinity,-Infinity,'bad',1e308,-1e308]){engine.arrangement={type:'keys',centOffset:cents};assert.equal(engine.voice(69,0),null);}
 engine.arrangement={type:'keys',centOffset:0};assert.equal(engine.voice(127,0),null);assert.equal(context.voices.length,0);assert.equal(guideFrequency(69,0,880),0);assert.ok(guideFrequency(69,0,882)>0);
});

test('guide seek and loop restart resume bend position and clip voices at loop end',async()=>{
 const context=mockContext(),engine=new AudioEngine({context});engine.setProject({duration:3,beats:[]},{type:'keys',centOffset:0,notes:[{id:'held',time:0,pitch:69,sustain:2,techniques:{bend_values:[{t:0,v:0},{t:1,v:12}]}}],chords:[]});engine.loop={enabled:true,start:.5,end:1};await engine.play(.5);
 try{assert.equal(context.voices.length,1);const first=context.voices[0].frequency.curves[0];assert.ok(Math.abs(first.values[0]-guideFrequency(75))<.001);assert.ok(Math.abs(first.duration-.5)<1e-8);assert.equal(first.values.at(-1),880);engine.scheduleGuide(.99,.51,1,.02);assert.equal(context.voices.length,2);assert.ok(Math.abs(context.voices[1].frequency.curves[0].values[0]-guideFrequency(75))<.01);}finally{engine.pause();}
});
test('zero-velocity live guides do not leak an exponential-ramp tail',async()=>{const context=mockContext(),engine=new AudioEngine({context});await engine.init(false);assert.equal(engine.voice(69,0,1,'guide',0),null);assert.equal(context.voices.length,0);});

test('revision invalidation during decode retains the original backing buffer',async()=>{
 const context=mockContext(),engine=new AudioEngine({context});context.decodeAudioData=async()=>decodedBuffer(2);await engine.loadArrayBuffer(new ArrayBuffer(1));const original=engine.buffer;let resolve,current=true;context.decodeAudioData=()=>new Promise(r=>{resolve=r;});const pending=engine.loadArrayBuffer(new ArrayBuffer(1),{isCurrent:()=>current});await Promise.resolve();current=false;resolve(decodedBuffer(4));assert.equal((await pending).stale,true);assert.equal(engine.buffer,original);assert.equal(engine.audioDuration,2);
});


test('explicit guide families use shared band-limited harmonics while legacy voices retain their waveform', async()=>{
 const context=mockContext(),engine=new AudioEngine({context});context.sampleRate=48000;
 const arrangement={id:'keys',type:'piano',notes:[{id:'n',time:0,pitch:69,sustain:.4,velocity:100}],chords:[],guideVoice:{version:1,family:'piano',program:0}};
 engine.setProject({duration:1,beats:[],arrangements:[arrangement]});await engine.play();engine.pause();
 assert.ok(context.voices.length>0);const wave=context.voices[0].wave;assert.ok(wave);assert.deepEqual(wave.options,{disableNormalization:true});assert.equal(wave.imag[0],0);assert.ok(wave.imag[1]>wave.imag[2]);assert.ok(wave.real.every(value=>value===0));
 delete arrangement.guideVoice;engine.setProject({duration:1,beats:[],arrangements:[arrangement]});const prior=context.voices.length;await engine.play();engine.pause();assert.equal(context.voices[prior].wave,undefined);assert.equal(context.voices[prior].type,'triangle');
});
