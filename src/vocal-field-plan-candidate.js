// Uninstalled original performance experiment. Explicit primitive vocal fields
// produce the existing History patch format without cloning the entire song.
const allowed=new Set(['time','length','pitch','text']),plans=new WeakMap();
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
export function planVocalFields(project,updates){
 const rows=project?.vocals;if(!Array.isArray(rows)||rows.length>100000||!Array.isArray(updates)||updates.length>100000)throw Error('Choose bounded vocal rows and updates');
 const byId=new Map();for(let i=0;i<rows.length;i++){const row=rows[i];if(!row||typeof row.id!=='string'||!row.id||byId.has(row.id))throw Error('Vocal IDs must be unique');byId.set(row.id,i);}
 const patches=[],changed=new Map(),seen=new Set(),expectedRows=new Map();let sort=false;
 for(const update of updates){if(!update||typeof update.id!=='string'||!update.values||typeof update.values!=='object'||Array.isArray(update.values)||seen.has(update.id)||!byId.has(update.id))throw Error('Choose each existing vocal once');seen.add(update.id);const index=byId.get(update.id),row=rows[index],values=update.values;
  expectedRows.set(index,{row,id:row.id});for(const key of Object.keys(values)){
   if(!allowed.has(key))throw Error('Only explicit primitive vocal fields are supported');const value=values[key],present=!(key==='pitch'&&value===undefined);
   if(own(row,key)&&(key==='text'?typeof row[key]!=='string':key==='pitch'?!Number.isInteger(row[key])||row[key]<0||row[key]>127:!Number.isFinite(row[key])||row[key]<0))throw Error('Use generic History to correct a malformed original field');
   if(key==='text'?typeof value!=='string':key==='pitch'?present&&(!Number.isInteger(value)||value<0||value>127):!Number.isFinite(value)||value<0)throw Error('Invalid vocal field value');
   if(own(row,key)===present&&Object.is(row[key],value))continue;
   patches.push({op:'set',path:['vocals',index,key],oldPresent:own(row,key),newPresent:present,oldValue:row[key],newValue:value});if(key==='time')sort=true;
  }
  const time=own(values,'time')?values.time:row.time,length=own(values,'length')?values.length:row.length;
  if(!Number.isFinite(time+length)||time<0||length<0)throw Error('Invalid vocal timing');changed.set(update.id,time);
 }
 if(sort){if(rows.some(row=>!Number.isFinite(row.time)||row.time<0))throw Error('Vocal ordering requires valid source times');const ordered=rows.map((row,index)=>({id:row.id,index,time:changed.get(row.id)??row.time})).sort((a,b)=>a.time-b.time||a.index-b.index);if(ordered.some((item,i)=>item.id!==rows[i].id))patches.push({op:'order',path:['vocals'],oldIds:rows.map(row=>row.id),newIds:ordered.map(row=>row.id)});}
 const plan=Object.freeze({changedFields:patches.filter(p=>p.op==='set').length,reordered:patches.some(p=>p.op==='order')});plans.set(plan,{project,rows,patches,expectedRows,orderTimes:sort?rows.map(row=>row.time):null});return plan;
}
// Candidate only: History's existing undo/redo consumes the identical patch
// format. Production integration must move this transaction into History itself.
export function commitVocalFieldCandidate(history,label,plan){
 const stored=plans.get(plan);if(!stored||history.project!==stored.project||history.project.vocals!==stored.rows)throw Error('Stale or forged vocal plan');const patches=stored.patches;
 if(stored.orderTimes&&(stored.rows.length!==stored.orderTimes.length||stored.rows.some((row,i)=>row.time!==stored.orderTimes[i])))throw Error('Vocal ordering keys changed after planning');
 for(const [index,expected]of stored.expectedRows)if(stored.rows[index]!==expected.row||stored.rows[index].id!==expected.id)throw Error('Vocal row changed after planning');
 for(const patch of patches){if(patch.op==='set'){const row=stored.rows[patch.path[1]],key=patch.path[2];if(own(row,key)!==patch.oldPresent||!Object.is(row[key],patch.oldValue))throw Error('Vocal field changed after planning');}else if(stored.rows.length!==patch.oldIds.length||stored.rows.some((row,i)=>row.id!==patch.oldIds[i]))throw Error('Vocal order changed after planning');}
 const bytes=64+JSON.stringify(patches).length*2;plans.delete(plan);if(!patches.length)return history.project;
 for(const patch of patches){if(patch.op==='set'){const row=stored.rows[patch.path[1]],key=patch.path[2];if(patch.newPresent)row[key]=patch.newValue;else delete row[key];}else{const byId=new Map(stored.rows.map(row=>[row.id,row]));for(let i=0;i<patch.newIds.length;i++)stored.rows[i]=byId.get(patch.newIds[i]);}}
 const beforeId=history.stateId;history.stateId=history.nextState++;history.redoStack=[];history.undoStack.push({label,patches,bytes,beforeId,afterId:history.stateId});while(history.undoStack.length>history.maxEntries||history.retainedBytes>history.maxBytes)history.undoStack.shift();history.notify();return history.project;
}
