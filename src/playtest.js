// Original explicit local-library playtest workflow. No work runs on import.
import {drumPiece} from './drum-guide.js';
const SAVE='/api/plugins/open_chart_editor/save',UPLOAD='/api/songs/upload';
const previews=new Map();let activePreview=null,buildGeneration=0;
const filenamePattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_oce\.feedpak$/i;
const hostDefault=()=>globalThis.window?.feedBack??globalThis.feedBack;
const fetchDefault=(...args)=>globalThis.fetch(...args);
const uuid=()=>{if(!globalThis.crypto?.randomUUID)throw Error('A secure UUID generator is required for local preview builds');return globalThis.crypto.randomUUID();};
async function failure(response,label){let reason='';try{reason=await response.text();try{const data=JSON.parse(reason);reason=data.detail??data.error??reason;}catch{}}catch{}return Error(`${label}${reason?`: ${typeof reason==='string'?reason:JSON.stringify(reason)}`:` (HTTP ${response.status})`}`);}
function hasAudio(project){
 if(typeof project?.audio?.url==='string'&&project.audio.url.startsWith('/api/plugins/open_chart_editor/audio/'))return true;
 const pack=project?._pack,stem=pack?.manifest?.stems?.find(item=>item.id==='full');
 return !!(stem?.file&&typeof pack.entries?.[stem.file]==='string'&&pack.entries[stem.file].length);
}
function remember(filename,arrangementIndex,feedBack){
 const token=uuid(),record={filename,token,arrangementIndex,feedBack,status:'uploaded',ended:false,removed:false,result:null,sessionId:null};
 const handle=Object.freeze({filename,token,arrangementIndex,get status(){return record.status;},get ended(){return record.ended;},get result(){return record.result;},get loop(){return record.loop??null;}});record.handle=handle;previews.set(token,record);return record;
}
function owned(preview){
 const record=previews.get(preview?.token);
 if(!record||record.handle!==preview||preview.filename!==record.filename||!filenamePattern.test(record.filename)||record.removed)throw Error('This preview was not created by this editor session');
 return record;
}
export const getPreviews=()=>[...previews.values()].filter(record=>!record.removed).map(record=>record.handle);

// Build a selected-only audition archive: the host omits drum pointers from
// pitched arrangement indexes, and song-level drum metadata affects Auto routing.
// Unreferenced embedded assets remain available to the writer; authored data is
// never mutated and no source archive member is deleted here.
export function playtestProject(project,arrangement) {
 // Retained imported notation may describe an older edit and selects Keys3D.
 // This audition follows the current editable wire chart; source notation and
 // ordinary full-pack export remain intact in the authored project.
 const authoredLevels=!!arrangement.difficulties?.length||!!arrangement._wire?.phrases?.length;
 const selected=arrangement._entry?.notation||authoredLevels?{...arrangement,...(arrangement._entry?{_entry:{...arrangement._entry}}:{})}:arrangement;
 if(selected._entry?.notation)delete selected._entry.notation;
 if(authoredLevels){
  // Audition exactly the visible working chart. Ordinary Save As keeps every
  // authored level and native playback defaults to its highest level. This
  // temporary selected-only pack intentionally has one playable level instead.
  selected.difficulties=[{difficulty:0,...Object.fromEntries(['notes','chords','anchors','handshapes'].map(key=>[key,arrangement[key]||[]]))}];
  selected.activeDifficulty=0;
 }
 const preview={...project,arrangements:[selected]};
 for(const key of ['vocals','_vocalsOriginal'])delete preview[key];
 if(project._pack){
  const manifest={...project._pack.manifest,arrangements:[]};
  for(const key of ['drum_tab','vocal_pitch','lyrics','lyric_transcription','lyrics_source','pitch_extraction'])delete manifest[key];
  if(arrangement.type!=='drums'||!arrangement._entry?._songLevel)delete manifest.drum_tones;
  preview._pack={...project._pack,manifest};
 }
 return preview;
}
// Public Drum3D kit metadata proves mapping; canonical vocabulary alone does
// not guarantee an active saved kit displays a piece. No user kit is changed.
function requireDrum3DMapping(pieces,factories){
 if(!pieces.size)return;
 const fail=detail=>Error('Drum Highway 3D cannot display this visible chart ('+detail+'). Update/enable Drum Highway 3D and assign the missing pieces in its kit settings, or explicitly reset the kit. Use the editor guide meanwhile. No kit settings were changed');
 try{
  if(typeof factories?.drumH3dGetAllPieces!=='function'||typeof factories?.drumH3dGetKit!=='function')throw fail('kit mapping unavailable');
  const all=factories.drumH3dGetAllPieces(),kit=factories.drumH3dGetKit();
  const id=value=>typeof value==='string'&&value.length>0&&value.length<=128;
  if(!Array.isArray(all)||all.length>1024||!all.length||!Array.from(all).every(id)||new Set(all).size!==all.length)throw fail('malformed piece vocabulary');
  const known=new Set(all);
  if(!kit||typeof kit!=='object'||Array.isArray(kit)||!Array.isArray(kit.lanes)||kit.lanes.length>1024||!kit.lanes.length)throw fail('malformed kit lanes');
  const lanes=new Set();for(const lane of kit.lanes){if(!lane||typeof lane!=='object'||!Object.hasOwn(lane,'piece')||!id(lane.piece)||!known.has(lane.piece)||lanes.has(lane.piece))throw fail('malformed kit lane');lanes.add(lane.piece);}
  const fallbacks=kit.fallbacks;
  if(!fallbacks||typeof fallbacks!=='object'||Array.isArray(fallbacks)||Object.keys(fallbacks).length>1024)throw fail('malformed fallback record');
  for(const from of Object.keys(fallbacks))if(!known.has(from)||!id(fallbacks[from])||!known.has(fallbacks[from]))throw fail('malformed fallback mapping');
  for(const piece of pieces)if(!known.has(piece)||(!lanes.has(piece)&&!(Object.hasOwn(fallbacks,piece)&&lanes.has(fallbacks[piece]))))throw fail('unmapped piece '+piece);
 }catch(error){if(error instanceof Error&&error.message.startsWith('Drum Highway 3D cannot display'))throw error;throw fail('kit mapping could not be read');}
}
function requireRenderer(arrangement,factories) {
 const name=arrangement.type==='keys'?'piano':arrangement.type==='drums'?'drums':null,pieces=new Set();
 if(name==='drums'){
  const custom=new Set();
  for(const note of [...arrangement.notes||[],...(arrangement.chords||[]).flatMap(chord=>chord.notes||[])]){
   const piece=note.piece??note.p;pieces.add(piece);if(drumPiece(piece)!==piece)custom.add(piece);
  }
  if(custom.size)throw Error('The current FeedBack drum highway skips custom kit IDs. Audition these hits with the editor guide or save a Feedpak that preserves them; native playtest is unavailable for this visible chart');
 }
 let drum3D=name==='drums'&&typeof factories?.feedBackViz_drum_highway_3d==='function';
 if(drum3D&&factories.feedBackViz_drum_highway_3d.contextType==='webgl2'&&factories.document?.createElement){
  try{const canvas=factories.document.createElement('canvas'),context=canvas.getContext('webgl2');drum3D=!!context;context?.getExtension('WEBGL_lose_context')?.loseContext();}catch{drum3D=false;}
 }
 if(drum3D)requireDrum3DMapping(pieces,factories);
 // Legacy 2D-only rendering retains its prior contract; its active kit mapping
 // is not verified by these Drum3D-specific public getters.
 const available=name&&(typeof factories?.[`feedBackViz_${name}`]==='function'||drum3D);
 // Keys3D requires written-notation sidecars and currently renders MIDI21..108;
 // it cannot consume this editor's full-range performed wire chart on its own.
 if(name&&!available)throw Error(`Enable the FeedBack ${name} visualization plugin${name==='drums'?' or Drum Highway 3D with WebGL2':''} before playtesting this arrangement; it is not available in the current host`);
}

export async function buildAndPlaytest(project,{arrangementId=null,vocalOnly=false,startTime=0,loopRegion=null,isCurrent=()=>true,fetchImpl=fetchDefault,feedBack=hostDefault(),rendererFactories=globalThis.window??globalThis}={}){
 if(typeof feedBack?.capabilities?.dispatch!=='function'||typeof feedBack?.closeCurrentSong!=='function')throw Error('Build and playtest requires the FeedBack host playback interface');
 if(!Array.isArray(project?.arrangements)||!project.arrangements.length)throw Error('Choose an arrangement before playtesting');
 const playable=project.arrangements.filter(arrangement=>!arrangement.editorOnly&&!arrangement.hidden);
 if(!vocalOnly&&arrangementId!=null&&project.arrangements.some(arrangement=>arrangement.id===arrangementId&&arrangement.hidden))throw Error('This arrangement is hidden; unhide it to playtest it');
 if(!vocalOnly&&arrangementId!=null&&project.arrangements.some(arrangement=>arrangement.id===arrangementId&&arrangement.editorOnly))throw Error('Scratch tracks are excluded from playable builds; select a main arrangement');
 const selectedIndex=arrangementId==null?0:playable.findIndex(arrangement=>arrangement.id===arrangementId);
 if(!vocalOnly&&!playable.length)throw Error('Add a main arrangement before playtesting');
 if(!vocalOnly&&selectedIndex<0)throw Error('The selected playtest arrangement does not exist');
 const selected=playable[selectedIndex],arrangementIndex=0;
 if(vocalOnly){
  if(typeof rendererFactories?.feedBackViz_vocal_highway!=='function')throw Error('Enable the reviewed Vocal Highway visualization before vocal playtest; no native vocal renderer is available in this host');
  if(!project.vocals?.some(v=>Number.isInteger(v.pitch)&&v.pitch>=0&&v.pitch<=127&&Number.isFinite(v.length)&&v.length>0))throw Error('Vocal Highway preview requires a pitched vocal event with positive duration; lyric-only and zero-duration events remain editable and exportable');
 }else requireRenderer(selected,rendererFactories);
 const previewProject=vocalOnly?project:playtestProject(project,selected);
 if(!Number.isFinite(startTime)||startTime<0)throw Error('Playtest start time must be nonnegative seconds');
 if(typeof isCurrent!=='function')throw Error('Playtest needs a current-project guard');
 const requestedLoop=loopRegion===null?null:{start:loopRegion?.start,end:loopRegion?.end};
 if(requestedLoop){
  if(!Number.isFinite(project.duration)||!Number.isFinite(requestedLoop.start)||!Number.isFinite(requestedLoop.end)||requestedLoop.start<0||requestedLoop.end<=requestedLoop.start||requestedLoop.end>project.duration)throw Error('Choose a playtest loop within the song, with end after start');
  if(typeof feedBack.setLoop!=='function'||typeof feedBack.playback?.snapshot!=='function')throw Error('This FeedBack host does not provide guarded public loop playback');
  startTime=requestedLoop.start;
 }
 if(!hasAudio(project))throw Error('Attach your own song audio or render original practice audio before playtesting');
 const generation=++buildGeneration,current=(phase='building')=>generation===buildGeneration&&isCurrent(phase);
 const assertCurrent=phase=>{if(!current(phase))throw Object.assign(Error('Playtest build cancelled because the editor or project changed'),{name:'AbortError'});};
 assertCurrent();
 const filename=`${uuid()}_oce.feedpak`;
 const save=await fetchImpl(SAVE,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({project:previewProject,format:'feedpak',...(vocalOnly?{vocal_only:true}:{})})});
 if(!save.ok)throw await failure(save,'Could not build the local preview');
 const blob=await save.blob(),signature=new Uint8Array(await blob.slice(0,4).arrayBuffer());
 if(signature.length<4||signature[0]!==0x50||signature[1]!==0x4b||signature[2]!==3||signature[3]!==4)throw Error('Preview builder did not return a Feedpak ZIP archive');
 assertCurrent();
 const form=new FormData();form.append('file',blob,filename);
 // Never overwrite a song. A UUID collision is a conflict, not permission to
 // replace anything already present in the configured local library.
 const upload=await fetchImpl(UPLOAD,{method:'POST',credentials:'same-origin',body:form});
 if(!upload.ok)throw await failure(upload,'Could not add the preview to the local library');
 const report=await upload.json(),results=report.results;
 if(!Array.isArray(results)||results.length!==1||results[0]?.status!=='ok'||results[0]?.filename!==filename)throw Error(`Local preview upload was not confirmed${results?.[0]?.error?`: ${results[0].error}`:''}`);
 const record=remember(filename,arrangementIndex,feedBack);
 try{
  if(!current()){record.ended=true;record.status='cancelled';assertCurrent();}
  const result=await feedBack.capabilities.dispatch({capability:'playback',command:'start',source:'open_chart_editor',timeoutMs:30000,args:{requesterId:'open_chart_editor',authorization:'user-action',priority:'user',target:{filename},arrangement:arrangementIndex,startTime}});
  record.result=result;record.sessionId=result?.payload?.state?.sessionId??null;
  if(result?.outcome!=='handled'||!['playing','ready','handled','applied'].includes(result?.status??'handled'))throw Error(`FeedBack did not start the preview: ${result?.reason||result?.status||result?.outcome||'no playback result'}`);
  const nativeSession=typeof feedBack.playback?.snapshot==='function'?feedBack.playback.snapshot()?.state?.sessionId:null;
  if(nativeSession&&record.sessionId&&nativeSession!==record.sessionId){record.ended=true;record.status='superseded';throw Error('Another playback session superseded this preview');}
  assertCurrent('started');
  if(activePreview&&activePreview!==record){activePreview.ended=true;activePreview.status='superseded';}
  activePreview=record;record.status='playing';
  if(requestedLoop){
   // Start with finite startTime awaits the host's song:ready and seek. Recheck
   // its public session identity BEFORE setLoop can seek, and again just before
   // that async operation commits the canonical loop. No private globals.
   const ownSession=()=>current('started')&&!record.ended&&!record.ending&&!!record.sessionId&&feedBack.playback.snapshot()?.state?.sessionId===record.sessionId;
   if(!ownSession())throw Error('The preview was superseded before its loop could start');
   const applied=await feedBack.setLoop(requestedLoop.start,requestedLoop.end,{reason:'open-chart-editor-playtest',commitGuard:ownSession});
   if(applied!==true||!ownSession())throw Error('The playtest loop was not applied; the host or project changed');
   record.loop=Object.freeze({...requestedLoop});
  }
  return record.handle;
 }catch(error){if(record.status==='playing')record.status='loop-failed';else if(!['cancelled','superseded'].includes(record.status))record.status='failed';error.preview=record.handle;throw error;}
}

export async function endPlaytest(preview,{feedBack=null}={}){
 const record=owned(preview);if(record.ended)return preview;
 const host=feedBack??record.feedBack;
 if(typeof host?.closeCurrentSong!=='function')throw Error('FeedBack cannot close the current playtest');
 // A newer native session may have superseded this preview independently of
 // this module. Its public session identity lets us avoid closing that song.
 const current=typeof host.playback?.snapshot==='function'?host.playback.snapshot()?.state:null;
 if(record.sessionId&&current?.sessionId&&record.sessionId!==current.sessionId){record.ended=true;record.status='superseded';if(activePreview===record)activePreview=null;return preview;}
 record.ending=true;
 try{await host.closeCurrentSong();}catch(error){record.ending=false;throw error;}
 record.ended=true;record.ending=false;record.status='ended';if(activePreview===record)activePreview=null;return preview;
}

export async function removePreview(preview,{fetchImpl=fetchDefault}={}){
 const record=owned(preview);if(!record.ended)throw Error('End this playtest before removing its local preview build');
 const response=await fetchImpl(`/api/song/${encodeURIComponent(record.filename)}`,{method:'DELETE',credentials:'same-origin'});
 if(!response.ok)throw await failure(response,'Could not remove the local preview');
 record.removed=true;record.status='removed';previews.delete(record.token);return {filename:record.filename,removed:true};
}
