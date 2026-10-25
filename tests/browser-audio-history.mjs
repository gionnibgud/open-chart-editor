// Observe actual WebAudio buffer scheduling after backing-file undo/redo.
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require(process.env.OCE_PLAYWRIGHT||'C:/Users/zagat/AppData/Roaming/npm/node_modules/rea-agents/node_modules/playwright-core');
const browser=await chromium.launch({headless:true,executablePath:process.env.OCE_CHROMIUM||'C:/Users/zagat/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe',args:['--autoplay-policy=no-user-gesture-required']});
const context=await browser.newContext({viewport:{width:1500,height:1000}});
await context.addInitScript(()=>{
 window.__scheduledBacking=[];window.__decodedBacking=[];
 const decode=AudioContext.prototype.decodeAudioData,create=AudioContext.prototype.createBufferSource;
 AudioContext.prototype.decodeAudioData=function(...args){return decode.apply(this,args).then(buffer=>{window.__decodedBacking.push(buffer.duration);return buffer})};
 AudioContext.prototype.createBufferSource=function(...args){const source=create.apply(this,args),start=source.start;source.start=function(...parameters){window.__scheduledBacking.push(source.buffer?.duration);return start.apply(this,parameters)};return source};
});
const page=await context.newPage(),errors=[],checks=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
function wav(seconds){const frames=8000*seconds,b=Buffer.alloc(44+frames*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(frames*2,40);for(let i=0;i<frames;i++)b.writeInt16LE(Math.round(Math.sin(i/8000*440*2*Math.PI)*3000),44+i*2);return b}
async function upload(seconds){const name=`original-${seconds}s.wav`;await page.locator('#ws-audio-file').setInputFiles({name,mimeType:'audio/wav',buffer:wav(seconds)});await page.waitForFunction(name=>document.querySelector('#ws-status').textContent===`Audio ready: ${name}`,name)}
async function observe(expected){await page.evaluate(()=>window.__scheduledBacking=[]);await page.locator('#ws-play').click();await page.waitForTimeout(150);await page.locator('#ws-play').click();const values=await page.evaluate(()=>window.__scheduledBacking);if(expected===null)assert.equal(values.length,0);else{assert.ok(values.length>0);assert.ok(values.every(value=>value===expected));}}
async function undoOrRedo(key,expected){const decoded=await page.evaluate(()=>window.__decodedBacking.length);await page.locator('#ws-canvas').focus();await page.keyboard.press(key);if(expected!==null)await page.waitForFunction(count=>window.__decodedBacking.length>count,decoded);await observe(expected)}
let ok=false;
try{
 await page.goto(process.env.OCE_URL||'http://127.0.0.1:8766');await page.waitForSelector('#ws-app[data-mounted="true"]');await upload(2);await upload(4);await observe(4);checks.push('Replacement preview schedules actual four-second source buffer');
 await undoOrRedo('Control+z',2);checks.push('Undo replacement schedules original two-second source buffer');
 await undoOrRedo('Control+z',null);checks.push('Undo initial audio import clears backing playback');
 await undoOrRedo('Control+y',2);checks.push('Redo restores original source bytes and preview');
 assert.deepEqual(errors,[]);ok=true;
}finally{const out=new URL('../verification/',import.meta.url);await mkdir(out,{recursive:true});const report={ok,checks,errors};await writeFile(new URL('browser-audio-history.json',out),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close()}
