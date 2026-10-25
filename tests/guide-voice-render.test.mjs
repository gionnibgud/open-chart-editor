import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {renderGuide} from '../src/render-guide.js';
import {practiceDTO} from '../src/render-controller.js';
import {guidePlan,guideTables} from '../src/guide-synthesis.js';
import {GUIDE_VOICE_FAMILIES,guideVoiceSetting} from '../src/guide-voice.js';
function fixture(){return {duration:.5,arrangements:[{type:'keys',stringCount:6,capo:0,centOffset:0,basePitches:[],tuning:[0,0,0,0,0,0],notes:[{time:.05,pitch:69,sustain:.35,velocity:100,techniques:{bend_values:[{t:0,v:0},{t:.2,v:2}],vibrato:80}}],chords:[],chord_templates:[],tones:{base:'Legacy clean',changes:[{time:.1,name:'Legacy lead'}]}}]};}
const digest=bytes=>createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
test('legacy default output stays byte exact against separately captured pre-feature installed renderer',()=>{
 // Own fixture above was rendered through the separately installed old plugin
 // before this feature. No source music/native payload is embedded in this test.
 assert.equal(digest(renderGuide(fixture(),{sampleRate:8000})),'1c1a56bb36a5a5a0470db9d96c2c03e475ec90ce910bead716c8f88d979c5039');
});
test('all explicit families produce distinct bounded original WAVs and minimal DTO is byte-identical',()=>{
 const hashes=new Set();
 for(const family of GUIDE_VOICE_FAMILIES){
  const p=fixture(),a=p.arrangements[0];a.guideVoice=guideVoiceSetting(family.id);const before=structuredClone(p),wav=renderGuide(p,{sampleRate:8000}),dto=practiceDTO(p);
  assert.deepEqual(renderGuide(dto,{sampleRate:8000}),wav);assert.deepEqual(p,before);hashes.add(digest(wav));
  const v=new DataView(wav);let peak=0,energy=0;for(let i=44;i<wav.byteLength;i+=2){const sample=v.getInt16(i,true)/32768;peak=Math.max(peak,Math.abs(sample));energy+=sample*sample;}
  assert.ok(peak>0&&peak<.2&&energy>0);assert.equal(/rigs|definitions|Legacy|tone/.test(JSON.stringify(dto)),false);
 }
 assert.equal(hashes.size,16);
});
test('native GM timeline and silent source reproduce exactly across resolved worker DTO without raw rig data',()=>{
 const p=fixture(),a=p.arrangements[0];a.notes.push({...structuredClone(a.notes[0]),time:.3,sustain:.1});a.tones={base:'Own',base_rig:'a',changes:[{time:.25,name:'Own new',rig:'b'}]};p.audio={private:'never transfer'};p._pack={entries:{'rigs.json':'private base64'}};
 const rigLibrary={rigs:[{id:'a',blocks:[{role:'source',intent:{gm:{program:0}},realizations:[{engine:'soundfont',ref:'https://not-used.invalid/private.sf2'}]}]},{id:'b',blocks:[{role:'source',intent:{gm:{program:73}}}]}]},before=structuredClone({p,rigLibrary});
 const dto=practiceDTO(p,{rigLibrary});assert.deepEqual(renderGuide(dto,{sampleRate:8000}),renderGuide(p,{sampleRate:8000,rigLibrary}));assert.equal(/private|sf2|soundfont|base64|http/.test(JSON.stringify(dto)),false);assert.deepEqual({p,rigLibrary},before);
 rigLibrary.rigs[0].blocks[0].bypassed=true;rigLibrary.rigs[1].blocks[0].bypassed=true;assert.ok(new Uint8Array(renderGuide(p,{sampleRate:8000,rigLibrary}),44).every(byte=>byte===0));
});
test('explicit profiles preserve zero velocity, quiet extreme pitches and bend/mute behavior without rewriting source',()=>{
 for(const family of ['piano','strings','brass','pipe']){
  const p=fixture(),a=p.arrangements[0];a.guideVoice=guideVoiceSetting(family);a.notes[0].velocity=0;assert.ok(new Uint8Array(renderGuide(p,{sampleRate:8000}),44).every(byte=>byte===0));
  a.notes[0].velocity=100;a.notes[0].pitch=127;assert.ok(new Uint8Array(renderGuide(p,{sampleRate:8000}),44).every(byte=>byte===0));
  a.notes[0].pitch=69;const before=structuredClone(p),n=a.notes[0],plain=guidePlan(a,n);assert.equal(plain.pitchAt(.1),70+80/255*.25*Math.sin(2*Math.PI*5.5*.1));n.techniques.palm_mute=true;assert.ok(guidePlan(a,n).gainAt(.15)<plain.gainAt(.15));delete n.techniques.palm_mute;assert.deepEqual(p,before);
  const resumed=guideTables(plain,{duration:.1,offset:.2});assert.equal(resumed.gains[0],0);assert.equal(resumed.audible,true);
 }
});
test('band-limited explicit profile does not fold above-Nyquist upper harmonics into rendered guide',()=>{
 const p=fixture(),a=p.arrangements[0];p.duration=1;a.guideVoice=guideVoiceSetting('brass');a.notes=[{time:0,pitch:100,sustain:.9,velocity:100,techniques:{}}];const wav=renderGuide(p,{sampleRate:8000}),v=new DataView(wav),frequency=440*2**((100-69)/12),alias=8000-2*frequency;
 const power=hz=>{let re=0,im=0;for(let i=800;i<6400;i++){const x=v.getInt16(44+i*4,true);re+=x*Math.cos(2*Math.PI*hz*i/8000);im+=x*Math.sin(2*Math.PI*hz*i/8000);}return Math.hypot(re,im);};assert.ok(power(alias)/power(frequency)<.02);
});
