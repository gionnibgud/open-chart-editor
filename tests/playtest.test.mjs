import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAndPlaytest,endPlaytest,removePreview,getPreviews} from '../src/playtest.js';
const project=()=>({title:'Original preview',duration:8,audio:{url:'/api/plugins/open_chart_editor/audio/original'},arrangements:[{id:'guitar',type:'guitar'},{id:'bass',type:'bass'}]});
const canonicalDrums=['kick','snare','snare_xstick','hh_closed','hh_open','hh_pedal','tom_hi','tom_mid','tom_low','tom_floor','crash_l','crash_r','splash','china','stack','ride','ride_bell','bell'];
const drumProvider=(kit={lanes:canonicalDrums.map(piece=>({piece})),fallbacks:{}})=>({feedBackViz_drum_highway_3d:()=>({}),drumH3dGetAllPieces:()=>[...canonicalDrums],drumH3dGetKit:()=>structuredClone(kit)});
test('vocal-only request keeps current canonical source and uses native export flag with ordinary public playback arguments',async()=>{
 const p=project();p.vocals=[{id:'v0',time:1,length:.5,pitch:0,text:'Own'},{id:'v1',time:2,length:.5,pitch:127,text:'original+'}];p.arrangements[0].editorOnly=true;
 const before=structuredClone(p),m=mocks(),rendererFactories={feedBackViz_vocal_highway:()=>{}};
 const preview=await buildAndPlaytest(p,{...m,arrangementId:'guitar',vocalOnly:true,rendererFactories,startTime:1});
 const request=JSON.parse(m.calls[0].options.body);assert.equal(request.vocal_only,true);assert.deepEqual(request.project,p);assert.deepEqual(p,before);assert.equal(m.dispatches[0].args.arrangement,0);assert.equal(m.dispatches[0].args.startTime,1);assert.equal(Object.hasOwn(m.dispatches[0].args,'renderer'),false);
 await endPlaytest(preview,m);await removePreview(preview,m);
});
test('missing vocal renderer, unpitched-only or zero-duration charts fail before any writes',async()=>{
 const p=project(),m=mocks();p.vocals=[{id:'v',time:1,length:.5,pitch:60,text:'Own'}];
 await assert.rejects(buildAndPlaytest(p,{...m,vocalOnly:true,rendererFactories:{}}),/Vocal Highway/);assert.equal(m.calls.length,0);
 const rendererFactories={feedBackViz_vocal_highway:()=>{}};
 delete p.vocals[0].pitch;await assert.rejects(buildAndPlaytest(p,{...m,vocalOnly:true,rendererFactories}),/positive duration/);
 p.vocals[0].pitch=0;p.vocals[0].length=0;await assert.rejects(buildAndPlaytest(p,{...m,vocalOnly:true,rendererFactories}),/positive duration/);assert.equal(m.calls.length,0);
});
test('custom visible drum hits refuse native audition before writing; hidden custom levels do not block canonical current view',async()=>{
 const p=project(),a={id:'own-drums',type:'drums',notes:[{piece:'own-metal'}],chords:[]};p.arrangements=[a];const m=mocks(),rendererFactories=drumProvider();
 await assert.rejects(buildAndPlaytest(p,{...m,rendererFactories}),/skips custom kit IDs/);assert.equal(m.calls.length,0);
 a.notes=[];a.chords=[{notes:[{piece:'own-child'}]}];await assert.rejects(buildAndPlaytest(p,{...m,rendererFactories}),/custom kit IDs/);assert.equal(m.calls.length,0);
 a.notes=[{piece:'kick'}];a.chords=[];a.difficulties=[{difficulty:7,notes:[{piece:'own-hidden'}]}];a.activeDifficulty=0;
 const preview=await buildAndPlaytest(p,{...m,rendererFactories});await endPlaytest(preview,m);await removePreview(preview,m);
});
function mocks({saveOk=true,uploadStatus='ok',wrongFilename=false,startOutcome='handled',startStatus='playing',dispatchThrows=false,closeThrows=false}={}){
 const calls=[],dispatches=[];let closes=0,filename;
 const fetchImpl=async(url,options)=>{
  calls.push({url,options});
  if(url.endsWith('/save'))return saveOk?new Response(new Uint8Array([80,75,3,4,11,22])):new Response('Invalid project',{status:400});
  if(url==='/api/songs/upload'){const file=options.body.get('file');filename=file.name;return Response.json({results:[{status:uploadStatus,filename:wrongFilename?'unrelated-user-song.feedpak':filename}]});}
  if(options.method==='DELETE')return Response.json({status:'ok'});
  throw Error('Unexpected request');
 };
 const feedBack={capabilities:{dispatch:async request=>{dispatches.push(request);if(dispatchThrows)throw Error('Native load failed');return {outcome:startOutcome,status:startStatus,payload:{state:{sessionId:filename}}};}},closeCurrentSong:async()=>{closes++;if(closeThrows)throw Error('Native close failed');}};
 return {fetchImpl,feedBack,calls,dispatches,get closes(){return closes;}};
}
test('explicit build uploads a unique file then dispatches correct public arrangement/start shape',async()=>{
 const m=mocks(),source=project(),before=structuredClone(source),preview=await buildAndPlaytest(source,{arrangementId:'bass',startTime:1.25,...m});
 assert.deepEqual(source,before);assert.deepEqual(JSON.parse(m.calls[0].options.body).project.arrangements,[source.arrangements[1]]);assert.match(preview.filename,/^[a-f0-9-]{36}_oce\.feedpak$/);assert.equal(m.calls[1].url,'/api/songs/upload');assert.equal(m.calls[1].options.body.get('file').name,preview.filename);
 assert.deepEqual(m.dispatches[0],{capability:'playback',command:'start',source:'open_chart_editor',timeoutMs:30000,args:{requesterId:'open_chart_editor',authorization:'user-action',priority:'user',target:{filename:preview.filename},arrangement:0,startTime:1.25}});
 await assert.rejects(removePreview(preview,m),/End this playtest/);await endPlaytest(preview,m);await removePreview(preview,m);assert.equal(m.closes,1);assert.equal(m.calls.at(-1).options.method,'DELETE');assert.equal(m.calls.at(-1).url,`/api/song/${preview.filename}`);
});
test('missing audio/host and failed save never upload or dispatch',async()=>{
 const m=mocks(),silent=project();delete silent.audio;
 await assert.rejects(buildAndPlaytest(silent,m),/Attach your own/);assert.equal(m.calls.length,0);
 silent.audio={url:'https://example.invalid/not-an-attached-source.wav'};await assert.rejects(buildAndPlaytest(silent,m),/Attach your own/);assert.equal(m.calls.length,0);
 await assert.rejects(buildAndPlaytest(project(),{feedBack:{},fetchImpl:m.fetchImpl}),/host/);assert.equal(m.calls.length,0);
 const broken=mocks({saveOk:false});await assert.rejects(buildAndPlaytest(project(),broken),/build the local preview/);assert.equal(broken.calls.length,1);assert.equal(broken.dispatches.length,0);
});
test('scratch tracks cannot play and do not shift exported arrangement indexes',async()=>{
 const p=project(),m=mocks();p.arrangements.unshift({id:'scratch',type:'guitar',editorOnly:true});await assert.rejects(buildAndPlaytest(p,{arrangementId:'scratch',...m}),/Scratch tracks/);assert.equal(m.calls.length,0);
 const preview=await buildAndPlaytest(p,{arrangementId:'bass',...m});assert.equal(m.dispatches[0].args.arrangement,0);await endPlaytest(preview,m);await removePreview(preview,m);
});
test('upload conflicts and mismatched response filename never claim or delete user files',async()=>{
 const before=getPreviews().length;
 for(const options of [{uploadStatus:'exists'},{wrongFilename:true}]){const m=mocks(options);await assert.rejects(buildAndPlaytest(project(),m),/upload was not confirmed/);assert.equal(m.dispatches.length,0);assert.equal(m.calls.length,2);assert.equal(getPreviews().length,before);}
 const m=mocks();await assert.rejects(removePreview({filename:'user-song.feedpak',token:'invented'},m),/not created/);assert.equal(m.calls.length,0);
});
test('failed native start retains only its own handle for explicit end and cleanup',async()=>{
 for(const options of [{startOutcome:'denied',startStatus:'blocked'},{dispatchThrows:true}]){
  const m=mocks(options);let preview;await assert.rejects(async()=>{try{await buildAndPlaytest(project(),m);}catch(error){preview=error.preview;throw error;}});
  assert.ok(preview);assert.equal(preview.status,'failed');assert.equal(m.calls.length,2);assert.equal(m.closes,0);await assert.rejects(removePreview(preview,m),/End/);await endPlaytest(preview,m);await removePreview(preview,m);
 }
});
test('UUID uploads never overwrite and ownership survives filename spoof attempts',async()=>{
 const a=mocks(),b=mocks(),first=await buildAndPlaytest(project(),a),second=await buildAndPlaytest(project(),b);
 assert.notEqual(first.filename,second.filename);assert.ok([a,b].every(m=>m.calls[1].url==='/api/songs/upload'));assert.equal(first.ended,true);
 await assert.rejects(removePreview({...first,filename:'another-song.feedpak'},a),/not created/);await removePreview(first,a);assert.equal(a.closes,0);
 await endPlaytest(second,b);await removePreview(second,b);await assert.rejects(removePreview(second,b),/not created/);
});
test('failed close does not permit deletion and superseded native session is not closed',async()=>{
 const m=mocks({closeThrows:true}),preview=await buildAndPlaytest(project(),m);await assert.rejects(endPlaytest(preview,m),/Native close failed/);await assert.rejects(removePreview(preview,m),/End/);
 m.feedBack.playback={snapshot:()=>({state:{sessionId:'unrelated-new-session'}})};await endPlaytest(preview,m);assert.equal(m.closes,1);assert.equal(preview.status,'superseded');await removePreview(preview,m);
});

test('mixed drums never contaminate pitched renderer routing or arrangement index',async()=>{
 const source=project();source.arrangements.splice(1,0,{id:'kit',type:'drums'});source.arrangements.push({id:'keys',type:'keys'});source._pack={manifest:{arrangements:[{id:'opaque',type:'drums'}],drum_tab:'old-drums.json',drum_tones:{base:'kit'},vocal_pitch:'pitch.json',lyrics:'lyrics.json',stems:[{id:'full',file:'full.wav'}]},entries:{'full.wav':'original-base64','old-drums.json':'opaque-drum-bytes'}};source.vocals=[{time:0,length:1,text:'Original',pitch:60}];const before=structuredClone(source),m=mocks();
 const preview=await buildAndPlaytest(source,{arrangementId:'bass',...m});const written=JSON.parse(m.calls[0].options.body).project;
 assert.deepEqual(written.arrangements,[source.arrangements.find(a=>a.id==='bass')]);assert.equal(m.dispatches[0].args.arrangement,0);assert.deepEqual(written._pack.manifest.arrangements,[]);assert.equal('drum_tab' in written._pack.manifest,false);assert.equal('vocal_pitch' in written._pack.manifest,false);assert.equal('lyrics' in written._pack.manifest,false);assert.equal('vocals' in written,false);assert.deepEqual(written._pack.manifest.stems,source._pack.manifest.stems);assert.deepEqual(written._pack.entries,source._pack.entries);assert.deepEqual(source,before);
 await endPlaytest(preview,m);await removePreview(preview,m);
});
test('piano and drum playtests require their actual renderer factory before any writes',async()=>{
 for(const [type,name]of [['keys','piano'],['drums','drums']]){
  const source=project(),m=mocks();source.arrangements.push({id:'selected',type,_entry:type==='drums'?{_songLevel:true,drum_tab:'kit.json'}:{}});source._pack={manifest:{drum_tab:'unrelated.json',drum_tones:{base:'Original kit'},arrangements:[],stems:[]},entries:{}};const before=structuredClone(source);
  await assert.rejects(buildAndPlaytest(source,{arrangementId:'selected',rendererFactories:{},...m}),new RegExp(`Enable the FeedBack ${name}`));assert.equal(m.calls.length,0);
  const preview=await buildAndPlaytest(source,{arrangementId:'selected',rendererFactories:{[`feedBackViz_${name}`]:()=>({})},...m});const written=JSON.parse(m.calls[0].options.body).project;assert.equal(written.arrangements.length,1);assert.equal(written.arrangements[0].type,type);assert.equal(m.dispatches[0].args.arrangement,0);assert.equal('drum_tab' in written._pack.manifest,false);if(type==='drums')assert.deepEqual(written._pack.manifest.drum_tones,{base:'Original kit'});else assert.equal('drum_tones' in written._pack.manifest,false);assert.deepEqual(source,before);await endPlaytest(preview,m);await removePreview(preview,m);
 }
});
test('bundled Drum Highway 3D consumes native drum previews while notation-only Keys3D is not a full-range wire fallback',async()=>{
 const source=project(),m=mocks();source.arrangements.push({id:'native-kit',type:'drums'});
 const preview=await buildAndPlaytest(source,{arrangementId:'native-kit',rendererFactories:drumProvider(),...m});
 assert.equal(JSON.parse(m.calls[0].options.body).project.arrangements[0].type,'drums');assert.equal(m.dispatches[0].args.arrangement,0);
 await endPlaytest(preview,m);await removePreview(preview,m);
 source.arrangements.push({id:'full-range-keys',type:'keys'});const unavailable=mocks();
 await assert.rejects(buildAndPlaytest(source,{arrangementId:'full-range-keys',rendererFactories:{feedBackViz_keys_highway_3d:()=>({})},...unavailable}),/Enable the FeedBack piano/);
 assert.equal(unavailable.calls.length,0);
 const blocked=mocks(),factory=()=>({});factory.contextType='webgl2';
 await assert.rejects(buildAndPlaytest(source,{arrangementId:'native-kit',rendererFactories:{feedBackViz_drum_highway_3d:factory,document:{createElement:()=>({getContext:()=>null})}},...blocked}),/WebGL2/);assert.equal(blocked.calls.length,0);
});
test('audition prunes imported notation pointers so edited wire charts do not auto-route to stale Keys3D notation',async()=>{
 const source=project(),m=mocks();source.arrangements.push({id:'edited-keys',name:'Piano',type:'keys',notes:[{id:'n',pitch:127,time:1}],_entry:{id:'edited-keys',file:'keys.json',notation:'original-score.json',future:'preserved'}});
 source._pack={manifest:{arrangements:[source.arrangements.at(-1)._entry],stems:[]},entries:{'original-score.json':'opaque-original-notation'}};const before=structuredClone(source);
 const preview=await buildAndPlaytest(source,{arrangementId:'edited-keys',rendererFactories:{feedBackViz_piano:()=>({})},...m});
 const written=JSON.parse(m.calls[0].options.body).project;assert.equal('notation'in written.arrangements[0]._entry,false);assert.equal(written.arrangements[0]._entry.future,'preserved');assert.equal(written._pack.entries['original-score.json'],'opaque-original-notation');assert.deepEqual(source,before);
 await endPlaytest(preview,m);await removePreview(preview,m);
});

function loopMocks(){
 const m=mocks(),loops=[];let session=null;
 const dispatch=m.feedBack.capabilities.dispatch;
 m.feedBack.capabilities.dispatch=async request=>{const result=await dispatch(request);session=result.payload.state.sessionId;return result;};
 m.feedBack.playback={snapshot:()=>({state:{sessionId:session}})};
 m.feedBack.setLoop=async(a,b,options)=>{loops.push({a,b,options});return options.commitGuard();};
 return {...m,loops,setSession:value=>session=value};
}
test('loop playtest starts at A and applies the public loop only after the ready session identity matches',async()=>{
 const m=loopMocks(),source=project(),before=structuredClone(source),preview=await buildAndPlaytest(source,{loopRegion:{start:1,end:2.25},...m});
 assert.equal(m.dispatches[0].args.startTime,1);assert.equal(m.loops.length,1);assert.equal(m.loops[0].a,1);assert.equal(m.loops[0].b,2.25);assert.equal(m.loops[0].options.commitGuard(),true);assert.deepEqual(preview.loop,{start:1,end:2.25});assert.deepEqual(source,before);
 await endPlaytest(preview,m);assert.equal(m.loops[0].options.commitGuard(),false);await removePreview(preview,m);
});
test('invalid or unsupported loop playtests refuse before creating a library file',async()=>{
 for(const loopRegion of [{start:-1,end:2},{start:2,end:2},{start:1,end:9},{start:NaN,end:2}]){const m=loopMocks();await assert.rejects(buildAndPlaytest(project(),{loopRegion,...m}),/loop within/);assert.equal(m.calls.length,0);}
 const m=mocks();await assert.rejects(buildAndPlaytest(project(),{loopRegion:{start:1,end:2},...m}),/guarded public loop/);assert.equal(m.calls.length,0);
});
test('superseded native session cannot receive even the initial loop seek or be closed for preview cleanup',async()=>{
 const m=loopMocks(),dispatch=m.feedBack.capabilities.dispatch;m.feedBack.capabilities.dispatch=async request=>{const result=await dispatch(request);m.setSession('unrelated-user-song');return result;};
 let preview;await assert.rejects(async()=>{try{await buildAndPlaytest(project(),{loopRegion:{start:1,end:2},...m});}catch(error){preview=error.preview;throw error;}},/superseded/);
 assert.equal(m.loops.length,0);assert.equal(preview.ended,true);await endPlaytest(preview,m);await removePreview(preview,m);assert.equal(m.closes,0);
});
test('loop commit guard detects project replacement during the asynchronous host seek',async()=>{
 const m=loopMocks();let valid=true,guard;
 m.feedBack.setLoop=async(a,b,options)=>{guard=options.commitGuard;assert.equal(guard(),true);valid=false;assert.equal(guard(),false);return false;};
 let preview;await assert.rejects(async()=>{try{await buildAndPlaytest(project(),{loopRegion:{start:1,end:2},isCurrent:()=>valid,...m});}catch(error){preview=error.preview;throw error;}},/not applied/);
 assert.equal(preview.status,'loop-failed');assert.equal(preview.loop,null);await endPlaytest(preview,m);await removePreview(preview,m);
});
test('project edits before preview upload cancel without a native start or a library write',async()=>{
 const m=mocks(),fetchImpl=m.fetchImpl;let valid=true;
 m.fetchImpl=async(...args)=>{const result=await fetchImpl(...args);valid=false;return result;};
 await assert.rejects(buildAndPlaytest(project(),{isCurrent:()=>valid,...m}),{name:'AbortError'});assert.equal(m.calls.length,1);assert.equal(m.dispatches.length,0);
});
test('selected playtest isolates current working difficulty while ordinary authoring levels remain exact',async()=>{
 for(const type of ['guitar','keys','drums']){
  const source=project(),arr=source.arrangements[0];Object.assign(arr,{type,notes:[{id:'low-edited',time:1,fret:3,pitch:60,piece:'snare',velocity:45}],chords:[],anchors:[],handshapes:[],activeDifficulty:2,difficulties:[{difficulty:2,notes:[{id:'old-low',time:1}]},{difficulty:9,notes:[{id:'high-only',time:2}]}],_wire:{phrases:[{start_time:0,end_time:8,levels:[{difficulty:9,notes:[{id:'old-high'}]}]}]}});
  const before=structuredClone(source),m=mocks(),rendererFactories={feedBackViz_piano:()=>({}),feedBackViz_drums:()=>({})};const preview=await buildAndPlaytest(source,{arrangementId:'guitar',rendererFactories,...m});
  const written=JSON.parse(m.calls[0].options.body).project.arrangements[0];assert.equal(written.activeDifficulty,0);assert.equal(written.difficulties.length,1);assert.deepEqual(written.difficulties[0].notes,arr.notes);assert.deepEqual(source,before);await endPlaytest(preview,m);await removePreview(preview,m);
 }
});

test('Drum3D old16 vocabulary refuses stack/bell; reviewed18 explicit defaults pass unchanged',async()=>{
 const p=project();p.arrangements=[{id:'kit',type:'drums',notes:[{piece:'stack'}],chords:[{notes:[{piece:'bell'}]}]}];const before=structuredClone(p),kit={lanes:[{piece:'crash_l'},{piece:'ride'}],fallbacks:{stack:'crash_l',bell:'ride'}},kb=structuredClone(kit);
 const old={...drumProvider(kit),drumH3dGetAllPieces:()=>canonicalDrums.filter(p=>!['stack','bell'].includes(p))},m=mocks();await assert.rejects(buildAndPlaytest(p,{...m,rendererFactories:old}),/assign.*reset/);assert.equal(m.calls.length,0);
 const preview=await buildAndPlaytest(p,{...m,rendererFactories:drumProvider(kit)});assert.deepEqual(p,before);assert.deepEqual(kit,kb);await endPlaytest(preview,m);await removePreview(preview,m);
});
test('Drum3D saved omissions and inherited/chained fallbacks refuse before requests even with legacy factory',async()=>{
 for(const fallback of [{},{stack:'bell',bell:'ride'},Object.create({stack:'ride'})]){
  const p=project();p.arrangements=[{id:'kit',type:'drums',notes:[{piece:'stack'}]}];const before=structuredClone(p),m=mocks(),provider={...drumProvider(),feedBackViz_drums:()=>({}),drumH3dGetKit:()=>({lanes:[{piece:'ride'}],fallbacks:fallback})};await assert.rejects(buildAndPlaytest(p,{...m,rendererFactories:provider}),/assign.*reset/);assert.equal(m.calls.length,0);assert.deepEqual(p,before);
 }
});
test('Drum3D missing malformed oversized and throwing public getters fail before any writes',async()=>{
 const p=project();p.arrangements=[{id:'kit',type:'drums',notes:[{piece:'kick'}]}];const cases=[{drumH3dGetKit:undefined},{drumH3dGetAllPieces:()=>{throw Error('Own getter failure');}},{drumH3dGetAllPieces:()=>Array(1025).fill('kick')},{drumH3dGetAllPieces:()=>['kick',,'ride']},{drumH3dGetKit:()=>({lanes:Array(1025).fill({piece:'kick'}),fallbacks:{}})},{drumH3dGetKit:()=>({lanes:[{piece:'kick'}],fallbacks:Object.fromEntries(Array.from({length:1025},(_,i)=>['own'+i,'kick']))})},{drumH3dGetKit:()=>null},{drumH3dGetKit:()=>({lanes:[{piece:'kick'}],fallbacks:[]})}];
 for(const change of cases){const m=mocks();await assert.rejects(buildAndPlaytest(p,{...m,rendererFactories:{...drumProvider(),...change}}),/assign.*reset/);assert.equal(m.calls.length,0);}
});
test('Drum3D only checks visible pieces; empty chart needs no getters and legacy2D remains explicitly unverified',async()=>{
 for(const [notes,provider]of [[[],{feedBackViz_drum_highway_3d:()=>({})}],[[{piece:'stack'}],{feedBackViz_drums:()=>({})}],[[{piece:'kick'}],drumProvider({lanes:[{piece:'kick'}],fallbacks:{}})]]){
  const p=project();p.arrangements=[{id:'kit',type:'drums',notes,difficulties:[{difficulty:7,notes:[{piece:'bell'},{piece:'own-hidden'}]}]}];const before=structuredClone(p),m=mocks(),preview=await buildAndPlaytest(p,{...m,rendererFactories:provider});assert.deepEqual(p,before);await endPlaytest(preview,m);await removePreview(preview,m);
 }
});
