import test from 'node:test';
import assert from 'node:assert/strict';
import {chordDiagram} from '../src/chord-diagram.js';
test('extended voicing includes every string and preserves authored source, thumb and open/unused distinctions',()=>{
 for(const stringCount of [4,5,6,7,8]){const source={name:'Own shape',frets:Array.from({length:stringCount},(_,s)=>[-1,0,3,5][s%4]),fingers:Array.from({length:stringCount},(_,s)=>s%4===2?0:2),opaque:{own:'untouched'}},before=structuredClone(source),svg=chordDiagram(source);
  assert.equal((svg.match(/data-string=/g)||[]).length,stringCount);assert.match(svg,/String 1: unused/);assert.match(svg,/String 2: open/);assert.match(svg,/String 3: fret 3, thumb/);assert.match(svg,/data-finger="0"/);assert.match(svg,/>T<\/text>/);assert.deepEqual(source,before);
 }
});
test('physical labels add capo once while note positions and native relative values remain unchanged',()=>{
 const source={name:'Own capo',frets:[-1,0,7,9,7,7],fingers:[-1,-1,1,3,1,1]},relative=chordDiagram(source,{capo:2}),physical=chordDiagram(source,{capo:2,convention:'physical'});
 assert.match(relative,/String 3: fret 7/);assert.match(physical,/String 3: fret 9/);assert.match(physical,/String 2: open at capo 2/);assert.match(physical,/data-fret="7"/);
 assert.equal(relative.match(/<g data-string="2"[^]*?<circle[^]*?cy="([\d.]+)"/)[1],physical.match(/<g data-string="2"[^]*?<circle[^]*?cy="([\d.]+)"/)[1]);
 for(const capo of [21,23,24]){const svg=chordDiagram({frets:[0,0,0,0]},{capo,convention:'physical'});for(const match of svg.matchAll(/text-anchor="end"[^]*?>(\d+)<\/text>/g))assert.ok(Number(match[1])<=24,'No frets beyond physical24');}
});
test('disjoint extreme legal frets remain visible; malformed imported values reject without source repair',()=>{
 const source={frets:[1,24,0,-1],fingers:[1,4,-1,-1]},svg=chordDiagram(source);assert.match(svg,/String 2: fret 24/);assert.match(svg,/data-fret="24"/);
 for(const invalid of [NaN,Infinity,1.5,25,-2]){const value={frets:[invalid,0,0,0]};assert.throws(()=>chordDiagram(value),/invalid frets/);assert.equal(value.frets[0],invalid);}
 assert.throws(()=>chordDiagram({frets:[23,0,0,0]},{capo:2}),/invalid frets/);assert.throws(()=>chordDiagram({frets:[1,0,0,0],fingers:[5]}),/invalid fingers/);
});
test('untrusted display names are text only in title, description and accessible name',()=>{
 const svg=chordDiagram({name:'Own <script>"&\' diagram',frets:[0,1,2,3]});assert.doesNotMatch(svg,/<script>/);assert.match(svg,/&lt;script&gt;/);assert.match(svg,/&quot;&amp;&#39;/);assert.match(svg,/role="img"/);assert.match(svg,/<desc>/);
});
