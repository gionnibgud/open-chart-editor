// Original controlled-latency reproduction. All authoring/API fixtures and
// writable handles are in memory; original runtime bytes are pinned per run.
import {createRequire} from 'node:module';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {makeProject} from '../src/model.js';
const require=createRequire(import.meta.url),{chromium}=require(process.env.OCE_PLAYWRIGHT||'C:/Users/zagat/AppData/Roaming/npm/node_modules/rea-agents/node_modules/playwright-core');
const root=new URL('../',import.meta.url),base=process.env.OCE_URL||'http://127.0.0.1:8766',digest=data=>createHash('sha256').update(data).digest('hex');
const stamp=Date.now().toString(36),out=new URL(`verification/modal-lifecycle/${stamp}/`,root);await mkdir(out,{recursive:true});
const temporary=new URL('owned-temp/',out);await mkdir(temporary,{recursive:true});process.env.TEMP=decodeURIComponent(temporary.pathname).replace(/^\/(\w:)/,'$1');process.env.TMP=process.env.TEMP;
const source=new Map();for(const name of await readdir(new URL('src/',root)))if(name.endsWith('.js'))source.set('/api/plugins/open_chart_editor/src/'+name,await readFile(new URL('src/'+name,root)));
for(const name of ['screen.js','assets/editor.css'])source.set('/api/plugins/open_chart_editor/'+name,await readFile(new URL(name,root)));
const screen=await readFile(new URL('screen.html',root),'utf8');
const html='<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/api/plugins/open_chart_editor/assets/editor.css"><style>html,body{margin:0;height:100%;overflow:hidden}</style></head><body>'+screen+'<script type="module" src="/api/plugins/open_chart_editor/screen.js"></script></body></html>';
const fixtures=Object.fromEntries(['A','B','C'].map(letter=>{const p=makeProject();p.title='Own lifecycle project '+letter;p.arrangements[0].phrases=[];return [letter,p];}));
const browser=await chromium.launch({headless:true,args:['--mute-audio'],executablePath:process.env.OCE_CHROMIUM||'C:/Users/zagat/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe'});
const findings=[],errors=[],contexts=[];let completed=false;
async function setup(){
 const context=await browser.newContext({viewport:{width:1700,height:1050}});contexts.push(context);
 await context.addInitScript(()=>{
  window.__lifecycleDialogs=[];window.__lifecycleSaved=[];
  const original=HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.showModal=function(){window.__lifecycleDialogs.push(this);return original.call(this);};
  window.showSaveFilePicker=async options=>({name:options.suggestedName,createWritable:async()=>({write:async blob=>window.__lifecycleSaved.push(await blob.text()),close:async()=>{}})});
 });
 const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
 let hold=null,entered=null;
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.hostname!=='127.0.0.1')return route.abort();
  if(source.has(u.pathname))return route.fulfill({body:source.get(u.pathname),contentType:u.pathname.endsWith('.css')?'text/css':'application/javascript'});
  if(u.pathname==='/')return route.fulfill({body:html,contentType:'text/html'});
  if(u.pathname.endsWith('/load')){
   const body=route.request().postDataBuffer()?.toString()||'',letter=['A','B','C'].find(k=>body.includes(`own-${k}.json`));assert.ok(letter,'Expected original in-memory fixture');
   if(letter==='B'&&hold){entered?.();await hold;}
   return route.fulfill({json:{project:fixtures[letter]}}).catch(()=>{}); // an improved lifecycle guard may abort it
  }
  if(u.pathname.endsWith('/save')){const data=route.request().postDataJSON();return route.fulfill({body:JSON.stringify(data.project),contentType:'application/json',headers:{'Content-Disposition':'attachment; filename="own-lifecycle.oce.json"'}});}
  return route.continue();
 });
 await page.goto(base);await page.waitForSelector('#ws-app[data-mounted="true"]');
 const action=async name=>page.locator(`[data-action="${name}"]`).first().evaluate(el=>el.click());
 const open=async letter=>page.locator('#ws-open-file').setInputFiles({name:`own-${letter}.json`,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixtures[letter]))});
 const waitTitle=async letter=>page.waitForFunction(title=>document.querySelector('#ws-title')?.textContent.includes(title),fixtures[letter].title);
 async function save(){const count=await page.evaluate(()=>window.__lifecycleSaved.length);await action('saveas');await page.locator('#ws-export-format').selectOption('json');await page.locator('#ws-dialog-submit').click();await page.waitForFunction(n=>window.__lifecycleSaved.length>n,count);return JSON.parse(await page.evaluate(()=>window.__lifecycleSaved.at(-1)));}
 function delayed(){let release;hold=new Promise(resolve=>release=resolve);const arrived=new Promise(resolve=>entered=resolve);return {arrived,release:()=>{release();hold=null;}};}
 await open('A');await waitTitle('A');return {page,action,open,waitTitle,save,delayed};
}
try{
 // A legitimately started load completes while an unrelated authoring modal is open.
 {
  const {page,action,open,save,delayed}=await setup(),pending=delayed();await open('B');await pending.arrived;
  await action('phrase');await page.locator('#ws-phrase-name').fill('Only intended for project A');
  pending.release();await page.waitForTimeout(150);
  const title=await page.locator('#ws-title').textContent(),stillOpen=await page.locator('#ws-dialog').evaluate(el=>el.open);
  if(stillOpen)await page.locator('#ws-dialog-submit').click();await page.waitForTimeout(40);const project=await save();
  findings.push({case:'pending-load-then-authoring-modal',titleBeforeAccept:title,modalStayedOpen:stillOpen,savedTitle:project.title,phraseNames:project.arrangements[0].phrases.map(p=>p.name),unsafe:project.title===fixtures.B.title&&project.arrangements[0].phrases.some(p=>p.name==='Only intended for project A')});
 }
 // Existing History/state guard should reject a late load after a committed edit.
 {
  const {page,open,save,delayed}=await setup(),pending=delayed();await open('B');await pending.arrived;
  await page.locator('[data-inspector="settings"]').click();await page.locator('#ws-meta-title').fill('Own latest committed edit');await page.locator('#ws-meta-title').dispatchEvent('change');
  pending.release();await page.waitForTimeout(150);
  const project=await save();assert.equal(project.title,'Own latest committed edit');findings.push({case:'committed-edit-during-load-control',unsafe:false,savedTitle:project.title,status:await page.locator('#ws-status').textContent()});
 }
 // Ordinary unmount should settle/cancel an owned modal. A retained test-only
 // reference provides a controlled late-close event; it is not a user gesture.
 {
  const {page,action,save}=await setup();await action('phrase');await page.locator('#ws-phrase-name').fill('Detached project-A modal');
  await page.evaluate(async()=>{window.__auditDetachedDialog=document.getElementById('ws-dialog');const html=await(await fetch('/')).text();const fresh=new DOMParser().parseFromString(html,'text/html').querySelector('#ws-app');document.getElementById('ws-app').remove();await new Promise(resolve=>setTimeout(resolve,40));document.body.append(document.importNode(fresh,true));});
  await page.waitForSelector('#ws-app[data-mounted="true"]');
  const detached=await page.evaluate(()=>({open:window.__auditDetachedDialog.open,connected:window.__auditDetachedDialog.isConnected,returnValue:window.__auditDetachedDialog.returnValue}));
  await page.evaluate(()=>window.__auditDetachedDialog.close('ok'));await page.waitForTimeout(80);const project=await save();
  findings.push({case:'unmount-owned-modal-late-close',trigger:'Controlled late close on a test-retained detached dialog node; not ordinary user input',detached,phraseNames:project.arrangements[0].phrases.map(p=>p.name),unsafe:project.arrangements[0].phrases.some(p=>p.name==='Detached project-A modal')});
 }
 completed=true;
}finally{
 const report={harnessCompleted:completed,safetyPassed:completed&&!findings.some(f=>f.unsafe),findings,errors,scope:'Pinned original runtime files, in-memory original projects, mocked local load/save and simulated writable handles; no real save destination, target app or user source file modified.',sourceHashes:Object.fromEntries([...source].map(([name,bytes])=>[name,digest(bytes)])),screenSha256:digest(screen),currentDiskMainSha256:digest(await readFile(new URL('src/main.js',root))),capturedMainSha256:digest(source.get('/api/plugins/open_chart_editor/src/main.js'))};
 await writeFile(new URL('report.json',out),JSON.stringify(report,null,2));await writeFile(new URL('verification/browser-modal-lifecycle-audit.json',root),JSON.stringify({...report,run:String(out)},null,2));console.log(JSON.stringify({report:String(out),harnessCompleted:completed,safetyPassed:report.safetyPassed,findings,errors,capturedMainSha256:report.capturedMainSha256},null,2));for(const context of contexts)await context.close();await browser.close();
 if(completed&&report.safetyPassed===false)process.exitCode=1;
}
