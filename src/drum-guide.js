// Original deterministic percussion listening aids. No samples, presets or DSP
// from a game are used. One-shots retain their timbre at preview speed changes.
const KITS={
 kick:[.36,52,.06,1,18],snare:[.28,180,.8,.28,20],snare_xstick:[.12,820,.18,.8,42],
 hh_closed:[.11,6800,1,.08,45],hh_open:[.75,6200,1,.08,8],hh_pedal:[.09,5200,.9,.06,50],
 tom_low:[.45,110,.12,.9,12],tom_mid:[.4,150,.1,.9,14],tom_hi:[.34,205,.1,.9,16],tom_floor:[.55,82,.15,.9,10],
 crash_l:[1.5,3300,.8,.22,4],crash_r:[1.4,3900,.8,.22,4.3],ride:[.9,2100,.45,.5,6],ride_bell:[.8,1050,.08,.85,6],
 splash:[.6,4800,.8,.24,10],china:[1.1,2700,.9,.2,5],stack:[.23,3900,1,.15,25],bell:[.85,700,.04,.95,5.5]
};
export const drumPiece=piece=>Object.hasOwn(KITS,piece)?piece:'snare';
const kit=piece=>KITS[drumPiece(piece)],cache=new Map();
export function drumDuration(note){const base=kit(note.piece)[0],choke=Number.isFinite(note.choke)&&note.choke>0?note.choke:Infinity;return Math.max(.001,Math.min(base,choke,note._guideDuration??Infinity));}
export function drumGain(note){return (note.ghost?.35:1)*(note._guideGrace?.5:1);}
export function drumEvents(source){
 const closers=source.filter(n=>['hh_closed','hh_pedal'].includes(n.piece)&&Number.isFinite(n.time)).map(n=>n.time).sort((a,b)=>a-b);
 const nextClose=time=>{let lo=0,hi=closers.length;while(lo<hi){const mid=(lo+hi)>>1;if(closers[mid]<time)lo=mid+1;else hi=mid;}return closers[lo]??Infinity;};
 return source.flatMap(n=>{const note={...n};delete note._guideDuration;delete note._guideGrace;if(n.piece==='hh_open')note._guideDuration=Math.min(drumDuration(note),Math.max(.001,nextClose(n.time)-n.time));const result=[];if(n.flam&&n.time>=.025)result.push({...note,time:n.time-.025,flam:false,_guideGrace:true,_guideDuration:Math.min(drumDuration(note),.025)});result.push(note);return result;});
}
export function drumSamples(piece,sampleRate){
 if(!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>192000)throw Error('Invalid percussion sample rate');
 piece=drumPiece(piece);const key=piece+':'+sampleRate;if(cache.has(key))return cache.get(key);
 const [duration,frequency,noiseLevel,toneLevel,decay]=kit(piece),samples=new Float32Array(Math.ceil(duration*sampleRate));let seed=0x13579bdf,previous=0;
 for(const char of String(piece))seed=(Math.imul(seed,31)+char.charCodeAt(0))>>>0;
 for(let i=0;i<samples.length;i++){
  const t=i/sampleRate;seed=(Math.imul(seed,1664525)+1013904223)>>>0;const noise=seed/0x80000000-1,bright=noise-.65*previous;previous=noise;
  const phase=piece==='kick'?2*Math.PI*(frequency*t+20*(1-Math.exp(-35*t))/35):2*Math.PI*frequency*t;
  const instantaneous=piece==='kick'?frequency+20*Math.exp(-35*t):frequency,nyquist=sampleRate/2;
  const metal=(instantaneous<nyquist?Math.sin(phase):0)+(instantaneous*1.483<nyquist?.3*Math.sin(phase*1.483):0)+(instantaneous*2.031<nyquist?.18*Math.sin(phase*2.031):0);
  const value=(noiseLevel*bright+toneLevel*metal)*Math.exp(-decay*t)*Math.min(1,t/.001)*Math.min(1,(duration-t)/.006);
  samples[i]=Math.max(-1,Math.min(1,value*.65));
 }
 if(cache.size>=36)cache.clear();cache.set(key,samples);return samples;
}

export function drumFades(span){return {attack:Math.min(.004,span/3),release:Math.min(.005,span/3)};}
export function drumEnvelope(time,span,offset=0){if(time<0||time>=span)return 0;const {attack,release}=drumFades(span);return Math.min(1,(span-time)/release)*(offset>0?Math.min(1,time/attack):1);}
