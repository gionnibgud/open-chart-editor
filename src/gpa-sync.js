/** Guitar Pro audio sync (GPA export <track><sync>) to an editor beat map.
 * Sync text: "count#ms;bar;fraction;msPerQuarter#..." where bar is 0-based and
 * fraction is the position within that bar (0..1). The chart keeps its own bar
 * and beat structure; only beat times change, so notes can follow their beats.
 */
export function parseGpaSync(text){
 const doc=new DOMParser().parseFromString(text,'application/xml');
 const track=doc.documentElement,sync=track?.querySelector(':scope > sync')?.textContent?.trim();
 if(track?.nodeName!=='track'||!sync)throw Error('Not a GPA sync file: expected <track> with <sync>');
 const [count,...rows]=sync.split('#').filter(Boolean);
 const points=rows.map(row=>{const [ms,bar,fraction,msPerBeat]=row.split(';').map(Number);return {time:ms/1000,bar,fraction,msPerBeat};});
 if(points.length!==Number(count)||points.some(p=>![p.time,p.bar,p.fraction,p.msPerBeat].every(Number.isFinite)||!Number.isInteger(p.bar)||p.bar<0||p.fraction<0||p.fraction>=1||p.msPerBeat<=0))throw Error('GPA sync points are malformed');
 return {title:track.getAttribute('title')||'',artist:track.getAttribute('artist')||'',score:track.querySelector(':scope > scoreUrl')?.textContent?.trim()||'',audio:track.querySelector(':scope > audioUrl')?.textContent?.trim()||'',points};
}

/** Share of note and chord starts lying on the beat map's 1/16 or triplet
 * grid (within 5 ms). A score's own map scores near 1; a map that does not
 * describe the notes (for example a stale default grid) scores low. */
export function notesOnGrid(project,tolerance=.005){
 const beats=(project.beats||[]).map(b=>b.time);if(beats.length<2)return 0;
 const starts=project.arrangements.flatMap(a=>[...(a.notes||[]).map(n=>n.time),...(a.chords||[]).map(c=>c.time)]);
 if(!starts.length)return 1;
 let on=0;
 for(const t of starts){
  let lo=0,hi=beats.length-2;while(lo<hi){const mid=(lo+hi+1)>>1;if(beats[mid]<=t)lo=mid;else hi=mid-1;}
  const offset=t-beats[lo],length=beats[lo+1]-beats[lo];
  if([4,3,6].some(division=>{const step=length/division;return Math.abs(offset-Math.round(offset/step)*step)<=tolerance;}))on++;
 }
 return on/starts.length;
}

/** New beat times from sync points; between points beats are spaced evenly,
 * outside them the nearest point's own tempo continues. */
export function gpaBeatMap(beats,points){
 const downbeats=beats.map((b,i)=>b.measure>=0?i:-1).filter(i=>i>=0);
 if(!downbeats.length||!points.length)throw Error('GPA sync needs bars in the chart and at least one sync point');
 const anchors=points.map(p=>{
  if(p.bar>=downbeats.length)throw Error(`GPA sync reaches bar ${p.bar+1}, but this chart has ${downbeats.length} bars; was the score changed after syncing?`);
  const start=downbeats[p.bar],end=downbeats[p.bar+1]??beats.length,denominator=beats[start].denominator||4;
  return {beat:start+p.fraction*(end-start),time:p.time,seconds:p.msPerBeat/1000*4/denominator};
 });
 if(anchors.some((a,i)=>i&&(a.beat<=anchors[i-1].beat||a.time<=anchors[i-1].time)))throw Error('GPA sync points must move forward in both bars and time');
 const first=anchors[0],last=anchors.at(-1);
 const timeAtBeat=i=>{
  if(i<=first.beat)return first.time-(first.beat-i)*first.seconds;
  if(i>=last.beat)return last.time+(i-last.beat)*last.seconds;
  let k=1;while(anchors[k].beat<i)k++;const a=anchors[k-1],b=anchors[k];
  return a.time+(i-a.beat)/(b.beat-a.beat)*(b.time-a.time);
 };
 const next=beats.map((b,i)=>({...b,time:Math.round(timeAtBeat(i)*1e6)/1e6}));
 if(next[0].time<0)throw Error(`GPA sync puts the first beat at ${next[0].time.toFixed(3)} s, before the audio starts`);
 return next;
}
