"""Actual installed 3D Highway pitch-label/transport gate in an isolated host.
Uses the production gate's exact public host loader and isolation machinery.
Adds the installed fretted 3D provider; no user config/library/service changes.
"""
from __future__ import annotations
import argparse,hashlib,importlib.util,json,sys,uuid
from pathlib import Path
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('production_highway_gate',ROOT/'tools'/'verify-highway.py')
gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)
gate.PROVIDER_IDS=(*gate.PROVIDER_IDS,'highway_3d')
# The reused launcher starts this wrapper, whose serve branch repeats this setup.
gate.__file__=__file__
prefix=gate.BROWSER[:gate.BROWSER.index(' const fixture=')]
prefix=prefix.replace('try{\n const profile=', '''await context.addInitScript(()=>{window.__pitchTextures=[];const original=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,...args){if(/^[A-G]#?-?\\d+$/.test(String(text))&&new Error().stack.includes('/highway_3d/'))window.__pitchTextures.push(String(text));return original.call(this,text,...args);};});
try{
 const profile=''')
gate.BROWSER=prefix+r'''
 await page.waitForFunction(()=>typeof window.feedBackViz_highway_3d==='function');
 const base=await page.evaluate(()=>{
  const rate=8000,seconds=20,buffer=new ArrayBuffer(44+rate*seconds*2),d=new DataView(buffer),text=(at,s)=>{for(let i=0;i<s.length;i++)d.setUint8(at+i,s.charCodeAt(i))};
  text(0,'RIFF');d.setUint32(4,buffer.byteLength-8,true);text(8,'WAVEfmt ');d.setUint32(16,16,true);d.setUint16(20,1,true);d.setUint16(22,1,true);d.setUint32(24,rate,true);d.setUint32(28,rate*2,true);d.setUint16(32,2,true);d.setUint16(34,16,true);text(36,'data');d.setUint32(40,buffer.byteLength-44,true);
  for(let i=0;i<rate*seconds;i++)d.setInt16(44+i*2,Math.round(Math.sin(i*2*Math.PI*110/rate)*1000),true);let raw='';for(const b of new Uint8Array(buffer))raw+=String.fromCharCode(b);
  return {version:1,title:'Original eight-string pitch label study',artist:'Local author',duration:seconds,beats:Array.from({length:41},(_,i)=>({time:i*.5,measure:i%4===0?i/4+1:-1})),sections:[],_pack:{manifest:{stems:[{id:'full',file:'audio/own.wav',default:true}]},entries:{'audio/own.wav':btoa(raw)}}};
 });
 const cases=[];
 for(const definition of [
  {id:'standard-eight',tuning:[0,0,0,0,0,0,0,0],capo:0,labels:['F#1','B1','E2','A2','D3','G3','B3','E4']},
  {id:'drop-eight',tuning:[-2,0,0,0,0,0,0,0],capo:0,labels:['E1','B1','E2','A2','D3','G3','B3','E4']},
  {id:'capo-eight',tuning:[-2,0,0,0,0,0,0,0],capo:2,labels:['F#1','C#2','F#2','B2','E3','A3','C#4','F#4']},
  {id:'custom-base-eight',bases:[28,35,40,45,50,55,59,64],tuning:[0,0,0,0,0,0,0,0],effective:[-2,0,0,0,0,0,0,0],capo:0,labels:['E1','B1','E2','A2','D3','G3','B3','E4']}
 ]){
  const fixture=structuredClone(base);fixture.arrangements=[{id:definition.id,name:'Lead',type:'guitar',stringCount:8,basePitches:definition.bases||[30,35,40,45,50,55,59,64],tuning:definition.tuning,capo:definition.capo,notes:[2,8,14].flatMap((time,i)=>[{id:'low'+i,time,string:0,fret:0,sustain:1,techniques:{}},{id:'high'+i,time,string:7,fret:5,sustain:1,techniques:{}}]),chords:[],chord_templates:[],anchors:[],handshapes:[],phrases:[]}];
  const socketStart=ws.length;await page.evaluate(()=>window.__pitchTextures=[]);
  await page.evaluate(async fixture=>{const module=await import('/api/plugins/open_chart_editor/src/playtest.js');window.tuningGateModule=module;window.tuningGatePreview=await module.buildAndPlaytest(fixture,{arrangementId:fixture.arrangements[0].id,startTime:1});},fixture);
  await page.waitForFunction(()=>feedBack.playback.snapshot().state.transport.isPlaying&&highway.getNotes().length===6);
  await page.mouse.move(900,500);await page.locator('[data-rail="viz"]').click();await page.locator('#viz-picker').selectOption('highway_3d');await page.locator('[data-rail="viz"]').click();
  await page.waitForFunction(labels=>labels.every(label=>window.__pitchTextures.includes(label)),definition.labels,{timeout:30000});
  const first=await page.evaluate(()=>({time:highway.getTime(),media:feedBack.playback.snapshot().state.media.mediaTime}));
  await page.waitForFunction(first=>highway.getTime()>first.time+.1&&feedBack.playback.snapshot().state.media.mediaTime>first.media+.1,first,{timeout:15000});
  const actual=await page.evaluate(()=>({labels:[...new Set(window.__pitchTextures)],time:highway.getTime(),media:feedBack.playback.snapshot().state.media.mediaTime,renderer:document.querySelector('#viz-picker').value,classic:highway.isDefaultRenderer(),deniedMidiRequests:window.__midiDenied,tuning:highway.getTuning(),capo:highway.getCapo(),stringCount:highway.getStringCount()}));
  assert.equal(actual.renderer,'highway_3d');assert.equal(actual.classic,false);for(const label of definition.labels)assert.ok(actual.labels.includes(label));
  const messages=ws.slice(socketStart).flatMap(s=>s.payload),info=messages.find(m=>m.type==='song_info');assert.equal(info.stringCount,8);assert.deepEqual(info.tuning,definition.effective||definition.tuning);assert.equal(info.capo,definition.capo);assert.deepEqual(actual.tuning,definition.effective||definition.tuning);assert.equal(actual.capo,definition.capo);assert.equal(actual.stringCount,8);const ownedFilename=await page.evaluate(()=>tuningGatePreview.filename);const builtResponse=await page.request.get(process.env.OCE_HOST_URL+'/harness/inspect-built/'+encodeURIComponent(ownedFilename));assert.equal(builtResponse.status(),200);const native=await builtResponse.json();assert.deepEqual(native.basePitches,[30,35,40,45,50,55,59,64]);assert.deepEqual(native.tuning,definition.effective||definition.tuning);if(definition.bases)assert.deepEqual(native.oceStringLayout.basePitches,definition.bases);
  const notes=messages.filter(m=>m.type==='notes').flatMap(m=>m.data);assert.deepEqual(notes.map(n=>[n.s,n.f]),[[0,0],[7,5],[0,0],[7,5],[0,0],[7,5]]);
  const canvasScreenshot=process.env.OCE_HIGHWAY_SCREENSHOT.replace('.png','-'+definition.id+'-canvas.png');await page.locator('#highway').screenshot({path:canvasScreenshot});
  await page.evaluate(async()=>{await tuningGateModule.endPlaytest(tuningGatePreview)});await page.waitForTimeout(250);await page.evaluate(async()=>{await tuningGateModule.removePreview(tuningGatePreview)});await page.waitForSelector('#plugin-open_chart_editor.active #ws-canvas');
  cases.push({...definition,actual,nativeFeedpak:native,wireNotes:notes,songInfo:info,actualRendererTextureText:true,canvasScreenshot,canvasPixels:null,clockAdvanced:actual.time-first.time,mediaClockAdvanced:actual.media-first.media,ownedPreviewRemoved:true});
 }
 const isolation=await(await page.request.get(process.env.OCE_HOST_URL+'/harness/isolation')).json();assert.deepEqual(isolation.entries,[]);assert.equal(isolation.stagedDatabaseCompatibilityFix,false);
 const ancillaryCoreFailures=httpErrors.filter(item=>!['/api/plugins/minigames/profile','/api/plugins/minigames/registry','/api/plugins/tuner/config'].some(path=>item.url.endsWith(path)));
 assert.deepEqual(errors,[]);assert.deepEqual(ancillaryCoreFailures,[]);console.log(JSON.stringify({ok:true,playbackPassed:true,fullShellClean:true,cases,isolation,errors,httpErrors,ancillaryCoreFailures,blockedExternalOrigins:[...new Set(blocked)],physicalHardwareVerified:false,sixStringBassSupported:false,labelObservation:'Actual Canvas2D fillText calls attributed by stack to production highway_3d texture construction; original implementation called unchanged'}));
}catch(error){console.error(JSON.stringify({error:String(error),errors,httpErrors,blocked,websockets:ws}));throw error;}
finally{await page.screenshot({path:process.env.OCE_HIGHWAY_SCREENSHOT}).catch(()=>{});await browser.close()}
'''

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--serve',action='store_true');parser.add_argument('--host-root',type=Path,default=gate.HOST);parser.add_argument('--run-dir',type=Path);parser.add_argument('--port',type=int,default=0);args=parser.parse_args()
    if args.serve:
        if not args.run_dir or not gate.install_module().within(args.run_dir,ROOT/'tools'/'.host-runs'):raise ValueError('Isolated workspace run directory required')
        import uvicorn
        app=gate.make_app(args.host_root,args.run_dir)
        @app.get('/harness/inspect-built/{filename}')
        def inspect_built(filename:str):
            import re,zipfile,yaml
            if not re.fullmatch(r'[0-9a-f-]{36}_oce\.feedpak',filename):raise ValueError('Only own UUID preview name allowed')
            source=(args.run_dir/'library'/filename)
            if source.resolve().parent!=(args.run_dir/'library').resolve():raise ValueError('Outside isolated library')
            with zipfile.ZipFile(source)as archive:
                manifest=yaml.safe_load(archive.read('manifest.yaml'));entry=manifest['arrangements'][0];raw=json.loads(archive.read(entry['file']))
            return {key:raw.get(key)for key in ['basePitches','tuning','capo','oceStringLayout']}
        uvicorn.run(app,host='127.0.0.1',port=args.port,log_level='warning');return 0
    run=ROOT/'tools'/'.host-runs'/uuid.uuid4().hex;run.mkdir(parents=True)
    try:
        applied=json.loads((ROOT/'research'/'host-fixes'/'highway3d-eight-string'/'applied.json').read_text())
        if hashlib.sha256(Path(applied['target']).read_bytes()).hexdigest()!=applied['afterSha256']:raise ValueError('Actual 3D provider differs from reviewed pitch-label correction')
        result=gate.verify(args.host_root,run);result['actualProviderCompatibilityFix']=applied
    except Exception as error:result={'ok':False,'error':str(error),'runDirectory':str(run),'userLibraryTouched':False,'externalDestinationInstalled':False}
    (run/'report.json').write_text(json.dumps(result,indent=2),encoding='utf-8');(ROOT/'research'/'highway-tuning-integration.json').write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps({'ok':result['ok'],'report':str(run/'report.json'),'sourceDigest':result.get('sourceDigest'),'browser':result.get('browser'),'error':result.get('error')},indent=2));return 0 if result['ok']else 1
if __name__=='__main__':raise SystemExit(main())
