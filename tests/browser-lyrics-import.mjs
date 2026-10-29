import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {makeProject,makeNote} from '../src/model.js';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.OCE_PLAYWRIGHT||'C:/Users/zagat/AppData/Roaming/npm/node_modules/rea-agents/node_modules/playwright-core');
const browser=await chromium.launch({headless:true,executablePath:process.env.OCE_CHROMIUM||'C:/Users/zagat/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe'});
try{
 const context=await browser.newContext({viewport:{width:1700,height:1050}});await context.addInitScript(()=>{window.__lyricsImportSaves=[];window.showSaveFilePicker=async options=>({name:options.suggestedName,createWritable:async()=>({write:async blob=>window.__lyricsImportSaves.push(await blob.text()),close:async()=>{}})});});
 const page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
 async function snapshot(){const count=await page.evaluate(()=>window.__lyricsImportSaves.length);await page.locator('[data-action="saveas"]').first().evaluate(element=>element.click());await page.locator('#ws-export-format').selectOption('json');await page.locator('#ws-dialog-submit').click();await page.waitForFunction(count=>window.__lyricsImportSaves.length>count,count);return page.evaluate(()=>JSON.parse(window.__lyricsImportSaves.at(-1)));}
 await page.goto(process.env.OCE_URL||'http://127.0.0.1:8767');await page.waitForSelector('#ws-app[data-mounted="true"]');
 const original=makeProject();original.title='Original lyric import target';original.duration=8;original.arrangements[0].notes=[makeNote(original.arrangements[0],1,0,3,.5)];original.vocals=[{id:'old-lyric',time:1,length:.5,text:'Old',pitch:60}];
 await page.locator('#ws-open-file').setInputFiles({name:'original-lyrics-target.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(original))});
 await page.waitForFunction(()=>document.querySelector('#ws-title').textContent.includes('Original lyric import target'));
 await page.locator('#ws-vocals-button').click({button:'right'});
 const menu=page.getByRole('menuitem',{name:'Import lyrics chart…'});await menu.waitFor();
 const chooserPromise=page.waitForEvent('filechooser');await menu.click();const chooser=await chooserPromise;
 assert.equal(await chooser.element().evaluate(element=>element.id),'ws-lyrics-file');
 await chooser.setFiles({name:'original-vocals.xml',mimeType:'application/xml',buffer:Buffer.from('<vocals count="2" metadata="preserved"><vocal time="2.5" length="0.4" lyric="New" note="64" extra="keep"/><vocal time="9" length="0.5" lyric="Chart" note="65"/></vocals>')});
 await page.waitForFunction(()=>document.querySelector('#ws-dialog[open] #ws-dialog-title')?.textContent==='Import lyrics');
 assert.match(await page.locator('#ws-dialog-content').textContent(),/2 lyric syllables/);
 await page.locator('#ws-dialog-submit').click();
 await page.waitForFunction(()=>document.querySelector('#ws-vocal-view:not([hidden])')&&document.querySelectorAll('#ws-vocal-view [data-vocal-row]').length===2);
 const result=await snapshot();
 assert.equal(result.title,original.title);assert.equal(result.duration,9.5);assert.deepEqual(result.arrangements,original.arrangements);assert.deepEqual(result.vocals.map(({time,length,text,pitch})=>({time,length,text,pitch})),[{time:2.5,length:.4,text:'New',pitch:64},{time:9,length:.5,text:'Chart',pitch:65}]);
 assert.match(result._vocalXml,/metadata="preserved"/);assert.match(result.vocals[0]._xml,/extra="keep"/);
 await page.keyboard.press('Control+z');
 const restored=await snapshot();
 assert.deepEqual(restored.vocals,original.vocals);assert.equal(restored.duration,original.duration);assert.deepEqual(errors,[]);
 console.log('PASS: Lyrics right-click imports native vocal XML, preserves the chart, replaces lyrics and is undoable');
}finally{await browser.close();}
