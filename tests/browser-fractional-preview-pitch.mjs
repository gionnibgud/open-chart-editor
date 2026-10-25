// STAGED ONLY. Copy to tests/ after reviewed promotion. Never run during soak.

// Actual UI + original engine setters; synthetic save handles, no audio/hardware.

import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {readFile,writeFile,mkdir} from 'node:fs/promises';import {existsSync} from 'node:fs';import {dirname,join} from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';

if(process.env.OCE_FINE_PITCH_RELEASE!=='1')throw Error('Prepared only: explicit browser release required');

let root=dirname(fileURLToPath(import.meta.url));while(!existsSync(join(root,'src','model.js'))){const parent=dirname(root);if(parent===root)throw Error('OCE source root not found');root=parent;}

const {makeProject,makeArrangement,makeNote}=await import(pathToFileURL(join(root,'src/model.js')).href),require=createRequire(import.meta.url),{chromium}=require(process.env.OCE_PLAYWRIGHT||'C:/Users/zagat/AppData/Roaming/npm/node_modules/rea-agents/node_modules/playwright-core');

const sourceBefore=createHash('sha256').update(await readFile(join(root,'screen.html'))).digest('hex'),browser=await chromium.launch({headless:true,args:['--mute-audio'],executablePath:process.env.OCE_CHROMIUM||'C:/Users/zagat/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe'}),context=await browser.newContext({viewport:{width:1700,height:1050}}),checks=[],errors=[],observations=[];let ok=false,failure=null;

await context.addInitScript(()=>{window.__fineWrites=[];window.__fineHardware=[];window.__fineContexts=0;

 window.showSaveFilePicker=async options=>({name:options.suggestedName,createWritable:async()=>({write:async blob=>window.__fineWrites.push({name:options.suggestedName,text:await blob.text()}),close:async()=>{}})});

 Object.defineProperty(navigator,'requestMIDIAccess',{configurable:true,value:async()=>{window.__fineHardware.push('midi');throw Error('MIDI forbidden in pitch UI gate');}});if(navigator.mediaDevices)Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{window.__fineHardware.push('microphone');throw Error('Microphone forbidden in pitch UI gate');}});

 const Original=window.AudioContext;if(typeof Original!=='function')throw Error('AudioContext API required for setting-only ownership gate');

 // Deny BEFORE native construction: even unexpected init cannot reach a

 // physical output. Zero-attempt assertions remain, so denial is no substitute

 // for the expected absence of initialization in this setting-only workflow.

 const DeniedContext=class extends Original{constructor(){window.__fineContexts++;throw Error('AudioContext construction forbidden in setting-only pitch gate');}};

 window.AudioContext=DeniedContext;if(window.webkitAudioContext)window.webkitAudioContext=DeniedContext;

});

const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>{const u=new URL(route.request().url());return u.hostname==='127.0.0.1'||['data:','blob:'].includes(u.protocol)?route.continue():route.abort();});

async function observeEngine(){await page.evaluate(async()=>{const {AudioEngine}=await import('/api/plugins/open_chart_editor/src/audio.js');window.__finePitchCalls=[];if(AudioEngine.prototype.setPitch.__fineObserved)return;const original=AudioEngine.prototype.setPitch;function observed(value){window.__finePitchEngine=this;window.__finePitchCalls.push(value);return original.call(this,value);}observed.__fineObserved=true;AudioEngine.prototype.setPitch=observed;});}

async function action(name){await page.locator(`[data-action="${name}"]`).first().evaluate(el=>el.click());}

async function saveAsJSON(){const count=await page.evaluate(()=>window.__fineWrites.length);await action('saveas');await page.locator('#ws-export-format').selectOption('json');await page.locator('#ws-dialog-submit').click();await page.waitForFunction(n=>window.__fineWrites.length>n,count);return JSON.parse(await page.evaluate(()=>window.__fineWrites.at(-1).text));}

async function focusedSave(value){const pitch=page.locator('#ws-pitch'),count=await page.evaluate(()=>window.__fineWrites.length);await pitch.fill(String(value));assert.equal(await pitch.evaluate(el=>el.checkValidity()),true);await pitch.press('Control+s');await page.waitForFunction(n=>window.__fineWrites.length>n,count);return JSON.parse(await page.evaluate(()=>window.__fineWrites.at(-1).text));}

async function engine(value){const probe=await page.evaluate(()=>({input:Number(document.querySelector('#ws-pitch').value),last:window.__finePitchCalls.at(-1),pitch:window.__finePitchEngine?.pitch,contexts:window.__fineContexts,hardware:window.__fineHardware}));assert.equal(probe.input,value);assert.equal(probe.last,value);assert.equal(probe.pitch,value);assert.equal(probe.contexts,0,'This setting-only gate should not initialize audio');assert.deepEqual(probe.hardware,[]);observations.push(probe);}

const fixture=makeProject();fixture.title='Own fractional preview study';fixture.duration=4;fixture.ownAuthoredMetadata={exact:'Preview pitch must not enter this project'};fixture._pack={manifest:{own:true},entries:{'own/opaque.bin':Buffer.from('Original retained source').toString('base64')}};const a=fixture.arrangements[0];a.notes=[makeNote(a,1,0,3,.5)];a.activeDifficulty=2;a.difficulties=[{difficulty:0,notes:[makeNote(a,.5,0,1,.25)],chords:[],anchors:[],handshapes:[]},{difficulty:2,notes:structuredClone(a.notes),chords:[],anchors:[],handshapes:[]}];const scratch=makeArrangement('keys');scratch.editorOnly=true;scratch.scratchFor=a.id;scratch.notes=[makeNote(scratch,2,60,0,.5)];fixture.arrangements.push(scratch);

async function upload(){await page.locator('#ws-open-file').setInputFiles({name:'own-fractional-preview.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});if(await page.locator('#ws-dialog').evaluate(d=>d.open)&&await page.locator('#ws-dialog-title').textContent()==='Replace unsaved project?')await page.locator('#ws-dialog-submit').click();}

try{

 await page.goto(process.env.OCE_URL||'http://127.0.0.1:8766');await page.waitForSelector('#ws-app[data-mounted="true"]');await observeEngine();assert.equal(await page.locator('#ws-pitch').getAttribute('step'),'0.01','Requires reviewed one-cent HTML promotion');assert.equal(await page.locator('#ws-pitch').getAttribute('min'),'-24');assert.equal(await page.locator('#ws-pitch').getAttribute('max'),'24');await upload();await page.waitForFunction(()=>document.querySelector('#ws-title').textContent.includes('Own fractional preview study'));const baseline=await saveAsJSON();

 await page.locator('#ws-pitch').fill('0.13');await page.locator('#ws-pitch').press('Tab');await engine(.13);assert.deepEqual(await focusedSave(.13),baseline);checks.push('+0.13 semitone is valid; original engine setter receives exact float and focused Ctrl+S succeeds');

 assert.deepEqual(await focusedSave(-.13),baseline);await engine(-.13);assert.equal(await page.locator('#ws-dirty').textContent(),'');checks.push('-0.13 semitone saves while focused without changing full JSON, scratch, hidden DD, opaque source or dirty state');

 for(const invalid of [24.01,-24.01,.131]){await page.locator('#ws-pitch').fill(String(invalid));const valid=await page.locator('#ws-pitch').evaluate(el=>({ok:el.checkValidity(),under:el.validity.rangeUnderflow,over:el.validity.rangeOverflow,step:el.validity.stepMismatch}));assert.equal(valid.ok,false);if(invalid>24)assert.equal(valid.over,true);else if(invalid< -24)assert.equal(valid.under,true);else assert.equal(valid.step,true);const count=await page.evaluate(()=>window.__fineWrites.length);await page.locator('#ws-pitch').press('Control+s');await page.waitForTimeout(60);assert.equal(await page.evaluate(()=>window.__fineWrites.length),count,'Invalid focused input must block save');observations.push({invalid,...valid});}

 assert.deepEqual(await focusedSave(-.13),baseline);checks.push('Existing +/-24 limits and one-cent resolution reject invalid focused values without saving; restoring a valid fraction resumes Save');

 await page.evaluate(async()=>{const html=await(await fetch('/')).text(),fragment=new DOMParser().parseFromString(html,'text/html').querySelector('#ws-app');document.querySelector('#ws-app').remove();await new Promise(r=>setTimeout(r,40));document.body.append(document.importNode(fragment,true));});await page.waitForSelector('#ws-app[data-mounted="true"]');assert.equal(Number(await page.locator('#ws-pitch').inputValue()),-.13);assert.deepEqual(await focusedSave(-.13),baseline);await engine(-.13);checks.push('Actual DOM teardown/remount restores fractional session pitch and complete project/save destination');

 await page.reload();await page.waitForSelector('#ws-app[data-mounted="true"]');assert.equal(Number(await page.locator('#ws-pitch').inputValue()),-.13);await observeEngine();await upload();await page.waitForFunction(()=>document.querySelector('#ws-title').textContent.includes('Own fractional preview study'));assert.equal(Number(await page.locator('#ws-pitch').inputValue()),-.13);assert.deepEqual(await saveAsJSON(),baseline);assert.deepEqual(await focusedSave(-.13),baseline);await page.locator('#ws-pitch').dispatchEvent('change',{bubbles:true});await engine(-.13);assert.deepEqual(await focusedSave(-.13),baseline);checks.push('Real page reload restores fractional preferences; reopening original source preserves pitch preference and exact full editable JSON');

 assert.deepEqual(errors,[]);assert.equal(createHash('sha256').update(await readFile(join(root,'screen.html'))).digest('hex'),sourceBefore);ok=true;

}catch(error){failure=error.stack;process.exitCode=1;}finally{await browser.close();await mkdir(join(root,'verification'),{recursive:true});const report={ok,checks,errors,failure,observations,screenSha256:sourceBefore,scope:'Actual UI and original engine setter observed through a calling wrapper; synthetic save handles. No playback/context/hardware initialized; no physical audio/picker accuracy claim.'};await writeFile(join(root,'verification/browser-fractional-preview-pitch.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}

