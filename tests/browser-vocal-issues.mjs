// Original browser regression: vocal Error Finder routes, not native gameplay.
import {createRequire} from 'node:module';
import {writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {makeProject,makeNote} from '../src/model.js';
const require=createRequire(import.meta.url),{chromium}=require(process.env.OCE_PLAYWRIGHT||'C:/Users/zagat/AppData/Roaming/npm/node_modules/rea-agents/node_modules/playwright-core');
const browser=await chromium.launch({headless:true,args:['--mute-audio'],executablePath:process.env.OCE_CHROMIUM||'C:/Users/zagat/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe'});
const context=await browser.newContext({viewport:{width:1700,height:1050}});
await context.addInitScript(()=>{window.__vocalIssueSaves=[];window.showSaveFilePicker=async options=>({name:options.suggestedName,createWritable:async()=>({write:async blob=>window.__vocalIssueSaves.push(await blob.text()),close:async()=>{}})});});
const page=await context.newPage(),errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
let report={ok:false};
async function action(name){await page.locator(`[data-action="${name}"]`).first().evaluate(el=>el.click());}
async function snapshot(){const count=await page.evaluate(()=>window.__vocalIssueSaves.length);await action('saveas');await page.locator('#ws-export-format').selectOption('json');await page.locator('#ws-dialog-submit').click();await page.waitForFunction(n=>window.__vocalIssueSaves.length>n,count);return page.evaluate(()=>JSON.parse(window.__vocalIssueSaves.at(-1)));}
async function clean(){assert.equal(await page.locator('#ws-dirty').textContent(),'','Navigation must not dirty the project');}
async function findingPage(number){await page.locator('#ws-issues-page').fill(String(number));await page.locator('#ws-issues-page').press('Tab');}
async function expectFocus(id,field){await page.waitForFunction(({id,field})=>document.activeElement?.dataset.vocalId===id&&document.activeElement?.dataset.vocalField===field,{id,field});assert.equal(await page.locator(`[data-vocal-row="${id}"]`).count(),1);}
try{
 await page.goto(process.env.OCE_URL||'http://127.0.0.1:8766');await page.waitForSelector('#ws-app[data-mounted="true"]');
 const p=makeProject();p.title='Original vocal finding pagination';p.duration=30;p.beats=Array.from({length:61},(_,i)=>({time:i*.5,measure:i%4===0?1+i/4:-1}));
 const a=p.arrangements[0];a.id='own-hidden-chart';a.anchors=[{time:0,fret:1,width:4}];a.notes=[{...makeNote(a,1,0,3,.5),id:'own-active-note'}];a.activeDifficulty=4;a.difficulties=[{difficulty:0,notes:[{...makeNote(a,2,1,2,.75),id:'own-hidden-note',techniques:{vibrato:80}}],chords:[],anchors:[{time:0,fret:1,width:4}],handshapes:[],opaque:{own:'untouched'}},{difficulty:4,notes:structuredClone(a.notes),chords:[],anchors:structuredClone(a.anchors),handshapes:[]}];
 p.vocals=Array.from({length:235},(_,i)=>({id:`own-vocal-${i}`,time:i*.1,length:.05,text:i<110||i===201?'':`Own ${i}`,pitch:i%128,opaque:{index:i}}));p.vocals[145].text='é'.repeat(24);p.vocals[234].length=8;
 await page.locator('#ws-open-file').setInputFiles({name:'own-vocal-findings.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(p))});await page.waitForFunction(title=>document.querySelector('#ws-title')?.textContent.includes(title),p.title);
 const baseline=await snapshot(),initialArrangement=await page.locator('#ws-arrangement').inputValue(),initialDifficulty=await page.locator('#ws-difficulty').inputValue();await clean();await action('errors');await page.locator('#ws-validation-profile').selectOption('cdlc');
 assert.match(await page.locator('#ws-errors-label').textContent(),/Errors \(1\).*Warnings \(112\)/);assert.equal(await page.locator('[data-issue-index]').count(),100);
 await findingPage(2);assert.equal(await page.locator('[data-issue-index]').count(),13);assert.match(await page.locator('#ws-issues-range').textContent(),/101-113.*113/);
 const nativeFinding=page.locator('[data-issue-index]').filter({hasText:'this text uses 48'});assert.equal(await nativeFinding.count(),1);assert.equal(await nativeFinding.locator('td').first().textContent(),'Error');await nativeFinding.click();await expectFocus('own-vocal-145','text');assert.equal(await page.locator('[data-vocal-field="text"]').count(),100);assert.equal(await page.locator('[data-vocal-field="text"]').first().getAttribute('data-vocal-id'),'own-vocal-100');await clean();
 checks.push('The stock-CDLC 48-byte UTF-8 diagnostic on findings page 2 focuses vocal row 145 text on vocal page 2; it is an error, not an XML serialization warning');
 await page.locator('[data-issue-index]').filter({hasText:'extends beyond the song duration'}).click();await expectFocus('own-vocal-234','length');assert.equal(await page.locator('[data-vocal-field="text"]').count(),35);assert.equal(await page.locator('[data-vocal-field="text"]').first().getAttribute('data-vocal-id'),'own-vocal-200');await clean();
 // Distinguish the empty row beyond200 using the issue timestamp, not duplicate text.
 const empty=page.locator('[data-issue-index][data-issue-time="20.1"]').filter({hasText:'no lyric text'});await empty.click();await expectFocus('own-vocal-201','text');await clean();
 assert.equal(await page.locator('#ws-arrangement').inputValue(),initialArrangement);assert.equal(await page.locator('#ws-difficulty').inputValue(),initialDifficulty);assert.deepEqual(await snapshot(),baseline);
 checks.push('Over-duration and empty-text findings focus the proper field on vocal page 3; navigation stays clean and leaves every project byte, active arrangement and hidden difficulty unchanged');
 await page.locator('[data-issue-index]').filter({hasText:'this text uses 48'}).click();await expectFocus('own-vocal-145','text');const text=page.locator('[data-vocal-id="own-vocal-145"][data-vocal-field="text"]');await text.fill('Own corrected syllable');await text.press('Tab');assert.equal(await page.locator('#ws-dirty').textContent(),'●');assert.match(await page.locator('#ws-errors-label').textContent(),/Errors \(0\).*Warnings \(112\)/);
 const corrected=await snapshot();assert.equal(corrected.vocals[145].text,'Own corrected syllable');assert.deepEqual(corrected.arrangements,baseline.arrangements);assert.deepEqual(corrected.vocals.filter((_,i)=>i!==145),baseline.vocals.filter((_,i)=>i!==145));
 await action('undo');assert.match(await page.locator('#ws-errors-label').textContent(),/Errors \(1\).*Warnings \(112\)/);assert.deepEqual(await snapshot(),baseline);checks.push('Correcting the focused syllable invalidates findings, changes only that text and is fully restored by History Undo');
 assert.deepEqual(errors,[]);const sourceHashes={};for(const file of ['src/main.js','src/issue-finder.js','src/vocal-validation.js'])sourceHashes[file]=createHash('sha256').update(await readFile(new URL('../'+file,import.meta.url))).digest('hex');report={ok:true,vocalRows:235,findings:113,errors:1,warnings:112,checks,pageErrors:errors,sourceHashes,scope:'Actual local browser authoring, real JSON load/save routes, original lyrics and hidden chart fixtures; no native gameplay or retail parity claim'};
}catch(error){process.exitCode=1;report={ok:false,error:error.stack,checks,pageErrors:errors,status:await page.locator('#ws-status').textContent().catch(()=>null),active:await page.evaluate(()=>({id:document.activeElement?.dataset.vocalId,field:document.activeElement?.dataset.vocalField})).catch(()=>null)};}
finally{await writeFile(new URL('../verification/browser-vocal-issues.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close();}
