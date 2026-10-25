import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {makeProject} from '../src/model.js';
const require=createRequire(import.meta.url),{chromium}=require(process.env.OCE_PLAYWRIGHT||'C:/Users/zagat/AppData/Roaming/npm/node_modules/rea-agents/node_modules/playwright-core');
const browser=await chromium.launch({headless:true,executablePath:process.env.OCE_CHROMIUM||'C:/Users/zagat/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe'}),checks=[],errors=[];let ok=false;
async function run(phase){
 const context=await browser.newContext({viewport:{width:1700,height:1050}});await context.addInitScript(()=>{
  window.__writes=[];window.__pickers=[];window.__holdWrite=false;
  window.showSaveFilePicker=async options=>{const name=options.suggestedName;window.__pickers.push(name);return {name,createWritable:async()=>({write:async blob=>{if(window.__holdWrite){window.__holdWrite=false;window.__writePending=true;await new Promise(resolve=>window.__releaseWrite=resolve);}window.__writes.push({name,text:await blob.text()});},close:async()=>{}})};};
 });const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 const action=async name=>page.locator(`[data-action="${name}"]`).first().evaluate(el=>el.click());
 const open=async(title,name)=>{const p=makeProject();p.title=title;await page.locator('#ws-open-file').setInputFiles({name,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(p))});await page.waitForFunction(name=>document.querySelector('#ws-status').textContent.startsWith(`Opened ${name}`),name);};
 try{
  await page.goto(process.env.OCE_URL||'http://127.0.0.1:8766');await page.waitForSelector('#ws-app[data-mounted="true"]');await open(`A-${phase}`,`incoming-A-${phase}.json`);
  if(phase==='remount'){await page.locator('#ws-meta-artist').fill('Original edited artist');await page.locator('#ws-meta-artist').dispatchEvent('change');}
  let release,seen;const reached=new Promise(resolve=>seen=resolve);
  if(phase==='response'||phase==='remount'){let first=true;await page.route('**/api/plugins/open_chart_editor/save',async route=>{if(first){first=false;seen();await new Promise(resolve=>release=resolve);}await route.continue();});}
  else await page.evaluate(()=>window.__holdWrite=true);
  await action('saveas');await page.locator('#ws-export-format').selectOption('json');await page.locator('#ws-dialog-submit').click();
  if(phase==='writer')await page.waitForFunction(()=>window.__writePending);else await reached;
  if(phase==='remount'){
   await page.evaluate(async()=>{const html=await(await fetch('/')).text(),fragment=new DOMParser().parseFromString(html,'text/html').querySelector('#ws-app');document.querySelector('#ws-app').remove();await new Promise(resolve=>setTimeout(resolve,30));document.body.append(document.importNode(fragment,true));});await page.waitForSelector('#ws-app[data-mounted="true"]');assert.ok(await page.locator('#ws-dirty').textContent());
  }else await open(`B-${phase}`,`incoming-B-${phase}.json`);
  if(phase==='writer')await page.evaluate(()=>window.__releaseWrite());else release();
  await page.waitForFunction(()=>window.__writes.length===1);assert.equal(await page.evaluate(()=>JSON.parse(window.__writes[0].text).title),`A-${phase}`);
  await page.waitForFunction(async name=>{const {createRecentProjects}=await import('/api/plugins/open_chart_editor/src/recent-projects.js');return (await createRecentProjects().list()).entries.some(entry=>entry.name===name);},`A-${phase}.json`);
  if(phase==='remount'){
   await page.waitForFunction(()=>document.querySelector('#ws-dirty').textContent==='');await action('save');await page.waitForFunction(()=>window.__writes.length===2);assert.equal(await page.evaluate(()=>window.__pickers.length),1);checks.push('A save completing after same-project DOM remount updates its retained destination and clean state');
  }else{
   const cache=await page.evaluate(async name=>{const {createRecentProjects}=await import('/api/plugins/open_chart_editor/src/recent-projects.js'),store=createRecentProjects(),listed=await store.list(),entry=listed.entries.find(entry=>entry.name===name);return entry?JSON.parse(await(await store.read(entry.id)).file.text()):null;},`incoming-B-${phase}.json`);assert.equal(cache?.title,`B-${phase}`,'Previous save must not replace the newly opened project in Recent');
   await page.locator('#ws-meta-artist').fill('Newest original project');await page.locator('#ws-meta-artist').dispatchEvent('change');await action('save');await page.waitForFunction(()=>window.__writes.length===2);assert.equal(await page.evaluate(()=>window.__pickers.length),2,'New project needs its own save destination');assert.equal(await page.evaluate(()=>window.__writes[1].name),`B-${phase}.json`);assert.equal(await page.evaluate(()=>JSON.parse(window.__writes[1].text).title),`B-${phase}`);checks.push(`A previous save delayed in ${phase} finishes its requested output without changing the next project's cache or destination`);
  }
 }finally{await context.close();}
}
async function concurrent(){
 const context=await browser.newContext({viewport:{width:1700,height:1050}});await context.addInitScript(()=>{window.__writes=[];window.__pickers=0;window.showSaveFilePicker=async options=>{window.__pickers++;return {name:options.suggestedName,createWritable:async()=>({write:async blob=>window.__writes.push(await blob.text()),close:async()=>{}})};};});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(process.env.OCE_URL||'http://127.0.0.1:8766');await page.waitForSelector('#ws-app[data-mounted="true"]');const action=async()=>page.locator('[data-action="save"]').first().evaluate(el=>el.click());await action();await page.waitForFunction(()=>window.__writes.length===1);await page.waitForFunction(()=>document.querySelector('#ws-status').textContent.startsWith('Saved'));
  const artist=async text=>{await page.locator('#ws-meta-artist').fill(text);await page.locator('#ws-meta-artist').dispatchEvent('change');};await artist('First original edit');let release,seen,first=true;const reached=new Promise(resolve=>seen=resolve);await page.route('**/api/plugins/open_chart_editor/save',async route=>{if(first){first=false;seen();await new Promise(resolve=>release=resolve);}await route.continue();});await action();await reached;await artist('Newest original edit');const response=page.waitForResponse(r=>r.url().endsWith('/save'));await action();assert.equal((await response).status(),200);assert.equal(await page.evaluate(()=>window.__writes.length),1);release();await page.waitForFunction(()=>window.__writes.length===3);await page.waitForFunction(()=>document.querySelector('#ws-dirty').textContent==='');assert.deepEqual(await page.evaluate(()=>window.__writes.slice(1).map(text=>JSON.parse(text).artist)),['First original edit','Newest original edit']);assert.equal(await page.evaluate(()=>window.__pickers),1);checks.push('Reversed responses for two edits to the same native destination preserve request order and leave the newest file current');
 }finally{await context.close();}
}
try{for(const phase of ['response','writer','remount'])await run(phase);await concurrent();assert.deepEqual(errors,[]);ok=true;}finally{await mkdir(new URL('../verification/',import.meta.url),{recursive:true});const report={ok,checks,errors,scope:'Real browser lifecycle and simulated native writable handles; no physical operating-system picker claim'};await writeFile(new URL('../verification/browser-save-context.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close();}
