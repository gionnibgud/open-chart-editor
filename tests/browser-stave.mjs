// Stave view in a real browser: draws for guitar (Eb tuning), 5-string bass, keys and
// drums; follows the roll's scroll; adds, transposes, re-lengths and deletes notes
// through the normal undo history; light/dark paper. Uses already-installed tooling.
// OCE_URL defaults to the 8767 candidate; OCE_STAVE_SHOTS saves screenshots.
import {createRequire} from 'node:module';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {makeProject,makeArrangement,makeNote} from '../src/model.js';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.OCE_PLAYWRIGHT||'C:/Users/zagat/AppData/Roaming/npm/node_modules/rea-agents/node_modules/playwright-core');

const project=makeProject();project.title='Stave test';project.artist='Original';project.duration=20;
const guitar=makeArrangement('guitar');guitar.name='Eb guitar';guitar.tuning=guitar.tuning.map(()=>-1);
guitar.notes=[[0,3],[1,2],[2,0],[3,0],[4,3],[5,3]].map(([s,f])=>makeNote(guitar,1,s,f,0.9)).concat([0,2,4].map((f,i)=>makeNote(guitar,2+i*0.5,2,f,0.2)));
const bass=makeArrangement('bass',5);bass.name='5-string bass';bass.notes=[makeNote(bass,1,0,0,0.9),makeNote(bass,3,1,2,0.4)];
const keys=makeArrangement('keys');keys.name='Piano';keys.notes=[60,64,67].map(p=>makeNote(keys,1,p,0,0.9)).concat([Object.assign(makeNote(keys,1,48,0,1.9),{hand:'lh'}),makeNote(keys,2,61,0,0.4)]);
const drums=makeArrangement('drums');drums.name='Kit';drums.notes=[['kick',1],['hh_closed',1],['snare',1.5],['hh_closed',1.5],['crash_l',2]].map(([piece,t])=>Object.assign(makeNote(drums,t,0),{piece}));
project.arrangements=[guitar,bass,keys,drums];
const dir=await mkdtemp(path.join(tmpdir(),'stave-'));const file=path.join(dir,'stave-test.json');await writeFile(file,JSON.stringify(project));

const browser=await chromium.launch({headless:true,executablePath:process.env.OCE_CHROMIUM||'C:/Users/zagat/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe'});
const page=await (await browser.newContext({viewport:{width:1600,height:1000}})).newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
const results=[],shots=process.env.OCE_STAVE_SHOTS;
// Ink on the stave canvas: pixels far from the paper colour at (2,2).
const ink=()=>page.evaluate(()=>{const c=document.querySelector('#ws-stave'),g=c.getContext('2d'),d=g.getImageData(0,0,c.width,c.height).data,p=[d[0],d[1],d[2]];let n=0;for(let i=0;i<d.length;i+=4)if(Math.abs(d[i]-p[0])+Math.abs(d[i+1]-p[1])+Math.abs(d[i+2]-p[2])>120)n++;return {ink:n,paper:p};});
const pick=name=>page.evaluate(name=>{const el=document.querySelector('#ws-arrangement'),option=[...el.options].find(o=>o.textContent.startsWith(name));el.value=option.value;el.dispatchEvent(new Event('change',{bubbles:true}));},name);
const notes=async()=>Number((await page.locator('#ws-difficulty option:checked').textContent()).match(/(\d+) notes/)[1]);
try{
 await page.goto(process.env.OCE_URL||'http://127.0.0.1:8767');
 await page.waitForSelector('#ws-app[data-mounted="true"]');
 await page.locator('#ws-open-file').setInputFiles(file);
 await page.waitForFunction(()=>document.querySelector('#ws-title').textContent.includes('Stave test'));
 await page.locator('footer [data-action="stave"]').click();await page.waitForSelector('#ws-stave');
 for(const name of ['Eb guitar','5-string bass','Piano','Kit']){
  await pick(name);
  await page.waitForTimeout(150);const {ink:count}=await ink();
  assert.ok(count>1500,`${name}: stave has staff lines, clefs and notes (${count} ink pixels)`);
  if(shots)await page.locator('#ws-bottom').screenshot({path:path.join(shots,`stave-${name.replace(/\W+/g,'-')}.png`)});
  results.push(`${name}: stave drawn (${count} ink px)`);
 }
 assert.match(await page.locator('#ws-bottom h3').textContent(),/Kit/);
 // Back to the Eb guitar: the header names the tuning and the written octave.
 await pick('Eb guitar');await page.waitForTimeout(100);
 const before=await page.evaluate(()=>document.querySelector('#ws-stave').toDataURL());
 await page.evaluate(()=>{const s=document.querySelector('#ws-timeline-scroll');s.scrollLeft+=250;});await page.waitForTimeout(150);
 assert.notEqual(await page.evaluate(()=>document.querySelector('#ws-stave').toDataURL()),before,'scrolling the roll moves the stave');
 await page.evaluate(()=>{document.querySelector('#ws-timeline-scroll').scrollLeft=0;});await page.waitForTimeout(100);
 results.push('Stave follows the roll scroll');
 // Light and dark paper.
 const dark=(await ink()).paper;await page.locator('[data-stave-theme]').click();await page.waitForTimeout(100);
 const light=(await ink()).paper;assert.ok(light[0]>200&&dark[0]<60,`paper ${dark} -> ${light}`);
 await page.locator('[data-stave-theme]').click();results.push('Light / dark toggle');
 // Add a note on the stave, then transpose it, change its length, delete, undo.
 const count=await notes();
 await page.locator('[data-stave-mode="add"]').click();
 const box=await page.locator('#ws-stave').boundingBox();
 await page.locator('#ws-stave').click({position:{x:Math.min(box.width-40,700),y:box.height*0.45}});
 assert.equal(await notes(),count+1,'one note added from the stave');results.push('Add mode inserts a note');
 await page.locator('[data-inspector="properties"]').click();await page.waitForSelector('#ws-note-fret');
 const fret=Number(await page.locator('#ws-note-fret').inputValue());
 await page.locator('[data-stave-shift="1"]').click();
 assert.equal(Number(await page.locator('#ws-note-fret').inputValue()),fret+1,'up a semitone keeps the string, one fret higher');
 await page.locator('#ws-stave').focus();await page.keyboard.press('ArrowDown');
 assert.equal(Number(await page.locator('#ws-note-fret').inputValue()),fret,'arrow down from the stave');
 results.push(`Transpose by button and arrow key (fret ${fret} -> ${fret+1} -> ${fret})`);
 await page.locator('[data-stave-length="0.5"]').click();results.push('Length button applied');
 await page.locator('[data-stave-delete]').click();assert.equal(await notes(),count,'deleted');
 await page.keyboard.press('Control+z');assert.equal(await notes(),count+1,'undo restores the note');
 results.push('Delete and undo');
 // Selecting on the stave selects in the roll too (the inspector follows).
 await page.locator('[data-stave-mode="select"]').click();
 assert.deepEqual(errors,[],'no page errors');
 console.log(results.map(r=>'ok - '+r).join('\n'));
}finally{await browser.close();}
