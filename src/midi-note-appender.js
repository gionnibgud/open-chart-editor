// Original trusted recording-scope caller. Preparation validates sorted IDs
// once, before playback. Existing arrays/records may then change only via History.
// Aliased visible/DD arrays or shared children need the generic fallback;
// this caller does not claim a fast path for aliased source representations.
function sameData(a,b,depth=0){if(Object.is(a,b))return true;if(depth>64||!a||!b||typeof a!=='object'||typeof b!=='object'||Object.getPrototypeOf(a)!==Object.getPrototypeOf(b))return false;const keys=Reflect.ownKeys(a);if(keys.length!==Reflect.ownKeys(b).length)return false;return keys.every(key=>{const x=Object.getOwnPropertyDescriptor(a,key),y=Object.getOwnPropertyDescriptor(b,key);return x&&y&&Object.hasOwn(x,'value')&&Object.hasOwn(y,'value')&&sameData(x.value,y.value,depth+1);});}
export function prepareMidiNoteAppender(history,arrangementId,{expectedDifficulty}={}){
 const project=history.project,index=project.arrangements.findIndex(a=>a.id===arrangementId),a=project.arrangements[index];if(!a||a.activeDifficulty!==expectedDifficulty)throw Error('Captured MIDI scope changed');
 const level=a.difficulties?.findIndex(d=>d.difficulty===expectedDifficulty)??-1;if(a.difficulties?.length&&level<0)throw Error('Active DD snapshot missing');
 const paths=[['arrangements',index,'notes']];if(level>=0)paths.push(['arrangements',index,'difficulties',level,'notes']);
 const token=history.prepareArrayEdits(paths);
 if(level>=0){if(a.difficulties.some((d,i)=>!Number.isInteger(d.difficulty)||i&&a.difficulties[i-1].difficulty>=d.difficulty))throw Error('Ordered unique DD levels required');for(const key of ['notes','chords','anchors','handshapes'])if(!Array.isArray(a[key])||!Array.isArray(a.difficulties[level][key])||!sameData(a[key],a.difficulties[level][key]))throw Error('Visible and active DD content differs');}
 const arrays=paths.map(path=>path.reduce((v,key)=>v[key],project)),ids=new Set();let previous=-Infinity;
 for(const row of arrays[0]){if(!row||typeof row.id!=='string'||!row.id||ids.has(row.id)||!Number.isFinite(row.time)||row.time<previous)throw Error('Sorted unique-ID notes required');ids.add(row.id);previous=row.time;}
 if(arrays.length===2&&(arrays[0].length!==arrays[1].length||arrays[0].some((row,i)=>row.id!==arrays[1][i].id||row.time!==arrays[1][i].time)))throw Error('Visible and active DD ordering differs');
 return Object.freeze({append(note){if(history.project!==project||a.activeDifficulty!==expectedDifficulty)throw Error('Captured MIDI scope changed');if(!note||typeof note.id!=='string'||!note.id||ids.has(note.id)||!Number.isFinite(note.time)||note.time<0)throw Error('New note identity/time required');
  const operations=arrays.map((array,index)=>{let lo=0,hi=array.length;while(lo<hi){const mid=Math.floor((lo+hi)/2);if(array[mid].time<=note.time)lo=mid+1;else hi=mid;}return{array:index,start:lo,deleteCount:0,insert:[structuredClone(note)]};});
  const result=history.commitArrayEdits(token,'Record MIDI note',operations);ids.add(note.id);return result;
 }});
}
