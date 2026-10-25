// Lyrics tab in a real browser: paste a sheet (English plus other scripts), accept the
// English syllable suggestion, apply, tap timing with the Space bar while the audio
// plays, undo a tap, stop, then check the karaoke line and Undo.
// OCE_URL defaults to the 8767 candidate; OCE_LYRIC_SHOTS saves screenshots.
import {createRequire} from 'node:module';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {makeProject,makeNote} from '../src/model.js';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.OCE_PLAYWRIGHT||'C:/Users/zagat/AppData/Roaming/npm/node_modules/rea-agents/node_modules/playwright-core');

const dir=await mkdtemp(path.join(tmpdir(),'lyrics-'));
const rate=22050,seconds=20,samples=new Int16Array(rate*seconds);
for(let n=0;n<samples.length;n++)samples[n]=Math.round(3000*Math.sin(2*Math.PI*220*n/rate)*(Math.floor(n/rate*2)%2));
const header=Buffer.alloc(44);header.write('RIFF',0);header.writeUInt32LE(36+samples.length*2,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(rate,24);header.writeUInt32LE(rate*2,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(samples.length*2,40);
const wav=path.join(dir,'own.wav');await writeFile(wav,Buffer.concat([header,Buffer.from(samples.buffer)]));
const project=makeProject();project.title='Lyric tapping';project.artist='Original';project.duration=seconds;project.arrangements[0].notes=[makeNote(project.arrangements[0],1,0,3,.5)];
const json=path.join(dir,'lyrics.json');await writeFile(json,JSON.stringify(project));

const browser=await chromium.launch({headless:true,executablePath:process.env.OCE_CHROMIUM||'C:/Users/zagat/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe',args:['--autoplay-policy=no-user-gesture-required']});
const page=await (await browser.newContext({viewport:{width:1500,height:1000}})).newPage(),errors=[],results=[],shots=process.env.OCE_LYRIC_SHOTS;
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
const state=()=>page.evaluate(()=>document.querySelector('#ws-lyric-count').textContent);
const vocalRows=()=>page.locator('[data-vocal-row]').count();
try{
 await page.goto(process.env.OCE_URL||'http://127.0.0.1:8767');await page.waitForSelector('#ws-app[data-mounted="true"]');
 await page.locator('#ws-open-file').setInputFiles(json);await page.waitForFunction(()=>document.querySelector('#ws-title').textContent.includes('Lyric tapping'));
 await page.locator('#ws-audio-file').setInputFiles(json.replace('lyrics.json','own.wav'));await page.waitForFunction(()=>/Audio ready/.test(document.body.textContent));
 await page.locator('#ws-vocals-button').click();await page.waitForSelector('#ws-lyric-sheet');
 assert.ok(await page.locator('#ws-vocals-button.active').count(),'Lyrics tab button is active');results.push('Lyrics tab beside Tab / Tempo / Tones');

 const sheet='Here comes the morning light\n夜空に 星が\nCorazón again';
 await page.locator('#ws-lyric-sheet').fill(sheet);
 await page.locator('[data-lyric="suggest"]').click();
 assert.match(await page.locator('#ws-lyric-suggestion').textContent(),/morning → morn-ing.*again → a-gain/);
 await page.locator('[data-lyric-suggestion="dismiss"]').click();assert.equal(await page.locator('#ws-lyric-sheet').inputValue(),sheet,'dismiss leaves the sheet');
 await page.locator('[data-lyric="suggest"]').click();await page.locator('[data-lyric-suggestion="accept"]').click();
 assert.equal(await page.locator('#ws-lyric-sheet').inputValue(),'Here comes the morn-ing light\n夜空に 星が\nCorazón a-gain');
 results.push('English suggestion: dismiss keeps the sheet, accept splits English words only');
 await page.locator('[data-lyric="apply"]').click();
 assert.match(await state(),/Timed 0 of 11 syllables\. Next to tap: Here/);results.push('Apply text: 11 untimed syllables');

 await page.locator('[name="ws-lyric-mode"][value="tap"]').check();
 await page.locator('#ws-lyric-karaoke').focus();
 await page.keyboard.press(' ');                      // first Space starts playback with the lead-in
 await page.waitForFunction(()=>!document.querySelector('[data-lyric="stop"]').disabled);
 await page.waitForTimeout(400);
 for(let i=0;i<6;i++){await page.keyboard.down(' ');await page.waitForTimeout(220);await page.keyboard.up(' ');await page.waitForTimeout(150);}
 assert.match(await state(),/Next to tap: 夜空に/);
 await page.keyboard.press('Backspace');               // undo the 6th tap, rewind 2 s
 assert.match(await state(),/Next to tap: light/);
 await page.keyboard.down(' ');await page.keyboard.up(' ');   // during the rewind: ignored
 assert.match(await state(),/Next to tap: light/);await page.waitForTimeout(2300);
 for(let i=0;i<4;i++){await page.keyboard.down(' ');await page.waitForTimeout(200);await page.keyboard.up(' ');await page.waitForTimeout(150);}
 if(shots)await page.screenshot({path:path.join(shots,'lyrics-tapping.png')});
 await page.keyboard.press('Escape');
 await page.waitForFunction(()=>document.querySelector('[data-lyric="stop"]').disabled);
 assert.match(await state(),/Timed 9 of 11 syllables\. Next to tap: a/);
 assert.equal(await vocalRows(),9);
 const times=await page.$$eval('[data-vocal-field="time"]',els=>els.map(el=>Number(el.value)));
 assert.ok(times.every((t,i)=>i===0||t>times[i-1]),'syllables in time order: '+times);
 const texts=await page.$$eval('[data-vocal-field="text"]',els=>els.map(el=>el.value));
 assert.deepEqual(texts,['Here','comes','the','morn-','ing','light+','夜空に','星が+','Corazón']);
 results.push(`Tap timing with Space: 10 taps, 1 undone, 9 timed in order (${times.map(t=>t.toFixed(2)).join(', ')})`);

 // Playback check mode: Space plays again; the karaoke line follows the cursor.
 await page.locator('[name="ws-lyric-mode"][value="check"]').check();
 await page.evaluate(t=>{document.querySelector('[data-vocal-time="'+t+'"]')?.click();},String(times[6]));
 await page.waitForTimeout(150);
 assert.match(await page.locator('.ws-lyric-now').textContent(),/夜空に/);results.push('Karaoke line follows the cursor (non-Latin line shown)');
 if(shots)await page.screenshot({path:path.join(shots,'lyrics-check.png')});

 await page.locator('#ws-vocal-timeline canvas').focus();await page.keyboard.press('Control+z');
 await page.waitForFunction(()=>/Timed 0 of 11/.test(document.querySelector('#ws-lyric-count')?.textContent||''));
 results.push('One Undo removes the whole tap pass');
 assert.deepEqual(errors,[],'no page errors');
 console.log(results.map(r=>'ok - '+r).join('\n'));
}finally{await browser.close();}
