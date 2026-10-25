import test from 'node:test';
import assert from 'node:assert/strict';
import {CountIn,planCountIn} from '../src/count-in.js';
const project=(numerator=4,denominator=4,step=.5)=>({beats:Array.from({length:20},(_,i)=>({time:i*step,numerator,denominator,measure:i%numerator===0?i/numerator+1:-1}))});
function fixture(){
 let now=0,serial=0;const tasks=new Map(),sources=[],plays=[],ticks=[];
 const param=()=>({value:0,setValueAtTime(){},exponentialRampToValueAtTime(){}}),node=()=>({connect(){},disconnect(){},start(at){this.at=at;},stop(at){if(at==null)this.cancelled=true;else this.stopAt=at;}});
 const context={currentTime:0,destination:{},createOscillator(){const source={...node(),frequency:param()};sources.push(source);return source;},createGain:()=>({...node(),gain:param()})};
 const audio={context,speed:1,buses:{master:{}},async init(){},async play(cursor){plays.push(cursor);},pause(){this.paused=true;}};
 const controller=new CountIn({audio,onTick:event=>ticks.push(event),setTimer:(fn,ms)=>{const id=++serial;tasks.set(id,{fn,at:now+ms});return id;},clearTimer:id=>tasks.delete(id)});
 const advance=async end=>{while(tasks.size){const [id,task]=[...tasks].sort((a,b)=>a[1].at-b[1].at)[0];if(task.at>end)break;tasks.delete(id);now=task.at;context.currentTime=now/1000;await task.fn();}now=end;context.currentTime=now/1000;};
 return {controller,audio,sources,plays,ticks,tasks,advance};
}
test('meter pulses and independent speed define original pre-roll duration',()=>{
 const six=planCountIn(project(6,8,.25),1,{bars:2,speed:.5});assert.equal(six.events.length,12);assert.equal(six.duration,6);assert.deepEqual(six.events.filter(e=>e.accent).map(e=>e.index),[0,6]);
 const three=planCountIn(project(3,4,.5),1,{beats:5});assert.equal(three.duration,2.5);assert.equal(three.events.at(-1).beat,2);assert.throws(()=>planCountIn(project(),0,{beats:0}),/1 to 128/);
});
test('count-in schedules audible independent clicks and starts exact requested chart cursor',async()=>{
 const f=fixture(),source=project(),before=structuredClone(source),done=f.controller.start({project:source,cursor:3,bars:1});await Promise.resolve();
 assert.equal(f.sources.length,4);assert.deepEqual(f.sources.map(s=>s.frequency.value),[1320,880,880,880]);assert.equal(f.sources[0].at,.025);assert.equal(f.sources[3].at,1.525);
 await f.advance(1900);assert.deepEqual(f.plays,[]);await f.advance(2025);assert.equal(await done,true);assert.deepEqual(f.plays,[3]);assert.equal(f.ticks.length,4);assert.deepEqual(source,before);assert.equal(f.controller.isCounting,false);
});
test('cancellation stops scheduled sources and rapid restart cannot start stale playback',async()=>{
 const f=fixture(),first=f.controller.start({project:project(),cursor:1});await Promise.resolve();await f.advance(300);
 const second=f.controller.start({project:project(),cursor:4,beats:1});await Promise.resolve();assert.equal(await first,false);assert.ok(f.sources.slice(0,4).every(source=>source.cancelled));await f.advance(825);assert.equal(await second,true);assert.deepEqual(f.plays,[4]);
});
test('cancel while waiting for audio permission leaves no pending clicks or playback',async()=>{
 const f=fixture();let resumed;f.audio.init=()=>new Promise(resolve=>{resumed=resolve;});const done=f.controller.start({project:project(),cursor:2});f.controller.cancel();resumed();assert.equal(await done,false);assert.equal(f.sources.length,0);assert.equal(f.tasks.size,0);assert.deepEqual(f.plays,[]);
});
test('failed transport start rejects cleanly and releases scheduled resources',async()=>{
 const f=fixture(),done=f.controller.start({project:project(),beats:1,onStart:async()=>{throw Error('Audio route unavailable');}});await Promise.resolve();
 const rejected=assert.rejects(done,/Audio route unavailable/);await f.advance(525);await rejected;assert.equal(f.controller.state,'idle');assert.equal(f.tasks.size,0);assert.equal(f.controller.voices.size,0);
});

test('a stale transport callback can decline startup without reporting playback or retaining clicks',async()=>{
 const f=fixture(),done=f.controller.start({project:project(),beats:1,onStart:async()=>false});await Promise.resolve();await f.advance(525);assert.equal(await done,false);assert.deepEqual(f.plays,[]);assert.equal(f.controller.state,'idle');assert.equal(f.controller.voices.size,0);assert.equal(f.tasks.size,0);
});
