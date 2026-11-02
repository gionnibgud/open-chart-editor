// Lyrics tab: Search LRCLIB for lyrics (src/lrclib.js UI wiring). The network call is
// mocked via page.route so the test never depends on lrclib.net being reachable.
// OCE_URL defaults to the 8767 candidate.
import {createRequire} from 'node:module';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {makeProject} from '../src/model.js';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.OCE_PLAYWRIGHT||'C:/Users/zagat/AppData/Roaming/npm/node_modules/rea-agents/node_modules/playwright-core');

const dir=await mkdtemp(path.join(tmpdir(),'lrclib-'));
const project=makeProject();project.title='Clocks';project.artist='Coldplay';project.duration=20;
const json=path.join(dir,'song.json');await writeFile(json,JSON.stringify(project));

const browser=await chromium.launch({headless:true,executablePath:process.env.OCE_CHROMIUM||'C:/Users/zagat/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe'});
const page=await (await browser.newContext({viewport:{width:1500,height:1000}})).newPage(),errors=[],results=[];
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
try{
 await page.goto(process.env.OCE_URL||'http://127.0.0.1:8767');await page.waitForSelector('#ws-app[data-mounted="true"]');
 await page.locator('#ws-open-file').setInputFiles(json);await page.waitForFunction(()=>document.querySelector('#ws-title').textContent.includes('Clocks'));
 await page.locator('#ws-vocals-button').click();await page.waitForSelector('#ws-lyric-sheet');

 await page.locator('#ws-lrclib').locator('summary').click();
 assert.equal(await page.locator('#ws-lrclib-track').inputValue(),'Clocks');
 assert.equal(await page.locator('#ws-lrclib-artist').inputValue(),'Coldplay');
 results.push('search fields prefill from the project title/artist');

 let seenHeader,seenUrl;
 await page.route('https://lrclib.net/api/search*',route=>{
  seenUrl=route.request().url();seenHeader=route.request().headers()['lrclib-client'];
  route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([
   {id:1,trackName:'Clocks',artistName:'Coldplay',albumName:'A Rush of Blood to the Head',duration:307,instrumental:false,plainLyrics:'Lights go out\nAnd I can\'t be saved',syncedLyrics:'[00:12.00]Lights go out'},
   {id:2,trackName:'Clocks (Instrumental)',artistName:'Coldplay',albumName:'',duration:307,instrumental:true,plainLyrics:'',syncedLyrics:''},
  ])});
 });
 await page.locator('[data-lyric="lrclib-search"]').click();
 await page.waitForSelector('.ws-lrclib-result');
 assert.ok(seenUrl.includes('track_name=Clocks')&&seenUrl.includes('artist_name=Coldplay'),'request carried the search fields');
 assert.ok(seenHeader,'request carried the Lrclib-Client identification header');
 const rowCount=await page.locator('.ws-lrclib-result').count();assert.equal(rowCount,2);
 assert.ok(await page.locator('.ws-lrclib-result').nth(1).locator('[data-lrclib-use]').isDisabled(),'instrumental result with no lyric text cannot be used');
 results.push('two results rendered; the textless instrumental result is not usable');

 await page.locator('.ws-lrclib-result').nth(0).locator('[data-lrclib-use]').click();
 assert.equal(await page.locator('#ws-lyric-sheet').inputValue(),"Lights go out\nAnd I can't be saved");
 results.push('Use these lyrics places plainLyrics into the sheet, untouched until Apply text');

 // A rate-limited response surfaces inline rather than throwing past the UI.
 // Retry-After only reaches page JS on a cross-origin fetch if the server exposes it via CORS.
 await page.route('https://lrclib.net/api/search*',route=>route.fulfill({status:429,headers:{'Retry-After':'7','Access-Control-Expose-Headers':'Retry-After'},body:''}));
 await page.locator('[data-lyric="lrclib-search"]').click();
 await page.waitForFunction(()=>/retry in about 7s/.test(document.querySelector('#ws-lrclib-results')?.textContent||''));
 results.push('rate limiting is reported inline with Retry-After');

 assert.deepEqual(errors,[],'no page errors');
 console.log(results.map(r=>'ok - '+r).join('\n'));
}finally{await browser.close();}
