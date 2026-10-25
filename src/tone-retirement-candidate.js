// UNALLOWLISTED explicit Worklet retirement ownership. A zero-gain route keeps
// a retiring processor reachable until its render callback acknowledges false.
const states=new WeakMap();
export const MAX_ADAPTIVE_RETIREMENTS_CANDIDATE=128;
function stateFor(context){if(!states.has(context))states.set(context,{pending:new Set(),sink:null,requested:0,acknowledged:0,timedOut:0,unacknowledged:0,unresolved:0,resolvedByClose:0,routeFailed:0,constructionRefused:0,capacityRefused:0,closed:0,maxPending:0,revision:0});const s=states.get(context);if(context.state==='closed'&&s.unresolved){s.resolvedByClose+=s.unresolved;s.unresolved=0;s.revision++;}return s;}
export function adaptiveRetirementStatusCandidate(context){const s=stateFor(context);return{pending:s.pending.size,retirementSinkNodes:s.sink?1:0,requested:s.requested,acknowledged:s.acknowledged,timedOut:s.timedOut,unacknowledged:s.unacknowledged,unresolved:s.unresolved,resolvedByContextClose:s.resolvedByClose,routeFailed:s.routeFailed,constructionRefused:s.constructionRefused,capacityRefused:s.capacityRefused,contextClosed:s.closed,maxPending:s.maxPending,revision:s.revision};}
export function assertAdaptiveRetirementCapacityCandidate(context){const s=stateFor(context);if(s.unresolved){s.constructionRefused++;throw Error('Adaptive retirement was not acknowledged; close/recreate the audio context before using more adaptive gears');}if(s.pending.size>=128){s.constructionRefused++;throw Error('Original adaptive preview is retiring old stages; this gear is temporarily bypassed');}}
export function retireAdaptiveNodeCandidate(context,node,{timeoutMs=1000,onStatus=()=>{}}={}){
 if(!Number.isInteger(timeoutMs)||timeoutMs<5||timeoutMs>2000)throw Error('Choose bounded retirement timeout5..2000ms');
 const s=stateFor(context);s.requested++;
 const close=()=>{try{node.disconnect();}catch{}try{node.port.close();}catch{}node.port.onmessage=null;node.onprocessorerror=null;};
 try{node.parameters?.get('run')?.setValueAtTime(0,context.currentTime||0);}catch{}try{node.port.postMessage({type:'stop'});}catch{}try{node.disconnect();}catch{}
 if(context.state==='closed'){close();s.closed++;s.revision++;return Promise.resolve({acknowledged:false,reason:'context-closed'});}
 if(s.pending.size>=128){close();s.capacityRefused++;s.unacknowledged++;s.unresolved++;s.revision++;return Promise.resolve({acknowledged:false,reason:'retirement-capacity'});}
 return new Promise(resolve=>{
  let settled=false,timer;const entry={node};
  const finish=(acknowledged,reason,frames)=>{if(settled)return;settled=true;clearTimeout(timer);close();s.pending.delete(entry);if(acknowledged)s.acknowledged++;else if(context.state==='closed'){reason='context-closed';s.closed++;}else{s.unacknowledged++;s.unresolved++;if(reason==='acknowledgement-timeout')s.timedOut++;else if(reason==='retirement-route-failed')s.routeFailed++;}s.revision++;if(!s.pending.size&&s.sink){try{s.sink.disconnect();}catch{}s.sink=null;}const result={acknowledged,reason,frames};resolve(result);try{onStatus({type:acknowledged?'retired':'retirement-unacknowledged',...result});}catch{}};
  node.port.onmessage=event=>{if(event.data?.type==='stopped')finish(true,'render-return-false',event.data.frames);};
  try{if(!s.sink){s.sink=context.createGain();s.sink.gain.value=0;s.sink.connect(context.destination);}s.pending.add(entry);s.maxPending=Math.max(s.maxPending,s.pending.size);node.connect(s.sink);timer=setTimeout(()=>finish(false,'acknowledgement-timeout'),timeoutMs);}
  catch{finish(false,'retirement-route-failed');}
 });
}
