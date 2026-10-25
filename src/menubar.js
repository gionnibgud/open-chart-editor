// Desktop-style keyboard navigation scoped to this editor's own menu bar.
// F10 enters the bar; existing chart accelerators keep their meanings.
export function mountMenubar(root,{signal,restoreFocus}={}){
 const bar=root.querySelector('.ws-menu'),menus=[...bar.querySelectorAll(':scope > details')],summaries=menus.map(d=>d.querySelector('summary'));
 const listen=(target,event,fn,options={})=>target.addEventListener(event,fn,{...options,signal});
 const close=()=>menus.forEach((d,i)=>{d.open=false;summaries[i].setAttribute('aria-expanded','false');}),items=index=>[...menus[index].querySelectorAll('button')].filter(b=>!b.disabled&&!b.hidden);
 const focus=index=>{summaries.forEach((s,i)=>s.tabIndex=i===index?0:-1);summaries[index].focus();};
 const open=(index,last=false)=>{close();menus[index].open=true;summaries[index].setAttribute('aria-expanded','true');focus(index);const buttons=items(index);(last?buttons.at(-1):buttons[0])?.focus();};
 bar.setAttribute('role','menubar');bar.setAttribute('aria-label','Editor menus');
 menus.forEach((details,index)=>{const summary=summaries[index];summary.tabIndex=index===0?0:-1;summary.setAttribute('role','menuitem');summary.setAttribute('aria-haspopup','menu');summary.setAttribute('aria-expanded','false');details.querySelector('div')?.setAttribute('role','menu');for(const button of details.querySelectorAll('button'))button.setAttribute('role','menuitem');listen(details,'toggle',()=>{summary.setAttribute('aria-expanded',String(details.open));if(details.open)menus.forEach((other,i)=>{if(i!==index)other.open=false;});});});
 listen(root,'keydown',event=>{if(event.key!=='F10'||event.shiftKey||event.ctrlKey||event.altKey||event.metaKey||root.querySelector('dialog[open]'))return;event.preventDefault();event.stopPropagation();close();focus(0);},{capture:true});
 listen(bar,'keydown',event=>{
  if(event.ctrlKey||event.metaKey||event.altKey)return;
  const menu=event.target.closest('details'),index=menus.indexOf(menu);if(index<0)return;
  const summary=event.target===summaries[index],buttons=items(index),current=buttons.indexOf(document.activeElement);
  if(event.key==='Tab'){close();return;}
  event.stopPropagation();
  if(event.key==='Escape'){event.preventDefault();const wasOpen=menu.open;close();if(wasOpen)focus(index);else restoreFocus?.focus();}
  else if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const next=(index+(event.key==='ArrowRight'?1:-1)+menus.length)%menus.length;if(menu.open)open(next);else focus(next);}
  else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();if(summary)open(index,event.key==='ArrowUp'||event.key==='End');else{const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(current+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[next]?.focus();}}
  else if(summary&&['Enter',' '].includes(event.key)){event.preventDefault();open(index);}
  else if(event.key.length===1&&!/\s/.test(event.key)){event.preventDefault();for(let step=1;step<=buttons.length;step++){const button=buttons[(current+step+buttons.length)%buttons.length];if(button.textContent.trim().toLowerCase().startsWith(event.key.toLowerCase())){button.focus();break;}}}
 });
 listen(document,'pointerdown',event=>{if(!bar.contains(event.target))close();},{capture:true});
 listen(bar,'click',event=>{if(event.target.closest('button'))close();});
 signal?.addEventListener('abort',close,{once:true});
}
