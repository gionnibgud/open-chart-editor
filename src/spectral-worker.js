import {SpectralStream} from './spectral-core.js';
let core=null,blocks=[],settings=null;
function lookup(channel,index){if(index<0||index>=settings.length)return 0;for(const block of blocks){const local=index-block.start;if(local>=0&&local<block.channels[channel].length)return block.channels[channel][local];}throw Error('Required spectral source range is unavailable');}
function read(channel,position){if(settings.loop?.enabled){const lower=settings.loop.start*settings.sampleRate,span=(settings.loop.end-settings.loop.start)*settings.sampleRate;if(position>=(settings.loop.end*settings.sampleRate))position=lower+((position-settings.loop.end*settings.sampleRate)%span+span)%span;}const index=Math.floor(position),fraction=position-index;return lookup(channel,index)*(1-fraction)+lookup(channel,index+1)*fraction;}
self.onmessage=({data})=>{try{
 if(data.type==='init'){settings=data.settings;core=new SpectralStream({...settings,readSample:read});self.postMessage({type:'ready',id:data.id});}
 else if(data.type==='process'){
  if(!core)throw Error('Spectral stream was not initialized');blocks=data.blocks;let frames=0;
  if(blocks.length>2)throw Error('Too many spectral source ranges');for(const block of blocks){if(!Number.isInteger(block.start)||block.start<0||block.channels.length!==settings.channels||block.channels.some(c=>!(c instanceof Float32Array)||c.length!==block.channels[0].length)||block.start+block.channels[0].length>settings.length)throw Error('Invalid spectral source range');frames+=block.channels[0].length;}
  if(frames>settings.sampleRate*2+settings.fftSize*2)throw Error('Spectral source cache exceeds its bound');
  const result=core.process(data.centers,data.frames);self.postMessage({type:'chunk',id:data.id,...result},result.channels.map(c=>c.buffer));blocks=[];
 }
}catch(error){self.postMessage({type:'error',id:data.id,message:error.message||String(error)});}};
