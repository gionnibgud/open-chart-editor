// Complete synchronous validation cached per authoring revision, with bounded UI pages.
import {findChartIssues} from './validation.js';
import {findOceIssues} from './oce-checks.js';
const contentIssue=issue=>/\.(notes|chords|anchors|handshapes)\[/.test(issue.path||'')||issue.code==='phrase.anchor';
export class IssueFinder {
 constructor({analyze=findChartIssues,oce=findOceIssues,pageSize=100}={}){if(!Number.isInteger(pageSize)||pageSize<1||pageSize>500)throw Error('Choose 1 to 500 findings per page');this.analyze=analyze;this.oce=oce;this.pageSize=pageSize;this.cache=new Map();this.history=null;this.listener=()=>this.cache.clear();}
 bind(history){if(this.history!==history){this.dispose();this.history=history;history.listeners.add(this.listener);}return this;}
 dispose(){this.history?.listeners.delete(this.listener);this.history=null;this.cache.clear();}
 get(profile='feedpak'){
  if(!this.history)throw Error('Bind an authoring history before analyzing');
  if(!['feedpak','cdlc','oce'].includes(profile))throw Error('Unknown validation profile');
  if(this.cache.has(profile))return this.cache.get(profile);
  const project=this.history.project,target=profile==='oce'?'feedpak':profile,byId=new Map(project.arrangements.map(a=>[a.id,a]));
  const activeId=a=>a.activeDifficulty??Math.max(...(a.difficulties||[]).map(l=>l.difficulty));
  const annotate=issue=>{const a=byId.get(issue.arrangement);return a?.difficulties?.length&&contentIssue(issue)?{...issue,difficulty:activeId(a)}:issue;};
  const issues=this.analyze(project,{target}).map(annotate);
  if(profile==='oce')issues.push(...this.oce(project).map(annotate));
  for(const arrangement of project.arrangements)for(const level of arrangement.difficulties||[]){
   if(level.difficulty===activeId(arrangement))continue;
   const view={...arrangement,...Object.fromEntries(['notes','chords','anchors','handshapes'].map(key=>[key,level[key]||[]]))};
   const tierProject={...project,arrangements:[view]};
   issues.push(...this.analyze(tierProject,{target,includeVocals:false}).filter(i=>i.arrangement===arrangement.id&&contentIssue(i)).map(i=>({...i,difficulty:level.difficulty})));
   if(profile==='oce')issues.push(...this.oce(tierProject).filter(i=>i.code!=='oce.sections').map(i=>({...i,difficulty:level.difficulty})));
  }
  issues.push(...(project.import_warnings||[]).map(message=>({code:'import.warning',severity:'warning',time:0,message:String(message)})));
  const record={issues,indices:new Map(issues.map((issue,index)=>[issue,index])),errors:issues.filter(i=>i.severity==='error'),warnings:issues.filter(i=>i.severity==='warning')};this.cache.set(profile,record);return record;
 }
 page({profile='feedpak',filter='all',page=0}={}){
  const record=this.get(profile);if(!['all','error','warning'].includes(filter))throw Error('Unknown findings filter');const rows=filter==='error'?record.errors:filter==='warning'?record.warnings:record.issues;
  const pages=Math.max(1,Math.ceil(rows.length/this.pageSize));page=Math.max(0,Math.min(pages-1,Math.floor(Number(page))||0));const start=page*this.pageSize;
  return {issues:rows.slice(start,start+this.pageSize),page,pages,total:record.issues.length,filtered:rows.length,errors:record.errors.length,warnings:record.warnings.length,start:rows.length?start+1:0,end:Math.min(start+this.pageSize,rows.length)};
 }
}
export function issueTarget(project,issue){
 if(issue.code?.startsWith('vocal.')||issue.code==='vocals.invalid'){const rows=Array.isArray(project.vocals)?project.vocals:[];let index=typeof issue.vocalId==='string'?rows.findIndex(row=>row?.id===issue.vocalId):-1;if(index<0&&Number.isInteger(issue.vocalIndex)&&issue.vocalIndex>=0&&issue.vocalIndex<rows.length)index=issue.vocalIndex;const row=rows[index],field=/\.(time|length|pitch|text)$/.exec(issue.path||'')?.[1]||'text';return{view:'vocals',time:Math.max(0,Number(row?.time??issue.time)||0),...(index>=0?{vocalIndex:index}:{}),...(typeof row?.id==='string'?{vocalId:row.id}:{}),vocalField:field};}
 const arrangement=project.arrangements.find(a=>a.id===issue.arrangement);if(!arrangement)return {time:Math.max(0,Number(issue.time)||0)};
 const level=Number.isInteger(issue.difficulty)?arrangement.difficulties?.find(l=>l.difficulty===issue.difficulty):null;
 if(Number.isInteger(issue.difficulty)&&!level)throw Error('This finding refers to a difficulty that no longer exists; refresh the analysis');
 const content=level&&level.difficulty!==arrangement.activeDifficulty?level:arrangement,notes=[...content.notes||[],...(content.chords||[]).flatMap(c=>c.notes||[])];
 const note=notes.find(n=>n.id===issue.note),marker=note?null:/\.(anchors|phrases)\[(\d+)\]/.exec(issue.path||'');
 return {arrangementId:arrangement.id,...(level?{difficulty:level.difficulty}:{}),time:Math.max(0,Number(issue.time)||0),...(note?{noteId:note.id}:{}),...(marker?{marker:{kind:marker[1],index:Number(marker[2])}}:{})};
}
