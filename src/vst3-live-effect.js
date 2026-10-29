export const AT5_FRAME_COUNT=1024;
export const AT5_FRAME_COUNTS=[256,512,AT5_FRAME_COUNT];
const AT5_WORKLET_PROTOCOL_VERSION=2;
const prepared=new WeakMap();
const MAX_SOCKET_BACKLOG=256*1024;

export async function prepareAt5Worklet(context){
 if(!context?.audioWorklet?.addModule)throw Error('AT5 live preview requires AudioWorklet support');
 let promise=prepared.get(context);
 if(!promise){
  const moduleUrl=new URL('./vst3-live-worklet.js',import.meta.url);
  moduleUrl.searchParams.set('protocol',String(AT5_WORKLET_PROTOCOL_VERSION));
  promise=context.audioWorklet.addModule(moduleUrl);
  prepared.set(context,promise);
 }
 await promise;
}

function abortError(){
 return new DOMException('AT5 live preview was cancelled','AbortError');
}

function websocketUrl(sampleRate){
 const url=new URL('/api/plugins/open_chart_editor/at5/live',globalThis.location.href);
 url.protocol=url.protocol==='https:'?'wss:':'ws:';
 url.searchParams.set('sample_rate',String(sampleRate));
 return url;
}

function tonePayload(tone,name){
 const gear=tone?.GearList||tone?.gear||tone?.toneData?.GearList;
 return {
  key:tone?.Key||tone?.id||name,
  name:tone?.Name||tone?.name||name,
  gear:gear&&typeof gear==='object'?gear:null
 };
}

export async function createAt5LiveEffect(context,{tone,toneName='',tier='max',frameCount=AT5_FRAME_COUNT,signal,onFailure=()=>{},onStatus=()=>{},onToneStatus=()=>{}}={}){
 if(!AT5_FRAME_COUNTS.includes(frameCount))throw Error('The selected AT5 audio block size is unsupported');
 await prepareAt5Worklet(context);
 if(signal?.aborted)throw abortError();
 const initialTone=tonePayload(tone,toneName);
 if(!initialTone.gear?.Amp?.Key)throw Error(`Rocksmith tone "${initialTone.name}" has no amplifier GearList to convert`);
 const node=new AudioWorkletNode(context,'oce-at5-live-v1',{
  numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],
  channelCount:1,channelCountMode:'explicit',channelInterpretation:'speakers',
  processorOptions:{frameCount}
 });
 const socket=new WebSocket(websocketUrl(context.sampleRate));
 socket.binaryType='arraybuffer';
 let disposed=false,ready=false,timeoutId=null,resolveReady,rejectReady;
 let toneSignature=JSON.stringify({tone:initialTone,tier});
 const readyPromise=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
 const fail=error=>{
  if(disposed)return;
  const message=error instanceof Error?error.message:String(error);
  if(!ready){rejectReady(Error(message));return;}
  onFailure(message);
 };
 const onAbort=()=>{if(!ready)rejectReady(abortError());dispose();};
 const dispose=()=>{
  if(disposed)return;disposed=true;
  clearTimeout(timeoutId);signal?.removeEventListener('abort',onAbort);
  node.port.onmessage=null;node.port.postMessage({type:'reset'});node.disconnect();
  if(socket.readyState===WebSocket.OPEN||socket.readyState===WebSocket.CONNECTING)socket.close(1000,'Monitor stopped');
 };
 signal?.addEventListener('abort',onAbort,{once:true});
 node.port.onmessage=event=>{
  const message=event.data;
  if(message?.type==='input'){
   if(socket.readyState!==WebSocket.OPEN)return;
   if(socket.bufferedAmount>MAX_SOCKET_BACKLOG){fail(Error('AT5 audio host is falling behind; live input stopped'));dispose();return;}
   socket.send(message.buffer);
  }else if(message?.type==='status')onStatus(message.message);
 };
 socket.onopen=()=>{
  socket.send(JSON.stringify({
   type:'configure',sample_rate:context.sampleRate,frame_count:frameCount,
   tone:initialTone,tier
  }));
  onStatus('Loading AmpliTube 5 VST3...');
 };
 socket.onmessage=event=>{
  if(typeof event.data==='string'){
   let message;
   try{message=JSON.parse(event.data);}catch{fail(Error('AT5 audio host returned an invalid response'));return;}
   if(message.type==='ready'){
    if(message.frame_count!==frameCount){fail(Error(`AT5 audio host negotiated ${message.frame_count} samples, but ${frameCount} were requested`));dispose();return;}
    ready=true;clearTimeout(timeoutId);resolveReady(message);onStatus(`Connected: ${message.engine} · ${message.preset}`);
    if(message.warnings?.length)onToneStatus(message.warnings.join('; '),true);
   }else if(message.type==='error')fail(Error(message.message||'AT5 audio host failed'));
   else if(message.type==='tone-ready')onToneStatus(message.warnings?.length?`${message.tone}: ${message.warnings.join('; ')}`:`AmpliTube matched tone: ${message.tone} · ${String(message.tier).toUpperCase()}`,!!message.warnings?.length);
   else if(message.type==='tone-error')onToneStatus(`AmpliTube tone switch failed${message.tone?` (${message.tone})`:''}: ${message.message}`,true);
   return;
  }
  if(!(event.data instanceof ArrayBuffer)||event.data.byteLength!==frameCount*2*4){
   fail(Error('AT5 audio host returned an invalid audio block'));dispose();return;
  }
  node.port.postMessage({type:'output',buffer:event.data},[event.data]);
 };
 socket.onerror=()=>fail(Error('Could not connect to the local AmpliTube 5 audio host'));
 socket.onclose=event=>{
  if(!disposed&&(!ready||event.code!==1000))fail(Error(`AT5 audio host disconnected (${event.code})`));
 };
 timeoutId=setTimeout(()=>fail(Error('Timed out while loading AmpliTube 5 VST3')),60000);
 try{
  await readyPromise;
  if(signal?.aborted){dispose();throw abortError();}
 }catch(error){dispose();throw error;}

 return {
  input:node,
  engine:'at5-vst3',
  tier,
  selectTone(nextTone,nextName=nextTone?.Name||nextTone?.name||'',nextTier=tier){
   if(disposed)return;
   const next=tonePayload(nextTone,nextName),signature=JSON.stringify({tone:next,tier:nextTier});
   if(signature===toneSignature)return;
   toneSignature=signature;
   if(socket.readyState!==WebSocket.OPEN)return;
   socket.send(JSON.stringify({type:'tone',tone:next,tier:nextTier}));
  },
  connect(destination){node.connect(destination);return this;},
  dispose
 };
}
