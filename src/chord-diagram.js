// Original read-only voicing diagram; source frets are always capo-relative.
import {displayFret,validCapo} from './fret-display.js';
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function chordDiagram(template,{stringCount=template?.frets?.length,capo=0,convention='relative'}={}){
 capo=validCapo(capo);
 if(!Number.isInteger(stringCount)||stringCount<4||stringCount>8)throw Error('Chord diagrams support four through eight strings');
 if(!['relative','physical'].includes(convention))throw Error('Unknown fret display convention');
 const frets=Array.from({length:stringCount},(_,s)=>template?.frets?.[s]??-1),fingers=Array.from({length:stringCount},(_,s)=>template?.fingers?.[s]??-1);
 if(frets.some(f=>!Number.isInteger(f)||f< -1||f>24-capo))throw Error('Resolve invalid frets to display this voicing');
 if(fingers.some(f=>!Number.isInteger(f)||f< -1||f>4))throw Error('Resolve invalid fingers to display this voicing');
 const stopped=frets.filter(f=>f>0),first=stopped.length&&Math.min(...stopped)>4?Math.min(...stopped):1,last=Math.max(first+3,...stopped),rows=Math.max(0,Math.min(24-capo,last)-first+1);
 const left=44,top=48,gap=30,row=26,right=left+(stringCount-1)*gap,bottom=top+rows*row,width=right+30,height=bottom+42;
 const descriptions=frets.map((f,s)=>`String ${s+1}: ${f<0?'unused':f===0?(capo?'open at capo '+capo:'open'):'fret '+displayFret(f,capo,convention)}${f>0&&fingers[s]>=0?', '+(fingers[s]===0?'thumb':'finger '+fingers[s]):''}`);
 const title=(template?.name||'Chord')+'; low strings on the left; '+(convention==='physical'?'physical':'capo-relative')+' frets'+(capo?'; capo '+capo:'');
 let body=`<title>${escape(title)}</title><desc>${escape(descriptions.join('; '))}</desc>`;
 for(let r=0;r<=rows;r++){const y=top+r*row;body+=`<line x1="${left}" x2="${right}" y1="${y}" y2="${y}" stroke="currentColor" stroke-opacity=".6" stroke-width="${r===0&&first===1?4:1}"/>`;if(r<rows)body+=`<text x="${left-13}" y="${y+row*.65}" text-anchor="end" font-size="11" fill="currentColor">${displayFret(first+r,capo,convention)}</text>`;}
 for(let s=0;s<stringCount;s++){
  const x=left+s*gap,fret=frets[s];body+=`<line x1="${x}" x2="${x}" y1="${top}" y2="${bottom}" stroke="currentColor" stroke-opacity=".5"/><text x="${x}" y="${bottom+19}" text-anchor="middle" font-size="10" fill="currentColor">${s+1}</text>`;
  if(fret<0)body+=`<text data-string="${s}" data-fret="-1" x="${x}" y="${top-13}" text-anchor="middle" font-size="16" fill="currentColor">&#215;</text>`;
  else if(fret===0)body+=`<circle data-string="${s}" data-fret="0" cx="${x}" cy="${top-18}" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/>`;
  else{const y=top+(fret-first+.5)*row;body+=`<g data-string="${s}" data-fret="${fret}" data-finger="${fingers[s]}"><circle cx="${x}" cy="${y}" r="10" fill="#258ed3"/><text x="${x}" y="${y+3.5}" text-anchor="middle" font-size="11" fill="white">${fingers[s]<0?'':fingers[s]===0?'T':fingers[s]}</text></g>`;}
 }
 body+=`<text x="${left}" y="${height-5}" font-size="10" fill="currentColor">Low to high${capo?' / capo '+capo:''}</text>`;
 return `<svg class="ws-chord-diagram" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escape(title+'; '+descriptions.join('; '))}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${body}</svg>`;
}
