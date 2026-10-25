"""Actual Playtest/Loop visible LOW difficulty vs ordinary HIGH Feedpak export.
Only original local fixtures, production host/provider loader and public APIs.
Workspace config/library/cache; no user service or source runtime changes.
"""
from __future__ import annotations
import argparse,importlib.util,json,sys,uuid
from pathlib import Path
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('visible_dd_production_gate',ROOT/'tools'/'verify-highway.py')
gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate);gate.__file__=__file__
boundary=" await page.locator('#ws-open-file').setInputFiles({name:'own-highway-study.json'"
if gate.BROWSER.count(boundary)!=1:raise RuntimeError('Original fixture boundary changed')
prefix=gate.BROWSER[:gate.BROWSER.index(boundary)]
gate.BROWSER=prefix+r'''
 fixture.title='Original visible difficulty playback study';fixture.arrangements=fixture.arrangements.filter(a=>['guitar','drums'].includes(a.type));
 for(const a of fixture.arrangements){
  const low=a.type==='drums'?[{id:'low-drum',time:2,piece:'kick',velocity:91,sustain:0,techniques:{}}]:[{id:'low-guitar',time:2,string:0,fret:3,sustain:.3,techniques:{}}];
  const high=a.type==='drums'?[{id:'high-drum',time:6,piece:'ride_bell',velocity:116,sustain:0,techniques:{}}]:[{id:'high-guitar',time:6,string:4,fret:15,sustain:.7,techniques:{}}];
  a.notes=structuredClone(low);a.chords=[];a.anchors=[];a.handshapes=[];a.phrases=[{id:'own-phrase',time:0,name:'Own phrase'}];a.difficulties=[{difficulty:0,notes:structuredClone(low),chords:[],anchors:[],handshapes:[],ownLevel:{source:'LOW'}},{difficulty:3,notes:high,chords:[],anchors:[],handshapes:[],ownLevel:{source:'HIGH'}}];a.activeDifficulty=0;
  if(a.type==='guitar')a._wire={ownOpaque:{preserve:'source'},phrases:[{start_time:0,end_time:12,name:'Own phrase',max_difficulty:3,levels:[{difficulty:0,notes:[{t:2,s:0,f:3,sus:.3}],chords:[],anchors:[],handshapes:[],ownNative:'LOW'},{difficulty:3,notes:[{t:6,s:4,f:15,sus:.7}],chords:[],anchors:[],handshapes:[],ownNative:'HIGH'}]}]};
 }
 async function action(name){const el=page.locator(`[data-action="${name}"]`).first();await el.evaluate(button=>{const d=button.closest('details');if(d)d.open=true;});await el.click();}
 async function submit(){await page.evaluate(()=>{window.__visibleDdClosed=new Promise(resolve=>document.querySelector('#ws-dialog').addEventListener('close',()=>queueMicrotask(resolve),{once:true}));});await page.locator('#ws-dialog-submit').click();await page.evaluate(()=>window.__visibleDdClosed);}
 async function download(format){const pending=page.waitForEvent('download');await action('saveas');await page.locator('#ws-export-format').selectOption(format);await submit();const chunks=[],stream=await(await pending).createReadStream();for await(const chunk of stream)chunks.push(chunk);return Buffer.concat(chunks);}
 async function snapshot(){return JSON.parse(await download('json'));}
 async function region(){await action('selectregion');await page.locator('#ws-region-start').fill('1');await page.locator('#ws-region-end').fill('3');await submit();await page.waitForFunction(()=>document.querySelector('#ws-inspector-content h3')?.textContent.startsWith('1 selected'));}
 async function editorContext(){return page.evaluate(()=>({arrangement:document.querySelector('#ws-arrangement').value,difficulty:document.querySelector('#ws-difficulty').value,zoom:document.querySelector('#ws-zoom').value,scrollLeft:document.querySelector('#ws-timeline-scroll').scrollLeft,selection:document.querySelector('#ws-inspector-content h3').textContent,property:document.querySelector('#ws-note-piece')?.value??document.querySelector('#ws-note-fret')?.value}));}
 await page.locator('#ws-open-file').setInputFiles({name:'original-visible-dd.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});await page.waitForFunction(title=>document.querySelector('#ws-title').textContent.includes(title),fixture.title);
 const cases=[],normalExports=[];
 for(const type of ['guitar','drums']){
  const original=fixture.arrangements.find(a=>a.type===type);await page.locator('#ws-arrangement').selectOption(original.id);assert.equal(await page.locator('#ws-difficulty').inputValue(),'0');await region();
  if(type==='guitar'){await page.locator('#ws-note-fret').fill('9');await page.locator('#ws-note-fret').dispatchEvent('change');}
  else{await page.locator('#ws-note-piece').selectOption('snare');}
  await page.locator('#ws-zoom').fill('250');await page.locator('#ws-zoom').dispatchEvent('input');await page.locator('#ws-timeline-scroll').evaluate(el=>el.scrollLeft=50);
  const sourceBefore=await snapshot(),contextBefore=await editorContext(),partBefore=sourceBefore.arrangements.find(a=>a.id===original.id);assert.deepEqual(partBefore.difficulties.find(l=>l.difficulty===3),original.difficulties.find(l=>l.difficulty===3));
  for(const mode of ['start','loop']){
   const socketStart=ws.length;await action(mode==='loop'?'playtest-loop':'playtest-start');await page.waitForSelector('#player.active');
   await page.waitForFunction(()=>feedBack.playback.snapshot().state.transport.readiness==='ready'&&feedBack.playback.snapshot().state.transport.isPlaying,{},{timeout:30000});
   const first=await page.evaluate(async()=>{const module=await import('/api/plugins/open_chart_editor/src/playtest.js');window.visibleDdModule=module;window.visibleDdPreview=module.getPreviews().find(p=>p.status==='playing');if(!visibleDdPreview)throw Error('Visible DD playtest did not produce an owned handle');return {filename:visibleDdPreview.filename,loop:feedBack.getLoop(),time:feedBack.playback.snapshot().state.media.mediaTime,notes:highway.getNotes(),filtered:highway.getFilteredNotes(),classic:highway.isDefaultRenderer(),rendererLabel:document.querySelector('#viz-picker option[value="auto"]')?.textContent};});
   const messages=ws.slice(socketStart).flatMap(socket=>socket.payload),info=messages.find(message=>message.type==='song_info'),wire=messages.filter(message=>message.type==='notes').flatMap(message=>message.data??[]),hits=messages.filter(message=>message.type==='drum_hits').flatMap(message=>message.data??[]);
   assert.equal(info.arrangement,original.name);
   if(type==='guitar'){assert.deepEqual(wire.map(n=>[n.t,n.s,n.f]),[[2,0,9]]);assert.deepEqual(first.notes.map(n=>[n.t,n.s,n.f]),[[2,0,9]]);assert.deepEqual(first.filtered.map(n=>[n.t,n.s,n.f]),[[2,0,9]]);assert.equal(first.classic,true);}
   else{assert.deepEqual(hits.map(n=>[n.t,n.p]),[[2,'snare']]);assert.equal(first.classic,false);assert.ok(first.rendererLabel.includes('3D'));}
   if(mode==='loop')assert.deepEqual(first.loop,{loopA:1,loopB:3});
   else assert.deepEqual(first.loop,{loopA:null,loopB:null});
   let wrap=null;
   if(mode==='loop')wrap=await page.evaluate(async()=>{const start=performance.now();let high=null,wrapped=null;while(performance.now()-start<18000){const time=feedBack.playback.snapshot().state.media.mediaTime;if(time>2.8&&time<3.3)high=time;if(high!==null&&time>=.9&&time<1.3)wrapped??=time;if(wrapped!==null&&time>wrapped+.12&&time<2)return {high,wrapped,advancedTo:time};await new Promise(r=>setTimeout(r,40));}throw Error('Visible LOW loop did not wrap real media clock');});
   else await page.waitForFunction(time=>feedBack.playback.snapshot().state.media.mediaTime>time+.1,first.time,{timeout:15000});
   const canvasScreenshot=process.env.OCE_HIGHWAY_SCREENSHOT.replace('.png',`-${type}-${mode}-canvas.png`);await page.locator('#highway').screenshot({path:canvasScreenshot});
   const canvasPixels=type==='drums'?null:await page.locator('#highway').evaluate(canvas=>{const bytes=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let pixels=0;for(let i=0;i<bytes.length;i+=4)if(bytes[i]+bytes[i+1]+bytes[i+2]>70)pixels++;return pixels;});if(canvasPixels!==null)assert.ok(canvasPixels>1000);
   await page.evaluate(async()=>{await visibleDdModule.endPlaytest(visibleDdPreview);});await page.waitForTimeout(250);await page.evaluate(async()=>{await visibleDdModule.removePreview(visibleDdPreview);});await page.waitForSelector('#plugin-open_chart_editor.active #ws-canvas');assert.deepEqual(await editorContext(),contextBefore);assert.deepEqual(await snapshot(),sourceBefore);
   cases.push({type,mode,visibleDifficulty:0,highDifficulty:3,actualOceMenu:true,wireNotes:wire,drumHits:hits,mediaWrap:wrap,canvasScreenshot,canvasPixels,contextRestored:true,allSourceLevelsUnchanged:true,ownedPreviewRemoved:true});
  }
  const exported=await download('feedpak'),inspect=await page.request.post(process.env.OCE_HOST_URL+'/harness/inspect-visible-dd',{data:exported,headers:{'Content-Type':'application/zip'}});assert.equal(inspect.status(),200);const native=await inspect.json(),part=native.parts.find(p=>p.id===original.id);
  if(type==='guitar'){assert.deepEqual(part.notes.map(n=>[n.t,n.s,n.f]),[[6,4,15]]);assert.deepEqual(part.phrases[0].levels.map(l=>[l.difficulty,l.notes.map(n=>[n.t,n.s,n.f])]),[[0,[[2,0,9]]],[3,[[6,4,15]]]]);}
  else{assert.deepEqual(part.hits.map(n=>[n.t,n.p]),[[6,'ride_bell']]);const author=native.drumAuthoring.arrangements.find(a=>a.id===original.id).authoring;assert.equal(author.activeDifficulty,0);assert.deepEqual(author.difficulties.map(l=>[l.difficulty,l.notes.map(n=>[n.time,n.piece])]),[[0,[[2,'snare']]],[3,[[6,'ride_bell']]]]);}
  assert.deepEqual(await snapshot(),sourceBefore);normalExports.push({type,highestNativeNotes:part.notes,highestNativeHits:part.hits,nativePhrases:part.phrases,allSourceLevelsUnchanged:true,drumAuthoringRetained:type==='drums'});
 }
 const isolation=await(await page.request.get(process.env.OCE_HOST_URL+'/harness/isolation')).json();assert.deepEqual(isolation.entries,[]);assert.equal(isolation.stagedDatabaseCompatibilityFix,false);
 const ancillaryCoreFailures=httpErrors.filter(item=>!['/api/plugins/minigames/profile','/api/plugins/minigames/registry','/api/plugins/tuner/config'].some(path=>item.url.endsWith(path)));assert.deepEqual(errors,[]);assert.deepEqual(ancillaryCoreFailures,[]);
 console.log(JSON.stringify({ok:true,playbackPassed:true,fullShellClean:true,cases,normalExports,isolation,errors,httpErrors,ancillaryCoreFailures,blockedExternalOrigins:[...new Set(blocked)],physicalHardwareVerified:false}));
}catch(error){console.error(JSON.stringify({error:String(error),errors,httpErrors,blocked,websockets:ws}));throw error;}
finally{await page.screenshot({path:process.env.OCE_HIGHWAY_SCREENSHOT}).catch(()=>{});await browser.close();}
'''

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--serve',action='store_true');parser.add_argument('--host-root',type=Path,default=gate.HOST);parser.add_argument('--run-dir',type=Path);parser.add_argument('--port',type=int,default=0);parser.add_argument('--installed',action='store_true',help='Stage the exact recorded installed bytes, not working source');args=parser.parse_args()
    if args.serve:
        if not args.run_dir or not gate.install_module().within(args.run_dir,ROOT/'tools'/'.host-runs'):raise ValueError('Isolated workspace run directory required')
        import uvicorn
        app=gate.make_app(args.host_root,args.run_dir)
        @app.post('/harness/inspect-visible-dd')
        async def inspect_visible_dd(request:gate.Request):
            import io,zipfile,yaml
            data=await request.body()
            if len(data)>2*1024*1024:raise ValueError('Original DD fixture exceeds bounded size')
            with zipfile.ZipFile(io.BytesIO(data))as archive:
                manifest=yaml.safe_load(archive.read('manifest.yaml'));parts=[]
                for entry in manifest['arrangements']:
                    raw=json.loads(archive.read(entry.get('drum_tab')or entry['file']))
                    parts.append({'id':entry['id'],'type':entry['type'],'notes':raw.get('notes',[]),'hits':raw.get('hits',[]),'phrases':raw.get('phrases',[])})
                author=json.loads(archive.read('editor/oce-drums.json'))if'editor/oce-drums.json'in archive.namelist()else None
            return {'parts':parts,'drumAuthoring':author}
        uvicorn.run(app,host='127.0.0.1',port=args.port,log_level='warning');return 0
    run=ROOT/'tools'/'.host-runs'/uuid.uuid4().hex;run.mkdir(parents=True)
    try:
        installed_record=None
        if args.installed:
            installed_record=json.loads((ROOT/'research'/'installed-local.json').read_text(encoding='utf-8'))
            installed=Path(installed_record['destination'])
            if installed.resolve()!=(args.host_root/'plugins'/'open_chart_editor').resolve():raise ValueError('Unexpected recorded installed destination')
            installer=gate.install_module();original_plan=installer.make_plan
            installer.RUNTIME_FILES=tuple(row['path']for row in installed_record['files']if row['path']not in installer.OPTIONAL_FILES)
            installer.make_plan=lambda destination,source=installed:original_plan(destination,source)
            gate.install_module=lambda:installer
        result=gate.verify(args.host_root,run)
        if len(result['browser']['cases'])!=4:raise ValueError('Four actual visible-DD cases required')
        current=gate.install_module().make_plan(run/'plugins'/'open_chart_editor')
        if current['sourceDigest']!=result['sourceDigest']:raise ValueError('Source changed during digest-gated visible-DD run')
        result['sourceStable']=True
        if installed_record:
            if result['sourceDigest']!=installed_record['sourceDigest']:raise ValueError('Installed bytes differ from recorded digest')
            result.update(installedSnapshotVerified=True,installedSource=str(installed))
    except Exception as error:result={'ok':False,'error':str(error),'runDirectory':str(run),'userLibraryTouched':False,'externalDestinationInstalled':False}
    report_name=('installed-'if args.installed else'')+'highway-visible-dd-integration.json'
    (run/'report.json').write_text(json.dumps(result,indent=2),encoding='utf-8');(ROOT/'research'/report_name).write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps({'ok':result['ok'],'report':str(run/'report.json'),'sourceDigest':result.get('sourceDigest'),'cases':result.get('browser',{}).get('cases'),'error':result.get('error')},indent=2));return 0 if result['ok']else 1
if __name__=='__main__':raise SystemExit(main())
