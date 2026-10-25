// Original controlled vocal timeline. Interactive view; source changes are committed by its owner.
// The controller previews drags locally; the owner commits validated changes.
import {IntervalIndex,PointIndex} from './viewport.js';

const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export class VocalTimeline {
 constructor(container,{read,quantize=value=>value,onCursor=()=>{},onEdit=()=>{},onSelection=()=>{},onText=()=>{},onError=()=>{},initial={}}={}){
  if(!container||typeof read!=='function')throw Error('A vocal timeline container and state reader are required');
  this.container=container;this.read=read;this.quantize=quantize;this.onCursor=onCursor;this.onEdit=onEdit;this.onSelection=onSelection;this.onText=onText;this.onError=onError;this.abort=new AbortController();this.selection=new Set(initial.selection||[]);this.drag=null;this.cache=null;this.disposed=false;this.frame=null;this.connectedScroll=initial.scrollLeft||0;
  const doc=container.ownerDocument;this.scroll=doc.createElement('div');this.scroll.className='ws-vocal-timeline-scroll';this.scroll.style.cssText='position:relative;overflow-x:auto;overflow-y:hidden;height:266px;border:1px solid #44454f;background:#191a20';
  this.canvas=doc.createElement('canvas');this.canvas.tabIndex=0;this.canvas.setAttribute('aria-label','Vocal syllable timeline');this.canvas.style.cssText='position:sticky;left:0;display:block;outline:none;touch-action:none';this.canvas.style.height='250px';
  this.spacer=doc.createElement('div');this.spacer.style.height='0px';this.scroll.append(this.canvas,this.spacer);container.append(this.scroll);this.ctx=this.canvas.getContext('2d');
  const on=(element,name,fn)=>element.addEventListener(name,fn,{signal:this.abort.signal});
  on(this.scroll,'scroll',()=>{if(this.container.isConnected)this.connectedScroll=this.scroll.scrollLeft;this.schedule();});on(this.canvas,'pointerdown',event=>this.pointerDown(event));on(this.canvas,'pointermove',event=>this.pointerMove(event));on(this.canvas,'pointerup',event=>this.pointerUp(event));on(this.canvas,'pointercancel',()=>{this.drag=null;this.schedule();});
  on(this.canvas,'dblclick',event=>{event.preventDefault();this.guard(()=>{const point=this.point(event),hit=this.hit(point.x,point.y);if(hit)this.onText(hit.id);else this.onEdit('add',{time:Math.max(0,this.quantize(this.timeAt(point.x)))});});});
  on(this.canvas,'keydown',event=>this.keyDown(event));
  this.resize=new ResizeObserver(()=>this.schedule());this.resize.observe(this.scroll);this.refresh();this.scroll.scrollLeft=initial.scrollLeft||0;this.connectedScroll=this.scroll.scrollLeft;this.schedule();
 }
 guard(fn){try{const result=fn();if(result?.catch)result.catch(error=>this.onError(error));return result;}catch(error){this.onError(error);}}
 state(){const state=this.read();if(!Array.isArray(state?.events)||state.events.length>100000)throw Error('Vocal timeline supports at most100,000 syllables');return state;}
 index(){const state=this.state();if(this.cache?.revision!==state.revision||this.cache?.events!==state.events||this.cache?.beats!==state.beats){
   const ids=new Map();for(const event of state.events){if(!event||typeof event.id!=='string'||!event.id||ids.has(event.id)||!Number.isFinite(event.time)||event.time<0||!Number.isFinite(event.length)||event.length<0)throw Error('Vocal syllables need unique IDs and finite nonnegative times and lengths');ids.set(event.id,event);}
   this.cache={revision:state.revision,events:state.events,beats:state.beats,ids,intervals:new IntervalIndex(state.events,{end:event=>event.time+event.length}),beatIndex:new PointIndex(state.beats||[])};
   this.selection=new Set([...this.selection].filter(id=>ids.has(id)));
  }return this.cache;
 }
 zoom(){const value=this.state().zoom;return Number.isFinite(value)?clamp(value,25,400):110;}
 timeAt(x){return(x-42+this.scroll.scrollLeft)/this.zoom();}
 xAt(time){return 42+time*this.zoom()-this.scroll.scrollLeft;}
 point(event){const r=this.canvas.getBoundingClientRect();return{x:event.clientX-r.left,y:event.clientY-r.top};}
 visible(){const cache=this.index(),start=this.timeAt(32),end=this.timeAt(this.scroll.clientWidth+14),rows=cache.intervals.between(start,end).sort((a,b)=>a.index-b.index).map(row=>row.item);if(this.drag?.kind==='move')rows.push(...cache.intervals.between(start-this.drag.delta,end-this.drag.delta).filter(row=>this.selection.has(row.item.id)).map(row=>row.item));if(this.drag?.kind==='resize'){const item=cache.ids.get(this.drag.id);if(item)rows.push(item);}return [...new Set(rows)];}
 hit(x,y){if(y<35||y>235)return null;const time=this.timeAt(x),margin=10/this.zoom();return this.index().intervals.between(time-margin,time+margin).sort((a,b)=>a.index-b.index).map(row=>row.item).findLast(event=>x>=this.xAt(event.time)-5&&x<=this.xAt(event.time)+Math.max(10,event.length*this.zoom())&&((y>=49&&y<=86)||(Number.isInteger(event.pitch)&&Math.abs(this.pitchY(event.pitch)-y)<=8)))||null;}
 pitchY(pitch){return 218-clamp(pitch,0,127)/127*105;}
 selectedIds(){return [...this.selection];}
 setSelection(ids){const index=this.index();this.selection=new Set([...ids].filter(id=>index.ids.has(id)));this.onSelection(this.selectedIds());this.schedule();}
 snapshot(){if(this.container.isConnected)this.connectedScroll=this.scroll.scrollLeft;return{selection:this.selectedIds(),scrollLeft:this.connectedScroll};}
 refresh(){this.guard(()=>{this.index();this.draw();});}
 schedule(){if(this.disposed||this.frame!==null)return;this.frame=requestAnimationFrame(()=>{this.frame=null;if(!this.disposed)this.refresh();});}
 draw(){
  if(this.disposed||!this.container.isConnected)return;const state=this.state(),width=Math.max(1,this.scroll.clientWidth),height=250,dpr=Math.min(devicePixelRatio||1,2,Math.sqrt(8000000/(width*height)),16384/width),g=this.ctx;
  this.canvas.style.width=`${width}px`;this.spacer.style.width=`${42+Math.max(0,state.duration||0,this.index().intervals.maxEnd[1]||0)*this.zoom()+60}px`;
  const bw=Math.max(1,Math.floor(width*dpr)),bh=Math.max(1,Math.floor(height*dpr));if(this.canvas.width!==bw||this.canvas.height!==bh){this.canvas.width=bw;this.canvas.height=bh;}
  g.setTransform(dpr,0,0,dpr,0,0);g.fillStyle='#191a20';g.fillRect(0,0,width,height);g.font='11px Segoe UI';g.textBaseline='middle';
  if(state.playing){const x=this.xAt(state.cursor||0);if(x>width-24||x<42)this.scroll.scrollLeft=Math.max(0,(state.cursor||0)*this.zoom()-80);}this.connectedScroll=this.scroll.scrollLeft;
  const left=this.timeAt(42),right=this.timeAt(width);for(const beat of this.index().beatIndex.between(Math.max(0,left),right)){const x=this.xAt(beat.time);g.strokeStyle=beat.measure>=0?'#5e6470':'#2a2d36';g.beginPath();g.moveTo(x,25);g.lineTo(x,height);g.stroke();if(beat.measure>=0){g.fillStyle='#a8b5c9';g.fillText(String(beat.measure),x+3,15);}}
  for(const pitch of [0,36,60,84,127]){const y=this.pitchY(pitch);g.strokeStyle='#303441';g.beginPath();g.moveTo(42,y);g.lineTo(width,y);g.stroke();g.fillStyle='#8290a5';g.fillText(String(pitch),8,y);}
  g.save();g.beginPath();g.rect(42,30,width-42,height-30);g.clip();
  const visible=this.visible();for(const event of visible.slice(-4096)){const selected=this.selection.has(event.id),moved=this.drag?.kind==='move'&&selected,time=event.time+(moved?this.drag.delta:0),length=this.drag?.kind==='resize'&&this.drag.id===event.id?Math.max(0,this.drag.end-event.time):event.length,x=this.xAt(time),w=Math.max(10,length*this.zoom());
   g.fillStyle=selected?'#477eac':'#304c65';g.fillRect(x,50,w,34);g.strokeStyle=selected?'#c4e4ff':'#5a829f';g.strokeRect(x,50,w,34);g.fillStyle='#eef4ff';g.save();g.beginPath();g.rect(x+3,51,Math.max(0,w-6),32);g.clip();g.fillText(String(event.text??''),x+5,67);g.restore();
   g.fillStyle=selected?'#e2f2ff':'#88b1cf';g.fillRect(x+w-4,50,4,34);
   if(Number.isInteger(event.pitch)&&event.pitch>=0&&event.pitch<=127){const y=this.pitchY(event.pitch);g.fillStyle=selected?'#a6d5ff':'#4e8ab8';g.fillRect(x,y-5,w,10);}
  }
  if(this.drag?.kind==='marquee'){const {x,y,currentX,currentY}=this.drag;g.fillStyle='#4c91c433';g.fillRect(Math.min(x,currentX),Math.min(y,currentY),Math.abs(x-currentX),Math.abs(y-currentY));g.strokeStyle='#68b5e4';g.strokeRect(Math.min(x,currentX),Math.min(y,currentY),Math.abs(x-currentX),Math.abs(y-currentY));}
  if(visible.length>4096){g.fillStyle='#e3b85b';g.fillText('Dense overlap: zoom in or use the syllable table',48,96);}
  if(state.waveform?.length&&state.audioDuration>0){g.strokeStyle='#69899f';g.beginPath();for(let x=42;x<width;x++){const index=Math.floor(this.timeAt(x)/state.audioDuration*state.waveform.length),v=state.waveform[index]||0;g.moveTo(x,100-v*9);g.lineTo(x,100+v*9);}g.stroke();}
  const cursor=this.xAt(state.cursor||0);g.strokeStyle='#42b4f5';g.beginPath();g.moveTo(cursor,25);g.lineTo(cursor,height);g.stroke();g.restore();g.fillStyle='#a8b6ca';g.fillText('Lyrics',3,67);g.fillStyle='#8694aa';g.fillText(`${this.selection.size} selected / ${state.events.length} syllables`,48,238);
 }
 pointerDown(event){if(event.button!==0||this.disposed)return;event.preventDefault();this.canvas.focus({preventScroll:true});this.guard(()=>{
  const point=this.point(event),hit=this.hit(point.x,point.y),state=this.state();if(hit){if(event.shiftKey){if(this.selection.has(hit.id))this.selection.delete(hit.id);else this.selection.add(hit.id);}else if(!this.selection.has(hit.id))this.selection=new Set([hit.id]);this.onSelection(this.selectedIds());this.onCursor(hit.time);if(!this.selection.has(hit.id)){this.drag=null;this.schedule();return;}const selected=[...this.selection].map(id=>this.index().ids.get(id)),first=selected.reduce((value,item)=>Math.min(value,item.time),Infinity),last=selected.reduce((value,item)=>Math.max(value,item.time+item.length),0);this.drag=point.x>=this.xAt(hit.time)+Math.max(10,hit.length*this.zoom())-6?{kind:'resize',id:hit.id,start:hit.time,end:hit.time+hit.length,oldEnd:hit.time+hit.length,revision:state.revision}:{kind:'move',id:hit.id,originX:point.x,originScroll:this.scroll.scrollLeft,originTime:hit.time,first,last,delta:0,revision:state.revision};}
  else{if(!event.shiftKey)this.selection.clear();this.onSelection(this.selectedIds());this.onCursor(Math.max(0,this.quantize(this.timeAt(point.x))));this.drag={kind:'marquee',...point,currentX:point.x,currentY:point.y,initial:new Set(this.selection),revision:state.revision};}
  this.canvas.setPointerCapture(event.pointerId);this.schedule();
 });}
 pointerMove(event){const point=this.point(event);if(!this.drag){const hit=this.guard(()=>this.hit(point.x,point.y));this.canvas.title=hit?`${hit.text??''} / ${hit.time.toFixed(3)} s / ${hit.length.toFixed(3)} s${Number.isInteger(hit.pitch)?' / MIDI '+hit.pitch:''}`:'';return;}
  this.guard(()=>{if(this.drag.kind==='move')this.drag.delta=clamp(this.quantize(this.drag.originTime+(point.x-this.drag.originX+this.scroll.scrollLeft-this.drag.originScroll)/this.zoom())-this.drag.originTime,-this.drag.first,Math.max(-this.drag.first,(this.state().duration??Infinity)-this.drag.last));else if(this.drag.kind==='resize')this.drag.end=clamp(this.quantize(this.timeAt(point.x)),this.drag.start,Math.max(this.drag.start,this.state().duration??Infinity));else{this.drag.currentX=point.x;this.drag.currentY=point.y;}this.schedule();});
 }
 pointerUp(event){const drag=this.drag;if(!drag)return;this.drag=null;if(this.canvas.hasPointerCapture(event.pointerId))this.canvas.releasePointerCapture(event.pointerId);this.guard(()=>{
  if(drag.revision!==this.state().revision)throw Error('The project changed during the vocal drag; no edit was applied');
  if(drag.kind==='move'&&Math.abs(drag.delta)>1e-9)this.onEdit('move',{ids:this.selectedIds(),delta:drag.delta});
  else if(drag.kind==='resize'&&Math.abs(drag.end-drag.oldEnd)>1e-9)this.onEdit('resize',{id:drag.id,end:drag.end});
  else if(drag.kind==='marquee'&&Math.hypot(drag.currentX-drag.x,drag.currentY-drag.y)>4){const left=Math.min(drag.x,drag.currentX),right=Math.max(drag.x,drag.currentX),top=Math.min(drag.y,drag.currentY),bottom=Math.max(drag.y,drag.currentY),ids=new Set(drag.initial);for(const row of this.index().intervals.between(this.timeAt(left),this.timeAt(right))){const item=row.item,x=this.xAt(item.time),y=Number.isInteger(item.pitch)?this.pitchY(item.pitch):67;if(x>=left&&x<=right&&((top<=67&&bottom>=67)||(y>=top&&y<=bottom)))ids.add(item.id);}this.setSelection(ids);}
  this.schedule();
 });}
 keyDown(event){const key=event.key.toLowerCase(),mod=event.ctrlKey||event.metaKey;let operation=null,payload={ids:this.selectedIds()};
  if(mod&&key==='a'){event.preventDefault();event.stopPropagation();this.setSelection(this.state().events.map(item=>item.id));return;}
  if(mod)operation=({c:'copy',x:'cut',v:'paste'})[key];else if(key==='delete'||key==='backspace')operation='delete';
  if(event.altKey&&['arrowleft','arrowright'].includes(key)){operation='nudge';payload.direction=key==='arrowleft'?-1:1;}
  if(operation){event.preventDefault();event.stopPropagation();this.guard(()=>this.onEdit(operation,payload));return;}
  if(key==='escape'){event.preventDefault();event.stopPropagation();this.drag=null;this.setSelection([]);}
 }
 /** Keep `time` in view during playback. */
 follow(time){if(this.disposed||!Number.isFinite(time))return;const x=this.xAt(time),width=this.scroll.clientWidth;if(x<42||x>width-80)this.scroll.scrollLeft=Math.max(0,time*this.zoom()-120);}
 dispose(){if(this.disposed)return;this.disposed=true;this.abort.abort();this.resize.disconnect();if(this.frame!==null)cancelAnimationFrame(this.frame);this.frame=null;this.drag=null;this.cache=null;this.scroll.remove();}
}
