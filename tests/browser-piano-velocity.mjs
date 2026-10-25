// Actual piano inspector and complete project preservation, using own content.
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {makeProject,makeArrangement,makeNote} from '../src/model.js';
if(process.env.OCE_PIANO_VELOCITY_RELEASE!=='1')throw Error('Browser held for controlled audio soak; parent release required');
const require=createRequire(import.meta.url),{chromium}=require(process.env.OCE_PLAYWRIGHT||'C:/Users/zagat/AppData/Roaming/npm/node_modules/rea-agents/node_modules/playwright-core');
const browser=await chromium.launch({headless:true,args:['--mute-audio'],executablePath:process.env.OCE_CHROMIUM||'C:/Users/zagat/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe'});
const context=await browser.newContext({viewport:{width:1700,height:1050}});
await context.addInitScript(()=>{window.__velocitySaves=[];window.showSaveFilePicker=async o=>({name:o.suggestedName,createWritable:async()=>({write:async b=>window.__velocitySaves.push(await b.text()),close:async()=>{}})});});
const page=await context.newPage(),checks=[],errors=[];let report;
page.on('pageerror',e=>errors.push(e.message));
const action=name=>page.locator(`[data-action="${name}"]`).first().evaluate(el=>el.click());
async function save(){const n=await page.evaluate(()=>window.__velocitySaves.length);await action('saveas');await page.locator('#ws-export-format').selectOption('json');await page.locator('#ws-dialog-submit').click();await page.waitForFunction(n=>window.__velocitySaves.length>n,n);return JSON.parse(await page.evaluate(()=>window.__velocitySaves.at(-1)));}
try{
 await page.goto(process.env.OCE_URL||'http://127.0.0.1:8766');await page.waitForSelector('#ws-app[data-mounted="true"]');
 const p=makeProject(),a=makeArrangement('keys');p.title='Own piano velocity inspector';p.arrangements.push(a);a.notes=[0,127].map((pitch,index)=>({...makeNote(a,index+1,0,0,.5),id:'own-key-'+index,pitch,velocity:index?127:0,opaque:{own:[index,'retained']}}));a.activeDifficulty=3;a.difficulties=[{difficulty:0,notes:[{...structuredClone(a.notes[0]),id:'own-hidden-key',velocity:37}],chords:[],anchors:[],handshapes:[]},{difficulty:3,notes:structuredClone(a.notes),chords:[],anchors:[],handshapes:[]}];
 await page.locator('#ws-open-file').setInputFiles({name:'own-piano-velocity.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(p))});await page.waitForFunction(title=>document.querySelector('#ws-title').textContent.includes(title),p.title);await page.locator('#ws-arrangement').selectOption(a.id);await action('selectall');
 const velocity=page.locator('#ws-piano-velocity');assert.equal(await velocity.count(),1,'Piano must expose the retained velocity');assert.equal(await velocity.inputValue(),'0','Silent imported velocity must not be replaced with100');const baseline=await save();checks.push('Actual piano inspector exposes imported zero velocity at MIDI0/127 without coercion');
 await velocity.fill('1');await velocity.press('Tab');const edited=await save();assert.deepEqual(edited.arrangements[1].notes.map(n=>n.velocity),[1,1]);assert.deepEqual(edited.arrangements[0],baseline.arrangements[0]);assert.deepEqual(edited.arrangements[1].difficulties.find(d=>d.difficulty===0),baseline.arrangements[1].difficulties.find(d=>d.difficulty===0));assert.deepEqual(edited.arrangements[1].notes.map(n=>n.opaque),baseline.arrangements[1].notes.map(n=>n.opaque));checks.push('Multi-note edit changes visible piano dynamics while other arrangements, hidden DD and opaque note data remain exact');
 await action('undo');assert.deepEqual(await save(),baseline);await action('redo');assert.deepEqual(await save(),edited);checks.push('One Undo/Redo restores exact complete projects');await action('selectall');
 for(const invalid of ['','-1','128','1.5']){await velocity.fill(invalid);await velocity.press('Tab');assert.deepEqual(await save(),edited,'Invalid velocity must not create an authoring change: '+invalid);}
 checks.push('Blank, negative, fractional and overrange edits are rejected before mutation');
 await velocity.fill('0');await velocity.press('Tab');assert.deepEqual((await save()).arrangements[1].notes.map(n=>n.velocity),[0,0]);await velocity.fill('127');await velocity.press('Tab');assert.deepEqual((await save()).arrangements[1].notes.map(n=>n.velocity),[127,127]);checks.push('Both valid velocity endpoints remain editable');
 assert.deepEqual(errors,[]);report={ok:true,checks,errors,scope:'Original local piano authoring and serialized project values; native provider velocity playback and physical MIDI are separate'};
}catch(error){process.exitCode=1;report={ok:false,error:error.stack,checks,errors,status:await page.locator('#ws-status').textContent().catch(()=>null)};}finally{await writeFile(new URL('../verification/browser-piano-velocity.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close();}
