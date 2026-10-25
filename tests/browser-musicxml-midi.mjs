// Original fixtures and guarded real UI gate. --prepare NEVER launches a browser.
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const prepare=process.argv.includes('--prepare');
if(!prepare&&process.env.OCE_INTEROP_BROWSER_RELEASE!=='1')throw Error('MIDI/MusicXML browser gate held. Require explicit root release before OCE_INTEROP_BROWSER_RELEASE=1; --prepare runs source-only checks.');

const fixtureScript=String.raw`
from pathlib import Path
import base64,hashlib,io,json,sys,wave,zipfile
sys.path.insert(0,str(Path('tests').resolve()))
from probe_midi_programs import own_midi
import pack_io as p
folder=Path('research/interop-browser-fixtures');folder.mkdir(parents=True,exist_ok=True)
xml=b'''<score-partwise version="4.0"><work><work-title>Own numeric dynamics and tempo</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1" implicit="yes"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction><direction-type><words>Own soft</words></direction-type><sound dynamics="50" tempo="120"/></direction><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note><direction><direction-type><words>Own louder and slower</words></direction-type><offset>-1</offset><sound dynamics="100" tempo="60"/></direction><note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note></measure></part></score-partwise>'''
extra=b'Original extra source bytes\x00\xff'
buffer=io.BytesIO()
with zipfile.ZipFile(buffer,'w',compression=zipfile.ZIP_DEFLATED) as z:
 for name,data in [('META-INF/container.xml',b'<container><rootfiles><rootfile full-path="score/own.musicxml"/></rootfiles></container>'),('score/own.musicxml',xml),('own/extra.bin',extra),('own/notes.txt',b'Own original archive annotation')]:
  info=zipfile.ZipInfo(name,(2026,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,data)
mxl=buffer.getvalue();midi=own_midi();audio=io.BytesIO()
with wave.open(audio,'wb') as wav:
 wav.setparams((1,2,8000,0,'NONE','not compressed'));wav.writeframes(b'\0\0'*32000)
wav=audio.getvalue()
payloads={'own.musicxml':xml,'own.mxl':mxl,'own.mid':midi,'own-backing.wav':wav}
for name,data in payloads.items():(folder/name).write_bytes(data)
checks=[];limitations=[]
for name in ['own.musicxml','own.mxl']:
 project=p.load_project(payloads[name],name)
 assert [n['velocity'] for n in project['arrangements'][0]['notes']]==[45,90]
 assert [n['time'] for n in project['arrangements'][0]['notes']]==[0,.5]
 assert [b['time'] for b in project['beats'][:4]]==[0,.5,1.5,2.5]
 assert base64.b64decode(project['_import']['source'])==xml
 if name.endswith('.mxl'):assert base64.b64decode(project['_pack']['entries'][project['_import']['sourceArchive']['entry']])==mxl
 pack=project.setdefault('_pack',{});pack.setdefault('entries',{})['audio/own.wav']=base64.b64encode(wav).decode();pack.setdefault('manifest',{})['stems']=[{'id':'own','file':'audio/own.wav','default':True}]
 for note in project['arrangements'][0]['notes']:note.update(pitch=72,string=3,fret=0)
 reopened=p.load_project(p.save_feedpak(project),'own.feedpak')
 assert [n['pitch'] for n in reopened['arrangements'][0]['notes']]==[72,72]
 if name.endswith('.mxl'):assert base64.b64decode(reopened['_pack']['entries'][reopened['_import']['sourceArchive']['entry']])==mxl
 if name.endswith('.mxl'):checks.append(name+': exact original score/archive/extra bytes and authoritative edited pitch survive native Feedpak')
 else:
  assert base64.b64decode(p.load_project(p.save_project(project,'json')[0],'own.json')['_import']['source'])==xml
  checks.append(name+': actual parser45/90, corrected tempo map, exact score in JSON and authoritative edited pitch in Feedpak')
  if reopened.get('_import',{}).get('source')!=base64.b64encode(xml).decode():limitations.append('Plain MusicXML original score provenance is not yet retained through native Feedpak; strict browser source-preservation assertion is blocked pending adapter extension.')
  else:checks.append('Plain MusicXML original normalized score bytes now survive native Feedpak reopen exactly')
project=p.load_project(midi,'own.mid');assert p._midi_programs.source_bytes(project)==midi
assert p.save_project(project,'json')[0].count(base64.b64encode(midi))==1
print(json.dumps({'files':{name:{'path':str(folder/name),'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)} for name,data in payloads.items()},'extraSha256':hashlib.sha256(extra).hexdigest(),'checks':checks,'limitations':limitations,'midiProject':project}))
`;
const result=spawnSync('python',['-c',fixtureScript],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
assert.equal(result.status,0,result.stderr);const preparation=JSON.parse(result.stdout);
const fixtures=Object.fromEntries(await Promise.all(Object.entries(preparation.files).map(async([name,row])=>[name,await readFile(new URL('../'+row.path.replaceAll('\\','/'),import.meta.url))])));
const sourceFiles=['src/main.js','src/model.js','src/guide-voice.js','src/guide-synthesis.js','pack_io.py','midi_programs.py','musicxml_dynamics.py'];
const sourceHashes=Object.fromEntries(await Promise.all(sourceFiles.map(async name=>[name,sha(await readFile(new URL('../'+name,import.meta.url)))])));
const {resolveGuideVoice,guideVoiceTimelineDTO}=await import('../src/guide-voice.js');
const {normalizeProject}=await import('../src/model.js');const normalized=normalizeProject(preparation.midiProject);assert.deepEqual(normalized.arrangements[0].tones.definitions,{});assert.ok(Array.isArray(normalized.arrangements[0].tones.changes));
assert.deepEqual([0,.5].map(time=>resolveGuideVoice(preparation.midiProject.arrangements[0],{rigLibrary:preparation.midiProject.rigLibrary,time}).program),[73,40]);
assert.deepEqual(guideVoiceTimelineDTO(preparation.midiProject.arrangements[0],{rigLibrary:preparation.midiProject.rigLibrary}).changes.map(change=>change.time),[0,.5]);
if(prepare){
 const html=await readFile(new URL('../screen.html',import.meta.url),'utf8'),main=await readFile(new URL('../src/main.js',import.meta.url),'utf8');for(const id of ['ws-open-file','ws-audio-file','ws-import-file','ws-export-format'])assert.ok(html.includes(id)||main.includes(id),id+' UI input exists');
 const report={ok:true,browserLaunched:false,mode:'source-only preparation',checks:[...preparation.checks,'Actual current guide resolver and worker DTO retain programs73/40 at0/.5; one MIDI payload in JSON','Actual UI normalizeProject initializes rig-only definitions and changes safely'],files:preparation.files,knownLimitations:preparation.limitations,sourceHashes,release:'OCE_INTEROP_BROWSER_RELEASE=1 only after explicit root approval and safe backend refresh',scope:'No browser/preview-server request, audio/hardware access or service restart. Browser assertions remain unexecuted.'};
 await mkdir(new URL('../verification/',import.meta.url),{recursive:true});await writeFile(new URL('../verification/browser-musicxml-midi-prepared.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exit(0);
}

if(preparation.limitations.length)throw Error('Browser held by current source-only preflight limitation: '+preparation.limitations.join(' '));
const require=createRequire(import.meta.url),{chromium}=require(process.env.OCE_PLAYWRIGHT||'C:/Users/zagat/AppData/Roaming/npm/node_modules/rea-agents/node_modules/playwright-core');
const browser=await chromium.launch({headless:true,args:['--mute-audio'],executablePath:process.env.OCE_CHROMIUM||'C:/Users/zagat/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe'});
const context=await browser.newContext({viewport:{width:1700,height:1050}});
await context.addInitScript(()=>{
 window.__interopSaves=[];window.__interopHardwareRequests=[];
 window.showSaveFilePicker=async options=>({name:options.suggestedName,createWritable:async()=>({write:async value=>{const blob=value instanceof Blob?value:new Blob([value]);window.__interopSaves.push({name:options.suggestedName,bytes:Array.from(new Uint8Array(await blob.arrayBuffer()))});},close:async()=>{}})});
 Object.defineProperty(navigator,'requestMIDIAccess',{value:async()=>{window.__interopHardwareRequests.push('MIDI');throw Error('Hardware is disabled in this original fixture gate');}});
 if(navigator.mediaDevices)Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{window.__interopHardwareRequests.push('microphone');throw Error('Hardware is disabled in this original fixture gate');}});
});
const page=await context.newPage(),checks=[],errors=[],url=process.env.OCE_URL||'http://127.0.0.1:8766';let report;
page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
const action=name=>page.locator(`[data-action="${name}"]`).first().evaluate(element=>element.click());
async function save(format='json'){
 const index=await page.evaluate(()=>window.__interopSaves.length);await action('saveas');await page.locator('#ws-export-format').selectOption(format);
 const pending=page.waitForResponse(response=>response.url().endsWith('/save'));await page.locator('#ws-dialog-submit').click();const response=await pending;assert.ok(response.ok(),await response.text());
 await page.waitForFunction(index=>window.__interopSaves.length>index,index);const data=Buffer.from(await page.evaluate(()=>window.__interopSaves.at(-1).bytes));return format==='json'?JSON.parse(data):data;
}
async function open(bytes,name){
 const pending=page.waitForResponse(response=>response.url().endsWith('/load'));await page.locator('#ws-open-file').setInputFiles({name,mimeType:name.endsWith('.musicxml')?'application/xml':name.endsWith('.json')?'application/json':'application/octet-stream',buffer:bytes});
 const response=await pending;assert.ok(response.ok(),await response.text());await page.waitForFunction(name=>document.querySelector('#ws-status').textContent.startsWith('Opened '+name),name);return(await response.json()).project;
}
async function attachAudio(){await page.locator('#ws-audio-file').setInputFiles({name:'own-backing.wav',mimeType:'audio/wav',buffer:fixtures['own-backing.wav']});await page.waitForFunction(()=>document.querySelector('#ws-status').textContent.includes('Audio ready'));}
function scoreExact(project,archive=false){
 assert.equal(sha(Buffer.from(project._import.source,'base64')),preparation.files['own.musicxml'].sha256);
 if(archive){const ref=project._import.sourceArchive;assert.equal(ref.sha256,preparation.files['own.mxl'].sha256);assert.deepEqual(Buffer.from(project._pack.entries[ref.entry],'base64'),fixtures['own.mxl']);}
}
function midiExact(project,arr=project.arrangements[0]){
 const ref=arr.midiProgramIntent.sourceRef;assert.equal(ref.sha256,preparation.files['own.mid'].sha256);assert.deepEqual(Buffer.from(project._pack.entries[ref.entry],'base64'),fixtures['own.mid']);assert.equal(JSON.stringify(project).split(fixtures['own.mid'].toString('base64')).length-1,1);
}
async function browserVoices(project,index=0,times=[0,.5]){
 return page.evaluate(async({project,index,times})=>{const api=await import('/api/plugins/open_chart_editor/src/guide-voice.js');return times.map(time=>{const voice=api.resolveGuideVoice(project.arrangements[index],{rigLibrary:project.rigLibrary,time});return {time,source:voice.source,program:voice.program,family:voice.family};});},{project,index,times});
}
try{
 await page.goto(url);await page.waitForSelector('#ws-app[data-mounted="true"]');
 for(const name of ['src/main.js','src/model.js','src/guide-voice.js'])assert.equal(sha(await(await page.request.get(url+'/api/plugins/open_chart_editor/'+name)).body()),sourceHashes[name],'Served current source '+name);
 for(const name of ['own.musicxml','own.mxl']){
  const imported=await open(fixtures[name],name);assert.deepEqual(imported.arrangements[0].notes.map(note=>note.velocity),[45,90]);assert.deepEqual(imported.beats.slice(0,4).map(beat=>beat.time),[0,.5,1.5,2.5]);scoreExact(imported,name.endsWith('.mxl'));
  await action('selectall');await page.locator('[data-inspector="properties"]').click();assert.equal(await page.locator('#ws-piano-velocity').inputValue(),'45');assert.equal(await page.locator('#ws-note-pitch').inputValue(),'60');
  await attachAudio();const initial=await save();scoreExact(initial,name.endsWith('.mxl'));assert.deepEqual(initial.arrangements[0].notes.map(note=>note.velocity),[45,90]);
  await page.locator('#ws-note-pitch').fill('72');await page.locator('#ws-note-pitch').dispatchEvent('change');const edited=await save();assert.deepEqual(edited.arrangements[0].notes.map(note=>note.pitch),[72,72]);scoreExact(edited,name.endsWith('.mxl'));
  const native=await save('feedpak');await open(native,'own-numeric.feedpak');const reopened=await save();assert.deepEqual(reopened.arrangements[0].notes.map(note=>note.pitch),[72,72]);assert.deepEqual(reopened.arrangements[0].notes.map(note=>note.velocity),[45,90]);assert.deepEqual(reopened.beats.slice(0,4).map(beat=>beat.time),[0,.5,1.5,2.5]);
  scoreExact(reopened,name.endsWith('.mxl'));
  await open(Buffer.from(JSON.stringify(reopened)),'own-numeric-reopened.json');scoreExact(await save(),name.endsWith('.mxl'));
  checks.push(name+': real file input, piano inspector45/90, numeric tempo offset map, own WAV import, authoritative edited pitch and JSON/Feedpak source contract');
 }
 await open(fixtures['own.mid'],'own-programs.mid');const midi=await save();midiExact(midi);assert.deepEqual((await browserVoices(midi)).map(voice=>[voice.program,voice.family]),[[73,'pipe'],[40,'strings']]);assert.deepEqual(midi.arrangements[0].tones.definitions,{});checks.push('Actual MIDI file-open/normalizer/save and browser guide resolver retain timed programs73/40 with one source payload');
 const rigPath=midi._pack.manifest.rigs,rigBytes=midi._pack.entries[rigPath],nativeBindings={base:midi.arrangements[0].tones.base,base_rig:midi.arrangements[0].tones.base_rig,changes:midi.arrangements[0].tones.changes};
 await action('tones');await action('tone-definition');await page.locator('#ws-tone-new-name').fill('Own new tone after MIDI import');await page.locator('#ws-dialog-submit').click();await page.locator('#ws-dialog[open]').waitFor({state:'hidden'});const toned=await save();assert.ok(toned.arrangements[0].tones.definitions['Own new tone after MIDI import']);assert.equal(toned._pack.entries[rigPath],rigBytes);assert.deepEqual(toned.rigLibrary,midi.rigLibrary);assert.deepEqual({base:toned.arrangements[0].tones.base,base_rig:toned.arrangements[0].tones.base_rig,changes:toned.arrangements[0].tones.changes},nativeBindings);checks.push('New Tone UI works on rig-only imported tones; original rig bytes, library and timed source bindings remain exact');
 await attachAudio();await save();const pending=page.waitForResponse(response=>response.url().endsWith('/load'));await page.locator('#ws-import-file').setInputFiles({name:'own-programs-again.mid',mimeType:'audio/midi',buffer:fixtures['own.mid']});assert.ok((await pending).ok());await page.waitForFunction(()=>document.querySelector('#ws-dialog-title').textContent==='Import arrangements'&&document.querySelector('#ws-dialog').open);await page.locator('#ws-import-offset').fill('2');const mergeResponse=page.waitForResponse(response=>response.url().endsWith('/merge'));await page.locator('#ws-dialog-submit').click();assert.ok((await mergeResponse).ok());await page.waitForFunction(()=>document.querySelector('#ws-status').textContent.startsWith('Imported 1 arrangements'));const merged=await save();assert.equal(merged.arrangements.length,2);midiExact(merged,merged.arrangements[1]);assert.notEqual(merged.arrangements[0].id,merged.arrangements[1].id);assert.notEqual(merged.arrangements[0].tones.base_rig,merged.arrangements[1].tones.base_rig);assert.deepEqual((await browserVoices(merged,1,[2,2.5])).map(voice=>voice.program),[73,40]);assert.equal(merged._pack.entries[rigPath],rigBytes);
 const mergedPack=await save('feedpak');await open(mergedPack,'own-merged-midi.feedpak');const restored=await save();assert.equal(restored.arrangements.length,2);midiExact(restored,restored.arrangements[0]);midiExact(restored,restored.arrangements[1]);assert.deepEqual((await browserVoices(restored,1,[2,2.5])).map(voice=>voice.program),[73,40]);checks.push('Real Import arrangements offsets and remaps part/rig IDs; repeated source stays one payload through merged Feedpak+JSON reopen');
 assert.deepEqual(await page.evaluate(()=>window.__interopHardwareRequests),[]);assert.deepEqual(errors,[]);report={ok:true,checks,pageErrors:errors,sourceHashes,fixtureHashes:preparation.files,browserMuted:true,hardwareRequests:[],scope:'Actual original-file UI, inspectors, source durability, native Feedpak and local guide resolution. No audible/native engine, GM sample bank or physical MIDI parity claim.'};
}catch(error){process.exitCode=1;report={ok:false,error:error.stack,checks,pageErrors:errors,sourceHashes,status:await page.locator('#ws-status').textContent().catch(()=>null)};}
finally{await mkdir(new URL('../verification/',import.meta.url),{recursive:true});await writeFile(new URL('../verification/browser-musicxml-midi.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close();}
