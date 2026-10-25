// Original fixtures; existing local Chromium only. No user library or hardware.
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.OCE_PLAYWRIGHT||'C:/Users/zagat/AppData/Roaming/npm/node_modules/rea-agents/node_modules/playwright-core');
const browser=await chromium.launch({headless:true,executablePath:process.env.OCE_CHROMIUM||'C:/Users/zagat/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe'});
const context=await browser.newContext({viewport:{width:1700,height:1100},acceptDownloads:true});
await context.addInitScript(()=>Object.defineProperty(window,'showSaveFilePicker',{value:undefined,configurable:true}));
const page=await context.newPage(),errors=[];page.setDefaultTimeout(12000);
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',route=>{const url=new URL(route.request().url());return url.hostname==='127.0.0.1'||url.protocol==='blob:'||url.protocol==='data:'?route.continue():route.abort()});
const output=new URL('../research/browser-chords/',import.meta.url);await mkdir(output,{recursive:true});
async function action(name){const button=page.locator(`[data-action="${name}"]`).first();await button.evaluate(el=>{const menu=el.closest('details');if(menu)menu.open=true});await button.click();}
async function submit(){await page.locator('#ws-dialog-submit').click();await page.locator('#ws-dialog[open]').waitFor({state:'hidden'});}
async function download(format){const pending=page.waitForEvent('download');await action('saveas');await page.locator('#ws-export-format').selectOption(format);await submit();const file=await pending,stream=await file.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);return Buffer.concat(chunks);}
async function snapshot(){return JSON.parse(await download('json'));}
const project={version:1,title:'Original chord-zone browser study',artist:'Local author',duration:6,beats:Array.from({length:13},(_,i)=>({time:i*.5,measure:i%4===0?i/4+1:-1})),sections:[],arrangements:[{id:'original-lead',name:'Lead',type:'guitar',stringCount:6,tuning:[0,0,0,0,0,0],notes:[],chords:[],anchors:[],handshapes:[],phrases:[],tones:{base:'Clean',changes:[],definitions:{}},chord_templates:[{name:'Original first',frets:[3,5,-1,-1,-1,-1],fingers:[1,3,-1,-1,-1,-1]},{name:'Original second',frets:[7,9,-1,-1,-1,-1],fingers:[1,3,-1,-1,-1,-1]}]}]};
const checks=[];let ok=false;
try{
 await page.goto(process.env.OCE_URL||'http://127.0.0.1:8766');await page.waitForSelector('#ws-app[data-mounted="true"]');
 await page.locator('#ws-open-file').setInputFiles({name:'own-study.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
 await page.waitForFunction(title=>document.querySelector('#ws-title').textContent.includes(title),project.title);
 await page.locator('[data-inspector="chords"]').click();
 assert.equal(await page.locator('#ws-chord-length').inputValue(),'1');
 await page.locator('#ws-chord-length').fill('2');await page.locator('#ws-chord-gutter').fill('.25');await page.locator('#ws-chord-fingerprint').check();
 await page.locator('[data-chord="1"]').dblclick();
 let saved=(await snapshot()).arrangements[0];assert.equal(saved.handshapes.length,1);assert.equal(saved.handshapes[0].kind,'fingerprint');assert.ok(saved.chord_templates[saved.handshapes[0].chord_id].displayName.endsWith('-nop'));assert.equal(saved.handshapes[0].end_time,.875);assert.equal(saved.chords.length,0);assert.equal(saved.notes.length,0);
 checks.push('double-click inserts one fingerprint-only zone using beat length/gutter');
 await page.locator('[data-chord="1"]').press('n');saved=(await snapshot()).arrangements[0];assert.equal(saved.chords.length,1);assert.equal(saved.chords[0].chord_id,saved.handshapes[0].chord_id);assert.deepEqual(saved.chords[0].notes.map(n=>n.fret),[7,9]);assert.equal(saved.handshapes.length,1);
 await page.locator('[data-chord="1"]').press('n');saved=(await snapshot()).arrangements[0];assert.equal(saved.chords.length,0);assert.equal(saved.handshapes.length,1);
 checks.push('N inserts containing-zone voicing then removes strum while retaining zone');
 await page.locator('[data-chord="1"]').press('n');await action('chord-split');await submit();saved=(await snapshot()).arrangements[0];assert.equal(saved.chords.length,0);assert.equal(saved.notes.length,2);assert.deepEqual(saved.notes.map(n=>n.techniques.left_hand),[1,3]);assert.equal(saved.handshapes.length,1);
 checks.push('split selected chord keeps independent note fingering and handshape');
 await page.locator('[data-chord="1"]').press('Control+z');saved=(await snapshot()).arrangements[0];assert.equal(saved.chords.length,1);assert.equal(saved.notes.length,0);
 await page.locator('#ws-chord-length').fill('3');await page.locator('#ws-chord-gutter').fill('.5');await page.locator('[data-zone-resize="0"]').click();saved=(await snapshot()).arrangements[0];assert.equal(saved.handshapes[0].end_time,1.25);assert.equal(saved.chords.length,1);
 checks.push('undo restores chord; resize changes selected zone using beat controls');
 await page.locator('#ws-chord-sort').selectOption('name-desc');assert.deepEqual(await page.locator('[data-chord]').evaluateAll(items=>items.map(el=>el.dataset.chord)),['1','2','0']);
 await page.locator(`[data-chord-delete="${saved.handshapes[0].chord_id}"]`).click();assert.match(await page.locator('#ws-status').textContent(),/used by a strum/);
 saved=(await snapshot()).arrangements[0];assert.equal(saved.chord_templates.length,3);
 await page.locator('[data-chord-delete="0"]').click();saved=(await snapshot()).arrangements[0];assert.equal(saved.chord_templates.length,2);assert.equal(saved.chord_templates[0].name,'Original second');assert.equal(saved.chords[0].chord_id,1);assert.equal(saved.handshapes[0].chord_id,1);
 checks.push('library sorts without renumbering; used template protected; unused deletion remaps references');
 await page.locator('[data-chord-edit="0"]').click();await page.locator('#ws-chord-fret-0').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>document.activeElement.id),'ws-chord-finger-0');await page.keyboard.press('ArrowDown');assert.equal(await page.evaluate(()=>document.activeElement.id),'ws-chord-finger-1');await page.keyboard.press('ArrowLeft');assert.equal(await page.evaluate(()=>document.activeElement.id),'ws-chord-fret-1');await page.keyboard.press('ArrowUp');assert.equal(await page.evaluate(()=>document.activeElement.id),'ws-chord-fret-0');assert.equal(await page.locator('#ws-chord-fret-0').inputValue(),'7');await page.keyboard.press('Escape');
 checks.push('arrow keys navigate chord fret/finger grid without changing values');
 const box=await page.locator('#ws-canvas').boundingBox();await page.mouse.move(box.x+112+1.25*110,box.y+174+6*45+15);await page.mouse.down();await page.mouse.move(box.x+112+1.76*110,box.y+174+6*45+15,{steps:6});await page.mouse.up();saved=(await snapshot()).arrangements[0];assert.equal(saved.handshapes[0].end_time,1.75);assert.equal(saved.chords.length,1);
 checks.push('blue zone endpoint drags and snaps to musical grid without changing strums');
 const music=JSON.stringify(saved.chords.map(c=>c.notes));await page.locator('[data-zone-kind="0"]').selectOption('chord');
 await page.locator('[data-zone-go="0"]').press('Shift+f');saved=(await snapshot()).arrangements[0];assert.equal(saved.handshapes[0].kind,'fingerprint');assert.ok(saved.chord_templates[saved.handshapes[0].chord_id].displayName.endsWith('-nop'));assert.equal(JSON.stringify(saved.chords.map(c=>c.notes)),music);
 await page.locator('[data-zone-go="0"]').press('Shift+f');saved=(await snapshot()).arrangements[0];assert.equal(saved.handshapes[0].kind,'arpeggio');assert.equal(saved.handshapes[0].arp,true);assert.equal(saved.chord_templates[saved.handshapes[0].chord_id].arp,true);
 const xml=(await download('xml')).toString();assert.match(xml,/displayName="Original second-arp"/);for(const tag of xml.match(/<handShape\b[^>]*>/g)||[])assert.ok(!/\b(kind|hideName|arp)=/.test(tag));
 await page.locator('[data-zone-go="0"]').press('Control+Shift+h');assert.match(await page.locator('#ws-status').textContent(),/cannot be combined/);
 await page.locator('[data-zone-go="0"]').press('Shift+f');await page.locator('[data-zone-go="0"]').press('Control+Shift+h');saved=(await snapshot()).arrangements[0];assert.equal(saved.handshapes[0].hideName,true);assert.equal(saved.handshapes[0].kind,'chord');assert.ok(saved.chord_templates[saved.handshapes[0].chord_id].displayName.endsWith('-nop'));assert.equal(JSON.stringify(saved.chords.map(c=>c.notes)),music);
 await page.locator('[data-zone-go="0"]').press('Control+Shift+h');
 checks.push('Shift F cycles native-mapped presentation and Ctrl Shift H hides names without changing music; XML uses suffix conventions');
 const moveBox=await page.locator('#ws-canvas').boundingBox();await page.mouse.move(moveBox.x+167,moveBox.y+459);await page.mouse.down();await page.mouse.move(moveBox.x+277,moveBox.y+459,{steps:6});await page.mouse.up();saved=(await snapshot()).arrangements[0];assert.equal(saved.handshapes[0].start_time,1);assert.equal(saved.handshapes[0].end_time,2.75);assert.equal(saved.chords[0].time,1);assert.ok(saved.chords[0].notes.every(n=>n.time===1));
 checks.push('dragging zone body moves its complete strum and notes together on grid');
 await page.locator('#ws-canvas').dblclick({position:{x:277,y:459}});saved=(await snapshot()).arrangements[0];assert.equal(saved.notes.length,0);assert.equal(saved.chords.length,1);
 await page.locator('[data-chord="0"]').press('b');saved=(await snapshot()).arrangements[0];assert.ok(saved.chords[0].notes.every(n=>n.techniques.bend===.5&&n.techniques.bend_values[0].t===0));await page.locator('[data-chord="0"]').press('v');await snapshot();
 const bent=structuredClone(project);bent.title='Original cursor bend study';bent.arrangements[0].notes=[{id:'own-sustained-note',time:1,string:0,fret:5,sustain:2,techniques:{palm_mute:true}}];
 await page.locator('#ws-open-file').setInputFiles({name:'own-bend-study.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bent))});await page.waitForFunction(title=>document.querySelector('#ws-title').textContent.includes(title),bent.title);
 await page.locator('#ws-canvas').click({position:{x:222,y:421.5}});for(let i=0;i<4;i++)await page.keyboard.press('ArrowRight');await page.keyboard.press('b');await page.keyboard.press('b');await page.keyboard.press('v');saved=(await snapshot()).arrangements[0];
 assert.equal(saved.notes[0].techniques.bend,.5);assert.deepEqual(saved.notes[0].techniques.bend_values,[{t:0,v:0},{t:.5,v:.5}]);assert.equal(saved.notes[0].techniques.palm_mute,true);
 checks.push('B/V edit actual cursor point along sustain and preserve chord children and other techniques');
 const reuse=structuredClone(project);reuse.title='Original template reuse study';reuse.arrangements[0].notes=[{id:'own-a',time:0,string:0,fret:3,sustain:.4,techniques:{left_hand:1}},{id:'own-b',time:0,string:1,fret:5,sustain:.4,techniques:{left_hand:3}}];
 await page.locator('#ws-open-file').setInputFiles({name:'own-reuse.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(reuse))});await page.waitForFunction(title=>document.querySelector('#ws-title').textContent.includes(title),reuse.title);await action('selectall');await action('chord');assert.equal(await page.locator('#ws-chord-name').inputValue(),'Original first');await submit();saved=(await snapshot()).arrangements[0];assert.equal(saved.chord_templates.length,2);assert.equal(saved.chords[0].chord_id,0);assert.deepEqual(saved.chords[0].notes.map(n=>n.techniques.left_hand),[1,3]);assert.equal(saved.handshapes[0].hideName,undefined);
 await page.locator('[data-inspector="chords"]').click();await page.locator('#ws-chord-length').fill('4');await page.locator('#ws-chord-gutter').fill('0');await page.locator('[data-zone-resize="0"]').click();await page.locator('#ws-canvas').click({position:{x:167,y:196.5}});await page.keyboard.press('n');saved=(await snapshot()).arrangements[0];assert.equal(saved.chords.length,2);assert.ok(saved.chords[0].notes.every(n=>n.sustain===.4));assert.ok(saved.chords[1].notes.every(n=>n.sustain===0));
 await page.locator('#ws-canvas').press('ArrowRight');const barPixel=await page.locator('#ws-canvas').evaluate(c=>[...c.getContext('2d').getImageData(167,399,1,1).data]);assert.ok(barPixel[0]>220&&barPixel[1]>220&&barPixel[2]>220);
 await page.locator('[data-inspector="properties"]').click();await page.locator('#ws-note-sustain').fill('1');await page.locator('#ws-note-sustain').press('Tab');assert.match(await page.locator('#ws-status').textContent(),/initial strum/);saved=(await snapshot()).arrangements[0];assert.ok(saved.chords[1].notes.every(n=>n.sustain===0));
 checks.push('F reuses matching template/fingers; power-chord name stays visible; new repeat strums render bars without sustain');
 const drop=structuredClone(project);drop.title='Original drag library study';await page.locator('#ws-open-file').setInputFiles({name:'own-drag.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(drop))});await page.waitForFunction(title=>document.querySelector('#ws-title').textContent.includes(title),drop.title);await page.locator('[data-inspector="chords"]').click();await page.locator('#ws-chord-length').fill('1');await page.locator('#ws-chord-gutter').fill('0');
 await page.locator('[data-chord="0"]').dragTo(page.locator('#ws-canvas'),{targetPosition:{x:222,y:220}});saved=(await snapshot()).arrangements[0];assert.equal(saved.chords.length,1);assert.equal(saved.chords[0].time,1);assert.equal(saved.handshapes[0].end_time,1.5);
 await page.locator('[data-chord="0"]').dragTo(page.locator('#ws-canvas'),{targetPosition:{x:442,y:459}});saved=(await snapshot()).arrangements[0];assert.equal(saved.handshapes.length,2);assert.equal(saved.handshapes[1].kind,'fingerprint');assert.equal(saved.chords.length,1);
 await page.locator('[data-chord="0"]').dragTo(page.locator('#ws-canvas'),{targetPosition:{x:552,y:478}});saved=(await snapshot()).arrangements[0];assert.equal(saved.handshapes.length,3);assert.equal(saved.handshapes[2].kind,'arpeggio');assert.equal(saved.handshapes[2].arp,true);assert.equal(saved.chords.length,1);
 checks.push('drag library template to string, handshape and arpeggio lanes inserts one beat at chosen position without duplicate clicks');
 const pair=structuredClone(project);pair.title='Original double-stop study';pair.arrangements[0].notes=[{id:'pair-a',time:0,string:0,fret:3,sustain:.4,techniques:{left_hand:1}},{id:'pair-b',time:0,string:1,fret:3,sustain:.4,techniques:{left_hand:1}}];await page.locator('#ws-open-file').setInputFiles({name:'own-pair.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(pair))});await page.waitForFunction(title=>document.querySelector('#ws-title').textContent.includes(title),pair.title);await action('selectall');await action('chord');await submit();saved=(await snapshot()).arrangements[0];assert.equal(saved.handshapes[0].hideName,true);assert.ok(saved.chord_templates[saved.chords[0].chord_id].displayName.endsWith('-nop'));assert.deepEqual(saved.chords[0].notes.map(n=>n.fret),[3,3]);
 checks.push('non-fifth double-stop name is hidden by native convention without changing its notes');
 assert.deepEqual(errors,[]);ok=true;
}finally{
 await page.screenshot({path:new URL('editor.png',output).pathname.replace(/^\/([A-Za-z]:)/,'$1'),fullPage:true}).catch(()=>{});
 const report={ok,timestamp:new Date().toISOString(),checks,errors};await writeFile(new URL('report.json',output),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close();
}
