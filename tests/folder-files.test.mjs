import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto,createHash} from 'node:crypto';
import {folderSelection,decodeFolderTree,writeFolderTree} from '../src/folder-files.js';
const entry=(path,text)=>{const data=Buffer.from(text);return{path,size:data.length,sha256:createHash('sha256').update(data).digest('hex'),base64:data.toString('base64')};};
const tree=()=>({version:1,entries:[entry('manifest.yaml','own manifest'),entry('audio/own.wav','own audio\0')]});
test('folder selection retains one root and relative names with bounded bytes',()=>{
 const own=(name,size=1)=>({webkitRelativePath:name,size});
 assert.deepEqual(folderSelection([own('Own/manifest.yaml'),own('Own/audio/full.wav')]).entries.map(e=>e.path),['manifest.yaml','audio/full.wav']);
 for(const files of [[own('Own/a'),own('Other/b')],[own('Own/A'),own('Own/a')],[own('Own/../x')],[own('Own/a',256*1024*1024+1)]])assert.throws(()=>folderSelection(files));
});
test('all paths, sizes and checksums are checked before any directory writes',async()=>{
 for(const modify of [t=>t.entries[1].sha256='0'.repeat(64),t=>t.entries[1].path='../own.wav',t=>t.entries.push(entry('MANIFEST.yaml','other')),t=>t.entries.push(entry('audio','collision')),t=>t.entries.push(entry('Audio/other.wav','collision')),t=>t.entries[1].size++]){
  const payload=tree();modify(payload);let writes=0;const parent={getDirectoryHandle(){writes++;throw Error('Unexpected write');}};
  await assert.rejects(writeFolderTree(new Response(JSON.stringify(payload)),parent));assert.equal(writes,0);
 }
 const decoded=await decodeFolderTree(tree());assert.equal(Buffer.from(decoded[1].bytes).toString(),'own audio\0');
});
test('stale export cannot write and successful export uses a new child without replacing prior files',async()=>{
 let writes=0;const store=new Map(),directory=path=>({name:path,async getDirectoryHandle(name,{create}={}){const next=path+'/'+name;if(!create){const e=Error('missing');e.name='NotFoundError';throw e;}writes++;return directory(next);},async getFileHandle(name){return{async createWritable(){return{async write(bytes){store.set(path+'/'+name,Buffer.from(bytes));},async close(){}};}};}}),parent=directory('chosen');
 await assert.rejects(writeFolderTree(new Response(JSON.stringify(tree())),parent,{isCurrent:()=>false}));assert.equal(writes,0);
 const payload=tree();payload.manifest={warnings:['Unsupported charts retained in master']};const result=await writeFolderTree(new Response(JSON.stringify(payload)),parent,{name:'Own song',suffix:'.feedpak',crypto:webcrypto});
 assert.match(result.destination,/^chosen \/ Own song-.*\.feedpak$/);assert.equal(store.size,2);assert.equal([...store.values()][0].toString(),'own manifest');assert.equal(result.recentId,null);assert.deepEqual(result.warnings,['Unsupported charts retained in master']);
});
