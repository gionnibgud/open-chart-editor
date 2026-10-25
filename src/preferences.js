// Small browser preferences stay separate from every song/export schema.
// Renamed with the project; the old key is read once if the new one is empty.
const KEY='oce.preferences.v1',OLD_KEY='workshop-editor.preferences.v1';
const number=(value,min,max,fallback)=>typeof value==='number'&&Number.isFinite(value)?Math.max(min,Math.min(max,value)):fallback;
export function readPreferences(storage){
 try{
  const store=storage||globalThis.localStorage,raw=store.getItem(KEY)??store.getItem(OLD_KEY);if(!raw||raw.length>65536)return{};
  const value=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value))return{};
  const result={inspectorVisible:value.inspectorVisible!==false,inspectorWidth:number(value.inspectorWidth,200,2000,280),bottomHeight:number(value.bottomHeight,100,1200,155),zoom:number(value.zoom,25,400,110),snap:[0,1,2,3,4,6,8].includes(value.snap)?value.snap:4,fretConvention:value.fretConvention==='physical'?'physical':'relative',invertStrings:value.invertStrings===true,validationProfile:value.validationProfile==='workshop'?'oce':['feedpak','cdlc','oce'].includes(value.validationProfile)?value.validationProfile:'feedpak',speed:number(value.speed,.25,2,1),pitch:number(value.pitch,-24,24,0)};
  result.shadeHands=value.shadeHands===true;
  result.staveTheme=value.staveTheme==='light'?'light':'dark';
  result.quality=value.quality==='spectral'?'spectral':'fast';
  if(value.viewZoom&&typeof value.viewZoom==='object')result.viewZoom={tab:number(value.viewZoom.tab,25,400,result.zoom),tempo:number(value.viewZoom.tempo,25,400,result.zoom)};
  if(value.laneScales&&typeof value.laneScales==='object')result.laneScales=Object.fromEntries(['guitar','bass','keys','drums'].map(type=>[type,number(value.laneScales[type],.5,4,1)]));
  if(value.rollOrientations&&typeof value.rollOrientations==='object')result.rollOrientations=Object.fromEntries(['keys','drums'].map(type=>[type,value.rollOrientations[type]==='bottom'?'bottom':'left']));
  if(value.sustain&&typeof value.sustain==='object'&&!Array.isArray(value.sustain))result.sustain={clampNext:value.sustain.clampNext===true,gutterEnabled:value.sustain.gutterEnabled===true,gutterBeats:number(value.sustain.gutterBeats,0,16,.125)};
  if(value.mixer&&typeof value.mixer==='object'&&!Array.isArray(value.mixer))result.mixer=value.mixer;
  if(value.countIn&&typeof value.countIn==='object')result.countIn={enabled:value.countIn.enabled===true,bars:Math.round(number(value.countIn.bars,1,16,1)),beats:value.countIn.beats==null?null:Math.round(number(value.countIn.beats,1,64,4))};
  return result;
 }catch{return{};}
}
export function writePreferences(value,storage){
 try{const target=storage||globalThis.localStorage,text=JSON.stringify(value);if(text.length<=65536&&target.getItem(KEY)!==text)target.setItem(KEY,text);return true;}catch{return false;}
}
