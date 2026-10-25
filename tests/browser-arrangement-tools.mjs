// Arrangement menu in a real browser: clone, lock (edits refused), hide (greyed, left out
// of the DLC Builder selection), delete, and combine four Guitar Pro style parts into one
// chart with tone changes, overlap decisions, highlights and Error Finder warnings.
// OCE_URL defaults to the 8767 candidate; OCE_ARR_SHOTS saves screenshots.
import {createRequire} from 'node:module';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {makeProject,makeArrangement,makeNote} from '../src/model.js';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.OCE_PLAYWRIGHT||'C:/Users/zagat/AppData/Roaming/npm/node_modules/rea-agents/node_modules/playwright-core');

const p=makeProject();p.title='Arrangement tools';p.artist='Original';p.duration=30;
const part=(name,notes)=>{const a=makeArrangement('guitar');a.name=name;a.notes=notes.map(([t,s,f,sus=0])=>makeNote(a,t,s,f,sus));return a;};
p.arrangements=[part('Acoustic',[[0,0,3],[1,1,2],[2,2,0,.5]]),part('Rhythm',[[4,0,5],[5,1,7],[6,2,7,.4],[10,0,5,1.5],[11,1,7]]),part('Lead',[[6,2,7,.4],[10.5,4,12],[11,5,15,.5],[13,5,17]]),part('Delay',[[16,3,9],[17,3,11]])];
const dir=await mkdtemp(path.join(tmpdir(),'arr-tools-'));const file=path.join(dir,'arr.json');await writeFile(file,JSON.stringify(p));

const browser=await chromium.launch({headless:true,executablePath:process.env.OCE_CHROMIUM||'C:/Users/zagat/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe'});
const page=await (await browser.newContext({viewport:{width:1500,height:1000}})).newPage(),errors=[],results=[],shots=process.env.OCE_ARR_SHOTS;
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
const action=name=>page.locator(`[data-action="${name}"]`).first().evaluate(el=>el.click());
const options=()=>page.$$eval('#ws-arrangement option',els=>els.map(el=>el.textContent));
const current=()=>page.$eval('#ws-arrangement option:checked',el=>el.textContent);
const status=()=>page.locator('#ws-status').textContent();
const notes=async()=>Number((await page.locator('#ws-difficulty option:checked').textContent()).match(/(\d+) notes/)[1]);
const pick=name=>page.evaluate(name=>{const el=document.querySelector('#ws-arrangement'),option=[...el.options].find(o=>o.textContent.startsWith(name));el.value=option.value;el.dispatchEvent(new Event('change',{bubbles:true}));},name);
try{
 await page.goto(process.env.OCE_URL||'http://127.0.0.1:8767');await page.waitForSelector('#ws-app[data-mounted="true"]');
 await page.locator('#ws-open-file').setInputFiles(file);await page.waitForFunction(()=>document.querySelector('#ws-title').textContent.includes('Arrangement tools'));

 await action('arr-clone');assert.equal((await options()).length,5);assert.match(await current(),/^Acoustic copy/);results.push('Clone makes an editable copy and selects it');
 await action('arr-delete');await page.locator('#ws-dialog-submit').click();await page.waitForFunction(()=>document.querySelectorAll('#ws-arrangement option').length===4);results.push('Delete (with confirmation)');

 await pick('Acoustic');await action('arr-lock');assert.match(await current(),/· locked/);
 const before=await notes();await page.locator('#ws-timeline').focus().catch(()=>{});await page.mouse.click(700,400);await page.keyboard.press('5');
 assert.equal(await notes(),before,'locked: fret key adds nothing');assert.match(await status(),/locked/);
 await action('arr-delete');await page.waitForFunction(()=>/locked/.test(document.querySelector('#ws-status').textContent));assert.equal((await options()).length,4);
 await action('arr-lock');assert.doesNotMatch(await current(),/locked/);results.push('Lock refuses note entry and deletion; unlock restores editing');

 await pick('Delay');await action('arr-hide');assert.match(await current(),/· hidden/);
 assert.equal(await page.$eval('#ws-arrangement option:checked',el=>el.style.color),'rgb(124, 129, 144)','hidden part greyed');
 await action('saveas');await page.locator('#ws-export-format').selectOption('rs2014_sources');
 assert.match(await page.locator('#ws-source-options').textContent(),/Delay · guitar \(hidden\)/);
 await page.locator('#ws-dialog').evaluate(d=>d.close('cancel'));await action('arr-hide');assert.doesNotMatch(await current(),/hidden/);
 results.push('Hide greys the part and keeps it out of the DLC Builder selection; unhide');

 await pick('Acoustic');await action('arr-combine');await page.waitForSelector('#ws-combine-check');
 await page.locator('[data-combine-tone]').nth(3).fill('Écho');
 await page.locator('#ws-combine-check').click();await page.waitForSelector('[data-combine-decision]');
 assert.match(await page.locator('#ws-combine-overlaps').textContent(),/2 overlaps \(1 identical\)/);
 const decisions=page.locator('[data-combine-decision]');await decisions.nth(1).selectOption({label:'Keep Lead'});
 if(shots)await page.locator('#ws-dialog').screenshot({path:path.join(shots,'combine-dialog.png')});
 await page.locator('#ws-dialog-submit').click();
 await page.waitForFunction(()=>/Combined Acoustic, Rhythm, Lead, Delay/.test(document.querySelector('#ws-status').textContent));
 assert.match(await status(),/11 notes, 0 chords, 3 tone changes, 3 overlapping events left out/);
 assert.match(await current(),/^Acoustic combined/);
 assert.equal((await options()).filter(o=>o.includes('· hidden')).length,4,'sources hidden');
 assert.equal(await notes(),11);
 await action('errors');await page.waitForTimeout(200);
 assert.match(await page.locator('#ws-bottom').textContent(),/Combined parts overlapped here \(Rhythm, Lead\): kept Lead/);
 if(shots)await page.screenshot({path:path.join(shots,'combined.png')});
 results.push('Combine: 4 parts into 1 chart, 3 tone changes, overlap decisions applied, sources hidden, overlaps in the Error Finder');

 await action('combine-clear');await page.waitForTimeout(150);
 assert.doesNotMatch(await page.locator('#ws-bottom').textContent(),/Combined parts overlapped/);results.push('Clear overlap highlights');
 for(let i=0;i<2;i++){await page.keyboard.press('Escape');}
 await page.evaluate(()=>document.querySelector('[data-action="undo"]').click());await page.evaluate(()=>document.querySelector('[data-action="undo"]').click());
 await page.waitForFunction(()=>document.querySelectorAll('#ws-arrangement option').length===4);
 assert.equal((await options()).filter(o=>o.includes('· hidden')).length,0);results.push('Undo removes the combined chart and unhides the sources');
 assert.deepEqual(errors,[],'no page errors');
 console.log(results.map(r=>'ok - '+r).join('\n'));
}finally{await browser.close();}
