"""Real public Playtest Loop UI, media wrap and owned cleanup in isolated FeedBack.
Reuses the actual production loader/provider and offline/hardware-denial gate.
No user service restart, config/library mutation or private playback globals.
"""
from __future__ import annotations
import argparse,importlib.util,json,sys,uuid
from pathlib import Path
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('production_loop_highway',ROOT/'tools'/'verify-highway.py')
gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)
gate.__file__=__file__

LOOP_BROWSER=r'''
 // Exercise the actual OCE menu action, not only its helper module.
 async function loopAction(name){const el=page.locator(`[data-action="${name}"]`).first();await el.evaluate(button=>{const menu=button.closest('details');if(menu)menu.open=true;});await el.click();}
 async function loopSubmit(){await page.evaluate(()=>{window.__loopDialogClosed=new Promise(resolve=>document.querySelector('#ws-dialog').addEventListener('close',()=>queueMicrotask(resolve),{once:true}));});await page.locator('#ws-dialog-submit').click();await page.evaluate(()=>window.__loopDialogClosed);}
 async function loopSnapshot(){const pending=page.waitForEvent('download');await loopAction('saveas');await page.locator('#ws-export-format').selectOption('json');await loopSubmit();const chunks=[],stream=await(await pending).createReadStream();for await(const chunk of stream)chunks.push(chunk);return JSON.parse(Buffer.concat(chunks));}
 await loopAction('selectregion');await page.locator('#ws-region-start').fill('1');await page.locator('#ws-region-end').fill('2.25');await loopSubmit();
 await page.waitForFunction(()=>document.querySelector('#ws-inspector-content h3')?.textContent.startsWith('1 selected'));
 const loopSourceBefore=await loopSnapshot(),loopEditorBefore=await page.evaluate(()=>({zoom:document.querySelector('#ws-zoom').value,scrollLeft:document.querySelector('#ws-timeline-scroll').scrollLeft,fret:document.querySelector('#ws-note-fret').value,arrangement:document.querySelector('#ws-arrangement').value,selection:document.querySelector('#ws-inspector-content h3').textContent}));
 const loopSocketStart=ws.length;
 await loopAction('playtest-loop');
 await page.waitForFunction(()=>document.querySelector('#player.active')&&feedBack.getLoop().loopA===1&&feedBack.getLoop().loopB===2.25,{},{timeout:30000});
 const loopInitial=await page.evaluate(async()=>{const module=await import('/api/plugins/open_chart_editor/src/playtest.js');window.loopGateModule=module;window.loopGatePreview=module.getPreviews().find(preview=>preview.status==='playing'&&preview.loop?.start===1&&preview.loop?.end===2.25);if(!loopGatePreview)throw Error('Actual menu did not return an owned loop preview');return {loop:feedBack.getLoop(),state:feedBack.playback.snapshot().state,filename:loopGatePreview.filename,handleLoop:loopGatePreview.loop,immutableLoop:Object.isFrozen(loopGatePreview.loop),notes:highway.getNotes().length};});
 assert.deepEqual(loopInitial.loop,{loopA:1,loopB:2.25});assert.deepEqual(loopInitial.handleLoop,{start:1,end:2.25});assert.equal(loopInitial.immutableLoop,true);assert.ok(loopInitial.notes>0);assert.equal(loopInitial.state.loop.enabled,true);assert.equal(loopInitial.state.loop.startTime,1);assert.equal(loopInitial.state.loop.endTime,2.25);
 const wrap=await page.evaluate(async()=>{
  const samples=[],start=performance.now();let high=null,wrapped=null;
  while(performance.now()-start<18000){
   const state=feedBack.playback.snapshot().state,t=state.media.mediaTime; samples.push({t,playing:state.transport.isPlaying,at:performance.now()-start});
   if(t>2.08&&t<2.4)high=t;
   if(high!==null&&t>=.9&&t<1.25)wrapped??=t;
   if(wrapped!==null&&t>wrapped+.12&&t<2){return {high,wrapped,advancedTo:t,samples};}
   await new Promise(resolve=>setTimeout(resolve,40));
  }
  throw Error('Real browser media clock did not wrap then advance: '+JSON.stringify(samples));
 });
 assert.ok(wrap.high>2.08&&wrap.wrapped<1.25&&wrap.advancedTo>wrap.wrapped+.12);
 const rejected=await page.evaluate(async()=>{const before=feedBack.getLoop();let guardCalls=0;const result=await feedBack.setLoop(3,4,{reason:'isolated-verifier-rejected-loop',commitGuard:()=>{guardCalls++;return false;}});return {result,guardCalls,before,after:feedBack.getLoop()};});
 assert.equal(rejected.result,false);assert.equal(rejected.guardCalls,1);assert.deepEqual(rejected.after,rejected.before);
 const loopMessages=ws.slice(loopSocketStart).flatMap(socket=>socket.payload),loopWire=loopMessages.filter(message=>message.type==='notes').flatMap(message=>message.data??[]);assert.deepEqual(loopWire.map(note=>[note.s,note.f]),[[0,5]]);
 const loopCanvas=await page.locator('#highway').evaluate(canvas=>{const bytes=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let n=0;for(let i=0;i<bytes.length;i+=4)if(bytes[i]+bytes[i+1]+bytes[i+2]>70)n++;return n;});assert.ok(loopCanvas>1000);
 await page.screenshot({path:process.env.OCE_HIGHWAY_SCREENSHOT.replace('.png','-loop.png')});
 await page.evaluate(async()=>{await loopGateModule.endPlaytest(loopGatePreview);});await page.waitForTimeout(250);await page.evaluate(async()=>{await loopGateModule.removePreview(loopGatePreview);});
 await page.waitForSelector('#plugin-open_chart_editor.active #ws-canvas');
 const loopEditorAfter=await page.evaluate(()=>({zoom:document.querySelector('#ws-zoom').value,scrollLeft:document.querySelector('#ws-timeline-scroll').scrollLeft,fret:document.querySelector('#ws-note-fret').value,arrangement:document.querySelector('#ws-arrangement').value,selection:document.querySelector('#ws-inspector-content h3').textContent}));assert.deepEqual(loopEditorAfter,loopEditorBefore);assert.deepEqual(await loopSnapshot(),loopSourceBefore);
 const loopIsolation=await(await page.request.get(process.env.OCE_HOST_URL+'/harness/isolation')).json();assert.deepEqual(loopIsolation.entries,[]);
 const loopPlaytest={passed:true,actualOceMenu:true,publicApisOnly:true,initial:loopInitial,wrap,rejectedCommit:rejected,wireNotes:loopWire,canvasPixels:loopCanvas,editorBefore:loopEditorBefore,editorAfter:loopEditorAfter,authoredProjectUnchanged:true,ownedPreviewRemoved:true,isolatedLibraryEmpty:true,physicalAudioVerified:false};
'''
marker=' for(const {arrangementId,startTime} of '
if gate.BROWSER.count(marker)!=1:raise RuntimeError('Production gate case insertion boundary changed')
gate.BROWSER=gate.BROWSER.replace(marker,LOOP_BROWSER+marker).replace('cases,normalExport,isolation','cases,loopPlaytest,normalExport,isolation')

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--serve',action='store_true');parser.add_argument('--host-root',type=Path,default=gate.HOST);parser.add_argument('--run-dir',type=Path);parser.add_argument('--port',type=int,default=0)
    args=parser.parse_args()
    if args.serve:
        if not args.run_dir or not gate.install_module().within(args.run_dir,ROOT/'tools'/'.host-runs'):raise ValueError('Isolated workspace run directory required')
        import uvicorn
        uvicorn.run(gate.make_app(args.host_root,args.run_dir),host='127.0.0.1',port=args.port,log_level='warning');return 0
    run=ROOT/'tools'/'.host-runs'/uuid.uuid4().hex;run.mkdir(parents=True)
    try:
        result=gate.verify(args.host_root,run)
        if not result['browser'].get('loopPlaytest',{}).get('passed'):raise ValueError('Actual public loop gate did not pass')
        if not result['browser']['fullShellClean']:raise ValueError('Unexpected isolated host HTTP failures')
        current=gate.install_module().make_plan(run/'plugins'/'open_chart_editor')
        if current['sourceDigest']!=result['sourceDigest']:raise ValueError('Source changed during the digest-gated loop run')
        result['sourceStable']=True
    except Exception as error:result={'ok':False,'error':str(error),'runDirectory':str(run),'userLibraryTouched':False,'externalDestinationInstalled':False}
    (run/'report.json').write_text(json.dumps(result,indent=2),encoding='utf-8');(ROOT/'research'/'highway-loop-integration.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'ok':result['ok'],'report':str(run/'report.json'),'sourceDigest':result.get('sourceDigest'),'loop':result.get('browser',{}).get('loopPlaytest'),'error':result.get('error')},indent=2));return 0 if result['ok']else 1
if __name__=='__main__':raise SystemExit(main())
