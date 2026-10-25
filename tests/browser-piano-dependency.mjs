// The local dependency's explicit-control contract, with fake MIDI only.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFile,mkdir} from 'node:fs/promises';
const temp=new URL('../research/piano-dependency/tmp/',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1');await mkdir(temp,{recursive:true});process.env.TEMP=process.env.TMP=temp;
const require=createRequire(import.meta.url),{chromium}=require('C:/Users/zagat/AppData/Roaming/npm/node_modules/rea-agents/node_modules/playwright-core');
const browser=await chromium.launch({headless:true,executablePath:'C:/Users/zagat/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe'});
const page=await browser.newPage({viewport:{width:1200,height:800}}),blocked=[],errors=[];
const source=process.env.OCE_PIANO_SOURCE||new URL('../research/piano-dependency/staged/screen.js',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1');
page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>{blocked.push(r.request().url());return r.abort()});
try{
 await page.setContent('<div id="player" style="position:relative;width:1200px;height:800px"><canvas id="highway" width="1200" height="700" style="width:1200px;height:700px"></canvas><div id="player-controls"><button>Close</button></div></div>');
 await page.evaluate(()=>{
  const counters=window.counters={discover:0,open:0,close:0};let visible=false;
  const midiInput={version:1,discover:async()=>{counters.discover++;visible=true;return {outcome:'handled'}},listSources:()=>visible?[{sourceId:'fake',label:'Fake verifier keyboard',logicalSourceKey:'fake::keyboard'}]:[],select:async()=>{},open:async()=>{counters.open++;return {handle:{addListener(){},removeListener(){}}}},close:()=>{counters.close++}};
  window.slopsmith=window.feedBack={midiInput,on(){},off(){}};window.highway={resize(){}};
 });
 await page.addScriptTag({path:source});
 await page.evaluate(()=>{window.renderer=feedBackViz_piano();renderer.init(document.querySelector('#highway'));});
 await page.waitForTimeout(100);assert.deepEqual(await page.evaluate(()=>counters),{discover:0,open:0,close:0});assert.deepEqual(blocked,[]);
 await page.locator('.btn-piano-settings').click();await page.waitForSelector('.piano-midi-connect');assert.equal(await page.evaluate(()=>counters.discover),0);assert.deepEqual(blocked,[]);
 await page.locator('.piano-midi-connect').click();await page.waitForFunction(()=>counters.open===1);assert.equal(await page.evaluate(()=>counters.discover),1);assert.deepEqual(blocked,[]);
 await page.locator('.piano-midi-select').selectOption('');assert.ok(await page.evaluate(()=>counters.close)>0);assert.deepEqual(blocked,[]);
 await page.locator('.piano-midi-select').selectOption('fake::keyboard');await page.waitForFunction(()=>counters.open===2);assert.deepEqual(blocked,[]);
 await page.locator('.piano-sound-enable').click();await page.waitForFunction(()=>!!document.querySelector('script[src*="surikov.github.io"]'));await page.waitForTimeout(100);assert.equal(blocked.length,1);assert.ok(blocked[0].includes('WebAudioFontPlayer.js'));
 await page.locator('.piano-instrument-select').selectOption('1');await page.waitForTimeout(30);assert.equal(blocked.length,1);
 await page.evaluate(()=>renderer.destroy());assert.ok(await page.evaluate(()=>counters.close)>=2);assert.deepEqual(errors,[]);
 const report={ok:true,source,rendererMountNoMIDIOrNetwork:true,settingsOpenNoMIDIOrNetwork:true,explicitConnectAndDropdownWork:true,explicitSoundRequestBlockedWithoutFetch:true,instrumentControlWorks:true,hardware:'Fake provider only',errors,blocked,counters:await page.evaluate(()=>counters)};
 await writeFile(new URL('../research/piano-dependency/browser-controls.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close()}
