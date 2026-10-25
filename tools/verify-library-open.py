"""Prepared actual public library-card gate, isolated library/config only.

Requires explicit browser release. Stages reviewed library glue over the closed
runtime list inside workspace; no external install, scan, device or user service.
"""
from pathlib import Path
import argparse,hashlib,importlib.util,json,os,shutil,sys,uuid
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('library_host_gate',ROOT/'tools/verify-highway.py');gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate);gate.__file__=__file__
# Library-card integration needs no renderer. Loading unrelated Drum3D's gear
# poller requests MIDI even without playback; retain that separately reproduced
# finding and isolate this gate to the actual OCE public plugin loader.
gate.PROVIDER_IDS=()
gate.provider_sources=lambda host:{}
STAGE=ROOT/'research/staging/library-open-production'
_installer=None
def staged_installer():
    global _installer
    if _installer:return _installer
    if os.environ.get('OCE_LIBRARY_GATE_RUNTIME')=='1':
        _installer=original_installer();return _installer
    install=original_installer();install.RUNTIME_FILES=(*install.RUNTIME_FILES,'src/library-open.js','library_source.py');original_plan=install.make_plan
    def plan(destination,source=None):
        if source is not None:return original_plan(destination,source)
        destination=Path(destination);overlay=destination.parents[1]/'reviewed-source';overlay.mkdir(exist_ok=True)
        record=json.loads((STAGE/'staging.json').read_text(encoding='utf-8'))
        for name,digest in record['baseSha256'].items():
            if hashlib.sha256((ROOT/name).read_bytes()).hexdigest()!=digest:raise ValueError('Runtime base changed; review/regenerate stage before gate: '+name)
        for name in install.RUNTIME_FILES:
            source_file=STAGE/name if name in record['stagedSha256'] else ROOT/name
            if name in record['stagedSha256'] and hashlib.sha256(source_file.read_bytes()).hexdigest()!=record['stagedSha256'][name]:raise ValueError('Reviewed stage digest mismatch: '+name)
            target=overlay/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(source_file.read_bytes())
        return original_plan(destination,overlay)
    install.make_plan=plan;_installer=install;return install
original_installer=gate.install_module;gate.install_module=staged_installer
original_app=gate.make_app
def make_app(host,run,staged_db=False):
    app=original_app(host,run,staged_db)
    @app.post('/harness/own-library-fixture')
    def create_fixture():
        import server
        data,_=gate.original_notation_fixture();path=run/'library/own-library.feedpak';path.write_bytes(data);st=path.stat()
        # Single explicit owned fixture, not a scanner or automatic library walk.
        server.meta_db.put(path.name,st.st_mtime,st.st_size,{'title':'Original normal export notation study','artist':'Local author','duration':12,'format':'feedpak','arrangements':[],'stem_count':1,'stem_ids':['full']})
        return {'filename':path.name,'sha256':hashlib.sha256(data).hexdigest()}
    @app.get('/harness/own-library-proof')
    def source_proof():
        path=run/'library/own-library.feedpak'
        return {'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'files':[p.name for p in (run/'library').iterdir()]}
    return app
gate.make_app=make_app
prefix=gate.BROWSER[:gate.BROWSER.index(' const fixture=await page.evaluate(')]
prefix=prefix.replace('window.__midiDenied=0;window.__mediaDenied=0;', 'window.__midiDenied=0;window.__mediaDenied=0;window.__hardwareCalls=[];').replace('window.__midiDenied++;', "window.__midiDenied++;window.__hardwareCalls.push({kind:'midi',stack:new Error('Denied MIDI caller').stack});").replace('window.__mediaDenied++;', "window.__mediaDenied++;window.__hardwareCalls.push({kind:'media',stack:new Error('Denied media caller').stack});")
gate.BROWSER=prefix+r'''
 const checks=[],source=await(await page.request.post(process.env.OCE_HOST_URL+'/harness/own-library-fixture')).json();let reads=0;
 page.on('request',r=>{if(r.url().endsWith('/library-source'))reads++;});
 async function action(name){await page.locator(`[data-action="${name}"]`).first().evaluate(el=>el.click());}
 async function cardClick(){await page.evaluate(()=>{showScreen('v3-songs');v3Songs.reload();});const card=page.locator('#v3-songs-grid [data-fn="own-library.feedpak"]').first();await card.waitFor();await card.locator('[data-menu]').click({force:true});await page.locator('.v3-card-menu [data-act="open_chart_editor.open-library"]').click();await page.waitForSelector('#plugin-open_chart_editor.active');}
 async function snapshot(){const pending=page.waitForEvent('download');await action('saveas');await page.locator('#ws-export-format').selectOption('json');await page.locator('#ws-dialog-submit').click();const chunks=[];for await(const c of await(await pending).createReadStream())chunks.push(c);return JSON.parse(Buffer.concat(chunks));}
 let dirtyVersion=0;async function dirty(){await page.locator('[data-inspector="settings"]').click();await page.locator('#ws-meta-title').fill('Own unsaved source '+(++dirtyVersion));await page.locator('#ws-meta-title').dispatchEvent('change');}
 await dirty();await snapshot();await dirty();const initialReads=reads;await cardClick();await page.locator('#ws-dialog[open]').waitFor();await page.locator('#ws-dialog button[value="cancel"]').click();await page.waitForTimeout(50);assert.equal(reads,initialReads);assert.equal((await snapshot()).title,'Own unsaved source '+dirtyVersion);checks.push('Actual v3 card menu/public registry navigates OCE; dirty Cancel reads no source and retains project');
 await dirty();await cardClick();await page.locator('#ws-dialog-submit').click();await page.waitForFunction(()=>document.querySelector('#ws-title').textContent.includes('Original normal export notation study'));checks.push('Accepted actual library card reads exact selected archive through registered route and actual parser');
 const opened=await snapshot();assert.equal(opened.title,'Original normal export notation study');
 // Slow real route response: fetch first, hold only delivery; source bytes stay native.
 let deliver,arrived;let reached=new Promise(r=>arrived=r);await page.route('**/api/plugins/open_chart_editor/library-source',async route=>{const result=await route.fetch();arrived();await new Promise(r=>deliver=r);await route.fulfill({response:result});});
 await cardClick();await reached;await page.locator('[data-inspector="settings"]').click();await page.locator('#ws-meta-title').fill('Own edit while library reads');await page.locator('#ws-meta-title').dispatchEvent('change');deliver();await page.waitForTimeout(100);assert.match(await page.locator('#ws-title').textContent(),/Own edit while library reads/);checks.push('Source edit while actual library bytes are delayed prevents late replacement');await page.unroute('**/api/plugins/open_chart_editor/library-source');
 // New project supersedes an accepted slow read, including shared dialog ownership.
 reached=new Promise(r=>arrived=r);await page.route('**/api/plugins/open_chart_editor/library-source',async route=>{const result=await route.fetch();arrived();await new Promise(r=>deliver=r);await route.fulfill({response:result});});
 await cardClick();await page.locator('#ws-dialog-submit').click();await reached;await action('new');await page.locator('#ws-dialog-submit').click();const newTitle=await page.locator('#ws-title').textContent();deliver();await page.waitForTimeout(100);assert.equal(await page.locator('#ws-title').textContent(),newTitle);assert.doesNotMatch(newTitle,/Original normal export/);checks.push('Explicit New supersedes old library fetch and owns its shared confirmation');await page.unroute('**/api/plugins/open_chart_editor/library-source');
 // Repeated screen transitions must neither duplicate action nor replay params.
 await cardClick();await page.waitForFunction(()=>document.querySelector('#ws-title').textContent.includes('Original normal export notation study'));const count=reads;
 for(let i=0;i<3;i++){await page.evaluate(()=>showScreen('v3-songs'));await page.evaluate(()=>showScreen('plugin-open_chart_editor'));await page.waitForSelector('#ws-app[data-mounted="true"]');}
 await page.waitForTimeout(60);assert.equal(reads,count);assert.equal(await page.evaluate(()=>feedBack.libraryCardActions.snapshot().actions.filter(a=>a.id==='open_chart_editor.open-library').length),1);checks.push('Public screen return/remount retains one registration and consumes navigation request once');
 const proof=await(await page.request.get(process.env.OCE_HOST_URL+'/harness/own-library-proof')).json();assert.equal(proof.sha256,source.sha256);assert.deepEqual(proof.files,['own-library.feedpak']);assert.equal(await page.evaluate(()=>window.__mediaDenied),0);assert.equal(await page.evaluate(()=>window.__midiDenied),0);assert.deepEqual(errors,[]);
 const isolation=await(await page.request.get(process.env.OCE_HOST_URL+'/harness/isolation')).json();
 console.log(JSON.stringify({ok:true,cases:[],checks,isolation,sourceProof:proof,reads,hardwareAccessRequests:0,fullShellClean:!httpErrors.some(r=>r.status>=500),errors,httpErrors,blockedExternalOrigins:[...new Set(blocked)],scope:'Actual host public loader/registry/v3 card/navigation/route/parser; isolated single owned fixture DB entry, no scanner or user library'}));
}catch(error){console.error(JSON.stringify({error:String(error),errors,httpErrors,blocked,hardwareCalls:await page.evaluate(()=>window.__hardwareCalls).catch(()=>[])}));throw error}finally{await browser.close()}
'''
def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--serve',action='store_true');p.add_argument('--host-root',type=Path,default=gate.HOST);p.add_argument('--run-dir',type=Path);p.add_argument('--port',type=int,default=0);args=p.parse_args()
    if os.environ.get('OCE_LIBRARY_HOST_RELEASE')!='1':raise SystemExit('Prepared only: explicit browser ownership/release required')
    if args.serve:
        if not args.run_dir or not original_installer().within(args.run_dir,ROOT/'tools/.host-runs'):raise ValueError('Controlled workspace run required')
        import uvicorn
        uvicorn.run(make_app(args.host_root,args.run_dir),host='127.0.0.1',port=args.port,log_level='warning');return 0
    run=ROOT/'tools/.host-runs'/uuid.uuid4().hex;run.mkdir(parents=True)
    try:result=gate.verify(args.host_root,run)
    except Exception as error:result={'ok':False,'error':str(error),'runDirectory':str(run)}
    result.update(runtimeApplied=False,userLibraryTouched=False,userServiceStarted=False,externalDestinationInstalled=False)
    (run/'report.json').write_text(json.dumps(result,indent=2),encoding='utf-8');(ROOT/'research/library-open/actual-host-report.json').write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps({'ok':result['ok'],'report':str(run/'report.json'),'error':result.get('error')}));return 0 if result['ok']else 1
if __name__=='__main__':raise SystemExit(main())
