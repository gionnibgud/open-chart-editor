"""Actual isolated host vocal-only playback, installed provider, denied hardware."""
from pathlib import Path
import argparse,hashlib,importlib.util,json,sys,uuid
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('vocal_production_gate',ROOT/'tools/verify-highway.py');gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate);gate.__file__=__file__
gate.PROVIDER_IDS=(*gate.PROVIDER_IDS,'vocal_highway')
boundary=" await page.locator('#ws-open-file').setInputFiles({name:'own-highway-study.json'"
prefix=gate.BROWSER[:gate.BROWSER.index(boundary)].replace("['song_info','notes','drum_tab','drum_hits']","['song_info','notes','drum_tab','drum_hits','lyrics']")
gate.BROWSER=prefix+r'''
 fixture.title='Original public vocal-only playback study';
 fixture.vocals=[{id:'own-word-0',time:2,length:.75,text:'Own source syllable',pitch:55},{id:'own-word-1',time:3,length:.5,text:'boundary+',pitch:127},{id:'own-word-2',time:4,length:.8,text:'Original',pitch:60},{id:'own-word-3',time:5.5,length:.25,text:'unpitched'},{id:'own-word-4',time:6,length:0,text:'zero',pitch:64}];
 fixture._pack.manifest.lyrics='vocal-source/lyrics.json';fixture._pack.manifest.vocal_pitch='vocal-source/pitch.json';
 fixture._pack.entries['vocal-source/lyrics.json']=Buffer.from(JSON.stringify([{t:2,d:.75,w:'Own source syllable'}])).toString('base64');fixture._pack.entries['vocal-source/pitch.json']=Buffer.from(JSON.stringify({version:1,notes:[{t:2,d:.75,midi:55}]})).toString('base64');
 async function action(name){const button=page.locator(`[data-action="${name}"]`).first();await button.evaluate(el=>{const menu=el.closest("details");if(menu)menu.open=true;});await button.click();}
 async function snapshot(){const pending=page.waitForEvent('download');pending.catch(()=>{});await action('saveas');await page.locator('#ws-export-format').selectOption('json');await page.evaluate(()=>{window.vocalDialogClosed=new Promise(resolve=>document.querySelector('#ws-dialog').addEventListener('close',()=>queueMicrotask(resolve),{once:true}));});await page.locator('#ws-dialog-submit').click();const chunks=[];for await(const chunk of await(await pending).createReadStream())chunks.push(chunk);await page.evaluate(()=>vocalDialogClosed);return JSON.parse(Buffer.concat(chunks));}
 await page.locator('#ws-open-file').setInputFiles({name:'own-vocal-study.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});await page.waitForFunction(title=>document.querySelector('#ws-title').textContent.includes(title),fixture.title);await action('vocals');
 await page.locator('[data-vocal-id="own-word-0"][data-vocal-field="pitch"]').fill('0');await page.locator('[data-vocal-id="own-word-0"][data-vocal-field="pitch"]').dispatchEvent('change');
 await page.locator('[data-vocal-id="own-word-0"][data-vocal-field="text"]').fill('Own edited syllable');await page.locator('[data-vocal-id="own-word-0"][data-vocal-field="text"]').dispatchEvent('change');
 await page.locator('[data-vocal-reveal="own-word-0"]').click();
 const source=await snapshot(),before=JSON.stringify(source),cases=[];
 const editorContext=()=>page.evaluate(()=>({viewVisible:!document.querySelector('#ws-vocal-view').hidden,arrangement:document.querySelector('#ws-arrangement').value,zoom:document.querySelector('#ws-zoom').value,vocalScroll:document.querySelector('.ws-vocal-timeline-scroll')?.scrollLeft,firstPitch:document.querySelector('[data-vocal-id="own-word-0"][data-vocal-field="pitch"]')?.value,firstText:document.querySelector('[data-vocal-id="own-word-0"][data-vocal-field="text"]')?.value}));
 const contextBefore=await editorContext();
 for(const mode of ['beginning','cursor','loop']){
  const socketStart=ws.length,mediaBefore=await page.evaluate(()=>window.__mediaDenied);
  if(mode==='cursor')await page.evaluate(async({source})=>{const m=await import('/api/plugins/open_chart_editor/src/playtest.js');window.vocalPlaytestModule=m;window.vocalPreview=await m.buildAndPlaytest(source,{vocalOnly:true,startTime:2.05});},{source});
  else {await action(mode==='loop'?'playtest-loop':'playtest-start');await page.waitForSelector('#player.active');await page.evaluate(async()=>{window.vocalPlaytestModule=await import('/api/plugins/open_chart_editor/src/playtest.js');});await page.waitForFunction(()=>vocalPlaytestModule.getPreviews().some(p=>p.status==='playing'));await page.evaluate(()=>{const m=vocalPlaytestModule;window.vocalPreview=m.getPreviews().find(p=>p.status==='playing');if(!window.vocalPreview)throw Error('Actual UI did not retain an owned playing preview: '+JSON.stringify(m.getPreviews().map(p=>({status:p.status,filename:p.filename}))));});}
  await page.waitForFunction(()=>feedBack.playback.snapshot().state.transport.isPlaying&&highway.getSongInfo()?.arrangement==='Vocals');await page.waitForSelector('[data-vocal-microphone="explicit"]');
  await page.waitForFunction(()=>document.querySelector('#viz-picker option[value="auto"]')?.textContent.includes('Vocal Highway'));
  const preview=await page.evaluate(()=>({filename:vocalPreview.filename,time:feedBack.playback.snapshot().state.media.mediaTime,loop:feedBack.getLoop(),mic:document.querySelector('[data-vocal-microphone]').textContent,mediaDenied:window.__mediaDenied,notes:highway.getNotes(),label:document.querySelector('#viz-picker option[value="auto"]').textContent}));
  assert.equal(preview.mic,'Start microphone');assert.equal(preview.mediaDenied,mediaBefore);assert.deepEqual(preview.notes,[]);
  const pitchResponse=await page.request.get(process.env.OCE_HOST_URL+'/api/plugins/vocal_highway/pitch?filename='+encodeURIComponent(preview.filename));assert.equal(pitchResponse.status(),200);const pitch=await pitchResponse.json();assert.deepEqual(pitch.notes.map(n=>[n.t,n.d,n.midi]),[[2,.75,0],[3,.5,127],[4,.8,60]]);
  const messages=ws.slice(socketStart).flatMap(s=>s.payload),info=messages.find(m=>m.type==='song_info'),lyrics=messages.find(m=>m.type==='lyrics')?.data;assert.equal(info.arrangement,'Vocals');assert.deepEqual(lyrics.map(v=>[v.t,v.d,v.w]),source.vocals.map(v=>[v.time,v.length,v.text]));assert.equal(messages.filter(m=>m.type==='notes').flatMap(m=>m.data||[]).length,0);assert.equal(messages.some(m=>m.type==='drum_hits'),false);
  let mediaWrap=null;if(mode==='loop'){
   assert.deepEqual(preview.loop,{loopA:2,loopB:2.75});
   mediaWrap=await page.evaluate(async()=>{let high=null,wrapped=null;const start=performance.now();while(performance.now()-start<15000){const t=feedBack.playback.snapshot().state.media.mediaTime;if(t>2.6)high=t;if(high!==null&&t>=1.95&&t<2.2)wrapped??=t;if(wrapped!==null&&t>wrapped+.12&&t<2.5)return{high,wrapped,advancedTo:t};await new Promise(r=>setTimeout(r,40));}throw Error('Actual vocal media loop did not wrap');});
  }else await page.waitForFunction(t=>feedBack.playback.snapshot().state.media.mediaTime>t+.1,preview.time,{timeout:15000});
  const canvasScreenshot=process.env.OCE_HIGHWAY_SCREENSHOT.replace('.png',`-vocal-${mode}-canvas.png`);await page.locator('#highway').screenshot({path:canvasScreenshot});const canvasPixels=await page.locator('#highway').evaluate(c=>{const b=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<b.length;i+=4)if(b[i]+b[i+1]+b[i+2]>70)n++;return n;});assert.ok(canvasPixels>1000);
  await page.evaluate(async()=>{await vocalPlaytestModule.endPlaytest(vocalPreview);});await page.waitForSelector('#plugin-open_chart_editor.active #ws-vocal-view');if(mode==='cursor')await page.evaluate(async()=>{await vocalPlaytestModule.removePreview(vocalPreview);});else await action('playtest-remove');assert.deepEqual(await editorContext(),contextBefore);assert.equal(JSON.stringify(await snapshot()),before);
  cases.push({mode,actualMainUiHandoff:mode!=='cursor',actualNativeVocalProvider:true,renderer:preview.label,pitch: pitch.notes,lyrics,canvasScreenshot,canvasPixels,mediaWrap,microphoneRequestsDuringPlayback:preview.mediaDenied-mediaBefore,contextRestored:true,sourceUnchanged:true,ownedPreviewRemoved:true});
 }
 const isolation=await(await page.request.get(process.env.OCE_HOST_URL+'/harness/isolation')).json();assert.deepEqual(isolation.entries,[]);assert.ok(isolation.pluginIds.includes('vocal_highway'));
 const ancillaryCoreFailures=httpErrors.filter(item=>!['/api/plugins/minigames/profile','/api/plugins/minigames/registry','/api/plugins/tuner/config'].some(path=>item.url.endsWith(path)));assert.deepEqual(errors,[]);assert.deepEqual(ancillaryCoreFailures,[]);
 console.log(JSON.stringify({ok:true,playbackPassed:true,fullShellClean:true,cases,isolation,errors,httpErrors,ancillaryCoreFailures,blockedExternalOrigins:[...new Set(blocked)],physicalHardwareVerified:false,zeroDurationPolicy:'Source pitch retained but actual VocalHighway omits it; no grading claimed'}));
}catch(error){console.error(JSON.stringify({error:String(error),errors,httpErrors,blocked,websockets:ws}));throw error;}
finally{await page.screenshot({path:process.env.OCE_HIGHWAY_SCREENSHOT}).catch(()=>{});await browser.close();}
'''
def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--serve',action='store_true');parser.add_argument('--host-root',type=Path,default=gate.HOST);parser.add_argument('--run-dir',type=Path);parser.add_argument('--port',type=int,default=0);parser.add_argument('--installed',action='store_true',help='Verify recorded installed OCE bytes with the installed private vocal dependency');args=parser.parse_args()
    if args.serve:
        if not args.run_dir or not gate.install_module().within(args.run_dir,ROOT/'tools/.host-runs'):raise ValueError('Workspace isolation required')
        import uvicorn
        uvicorn.run(gate.make_app(args.host_root,args.run_dir),host='127.0.0.1',port=args.port,log_level='warning');return 0
    dependency=json.loads((ROOT/'research/vocal-dependency/installed.json').read_text());provider=Path(dependency['destination'])
    for item in dependency['files']:
        if hashlib.sha256((provider/item['path']).read_bytes()).hexdigest()!=item['sha256']:raise ValueError('Installed vocal dependency changed after review')
    run=ROOT/'tools/.host-runs'/uuid.uuid4().hex;run.mkdir(parents=True)
    try:
        installed_record=None
        if args.installed:
            installed_record=json.loads((ROOT/'research/installed-local.json').read_text(encoding='utf-8'))
            installed=Path(installed_record['destination'])
            if installed.resolve()!=(args.host_root/'plugins/open_chart_editor').resolve():raise ValueError('Unexpected installed source')
            installer=gate.install_module();original_plan=installer.make_plan
            installer.RUNTIME_FILES=tuple(item['path']for item in installed_record['files']if item['path']not in installer.OPTIONAL_FILES)
            installer.make_plan=lambda destination,source=installed:original_plan(destination,source)
            gate.install_module=lambda:installer
        result=gate.verify(args.host_root,run)
        current=gate.install_module().make_plan(run/'plugins/open_chart_editor')
        stable=current['sourceDigest']==result['sourceDigest']
        result.update(sourceStable=stable,installedVocalDependencyDigest=dependency['sourceDigest'])
        if not stable:result.update(ok=False,error='Functional staged snapshot was exercised, but working source changed during the gate; rerun before checkpoint')
        if installed_record:
            if result['sourceDigest']!=installed_record['sourceDigest']:raise ValueError('Installed digest differs from record')
            result.update(installedSnapshotVerified=True,installedSource=str(installed))
    except Exception as error:result={'ok':False,'error':str(error),'runDirectory':str(run)}
    report_name=('installed-'if args.installed else'')+'vocal-highway-integration.json'
    (run/'report.json').write_text(json.dumps(result,indent=2),encoding='utf-8');(ROOT/'research'/report_name).write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps({'ok':result['ok'],'report':str(run/'report.json'),'sourceDigest':result.get('sourceDigest'),'error':result.get('error')},indent=2));return 0 if result['ok']else 1
if __name__=='__main__':raise SystemExit(main())
