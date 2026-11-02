// "Import arrangements" dialog: a source that brings its own ready-to-use audio (a FeedPak,
// an Editor on Fire project) offers opening it outright instead of only ever merging its
// arrangements in. A source with no audio of its own keeps the old merge-only behavior.
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.OCE_PLAYWRIGHT||'C:/Users/zagat/AppData/Roaming/npm/node_modules/rea-agents/node_modules/playwright-core');
const browser=await chromium.launch({headless:true,executablePath:process.env.OCE_CHROMIUM||'C:/Users/zagat/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe'});
try{
 const page=await browser.newPage({viewport:{width:1400,height:900}}),errors=[],results=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(process.env.OCE_URL||'http://127.0.0.1:8767');
 await page.waitForSelector('#ws-app[data-mounted="true"]');

 const withAudio={...{version:1,title:'Incoming with audio',artist:'',duration:4,beats:[{time:0,measure:1},{time:1,measure:-1}],sections:[],
  arrangements:[{id:'a1',name:'Lead',type:'guitar',tuning:[0,0,0,0,0,0],stringCount:6,basePitches:[40,45,50,55,59,64],capo:0,notes:[],chords:[],chord_templates:[],anchors:[],handshapes:[]}]},
  audio:{url:'/api/plugins/open_chart_editor/audio/incoming-token',name:'incoming.wav'}};
 const withoutAudio=JSON.parse(JSON.stringify(withAudio));delete withoutAudio.audio;withoutAudio.title='Incoming without audio';

 async function loadImportDialog(project){
  await page.unroute('**/api/plugins/open_chart_editor/load').catch(()=>{});
  await page.route('**/api/plugins/open_chart_editor/load',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({project})}));
  await page.locator('#ws-import-file').setInputFiles({name:'incoming.feedpak',mimeType:'application/octet-stream',buffer:Buffer.from('fixture')});
  await page.waitForFunction(()=>document.querySelector('#ws-dialog[open] #ws-dialog-title')?.textContent==='Import arrangements');
 }

 // A source with its own audio: the mode choice appears, defaults to merge, and toggling to
 // "replace" hides the merge-only controls and relabels the submit button.
 await loadImportDialog(withAudio);
 assert.equal(await page.locator('#ws-import-mode').count(),1,'mode choice fieldset is shown for a source with its own audio');
 assert.equal(await page.locator('[name="ws-import-mode-choice"][value="merge"]').isChecked(),true,'merge is the default choice');
 assert.equal(await page.locator('#ws-import-merge-options').isVisible(),true,'merge options are visible by default');
 await page.locator('[name="ws-import-mode-choice"][value="replace"]').check();
 assert.equal(await page.locator('#ws-import-merge-options').isVisible(),false,'merge options hide once replace is chosen');
 assert.equal(await page.locator('#ws-dialog-submit').textContent(),'Open as new project','submit button relabels for replace');
 results.push('mode choice appears, defaults to merge, and toggling to replace hides merge options and relabels the submit button');

 // Choosing "replace" opens the incoming project outright instead of merging.
 const loaded=page.waitForResponse(response=>response.url().endsWith('/api/plugins/open_chart_editor/load')&&response.request().method()==='POST');
 await page.locator('#ws-dialog-submit').click();
 await loaded;
 await page.waitForFunction(()=>document.querySelector('#ws-title')?.textContent?.includes('Incoming with audio'));
 results.push('choosing "Open as new project" replaces the whole project, not just a merge');

 // A source with no audio of its own never offers the replace choice; behavior is unchanged.
 await loadImportDialog(withoutAudio);
 assert.equal(await page.locator('#ws-import-mode').count(),0,'no mode choice for a source without its own audio');
 assert.equal(await page.locator('#ws-import-merge-options').isVisible(),true,'merge options are shown directly');
 assert.equal(await page.locator('#ws-dialog-submit').textContent(),'Import selected','submit button keeps its original label');
 results.push('a source without its own audio keeps the original merge-only dialog, unchanged');

 await page.locator('#ws-dialog').evaluate(el=>el.close('cancel'));
 assert.deepEqual(errors,[],'no page errors');
 console.log(results.map(r=>'ok - '+r).join('\n'));
}finally{await browser.close();}
