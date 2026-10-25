// Reserve native output order before waiting for the backend. Separate files
// stay independent; two handles referring to the same file share one queue.
// Rejections release their reservation so a later save can still succeed.
export class OrderedSaves{
 constructor(){this.queues=new Set();this.registration=Promise.resolve();}
 run(handle,response,consume){
  const ready=Promise.resolve(response);ready.catch(()=>{});
  if(!handle)return ready.then(consume);
  const registered=this.registration.then(async()=>{
   let queue;
   for(const candidate of this.queues){let same=handle===candidate.handle;if(!same&&typeof handle.isSameEntry==='function')try{same=await handle.isSameEntry(candidate.handle);}catch{}if(same){queue=candidate;break;}}
   if(!queue){queue={handle,tail:Promise.resolve(),pending:0};this.queues.add(queue);}
   queue.pending++;
   const work=queue.tail.catch(()=>{}).then(()=>ready).then(consume);queue.tail=work;
   const release=()=>{if(!--queue.pending)this.queues.delete(queue);};work.then(release,release);
   return {work};
  });
  this.registration=registered.then(()=>{},()=>{});
  return registered.then(({work})=>work);
 }
}
