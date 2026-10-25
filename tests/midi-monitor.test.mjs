import test from 'node:test';
import assert from 'node:assert/strict';
import {MidiRecorder,connectMidiInput,GM_DRUMS} from '../src/midi.js';
import {MidiAudition} from '../src/midi-audition.js';

test('audition has no authoring callback, clock access, quantization or source mutation across full MIDI range',()=>{
 const source={id:'own',type:'keys',centOffset:25,opaque:{kept:true},notes:[]},before=JSON.stringify(source),events=[];
 const monitor=new MidiRecorder({arrangement:source,getTime:()=>{throw Error('Audition must not read chart clock');},quantize:()=>{throw Error('No quantization');},onNote:()=>{throw Error('No source edit');},onAudition:event=>events.push(event)}).startAudition();
 for(const pitch of [0,1,60,126,127]){assert.equal(monitor.handleMessage([0x90,pitch,91]).status,'auditioned');monitor.handleMessage([0x80,pitch,0]);}
 monitor.handleMessage([0xb0,64,127]);monitor.handleMessage([0xb0,64,0]);monitor.stop();
 assert.equal(monitor.isRecording,false);assert.equal(monitor.isAuditioning,false);assert.equal(monitor.pendingCount,0);assert.equal(JSON.stringify(source),before);
 assert.equal(events.filter(e=>e.type==='noteon').length,5);assert.equal(events.find(e=>e.type==='noteon').velocity,91);assert.equal(events.filter(e=>e.type==='control').length,2);assert.equal(monitor.handleMessage([0x90,64,91]).status,'stopped');
});

test('drum monitor maps every GM alias and reports unmapped pads while record mode still captures exact hits',()=>{
 const source={id:'kit',type:'drums',notes:[]},events=[],issues=[],captured=[];let time=2;
 const monitor=new MidiRecorder({arrangement:source,getTime:()=>time,onNote:note=>captured.push(note),onAudition:e=>events.push(e),onUnmappable:e=>issues.push(e)}).startAudition();
 for(const [pitch,piece]of Object.entries(GM_DRUMS)){const result=monitor.handleMessage([0x99,Number(pitch),119]);assert.equal(result.piece,piece);assert.equal(events.at(-1).note.piece,piece);}
 assert.equal(monitor.handleMessage([0x99,70,88]).status,'unmappable');assert.match(issues[0].reason,/70/);assert.equal(captured.length,0);assert.deepEqual(source.notes,[]);
 monitor.start();monitor.handleMessage([0x99,36,105]);assert.equal(captured[0].piece,'kick');assert.equal(captured[0].velocity,105);assert.equal(captured[0].time,2);assert.equal(captured[0].sustain,0);
});

test('audition to recording separates state and recording preserves quantized sustain, velocity and hand',()=>{
 const source={id:'keys',type:'keys',notes:[]},captured=[];let time=.13;
 const input=new MidiRecorder({arrangement:source,getTime:()=>time,quantize:t=>Math.round(t*4)/4,onNote:n=>captured.push(n)}).startAudition();
 input.handleMessage([0x90,60,90]);time=.64;input.handleMessage([0x80,60,0]);assert.equal(captured.length,0);
 input.start();input.handleMessage([0x90,55,87]);time=1.14;input.handleMessage([0x80,55,0]);assert.equal(captured[0].time,.75);assert.equal(captured[0].sustain,.5);assert.equal(captured[0].hand,'lh');assert.equal(captured[0].velocity,87);
 input.startAudition();input.handleMessage([0x90,80,65]);input.stop();assert.equal(captured.length,1);
});

test('input selection, unplug and explicit disconnect release audition without creating chart notes',async()=>{
 const callbacks=new Map(),states=new Map();const port=id=>({id,state:'connected',open:async()=>{},close:async()=>{},addEventListener:(type,fn)=>callbacks.set(id,fn),removeEventListener:()=>callbacks.delete(id)}),a=port('a'),b=port('b'),access={inputs:new Map([['a',a],['b',b]]),addEventListener:(type,fn)=>states.set(type,fn),removeEventListener:type=>states.delete(type)},events=[],changes=[];
 const recorder=new MidiRecorder({arrangement:{id:'keys',type:'keys'},getTime:()=>{throw Error('No clock');},onNote:()=>{throw Error('No edits');},onAudition:e=>events.push(e)}).startAudition();
 const connected=await connectMidiInput(recorder,{requestAccess:async()=>access,onState:e=>changes.push(e)});
 callbacks.get('a')({data:[0x90,60,90]});await connected.selectInput('b');assert.equal(events.at(-1).type,'stop');assert.equal(callbacks.has('a'),false);
 callbacks.get('b')({data:[0x90,64,90]});b.state='disconnected';states.get('statechange')();assert.equal(events.at(-1).type,'stop');assert.equal(changes[0].type,'input-disconnected');connected.disconnect();assert.equal(recorder.isAuditioning,false);assert.equal(callbacks.size,0);
});

function context(){const nodes=[],parameter=()=>({value:0,setValueAtTime(v){this.value=v;},linearRampToValueAtTime(v){this.value=v;},setTargetAtTime(){},cancelScheduledValues(){}}),node=kind=>{const value={kind,connect(){},disconnect(){this.disconnected=true;},start(...args){this.started=args;},stop(){this.stopped=true;},gain:parameter(),frequency:parameter(),setPeriodicWave(){}};nodes.push(value);return value;};return {state:'running',sampleRate:48000,currentTime:1,nodes,createGain:()=>node('gain'),createWaveShaper:()=>node('guard'),createOscillator:()=>node('oscillator'),createPeriodicWave:()=>({}),createBuffer:(n,length,rate)=>({duration:length/rate,getChannelData:()=>new Float32Array(length)}),createBufferSource:()=>node('buffer')};}

test('original drum cue one-shots use mapped samples/velocity, ignore noteoff truncation and choke open hat',()=>{
 const c=context(),cue=new MidiAudition({getState:()=>({enabled:true})});cue.start({context:c,destination:{}});const event=pitch=>({type:'noteon',channel:9,pitch,velocity:90,arrangement:{type:'drums'}});
 assert.equal(cue.handle(event(46)).piece,'hh_open');const open=[...cue.owned][0];assert.equal(cue.handle({type:'noteoff',channel:9,pitch:46}).status,'percussion-one-shot');assert.equal(open.oscillator.stopped,undefined);
 assert.equal(cue.handle(event(42)).piece,'hh_closed');assert.equal(open.oscillator.stopped,true);assert.equal(cue.ownedCount,1);assert.equal(cue.handle(event(70)).status,'unmapped-drum');
 cue.stop();assert.equal(cue.ownedCount,0);assert.equal(cue.guard,null);assert.ok(c.nodes.every(node=>node.disconnected));
});
