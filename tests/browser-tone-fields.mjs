// Prepared independently during the audio soak. Explicit release prevents an
// accidental browser launch from overlapping its controlled measurements.
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {makeProject,makeArrangement,makeNote} from '../src/model.js';
import {createTone,registerGearCatalog} from '../src/tone-rack.js';
if(process.env.OCE_TONE_FOCUS_RELEASE!=='1')throw Error('Browser launch held for audio-soak isolation. Set OCE_TONE_FOCUS_RELEASE=1 only after the parent releases it.');
const vocalCount=Number(process.env.OCE_TONE_STRESS||235);if(!Number.isSafeInteger(vocalCount)||vocalCount<0||vocalCount>100000)throw Error('Choose0..100000 original vocal stress events');
registerGearCatalog(JSON.parse(await readFile(new URL('../assets/tone-rack-data.json',import.meta.url),'utf8')).gears);
const require=createRequire(import.meta.url),{chromium}=require(process.env.OCE_PLAYWRIGHT||'C:/Users/zagat/AppData/Roaming/npm/node_modules/rea-agents/node_modules/playwright-core');
const browser=await chromium.launch({headless:true,args:['--mute-audio'],executablePath:process.env.OCE_CHROMIUM||'C:/Users/zagat/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe'}),context=await browser.newContext({viewport:{width:1700,height:1050}});
await context.addInitScript(()=>{window.__toneFieldSaves=[];window.showSaveFilePicker=async o=>({name:o.suggestedName,createWritable:async()=>({write:async b=>window.__toneFieldSaves.push(await b.text()),close:async()=>{}})});});
const page=await context.newPage(),pageErrors=[],checks=[];page.setDefaultTimeout(60000);page.on('pageerror',e=>pageErrors.push(e.message));let report;
const first='[data-knob-slot="Amp"][data-knob-key="Amp_AT120_Gain"]',second='[data-knob-slot="Amp"][data-knob-key="Amp_AT120_Bass"]';
async function action(name){await page.locator(`[data-action="${name}"]`).first().evaluate(el=>el.click());}
async function snapshot(){const n=await page.evaluate(()=>window.__toneFieldSaves.length);await action('saveas');await page.locator('#ws-export-format').selectOption('json');await page.locator('#ws-dialog-submit').click();await page.waitForFunction(n=>window.__toneFieldSaves.length>n,n);return page.evaluate(()=>JSON.parse(window.__toneFieldSaves.at(-1)));}
function bounded(value){const text=JSON.stringify(value);return text&&text.length>2000?{sha256:createHash('sha256').update(text).digest('hex'),characters:text.length,preview:text.slice(0,350)}:value;}
function check(name,actual,expected){try{assert.deepEqual(actual,expected);checks.push({name,ok:true});}catch{checks.push({name,ok:false,actual:bounded(actual),expected:bounded(expected)});}}
async function focusState(){return page.evaluate(()=>({id:document.activeElement?.id||'',slot:document.activeElement?.dataset.knobSlot||'',key:document.activeElement?.dataset.knobKey||'',gearSlot:document.activeElement?.dataset.gearSlot||'',sameFirstNode:document.querySelector('[data-knob-slot="Amp"][data-knob-key="Amp_AT120_Gain"]')===window.__toneFieldFirst}));}
try{
 const url=process.env.OCE_URL||'http://127.0.0.1:8766';await page.goto(url);await page.waitForSelector('#ws-app[data-mounted="true"]');
 const p=makeProject(),a=p.arrangements[0];p.title='Own tone field focus '+vocalCount;p.duration=Math.max(30,vocalCount/10+1);p.vocals=Array.from({length:vocalCount},(_,i)=>({id:'own-vocal-'+i,time:i/10,length:.08,text:'Own '+i,pitch:i%128,opaque:{original:[i]}}));
 const tone=createTone('Own local field tone');tone.opaque={original:['do not discard']};tone.GearList.Amp.opaque={original:'amp metadata'};a.tones={base:tone.name,changes:[{time:2,name:tone.name}],definitions:{[tone.name]:tone}};
 a.notes=[{...makeNote(a,1,0,3,.5),opaque:{original:'working note'}}];a.activeDifficulty=4;a.difficulties=[{difficulty:0,notes:[{...makeNote(a,2,1,2,.3),opaque:{original:'hidden DD note'}}],chords:[],anchors:[],handshapes:[],opaque:{original:'hidden level'}},{difficulty:4,notes:structuredClone(a.notes),chords:[],anchors:[],handshapes:[]}];
 const hidden=makeArrangement('bass',5);hidden.notes=[{...makeNote(hidden,3,4,7,.5),opaque:{original:'hidden bass'}}];hidden.opaque={original:['whole hidden arrangement']};p.arrangements.push(hidden);
 await page.locator('#ws-open-file').setInputFiles({name:'own-tone-field-focus.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(p))});await page.waitForFunction(title=>document.querySelector('#ws-title').textContent.includes(title),p.title);const baseline=await snapshot();await action('tones');await page.locator(first).waitFor();
 await page.evaluate(()=>{window.__toneFieldEvents=[];window.__toneFieldLongTasks=[];const starts=new WeakMap();document.addEventListener('change',e=>{if(e.target.id==='ws-tone-volume'||e.target.dataset.knobKey)starts.set(e,performance.now());},true);window.addEventListener('change',e=>{if(starts.has(e))window.__toneFieldEvents.push({id:e.target.id,key:e.target.dataset.knobKey||'',dispatchMs:performance.now()-starts.get(e)});});new PerformanceObserver(entries=>window.__toneFieldLongTasks.push(...entries.getEntries().map(e=>({at:e.startTime,ms:e.duration})))).observe({type:'longtask'});});
 // The click must be delivered to the second field after the first blurs.
 await page.locator(first).evaluate(el=>window.__toneFieldFirst=el);await page.locator(first).fill('37');await page.locator(second).click();let state=await focusState();check('Mouse focus moves from changed Gain to Bass',state.key,'Amp_AT120_Bass');check('Changing Gain keeps the existing tone input DOM',state.sameFirstNode,true);
 // Use explicit field handles after recording a failed focus outcome so a
 // baseline defect cannot send subsequent number keys to chart shortcuts.
 await page.locator(second).fill('43');await page.locator(second).press('Tab');state=await focusState();check('Tab from changed Bass reaches Mid',state.key,'Amp_AT120_Mid');
 await page.locator(first).fill('49');await page.locator(first).press('Tab');state=await focusState();check('Tab from changed Gain reaches Bass',state.key,'Amp_AT120_Bass');
 await page.locator('#ws-tone-volume').fill('-9.5');await page.locator('#ws-tone-volume').press('Tab');state=await focusState();check('Tab from changed volume reaches the amplifier selector',state.gearSlot,'Amp');
 await page.locator('#ws-tone-volume').fill('-8.5');await page.locator(first).click();state=await focusState();check('Mouse focus moves from changed volume to Gain',state.key,'Amp_AT120_Gain');
 const expected=structuredClone(baseline),expectedTone=expected.arrangements[0].tones.definitions[tone.name];expectedTone.GearList.Amp.KnobValues.Amp_AT120_Gain=49;expectedTone.GearList.Amp.KnobValues.Amp_AT120_Bass=43;expectedTone.volume=-8.5;expectedTone.Volume='-8.5';
 const definition=JSON.parse(await page.locator('[data-tone-definition]').inputValue());check('Complete native definition JSON follows the field edits',definition,expectedTone);
 const metrics=await page.evaluate(()=>({events:window.__toneFieldEvents,longTasks:window.__toneFieldLongTasks})),edited=await snapshot();check('Only intended tone values change; vocals, hidden DD, allocations, source fields and hidden bass remain exact',edited,expected);
 await action('undo');const undone=await snapshot(),beforeLast=structuredClone(expected);beforeLast.arrangements[0].tones.definitions[tone.name].volume=-9.5;beforeLast.arrangements[0].tones.definitions[tone.name].Volume='-9.5';check('One Undo reverses only the latest volume edit',undone,beforeLast);await action('redo');check('Redo restores the exact complete edited project',await snapshot(),expected);check('No uncaught browser errors',pageErrors,[]);
 const hashes={};for(const path of ['src/main.js','src/history.js'])hashes[path]=createHash('sha256').update(await readFile(new URL('../'+path,import.meta.url))).digest('hex');report={ok:checks.every(c=>c.ok),vocalCount,checks,metrics,sourceHashes:hashes,scope:'Actual original local Tones authoring, complete native definition JSON and editable project bytes; timing observations are not an audio-quality or native-DSP claim'};
 if(!report.ok)process.exitCode=1;
}catch(error){process.exitCode=1;report={ok:false,vocalCount,error:error.stack,checks,pageErrors,status:await page.locator('#ws-status').textContent().catch(()=>null)};}finally{await writeFile(new URL('../verification/browser-tone-fields'+(vocalCount>=100000?'-stress':'')+'.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close();}
