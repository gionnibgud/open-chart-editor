// Only the small source windows needed for the next spectral chunk cross the
// worker boundary. Decoded whole-song buffers and source exports stay put.
export function spectralSourceRanges(centers,{length,sampleRate}, {fftSize=4096,loop=null}={}){
 if(!centers.length)return[];const low=Math.floor(centers[0]-fftSize/2)-1,high=Math.ceil(centers.at(-1)+fftSize/2)+2;
 const clamp=(a,b)=>[Math.max(0,Math.floor(a)),Math.min(length,Math.ceil(b))];
 if(!loop?.enabled){const range=clamp(low,high);return range[1]>range[0]?[range]:[];}
 const lower=loop.start*sampleRate,upper=loop.end*sampleRate,span=upper-lower;if(!(span>0))throw Error('Invalid spectral loop');
 const ranges=[];let periodicLow=low;
 // Transport plays the prefix normally until the first loop end is reached.
 if(low<upper){ranges.push(clamp(low,Math.min(high,upper)+2));periodicLow=upper;}
 if(high>upper){
  const a=Math.max(periodicLow,upper),wrap=n=>lower+((n-upper)%span+span)%span;
  if(high-a>=span)ranges.push(clamp(lower-1,upper+2));
  else{const first=wrap(a),last=wrap(high),same=Math.floor((a-upper)/span)===Math.floor((high-upper)/span);if(same)ranges.push(clamp(first-1,last+2));else ranges.push(clamp(lower-1,last+2),clamp(first-1,upper+2));}
 }
 const ordered=ranges.filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0]),merged=[];for(const range of ordered){const previous=merged.at(-1);if(previous&&range[0]<=previous[1])previous[1]=Math.max(previous[1],range[1]);else merged.push(range);}return merged;
}
