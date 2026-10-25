// User-selected folder input and verified entry-tree output. No host paths.
const LIMIT=256*1024*1024,MAX_FILES=4096;
const devices=/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
export function folderEntryName(name){
 if(typeof name!=='string'||!name||name.length>2048||name.split('/').some(p=>!p||p==='.'||p==='..'||/[\x00-\x1f<>:"\\|?*]/.test(p)||/[ .]$/.test(p)||devices.test(p)))throw Error('Unsafe folder entry name');
 return name;
}
export function folderSelection(files){
 const list=Array.from(files||[]);if(!list.length||list.length>MAX_FILES)throw Error('Choose a song folder with at most 4096 files');
 const entries=[],seen=new Set();let root,total=0;
 for(const file of list){const name=folderEntryName(file.webkitRelativePath),parts=name.split('/');if(parts.length<2)throw Error('Select a folder rather than individual files');if(root&&root!==parts[0])throw Error('Select one song folder');root=parts.shift();const path=parts.join('/'),key=path.toLowerCase();if(seen.has(key))throw Error('Case-colliding folder entries');seen.add(key);total+=file.size;if(!Number.isSafeInteger(file.size)||file.size<0||total>LIMIT)throw Error('Song folder exceeds the 256 MiB import limit');entries.push({path,file});}
 return {name:root,entries};
}
export async function readFolderFiles(files,{fetcher=globalThis.fetch,FileClass=globalThis.File,signal}={}){
 const {name,entries}=folderSelection(files),form=new FormData();for(const entry of entries)form.append('files',entry.file,entry.path);
 const response=await fetcher('/api/plugins/open_chart_editor/folder-source',{method:'POST',body:form,signal});
 if(!response.ok){let text=await response.text();try{text=JSON.parse(text).detail||text;}catch{}throw Error(text);}
 const blob=await response.blob();if(blob.size>LIMIT)throw Error('Song folder transport exceeds the import limit');return new FileClass([blob],name+'.oce-folder.zip',{type:'application/zip'});
}
export async function decodeFolderTree(tree,{crypto=globalThis.crypto}={}){
 if(tree?.version!==1||!Array.isArray(tree.entries)||!tree.entries.length||tree.entries.length>MAX_FILES)throw Error('Invalid folder export');
 const entries=[],seen=new Set(),prefixes=new Map();let total=0;
 for(const item of tree.entries){const path=folderEntryName(item.path),key=path.toLowerCase();if(seen.has(key))throw Error('Case-colliding folder entries');seen.add(key);const parts=path.split('/');for(let i=1;i<=parts.length;i++){const prefix=parts.slice(0,i).join('/'),folded=prefix.toLowerCase();if(prefixes.has(folded)&&prefixes.get(folded)!==prefix)throw Error('Case-colliding folder paths');prefixes.set(folded,prefix);}
  if(!Number.isSafeInteger(item.size)||item.size<0||!/^([a-f0-9]{64})$/.test(item.sha256)||typeof item.base64!=='string'||item.base64.length!==4*Math.ceil(item.size/3)||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.base64))throw Error('Invalid folder entry data');
  total+=item.size;if(total>LIMIT)throw Error('Folder export exceeds 256 MiB');const raw=atob(item.base64),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));if(bytes.byteLength!==item.size)throw Error('Folder entry size mismatch');
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(digest!==item.sha256)throw Error('Folder entry checksum mismatch');entries.push({path,bytes});
 }
 for(const key of seen){const parts=key.split('/');if(parts.some((_,i)=>i&&seen.has(parts.slice(0,i).join('/'))))throw Error('File/directory collision in folder export');}
 return entries;
}
// `into` writes new files straight into the chosen folder (an opened R+ song
// folder) and refuses before writing anything if any of them already exists.
export async function writeFolderTree(response,parent,{name='OCE',suffix='',isCurrent=()=>true,crypto=globalThis.crypto,into=false}={}){
 if(!response.ok){let text=await response.text();try{text=JSON.parse(text).detail||text;}catch{}throw Error(text);}
 const tree=await response.json(),entries=await decodeFolderTree(tree,{crypto});if(!isCurrent())throw Error('The project changed before its folder export was ready');
 const safe=name.replace(/[\x00-\x1f<>:"/\\|?*]/g,'_').replace(/[ .]+$/,'').slice(0,80)||'OCE';
 let child,root;
 if(into){
  for(const {path} of entries){if(path.includes('/'))throw Error('Folder files must sit at the folder root');let found=true;try{await parent.getFileHandle(path);}catch(error){if(error.name==='NotFoundError')found=false;else if(error.name!=='TypeMismatchError')throw error;}if(found)throw Error(path+' already exists in '+parent.name+'; nothing was written');}
  child='';root=parent;
 }else{
  if(!['','.feedpak'].includes(suffix))throw Error('Unsupported export folder suffix');child=safe+'-'+crypto.randomUUID().slice(0,12)+suffix;let exists=false;try{await parent.getDirectoryHandle(child);exists=true;}catch(error){if(error.name!=='NotFoundError')throw error;}if(exists)throw Error('Export folder already exists; choose the destination again');
  root=await parent.getDirectoryHandle(child,{create:true});
 }
 try{for(const {path,bytes} of entries){let directory=root;const parts=path.split('/'),leaf=parts.pop();for(const part of parts)directory=await directory.getDirectoryHandle(part,{create:true});const handle=await directory.getFileHandle(leaf,{create:true}),writer=await handle.createWritable();try{await writer.write(bytes);await writer.close();}catch(error){try{await writer.abort?.();}catch{}throw error;}}}
 catch(error){throw Error('Folder export stopped; partial files remain in '+(child||parent.name)+'. '+error.message);}
 let warnings=Array.isArray(tree.manifest?.warnings)?tree.manifest.warnings.map(w=>typeof w==='string'?w:w?.message).filter(Boolean):[];try{warnings.push(...JSON.parse(response.headers.get('X-OCE-Export-Warnings')||'[]').map(w=>typeof w==='string'?w:w?.message).filter(Boolean));}catch{}warnings=[...new Set(warnings)];
 return {name:child||parent.name,destination:child?parent.name+' / '+child:parent.name,warnings,recentId:null,files:entries.map(e=>e.path)};
}
