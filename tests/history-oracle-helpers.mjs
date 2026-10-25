// Independent original mutation grammar and full-state restoration oracle.
// The generic History implementation is also compared for observable metadata.
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {History} from '../src/history.js';
const clone=value=>structuredClone(value);
function random(seed){let state=seed>>>0;return max=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)%max;};}
function freeze(value){if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}
function row(id,time=0){return {id,time,length:.125,text:'Own '+id,pitch:60,extra:{flag:false,count:1,items:[{id:id+'-a',value:1},{id:id+'-b',value:2}],optional:{own:'source'}},opaque:{unchanged:[id,{fraction:1/3}]},_wire:{own:'retained source '+id}};}
function fixture(){return {version:1,title:'Original scoped history oracle',vocals:Array.from({length:8},(_,i)=>row('own-'+i,i/8)),arrangements:[{id:'hidden',notes:[{id:'own-hidden-note',time:1,fret:3,techniques:{bend_values:[{t:.125,v:1.5}]}}],difficulties:[{difficulty:0,notes:[],chords:[],anchors:[],handshapes:[],opaque:{own:true}}]}],_pack:freeze({entries:{'audio/original.wav':'Own immutable source bytes'}}),_import:freeze({source:'Own original source XML'}),opaque:{own:[1,2,3]}};}
function mutate(target,plan){
 const own=(key,value)=>Object.defineProperty(target,key,{value:clone(value),writable:true,enumerable:true,configurable:true});
 switch(plan.kind){
  case 0:target.text=plan.value;break;
  case 1:target.length=plan.value;break;
  case 2:if(plan.remove)delete target.pitch;else target.pitch=plan.value;break;
  case 3:own('authorMark',plan.value);break;
  case 4:delete target.authorMark;break;
  case 5:target.extra??={};target.extra.nested=clone(plan.value);break;
  case 6:if(target.extra)delete target.extra.optional;break;
  case 7:target.extra??={};target.extra.items??=[];target.extra.items.splice(plan.index%(target.extra.items.length+1),0,clone(plan.value));break;
  case 8:if(target.extra?.items?.length)target.extra.items.splice(plan.index%target.extra.items.length,1);break;
  case 9:target.extra?.items?.reverse();break;
  case 10:delete target.extra;break;
  case 11:own('__proto__',plan.value);break;
  case 12:delete target.__proto__;break;
  case 13:own('constructor',plan.value);break;
  case 14:delete target.constructor;break;
  case 15:break; // Deliberate no-op must retain the redo branch/state identity.
 }
}
function makePlan(rng,serial){const kind=rng(16),value=kind===0?['Own edited','é+','😀-',''][rng(4)]:kind===1?rng(1000)/1000:kind===2?rng(128):kind===3?[null,false,0,'Own primitive'][rng(4)]:{id:'own-child-'+serial,own:[null,rng(13),{flag:!!rng(2)}]};return {kind,value,remove:!!rng(2),index:rng(12)};}
function globalEdit(project,op){
 switch(op.kind){
  case 0:project.vocals.reverse();break;
  case 1:if(project.vocals.length<40)project.vocals.splice(op.index%(project.vocals.length+1),0,clone(op.row));break;
  case 2:if(project.vocals.length>1)project.vocals.splice(op.index%project.vocals.length,1);break;
  case 3:if(project.vocals.length>1)project.vocals.push(project.vocals.shift());break;
  case 4:project.title=op.title;break;
  case 5:project.vocals.sort((a,b)=>a.id.localeCompare(b.id));break;
 }
}
function summary(h){return {stateId:h.stateId,nextState:h.nextState,checkpoint:h.checkpoint,available:h.checkpointAvailable,steps:h.steps(),undo:h.undoStack.map(e=>({label:e.label,bytes:e.bytes,beforeId:e.beforeId,afterId:e.afterId})),redo:h.redoStack.map(e=>({label:e.label,bytes:e.bytes,beforeId:e.beforeId,afterId:e.afterId})),retainedBytes:h.retainedBytes};}

export function runHistoryOracle({seeds=[0x1a2b3c4d,0x12345678,0xdecafbad,0x98765432],steps=500,limits=[{maxEntries:200,maxBytes:1024*1024},{maxEntries:5,maxBytes:4096},{maxEntries:100,maxBytes:700},{maxEntries:0,maxBytes:0}]}={}){
 const counts={scoped:0,global:0,undo:0,redo:0,goTo:0,checkpoint:0,returnCheckpoint:0,rejected:0,retainedStatesChecked:0};let operations=0;
 for(const cap of limits)for(const seed of seeds){
  const rng=random(seed),initial=fixture(),scoped=new History(initial,cap),generic=new History(clone(initial),cap),sources=[scoped,generic].map(h=>({pack:h.project._pack,import:h.project._import})),snapshots=new Map([[0,clone(initial)]]),trail=[],notifications=[0,0];
  for(const [index,h]of [scoped,generic].entries())h.listeners.add(project=>{assert.equal(project,h.project);notifications[index]++;});
  for(const h of [scoped,generic]){freeze(h.project._pack);freeze(h.project._import);}
  function verify(expected){assert.deepEqual(scoped.project,expected);assert.deepEqual(generic.project,expected);assert.deepEqual(summary(scoped),summary(generic));assert.equal(notifications[0],notifications[1]);assert.ok(scoped.retainedBytes<=cap.maxBytes);assert.ok(scoped.undoStack.length<=cap.maxEntries);for(const [index,h]of [scoped,generic].entries()){assert.equal(h.project._pack,sources[index].pack);assert.equal(h.project._import,sources[index].import);}assert.equal({}.polluted,undefined);}
  function remember(expected,beforeId,changed){assert.equal(scoped.stateId!==beforeId,changed,'State identity must advance exactly for a semantic edit');if(snapshots.has(scoped.stateId))assert.deepEqual(expected,snapshots.get(scoped.stateId),'A no-op cannot overwrite an existing oracle state');else snapshots.set(scoped.stateId,clone(expected));verify(expected);}
  function navigate(fn){let a,b;try{fn(scoped);}catch(e){a=e.message;}try{fn(generic);}catch(e){b=e.message;}assert.equal(a,b);verify(snapshots.get(scoped.stateId));}
  for(let step=0;step<steps;step++){
   const choice=rng(100),index=rng(scoped.project.vocals.length),plan=makePlan(rng,step),label='Own operation '+step,expected=clone(scoped.project),beforeId=scoped.stateId;
   try{
    if(choice<45){counts.scoped++;trail.push({step,kind:'scoped',index,plan});mutate(expected.vocals[index],plan);const changed=!isDeepStrictEqual(expected,scoped.project);scoped.commitAt(label,['vocals',index],target=>mutate(target,plan));generic.commit(label,p=>mutate(p.vocals[index],plan));remember(expected,beforeId,changed);}
    else if(choice<65){counts.global++;const op={kind:rng(6),index:rng(30),row:row('insert-'+seed+'-'+step,step/7),title:'Own global '+step};trail.push({step,kind:'global',op});globalEdit(expected,op);const changed=!isDeepStrictEqual(expected,scoped.project);for(const h of [scoped,generic])h.commit(label,p=>globalEdit(p,op));remember(expected,beforeId,changed);}
    else if(choice<77){counts.undo++;trail.push({step,kind:'undo'});navigate(h=>h.undo());}
    else if(choice<85){counts.redo++;trail.push({step,kind:'redo'});navigate(h=>h.redo());}
    else if(choice<90){counts.goTo++;const target=rng(scoped.steps().length);trail.push({step,kind:'goTo',target});navigate(h=>h.goTo(target));}
    else if(choice<93){counts.checkpoint++;trail.push({step,kind:'checkpoint'});for(const h of [scoped,generic])h.setCheckpoint(label);verify(expected);}
    else if(choice<96){counts.returnCheckpoint++;trail.push({step,kind:'returnCheckpoint'});navigate(h=>h.returnToCheckpoint());}
    else{counts.rejected++;trail.push({step,kind:'rejected',index,plan});const before=summary(scoped);let retainedDraft;assert.throws(()=>scoped.commitAt(label,['vocals',index],draft=>{retainedDraft=draft;mutate(draft,plan);draft.rejected={own:[1,2,3]};throw Error('Own deliberate rejection');}),/deliberate rejection/);assert.throws(()=>generic.commit(label,p=>{mutate(p.vocals[index],plan);p.vocals[index].rejected={own:[1,2,3]};throw Error('Own deliberate rejection');}),/deliberate rejection/);retainedDraft.text='Late discarded draft';retainedDraft.rejected.own.push(4);verify(expected);assert.deepEqual(summary(scoped),before);assert.equal(scoped.stateId,beforeId);}
    operations++;
   }catch(error){error.message+='\nOracle context '+JSON.stringify({seed,cap,step,lastOperations:trail.slice(-12)});throw error;}
  }
  // Check every reachable retained state against independent full snapshots,
  // not against replaying the same patches in the other History instance.
  const retained=scoped.steps();for(const state of retained){navigate(h=>h.goTo(state.index));assert.deepEqual(scoped.project,snapshots.get(state.id));counts.retainedStatesChecked++;}
 }
 return {ok:true,seeds,stepsPerCase:steps,retentionConfigurations:limits,cases:seeds.length*limits.length,operations,counts,scope:'Deterministic original JSON mutations, generic/scoped observable equivalence and independent full-state restoration snapshots. Frozen immutable source blobs retained by identity. No browser, runtime edits or untrusted callback sandbox claim.'};
}
