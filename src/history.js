// Original sparse reversible history. _pack/_import are immutable source blobs
// owned by import/export adapters; frontend authoring never mutates their data.
const opaqueKey = key => key === '_pack' || key === '_import';
const own = (object,key) => Object.prototype.hasOwnProperty.call(object,key);
const plain = value => value && typeof value==='object' && (Array.isArray(value)||Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);

export function snapshotProject(value,seen=new WeakMap()) {
  if(!value||typeof value!=='object')return value;
  if(seen.has(value))return seen.get(value);
  if(!plain(value))return structuredClone(value);
  const result=Array.isArray(value)?[]:Object.create(Object.getPrototypeOf(value));seen.set(value,result);
  for(const key of Object.keys(value)){
    const next=opaqueKey(key)?value[key]:snapshotProject(value[key],seen);
    if(key==='__proto__')Object.defineProperty(result,key,{value:next,writable:true,enumerable:true,configurable:true});else result[key]=next;
  }
  if(Array.isArray(value))result.length=value.length;
  return result;
}
function same(a,b) {
  if(Object.is(a,b))return true;
  if(!a||!b||typeof a!=='object'||typeof b!=='object'||Object.getPrototypeOf(a)!==Object.getPrototypeOf(b))return false;
  if(a instanceof Date)return a.getTime()===b.getTime();
  if(ArrayBuffer.isView(a)||a instanceof ArrayBuffer){const x=new Uint8Array(a.buffer??a,a.byteOffset??0,a.byteLength),y=new Uint8Array(b.buffer??b,b.byteOffset??0,b.byteLength);return x.length===y.length&&x.every((value,index)=>value===y[index]);}
  if(!plain(a))return false;
  if(Array.isArray(a)&&a.length!==b.length)return false;
  const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(key=>own(b,key)&&(opaqueKey(key)?a[key]===b[key]:same(a[key],b[key])));
}
function keyedOrder(before,after) {
  if(before.length!==after.length||before.every((item,index)=>item?.id===after[index]?.id))return null;
  const oldIds=before.map(item=>item?.id),newIds=after.map(item=>item?.id);
  if(oldIds.some(id=>typeof id!=='string'&&typeof id!=='number')||new Set(oldIds).size!==oldIds.length||new Set(newIds).size!==newIds.length)return null;
  const byId=new Map(before.map(item=>[item.id,item]));
  return newIds.every(id=>byId.has(id))?{oldIds,newIds,byId}:null;
}
function difference(before,after,path=[],patches=[]) {
  if(Object.is(before,after))return patches;
  if(!plain(before)||!plain(after)||Array.isArray(before)!==Array.isArray(after)||Object.getPrototypeOf(before)!==Object.getPrototypeOf(after)){
    if(!same(before,after))patches.push({op:'set',path,oldPresent:true,newPresent:true,oldValue:snapshotProject(before),newValue:snapshotProject(after)});
    return patches;
  }
  if(Array.isArray(before)){
    const order=keyedOrder(before,after);
    if(order){
      patches.push({op:'order',path,oldIds:order.oldIds,newIds:order.newIds});
      for(let index=0;index<after.length;index++)difference(order.byId.get(after[index].id),after[index],[...path,index],patches);
    }else if(before.length!==after.length){
      let start=0,endBefore=before.length,endAfter=after.length;
      while(start<endBefore&&start<endAfter&&same(before[start],after[start]))start++;
      while(endBefore>start&&endAfter>start&&same(before[endBefore-1],after[endAfter-1])){endBefore--;endAfter--;}
      patches.push({op:'splice',path,start,oldValues:snapshotProject(before.slice(start,endBefore)),newValues:snapshotProject(after.slice(start,endAfter))});
    }else for(let index=0;index<before.length;index++)difference(before[index],after[index],[...path,index],patches);
    return patches;
  }
  for(const key of new Set([...Object.keys(before),...Object.keys(after)])){
    const oldPresent=own(before,key),newPresent=own(after,key);
    if(!oldPresent||!newPresent||opaqueKey(key)){
      if(oldPresent!==newPresent||!Object.is(before[key],after[key]))patches.push({op:'set',path:[...path,key],oldPresent,newPresent,oldValue:opaqueKey(key)?before[key]:snapshotProject(before[key]),newValue:opaqueKey(key)?after[key]:snapshotProject(after[key]),opaque:opaqueKey(key)});
    }else difference(before[key],after[key],[...path,key],patches);
  }
  return patches;
}
const atPath = (project,path) => path.reduce((value,key)=>value[key],project);
function apply(project,patch,forward) {
  if(patch.op==='set'){
    const present=forward?patch.newPresent:patch.oldPresent,value=forward?patch.newValue:patch.oldValue;
    if(!patch.path.length)return patch.opaque?value:snapshotProject(value);
    const parent=atPath(project,patch.path.slice(0,-1)),key=patch.path.at(-1);
    if(present)Object.defineProperty(parent,key,{value:patch.opaque?value:snapshotProject(value),writable:true,enumerable:true,configurable:true});else delete parent[key];
  }else if(patch.op==='splice'){
    const array=atPath(project,patch.path),removed=forward?patch.oldValues:patch.newValues,inserted=forward?patch.newValues:patch.oldValues;
    array.splice(patch.start,removed.length);
    for(let start=0;start<inserted.length;start+=4096)array.splice(patch.start+start,0,...snapshotProject(inserted.slice(start,start+4096)));
  }else if(patch.op==='order'){
    const array=atPath(project,patch.path),byId=new Map(array.map(item=>[item.id,item])),ids=forward?patch.newIds:patch.oldIds;
    for(let index=0;index<ids.length;index++)array[index]=byId.get(ids[index]);
  }
  return project;
}
function estimate(value,seen=new WeakSet()) {
  if(value==null)return 8;
  if(typeof value==='string')return value.length*2;
  if(typeof value!=='object')return 8;
  if(seen.has(value))return 8;seen.add(value);
  if(ArrayBuffer.isView(value)||value instanceof ArrayBuffer)return value.byteLength;
  return Object.entries(value).reduce((size,[key,item])=>size+key.length*2+(opaqueKey(key)?16:estimate(item,seen)),24);
}
function entrySize(patches){return patches.reduce((size,patch)=>size+(patch.opaque?128:estimate(patch)),64);}


// Array-edit capability is valid only while all existing array/note edits go
// through History. Same-length out-of-band content/descriptor writes are outside
// this trusted application contract and cannot be detected without another walk.
const arrayEditTokens=new WeakMap(),arrayEditEpochs=new WeakMap(),arrayEditNativeSplice=Array.prototype.splice;
const arrayEditEpoch=h=>arrayEditEpochs.get(h)??0;
const invalidateArrayEdits=h=>arrayEditEpochs.set(h,arrayEditEpoch(h)+1);
const arrayData=(object,key)=>{const d=Object.getOwnPropertyDescriptor(object,key);if(!d||!Object.hasOwn(d,'value'))throw Error('Own data properties required');return d;};
const arrayPlain=value=>value&&typeof value==='object'&&(Array.isArray(value)?Object.getPrototypeOf(value)===Array.prototype:[Object.prototype,null].includes(Object.getPrototypeOf(value)));
function arrayDense(array,mutable=false){if(!Array.isArray(array)||Object.getPrototypeOf(array)!==Array.prototype||Reflect.ownKeys(array).length!==array.length+1)throw Error('Dense undecorated plain arrays required');for(let i=0;i<array.length;i++){const d=arrayData(array,String(i));if(mutable&&(!d.writable||!d.configurable))throw Error('Mutable array entries required');}if(mutable&&(!arrayData(array,'length').writable||!Object.isExtensible(array)))throw Error('Mutable target array required');}
function inspectArrayGraph(value,seen,{forbidden=null,depth=0,budget=null}={}){if(!value||typeof value!=='object')return;if(depth>64||!arrayPlain(value)||seen.has(value)||forbidden?.has(value))throw Error('Detached plain nonaliased payload/target graph required');if(budget&&++budget.nodes>65536)throw Error('Bounded insertion payload required');seen.add(value);const keys=Reflect.ownKeys(value);if(budget&&(budget.slots=(budget.slots??0)+keys.length)>65536)throw Error('Bounded insertion property budget required');if(Array.isArray(value))arrayDense(value);for(const key of keys){if(typeof key!=='string')throw Error('Symbol properties unsupported');const child=arrayData(value,key).value;if(!opaqueKey(key))inspectArrayGraph(child,seen,{forbidden,depth:depth+1,budget});}}
function verifyArrayToken(history,proof){if(!proof||proof.history!==history||proof.owner!==history.project||proof.stateId!==history.stateId||proof.epoch!==arrayEditEpoch(history))throw Error('Foreign or stale array-edit capability');for(const scope of proof.scopes){for(const part of scope.chain)if(arrayData(part.parent,part.key).value!==part.value)throw Error('Array-edit path replaced');if(scope.target.length!==scope.length||Object.getPrototypeOf(scope.target)!==Array.prototype||!arrayData(scope.target,'length').writable||!Object.isExtensible(scope.target))throw Error('Array-edit target length/shape changed');}}

export class History {
  constructor(project,{maxEntries=200,maxBytes=32*1024*1024}={}){
    if(!Number.isInteger(maxEntries)||maxEntries<0||!Number.isFinite(maxBytes)||maxBytes<0)throw Error('Invalid history limits');
    this.project=project;this.undoStack=[];this.redoStack=[];this.listeners=new Set();this.maxEntries=maxEntries;this.maxBytes=maxBytes;this.nextState=1;this.stateId=0;this.checkpoint=null;
  }
  get retainedBytes(){return [...this.undoStack,...this.redoStack].reduce((size,entry)=>size+entry.bytes,0);}
  commit(label,edit){
    invalidateArrayEdits(this);
    const before=snapshotProject(this.project);
    try{edit(this.project);}catch(error){
      const rollback=difference(before,this.project);
      for(let index=rollback.length-1;index>=0;index--)this.project=apply(this.project,rollback[index],false);
      throw error;
    }
    const patches=difference(before,this.project);
    return this.record(label,patches);
  }
  // Trusted synchronous authoring callback, restricted to a staged copy of one
  // existing plain subtree. Immutable _pack/_import blobs remain read-only.
  // This avoids copying unrelated arrangements for a single lyric-field edit.
  commitAt(label,path,edit){
    invalidateArrayEdits(this);
    if(!Array.isArray(path)||!path.length||path.length>32||typeof edit!=='function')throw Error('Choose an existing subtree path and a synchronous edit');
    path=[...path];
    let target=this.project;
    for(const key of path){
      if(!plain(target)||(Array.isArray(target)?!Number.isSafeInteger(key)||key<0||key>=target.length:typeof key!=='string')||opaqueKey(key)||!own(target,key))throw Error('The explicit subtree path must exist');
      target=target[key];
    }
    if(!plain(target))throw Error('Choose a plain object or array subtree');
    const owner=this.project,stateId=this.stateId,before=snapshotProject(target),staged=snapshotProject(target),result=edit(staged);
    if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});throw Error('Scoped history edits must be synchronous');}
    if(this.project!==owner||this.stateId!==stateId||atPath(this.project,path)!==target||!same(target,before))throw Error('The source changed while preparing the scoped edit');
    const patches=difference(before,staged).map(patch=>({...patch,path:[...path,...patch.path]})),bytes=entrySize(patches);
    try{for(const patch of patches)this.project=apply(this.project,patch,true);}
    catch(error){this.project=apply(this.project,{op:'set',path,oldPresent:true,newPresent:true,oldValue:before},false);throw error;}
    return this.record(label,patches,bytes);
  }
  prepareArrayEdits(paths){
    const owner=this.project,stateId=this.stateId,epoch=arrayEditEpoch(this);if(!Array.isArray(paths)||!paths.length||paths.length>64)throw Error('Choose1..64 independent array paths');arrayDense(paths);
    const scopes=[],targets=new Set(),objects=new WeakSet();
    for(const path of paths){if(!Array.isArray(path)||!path.length||path.length>32)throw Error('Bounded existing array path required');arrayDense(path);let value=owner;const chain=[],copy=[];
      for(const key of path){if(!arrayPlain(value)||(Array.isArray(value)?!Number.isSafeInteger(key)||key<0||key>=value.length:typeof key!=='string'||opaqueKey(key)||['__proto__','constructor','prototype'].includes(key)))throw Error('Unsafe array path');const parent=value;value=arrayData(parent,String(key)).value;chain.push({parent,key:String(key),value});copy.push(key);}
      arrayDense(value,true);if(targets.has(value))throw Error('Independent target arrays required');targets.add(value);scopes.push({path:copy,chain,target:value,length:value.length});
    }
    for(const scope of scopes)inspectArrayGraph(scope.target,objects);
    const proof={history:this,owner,stateId,epoch,scopes,objects};verifyArrayToken(this,proof);const token=Object.freeze(Object.create(null));arrayEditTokens.set(token,proof);return token;
  }
  commitArrayEdits(token,label,operations){
    const proof=arrayEditTokens.get(token);verifyArrayToken(this,proof);if(!Array.isArray(operations)||operations.length>64)throw Error('At most64 operations');arrayDense(operations);
    const patches=[],used=new Set(),insertedObjects=new WeakSet(),budget={nodes:0};let total=0;
    for(const operation of operations){if(!arrayPlain(operation)||Array.isArray(operation)||Reflect.ownKeys(operation).length!==4||!['array','start','deleteCount','insert'].every(key=>Object.hasOwn(operation,key)))throw Error('Use array/start/deleteCount/insert');
      const index=arrayData(operation,'array').value,start=arrayData(operation,'start').value,count=arrayData(operation,'deleteCount').value,insert=arrayData(operation,'insert').value;
      if(!Number.isSafeInteger(index)||index<0||index>=proof.scopes.length||used.has(index))throw Error('One operation per prepared array');used.add(index);if(!Array.isArray(insert)||insert.length>4096)throw Error('Bounded insertion array required');total+=count+insert.length;
      const scope=proof.scopes[index];if(!Number.isSafeInteger(start)||start<0||start>scope.length||!Number.isSafeInteger(count)||count<0||count>scope.length-start||total>4096)throw Error('Bounded in-range splice required');arrayDense(insert);
      inspectArrayGraph(insert,insertedObjects,{forbidden:proof.objects,budget});
      const oldValues=snapshotProject(scope.target.slice(start,start+count)),newValues=snapshotProject(insert);if(count||newValues.length)patches.push({op:'splice',path:scope.path,start,oldValues,newValues});
    }
    const bytes=entrySize(patches);verifyArrayToken(this,proof);
    const completed=[];let current=null;
    try{for(const patch of patches){const target=atPath(this.project,patch.path);current={patch,target,length:target.length};this.project=apply(this.project,patch,true);completed.push(current);current=null;}}
    catch(error){if(current){const {patch,target,length}=current,inserted=target.length-(length-patch.oldValues.length);if(inserted>=0&&inserted<=patch.newValues.length)Reflect.apply(arrayEditNativeSplice,target,[patch.start,inserted,...snapshotProject(patch.oldValues)]);}for(let i=completed.length-1;i>=0;i--){const {patch,target}=completed[i];Reflect.apply(arrayEditNativeSplice,target,[patch.start,patch.newValues.length,...snapshotProject(patch.oldValues)]);}throw error;}
    // record listeners follow existing History semantics. If a listener throws or
    // performs another edit, this capability remains stale rather than blessing it.
    const expectedState=patches.length?this.nextState:this.stateId,expectedEpoch=arrayEditEpoch(this)+1,result=this.record(label,patches,bytes);
    if(this.project===proof.owner&&this.stateId===expectedState&&arrayEditEpoch(this)===expectedEpoch){proof.stateId=this.stateId;proof.epoch=expectedEpoch;for(const scope of proof.scopes)scope.length=scope.target.length;}
    return result;
  }
  record(label,patches,bytes=entrySize(patches)){
    invalidateArrayEdits(this);
    if(patches.length){
      const beforeId=this.stateId;this.stateId=this.nextState++;this.redoStack=[];this.undoStack.push({label,patches,bytes,beforeId,afterId:this.stateId});
      while(this.undoStack.length>this.maxEntries||this.retainedBytes>this.maxBytes)this.undoStack.shift();
    }
    this.notify();return this.project;
  }
  // Retained boundary indices are local to this history window, never global edit numbers.
  // Checkpoints store monotonic state identities, so eviction/branching cannot rewind
  // to a different edit that later happens to occupy the same visible index.
  steps(){
    const entries=[...this.undoStack,...this.redoStack.toReversed()];
    return [{id:entries[0]?.beforeId??this.stateId,label:'Earliest retained state'},...entries.map(entry=>({id:entry.afterId,label:entry.label}))].map((step,index)=>({...step,index,current:index===this.undoStack.length,checkpoint:step.id===this.checkpoint?.id}));
  }
  setCheckpoint(label='Checkpoint'){this.checkpoint={id:this.stateId,label:String(label)};return {...this.checkpoint};}
  get checkpointAvailable(){return !!this.checkpoint&&this.steps().some(step=>step.id===this.checkpoint.id);}
  returnToCheckpoint(){
    if(!this.checkpoint)throw Error('No history checkpoint has been set');
    const target=this.steps().find(step=>step.id===this.checkpoint.id);
    if(!target)throw Error('The checkpoint expired after history eviction or a new edit branch');
    return this.goTo(target.index);
  }
  goTo(index){
    invalidateArrayEdits(this);
    const total=this.undoStack.length+this.redoStack.length;
    if(!Number.isInteger(index)||index<0||index>total)throw Error('History step is outside retained history');
    if(index===this.undoStack.length)return this.project;
    const backup=snapshotProject(this.project),undo=[...this.undoStack],redo=[...this.redoStack],stateId=this.stateId;
    try{
      while(this.undoStack.length>index){const entry=this.undoStack.pop();for(let i=entry.patches.length-1;i>=0;i--)this.project=apply(this.project,entry.patches[i],false);this.redoStack.push(entry);this.stateId=entry.beforeId;}
      while(this.undoStack.length<index){const entry=this.redoStack.pop();for(const patch of entry.patches)this.project=apply(this.project,patch,true);this.undoStack.push(entry);this.stateId=entry.afterId;}
    }catch(error){this.project=backup;this.undoStack=undo;this.redoStack=redo;this.stateId=stateId;throw error;}
    this.notify();return this.project;
  }
  undo(){invalidateArrayEdits(this);const entry=this.undoStack.pop();if(entry){for(let i=entry.patches.length-1;i>=0;i--)this.project=apply(this.project,entry.patches[i],false);this.redoStack.push(entry);this.stateId=entry.beforeId;this.notify();}return this.project;}
  redo(){invalidateArrayEdits(this);const entry=this.redoStack.pop();if(entry){for(const patch of entry.patches)this.project=apply(this.project,patch,true);this.undoStack.push(entry);this.stateId=entry.afterId;this.notify();}return this.project;}
  notify(){for(const listener of this.listeners)listener(this.project);}
}
