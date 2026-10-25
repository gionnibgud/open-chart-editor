"""Actual FeedBack shell/highways using a staged editor and original audio/charts.
Only two explicit read-only local renderer providers; isolated config/library.
No user service or hardware access. No physical audio accuracy assertion.
"""
from __future__ import annotations
import argparse,contextlib,hashlib,http.client,importlib.util,io,json,os,socket,subprocess,sys,tempfile,time,uuid,wave,zipfile
from pathlib import Path
from fastapi import Request,Response
sys.dont_write_bytecode=True
os.environ.pop('SSLKEYLOGFILE',None)
ROOT=Path(__file__).resolve().parents[1]
HOST=Path(r'I:\Dev\freedBack\feedBack')
PROVIDER_IDS=('piano','drum_highway_3d','keys_highway_3d')
def provider_sources(host):
    piano=Path(os.environ.get('OCE_PIANO_PROVIDER',str(host/'plugins'/'piano')))
    allowed=[host/'plugins'/'piano',ROOT/'research'/'piano-dependency'/'staged']
    if piano.resolve()not in [path.resolve()for path in allowed]:raise ValueError('Only reviewed installed/staged Piano source allowed')
    return {'piano':piano,**{name:host/'plugins'/name for name in PROVIDER_IDS[1:]}}
# Existing local pip-cache wheels, loaded read-only through Python zipimport.
# No package installation, dependency replacement, copying or download occurs.
SUPPORT=(('structlog','0/8/b/b/6/08bb600477889b6efe73569cb7c1ac91866a62efff8760001b2cc300.body'),
         ('asgi_correlation_id','8/f/9/3/1/8f931c19b9f72e118f3359207bf62cbe9894558d94af97da8442b0b2.body'),
         ('defusedxml','b/7/9/8/9/b7989402a05b5fe1a5bdfb1b6916dee8f6d6515db1d5b056f1ac81f2.body'))

def install_module():
    spec=importlib.util.spec_from_file_location('oce_installer',ROOT/'tools'/'install-local.py')
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def original_notation_fixture():
    """Independent native source fixture, not an export through the code under test."""
    import yaml
    audio=io.BytesIO()
    with wave.open(audio,'wb')as writer:
        writer.setparams((1,2,8000,0,'NONE','not compressed'));writer.writeframes(b'\0\0'*8000*12)
    notation={'version':1,'instrument':'piano','source':'own-original-study','staves':[{'id':'rh','clef':'G2'}],
              'measures':[{'idx':1,'t':0,'tempo':120,'staves':{'rh':{'voices':[{'v':1,'beats':[{'t':2,'dur':2,'notes':[{'midi':60}],'ownUnknownNotation':'retained exactly'}]}]}}}]}
    raw={'name':'Piano','stringCount':6,'tuning':[0]*6,'basePitches':[],'capo':0,'notes':[{'t':2,'s':2,'f':12,'m':60,'sus':1,'hand':'rh'}], 'chords':[],'templates':[],'anchors':[],'handshapes':[]}
    manifest={'feedpak_version':'1.19.0','title':'Original normal export notation study','artist':'Local author','duration':12,
              'stems':[{'id':'full','file':'audio/own.wav','default':True}],'song_timeline':'song_timeline.json',
              'arrangements':[{'id':'own-score','name':'Piano','type':'keys','file':'arrangements/keys.json','notation':'notation_own-score.json'}]}
    notation_bytes=(json.dumps(notation,indent=2)+'\n').encode()
    entries={'manifest.yaml':yaml.safe_dump(manifest).encode(),'audio/own.wav':audio.getvalue(),'arrangements/keys.json':json.dumps(raw).encode(),
             'song_timeline.json':json.dumps({'version':1,'beats':[{'time':i*.5,'measure':i//4+1 if i%4==0 else -1}for i in range(25)],'sections':[]}).encode(),
             'notation_own-score.json':notation_bytes}
    result=io.BytesIO()
    with zipfile.ZipFile(result,'w',zipfile.ZIP_DEFLATED)as archive:
        for name,content in entries.items():archive.writestr(name,content)
    return result.getvalue(),hashlib.sha256(notation_bytes).hexdigest()

def make_app(host,run,staged_db=False):
    for folder in ['config','library','tmp']:(run/folder).mkdir(exist_ok=True)
    for key in ['FEEDBACK_PLUGINS_DIR','SLOPSMITH_PLUGINS_DIR']:os.environ.pop(key,None)
    os.environ.update(CONFIG_DIR=str(run/'config'),DLC_DIR=str(run/'library'),TMP=str(run/'tmp'),TEMP=str(run/'tmp'),
                      FEEDBACK_SKIP_STARTUP_TASKS='1',FEEDBACK_ENRICH_OFFLINE='1',LOG_FILE=str(run/'core.log'))
    tempfile.tempdir=str(run/'tmp')
    # Reject server outbound connections as well as the browser's external HTTP.
    def audit(event,args):
        if event=='socket.connect':
            address=args[1]
            if isinstance(address,tuple)and address[0]not in ('127.0.0.1','localhost','::1'):raise PermissionError('Isolated verification forbids external socket connections')
        if event=='socket.getaddrinfo'and args[0]not in ('127.0.0.1','localhost','::1',None):raise PermissionError('Isolated verification forbids external DNS')
    sys.addaudithook(audit)
    sys.path[:0]=[str(host),str(host/'lib')]
    if staged_db:
        staging=ROOT/'research'/'host-fixes'/'staged'
        plan=json.loads((staging.parent/'apply-plan.json').read_text())
        if hashlib.sha256((staging/'metadata_db.py').read_bytes()).hexdigest()!=plan['afterSha256']:raise ValueError('Staged database compatibility module changed after review')
        sys.path.insert(0,str(staging))
    support=[]
    for name,relative in SUPPORT:
        if importlib.util.find_spec(name)is not None:continue
        path=Path.home()/'AppData'/'Local'/'pip'/'Cache'/'http-v2'/relative
        if not path.is_file():continue
        with zipfile.ZipFile(path)as archive:
            if name+'/__init__.py'not in archive.namelist():raise ValueError('Unexpected cached dependency wheel namespace')
            metadata=[p for p in archive.namelist()if p.startswith(name+'-')and p.endswith('.dist-info/METADATA')]
            if len(metadata)!=1:raise ValueError('Unexpected cached dependency wheel metadata')
        sys.path.append(str(path));support.append({'name':name,'cachedWheel':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
    import server,plugins,appstate
    import metadata_db
    plugins.PLUGINS_DIR=run/'plugins'
    scan_calls=[]
    # Scanner scheduling is a dependency injected through the documented router
    # seam; intercept it only in this test process. Renderer/media remain real.
    appstate.configure(kick_scan=lambda:scan_calls.append(True))
    original_lifespan=server.app.router.lifespan_context
    @contextlib.asynccontextmanager
    async def isolated_lifespan(app):
        async with original_lifespan(app):
            plugins.load_plugins(app,{'config_dir':run/'config','get_dlc_dir':server._get_dlc_dir,'meta_db':server.meta_db})
            yield
    server.app.router.lifespan_context=isolated_lifespan
    @server.app.get('/harness/isolation')
    def isolation():
        return {'pluginIds':[p['id']for p in plugins.LOADED_PLUGINS],'config':str(server.CONFIG_DIR),'library':str(server.DLC_DIR),
                'entries':[p.name for p in (run/'library').iterdir()],'scanRequestsIntercepted':len(scan_calls),
                'startupSkipped':True,'enrichmentOffline':True,'source':str(host/'server.py'),'readOnlyCachedDependencies':support,
                'metadataDbSource':metadata_db.__file__,'metadataDbSha256':hashlib.sha256(Path(metadata_db.__file__).read_bytes()).hexdigest(),'stagedDatabaseCompatibilityFix':staged_db,
                'rendererProviders':[{'id':name,'source':str((run/'plugins'/name).resolve()),'manifest':json.loads((run/'plugins'/name/'plugin.json').read_text()),'sourceHashes':{p.relative_to(run/'plugins'/name).as_posix():hashlib.sha256(p.read_bytes()).hexdigest()for p in (run/'plugins'/name).rglob('*.js')}}for name in PROVIDER_IDS]}
    @server.app.get('/harness/original-notation.feedpak')
    def notation_fixture():
        data,digest=original_notation_fixture()
        return Response(data,media_type='application/zip',headers={'X-Original-Notation-SHA256':digest})
    @server.app.post('/harness/inspect-notation')
    async def inspect_notation(request:Request):
        import yaml
        data=await request.body()
        if len(data)>2*1024*1024:raise ValueError('Own notation fixture exceeds harness size bound')
        with zipfile.ZipFile(io.BytesIO(data))as archive:
            manifest=yaml.safe_load(archive.read('manifest.yaml'));entry=manifest['arrangements'][0]
            original=archive.read('notation_own-score.json')
            return {'reference':entry.get('notation'),'originalNotationSha256':hashlib.sha256(original).hexdigest(),'notes':json.loads(archive.read(entry['file']))['notes']}
    return server.app

BROWSER=r'''
import{createRequire}from'node:module';import assert from'node:assert/strict';
const require=createRequire(process.cwd()+'/package.json'),{chromium}=require(process.env.OCE_PLAYWRIGHT||'C:/Users/zagat/AppData/Roaming/npm/node_modules/rea-agents/node_modules/playwright-core');
const browser=await chromium.launch({headless:true,executablePath:process.env.OCE_CHROMIUM||'C:/Users/zagat/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe',args:['--autoplay-policy=no-user-gesture-required','--mute-audio','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1700,height:1100},acceptDownloads:true}),page=await context.newPage(),errors=[],blocked=[],httpErrors=[],ws=[];
page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)httpErrors.push({url:r.url(),status:r.status()})});
page.on('websocket',s=>{const item={url:s.url(),messages:0,types:[],payload:[]};ws.push(item);s.on('framereceived',f=>{item.messages++;try{const data=JSON.parse(f.payload);if(data.type&&!item.types.includes(data.type))item.types.push(data.type);if(['song_info','notes','drum_tab','drum_hits'].includes(data.type))item.payload.push(data);if(data.error)item.error=data.error}catch{}})});
// No real MIDI discovery is allowed, even if an existing renderer requests it.
await context.addInitScript(()=>{window.__midiDenied=0;window.__mediaDenied=0;Object.defineProperty(navigator,'requestMIDIAccess',{value:()=>{window.__midiDenied++;return Promise.reject(new DOMException('Verification denies hardware access','NotAllowedError'))}});if(navigator.mediaDevices){Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:()=>{window.__mediaDenied++;return Promise.reject(new DOMException('Verification denies capture hardware','NotAllowedError'))}});Object.defineProperty(navigator.mediaDevices,'enumerateDevices',{value:async()=>[]});}});
await context.addInitScript(()=>Object.defineProperty(window,'showSaveFilePicker',{value:undefined,configurable:true}));
await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname!=='127.0.0.1'&&!['blob:','data:'].includes(u.protocol)){blocked.push(u.origin);return route.abort()}return route.continue()});
try{
 const profile=await page.request.post(process.env.OCE_HOST_URL+'/api/profile',{data:{display_name:'Isolated local verifier'}});assert.equal(profile.status(),200);
 await page.goto(process.env.OCE_HOST_URL);await page.waitForFunction(()=>typeof window.showScreen==='function'&&window.feedBack?.capabilities&&window.highway&&document.querySelector('#ws-app[data-mounted="true"]'));
 await page.evaluate(()=>showScreen('plugin-open_chart_editor'));
 const fixture=await page.evaluate(()=>{
  const rate=8000,seconds=12,buffer=new ArrayBuffer(44+rate*seconds*2),d=new DataView(buffer),text=(at,s)=>{for(let i=0;i<s.length;i++)d.setUint8(at+i,s.charCodeAt(i))};
  text(0,'RIFF');d.setUint32(4,buffer.byteLength-8,true);text(8,'WAVEfmt ');d.setUint32(16,16,true);d.setUint16(20,1,true);d.setUint16(22,1,true);d.setUint32(24,rate,true);d.setUint32(28,rate*2,true);d.setUint16(32,2,true);d.setUint16(34,16,true);text(36,'data');d.setUint32(40,buffer.byteLength-44,true);
  for(let i=0;i<rate*seconds;i++)d.setInt16(44+i*2,Math.round(Math.sin(i*2*Math.PI*220/rate)*1600),true);
  let raw='';for(const b of new Uint8Array(buffer))raw+=String.fromCharCode(b);
  const arr=(id,name,type,count,notes)=>({id,name,type,stringCount:count,tuning:Array(count).fill(0),notes,chords:[],chord_templates:[],anchors:[],handshapes:[],phrases:[]});
  const note=(id,string,fret)=>({id,time:2,string,fret,sustain:1,techniques:{}});
  const arrangements=[arr('own-guitar','Lead','guitar',6,[note('own-note',0,5)]),arr('own-drums','Drums','drums',6,['kick','snare','hh_closed','ride_bell'].map((piece,i)=>({id:'hit'+i,time:2+i*.15,piece,velocity:80+i,ghost:i===1,flam:i===2}))),arr('own-bass','Bass 5','bass',5,[note('bass-low',0,2),note('bass-high',4,7)]),arr('own-eight','Lead 8','guitar',8,[note('eight-low',0,3),note('eight-high',7,12)]),arr('own-keys','Piano','keys',6,[{...note('key-low',0,0),pitch:0,hand:'lh',velocity:55},{...note('key-high',5,7),pitch:127,hand:'rh',velocity:100}])];
  arrangements.push(arr('own-seven','Lead 7','guitar',7,[note('seven-low',0,4),note('seven-high',6,10)]));
  // Keep both boundary-string note heads within the default camera's visible
  // fret range, so screenshots demonstrate both ends instead of clipped tails.
  arrangements.find(a=>a.id==='own-eight').notes[1].fret=7;
  arrangements.find(a=>a.id==='own-seven').notes[1].fret=6;
  // Software WebGL's first scene compilation may take seconds; retain later
  // original hit examples so the captured 3D highway also contains visible gems.
  arrangements[1].notes.push(...['kick','snare','hh_closed','ride_bell'].map((piece,i)=>({id:'late-hit'+i,time:5+i*.4,piece,velocity:90+i})));
  arrangements[1].notes.push(...[8,10].flatMap(start=>['kick','snare','hh_closed','ride_bell'].map((piece,i)=>({id:`late-${start}-${i}`,time:start+i*.4,piece,velocity:90+i}))));
  // Also model an imported pack's song-level drum pointer. A selected-track
  // preview must remove that unrelated pointer when playing pitched tracks.
  arrangements[1]._entry={id:'own-drums',name:'Drums',type:'drums',drum_tab:'drum_tab.json',_songLevel:true};
  const drums={version:1,name:'Drums',kit:arrangements[1].notes.map(n=>({id:n.piece})),hits:arrangements[1].notes.map(n=>({t:n.time,p:n.piece,v:n.velocity}))};
  return {version:1,title:'Original actual highway study',artist:'Local author',duration:seconds,beats:Array.from({length:15},(_,i)=>({time:i*.5,measure:i%4===0?i/4+1:-1})),sections:[],arrangements,_pack:{manifest:{drum_tab:'drum_tab.json',stems:[{id:'full',file:'audio/original.wav',default:true}]},entries:{'audio/original.wav':btoa(raw),'drum_tab.json':btoa(JSON.stringify(drums))}}};
 });
 await page.locator('#ws-open-file').setInputFiles({name:'own-highway-study.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});await page.waitForFunction(title=>document.querySelector('#ws-title').textContent.includes(title),fixture.title);
 await page.locator('#ws-canvas').click({position:{x:332,y:421.5}});await page.waitForSelector('#ws-note-fret');assert.equal(await page.locator('#ws-note-fret').inputValue(),'5');
 await page.locator('#ws-zoom').fill('250');await page.locator('#ws-timeline-scroll').evaluate(el=>el.scrollLeft=50);
 const editorBefore=await page.evaluate(()=>({zoom:document.querySelector('#ws-zoom').value,scrollLeft:document.querySelector('#ws-timeline-scroll').scrollLeft,fret:document.querySelector('#ws-note-fret').value}));
 const cases=[],originalProject=JSON.stringify(fixture);
 for(const {arrangementId,startTime} of [{arrangementId:'own-guitar',startTime:0},...fixture.arrangements.map(a=>({arrangementId:a.id,startTime:2}))]){
  const expected=fixture.arrangements.find(a=>a.id===arrangementId),socketStart=ws.length,midiBefore=await page.evaluate(()=>window.__midiDenied),networkBefore=blocked.filter(origin=>origin.includes('surikov')).length;
  await page.evaluate(async({fixture,startTime,arrangementId})=>{const m=await import('/api/plugins/open_chart_editor/src/playtest.js');window.highwayTestModule=m;window.highwayTestPreview=await m.buildAndPlaytest(fixture,{arrangementId,startTime})},{fixture,startTime,arrangementId});
  assert.equal(JSON.stringify(fixture),originalProject,'Playtest changed the authored project');
  await page.waitForFunction(()=>window.highway?.getSongInfo()?.title==='Original actual highway study'&&window.feedBack.playback.snapshot().state.transport.isPlaying);
  const first=await page.evaluate(()=>({snapshot:feedBack.playback.snapshot(),notes:highway.getNotes().length,time:highway.getTime(),active:document.querySelector('.screen.active')?.id}));
  assert.equal(first.active,'player');if(expected.type!=='drums')assert.ok(first.notes>0);assert.ok(first.snapshot.state.media.currentTime>=startTime-.1||first.snapshot.state.transport.currentTime>=startTime-.1||first.time>=startTime-.1);
  assert.ok(Math.abs(first.snapshot.state.media.duration-fixture.duration)<.1,'Original WAV duration was not decoded');
  const progressStarted=Date.now();await page.waitForFunction(({highwayTime,mediaTime})=>highway.getTime()>highwayTime+.1&&feedBack.playback.snapshot().state.media.mediaTime>mediaTime+.1,{highwayTime:first.time,mediaTime:first.snapshot.state.media.mediaTime},{polling:100,timeout:15000});
  const progressWaitMs=Date.now()-progressStarted,second=await page.evaluate(()=>({time:highway.getTime(),mediaTime:feedBack.playback.snapshot().state.media.mediaTime}));assert.ok(second.time>first.time+.1,`Actual highway clock did not advance: ${first.time} -> ${second.time}`);assert.ok(second.mediaTime>first.snapshot.state.media.mediaTime+.1,'Actual media transport clock did not advance');
  const messages=ws.slice(socketStart).flatMap(s=>s.payload),info=messages.find(m=>m.type==='song_info');assert.equal(info.arrangement,expected.name,'Host played a different arrangement');
  const wire=messages.filter(m=>m.type==='notes').flatMap(m=>m.data??[]),hits=messages.filter(m=>m.type==='drum_hits').flatMap(m=>m.data??[]);
  if(expected.type==='drums'){assert.deepEqual(hits.map(n=>n.p),expected.notes.map(n=>n.piece));assert.ok(messages.find(m=>m.type==='drum_tab'));}
  else if(expected.type==='keys'){assert.deepEqual(wire.map(n=>[n.m,n.hand]),[[0,'lh'],[127,'rh']]);}
  else{assert.equal(info.stringCount,expected.stringCount);assert.deepEqual(wire.map(n=>[n.s,n.f]),expected.notes.map(n=>[n.string,n.fret]));}
  const canvas=expected.type==='keys'?'.piano-highway-canvas':'#highway';await page.waitForSelector(canvas);
  const canvasScreenshot=process.env.OCE_HIGHWAY_SCREENSHOT.replace('.png',`-${arrangementId}-${startTime}-canvas.png`);await page.locator(canvas).screenshot({path:canvasScreenshot});
  // WebGL's default framebuffer may clear after compositing; inspect its real
  // composited screenshot in Python instead of asking it for a 2D context.
  const pixels=expected.type==='drums'?null:await page.locator(canvas).evaluate(c=>{const data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<data.length;i+=4)if(data[i]+data[i+1]+data[i+2]>70)n++;return n});if(pixels!==null)assert.ok(pixels>1000);
  const renderer=await page.evaluate(()=>({label:document.querySelector('#viz-picker option[value="auto"]')?.textContent,piano:!!document.querySelector('.piano-highway-canvas'),default:highway.isDefaultRenderer(),midiRequestsDenied:window.__midiDenied}));
  if(['drums','keys'].includes(expected.type))assert.equal(renderer.default,false,'Instrument-specific renderer did not activate');
  else assert.equal(renderer.default,true,'Unrelated drum/piano renderer claimed a fretted track');
  if(expected.type==='drums')assert.ok(renderer.label.includes('3D'),'Actual bundled Drum Highway 3D did not activate');
  if(expected.type==='keys'){
   assert.equal(renderer.midiRequestsDenied,midiBefore,'Piano view requested MIDI without an explicit action');assert.equal(blocked.filter(origin=>origin.includes('surikov')).length,networkBefore,'Piano view requested downloaded sound without an explicit action');
   await page.mouse.move(900,500);await page.locator('[data-rail="plugins"]').click();await page.locator('.btn-piano-settings').click();await page.waitForSelector('.piano-midi-connect');assert.equal(await page.evaluate(()=>window.__midiDenied),midiBefore);assert.equal(blocked.filter(origin=>origin.includes('surikov')).length,networkBefore);await page.locator('.btn-piano-settings').click();
  }
  await page.screenshot({path:process.env.OCE_HIGHWAY_SCREENSHOT.replace('.png',`-${arrangementId}-${startTime}.png`)});
  // Production song:stop starts asynchronous stats writes. Let its public
  // lifecycle notification settle before exercising the separate remove action.
  await page.evaluate(async()=>{await highwayTestModule.endPlaytest(highwayTestPreview)});
  await page.waitForTimeout(250);
  await page.evaluate(async()=>{await highwayTestModule.removePreview(highwayTestPreview)});
  await page.waitForSelector('#plugin-open_chart_editor.active #ws-canvas');assert.equal(await page.locator('#ws-arrangement').inputValue(),'own-guitar');
  const editorAfter=await page.evaluate(()=>({zoom:document.querySelector('#ws-zoom').value,scrollLeft:document.querySelector('#ws-timeline-scroll').scrollLeft,fret:document.querySelector('#ws-note-fret').value}));assert.deepEqual(editorAfter,editorBefore);
  cases.push({arrangementId,type:expected.type,startTime,wireNotes:wire,drumHits:hits,renderer,songInfo:info,canvasScreenshot,progressWaitMs,actualCoreAdapter:true,actualWebSocket:true,loadedNotes:first.notes,clockAdvanced:second.time-first.time,decodedOriginalAudioDuration:first.snapshot.state.media.duration,mediaClockAdvanced:second.mediaTime-first.snapshot.state.media.mediaTime,canvasPixels:pixels,returnedToEditor:true,editorSelectionZoomScrollRestored:true,ownedPreviewRemoved:true});
 }
 // Normal library export must also detach stale notation. This path deliberately
 // bypasses playtestProject, whose preview-only pruning cannot prove that fix.
 const normalExport=await page.evaluate(async()=>{
  const original=await fetch('/harness/original-notation.feedpak'),originalSha=original.headers.get('X-Original-Notation-SHA256'),form=new FormData();form.append('file',await original.blob(),'own-original-score.feedpak');
  const loaded=await fetch('/api/plugins/open_chart_editor/load',{method:'POST',body:form});if(!loaded.ok)throw Error(await loaded.text());const project=(await loaded.json()).project;
  if(!project.arrangements[0]._notationBaseline)throw Error('Fresh native import did not stamp notation baseline');
  const save=async()=>{const response=await fetch('/api/plugins/open_chart_editor/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project,format:'feedpak'})});if(!response.ok)throw Error(await response.text());const blob=await response.blob(),inspect=await fetch('/harness/inspect-notation',{method:'POST',body:blob});return {blob,info:await inspect.json(),warning:response.headers.get('X-OCE-Export-Warnings')};};
  const unchanged=await save();if(unchanged.info.reference!=='notation_own-score.json'||unchanged.info.originalNotationSha256!==originalSha)throw Error('Unchanged authored notation was not retained byte-identically');
  project.arrangements[0].notes[0].pitch=127;project.arrangements[0].notes[0].hand='lh';const changed=await save();
  if(changed.info.reference!=null||changed.info.originalNotationSha256!==originalSha)throw Error('Changed notation pointer was not detached while preserving original opaque bytes');
  if(!changed.warning?.includes('notation'))throw Error('Normal export omitted explicit stale-notation warning');
  if(changed.info.notes[0].m!==127||changed.info.notes[0].hand!=='lh')throw Error('Normal export lost current absolute pitch/hand');
  const filename=crypto.randomUUID()+'_notation.feedpak',upload=new FormData();upload.append('file',changed.blob,filename);const added=await fetch('/api/songs/upload',{method:'POST',body:upload});if(!added.ok||(await added.json()).results[0]?.status!=='ok')throw Error('Own normal export upload failed');
  window.normalNotationFilename=filename;return {filename,originalSha,unchangedNotationByteIdentical:true,changedPointerDetached:true,originalOpaqueNotationRetained:true,warning:changed.warning};
 });
 const notationSocketStart=ws.length;
 await page.evaluate(async filename=>{const result=await feedBack.capabilities.dispatch({capability:'playback',command:'start',source:'open_chart_editor',timeoutMs:30000,args:{requesterId:'open_chart_editor',authorization:'user-action',priority:'user',target:{filename},arrangement:0,startTime:2}});if(result.outcome!=='handled')throw Error('Native normal-export play failed')},normalExport.filename);
 await page.waitForFunction(()=>highway.getSongInfo()?.title==='Original normal export notation study'&&feedBack.playback.snapshot().state.transport.isPlaying&&document.querySelector('.piano-highway-canvas'));
 const normalMessages=ws.slice(notationSocketStart).flatMap(s=>s.payload),normalInfo=normalMessages.find(m=>m.type==='song_info'),normalNotes=normalMessages.filter(m=>m.type==='notes').flatMap(m=>m.data??[]);
 assert.equal(normalInfo.has_notation,false);assert.deepEqual(normalNotes.map(n=>[n.m,n.hand]),[[127,'lh']]);
 const normalRenderer=await page.evaluate(()=>document.querySelector('#viz-picker option[value="auto"]')?.textContent);assert.ok(normalRenderer.includes('Piano Highway'));assert.ok(!normalRenderer.includes('3D'));
 await page.screenshot({path:process.env.OCE_HIGHWAY_SCREENSHOT.replace('.png','-normal-export-notation.png')});
 await page.evaluate(async()=>{await feedBack.closeCurrentSong()});await page.waitForTimeout(250);const removed=await page.request.delete(process.env.OCE_HOST_URL+'/api/song/'+encodeURIComponent(normalExport.filename));assert.equal(removed.status(),200);
 Object.assign(normalExport,{actualAutoRenderer:normalRenderer,actualWireNotes:normalNotes,normalLibraryExport:true,previewHelperBypassed:true,ownedBuildRemoved:true});
 await page.waitForSelector('#plugin-open_chart_editor.active #ws-canvas');
 const originalForUI=await page.request.get(process.env.OCE_HOST_URL+'/harness/original-notation.feedpak');
 await page.locator('#ws-open-file').setInputFiles({name:'own-original-score.feedpak',mimeType:'application/octet-stream',buffer:await originalForUI.body()});
 await page.waitForFunction(()=>document.querySelector('#ws-title').textContent.includes('Original normal export notation study'));
 await page.locator('#ws-canvas').press('Control+a');await page.locator('#ws-note-pitch').fill('127');await page.locator('#ws-note-pitch').dispatchEvent('change');
 const uiDownload=page.waitForEvent('download'),saveButton=page.locator('[data-action="saveas"]').first();await saveButton.evaluate(el=>{const menu=el.closest('details');if(menu)menu.open=true});await saveButton.click();await page.locator('#ws-export-format').selectOption('feedpak');await page.locator('#ws-dialog-submit').click();await uiDownload;
 await page.waitForFunction(()=>document.querySelector('#ws-status').textContent.includes('notation'));
 const uiWarning=await page.locator('#ws-status').textContent();assert.ok(uiWarning.includes('Saved'));assert.ok(uiWarning.includes('notation'));normalExport.uiWarning=uiWarning;normalExport.uiWarningVisible=true;
 await page.screenshot({path:process.env.OCE_HIGHWAY_SCREENSHOT.replace('.png','-normal-export-warning.png')});
 const isolation=await(await page.request.get(process.env.OCE_HOST_URL+'/harness/isolation')).json();assert.deepEqual(isolation.pluginIds.sort(),['drum_highway_3d','keys_highway_3d','piano','open_chart_editor']);assert.deepEqual(isolation.entries,[]);
 const expectedMissing=new Set(['/api/plugins/minigames/profile','/api/plugins/minigames/registry','/api/plugins/tuner/config']);
 const unexpectedHttpErrors=httpErrors.filter(e=>!expectedMissing.has(new URL(e.url).pathname));
 // Targeted playback assertions above are separate from unrelated shell APIs.
 // Record every unexpected core failure and never label that shell clean.
 const criticalHttpErrors=unexpectedHttpErrors.filter(e=>new URL(e.url).pathname.startsWith('/api/plugins/open_chart_editor/')||new URL(e.url).pathname==='/api/songs/upload'||new URL(e.url).pathname.startsWith('/api/song/'));
 const ancillaryCoreFailures=unexpectedHttpErrors.filter(e=>!criticalHttpErrors.includes(e));assert.deepEqual(criticalHttpErrors,[]);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,playbackPassed:true,fullShellClean:ancillaryCoreFailures.length===0,cases,normalExport,isolation,errors,httpErrors,ancillaryCoreFailures,
  knownHostIssue:'Baseline MetadataDB statement-cache concurrency failures were reproduced independently and addressed by a separately reviewed one-line cached_statements=0 compatibility fix. This verifier does not edit host core; the reported module path/hash identifies whether that fix is installed or staged.',
  blockedExternalOrigins:[...new Set(blocked)],websockets:ws,physicalHardwareVerified:false}));
}catch(error){console.error(JSON.stringify({error:String(error),errors,httpErrors,blocked,websockets:ws}));throw error}
finally{await page.screenshot({path:process.env.OCE_HIGHWAY_SCREENSHOT}).catch(()=>{});await browser.close()}
'''

def verify(host,run,staged_db=False):
    if not staged_db:
        applied=json.loads((ROOT/'research'/'host-fixes'/'applied.json').read_text())
        if hashlib.sha256((host/'lib'/'metadata_db.py').read_bytes()).hexdigest()!=applied['afterSha256']:raise ValueError('Installed MetadataDB differs from the separately reviewed compatibility fix; review before production verification')
    install=install_module();plan=install.make_plan(run/'plugins'/'open_chart_editor');install.apply_plan(plan,expected_digest=plan['sourceDigest'],backup_root=run/'backups')
    # Read-only provider source exposure through exact workspace junctions.
    # No provider files are copied, built or modified; all settings use CONFIG_DIR.
    provider_hashes={}
    for name,source in provider_sources(host).items():
        manifest=json.loads((source/'plugin.json').read_text())
        if manifest['id']!=name or manifest.get('requirements'):raise ValueError('Unexpected renderer identity/dependency installation requirement')
        provider_hashes[name]={file:hashlib.sha256((source/file).read_bytes()).hexdigest()for file in ['plugin.json','screen.js']}
        subprocess.run(['cmd','/c','mklink','/J',str(run/'plugins'/name),str(source)],check=True,capture_output=True,text=True)
    with socket.socket()as listener:listener.bind(('127.0.0.1',0));port=listener.getsockname()[1]
    (run/'tmp').mkdir(exist_ok=True)
    env=dict(os.environ,PYTHONDONTWRITEBYTECODE='1',TMP=str(run/'tmp'),TEMP=str(run/'tmp'));log=(run/'server.log').open('w',encoding='utf-8')
    command=[sys.executable,str(Path(__file__)),'--serve','--host-root',str(host),'--run-dir',str(run),'--port',str(port)]
    if staged_db:command.append('--staged-db')
    process=subprocess.Popen(command,cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,env=env)
    try:
        for _ in range(150):
            if process.poll()is not None:raise RuntimeError((run/'server.log').read_text(encoding='utf-8'))
            try:
                c=http.client.HTTPConnection('127.0.0.1',port,timeout=2);c.request('GET','/harness/isolation');r=c.getresponse();r.read();c.close()
                if r.status==200:break
            except OSError:pass
            time.sleep(.1)
        else:raise RuntimeError('Actual host did not become ready')
        env.update(OCE_HOST_URL=f'http://127.0.0.1:{port}',OCE_HIGHWAY_SCREENSHOT=str(run/'highway.png'))
        browser=subprocess.run(['node','--input-type=module'],input=BROWSER,text=True,encoding='utf-8',errors='replace',capture_output=True,cwd=ROOT,env=env,timeout=180)
        if browser.returncode:raise RuntimeError(browser.stdout+'\n'+browser.stderr)
        for name,files in provider_hashes.items():
            if any(hashlib.sha256((provider_sources(host)[name]/file).read_bytes()).hexdigest()!=digest for file,digest in files.items()):raise ValueError('Read-only renderer source changed during verification')
        browser_report=json.loads(browser.stdout.strip().splitlines()[-1])
        from PIL import Image
        for case in browser_report['cases']:
            if case['canvasPixels']is None:
                with Image.open(case['canvasScreenshot'])as screenshot:
                    raw=screenshot.convert('RGB').tobytes();case['canvasPixels']=sum(1 for i in range(0,len(raw),3)if sum(raw[i:i+3])>70)
                if case['canvasPixels']<=1000:raise ValueError('Actual composited WebGL canvas contains no visible highway')
                case['pixelVerification']='Actual Chromium composited WebGL screenshot; software SwiftShader, no physical GPU accuracy claim'
        result={'ok':True,'sourceDigest':plan['sourceDigest'],'sourceFiles':plan['files'],'hostSource':str(host/'server.py'),'runDirectory':str(run),'browser':browser_report,'userLibraryTouched':False,'userServiceStarted':False,'externalDestinationInstalled':False}
        if staged_db and not result['browser']['fullShellClean']:raise RuntimeError('Staged database fix did not eliminate full-shell unexpected HTTP errors: '+json.dumps(result['browser']['ancillaryCoreFailures']))
        return result
    finally:
        process.terminate()
        try:process.wait(timeout=10)
        except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)
        log.close()

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--serve',action='store_true');parser.add_argument('--host-root',type=Path,default=HOST);parser.add_argument('--run-dir',type=Path);parser.add_argument('--port',type=int,default=0);parser.add_argument('--staged-db',action='store_true',help='Test reviewed workspace-only MetadataDB compatibility copy; no host source change');args=parser.parse_args()
    if args.serve:
        if not args.run_dir or not install_module().within(args.run_dir,ROOT/'tools'/'.host-runs'):raise ValueError('Isolated workspace run directory required')
        import uvicorn
        uvicorn.run(make_app(args.host_root,args.run_dir,args.staged_db),host='127.0.0.1',port=args.port,log_level='warning');return 0
    run=ROOT/'tools'/'.host-runs'/uuid.uuid4().hex;run.mkdir(parents=True)
    try:result=verify(args.host_root,run,args.staged_db)
    except Exception as error:result={'ok':False,'error':str(error),'runDirectory':str(run),'userLibraryTouched':False,'externalDestinationInstalled':False}
    (run/'report.json').write_text(json.dumps(result,indent=2),encoding='utf-8');(ROOT/'research'/'highway-integration.json').write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps({'ok':result['ok'],'report':str(run/'report.json'),'sourceDigest':result.get('sourceDigest'),'browser':result.get('browser'),'error':result.get('error')},indent=2));return 0 if result['ok']else 1
if __name__=='__main__':raise SystemExit(main())
