// Actual DOM/HTTP exports; picker handles are controlled test doubles.
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {makeProject,makeArrangement,makeNote} from '../src/model.js';
import {renderGuide} from '../src/render-guide.js';
import {decodeFolderTree} from '../src/folder-files.js';

if(process.env.OCE_OUTPUT_RELEASE!=='1')throw Error('Parent source/browser release required');
const root=resolve(new URL('..',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
const out=join(root,'verification','output-targets-'+randomUUID());await mkdir(out,{recursive:true});
const require=createRequire(import.meta.url),{chromium}=require(process.env.OCE_PLAYWRIGHT||'C:/Users/zagat/AppData/Roaming/npm/node_modules/rea-agents/node_modules/playwright-core');
const browser=await chromium.launch({headless:true,executablePath:process.env.OCE_CHROMIUM||'C:/Users/zagat/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe',args:['--mute-audio']});
const context=await browser.newContext({viewport:{width:1700,height:1050},acceptDownloads:true});
await context.addInitScript(()=>{
 window.showSaveFilePicker=undefined;window.__folderFiles={};window.__folderWrites=0;
 const directory=path=>({kind:'directory',name:path.split('/').at(-1),async isSameEntry(other){return other===this;},async getDirectoryHandle(name,{create}={}){if(!create){const e=Error('not found');e.name='NotFoundError';throw e;}window.__folderWrites++;return directory(path+'/'+name);},async getFileHandle(name){return{async createWritable(){return{async write(bytes){window.__folderFiles[path+'/'+name]=Array.from(bytes);},async close(){},async abort(){}};}};}});
 window.showDirectoryPicker=async()=>directory('chosen');
 const Native=AudioContext;window.AudioContext=class extends Native{constructor(options={}){super({...options,sinkId:{type:'none'}});}};
 navigator.requestMIDIAccess=async()=>{throw Error('No hardware during verification');};if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{throw Error('No capture during verification');};
});
const page=await context.newPage(),errors=[],requests=[],checks=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
const url=process.env.OCE_URL||'http://127.0.0.1:8767';
const action=name=>page.locator(`[data-action="${name}"]`).first().evaluate(el=>el.click());
async function acceptReplace(name){await page.waitForFunction(name=>document.querySelector('#ws-status').textContent.startsWith('Opened '+name)||(document.querySelector('#ws-dialog').open&&document.querySelector('#ws-dialog-title').textContent==='Replace unsaved project?'),name);if(await page.locator('#ws-dialog[open]').count()&&await page.locator('#ws-dialog-title').textContent()==='Replace unsaved project?')await page.locator('#ws-dialog-submit').click();}
async function openFile(bytes,name){await page.locator('#ws-open-file').setInputFiles({name,mimeType:'application/json',buffer:bytes});await acceptReplace(name);await page.waitForFunction(name=>document.querySelector('#ws-status').textContent.startsWith('Opened '+name),name);}
async function save(format,delivery='file'){
 await action('saveas');await page.locator('#ws-export-format').selectOption(format);if(['feedpak','feedback_loose','rs2014_sources'].includes(format))await page.locator('#ws-export-delivery').selectOption(delivery);
 const pending=delivery==='file'?page.waitForEvent('download'):null;pending?.catch(()=>{});await page.locator('#ws-dialog-submit').click();
 if(delivery==='folder'){await page.waitForFunction(()=>document.querySelector('#ws-status').textContent.startsWith('Saved chosen / '));return await page.evaluate(()=>window.__folderFiles);}
 const download=await pending,parts=[];for await(const bytes of await download.createReadStream())parts.push(bytes);const result=Buffer.concat(parts);await writeFile(join(out,download.suggestedFilename()),result);return result;
}
const hashes={};for(const name of ['src/main.js','src/model.js','src/folder-files.js','routes.py','pack_io.py','export_targets.py','feedpak_contract.py'])hashes[name]=createHash('sha256').update(await readFile(join(root,name))).digest('hex');
let ok=false;
try{
 await page.goto(url);await page.waitForSelector('#ws-app[data-mounted="true"]');
 const project=makeProject();project.title='Original twelve-part output study';project.duration=3;project.beats=project.beats.filter(b=>b.time<=3);project.arrangements=[];
 for(const family of ['guitar','bass'])for(const count of [4,5,6,7,8]){const part=makeArrangement(family,count,{instrument:family==='guitar'?'Own fretted instrument':'Own bass instrument'});part.name=family+' '+count;part.notes=[makeNote(part,.5,0,3,.25),makeNote(part,1,count-1,7,.25)];project.arrangements.push(part);}
 const keys=makeArrangement('keys');keys.notes=[makeNote(keys,.5,0,0,.25),makeNote(keys,1,127,0,.25)];const drums=makeArrangement('drums');drums.notes=[makeNote(drums,.5,0,0,0)];project.arrangements.push(keys,drums);project.vocals=[{id:'own-syllable',time:.5,length:.4,text:'Own',pitch:60}];
 await openFile(Buffer.from(JSON.stringify(project)),'own-output-study.json');assert.equal(await page.locator('#ws-arrangement option').count(),12);
 const wav=Buffer.from(renderGuide(project,{sampleRate:8000,duration:3}));await page.locator('#ws-audio-file').setInputFiles({name:'own-output.wav',mimeType:'audio/wav',buffer:wav});await page.waitForFunction(()=>document.querySelector('#ws-status').textContent==='Audio ready: own-output.wav');
 await action('saveas');await page.locator('#ws-export-format').selectOption('rs2014_sources');assert.equal(await page.locator('[data-export-arr]:enabled').count(),2);assert.equal(await page.locator('[data-export-arr]:disabled').count(),10);await page.locator('#ws-dialog').evaluate(d=>d.close('cancel'));checks.push('Source selection exposes exact stock guitar6/bass4 compatibility and retains other ten parts');
 const sources=await save('rs2014_sources');assert.equal(sources.readUInt16LE(0),0x4b50);checks.push('Actual Save As downloads source ZIP without calling the PSARC builder');
 const loose=await save('feedback_loose');assert.equal(loose.readUInt16LE(0),0x4b50);checks.push('Actual Save As downloads typed loose-folder content');
 const feedpak=await save('feedpak');const form=new FormData();form.append('file',new Blob([feedpak]),'own.feedpak');let response=await fetch(url+'/api/plugins/open_chart_editor/load',{method:'POST',body:form});assert.equal(response.status,200,await response.clone().text());let loaded=(await response.json()).project;assert.equal(loaded.arrangements.length,12);assert.deepEqual(loaded.arrangements.map(a=>[a.type,a.stringCount]),project.arrangements.map(a=>[a.type,a.stringCount]));assert.deepEqual(loaded.arrangements.find(a=>a.type==='keys').notes.map(n=>n.pitch),[0,127]);checks.push('Packaged FeedPak reopens all ten fretted layouts, piano endpoints and drums');
 const files=await save('feedpak','folder'),prefix=Object.keys(files)[0].split('/').slice(0,2).join('/');assert.match(prefix,/\.feedpak$/);const folder=join(out,'own-roundtrip.feedpak');await mkdir(folder);
 for(const [path,data]of Object.entries(files)){assert.ok(path.startsWith(prefix+'/'));const relative=path.slice(prefix.length+1);await decodeFolderTree({version:1,entries:[{path:relative,size:data.length,base64:Buffer.from(data).toString('base64'),sha256:createHash('sha256').update(Buffer.from(data)).digest('hex')}]});const dest=join(folder,relative);assert.ok(resolve(dest).startsWith(resolve(folder)+"\\"));await mkdir(resolve(dest,'..'),{recursive:true});await writeFile(dest,Buffer.from(data));}
 await page.locator('#ws-open-folder').setInputFiles(folder);await acceptReplace('own-roundtrip.feedpak.oce-folder.zip');await page.waitForFunction(()=>document.querySelector('#ws-status').textContent.startsWith('Opened own-roundtrip.feedpak.oce-folder.zip'));assert.equal(await page.locator('#ws-arrangement option').count(),12);checks.push('Folder destination writes verified bytes and actual folder input reopens them through HTTP');
 const master=JSON.parse(await save('json'));assert.equal(master.arrangements.length,12);assert.equal(master.arrangements.find(a=>a.type==='bass'&&a.stringCount===8).notes[1].string,7);checks.push('Editable JSON after folder roundtrip retains high-string events and all parts');
 for(const format of ['rs2014_sources','feedback_loose']){
  await page.evaluate(()=>window.__folderFiles={});const captured=await save(format,'folder'),prefix=Object.keys(captured)[0].split('/').slice(0,2).join('/'),folder=join(out,format);await mkdir(folder);
  for(const [path,data]of Object.entries(captured)){assert.ok(path.startsWith(prefix+'/'));const relative=path.slice(prefix.length+1),dest=join(folder,relative);assert.ok(resolve(dest).startsWith(resolve(folder)+"\\"));await mkdir(resolve(dest,'..'),{recursive:true});await writeFile(dest,Buffer.from(data));}
  assert.ok(Object.keys(captured).some(p=>p.endsWith('/editable.oce.json')));assert.ok(Object.keys(captured).some(p=>format==='rs2014_sources'?p.endsWith('.rs2dlc'):p.endsWith('/manifest.json')));
  await page.locator('#ws-open-folder').setInputFiles(folder);await acceptReplace(format+'.oce-folder.zip');await page.waitForFunction(name=>document.querySelector('#ws-status').textContent.startsWith('Opened '+name),format+'.oce-folder.zip');assert.equal(await page.locator('#ws-arrangement option').count(),12);checks.push(format+' actual folder delivery/reopen retains all twelve master parts');
 }
 await openFile(await readFile(join(root,'research/notation-ui-fixture.feedpak')),'own-source-score.feedpak');await page.waitForSelector('[data-retained-score]');assert.equal(await page.locator('#ws-canvas').isVisible(),false);assert.equal(await page.locator('#ws-difficulty').isDisabled(),true);assert.equal(await page.locator('[data-action="playtest-start"]').first().isDisabled(),true);await page.keyboard.press('5');const retained=JSON.parse(await save('json')),score=retained.arrangements[0];assert.equal(score.type,'notation');assert.equal(score.readOnly,true);for(const key of ['notes','chords','stringCount','tuning','basePitches'])assert.equal(Object.hasOwn(score,key),false,'No manufactured '+key);checks.push('Retained notation has explicit read-only UI, disabled chart/playtest and unchanged raw master');
 assert.equal(requests.some(u=>u.includes('/build-cdlc')),false);assert.deepEqual(errors,[]);for(const [name,sha]of Object.entries(hashes))assert.equal(createHash('sha256').update(await readFile(join(root,name))).digest('hex'),sha,'Source drift: '+name);ok=true;
}catch(error){checks.push({failure:String(error),status:await page.locator('#ws-status').textContent().catch(()=>null)});throw error;}
finally{await page.screenshot({path:join(out,'editor.png')}).catch(()=>{});await writeFile(join(out,'report.json'),JSON.stringify({ok,url,checks,errors,hashes,physicalPicker:'Test double; actual DOM/HTTP and file bytes exercised',sourceTree:out},null,2));await browser.close();console.log(JSON.stringify({ok,report:join(out,'report.json'),checks}));}
