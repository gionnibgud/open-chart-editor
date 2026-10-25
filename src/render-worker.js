import {renderGuide} from './render-guide.js';
// Cancellation terminates this dedicated worker, including an in-progress long
// sustain or WAV allocation; no synchronous fallback can freeze the editor.
self.onmessage=({data})=>{
 try{const bytes=renderGuide(data.project,{...data.options,onProgress:progress=>self.postMessage({type:'progress',progress})});self.postMessage({type:'result',bytes},[bytes]);}
 catch(error){self.postMessage({type:'error',message:error.message||String(error)});}
};
