// Original actual-UI GPIF capo gate. --prepare never creates a browser.
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {notePitch} from '../src/model.js';
const root=fileURLToPath(new URL('../',import.meta.url)),prepare=process.argv.includes('--prepare');
if(!prepare&&process.env.OCE_GPIF_BROWSER_RELEASE!=='1')throw Error('GPIF browser gate held. Require explicit root release before OCE_GPIF_BROWSER_RELEASE=1; --prepare is source-only.');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const script=String.raw`
from pathlib import Path
import base64,hashlib,io,json,sys,wave
sys.path.insert(0,str(Path('tests').resolve()))
from test_gpif_capo import loaded,multi_source,p
from test_pack_io import project as own_project
folder=Path('research/gpif-browser-fixtures');folder.mkdir(parents=True,exist_ok=True)
root,layouts=multi_source();project,data=loaded(root)
audio=io.BytesIO()
with wave.open(audio,'wb') as wav:
 wav.setparams((1,2,8000,0,'NONE','not compressed'));wav.writeframes(b'\0\0'*64000)
files={'own-uniform-capo.gp8':data,'own-backing.wav':audio.getvalue()}
for name,content in files.items():(folder/name).write_bytes(content)
expected=[]
for i,(arr,(_,bases,_)) in enumerate(zip(project['arrangements'],layouts)):
 assert arr['capo']==i+1 and [n['fret'] for n in arr['notes']]==[0,2]
 expected.append({'id':arr['id'],'name':arr['name'],'type':arr['type'],'strings':len(bases),'capo':i+1,'frets':[0,2],'pitches':[bases[0]+i+1,bases[0]+i+3]})
reopened=p.load_project(p.save_project(project,'json')[0],'own.json');assert base64.b64decode(reopened['_import']['source'])==data
project['_pack']['manifest']={'stems':[{'id':'own','file':'audio/own.wav','default':True}]};project['_pack']['entries']['audio/own.wav']=base64.b64encode(files['own-backing.wav']).decode()
native=p.load_feedpak(p.save_feedpak(project));assert [a['capo'] for a in native['arrangements']]==[1,2,3,4];assert base64.b64decode(native['_pack']['entries']['sources/original.gp'])==data
print(json.dumps({'files':{name:{'path':str(folder/name),'bytes':len(content),'sha256':hashlib.sha256(content).hexdigest()} for name,content in files.items()},'expected':expected,'project':project,'checks':['Actual root production loader and public converter preserve capos1..4 on original6/7/8guitar and5bass','Open0/nonzero2 frets unchanged; source container exact in JSON and native Feedpak','Original own WAV backing and original GPIF container extras generated locally']}))
`;
const result=spawnSync('python',['-c',script],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(result.status,0,result.stderr);const preparation=JSON.parse(result.stdout);
const files=Object.fromEntries(await Promise.all(Object.entries(preparation.files).map(async([name,row])=>[name,await readFile(new URL('../'+row.path.replaceAll('\\','/'),import.meta.url))])));
const sourceFiles=['src/main.js','src/model.js','pack_io.py'];
const sourceHashes=Object.fromEntries(await Promise.all(sourceFiles.map(async name=>[name,sha(await readFile(new URL('../'+name,import.meta.url)))])));
for(const [i,row] of preparation.expected.entries())assert.deepEqual(preparation.project.arrangements[i].notes.map(n=>notePitch(preparation.project.arrangements[i],n)),row.pitches,'Actual model notePitch '+row.name);
if(prepare){
 const html=await readFile(new URL('../screen.html',import.meta.url),'utf8'),main=await readFile(new URL('../src/main.js',import.meta.url),'utf8');for(const id of ['ws-open-file','ws-audio-file','ws-arrangement','ws-arr-capo','ws-export-format'])assert.ok(html.includes(id)||main.includes(id)||id==='ws-arr-capo'&&main.includes("'arr-capo'"),id+' exists');
 const report={ok:true,browserLaunched:false,mode:'source-only preparation',checks:[...preparation.checks,'Actual current model.notePitch adds capo exactly once on all four layouts; UI selector/source checks complete'],fixtures:preparation.files,expected:preparation.expected,sourceHashes,release:'OCE_GPIF_BROWSER_RELEASE=1 only after explicit parent browser release and safe backend restart',scope:'Actual root loader/public converter/local model executed; browser and live HTTP backend not exercised.'};
 await mkdir(new URL('../verification/',import.meta.url),{recursive:true});await writeFile(new URL('../verification/browser-gpif-capo-prepared.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exit(0);
}
const require=createRequire(import.meta.url),{chromium}=require(process.env.OCE_PLAYWRIGHT||'C:/Users/zagat/AppData/Roaming/npm/node_modules/rea-agents/node_modules/playwright-core');
const browser=await chromium.launch({headless:true,args:['--mute-audio'],executablePath:process.env.OCE_CHROMIUM||'C:/Users/zagat/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe'});
const context=await browser.newContext({viewport:{width:1700,height:1050}});
await context.addInitScript(()=>{
 window.__gpifSaves=[];window.__gpifHardware=[];
 window.showSaveFilePicker=async options=>({name:options.suggestedName,createWritable:async()=>({write:async value=>{const blob=value instanceof Blob?value:new Blob([value]);window.__gpifSaves.push({name:options.suggestedName,bytes:Array.from(new Uint8Array(await blob.arrayBuffer()))});},close:async()=>{}})});
 Object.defineProperty(navigator,'requestMIDIAccess',{value:async()=>{window.__gpifHardware.push('MIDI');throw Error('No hardware in original fixture gate');}});
 if(navigator.mediaDevices)Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{window.__gpifHardware.push('microphone');throw Error('No hardware in original fixture gate');}});
});
const page=await context.newPage(),checks=[],errors=[],url=process.env.OCE_URL||'http://127.0.0.1:8766';let report;page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
const action=name=>page.locator(`[data-action="${name}"]`).first().evaluate(element=>element.click());
async function open(bytes,name){
 const pending=page.waitForResponse(response=>response.url().endsWith('/open_chart_editor/load'));await page.locator('#ws-open-file').setInputFiles({name,mimeType:'application/octet-stream',buffer:bytes});
 const response=await pending;assert.ok(response.ok(),await response.text());await page.waitForFunction(name=>document.querySelector('#ws-status').textContent.startsWith('Opened '+name),name);return(await response.json()).project;
}
async function save(format='json',unsupported=false){
 const index=await page.evaluate(()=>window.__gpifSaves.length);await action('saveas');await page.locator('#ws-export-format').selectOption(format);
 const pending=page.waitForResponse(response=>response.url().endsWith('/open_chart_editor/save')&&response.request().postDataJSON()?.format===format);await page.locator('#ws-dialog-submit').click();const response=await pending;
 if(unsupported){assert.equal(response.status(),400);assert.match(await response.text(),/six-string guitar or four-string bass/);assert.equal(await page.evaluate(()=>window.__gpifSaves.length),index);return;}
 assert.ok(response.ok(),await response.text());await page.waitForFunction(index=>window.__gpifSaves.length>index,index);const bytes=Buffer.from(await page.evaluate(()=>window.__gpifSaves.at(-1).bytes));return format==='json'?JSON.parse(bytes):bytes;
}
function sourceExact(project,native=false){
 assert.deepEqual(Buffer.from(project._pack.entries['sources/original.gp'],'base64'),files['own-uniform-capo.gp8']);
 if(!native)assert.deepEqual(Buffer.from(project._import.source,'base64'),files['own-uniform-capo.gp8']);
}
async function inspect(project){
 for(const row of preparation.expected){
  const arr=project.arrangements.find(a=>a.id===row.id);assert.ok(arr,row.id);assert.equal(arr.capo,row.capo);assert.equal(arr.stringCount,row.strings);assert.deepEqual(arr.notes.map(n=>n.fret),row.frets);
  await page.locator('#ws-arrangement').selectOption(row.id);await page.locator('[data-inspector="settings"]').click();assert.equal(await page.locator('#ws-arr-capo').inputValue(),String(row.capo));assert.equal(await page.locator('#ws-string-count').inputValue(),String(row.strings));
  const pitches=await page.evaluate(async arr=>{const {notePitch}=await import('/api/plugins/open_chart_editor/src/model.js');return arr.notes.map(n=>notePitch(arr,n));},arr);assert.deepEqual(pitches,row.pitches);
 }
}
try{
 await page.goto(url);await page.waitForSelector('#ws-app[data-mounted="true"]');for(const name of ['src/main.js','src/model.js'])assert.equal(sha(await(await page.request.get(url+'/api/plugins/open_chart_editor/'+name)).body()),sourceHashes[name],'Served current '+name);
 const loaded=await open(files['own-uniform-capo.gp8'],'own-uniform-capo.gp8');sourceExact(loaded);await inspect(loaded);assert.equal(await page.locator('#ws-dirty').textContent(),'');checks.push('Actual GPIF File Open imports four layouts; real Settings show capos1..4 and correct strings; served model pitches match open/nonzero once without dirtying navigation');
 await page.locator('#ws-audio-file').setInputFiles({name:'own-backing.wav',mimeType:'audio/wav',buffer:files['own-backing.wav']});await page.waitForFunction(()=>document.querySelector('#ws-status').textContent.includes('Audio ready'));
 const json=await save();sourceExact(json);await open(Buffer.from(JSON.stringify(json)),'own-capo.json');const jsonAgain=await save();sourceExact(jsonAgain);await inspect(jsonAgain);assert.deepEqual(jsonAgain.arrangements,json.arrangements);checks.push('Real editable JSON Save As and reopen preserve full chart/capos and exact original GPIF container');
 const native=await save('feedpak');await open(native,'own-capo.feedpak');const restored=await save();sourceExact(restored,true);await inspect(restored);for(const original of json.arrangements){const again=restored.arrangements.find(a=>a.id===original.id);assert.equal(again.role,original.role);assert.equal(again.priority,original.priority);}checks.push('Real Feedpak Save As and reopen preserve all four capos/pitches/role priorities and exact original GPIF container with own source extras');
 await page.locator('#ws-arrangement').selectOption(preparation.expected[0].id);const xml=await save('xml');const nativeFields=await page.evaluate(bytes=>{const doc=new DOMParser().parseFromString(new TextDecoder().decode(new Uint8Array(bytes)),'application/xml');return{errors:doc.querySelectorAll('parsererror').length,capo:Number(doc.querySelector('capo').textContent),frets:[...doc.querySelectorAll('levels > level > notes > note')].map(n=>Number(n.getAttribute('fret'))),role:doc.querySelector('arrangement').textContent};},Array.from(xml));assert.equal(nativeFields.errors,0);assert.equal(nativeFields.capo,1);assert.deepEqual(nativeFields.frets,[0,3]);assert.equal(nativeFields.role,'Lead');checks.push('Stock six-string XML emits capo1, native open0 and physical fret3 for relative2; no double application');
 for(const row of preparation.expected.slice(1)){await page.locator('#ws-arrangement').selectOption(row.id);await save('xml',true);}checks.push('Stock XML explicitly rejects seven/eight-string guitars and five-string bass with no partial output');
 assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.__gpifHardware),[]);report={ok:true,checks,pageErrors:errors,sourceHashes,fixtureHashes:preparation.files,browserMuted:true,hardwareRequests:[],nativePackagingRun:false,scope:'Actual original-file UI and JSON/Feedpak/XML adapters only; no native game, native GP application, hardware or audible/gameplay equivalence claim.'};
}catch(error){process.exitCode=1;report={ok:false,error:error.stack,checks,pageErrors:errors,sourceHashes,status:await page.locator('#ws-status').textContent().catch(()=>null)};}
finally{await mkdir(new URL('../verification/',import.meta.url),{recursive:true});await writeFile(new URL('../verification/browser-gpif-capo.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close();}
