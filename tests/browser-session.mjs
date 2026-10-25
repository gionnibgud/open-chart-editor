// Session safety and destination retention through real DOM teardown.
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.OCE_PLAYWRIGHT||'C:/Users/zagat/AppData/Roaming/npm/node_modules/rea-agents/node_modules/playwright-core');
const browser=await chromium.launch({headless:true,executablePath:process.env.OCE_CHROMIUM||'C:/Users/zagat/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe'});
const context=await browser.newContext({viewport:{width:1700,height:1050}});
await context.addInitScript(()=>{
 window.__savedFiles=[];window.__pickerCalls=[];
 window.showSaveFilePicker=async options=>{window.__pickerCalls.push(options.suggestedName);const name=options.suggestedName;return{name,async createWritable(){return{async write(blob){window.__savedFiles.push({name,text:await blob.text()})},async close(){}}}}};
});
const page=await context.newPage(),errors=[],checks=[];
page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
async function action(name){const button=page.locator(`[data-action="${name}"]`).first();await button.evaluate(el=>{const details=el.closest('details');if(details)details.open=true});await button.click()}
async function submit(){await page.locator('#ws-dialog-submit').click();await page.locator('#ws-dialog[open]').waitFor({state:'hidden'})}
async function saveAs(format){const before=await page.evaluate(()=>window.__savedFiles.length);await action('saveas');await page.locator('#ws-export-format').selectOption(format);await submit();await page.waitForFunction(count=>window.__savedFiles.length>count,before)}
let ok=false;
try{
 await page.goto(process.env.OCE_URL||'http://127.0.0.1:8766');await page.waitForSelector('#ws-app[data-mounted="true"]');
 await page.locator('#ws-canvas').click({position:{x:330,y:220}});await page.keyboard.press('5');
 assert.ok(await page.locator('#ws-dirty').textContent());const title=await page.locator('#ws-title').textContent();
 await action('demo');await page.waitForSelector('#ws-dialog[open]');assert.equal(await page.locator('#ws-dialog-title').textContent(),'Replace unsaved project?');await page.locator('#ws-dialog button[value="cancel"]').click();assert.equal(await page.locator('#ws-title').textContent(),title);assert.ok(await page.locator('#ws-dirty').textContent());
 checks.push('Cancel replacement retains unsaved project');
 await saveAs('xml');assert.ok(await page.locator('#ws-dirty').textContent());await saveAs('json');assert.equal(await page.locator('#ws-dirty').textContent(),'');
 const original=JSON.parse(await page.evaluate(()=>window.__savedFiles.findLast(file=>file.name.endsWith('.json')).text));
 checks.push('XML export retains unsaved flag; complete JSON save clears it');
 await page.locator('#ws-canvas').click({position:{x:400,y:220}});await page.keyboard.press('8');
 await page.locator('#ws-zoom').fill('150');await page.locator('#ws-speed').fill('75');await page.locator('#ws-pitch').fill('-2');await page.locator('#ws-pitch').press('Tab');
 await page.locator('[data-inspector="properties"]').click();assert.equal(await page.locator('#ws-note-fret').inputValue(),'8');
 await page.evaluate(async()=>{const html=await(await fetch('/')).text(),fragment=new DOMParser().parseFromString(html,'text/html').querySelector('#ws-app');document.getElementById('ws-app').remove();await new Promise(resolve=>setTimeout(resolve,30));document.body.appendChild(document.importNode(fragment,true))});
 await page.waitForSelector('#ws-app[data-mounted="true"]');await page.waitForSelector('#ws-note-fret');assert.equal(await page.locator('#ws-note-fret').inputValue(),'8');assert.equal(await page.locator('#ws-zoom').inputValue(),'150');assert.equal(await page.locator('#ws-speed').inputValue(),'75');assert.equal(await page.locator('#ws-pitch').inputValue(),'-2');
 checks.push('DOM teardown retains selection, zoom and transport controls');
 const calls=await page.evaluate(()=>window.__pickerCalls.length);await action('undo');await action('save');await page.waitForFunction(()=>window.__savedFiles.length>=3);
 assert.equal(await page.evaluate(()=>window.__pickerCalls.length),calls);const restored=JSON.parse(await page.evaluate(()=>window.__savedFiles.at(-1).text));assert.deepEqual(restored.arrangements[0].notes,original.arrangements[0].notes);
 checks.push('Undo history and JSON destination handle survive teardown');
 await page.locator('#ws-canvas').focus();await page.keyboard.press('Control+Tab');assert.ok(await page.evaluate(()=>!!document.activeElement.closest('.ws-inspector')));await page.keyboard.press('Control+Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'ws-canvas');
 checks.push('Ctrl+Tab cycles timeline and inspector focus');
 await page.locator('#ws-inspector-divider').focus();await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowLeft');
 await page.locator('#ws-bottom-divider').focus();await page.keyboard.press('ArrowUp');
 assert.equal(await page.locator('.ws-inspector').evaluate(el=>Math.round(el.getBoundingClientRect().width)),300);assert.equal(await page.locator('#ws-bottom').evaluate(el=>Math.round(el.getBoundingClientRect().height)),165);
 await page.locator('#ws-canvas').focus();await page.keyboard.press('Control+Digit1');assert.equal(await page.locator('.ws-inspector').isVisible(),false);await page.keyboard.press('Control+Tab');assert.equal(await page.locator('.ws-inspector').isVisible(),true);
 checks.push('Panel dividers resize with keyboard and inspector shortcuts hide and restore it');
 await page.locator('#ws-canvas').focus();await page.keyboard.press('Control+Digit1');
 await page.reload();await page.waitForSelector('#ws-app[data-mounted="true"]');assert.equal(await page.locator('.ws-inspector').isVisible(),false);assert.equal(await page.locator('#ws-zoom').inputValue(),'150');assert.equal(await page.locator('#ws-speed').inputValue(),'75');assert.equal(await page.locator('#ws-pitch').inputValue(),'-2');
 await page.locator('#ws-canvas').focus();await page.keyboard.press('Control+Tab');assert.equal(await page.locator('.ws-inspector').evaluate(el=>Math.round(el.getBoundingClientRect().width)),300);assert.equal(await page.locator('#ws-bottom').evaluate(el=>Math.round(el.getBoundingClientRect().height)),165);
 checks.push('A real page reload restores layout and preview preferences independently of song data');
 assert.deepEqual(errors,[]);ok=true;
}finally{
 const out=new URL('../verification/',import.meta.url);await mkdir(out,{recursive:true});const report={ok,checks,errors,picker:'simulated writable handles; no operating-system dialog claim'};await writeFile(new URL('browser-session.json',out),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close();
}
