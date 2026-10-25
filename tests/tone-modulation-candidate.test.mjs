import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {compileAdditionalModulation,ToneModulationRack} from '../src/tone-modulation.js';
const catalog=JSON.parse(await readFile(new URL('../assets/tone-rack-data.json',import.meta.url),'utf8')).gears;
function gear(key){const d=catalog.find(d=>d.key===key);return[d,{Key:key,KnobValues:Object.fromEntries(d.knobs.map(k=>[k.key,k.choices?k.min:(k.min+k.max)/2]))}];}
test('four newly covered gear mappings preserve exact fractional native controls and factual labels',()=>{
 for(const key of ['Pedal_AmpVibe','Pedal_MultiVibe','Rack_StereoAnalogVibe','Pedal_RingMod']){const[d,g]=gear(key),before=structuredClone(g),result=compileAdditionalModulation(g,d);assert.ok(result.effect);assert.deepEqual(g,before);assert.deepEqual(result.disclosure.unmappedControls,[]);}
 const[d,g]=gear('Pedal_RingMod');g.KnobValues.Pedal_RingMod_Attack=12.5;g.KnobValues.Pedal_RingMod_Depth=37.5;g.KnobValues.Pedal_RingMod_Sensitivity=66.25;const result=compileAdditionalModulation(g,d);assert.equal(result.effect.rate,80);assert.equal(result.effect.depth,.375);assert.equal(result.effect.mix,.6625);
 g.KnobValues.Pedal_RingMod_Waveform=.5;assert.equal(compileAdditionalModulation(g,d).effect,null);
});
class Node{constructor(){this.gain={value:0};this.frequency={value:0};this.connections=[];}connect(n){this.connections.push(n);}disconnect(){this.disconnected=true;this.connections=[];}start(){this.started=true;}stop(){this.stopped=true;}}
const context=()=>{const nodes=[];return{nodes,createGain(){const n=new Node();nodes.push(n);return n;},createOscillator(){const n=new Node();nodes.push(n);return n;},createWaveShaper(){const n=new Node();nodes.push(n);return n;}};};
test('shared carriers own bounded nodes and stop every oscillator on repeated disposal',()=>{
 const c=context();for(let i=0;i<100;i++){const rack=new ToneModulationRack(c,{kind:'tremolo',rate:2,depth:1,mix:.5,wave:i%5});assert.ok(rack.nodeCount<=8);assert.equal(rack.oscillators.length,1);assert.equal(rack.oscillators[0].started,true);rack.dispose();rack.dispose();assert.equal(rack.nodeCount,0);assert.equal(rack.oscillators.length,0);}assert.ok(c.nodes.every(n=>n.disconnected&&(!n.started||n.stopped)));
});
test('invalid modulation controls allocate no nodes',()=>{const c=context();for(const effect of [{kind:'ringmod',rate:Infinity,depth:1,mix:1,wave:0},{kind:'tremolo',rate:2,depth:1,mix:1,wave:1.5}])assert.throws(()=>new ToneModulationRack(c,effect));assert.equal(c.nodes.length,0);});
