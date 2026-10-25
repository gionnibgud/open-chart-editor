import test from 'node:test';
import assert from 'node:assert/strict';
import {rollAxes,rollArrow,uprightRollContext} from '../src/roll-geometry.js';
import {readPreferences,writePreferences} from '../src/preferences.js';

test('bottom flow maps authored time to rising physical positions and ascending pitch to the right',()=>{
 const a=rollAxes({bottom:true,width:900,height:600,scrollLeft:0,scrollTop:0});
 // Left=112 timeline units, top=174 lane units, row=18. These coordinates
 // are independent expected physical positions, including the sustain tail.
 assert.deepEqual(a.screen(112+2*110,174+.5*18),{x:183,y:268});
 assert.deepEqual(a.screen(112+3*110,174+.5*18),{x:183,y:158});
 assert.deepEqual(a.screen(112+2*110,174+12.5*18),{x:399,y:268});
 assert.deepEqual(a.logical(399,268),{x:332,y:399});
 assert.deepEqual(a.screen(18,183),{x:183,y:582},'Fixed label band is at bottom');
 assert.equal(a.width,600);assert.equal(a.height,900);
});
test('all MIDI0..127 remain reachable by horizontal pitch scroll, independently of vertical time scroll',()=>{
 for(const pitch of Array.from({length:128},(_,i)=>i))for(const time of [0,.125,3,120]){
  const row=18,logicalLane=174+(pitch+.5)*row,lanePan=Math.max(0,logicalLane-400),timePan=time*110;
  const axes=rollAxes({bottom:true,width:900,height:600,scrollLeft:lanePan,scrollTop:timePan});
  const logicalTime=112+time*110-axes.timeScroll,point=axes.screen(logicalTime,logicalLane);
  assert.equal(point.y,488,'Time-scroll changes no authored time');assert.ok(point.x>=174&&point.x<=400);
  const hit=axes.logical(point.x,point.y);assert.equal((hit.x-112+axes.timeScroll)/110,time);assert.equal(Math.floor((hit.y-174)/row),pitch);
 }
});
test('common draw matrix and pointer inverse agree for note attack/tail, marquee corners, waveform and pad lanes at DPR1/2',()=>{
 for(const bottom of [false,true])for(const dpr of [1,2]){
  const axes=rollAxes({bottom,width:900,height:600,scrollLeft:153,scrollTop:79}),m=axes.matrix(dpr);
  for(const point of [{x:112,y:174},{x:442,y:183},{x:497,y:183},{x:290,y:37},{x:70,y:300}]){
   const physical={x:(m[0]*point.x+m[2]*point.y+m[4])/dpr,y:(m[1]*point.x+m[3]*point.y+m[5])/dpr};
   assert.deepEqual(physical,axes.screen(point.x,point.y));assert.deepEqual(axes.logical(physical.x,physical.y),point);
  }
 }
});
test('left layout keeps original geometry and bottom arrow navigation follows physical axes',()=>{
 const a=rollAxes({width:900,height:600,scrollLeft:153,scrollTop:79});
 assert.equal(a.timeScroll,153);assert.equal(a.laneScroll,79);assert.deepEqual(a.screen(442,183),{x:442,y:104});assert.deepEqual(a.logical(442,104),{x:442,y:183});
 for(const key of ['arrowup','arrowdown','arrowleft','arrowright','enter','p'])assert.equal(rollArrow(key,false),key);
 assert.equal(rollArrow('arrowup',true),'arrowright');assert.equal(rollArrow('arrowright',true),'arrowdown');assert.equal(rollArrow('arrowdown',true),'arrowleft');assert.equal(rollArrow('arrowleft',true),'arrowup');
});
test('upright canvas text uses the same transformed anchor and preserves drawing state / bound native context calls',()=>{
 const calls=[],state={m:{a:0,b:-2,c:2,d:0,e:-306,f:1200},textAlign:'left'};
 const context={...state,getTransform(){assert.equal(this,context);return this.m;},save(){calls.push('save');},restore(){calls.push('restore');},setTransform(...args){calls.push(args);},fillText(...args){assert.equal(this,context);calls.push(args);},fillRect(...args){assert.equal(this,context);calls.push(args);}};
 let bottom=true;const c=uprightRollContext(context,()=>bottom);c.fillText('C-1',18,183,16);
 assert.deepEqual(calls,['save',[2,0,0,2,60,1164],['C-1',0,0,16],'restore']);
 calls.length=0;c.fillTextAlong('Phrases    +',8,91);assert.deepEqual(calls,[['Phrases    +',8,91]],'Header lane labels follow the rotated lane');
 calls.length=0;bottom=false;c.fillText('Own left label',12,183,95);c.fillRect(1,2,3,4);assert.deepEqual(calls,[['Own left label',12,183,95],[1,2,3,4]]);c.font='11px sans-serif';assert.equal(context.font,'11px sans-serif');
});
test('orientation is an independently persisted per-family view preference, with safe legacy/default decoding',()=>{
 const data=new Map(),storage={getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)};
 assert.equal(readPreferences(storage).rollOrientations,undefined);
 writePreferences({rollOrientations:{keys:'bottom',drums:'left'},future:{retain:true}},storage);assert.deepEqual(readPreferences(storage).rollOrientations,{keys:'bottom',drums:'left'});
 writePreferences({rollOrientations:{keys:'sideways',drums:'bottom',guitar:'bottom'}},storage);assert.deepEqual(readPreferences(storage).rollOrientations,{keys:'left',drums:'bottom'});
});
