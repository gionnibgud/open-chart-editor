import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {compileBitCrusher,BitCrusherProcessor} from '../src/tone-crusher.js';
const catalog=JSON.parse(await readFile(new URL('../assets/tone-rack-data.json',import.meta.url),'utf8')).gears,definition=catalog.find(g=>g.key==='Pedal_BitCruncher');
const effect={kind:'crusher',bits:8,holdFrames:1,filterHz:18000,rectify:0,mix:1};const signal=()=>Float32Array.from({length:4096},(_,i)=>.4*Math.sin(2*Math.PI*440*i/48000));
function run(core,input){const out=input.map(a=>new Float32Array(a.length));core.process(input,out);return out;}
test('misleading native keys follow factual labels; continuous source values survive audition-only quantization',()=>{
 const gear={Key:definition.key,KnobValues:Object.fromEntries(definition.knobs.map(k=>[k.key,(k.min+k.max)/2]))};gear.KnobValues.Pedal_BitCruncher_FilterType=2.75;gear.KnobValues.Pedal_BitCruncher_Release=12.25;const before=structuredClone(gear),result=compileBitCrusher(gear,definition);assert.equal(result.effect.bits,3);assert.equal(result.effect.holdFrames,13);assert.deepEqual(gear,before);
 gear.KnobValues.Pedal_BitCruncher_Sens=Infinity;assert.equal(compileBitCrusher(gear,definition).effect,null);
});
test('2-bit conversion measurably changes signal more than 8-bit and preserves exact silence',()=>{
 const input=signal(),out8=run(new BitCrusherProcessor(effect,{channels:1}),[input])[0],out2=run(new BitCrusherProcessor({...effect,bits:2},{channels:1}),[input])[0],error=a=>Math.sqrt(a.reduce((n,v,i)=>n+(v-input[i])**2,0)/a.length);assert.ok(error(out2)>error(out8)*3);assert.deepEqual(input,signal());assert.equal(run(new BitCrusherProcessor(effect,{channels:1}),[new Float32Array(4096)])[0].some(v=>v!==0),false);
});
test('sample hold and filter state persist across non-divisible block boundaries and reset',()=>{
 const input=signal(),a=new BitCrusherProcessor({...effect,holdFrames:33},{channels:1}),b=new BitCrusherProcessor({...effect,holdFrames:33},{channels:1}),whole=run(a,[input])[0],parts=new Float32Array(input.length);for(let i=0;i<input.length;i+=64)parts.set(run(b,[input.slice(i,i+64)])[0],i);assert.deepEqual(parts,whole);b.reset();assert.deepEqual(run(b,[input])[0],whole);
});
test('shared sample clock preserves stereo polarity; intentional rectify collapses opposite polarity',()=>{
 const input=signal(),negative=Float32Array.from(input,v=>-v),stereo=run(new BitCrusherProcessor({...effect,holdFrames:7}),[input,negative]);assert.ok(stereo[0].every((v,i)=>v===-stereo[1][i]));const rectified=run(new BitCrusherProcessor({...effect,rectify:1}),[input,negative]);assert.deepEqual(rectified[0],rectified[1]);
});
test('nonfinite input is sanitized, output bounded, configuration and aliasing rejected',()=>{
 const p=new BitCrusherProcessor(effect,{channels:1}),input=Float32Array.from([NaN,Infinity,-Infinity,1e30,-1e30,0]),out=run(p,[input])[0];assert.ok(out.every(Number.isFinite));assert.ok(out.every(v=>Math.abs(v)<=8));assert.equal(p.invalidSamples,3);assert.throws(()=>p.process([input],[input]));assert.throws(()=>new BitCrusherProcessor({...effect,holdFrames:0}));assert.throws(()=>new BitCrusherProcessor({...effect,bits:2.5}));assert.throws(()=>new BitCrusherProcessor({...effect,mix:NaN}));
});
