import test from 'node:test';
import assert from 'node:assert/strict';
import {readPreferences,writePreferences} from '../src/preferences.js';

function memoryStorage(initial={}){
 const values=new Map(Object.entries(initial));
 return {
  getItem(key){return values.get(key)??null;},
  setItem(key,value){values.set(key,String(value));}
 };
}

test('live monitor choices are validated and retained as browser preferences',()=>{
 const storage=memoryStorage();
 const liveMonitor={deviceId:'input-1',engine:'at5-vst3',tier:'se',frameCount:256};
 assert.equal(writePreferences({liveMonitor},storage),true);
 assert.deepEqual(readPreferences(storage).liveMonitor,liveMonitor);
});

test('invalid live monitor preferences fall back to safe defaults',()=>{
 const storage=memoryStorage({'oce.preferences.v1':JSON.stringify({
  liveMonitor:{deviceId:{},engine:'missing',tier:'invalid',frameCount:128}
 })});
 assert.deepEqual(readPreferences(storage).liveMonitor,{
  deviceId:'',engine:'software',tier:'max',frameCount:1024
 });
});
