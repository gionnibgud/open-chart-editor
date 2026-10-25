import test from 'node:test';
import assert from 'node:assert/strict';
import {makeArrangement,notePitch} from '../src/model.js';
import {MidiRecorder,midiRealization,connectMidiInput} from '../src/midi.js';
function setup(type='keys',count=null){let now=0;const notes=[],issues=[],arrangement=makeArrangement(type,count);const recorder=new MidiRecorder({arrangement,getTime:()=>now,onNote:note=>notes.push(note),onUnmappable:issue=>issues.push(issue)});return {recorder,notes,issues,arrangement,time:value=>{now=value;}};}
test('overlapping same-pitch channels and zero-velocity noteoff retain independent times',()=>{
 const s=setup();s.time(1);s.recorder.handleMessage([0x90,60,100]);s.time(1.25);s.recorder.handleMessage([0x91,60,80]);
 s.time(1.5);s.recorder.handleMessage([0x90,60,0]);s.time(2);s.recorder.handleMessage([0x81,60,0]);
 assert.deepEqual(s.notes.map(n=>[n.time,n.sustain,n.velocity,n.midi.channel]),[[1,.5,100,0],[1.25,.75,80,1]]);assert.equal(s.recorder.pendingCount,0);
});
test('sustain pedal delays only released notes and all-notes-off flushes one channel',()=>{
 const s=setup();s.recorder.handleMessage([0xb0,64,127]);s.recorder.handleMessage([0x90,55,90]);s.time(.4);s.recorder.handleMessage([0x80,55,0]);assert.equal(s.notes.length,0);
 s.time(.5);s.recorder.handleMessage([0x90,60,100]);s.time(1);s.recorder.handleMessage([0xb0,64,0]);assert.equal(s.notes[0].sustain,1);assert.equal(s.notes[0].hand,'lh');assert.equal(s.recorder.pendingCount,1);
 s.time(1.2);s.recorder.handleMessage([0x91,72,70]);s.time(2);s.recorder.handleMessage([0xb0,123,0]);assert.equal(s.recorder.pendingCount,1);assert.equal(s.notes[1].pitch,60);s.recorder.stop();assert.equal(s.notes.length,3);
});
test('fretted realizations respect extended strings, tuning, capo and occupied voices',()=>{
 const s=setup('guitar',8);s.arrangement.tuning[0]=-2;s.arrangement.capo=1;
 const result=midiRealization(s.arrangement,29);assert.equal(result.lane,0);assert.equal(result.fret,0);
 s.recorder.handleMessage([0x90,29,95]);s.time(.5);s.recorder.handleMessage([0x80,29,0]);assert.equal(notePitch(s.arrangement,s.notes[0]),29);assert.equal(s.notes[0].midi.pitch,29);assert.equal(s.notes[0].pitch,undefined);
 const guitar=makeArrangement('guitar'),occupied=midiRealization(guitar,64,{occupiedStrings:[5]});assert.notEqual(occupied.lane,5);assert.equal(notePitch(guitar,{string:occupied.lane,fret:occupied.fret}),64);
 assert.equal(s.recorder.handleMessage([0x90,10,90]).status,'unmappable');assert.equal(s.issues.length,1);
});

test('capo recording cannot create frets above the physical24 limit, including extended layouts',()=>{
 for(const [type,count]of [['guitar',6],['guitar',7],['guitar',8],['bass',4],['bass',5]]){
  const a=makeArrangement(type,count);for(let capo=0;capo<=24;capo++){a.capo=capo;for(let pitch=0;pitch<=127;pitch++){const result=midiRealization(a,pitch);if(result.ok){assert.ok(result.fret>=0&&result.fret+capo<=24,`${type}${count} capo${capo} pitch${pitch}`);assert.equal(notePitch(a,{string:result.lane,fret:result.fret}),pitch);}}}
 }
 const a=makeArrangement('guitar');a.capo=12;assert.equal(midiRealization(a,76,{occupiedStrings:[1,2,3,4,5]}).ok,false);assert.equal(midiRealization(a,64,{occupiedStrings:[1,2,3,4,5]}).fret,12);
 a.maxFret=8;assert.equal(midiRealization(a,61,{occupiedStrings:[1,2,3,4,5]}).ok,false);assert.equal(midiRealization(a,60,{occupiedStrings:[1,2,3,4,5]}).fret,8);
 for(const capo of [-1,25,NaN]){a.capo=capo;assert.equal(midiRealization(a,64).ok,false);}
});

test('recording rejects an above-neck pitch before adding a held voice, then records the legal top fret',()=>{
 const s=setup('guitar');s.arrangement.capo=12;assert.equal(s.recorder.handleMessage([0x90,100,96]).status,'unmappable');assert.equal(s.recorder.pendingCount,0);assert.equal(s.notes.length,0);assert.equal(s.issues.length,1);
 assert.equal(s.recorder.handleMessage([0x90,88,96]).status,'note-on');s.time(.5);s.recorder.handleMessage([0x80,88,0]);assert.equal(s.notes.length,1);assert.equal(s.notes[0].fret,12);assert.equal(notePitch(s.arrangement,s.notes[0]),88);
});
test('GM drums preserve canonical kit pieces and velocity with zero-length hits',()=>{
 const s=setup('drums');s.time(.25);s.recorder.handleMessage([0x99,36,119]);s.recorder.handleMessage([0x99,49,85]);
 assert.deepEqual(s.notes.map(note=>[note.piece,note.velocity,note.sustain]),[['kick',119,0],['crash_l',85,0]]);assert.equal(s.recorder.pendingCount,0);assert.equal(s.recorder.handleMessage([0x99,70,80]).status,'unmappable');
});
test('same-key retriggers use FIFO release and stopped recorder ignores messages',()=>{
 const s=setup();s.recorder.handleMessage([0x90,60,90]);s.time(.1);s.recorder.handleMessage([0x90,60,100]);s.time(.2);s.recorder.handleMessage([0x80,60,0]);s.time(.4);s.recorder.stop();
 assert.equal(s.notes[0].sustain,.2);assert.ok(Math.abs(s.notes[1].sustain-.3)<1e-9);assert.equal(s.recorder.handleMessage([0x90,62,90]).status,'stopped');s.recorder.start();assert.equal(s.recorder.isRecording,true);
});
test('quantized arbitrary-instrument notes and backwards transport remain finite',()=>{
 const s=setup();s.arrangement.type='violin';s.recorder.quantize=time=>Math.round(time*4)/4;
 s.time(.13);s.recorder.handleMessage([0x90,69,87]);s.time(.64);s.recorder.handleMessage([0x80,69,0]);
 assert.equal(s.notes[0].pitch,69);assert.equal(notePitch(s.arrangement,s.notes[0]),69);assert.equal(s.notes[0].time,.25);assert.equal(s.notes[0].sustain,.5);
 s.time(3);s.recorder.handleMessage([0x90,72,90]);s.time(3.5);s.recorder.handleMessage([0xb0,1,0]);s.time(1);s.recorder.handleMessage([0x80,72,0]);
 assert.equal(s.notes[1].sustain,.5);assert.equal(s.issues[0].status,'transport-moved');assert.equal(s.recorder.pendingCount,0);
});
function fakeInput(id){const listeners=new Map();return {id,name:`Controller ${id}`,manufacturer:'Original test',state:'connected',openCount:0,closeCount:0,async open(){this.openCount++;},async close(){this.closeCount++;},addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:(type,fn)=>{if(listeners.get(type)===fn)listeners.delete(type);},emit:data=>listeners.get('midimessage')?.({data}),get listenerCount(){return listeners.size;}};}
test('explicit MIDI access selects devices, flushes on disconnect and removes listeners',async()=>{
 const s=setup(),a=fakeInput('a'),b=fakeInput('b'),listeners=new Map(),access={inputs:new Map([['a',a],['b',b]]),addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type)};let requests=0;
 const connection=await connectMidiInput(s.recorder,{requestAccess:async options=>{requests++;assert.deepEqual(options,{sysex:false});return access;}});
 assert.equal(requests,1);assert.equal(connection.inputs.length,2);a.emit([0x90,64,90]);s.time(.5);await connection.selectInput('b');assert.equal(s.notes[0].sustain,.5);assert.equal(a.listenerCount,0);
 b.emit([0x90,67,80]);s.time(1);b.state='disconnected';listeners.get('statechange')();assert.equal(s.recorder.pendingCount,0);assert.equal(b.listenerCount,0);assert.equal(connection.inputs.length,1);
 connection.disconnect();assert.equal(listeners.size,0);assert.equal(s.recorder.isRecording,false);await assert.rejects(connection.selectInput('a'),/closed/);
});
test('stale repeated device opens cannot close the newest selection of the same controller',async()=>{
 const s=setup(),input=fakeInput('race'),access={inputs:new Map(),addEventListener(){},removeEventListener(){}};
 const connection=await connectMidiInput(s.recorder,{requestAccess:async()=>access});access.inputs.set(input.id,input);
 const resolves=[];input.open=()=>new Promise(resolve=>resolves.push(resolve));const old=connection.selectInput('race'),latest=connection.selectInput('race');
 assert.equal(resolves.length,1);resolves[0]();await latest;await old;assert.equal(connection.selectedInputId,'race');assert.equal(input.listenerCount,1);assert.equal(input.closeCount,0);connection.disconnect();
});
function sharedPort(id='shared'){
 const listeners=new Set();return{id,name:'Own '+id,state:'connected',openCount:0,closeCount:0,async open(){this.openCount++;},async close(){this.closeCount++;},addEventListener(type,fn){if(type==='midimessage')listeners.add(fn);},removeEventListener(type,fn){if(type==='midimessage')listeners.delete(fn);},emit(data){for(const fn of listeners)fn({data});},get listenerCount(){return listeners.size;}};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function sharedAccess(inputs){const states=new Set();return{inputs:new Map(inputs.map(i=>[i.id,i])),addEventListener:(type,fn)=>states.add(fn),removeEventListener:(type,fn)=>states.delete(fn),get listenerCount(){return states.size;}};}
test('two connections lease one MIDIInput; old disconnect removes only own listener and final owner alone closes',async()=>{
 const port=sharedPort(),access=sharedAccess([port]),a=setup(),b=setup();const first=await connectMidiInput(a.recorder,{requestAccess:async()=>access}),second=await connectMidiInput(b.recorder,{requestAccess:async()=>access});assert.equal(port.openCount,1);assert.equal(port.listenerCount,2);first.disconnect();await settle();assert.equal(port.closeCount,0);assert.equal(port.listenerCount,1);port.emit([0x90,60,99]);assert.equal(a.recorder.pendingCount,0);assert.equal(b.recorder.pendingCount,1);second.disconnect();await settle();assert.equal(port.closeCount,1);assert.equal(port.listenerCount,0);assert.equal(access.listenerCount,0);
});
test('shared pending open is deduplicated and late old mount release cannot close newer mounted owner',async()=>{
 const port=sharedPort(),access=sharedAccess([port]);let resolve;port.open=()=>{port.openCount++;return new Promise(r=>resolve=r);};const first=connectMidiInput(setup().recorder,{requestAccess:async()=>access}),second=connectMidiInput(setup().recorder,{requestAccess:async()=>access});await settle();assert.equal(port.openCount,1);resolve();const [old,newer]=await Promise.all([first,second]);old.disconnect();await settle();assert.equal(port.closeCount,0);assert.equal(newer.selectedInputId,port.id);assert.equal(port.listenerCount,1);newer.disconnect();await settle();assert.equal(port.closeCount,1);
});
test('stale selection releases its pending lease without closing another connection using that input',async()=>{
 const port=sharedPort('a'),other=sharedPort('b'),access=sharedAccess([]),owner=await connectMidiInput(setup().recorder,{requestAccess:async()=>access});access.inputs.set(port.id,port);access.inputs.set(other.id,other);let finish;port.open=()=>{port.openCount++;return new Promise(r=>finish=r);};const stale=owner.selectInput('a'),newMount=connectMidiInput(setup().recorder,{requestAccess:async()=>sharedAccess([port])});await settle();await owner.selectInput('b');finish();await stale;const mounted=await newMount;await settle();assert.equal(port.closeCount,0);assert.equal(owner.selectedInputId,'b');assert.equal(mounted.selectedInputId,'a');assert.equal(port.listenerCount,1);mounted.disconnect();owner.disconnect();await settle();assert.equal(port.closeCount,1);assert.equal(other.closeCount,1);
});
test('failed shared open rejects every waiter and retry can acquire normally without stale lease/listener',async()=>{
 const port=sharedPort(),access=sharedAccess([port]);let reject;port.open=()=>{port.openCount++;return new Promise((r,j)=>reject=j);};const waits=[connectMidiInput(setup().recorder,{requestAccess:async()=>access}),connectMidiInput(setup().recorder,{requestAccess:async()=>access})];await settle();reject(Error('Own open denial'));const results=await Promise.allSettled(waits);assert.ok(results.every(x=>x.status==='rejected'));assert.equal(port.openCount,1);assert.equal(port.closeCount,0);assert.equal(port.listenerCount,0);assert.equal(access.listenerCount,0);port.open=async()=>{port.openCount++;};const recovered=await connectMidiInput(setup().recorder,{requestAccess:async()=>access});assert.equal(port.openCount,2);recovered.disconnect();await settle();assert.equal(port.closeCount,1);
});
test('new owner waits for pending final close before reopening; old close cannot shut new selection',async()=>{
 const port=sharedPort(),access=sharedAccess([port]),first=await connectMidiInput(setup().recorder,{requestAccess:async()=>access});let finishClose;port.close=()=>{port.closeCount++;return port.closeCount===1?new Promise(r=>finishClose=r):Promise.resolve();};first.disconnect();await settle();const next=connectMidiInput(setup().recorder,{requestAccess:async()=>access});await settle();assert.equal(port.openCount,1);finishClose();const second=await next;assert.equal(port.openCount,2);assert.equal(second.selectedInputId,port.id);assert.equal(port.listenerCount,1);second.disconnect();await settle();assert.equal(port.closeCount,2);
});
test('canceled pending open with no owners closes after fulfillment; repeated selected input never reopens',async()=>{
 const port=sharedPort(),access=sharedAccess([]),connection=await connectMidiInput(setup().recorder,{requestAccess:async()=>access});access.inputs.set(port.id,port);let finish;port.open=()=>{port.openCount++;return new Promise(r=>finish=r);};const opening=connection.selectInput(port.id);connection.disconnect();finish();await opening;await settle();assert.equal(port.closeCount,1);assert.equal(port.listenerCount,0);port.open=async()=>{port.openCount++;};const next=await connectMidiInput(setup().recorder,{requestAccess:async()=>access});await next.selectInput(port.id);assert.equal(port.openCount,2);assert.equal(port.closeCount,1);next.disconnect();await settle();assert.equal(port.closeCount,2);
});
test('disconnect cleanup survives recorder stop error and native close rejection has no unhandled promise',async()=>{
 const port=sharedPort(),access=sharedAccess([port]),s=setup(),connection=await connectMidiInput(s.recorder,{requestAccess:async()=>access}),unhandled=[];const handler=e=>unhandled.push(e);process.on('unhandledRejection',handler);try{port.close=async()=>{port.closeCount++;throw Error('Own close failure');};s.recorder.stop=()=>{throw Error('Own recording stop failure');};assert.throws(()=>connection.disconnect(),/Own recording/);await settle();await settle();assert.equal(port.listenerCount,0);assert.equal(access.listenerCount,0);assert.equal(port.closeCount,1);assert.deepEqual(unhandled,[]);}finally{process.off('unhandledRejection',handler);}
});
test('additive controller/flush callbacks precede source callbacks and existing noteoffs without affecting recorded notes',()=>{
 const source={id:'own-keys',type:'keys',stringCount:6,notes:[],opaque:{own:'unchanged'}},before=JSON.stringify(source),events=[],notes=[];let time=1;const recorder=new MidiRecorder({arrangement:source,getTime:()=>time,onNote:note=>{events.push(['source',note.pitch]);notes.push(note);},onAudition:event=>events.push([event.type,event.controller??event.pitch??null,event.channel])});
 recorder.handleMessage([0xb2,64,127]);assert.deepEqual(events,[['control',64,2]]);recorder.handleMessage([0x92,60,91]);time=1.2;recorder.handleMessage([0x82,60,0]);const at=events.length;recorder.handleMessage([0xb2,121,0]);assert.deepEqual(events.slice(at),[['control',121,2],['source',60]]);
 for(const controller of [120,123]){recorder.handleMessage([0x92,64,99]);const start=events.length;recorder.handleMessage([0xb2,controller,0]);assert.deepEqual(events.slice(start),[['control',controller,2],['flush',null,2],['source',64],['noteoff',64,2]]);}
 const count=events.length;recorder.handleMessage([0xb2,7,70]);recorder.handleMessage([0xb2,64,128]);assert.equal(events.length,count);recorder.flush();assert.deepEqual(events.at(-1),['flush',null,null]);assert.equal(notes.length,3);assert.equal(JSON.stringify(source),before);
});
test('Stop guarantees disabled recording after source callback failure and retains pending note for explicit recovery',()=>{
 const a={id:'own-stop-error',type:'keys',notes:[]},events=[];let reject=true;const recorder=new MidiRecorder({arrangement:a,getTime:()=>1,onAudition:event=>events.push(event.type),onNote:note=>{events.push('source');if(reject)throw Error('Own rejected chart edit');a.notes.push(note);}});recorder.handleMessage([0x90,60,83]);events.length=0;assert.throws(()=>recorder.stop(),/Own rejected chart edit/);assert.deepEqual(events,['flush','source']);assert.equal(recorder.isRecording,false);assert.equal(recorder.pendingCount,1);assert.equal(a.notes.length,0);assert.equal(recorder.handleMessage([0x90,64,100]).status,'stopped');assert.equal(recorder.handleMessage([0x80,60,0]).status,'stopped');assert.equal(recorder.pendingCount,1);reject=false;const recovered=recorder.flush();assert.equal(recovered.length,1);assert.equal(a.notes.length,1);assert.equal(a.notes[0].velocity,83);assert.equal(recorder.pendingCount,0);assert.equal(recorder.isRecording,false);
});
