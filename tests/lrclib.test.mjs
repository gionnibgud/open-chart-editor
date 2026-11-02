// LRCLIB search client (src/lrclib.js): request shape, response normalization, and
// turning a result into plain sheet text.
import test from 'node:test';
import assert from 'node:assert/strict';
import {searchLyrics,stripLrcTimestamps,sheetTextFor,CLIENT_HEADER} from '../src/lrclib.js';

function fakeFetch(handler){return async(url,options)=>handler(url,options);}

test('search sends the client header and the given fields as query params', async()=>{
 let seen;
 const fetchImpl=fakeFetch((url,options)=>{seen={url,options};return {ok:true,status:200,json:async()=>[]};});
 await searchLyrics({trackName:'Clocks',artistName:'Coldplay'},{fetchImpl});
 assert.ok(seen.url.startsWith('https://lrclib.net/api/search?'));
 assert.ok(seen.url.includes('track_name=Clocks'));
 assert.ok(seen.url.includes('artist_name=Coldplay'));
 assert.equal(seen.options.headers[CLIENT_HEADER],'open-chart-editor (https://github.com/zagatozee/open-chart-editor)');
});

test('refuses to search with nothing to search for', async()=>{
 await assert.rejects(()=>searchLyrics({},{fetchImpl:fakeFetch(()=>{throw Error('should not be called');})}),/Type a song title or artist/);
});

test('normalizes a result row and reports rate limiting with Retry-After', async()=>{
 const row={id:1,trackName:'Clocks',artistName:'Coldplay',albumName:'A Rush of Blood',duration:307,instrumental:false,plainLyrics:'Lights go out',syncedLyrics:'[00:12.34]Lights go out'};
 const ok=fakeFetch(()=>({ok:true,status:200,json:async()=>[row]}));
 const [result]=await searchLyrics({q:'clocks'},{fetchImpl:ok});
 assert.deepEqual(result,row);

 const limited=fakeFetch(()=>({ok:false,status:429,headers:{get:name=>name==='Retry-After'?'5':null}}));
 await assert.rejects(()=>searchLyrics({q:'clocks'},{fetchImpl:limited}),/retry in about 5s/);
});

test('rejects a non-ok, non-429 response and a malformed body', async()=>{
 await assert.rejects(()=>searchLyrics({q:'x'},{fetchImpl:fakeFetch(()=>({ok:false,status:500,headers:{get:()=>null}}))}),/failed \(500\)/);
 await assert.rejects(()=>searchLyrics({q:'x'},{fetchImpl:fakeFetch(()=>({ok:true,status:200,json:async()=>({not:'an array'})}))}),/unexpected response/);
});

test('strips LRC timestamps down to plain lines', ()=>{
 assert.equal(stripLrcTimestamps('[00:12.34]Lights go out\n[00:15.00]Said the lady'),'Lights go out\nSaid the lady');
});

test('sheetTextFor prefers plain lyrics, falls back to stripped synced lyrics, else empty', ()=>{
 assert.equal(sheetTextFor({plainLyrics:'Lights go out',syncedLyrics:'[00:12.34]Other'}),'Lights go out');
 assert.equal(sheetTextFor({plainLyrics:'',syncedLyrics:'[00:12.34]Lights go out'}),'Lights go out');
 assert.equal(sheetTextFor({plainLyrics:'',syncedLyrics:''}),'');
});
