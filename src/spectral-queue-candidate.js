// Test-only queue comparison. Never installed or imported by runtime.
// Keeps PCM buffering within the existing Worklet32768-frame hard bound.
export async function pumpSpectralQueueCandidate(preview,targetChunks=8){
 if(!Number.isInteger(targetChunks)||targetChunks<4||targetChunks>8||preview.chunkFrames!==4096)throw Error('Candidate queue must fit the existing bounded output ring');
 if(!preview.active||preview.pumping)return;preview.pumping=true;try{while(preview.active&&preview.queueChunks<targetChunks)await preview.produce();}finally{preview.pumping=false;}
}
