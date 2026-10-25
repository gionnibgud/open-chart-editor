import test from 'node:test';import assert from 'node:assert/strict';import {SpectralPreview} from '../src/spectral-preview.js';
function harness({stall=false,moduleFailure=false}={}){
 const messages=[],ports=[],source=new Float32Array(48000*600);let outputFrame=0,nextFrame=0;
 const worker={postMessage(data){messages.push(data);if(stall&&data.type==='process')return;queueMicrotask(()=>{const reply=data.type==='init'?{id:data.id,type:'ready'}:{id:data.id,type:'chunk',startFrame:outputFrame,outputFrame:outputFrame+=data.frames,nextFrame:nextFrame+=data.centers.length,channels:[new Float32Array(data.frames)]};this.onmessage({data:reply});});},terminate(){this.terminated=true;}};
 const node={connect(){this.connected=true;},disconnect(){this.connected=false;},port:{postMessage(data){ports.push(data);},close(){this.closed=true;}}};
 const context={sampleRate:48000,audioWorklet:{addModule:()=>moduleFailure?Promise.reject(Error('module unavailable')):Promise.resolve()}},buffer={sampleRate:48000,length:source.length,numberOfChannels:1,getChannelData:()=>source};
 const statuses=[],failures=[],preview=new SpectralPreview({context,buffer,output:{},sourceTimeAtOutput:t=>300+t*.5,workerFactory:()=>worker,nodeFactory:()=>node,onStatus:e=>statuses.push(e),onFailure:e=>failures.push(e.message)});
 return {preview,worker,node,messages,ports,statuses,failures};
}
test('spectral preparation is silent and bounded despite a ten minute source; consumed chunks refill only to the limit',async()=>{
 const {preview,node,messages,ports}=harness();await preview.prepare();assert.equal(preview.queueChunks,3);assert.equal(ports.some(m=>m.type==='start'),false);assert.equal(messages[0].type,'init');
 for(const request of messages.filter(m=>m.type==='process')){assert.ok(request.blocks.length<=2);assert.ok(request.blocks.reduce((n,b)=>n+b.channels[0].byteLength,0)<100000);assert.ok(request.centers.every(n=>n>=300*48000));}
 const scheduled=preview.start(.1234567);assert.ok(scheduled>=.1234567);assert.ok(scheduled-.1234567<1/48000);await new Promise(r=>setImmediate(r));assert.equal(preview.queueChunks,4);
 node.port.onmessage({data:{type:'consumed'}});node.port.onmessage({data:{type:'consumed'}});await new Promise(r=>setImmediate(r));assert.equal(preview.queueChunks,4);preview.stop();assert.equal(node.connected,false);assert.equal(node.port.closed,true);
});
test('stop rejects pending background preparation and cannot resurrect source or output',async()=>{
 const {preview,worker,node,messages}=harness({stall:true});const pending=preview.prepare();while(!messages.some(m=>m.type==='process'))await new Promise(r=>setImmediate(r));preview.stop();await assert.rejects(pending,{name:'AbortError'});assert.equal(worker.terminated,true);assert.equal(node.connected,false);assert.equal(preview.buffer,null);assert.equal(preview.requests.size,0);assert.throws(()=>preview.start(0),/prepared/);
});
test('running processor failure is reported once, cancels requests when host stops, and module rejection is retryable',async()=>{
 const {preview,node,failures}=harness();await preview.prepare();preview.start(0);await new Promise(r=>setImmediate(r));node.onprocessorerror();node.onprocessorerror();assert.deepEqual(failures,['Spectral output processor failed']);preview.stop();assert.equal(preview.requests.size,0);
 const failed=harness({moduleFailure:true});await assert.rejects(failed.preview.prepare(),/module unavailable/);failed.preview.context.audioWorklet.addModule=()=>Promise.resolve();await failed.preview.prepare();failed.preview.stop();
});
