import test from 'node:test';
import assert from 'node:assert/strict';
import {OrderedSaves} from '../src/ordered-saves.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
test('reversed backend responses still write the same native file in request order',async()=>{
 const saves=new OrderedSaves(),old=deferred(),next=deferred(),writes=[],handle={};
 const a=saves.run(handle,old.promise,value=>writes.push(value)),b=saves.run(handle,next.promise,value=>writes.push(value));next.resolve('newest');await new Promise(resolve=>setTimeout(resolve,5));assert.deepEqual(writes,[]);old.resolve('previous');await Promise.all([a,b]);assert.deepEqual(writes,['previous','newest']);assert.equal(saves.queues.size,0);
});
test('distinct handles for one native entry share order while independent files remain responsive',async()=>{
 const saves=new OrderedSaves(),blocked=deferred(),writes=[],first={id:'same'},alias={id:'same',isSameEntry:async other=>other.id==='same'},other={id:'different',isSameEntry:async other=>other.id==='different'};
 const a=saves.run(first,blocked.promise,value=>writes.push(value)),b=saves.run(alias,Promise.resolve('alias-newest'),value=>writes.push(value)),c=saves.run(other,Promise.resolve('independent'),value=>writes.push(value));await c;assert.deepEqual(writes,['independent']);blocked.resolve('same-old');await Promise.all([a,b]);assert.deepEqual(writes,['independent','same-old','alias-newest']);
});
test('failed backend or writable output releases the queue and downloads need no native reservation',async()=>{
 const saves=new OrderedSaves(),handle={};const failed=saves.run(handle,Promise.reject(Error('backend failed')),()=>assert.fail());const later=saves.run(handle,Promise.resolve('valid'),value=>value);await assert.rejects(failed,/backend failed/);assert.equal(await later,'valid');await assert.rejects(saves.run(handle,Promise.resolve('x'),()=>{throw Error('write failed');}),/write failed/);assert.equal(await saves.run(handle,Promise.resolve('retry'),value=>value),'retry');assert.equal(await saves.run(null,Promise.resolve('download'),value=>value),'download');assert.equal(saves.queues.size,0);
});
