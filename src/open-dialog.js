const extensions=['.json','.feedpak','.xml','.musicxml','.mxl','.mid','.midi','.gp3','.gp4','.gp5','.gpx','.gp','.gp6','.gp7','.gp8','.rsw'];
// Invoke directly from a user gesture; browsers without the API keep their
// normal file input. Cancellation never opens a second picker or changes data.
export async function chooseProjectFile({picker=globalThis.showOpenFilePicker,fallback=()=>{}}={}){
 if(typeof picker!=='function'){fallback();return null;}
 try{
  const handles=await picker.call(globalThis,{id:'open-chart-editor-open',multiple:false,types:[{description:'Chart projects and music files',accept:{'application/octet-stream':extensions}}]});
  const handle=handles?.[0];if(!handle)return null;
  const file=await handle.getFile();return {file,editableHandle:/\.json$/i.test(file.name)?handle:null};
 }catch(error){if(error?.name==='AbortError')return null;throw error;}
}
