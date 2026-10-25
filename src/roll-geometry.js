// View coordinates only: chart time, pitch, kit IDs and saved data never rotate.
export function rollAxes({bottom=false,width,height,scrollLeft=0,scrollTop=0}){
 return {bottom,width:bottom?height:width,height:bottom?width:height,
  timeScroll:bottom?scrollTop:scrollLeft,laneScroll:bottom?scrollLeft:scrollTop,
  logical:(x,y)=>bottom?{x:height-y,y:x+scrollLeft}:{x,y:y+scrollTop},
  screen:(x,y)=>bottom?{x:y-scrollLeft,y:height-x}:{x,y:y-scrollTop},
  matrix:dpr=>bottom?[0,-dpr,dpr,0,-scrollLeft*dpr,height*dpr]:[dpr,0,0,dpr,0,-scrollTop*dpr]};
}
export function rollArrow(key,bottom){return bottom?({arrowup:'arrowright',arrowdown:'arrowleft',arrowleft:'arrowup',arrowright:'arrowdown'}[key]||key):key;}
// Shapes and clipping use the same rotated canvas matrix as pointer inversion.
// Keep text upright so pitch names, ruler, markers and drum labels remain legible.
// fillTextAlong keeps the lane direction instead, for labels in narrow header lanes.
export function uprightRollContext(context,isBottom){
 return new Proxy(context,{get(target,key){
  if(key==='fillTextAlong')return(...args)=>target.fillText(...args);
  if(key==='fillText')return(text,x,y,maxWidth)=>{
   if(!isBottom())return maxWidth===undefined?target.fillText(text,x,y):target.fillText(text,x,y,maxWidth);
   const m=target.getTransform(),px=m.a*x+m.c*y+m.e,py=m.b*x+m.d*y+m.f,scale=Math.hypot(m.a,m.b);
   target.save();target.setTransform(scale,0,0,scale,px,py);target.textAlign='center';
   if(maxWidth===undefined)target.fillText(text,0,0);else target.fillText(text,0,0,maxWidth);
   target.restore();
  };
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 },set(target,key,value){Reflect.set(target,key,value,target);return true;}});
}
