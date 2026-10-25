// Original immutable indexes of mutable authoring objects. Rebuild after edits.
const lower=(rows,time,key)=>{let lo=0,hi=rows.length;while(lo<hi){const m=(lo+hi)>>>1;if(key(rows[m])<time)lo=m+1;else hi=m;}return lo;};
export class PointIndex {
 constructor(items,{time=item=>item.time}={}){this.rows=items.map((item,index)=>({item,index,time:time(item)})).filter(row=>Number.isFinite(row.time)).sort((a,b)=>a.time-b.time||a.index-b.index);}
 between(start,end){const from=lower(this.rows,start,row=>row.time),to=lower(this.rows,end,row=>row.time);return this.rows.slice(from,to).map(row=>row.item);}
}
export class IntervalIndex {
 constructor(items,{start=item=>item.time,end=item=>item.time+Math.max(0,item.sustain||0)}={}){
  this.rows=items.map((item,index)=>({item,index,start:start(item),end:end(item)})).filter(row=>Number.isFinite(row.start)&&Number.isFinite(row.end)).sort((a,b)=>a.start-b.start||a.index-b.index);
  this.maxEnd=new Float64Array(Math.max(1,this.rows.length*4));this.build(1,0,this.rows.length);
 }
 build(node,lo,hi){if(lo>=hi)return -Infinity;if(hi-lo===1)return this.maxEnd[node]=this.rows[lo].end;const mid=(lo+hi)>>>1;return this.maxEnd[node]=Math.max(this.build(node*2,lo,mid),this.build(node*2+1,mid,hi));}
 between(start,end){
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)return [];
  const result=[],visit=(node,lo,hi)=>{if(lo>=hi||this.maxEnd[node]<start||this.rows[lo].start>end)return;if(hi-lo===1){result.push(this.rows[lo]);return;}const mid=(lo+hi)>>>1;visit(node*2,lo,mid);visit(node*2+1,mid,hi);};
  visit(1,0,this.rows.length);return result;
 }
 startsBetween(start,end){const from=lower(this.rows,start,row=>row.start),to=lower(this.rows,end,row=>row.start);return this.rows.slice(from,to);}
}
export class ArrangementViewIndex {
 constructor(arrangement){
  this.arrangement=arrangement;
  const notes=[...(arrangement.notes||[])];
  for(const chord of arrangement.chords||[])for(const n of chord.notes||[])notes.push(Number.isFinite(n.time)?n:{...n,time:chord.time});
  this.notes=new IntervalIndex(notes);this.notesById=new Map(notes.map(n=>[n.id,n]));
  this.chords=new IntervalIndex(arrangement.chords||[],{end:c=>c.time+Math.max(c.sustain||0,...(c.notes||[]).map(n=>(n.time??c.time)-c.time+(n.sustain||0)))});
  this.zones=new IntervalIndex(arrangement.handshapes||[],{start:h=>h.start_time,end:h=>h.end_time});
  this.anchors=(arrangement.anchors||[]).map((item,index)=>({item,index})).sort((a,b)=>a.item.time-b.item.time||b.index-a.index);
  this.compactChords=new Set();const byTemplate=new Map();for(const c of arrangement.chords||[]){const group=byTemplate.get(c.chord_id)||[];group.push(c);byTemplate.set(c.chord_id,group);}for(const rows of byTemplate.values())rows.sort((a,b)=>a.time-b.time);
  for(const c of arrangement.chords||[]){
   let zone=null,zoneIndex=Infinity;
   for(const row of this.zones.between(c.time,c.time))if(row.item.chord_id===c.chord_id&&c.time<row.end&&(!zone||row.start>zone.start_time||row.start===zone.start_time&&row.index<zoneIndex)){zone=row.item;zoneIndex=row.index;}
   if(!zone)continue;const group=byTemplate.get(c.chord_id),first=lower(group,zone.start_time,row=>row.time);
   if(first<group.length&&group[first].time<c.time&&(c.notes||[]).every(n=>!(n.sustain>0)))this.compactChords.add(c);
  }
 }
 notesBetween(start,end){return this.notes.between(start,end).sort((a,b)=>a.index-b.index).map(row=>row.item);}
 chordsBetween(start,end){return this.chords.between(start,end).sort((a,b)=>a.index-b.index).map(row=>row.item);}
 zonesBetween(start,end){return this.zones.between(start,end);}
 anchorAt(time){let lo=0,hi=this.anchors.length;while(lo<hi){const mid=(lo+hi)>>>1;if(this.anchors[mid].item.time<=time)lo=mid+1;else hi=mid;}return this.anchors[lo-1]?.item;}
}
