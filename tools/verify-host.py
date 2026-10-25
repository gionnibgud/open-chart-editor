"""Verify the candidate through real FeedBack backend/frontend plugin loaders.

Runs one candidate plugin only, never imports server.py or starts user services.
All plugin/config/library/temp/report files stay in tools/.host-runs/<uuid>.
The browser shell supplies public event/navigation seams; its plugin hydration,
module generation URLs, asset serving and backend setup are the actual host code.
"""
from __future__ import annotations
import argparse
import hashlib
import http.client
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import uuid

sys.dont_write_bytecode = True
# An inherited TLS key-log setting belongs to the user's other investigations.
# This loopback-only harness must neither open nor append that external file.
os.environ.pop('SSLKEYLOGFILE', None)
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_HOST = Path(r'I:\Dev\freedBack\feedBack')


def installer():
    spec=importlib.util.spec_from_file_location('oce_local_installer',ROOT/'tools'/'install-local.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


SHELL = '''<!doctype html><html><head><meta charset="utf-8"><title>Isolated FeedBack plugin-loader verification</title><link rel="stylesheet" href="/static/tailwind.min.css">
<style>html,body{height:100%;margin:0;background:#17171b;color:#ddd}.hidden{display:none!important}.screen{display:none;height:calc(100vh - 36px)}.screen.active{display:block}#harness-nav{height:36px;display:flex;gap:20px;position:relative;z-index:100}#harness-nav a{color:#ddd}#mobile-menu,#plugin-settings-area{display:none}</style></head><body>
<div id="harness-nav"><a id="leave-screen" href="#">Isolated host</a><div id="nav-plugins"></div></div>
<div id="mobile-menu"><div id="mobile-nav-plugins"></div></div><div id="plugin-settings-area"><div id="plugin-settings"></div></div>
<main><div id="library" class="screen active">Only the candidate plugin is loaded. No user library is opened.</div><div id="player" class="screen"></div></main>
<script>const events=new Map();window.feedBack={on(name,fn){if(!events.has(name))events.set(name,new Set());events.get(name).add(fn);return()=>events.get(name).delete(fn)},off(name,fn){events.get(name)?.delete(fn)},emit(name,data){for(const fn of events.get(name)||[])fn(data)}};
window.showScreen=id=>{document.querySelectorAll('.screen').forEach(el=>el.classList.toggle('active',el.id===id));window.feedBack.emit('screen:changed',{id})};document.getElementById('leave-screen').onclick=e=>{e.preventDefault();showScreen('library')};
</script><script src="/static/capabilities.js"></script><script src="/static/capabilities/playback.js"></script>
<script>
// Test double for the physical player only. Registry/dispatcher/playback domain,
// upload validation, plugin export and deletion below are actual host/plugin code.
window.harnessTransport={starts:[],origin:null,isPlaying:false,currentTime:0};
feedBack.playback.registerTransportAdapter({inspect(){return {isPlaying:harnessTransport.isPlaying,currentTime:harnessTransport.currentTime}},async start(args){harnessTransport.origin=document.querySelector('.screen.active')?.id;harnessTransport.starts.push(args);harnessTransport.currentTime=args.startTime;harnessTransport.isPlaying=true;showScreen('player');return this.inspect()},async stop(){harnessTransport.isPlaying=false;return this.inspect()}});
feedBack.closeCurrentSong=async()=>{harnessTransport.isPlaying=false;showScreen(harnessTransport.origin||'library');feedBack.emit('song:stop',{})};
</script><script type="module">import{loadPlugins}from'/static/js/plugin-loader.js';window.hostLoadPlugins=loadPlugins;window.hostPlugins=await loadPlugins();window.hostLoaderReady=true;</script></body></html>'''


def make_app(host, run):
    # Set process-local locations before importing the actual loader. User plugin
    # roots and user configuration are deliberately absent in this subprocess.
    for name in ['FEEDBACK_PLUGINS_DIR','SLOPSMITH_PLUGINS_DIR']:
        os.environ.pop(name,None)
    for folder in ['config','library','tmp']:
        (run/folder).mkdir(exist_ok=True)
    os.environ['CONFIG_DIR']=str(run/'config')
    os.environ['TMP']=os.environ['TEMP']=str(run/'tmp')
    tempfile.tempdir=str(run/'tmp')
    sys.path.insert(0,str(host/'lib'))
    spec=importlib.util.spec_from_file_location('oce_host_plugins',host/'plugins'/'__init__.py',submodule_search_locations=[str(host/'plugins')])
    plugins=importlib.util.module_from_spec(spec);sys.modules[spec.name]=plugins;spec.loader.exec_module(plugins)
    plugins.PLUGINS_DIR=run/'plugins'
    from fastapi import FastAPI
    from fastapi.responses import HTMLResponse
    from fastapi.staticfiles import StaticFiles
    import appstate
    from metadata_db import MetadataDB
    from routers.song import router as song_router
    # Only process-local workspace state; scanner is intentionally an observable
    # no-op, never a service that scans the real library or launches other plugins.
    scan_calls=[];invalidated=[]
    appstate.configure(config_dir=run/'config',dlc_dir=run/'library',dlc_dir_env=str(run/'library'),
        meta_db=MetadataDB(run/'config'),kick_scan=lambda:scan_calls.append(True),
        invalidate_song_caches=lambda key:invalidated.append(key),art_override_paths=lambda key:[],
        scan_status=lambda:{'running':False})
    app=FastAPI(title='Isolated actual FeedBack plugin loader')
    app.include_router(song_router)
    progress=[]
    plugins.load_plugins(app,{'config_dir':run/'config','get_dlc_dir':lambda:run/'library'},progress_cb=progress.append)
    plugins.register_plugin_api(app)
    app.mount('/static',StaticFiles(directory=host/'static'),name='actual_host_static')
    @app.get('/',response_class=HTMLResponse)
    def index():return SHELL
    @app.get('/harness/report')
    def loader_report():
        return {'loaderSource':str(host/'plugins'/'__init__.py'),'loadedIds':[p['id']for p in plugins.LOADED_PLUGINS],
                'pendingIds':list(plugins.PENDING_PLUGINS),'progress':progress,'config':str(run/'config'),'library':str(run/'library'),
                'libraryEntries':[p.name for p in (run/'library').iterdir()],'scanRequests':len(scan_calls),'invalidated':invalidated}
    @app.get('/harness/original-project')
    def original_project():
        import base64,io,wave
        audio=io.BytesIO()
        with wave.open(audio,'wb')as wav:
            wav.setparams((1,2,8000,0,'NONE','not compressed'));wav.writeframes(b'\x00\x00'*800)
        arr={'id':'own-lead','name':'Lead','type':'guitar','stringCount':6,'tuning':[0]*6,'notes':[],
             'chords':[],'chord_templates':[],'anchors':[],'handshapes':[]}
        return {'version':1,'title':'Original isolated verification','artist':'Local author','duration':1,
                'beats':[{'time':0,'measure':1}],'sections':[],'arrangements':[arr,dict(arr,id='own-rhythm',name='Rhythm')],
                '_pack':{'manifest':{'stems':[{'id':'full','file':'audio/original.wav','default':True}]},
                         'entries':{'audio/original.wav':base64.b64encode(audio.getvalue()).decode()}}}
    return app


BROWSER = r'''
import {createRequire} from 'node:module';import assert from 'node:assert/strict';
const require=createRequire(process.cwd()+'/package.json');
const {chromium}=require(process.env.OCE_PLAYWRIGHT||'C:/Users/zagat/AppData/Roaming/npm/node_modules/rea-agents/node_modules/playwright-core');
const browser=await chromium.launch({headless:true,executablePath:process.env.OCE_CHROMIUM||'C:/Users/zagat/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe'});
const context=await browser.newContext({viewport:{width:1600,height:1000},acceptDownloads:true});const page=await context.newPage();page.setDefaultTimeout(10000);
const errors=[],failedRequests=[];page.on('pageerror',e=>errors.push(String(e)));page.on('requestfailed',r=>failedRequests.push({url:r.url(),failure:r.failure()}));
await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname!=='127.0.0.1'&&url.protocol!=='blob:'&&url.protocol!=='data:')return route.abort();return route.continue();});
try{
 await page.goto(process.env.OCE_HOST_URL);await page.waitForFunction(()=>window.hostLoaderReady===true);await page.waitForSelector('#ws-app[data-mounted="true"]',{state:'attached'});
 assert.equal(await page.locator('#plugin-open_chart_editor').count(),1);assert.equal(await page.locator('script[data-plugin-id="open_chart_editor"][type="module"]').count(),1);
 assert.equal(await page.locator('link[data-plugin-id="open_chart_editor"]').count(),1);
 await page.locator('#nav-plugins button').click();await page.locator('#plugin-dropdown a',{hasText:'OCE'}).click();
 await page.waitForSelector('#plugin-open_chart_editor.active #ws-canvas');
 const size=await page.locator('#ws-canvas').boundingBox();assert.ok(size.width>200&&size.height>100);
 const pixels=await page.locator('#ws-canvas').evaluate(canvas=>{const c=canvas.getContext('2d'),data=c.getImageData(0,0,canvas.width,canvas.height).data;let n=0;for(let i=3;i<data.length;i+=4)if(data[i])n++;return n});assert.ok(pixels>10000);
 await page.locator('#ws-tones-button').click();await page.waitForSelector('#ws-tone-view:not([hidden])');await page.locator('#ws-tab-button').click();
 const before=await page.locator('#ws-arrangement').inputValue();await page.evaluate(()=>showScreen('library'));await page.evaluate(()=>showScreen('plugin-open_chart_editor'));assert.equal(await page.locator('#ws-arrangement').inputValue(),before);
 await page.evaluate(()=>window.hostLoadPlugins());assert.equal(await page.locator('#ws-app').count(),1);assert.equal(await page.locator('script[data-plugin-id="open_chart_editor"]').count(),1);
 const playtest=await page.evaluate(async()=>{
  const {buildAndPlaytest,endPlaytest,removePreview}=await import('/api/plugins/open_chart_editor/src/playtest.js');
  const project=await(await fetch('/harness/original-project')).json();const reports=[];
  for(const startTime of [0,.05]){
   const preview=await buildAndPlaytest(project,{arrangementId:'own-rhythm',startTime});
   const uploaded=await(await fetch('/harness/report')).json();
   const start=harnessTransport.starts.at(-1);
   if(!uploaded.libraryEntries.includes(preview.filename))throw Error('Actual host upload did not commit archive');
   if(start.arrangement!==0||start.startTime!==startTime||start.target.filename!==preview.filename)throw Error('Selected-track preview must dispatch its parsed index zero');
   if(!preview.result?.payload?.state?.sessionId)throw Error('Actual dispatch did not return native session identity');
   if(!document.querySelector('#player.active'))throw Error('Playtest did not enter player');
   await endPlaytest(preview);if(!document.querySelector('#plugin-open_chart_editor.active'))throw Error('EndPlaytest did not return to origin');
   await removePreview(preview);
   const removed=await(await fetch('/harness/report')).json();
   if(removed.libraryEntries.includes(preview.filename))throw Error('Actual host delete did not remove owned preview');
   reports.push({startTime,authoredArrangement:1,previewArrangement:0,status:preview.result.status,outcome:preview.result.outcome,sessionIdPresent:true,originReturned:true,uploadValidated:true,removed:true});
  }
  return {actualCapabilityDispatcher:true,actualPlaybackDomain:true,actualHostUploadAndDelete:true,physicalPlayer:'test double; no audio/highway renderer exercised',cases:reports};
 });
 assert.equal(await page.locator('#ws-arrangement').inputValue(),before);
 await page.screenshot({path:process.env.OCE_HOST_SCREENSHOT,fullPage:true});assert.deepEqual(errors,[]);assert.deepEqual(failedRequests,[]);
 console.log(JSON.stringify({ok:true,actualFrontendLoader:true,canvasPixels:pixels,playtest,checks:['actual host nav screen/style/module injection','canvas rendered','tones tab','leave/re-enter state retained','loader re-hydration idempotent','real Feedpak upload validation and owned preview deletion','actual playback dispatch beginning/cursor and arrangement index','origin return retains editor selection'],errors,failedRequests}));
}catch(error){console.error(JSON.stringify({message:String(error),errors,failedRequests}));throw error}
finally{await page.screenshot({path:process.env.OCE_HOST_SCREENSHOT,fullPage:true}).catch(()=>{});await browser.close()}
'''


def request_json(base,path):
    # Explicit loopback HTTP socket, ignoring inherited proxy/TLS settings.
    port=int(base.rsplit(':',1)[1])
    connection=http.client.HTTPConnection('127.0.0.1',port,timeout=3)
    try:
        connection.request('GET',path)
        response=connection.getresponse()
        return response.status,json.loads(response.read())
    finally:connection.close()


def verify(host,run):
    from jsonschema import Draft202012Validator
    from fastapi.testclient import TestClient
    install=installer()
    destination=run/'plugins'/'open_chart_editor'
    plan=install.make_plan(destination)
    applied=install.apply_plan(plan,expected_digest=plan['sourceDigest'],backup_root=run/'backups')
    assert all(item['action']=='unchanged'for item in install.make_plan(destination)['files'])
    assert not install.apply_plan(install.make_plan(destination),expected_digest=plan['sourceDigest'],backup_root=run/'backups')['writtenFiles']
    # Exercise backup semantics on the isolated candidate, never on source or
    # the actual host destination. The exact altered file is retained in backup.
    modified=(destination/'screen.js').read_bytes()+b'\n// isolated backup verification\n'
    (destination/'screen.js').write_bytes(modified)
    replacement=install.make_plan(destination)
    restored=install.apply_plan(replacement,expected_digest=replacement['sourceDigest'],backup_root=run/'backups')
    assert (Path(restored['backup'])/'screen.js').read_bytes()==modified
    assert (destination/'screen.js').read_bytes()==(ROOT/'screen.js').read_bytes()
    manifest=json.loads((destination/'plugin.json').read_text())
    schema=json.loads((host/'docs'/'plugin-manifest.schema.json').read_text())
    Draft202012Validator(schema).validate(manifest)
    app=make_app(host,run)
    endpoint_checks=[]
    with TestClient(app)as client:
        loader=client.get('/harness/report').json()
        assert loader['loadedIds']==['open_chart_editor']and not loader['pendingIds'],loader
        catalog=client.get('/api/plugins').json()
        assert len(catalog)==1 and catalog[0]['id']=='open_chart_editor'and catalog[0]['status']=='ready',catalog
        assert catalog[0]['script_type']=='module'and catalog[0]['has_styles']and catalog[0]['fullscreen'],catalog
        for path,media in [('/screen.html','text/html'),('/screen.js','javascript'),('/src/main.js','javascript'),('/src/validation.js','javascript'),('/src/playtest.js','javascript'),('/assets/editor.css','text/css'),('/assets/tone-rack-data.json','json')]:
            response=client.get('/api/plugins/open_chart_editor'+path)
            assert response.status_code==200 and media in response.headers['content-type'],(path,response.status_code,response.headers)
            endpoint_checks.append(path)
        response=client.get('/api/plugins/open_chart_editor/src/main.js')
        assert client.get('/api/plugins/open_chart_editor/src/main.js',headers={'If-None-Match':response.headers['etag']}).status_code==304
        assert client.get('/api/plugins/open_chart_editor/src/..%2f..%2fpack_io.py').status_code==404
        assert client.get('/api/plugins/open_chart_editor/health').json()['ok']
    # The TestClient's scratch object belongs to this temporary app; the child
    # server builds a fresh app and its own plugin session, still inside run/tmp.
    with socket.socket()as listener:
        listener.bind(('127.0.0.1',0));port=listener.getsockname()[1]
    log=(run/'server.log').open('w',encoding='utf-8')
    env=dict(os.environ,PYTHONDONTWRITEBYTECODE='1')
    server=subprocess.Popen([sys.executable,str(Path(__file__)),'--serve','--host-root',str(host),'--run-dir',str(run),'--port',str(port)],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,env=env)
    base=f'http://127.0.0.1:{port}'
    try:
        for _ in range(100):
            if server.poll()is not None:raise RuntimeError((run/'server.log').read_text())
            try:
                if request_json(base,'/api/plugins/open_chart_editor/health')[1]['ok']:break
            except OSError:time.sleep(.1)
        else:raise RuntimeError('Isolated host did not become ready')
        env.update(OCE_HOST_URL=base,OCE_HOST_SCREENSHOT=str(run/'host-screen.png'))
        browser=subprocess.run(['node','--input-type=module'],input=BROWSER,text=True,capture_output=True,cwd=ROOT,env=env,timeout=90)
        if browser.returncode:raise RuntimeError(browser.stdout+'\n'+browser.stderr)
        browser_report=json.loads(browser.stdout.strip().splitlines()[-1])
    finally:
        server.terminate()
        try:server.wait(timeout=10)
        except subprocess.TimeoutExpired:server.kill();server.wait(timeout=5)
        log.close()
    result={'ok':True,'kind':'isolated actual FeedBack loader verification','hostRoot':str(host),'hostVersion':(host/'VERSION').read_text().strip(),
        'sourceDigest':plan['sourceDigest'],'sourceFiles':[{key:item[key]for key in ['path','bytes','sha256']}for item in plan['files']],
        'runDirectory':str(run),'candidateInstall':str(destination),'manifestSchemaPassed':True,'backendLoader':loader,
        'installerChecks':['closed runtime allowlist','source SHA256 snapshot','idempotent unchanged installation','exact changed-file backup before replacement','no deletions'],
        'sourceEndpointsPassed':endpoint_checks,'etag304Passed':True,'sourceContainmentPassed':True,'browser':browser_report,
        'actualUserHostStarted':False,'unrelatedPluginsLoaded':False,'externalDestinationInstalled':False,
        'limitations':['Minimal isolated shell supplies public event/navigation seams; full production shell/audio-device/library/game workflows are not covered.',
                       'Real capability dispatcher/playback domain and host upload/delete are tested against workspace-only library/DB. Physical player adapter and origin navigation are test doubles; actual highway/audio playback is not verified.',
                       'CDLC encoder remains an independent prerequisite; no package was built by this host-loader test.']}
    (run/'report.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    (ROOT/'research'/'host-integration.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    return result


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host-root',type=Path,default=DEFAULT_HOST)
    parser.add_argument('--serve',action='store_true',help=argparse.SUPPRESS)
    parser.add_argument('--run-dir',type=Path)
    parser.add_argument('--port',type=int,default=0)
    args=parser.parse_args(argv)
    if args.serve:
        if not args.run_dir or not installer().within(args.run_dir,ROOT/'tools'/'.host-runs'):raise ValueError('Server requires an isolated workspace run directory')
        import uvicorn
        uvicorn.run(make_app(args.host_root,args.run_dir),host='127.0.0.1',port=args.port,log_level='warning')
        return 0
    run=ROOT/'tools'/'.host-runs'/uuid.uuid4().hex
    run.mkdir(parents=True)
    try:
        result=verify(args.host_root,run)
        print(json.dumps({'ok':True,'report':str(run/'report.json'),'sourceDigest':result['sourceDigest'],'browser':result['browser']},indent=2))
        return 0
    except Exception as error:
        result={'ok':False,'error':str(error),'runDirectory':str(run),'actualUserHostStarted':False,'externalDestinationInstalled':False}
        (ROOT/'research'/'host-integration.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
        print(json.dumps(result,indent=2));return 1


if __name__=='__main__':raise SystemExit(main())
