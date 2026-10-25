// Browser-local crash recovery, isolated from published pack schemas.
function database(){return new Promise((resolve,reject)=>{const request=indexedDB.open('open-chart-editor-local',1);request.onupgradeneeded=()=>request.result.createObjectStore('drafts');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
async function transaction(mode,run){const db=await database();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('drafts',mode),request=run(tx.objectStore('drafts'));let value;request.onsuccess=()=>value=request.result;tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{db.close();}}
export const readDraft=()=>transaction('readonly',store=>store.get('current'));
export const writeDraft=value=>transaction('readwrite',store=>store.put(value,'current'));
export const clearDraft=()=>transaction('readwrite',store=>store.delete('current'));
