// Uninstalled original experiment: clone/diff one explicit subtree, then retain
// ordinary History patches with prefixed paths. Existing undo/redo stays in use.
import {History} from './history.js';
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k),forbidden=new Set(['__proto__','prototype','constructor','_pack','_import']);
export function commitPathCandidate(history,label,path,edit){
 if(!(history instanceof History)||!Array.isArray(path)||!path.length||path.length>16||typeof edit!=='function')throw Error('Choose a history, existing subtree path and edit');
 let subtree=history.project;for(const key of path){if(typeof key!=='string'&&!Number.isSafeInteger(key)||typeof key==='number'&&key<0||forbidden.has(key)||!subtree||typeof subtree!=='object'||!own(subtree,key))throw Error('The explicit subtree path must exist');subtree=subtree[key];}
 if(!subtree||typeof subtree!=='object')throw Error('Choose an object subtree');
 const child=new History(subtree,{maxEntries:1,maxBytes:Number.MAX_SAFE_INTEGER});child.commit(label,edit);const entry=child.undoStack[0];if(!entry){history.notify();return history.project;}
 if(child.project!==subtree)throw Error('Replacing the subtree root is unsupported');
 const patches=entry.patches.map(patch=>({...patch,path:[...path,...patch.path]})),beforeId=history.stateId;history.stateId=history.nextState++;history.redoStack=[];const bytes=entry.bytes+patches.length*(32+path.reduce((n,key)=>n+String(key).length*2,0));history.undoStack.push({label,patches,bytes,beforeId,afterId:history.stateId});while(history.undoStack.length>history.maxEntries||history.retainedBytes>history.maxBytes)history.undoStack.shift();history.notify();return history.project;
}
