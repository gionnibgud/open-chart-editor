// Add a second original chart without replacing the backing project.
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {makeProject,makeArrangement,makeNote} from '../src/model.js';
const require=createRequire(import.meta.url),{chromium}=require(process.env.OCE_PLAYWRIGHT||'C:/Users/zagat/AppData/Roaming/npm/node_modules/rea-agents/node_modules/playwright-core');
const browser=await chromium.launch({headless:true,executablePath:process.env.OCE_CHROMIUM||'C:/Users/zagat/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe'});
const context=await browser.newContext({viewport:{width:1700,height:1050},acceptDownloads:true});await context.addInitScript(()=>Object.defineProperty(window,'showSaveFilePicker',{value:undefined}));
const page=await context.newPage(),errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
async function action(name){const button=page.locator(`[data-action="${name}"]`).first();await button.evaluate(el=>{const d=el.closest('details');if(d)d.open=true});await button.click()}
async function submit(){await page.locator('#ws-dialog-submit').click();await page.locator('#ws-dialog[open]').waitFor({state:'hidden'})}
async function snapshot(){const pending=page.waitForEvent('download');await action('saveas');await page.locator('#ws-export-format').selectOption('json');await submit();const stream=await(await pending).createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);return JSON.parse(Buffer.concat(chunks))}
let ok=false;
try{
 await page.goto(process.env.OCE_URL||'http://127.0.0.1:8766');await page.waitForSelector('#ws-app[data-mounted="true"]');const original=await snapshot();
 const incoming=makeProject(),bass=makeArrangement('bass',5);bass.id=original.arrangements[0].id;bass.name='Original imported five-string bass';bass.notes=[makeNote(bass,1.5,0,3,.75)];incoming.title='Original incoming source';incoming.beats=incoming.beats.map((beat,i)=>({...beat,time:i*.75}));incoming.duration=90;incoming.arrangements=[bass];incoming.vocals=[{id:'original-syllable',time:1.5,length:.75,text:'Original'}];
 await page.locator('#ws-import-file').setInputFiles({name:'own-bass-chart.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(incoming))});await page.waitForSelector('#ws-import-align');await page.locator('#ws-import-align').selectOption('beats');await page.locator('#ws-import-offset').fill('2');await page.locator('#ws-import-vocals').check();await submit();await page.waitForFunction(()=>document.querySelectorAll('#ws-arrangement option').length===2);
 const result=await snapshot();assert.equal(result.title,original.title);assert.equal(result.duration,original.duration);assert.deepEqual(result.beats,original.beats);assert.deepEqual(result.arrangements[0],original.arrangements[0]);assert.notEqual(result.arrangements[1].id,original.arrangements[0].id);assert.equal(result.arrangements[1].stringCount,5);assert.equal(result.arrangements[1].notes[0].time,3);assert.equal(result.arrangements[1].notes[0].sustain,.5);assert.equal(result.vocals[0].time,3);
 checks.push('Beat-aligned selected arrangement/vocals merge with offset preserves target metadata, timeline and original chart');const retained=JSON.parse(Buffer.from(result._pack.entries[result._imports[0].snapshot],'base64').toString());assert.equal(retained.title,incoming.title);assert.equal(retained.arrangements[0].notes[0].time,1.5);checks.push('Original incoming document retained in opaque source member');
 await action('undo');const restored=await snapshot();assert.deepEqual(restored.arrangements,original.arrangements);assert.deepEqual(restored.beats,original.beats);checks.push('One Undo removes imported material and restores target');
 assert.deepEqual(errors,[]);ok=true;
}finally{const out=new URL('../verification/',import.meta.url);await mkdir(out,{recursive:true});const report={ok,checks,errors};await writeFile(new URL('browser-import.json',out),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close()}
