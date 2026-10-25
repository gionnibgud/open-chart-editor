import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const output=new URL('../research/browser-guide-voice/',import.meta.url);await mkdir(output,{recursive:true});const temp=fileURLToPath(new URL('tmp/',output));await mkdir(temp,{recursive:true});process.env.TEMP=process.env.TMP=temp;
const require=createRequire(import.meta.url),{chromium}=require(process.env.OCE_PLAYWRIGHT||'C:/Users/zagat/AppData/Roaming/npm/node_modules/rea-agents/node_modules/playwright-core');
const browser=await chromium.launch({headless:true,executablePath:process.env.OCE_CHROMIUM||'C:/Users/zagat/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe'}),context=await browser.newContext(),page=await context.newPage(),errors=[],blocked=[];page.on('pageerror',error=>errors.push(error.message));
await context.addInitScript(()=>{window.__guideHardwareRequests=0;Object.defineProperty(navigator,'requestMIDIAccess',{value:()=>{window.__guideHardwareRequests++;return Promise.reject(Error('No test hardware'));}});if(navigator.mediaDevices)Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:()=>{window.__guideHardwareRequests++;return Promise.reject(Error('No test hardware'));}});});
await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname!=='127.0.0.1'&&!['blob:','data:'].includes(u.protocol)){blocked.push(u.origin);return route.abort();}return route.continue();});
let report;
try{
 await page.goto(process.env.OCE_URL||'http://127.0.0.1:8766');await page.waitForSelector('#ws-app[data-mounted="true"]');
 const result=await page.evaluate(async()=>{
  const {GUIDE_VOICE_FAMILIES,guideVoiceSetting,resolveGuideVoice}=await import('/api/plugins/open_chart_editor/src/guide-voice.js'),{renderGuide}=await import('/api/plugins/open_chart_editor/src/render-guide.js'),{PracticeRenderer,practiceDTO}=await import('/api/plugins/open_chart_editor/src/render-controller.js');
  const p={duration:.6,_pack:{entries:{'rigs.json':'opaque-private'}},audio:{data:'private source'},arrangements:[{type:'keys',stringCount:6,basePitches:[],tuning:[0,0,0,0,0,0],centOffset:4,notes:[{time:.05,pitch:69,sustain:.5,velocity:100,techniques:{bend_values:[{t:0,v:0},{t:.2,v:2}],vibrato:80}}],chords:[],tones:{base:'Legacy',changes:[{time:.1,name:'Legacy B'}],definitions:{Legacy:{private:1}}}}]};
  const digest=async buffer=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(b=>b.toString(16).padStart(2,'0')).join('');
  const cases=[],r=new PracticeRenderer();
  for(const family of GUIDE_VOICE_FAMILIES){
   p.arrangements[0].guideVoice=guideVoiceSetting(family.id);const before=JSON.stringify(p),worker=await r.render(p,{sampleRate:8000}),direct=renderGuide(p,{sampleRate:8000}),same=worker.byteLength===direct.byteLength&&new Uint8Array(worker).every((byte,index)=>byte===new Uint8Array(direct)[index]);
   const view=new DataView(worker);let peak=0;for(let offset=44;offset<worker.byteLength;offset+=2)peak=Math.max(peak,Math.abs(view.getInt16(offset,true)/32768));
   cases.push({family:family.id,sha256:await digest(worker),exactWorkerBytes:same,sourceUnchanged:JSON.stringify(p)===before,peak,privateDataOmitted:!/opaque|private|rigs.json|Legacy/.test(JSON.stringify(practiceDTO(p)))});
  }
  delete p.arrangements[0].guideVoice;const legacyVoice=resolveGuideVoice(p.arrangements[0],{time:.4}),legacy=await r.render(p,{sampleRate:8000});let nonzero=false;for(const byte of new Uint8Array(legacy,44))if(byte){nonzero=true;break;}
  p.arrangements[0].tones={base:'Own',base_rig:'original-a',changes:[{time:.3,name:'Own B',rig:'original-b'}]};p.arrangements[0].notes.push({...structuredClone(p.arrangements[0].notes[0]),time:.35,sustain:.2});
  const rigLibrary={rigs:[{id:'original-a',blocks:[{role:'source',intent:{gm:{program:0}},realizations:[{engine:'soundfont',ref:'https://must-not-load.invalid/private.sf2'}]}]},{id:'original-b',blocks:[{role:'source',intent:{gm:{program:73}}}]}]},nativeBefore=JSON.stringify({p,rigLibrary}),native=await r.render(p,{sampleRate:8000,rigLibrary}),nativeExpected=renderGuide(p,{sampleRate:8000,rigLibrary});
  const nativeExact=new Uint8Array(native).every((byte,index)=>byte===new Uint8Array(nativeExpected)[index]);rigLibrary.rigs.forEach(rig=>rig.blocks[0].bypassed=true);const silent=await r.render(p,{sampleRate:8000,rigLibrary});r.dispose();
  return {cases,distinctFamilyWaves:new Set(cases.map(row=>row.sha256)).size,legacyStillAudible:nonzero,legacyProfileUnchanged:legacyVoice.legacy===true&&legacyVoice.profile===null,nativeTimelineExactWorker:nativeExact,nativeSourceUnchanged:nativeBefore===JSON.stringify({p,rigLibrary:{rigs:rigLibrary.rigs.map(rig=>({...rig,blocks:rig.blocks.map(({bypassed,...block})=>block)}))}}),sourceMuteSilent:new Uint8Array(silent,44).every(byte=>byte===0),hardwareRequests:window.__guideHardwareRequests};
 });
 assert.equal(result.distinctFamilyWaves,16);assert.ok(result.cases.every(row=>row.exactWorkerBytes&&row.sourceUnchanged&&row.privateDataOmitted&&row.peak>0&&row.peak<.2));assert.equal(result.legacyStillAudible,true);assert.equal(result.legacyProfileUnchanged,true);assert.equal(result.nativeTimelineExactWorker,true);assert.equal(result.nativeSourceUnchanged,true);assert.equal(result.sourceMuteSilent,true);assert.equal(result.hardwareRequests,0);assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
 report={ok:true,verifiedAt:new Date().toISOString(),realModuleWorker:true,offlineOriginalSynthesis:true,physicalAudioVerified:false,...result,errors,blocked};
}catch(error){report={ok:false,error:error.stack,errors,blocked};process.exitCode=1;}
finally{await writeFile(new URL('report.json',output),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close();}
