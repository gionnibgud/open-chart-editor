import test from 'node:test';import assert from 'node:assert/strict';
import {AudioEngine,advanceTransport,distanceAtTime} from '../src/audio.js';
import {observeTransportClock} from './helpers/transport-observation.mjs';
function engine(times,{loop={enabled:false},position=20}={}){let reads=0;const context={sampleRate:48000,get currentTime(){return times[Math.min(reads++,times.length-1)];}},e=new AudioEngine({context});e.position=position;e.project={duration:60};e.playing=true;e.ramp={enabled:true,startSpeed:.25,endSpeed:1,duration:10};e.loop=loop;e.startedAt=1073.7263541666666;return{e,reads:()=>reads};}
test('actual production getter plus one advancing native quantum reproduces the strict historical residual',()=>{
 const before=1073.728,after=before+128/48000,{e,reads}=engine([before,before,after]);
 const expected=advanceTransport(e.position,distanceAtTime(Math.max(0,e.context.currentTime-e.startedAt),e.speed,e.ramp),e.loop,e.duration),recordedContext=e.context.currentTime,actual=e.currentTime,residual=Math.abs(actual-expected);
 assert.equal(reads(),3);assert.equal(recordedContext,1073.728);assert.ok(Math.abs(residual-0.0006672624999630727)<1e-12);assert.equal(actual,e.timeAtContext(after));assert.equal(expected,e.timeAtContext(before));
});
test('coherent snapshot keeps strict residual while actual getter remains inside captured clock bounds',()=>{
 const before=1073.728,after=before+128/48000,{e}=engine([before,after,after]),observed=observeTransportClock(e,advanceTransport,distanceAtTime);assert.equal(observed.clockError,0);assert.equal(observed.clockGetterWithinBounds,true);assert.ok(observed.clockSequentialResidual>.000667);assert.equal(observed.clockReadAfter-observed.clockReadBefore,after-before);
});
test('clock bracket accounts for loop wrapping and rejects an actually wrong getter rather than widening tolerance',()=>{
 const {e}=engine([1073.728,1073.7306666666666,1073.7306666666666],{loop:{enabled:true,start:0,end:1},position:.9995});const good=observeTransportClock(e,advanceTransport,distanceAtTime);assert.equal(good.clockGetterWithinBounds,true);assert.ok(good.clockExpectedAfter<good.clockExpectedBefore);for(const value of [.5,-100,100]){Object.defineProperty(e,'currentTime',{get:()=>value,configurable:true});const bad=observeTransportClock(e,advanceTransport,distanceAtTime);assert.equal(bad.clockGetterWithinBounds,false);}
});
