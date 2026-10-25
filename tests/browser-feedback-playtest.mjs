// Playtest inside a real FeedBack: the OCE screen in FeedBack's own UI builds a
// preview FeedPak, adds it to FeedBack's library and FeedBack's player starts it.
// Needs a running FeedBack with this plugin installed (OCE_FEEDBACK_URL) and,
// to check the library file, its DLC_DIR (OCE_FEEDBACK_DLC). Uses installed tooling.
import {createRequire} from 'node:module';
import {mkdtemp,writeFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {demoProject} from '../src/model.js';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.OCE_PLAYWRIGHT||'C:/Users/zagat/AppData/Roaming/npm/node_modules/rea-agents/node_modules/playwright-core');
const base=process.env.OCE_FEEDBACK_URL;if(!base)throw Error('Set OCE_FEEDBACK_URL to a FeedBack instance with the Open Chart Editor installed');
const dlc=process.env.OCE_FEEDBACK_DLC||null,API=base+'/api/plugins/open_chart_editor';

// A demo chart with a generated 16 s tone as its audio, saved as a FeedPak by the plugin itself.
function wav(seconds=16,rate=22050){const n=seconds*rate,b=Buffer.alloc(44+n*2);b.write('RIFF',0);b.writeUInt32LE(36+n*2,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)b.writeInt16LE(Math.round(3000*Math.sin(2*Math.PI*220*i/rate)),44+i*2);return b;}
const project=demoProject();project.title='Playtest in FeedBack';project._pack={manifest:{stems:[{id:'full',file:'audio/full.wav',default:true,name:'Full mix'}]},entries:{'audio/full.wav':wav().toString('base64')}};
const saved=await fetch(API+'/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project,format:'feedpak'})});
assert.equal(saved.status,200,await saved.clone().text());
const dir=await mkdtemp(path.join(tmpdir(),'fb-playtest-')),file=path.join(dir,'playtest-in-feedback.feedpak');await writeFile(file,Buffer.from(await saved.arrayBuffer()));

const browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required'],executablePath:process.env.OCE_CHROMIUM||'C:/Users/zagat/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe'});
const page=await (await browser.newContext({viewport:{width:1600,height:1000}})).newPage(),errors=[],results=[];
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(30000);
const previews=async()=>dlc?(await readdir(dlc)).filter(n=>n.endsWith('_oce.feedpak')):null;
try{
 // A fresh FeedBack config shows its first-run profile setup over every screen; a
 // profile with a display name counts as onboarded, so set one before loading the page.
 const profile=await (await fetch(base+'/api/profile')).json().catch(()=>null);
 if(!profile?.onboarded){const set=await fetch(base+'/api/profile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({display_name:'OCE test'})});assert.equal(set.status,200,await set.text());results.push('Player profile set for a fresh FeedBack config');}
 await page.goto(base);
 // Plugin screens are added once FeedBack's plugin loader has run.
 await page.waitForFunction(()=>typeof window.showScreen==='function'&&window.feedBack?.capabilities&&document.getElementById('plugin-open_chart_editor'));
 await page.evaluate(()=>window.showScreen('plugin-open_chart_editor'));
 await page.waitForSelector('#ws-app[data-mounted="true"]');results.push('OCE screen mounts inside FeedBack');
 await page.locator('#ws-open-file').setInputFiles(file);
 await page.waitForFunction(()=>document.querySelector('#ws-title')?.textContent.includes('Playtest in FeedBack'));results.push('Opens a FeedPak with audio');
 const before=await previews();
 await page.locator('[data-action="playtest-start"]:visible').first().click();
 await page.waitForFunction(()=>/Playtest build:/.test(document.querySelector('#ws-status')?.textContent||'')||/error|could not|failed/i.test(document.querySelector('#ws-status')?.textContent||''));
 const status=await page.locator('#ws-status').textContent();assert.match(status,/Playtest build: .*_oce\.feedpak/,status);results.push('Builds the preview: '+status.slice(0,90));
 // Every playback state FeedBack reports over the next seconds; the preview must reach playing.
 const states=await page.evaluate(async()=>{const seen=[];for(let i=0;i<40;i++){const s=window.feedBack.playback?.snapshot?.();const state=s?.state?.state??s?.state;if(typeof state==='string'&&seen.at(-1)!==state)seen.push(state);if(state==='playing'&&i>4)break;await new Promise(r=>setTimeout(r,250));}return seen;});
 assert.ok(states.includes('playing'),'FeedBack played the preview: '+states.join(' > '));results.push('FeedBack playback: '+states.join(' > '));
 if(dlc){const after=await previews();assert.equal(after.length,before.length+1,'one preview FeedPak in the library');results.push('Preview added to FeedBack library: '+after.filter(n=>!before.includes(n))[0]);}
 await page.evaluate(()=>document.querySelector('[data-action="playtest-end"]').click());await page.waitForTimeout(800);
 await page.evaluate(()=>window.showScreen('plugin-open_chart_editor'));await page.waitForSelector('#ws-app[data-mounted="true"]');
 await page.evaluate(()=>document.querySelector('[data-action="playtest-remove"]').click());await page.waitForTimeout(1500);
 if(dlc){assert.equal((await previews()).length,before.length,'preview removed from the library');results.push('End playtest and remove preview build');}
 assert.deepEqual(errors,[],'no page errors');
 console.log(results.map(r=>'ok - '+r).join('\n'));
}finally{await browser.close();}
