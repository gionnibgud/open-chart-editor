import test from 'node:test';import assert from 'node:assert/strict';
import {createVocalPhrase,MAX_VOCAL_EVENTS} from '../src/vocal-tools.js';
test('original phrase preserves authored punctuation and Unicode, with bounded timing and fresh IDs',()=>{
 let n=0;const rows=createVocalPhrase(' Own-\twords + \u266b ',{at:1,step:.5,duration:3,uid:()=>`own-${++n}`});assert.deepEqual(rows.map(row=>row.text),['Own-','words','+','\u266b']);assert.deepEqual(rows.map(row=>row.time),[1,1.5,2,2.5]);assert.equal(rows.at(-1).length,.45);assert.equal(new Set(rows.map(row=>row.id)).size,4);
});
test('phrase rejects impossible timing and count before requesting IDs, without partial authoring',()=>{
 let calls=0;const uid=()=>{calls++;return `own-${calls}`;};
 for(const options of [{at:-1},{step:0},{step:NaN},{at:Infinity},{duration:0},{duration:.9},{count:MAX_VOCAL_EVENTS},{count:-1},{count:1.5}]){assert.throws(()=>createVocalPhrase('Own words',{at:0,step:.5,duration:2,uid,...options}));assert.equal(calls,0);}
 assert.throws(()=>createVocalPhrase(' \t ',{uid}),/syllable/);assert.throws(()=>createVocalPhrase('x'.repeat(1048577),{uid}),/MiB/);assert.throws(()=>createVocalPhrase('Own',{uid:()=> 'old',existingIds:['old']}),/unique/);
});
