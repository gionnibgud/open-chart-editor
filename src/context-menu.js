// Original accessible transient menu, scoped to one mounted editor.
export function openContextMenu(root,{x,y,items,onChoose,restoreFocus}){
 const menu=document.createElement('div'),abort=new AbortController();menu.className='ws-context-menu';menu.setAttribute('role','menu');menu.setAttribute('aria-label','Timeline actions');
 let closed=false;
 const close=(focus=false)=>{if(closed)return;closed=true;abort.abort();menu.remove();if(focus)restoreFocus?.focus();};
 const buttons=[];
 for(const item of items){const button=document.createElement('button');button.type='button';button.setAttribute('role','menuitem');button.textContent=item.label;button.disabled=item.disabled===true;button.dataset.contextAction=item.action;button.addEventListener('click',()=>{close();onChoose(item.action);},{signal:abort.signal});menu.appendChild(button);buttons.push(button);}
 root.appendChild(menu);const bounds=menu.getBoundingClientRect();menu.style.left=`${Math.max(0,Math.min(x,window.innerWidth-bounds.width-4))}px`;menu.style.top=`${Math.max(0,Math.min(y,window.innerHeight-bounds.height-4))}px`;
 const enabled=buttons.filter(button=>!button.disabled);enabled[0]?.focus();
 menu.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();close(true);return;}if(event.key==='Tab'){event.preventDefault();close(true);return;}if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const index=enabled.indexOf(document.activeElement),next=event.key==='Home'?0:event.key==='End'?enabled.length-1:(index+(event.key==='ArrowDown'?1:-1)+enabled.length)%enabled.length;enabled[next]?.focus();}},{signal:abort.signal});
 document.addEventListener('pointerdown',event=>{if(!menu.contains(event.target))close();},{capture:true,signal:abort.signal});
 window.addEventListener('blur',()=>close(),{signal:abort.signal});
 window.addEventListener('resize',()=>close(),{signal:abort.signal});
 return close;
}
