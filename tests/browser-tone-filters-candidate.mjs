import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const paths=new Map([
 ['/tone-filters-candidate.js',new URL('../src/tone-filters-candidate.js',import.meta.url)],
 ['/tone-filters.js',new URL('../src/tone-filters.js',import.meta.url)],
 ['/tone-effects.js',new URL('../src/tone-effects.js',import.meta.url)],
 ['/catalog.json',new URL('../assets/tone-rack-data.json',import.meta.url)],
]);
// Closed loopback inputs include the promoted module and its compatibility alias.
const server=createServer(async(req,res)=>{try{if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Original filter offline experiment</title>');return;}const file=paths.get(req.url);if(!file){res.writeHead(404).end();return;}res.setHeader('Content-Type',req.url.endsWith('.json')?'application/json':'text/javascript');res.end(await readFile(file));}catch{res.writeHead(500).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`,errors=[];let browser,report;
try{
 const {chromium}=require('C:/Users/zagat/AppData/Roaming/npm/node_modules/rea-agents/node_modules/playwright-core');
 browser=await chromium.launch({headless:true,executablePath:'C:/Users/zagat/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe'});
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
 await page.addInitScript(()=>{navigator.mediaDevices&&(navigator.mediaDevices.getUserMedia=()=>Promise.reject(Error('No hardware in offline experiment')));navigator.requestMIDIAccess=()=>Promise.reject(Error('No MIDI in offline experiment'));});
 await page.goto(origin);
 const result=await page.evaluate(async()=>{
  const {compileFilterGearCandidate,compileToneFiltersCandidate,ToneFilterRackCandidate}=await import('/tone-filters-candidate.js');
  const catalog=(await(await fetch('/catalog.json')).json()).gears,rate=48000,frames=rate/3;
  const gear=(key,values={})=>{const d=catalog.find(g=>g.key===key);return{Key:key,KnobValues:Object.fromEntries(d.knobs.map(k=>[k.key,values[k.key.slice(key.length+1)]??k.min]))};};
  const plan=(key,values={})=>compileFilterGearCandidate(gear(key,values),catalog.find(g=>g.key===key),{sampleRate:rate});
  async function render(effects,{frequency=440,amplitude=.02}={}){
   const c=new OfflineAudioContext(1,frames,rate),source=c.createBufferSource(),input=c.createBuffer(1,frames,rate),samples=input.getChannelData(0);
   for(let i=0;i<frames;i++)samples[i]=amplitude*Math.sin(2*Math.PI*frequency*i/rate);
   source.buffer=input;const rack=new ToneFilterRackCandidate(c,{effects}),nodes=[...rack.nodes],disconnects=nodes.map(()=>0);
   nodes.forEach((n,i)=>{const original=n.disconnect.bind(n);n.disconnect=(...args)=>{disconnects[i]++;return original(...args);};});
   source.connect(rack.input);rack.connect(c.destination);source.start();const pcm=(await c.startRendering()).getChannelData(0);
   const rms=arr=>Math.sqrt(arr.subarray(frames/2).reduce((s,v)=>s+v*v,0)/(frames/2));
   const gain=rms(pcm)/rms(samples),peak=pcm.reduce((m,v)=>Math.max(m,Math.abs(v)),0),finite=pcm.every(Number.isFinite),maxError=pcm.reduce((m,v,i)=>Math.max(m,Math.abs(v-samples[i])),0),exact=pcm.every((v,i)=>v===samples[i]);
   rack.dispose();rack.dispose();return{gain,peak,finite,maxError,exact,nodeCount:nodes.length,disposed:rack.disposed&&rack.nodes.length===0&&disconnects.every(n=>n===1)};
  }
  const models=[],tone={GearList:{},unknown:{own:'retained'}},sourceBefore=[];
  for(const d of catalog.filter(d=>d.category==='Filter')){const built=plan(d.key);if(!built.effect)continue;const native={GearList:{PrePedal1:gear(d.key)},opaque:{own:[1,2,3]}};const before=JSON.stringify(native);const compiled=compileToneFiltersCandidate(native,catalog,{sampleRate:rate}),out=await render(compiled.effects);models.push({key:d.key,...out,sourceUnchanged:before===JSON.stringify(native)});sourceBefore.push(before);}
  const responses=[];
  for(const [key,freq,values] of [['Pedal_EQ5',750,{'750':12}],['Pedal_EQ8',800,{'800':12}],['Bass_Pedal_BassEQ8',460,{'460':12}],['Rack_StudioEQ',1000,{LoMid:12,LoMidFreq:1000}],['Rack_StudioGraphicEQ',1000,{Mid:12,MidFreq:1}]]){
   const d=catalog.find(g=>g.key===key),zero={};for(const k of d.knobs)if(k.unit?.toLowerCase()==='db')zero[k.key.slice(key.length+1)]=0;
   const flat=await render([plan(key,zero).effect],{frequency:freq}),boost=await render([plan(key,{...zero,...values}).effect],{frequency:freq});responses.push({key,flat,boost,boostRatio:boost.gain/flat.gain});
  }
  const wah=[];
  for(const key of ['Bass_Pedal_BassWah','Pedal_ModernWah','Pedal_UKWah','Pedal_USWah','Rack_StudioWahFilter']){const manual=plan(key,{Auto:0,Pedal:100}).effect,center=manual.bands[0].frequency,atCenter=await render([manual],{frequency:center}),offCenter=await render([manual],{frequency:center/8}),auto=plan(key,{Auto:1,Pedal:100}),bypass=await render(auto.effect?[auto.effect]:[]);wah.push({key,center,atCenter,offCenter,autoBypassed:auto.effect===null,bypass});}
  const lofi=async(values,frequency)=>render([plan('Pedal_LoFiFilter',values).effect],{frequency});
  const cuts={highOpen:await lofi({FilterType:1,Mix:1},8000),highCut:await lofi({FilterType:100,Mix:1},8000),lowOpen:await lofi({FilterType:1,Mix:1},100),lowCut:await lofi({FilterType:1,Mix:100},100)};
  const d=catalog.find(g=>g.key==='Pedal_EQ8'),positive=Object.fromEntries(d.knobs.map(k=>[k.key.slice(d.key.length+1),k.max]));
  const stacked=await render(Array.from({length:12},()=>plan(d.key,positive).effect),{frequency:800,amplitude:1});
  return{models,responses,wah,cuts,stacked,empty:await render([]),allSignalsOriginal:true,hardwareRequested:false};
 });
 assert.equal(result.models.length,11);for(const m of result.models){assert.equal(m.finite,true,m.key);assert.equal(m.disposed,true,m.key);assert.equal(m.sourceUnchanged,true,m.key);}
 for(const r of result.responses){assert.ok(r.flat.maxError<2e-7,`${r.key} flat error ${r.flat.maxError}`);assert.ok(r.boostRatio>3.8&&r.boostRatio<4.2,`${r.key} gain ratio ${r.boostRatio}`);}
 for(const w of result.wah){assert.ok(w.atCenter.gain>w.offCenter.gain*8,w.key);assert.equal(w.autoBypassed,true,w.key);assert.equal(w.bypass.exact,true,w.key);}
 assert.ok(result.cuts.highCut.gain<result.cuts.highOpen.gain*.1,'Hi Cut attenuates high frequency');assert.ok(result.cuts.lowCut.gain<result.cuts.lowOpen.gain*.02,'Lo Cut attenuates low frequency');
 assert.equal(result.stacked.nodeCount,110);assert.equal(result.stacked.finite,true);assert.ok(result.stacked.peak<.95,'full-frame bounded max stack');assert.equal(result.stacked.disposed,true);assert.equal(result.empty.exact,true);assert.deepEqual(errors,[]);
 report={ok:true,claim:'Original generic filter response only; no native/branded DSP fidelity or physical audio claim',...result,errors};
}catch(e){report={ok:false,error:e.stack,errors};process.exitCode=1;}finally{await mkdir(new URL('../verification/',import.meta.url),{recursive:true});await writeFile(new URL('../verification/browser-tone-filters-candidate.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser?.close();await new Promise(resolve=>server.close(resolve));}
