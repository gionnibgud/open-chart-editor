const DEFAULT_FRAME_COUNT=1024;

class At5LiveBridge extends AudioWorkletProcessor{
 constructor(options){
  super();
  this.frameCount=options.processorOptions?.frameCount??DEFAULT_FRAME_COUNT;
  if(![256,512,1024].includes(this.frameCount))throw Error('Unsupported AT5 audio block size');
  this.inputFrame=new Float32Array(this.frameCount);
  this.inputOffset=0;
  this.outputQueue=[];
  this.outputOffset=0;
  this.primed=false;
  this.underruns=0;
  this.port.onmessage=event=>{
   const message=event.data;
   if(message?.type==='reset'){
    this.outputQueue.length=0;this.outputOffset=0;this.inputOffset=0;this.primed=false;
   }else if(message?.type==='output'&&message.buffer instanceof ArrayBuffer){
    if(message.buffer.byteLength!==this.frameCount*2*4){
     this.port.postMessage({type:'status',message:'AT5 returned a malformed audio block'});
     return;
    }
    this.outputQueue.push(new Float32Array(message.buffer));
    if(this.outputQueue.length>16){
     this.outputQueue.splice(0,this.outputQueue.length-4);
     this.primed=false;
     this.port.postMessage({type:'status',message:'AT5 audio buffer overrun; some live audio was dropped'});
    }
   }
  };
 }

 process(inputs,outputs){
  const input=inputs[0]?.[0],channels=outputs[0]||[];
  if(input){
   for(let index=0;index<input.length;index++){
    this.inputFrame[this.inputOffset++]=input[index];
    if(this.inputOffset===this.frameCount){
     const completed=this.inputFrame;
     this.inputFrame=new Float32Array(this.frameCount);
     this.inputOffset=0;
     this.port.postMessage({type:'input',buffer:completed.buffer},[completed.buffer]);
    }
   }
  }
  if(this.outputQueue.length>=2)this.primed=true;
  if(!this.primed){
   for(const channel of channels)channel.fill(0);
   return true;
  }

  let underflow=false;
  for(let index=0;index<(channels[0]?.length||0);index++){
   while(this.outputQueue.length&&this.outputOffset===this.frameCount){
    this.outputQueue.shift();this.outputOffset=0;
   }
   if(!this.outputQueue.length){
    for(const channel of channels)channel[index]=0;
    underflow=true;
    continue;
   }
   const frame=this.outputQueue[0],position=this.outputOffset++;
   if(channels[0])channels[0][index]=frame[position];
   if(channels[1])channels[1][index]=frame[this.frameCount+position];
  }
  if(underflow){
   this.primed=false;
   this.underruns++;
   if(this.underruns===1||this.underruns%50===0){
    this.port.postMessage({type:'status',message:`AT5 audio buffer underrun (${this.underruns})`});
   }
  }
  return true;
 }
}

registerProcessor('oce-at5-live-v1',At5LiveBridge);
