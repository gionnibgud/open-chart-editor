// Original vocal editing plans. No lyric inference,
// source mutation, audio/native DSP or host/device access.
export const MAX_VOCAL_EVENTS=100000;
const finite=(value,label)=>{if(!Number.isFinite(value))throw Error(`${label} must be finite`);return value;};
const durationLimit=value=>{if(value===undefined)return Infinity;finite(value,'Duration');if(value<0)throw Error('Duration must be nonnegative');return value;};
function timing(row){if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.id!=='string'||!row.id)throw Error('Vocal events need unique nonempty string IDs');const time=finite(row.time,'Vocal time'),length=finite(row.length??0,'Vocal length');if(time<0||length<0||!Number.isFinite(time+length))throw Error('Vocal timing must be nonnegative and finite');return {time,length,end:time+length};}
/** Rebuild after the source history revision changes. This map references source
 * rows read-only; it deliberately does not clone100k opaque records per drag. */
export function createVocalIndex(vocals){
 if(!Array.isArray(vocals)||vocals.length>MAX_VOCAL_EVENTS)throw Error(`Vocals must be an array of at most ${MAX_VOCAL_EVENTS} events`);const byId=new Map();
 for(const row of vocals){timing(row);if(byId.has(row.id))throw Error('Duplicate vocal event ID');byId.set(row.id,row);}return {kind:'oce-vocal-index-v1',byId,count:vocals.length};
}
function selected(vocals,ids){
 const index=vocals?.kind==='oce-vocal-index-v1'?vocals:createVocalIndex(vocals);if(!(index.byId instanceof Map)||index.count>MAX_VOCAL_EVENTS||index.byId.size!==index.count)throw Error('Invalid vocal index');
 if(typeof ids==='string')ids=[ids];if(!ids||typeof ids[Symbol.iterator]!=='function')throw Error('Choose vocal IDs');const unique=new Set();for(const id of ids){if(typeof id!=='string'||!id)throw Error('Choose nonempty vocal IDs');unique.add(id);if(unique.size>MAX_VOCAL_EVENTS)throw Error('Too many selected vocal events');}
 const rows=[];for(const id of unique){const row=index.byId.get(id);if(!row)throw Error(`Selected vocal event is missing: ${id}`);timing(row);rows.push(row);}return rows;
}
export function planVocalMove(vocals,ids,delta,{duration}={}){
 finite(delta,'Move delta');const limit=durationLimit(duration),rows=selected(vocals,ids);if(!rows.length)return {updates:[],delta:0,end:0};let first=Infinity,last=0;
 for(const row of rows){const t=timing(row);first=Math.min(first,t.time);last=Math.max(last,t.end);}const lower=-first,upper=limit-last;if(lower>upper)throw Error('Selected vocal span cannot fit the duration');delta=Math.max(lower,Math.min(upper,delta));
 const updates=rows.map(row=>{const t=timing(row),time=t.time+delta;if(!Number.isFinite(time+t.length)||time<0)throw Error('Moved vocal timing exceeds finite range');return {id:row.id,time,length:t.length};});return {updates,delta,end:last+delta};
}
export function planVocalResize(vocal,end,{duration}={}){
 finite(end,'Vocal end');const t=timing(vocal),limit=durationLimit(duration);if(t.time>limit)throw Error('Vocal onset exceeds the duration');end=Math.max(t.time,Math.min(limit,end));const length=end-t.time;if(!Number.isFinite(length))throw Error('Resized vocal timing exceeds finite range');return {id:vocal.id,time:t.time,length,end};
}
export function copyVocalSelection(vocals,ids){
 const rows=selected(vocals,ids);let origin=Infinity,end=0;for(const row of rows){const t=timing(row);origin=Math.min(origin,t.time);end=Math.max(end,t.end);}if(!rows.length)origin=0;
 return {kind:'oce-vocals-v1',origin,duration:rows.length?end-origin:0,events:rows.map(row=>({...structuredClone(row),time:row.time-origin}))};
}
export function pasteVocalSelection(clipboard,at,{uid,duration,existingIds=[]}={}){
 if(clipboard?.kind!=='oce-vocals-v1'||!Array.isArray(clipboard.events)||clipboard.events.length>MAX_VOCAL_EVENTS)throw Error('Choose a valid bounded vocal clipboard');if(typeof uid!=='function')throw Error('A fresh vocal ID generator is required');finite(at,'Paste position');if(at<0)throw Error('Paste position must be nonnegative');finite(clipboard.origin,'Clipboard origin');finite(clipboard.duration,'Clipboard duration');if(clipboard.origin<0||clipboard.duration<0)throw Error('Clipboard timing must be nonnegative');
 const index=createVocalIndex(clipboard.events),limit=durationLimit(duration);let extent=0;for(const row of index.byId.values())extent=Math.max(extent,timing(row).end);if(extent>clipboard.duration+1e-9)throw Error('Clipboard events exceed its duration');if(clipboard.duration>limit)throw Error('Vocal clipboard cannot fit the duration');at=Math.min(at,limit-clipboard.duration);
 const used=new Set(existingIds);for(const row of clipboard.events)used.add(row.id);const result=[];
 for(const row of clipboard.events){const id=uid();if(typeof id!=='string'||!id||used.has(id))throw Error('Pasted vocals require fresh unique IDs');used.add(id);const copied=structuredClone(row);copied.id=id;copied.time=row.time+at;if(!Number.isFinite(copied.time+(copied.length??0)))throw Error('Pasted timing exceeds finite range');result.push(copied);}return result;
}
/** Original phrase entry: whitespace separates authored syllables. Reject the
 * complete operation before authoring if its last tail cannot fit the song. */
export function createVocalPhrase(text,{at=0,step=.5,duration,count=0,uid,existingIds=[]}={}){
 if(typeof text!=='string'||text.length>1048576)throw Error('Enter a lyric phrase of at most 1 MiB of text');
 finite(at,'Phrase position');finite(step,'Syllable spacing');const limit=durationLimit(duration);
 if(at<0||step<.05)throw Error('Phrase position must be nonnegative and syllable spacing at least 0.05 seconds');
 if(!Number.isInteger(count)||count<0||count>MAX_VOCAL_EVENTS)throw Error('Invalid existing vocal event count');
 const words=text.trim().split(/\s+/).filter(Boolean);if(!words.length)throw Error('Enter at least one syllable');
 if(words.length+count>MAX_VOCAL_EVENTS)throw Error('Vocal event limit exceeded');
 const end=at+(words.length-.1)*step;if(!Number.isFinite(end)||end>limit+1e-9)throw Error('The complete lyric phrase must fit within the song duration');
 if(typeof uid!=='function')throw Error('A fresh vocal ID generator is required');const used=new Set(existingIds);
 return words.map((text,i)=>{const id=uid();if(typeof id!=='string'||!id||used.has(id))throw Error('New vocals require fresh unique IDs');used.add(id);return{id,time:at+i*step,length:Math.min(step*.9,limit-(at+i*step)),text};});
}
