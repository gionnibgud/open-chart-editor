import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {makeProject,makeArrangement,makeNote,DRUMS} from '../src/model.js';
const require=createRequire(import.meta.url),{chromium}=require(process.env.OCE_PLAYWRIGHT||'C:/Users/zagat/AppData/Roaming/npm/node_modules/rea-agents/node_modules/playwright-core');
const browser=await chromium.launch({headless:true,args:['--mute-audio'],executablePath:process.env.OCE_CHROMIUM||'C:/Users/zagat/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe'});
const context=await browser.newContext({viewport:{width:1700,height:1050},acceptDownloads:true});
await context.addInitScript(()=>{
 Object.defineProperty(window,'showSaveFilePicker',{value:undefined});
 window.drawnDrumLabels=[];const original=CanvasRenderingContext2D.prototype.fillText;
 CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...rest){if(x===12)window.drawnDrumLabels.push({text:String(text),y});return original.call(this,text,x,y,...rest);};
});
const page=await context.newPage(),checks=[],errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));let ok=false;
async function action(name){await page.locator(`[data-action="${name}"]`).first().evaluate(el=>el.click());}
async function save(format='json'){const pending=page.waitForEvent('download');pending.catch(()=>{});await action('saveas');await page.locator('#ws-export-format').selectOption(format);const response=page.waitForResponse(r=>r.url().endsWith('/save'));await page.locator('#ws-dialog-submit').click();const r=await response;if(!r.ok())throw Error(await r.text());const chunks=[];for await(const chunk of await(await pending).createReadStream())chunks.push(chunk);const bytes=Buffer.concat(chunks);return format==='json'?JSON.parse(bytes):bytes;}
async function open(bytes,name){const response=page.waitForResponse(r=>r.url().endsWith('/load'));await page.locator('#ws-open-file').setInputFiles({name,mimeType:name.endsWith('.json')?'application/json':'application/zip',buffer:bytes});if(await page.locator('#ws-dialog[open]').count())await page.locator('#ws-dialog-submit').click();const r=await response;if(!r.ok())throw Error(await r.text());await page.waitForFunction(name=>document.querySelector('#ws-status').textContent.startsWith(`Opened ${name}`),name);}
async function hit(time,label,{double=false}={}){
 const y=await page.evaluate(label=>window.drawnDrumLabels.findLast(row=>row.text===label)?.y,label);assert.ok(Number.isFinite(y),`Missing actual canvas label ${label}`);
 await page.locator('#ws-timeline-scroll').evaluate((el,y)=>{el.scrollTop=Math.max(0,y-250);},y);
 const r=await page.locator('#ws-canvas').boundingBox(),offset=await page.locator('#ws-timeline-scroll').evaluate(el=>el.scrollTop),x=112+time*Number(await page.locator('#ws-zoom').inputValue());
 if(double)await page.mouse.dblclick(r.x+x,r.y+y-offset);else await page.mouse.click(r.x+x,r.y+y-offset);
}
try{
 await page.goto(process.env.OCE_URL||'http://127.0.0.1:8766');await page.waitForSelector('#ws-app[data-mounted="true"]');
 const p=makeProject();p.title='Original custom drum lanes';p.duration=8;p.beats=p.beats.slice(0,17);const a=makeArrangement('drums');p.arrangements=[a];
 const metal='own-metal<&"',wood='own-wood',tick='own-tick';
 a._wire={version:1,kit:[{id:'snare',name:'Original snare'},{id:metal,name:'Metal <own> "cue"'},{id:wood,name:'Own wood cue'}],future:{retain:true}};a.chord_templates=[{name:'Own simultaneous drum group',frets:[0,0,-1,-1,-1,-1]}];
 const note=(id,time)=>({...makeNote(a,time,0),piece:id});
 const low={difficulty:0,notes:[note(metal,1)],chords:[],anchors:[],handshapes:[]};
 const high={difficulty:7,notes:[note(wood,2)],chords:[{id:'own-custom-group',time:3,chord_id:0,notes:[note(tick,3),note('snare',3)]}],anchors:[],handshapes:[]};
 a.difficulties=[structuredClone(low),structuredClone(high)];Object.assign(a,structuredClone(low));delete a.difficulty;a.activeDifficulty=0;
 await open(Buffer.from(JSON.stringify(p)),'own-custom-drums.json');
 await page.locator('#ws-timeline-scroll').evaluate(el=>el.scrollTop=400);await page.waitForTimeout(50);
 const labels=await page.evaluate(()=>window.drawnDrumLabels.map(row=>row.text));assert.ok(labels.includes('Metal <own> "cue"'));assert.ok(labels.includes('Own wood cue'));assert.ok(labels.includes(tick));
 await hit(1,'Metal <own> "cue"');assert.equal(await page.locator('#ws-note-piece').inputValue(),metal);
 const options=await page.locator('#ws-note-piece option').evaluateAll(els=>els.map(el=>({id:el.value,label:el.textContent})));
 assert.deepEqual(options.slice(0,18).map(row=>row.id),DRUMS);assert.deepEqual(options.slice(18).map(row=>row.id),[metal,wood,tick]);assert.equal(options.find(row=>row.id===metal).label,'Metal <own> "cue"');assert.equal(await page.locator('#ws-note-piece img').count(),0);
 checks.push('Imported custom hits have real selectable canvas lanes and escaped source labels; hidden-level chord pieces participate in stable lane order');
 const original=await save();assert.equal(original.arrangements[0].notes[0].piece,metal);assert.deepEqual(original.arrangements[0]._wire,a._wire);
 await page.locator('#ws-note-piece').selectOption(wood);assert.equal((await save()).arrangements[0].notes[0].piece,wood);await action('undo');assert.equal((await save()).arrangements[0].notes[0].piece,metal);
 checks.push('Kit-piece selection and undo preserve exact custom IDs and opaque source legend data');
 await hit(4,'Metal <own> "cue"',{double:true});let edited=await save();assert.equal(edited.arrangements[0].notes.find(n=>n.time===4)?.piece,metal);assert.deepEqual(edited.arrangements[0].difficulties.find(l=>l.difficulty===7),high);
 await page.locator('#ws-difficulty').selectOption('7');assert.equal(await page.locator('#ws-note-piece').count(),0);await hit(2,'Own wood cue');assert.equal(await page.locator('#ws-note-piece').inputValue(),wood);assert.deepEqual((await page.locator('#ws-note-piece option').evaluateAll(els=>els.map(el=>el.value))),options.map(row=>row.id));
 checks.push('Double-click enters the actual custom lane and difficulty switching keeps lane identities and untouched higher content');
 const wav=Buffer.alloc(44+8000*8*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);await page.locator('#ws-audio-file').setInputFiles({name:'own-silent-count.wav',mimeType:'audio/wav',buffer:wav});await page.waitForFunction(()=>document.querySelector('#ws-status').textContent.includes('Audio ready'));
 const pack=await save('feedpak');const native=spawnSync('python',['-c','import sys,io,json,zipfile,yaml;z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()));m=yaml.safe_load(z.read("manifest.yaml"));a=next(x for x in m["arrangements"] if x.get("drum_tab"));print(json.dumps(json.loads(z.read(a["drum_tab"]))))'],{input:pack,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(native.status,0,native.stderr);const wire=JSON.parse(native.stdout);assert.ok(wire.hits.some(n=>n.p===wood));assert.ok(wire.hits.some(n=>n.p===tick));assert.deepEqual(wire.kit,a._wire.kit);
 await open(pack,'own-custom-drums.feedpak');edited=await save();assert.ok(edited.arrangements[0].difficulties.find(l=>l.difficulty===0).notes.some(n=>n.time===4&&n.piece===metal));assert.deepEqual(edited.arrangements[0]._wire.kit,a._wire.kit);
 checks.push('Native Feedpak retains exact highest-level custom hits and legend; reopening restores complete custom authoring levels');
 assert.deepEqual(errors,[]);ok=true;
}finally{await mkdir(new URL('../verification/',import.meta.url),{recursive:true});const report={ok,checks,errors};await writeFile(new URL('../verification/browser-custom-drums.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close();}
