import {test} from 'node:test';
import assert from 'node:assert/strict';
import {findVocalIssues,NATIVE_VOCAL_UTF8_LIMIT} from '../src/vocal-validation-candidate.js';
const row=(extra={})=>({id:'own',time:1,length:.5,text:'Own',...extra});
const project=(vocals,duration=12)=>({duration,vocals});
const codes=issues=>issues.map(i=>i.code);

test('valid zero length and optional full-range pitches remain valid without source mutation',()=>{
 for(const pitch of [undefined,null,0,60,127]){
  const p=project([row({pitch,length:0,_lyricWire:{opaque:true}})]),before=structuredClone(p);
  assert.deepEqual(findVocalIssues(p),[]);assert.deepEqual(p,before);
 }
 assert.deepEqual(findVocalIssues({duration:0}),[]);assert.deepEqual(findVocalIssues(null),[]);
});

test('malformed container/rows and required time/length yield navigable descriptors without fake notes',()=>{
 assert.equal(findVocalIssues(project({}))[0].code,'vocals.invalid');
 const p=project([null,[],row({time:NaN,length:-1}),row({id:undefined,time:Infinity,length:undefined})]);
 const issues=findVocalIssues(p);assert.deepEqual(codes(issues),['vocal.invalid','vocal.invalid','vocal.time','vocal.length','vocal.time','vocal.length']);
 assert.deepEqual(issues.find(i=>i.code==='vocal.time'&&i.vocalIndex===2),{code:'vocal.time',severity:'error',message:'Vocal time must be finite and non-negative.',path:'vocals[2].time',time:0,vocalIndex:2,vocalId:'own'});
 for(const i of issues){assert.equal(Object.hasOwn(i,'note'),false);assert.equal(Object.hasOwn(i,'arrangement'),false);}
});

test('optional pitch rejects fractional, nonnumeric, infinite and out-of-range values',()=>{
 for(const pitch of [-1,128,.5,NaN,Infinity,'60',true])assert.deepEqual(codes(findVocalIssues(project([row({pitch})]))),['vocal.pitch']);
});

test('nonstring text errors; empty/whitespace lyric is advisory except explicit pitch-only source events',()=>{
 for(const text of [undefined,null,0,false,{}])assert.deepEqual(codes(findVocalIssues(project([row({text})]))),['vocal.text']);
 for(const text of ['','  ','\t\n'])assert.equal(findVocalIssues(project([row({text})]))[0].severity,'warning');
 assert.deepEqual(findVocalIssues(project([row({text:'',pitch:60,_pitchOnly:true})])),[]);
 assert.ok(codes(findVocalIssues(project([row({text:'',_pitchOnly:'true'})]))).includes('vocal.emptyText'));
});

test('end outside duration is advisory with configurable noise tolerance; overflow is malformed',()=>{
 assert.equal(findVocalIssues(project([row({time:11.5,length:1})]))[0].severity,'warning');
 assert.deepEqual(findVocalIssues(project([row({time:12,length:.0005})])),[]);
 assert.equal(findVocalIssues(project([row({time:12,length:.0005})]),{epsilon:0})[0].code,'vocal.afterSong');
 assert.equal(findVocalIssues(project([row({time:1e308,length:1e308})]))[0].code,'vocal.end');
 assert.deepEqual(findVocalIssues(project([row()],NaN)),[]); // shared validator owns invalid duration
});

test('native limit counts raw UTF8 including every trailing marker and never normalizes Unicode',()=>{
 assert.equal(NATIVE_VOCAL_UTF8_LIMIT,47);
 const good=['a'.repeat(47),'é'.repeat(23)+'+','😀'.repeat(11)+'abc'];
 for(const text of good)assert.deepEqual(findVocalIssues(project([row({text})]),'cdlc'),[]);
 const bad=['a'.repeat(47)+'-','é'.repeat(23)+'a+','😀'.repeat(12)];
 for(const text of bad){const issue=findVocalIssues(project([row({text})]),'cdlc')[0];assert.equal(issue.code,'vocal.nativeLength');assert.equal(issue.severity,'error');assert.equal(issue.utf8Bytes,48);}
 const nfd='e\u0301'.repeat(16),nfc=nfd.normalize('NFC');
 assert.equal(findVocalIssues(project([row({text:nfd})]),'cdlc')[0].utf8Bytes,48);assert.deepEqual(findVocalIssues(project([row({text:nfc})]),'cdlc'),[]);
 assert.deepEqual(findVocalIssues(project([row({text:'word+'}),row({text:'joined-'})]),'cdlc'),[]);
});

test('Feedpak permits long lyrics while XML reports advisory native compilation compatibility',()=>{
 const p=project([row({text:'own '.repeat(100)})]);assert.deepEqual(findVocalIssues(p),[]);
 for(const target of ['xml','vocal_xml']){const [issue]=findVocalIssues(p,{target});assert.equal(issue.severity,'warning');assert.match(issue.message,/RS2014 native compilation limit/);}
 assert.equal(findVocalIssues(p,{target:'cdlc'})[0].severity,'error');
});

test('strict scalar byte count agrees with an independent TextEncoder oracle across original Unicode fixtures',()=>{
 let seed=73291;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296),alphabet=['a','+','-','é','e\u0301','漢','😀','\u{10ffff}'];
 for(let i=0;i<1000;i++){
  let text='';const length=Math.floor(random()*60);for(let j=0;j<length;j++)text+=alphabet[Math.floor(random()*alphabet.length)];
  const bytes=new TextEncoder().encode(text).length,issue=findVocalIssues(project([row({text})]),'cdlc').find(i=>i.code==='vocal.nativeLength');
  assert.equal(!!issue,bytes>47);if(issue)assert.equal(issue.utf8Bytes,bytes);
 }
});

test('lone UTF16 surrogates fail strict encoding on every target; complete pairs remain valid',()=>{
 for(const target of ['feedpak','cdlc','xml','vocal_xml'])for(const text of ['\ud800','\udc00','own\ud800x'])assert.ok(codes(findVocalIssues(project([row({text})]),{target})).includes('vocal.encoding'));
 assert.deepEqual(findVocalIssues(project([row({text:'Own 😀 voice'})]),'cdlc'),[]);
});

test('same-time duplicate syllables and overlaps are not invented validation errors',()=>{
 const p=project([row({id:'a',length:4}),row({id:'b',text:'Other',length:3}),row({id:'c',time:2,text:'Overlap'})]);
 assert.deepEqual(findVocalIssues(p,'cdlc'),[]);
});

test('embedded NUL is native field loss for CDLC and invalid XML, while editable Feedpak retains it',()=>{
 const p=project([row({text:'Own\u0000tail'})]),before=structuredClone(p);
 assert.deepEqual(findVocalIssues(p),[]);
 const native=findVocalIssues(p,'cdlc');assert.equal(native[0].code,'vocal.nativeNul');assert.equal(native[0].severity,'error');assert.equal(native[0].characterIndex,3);assert.match(native[0].message,/loses following text/);
 for(const target of ['xml','vocal_xml']){const [issue]=findVocalIssues(p,target);assert.equal(issue.code,'vocal.xmlCharacter');assert.equal(issue.severity,'error');assert.equal(issue.codePoint,0);}
 assert.deepEqual(p,before);
});

test('XML1.0 character contract rejects forbidden controls and BMP noncharacters without a font whitelist',()=>{
 for(const point of [1,8,11,12,14,31,0xfffe,0xffff]){
  const p=project([row({text:'Own'+String.fromCodePoint(point)})]);
  assert.deepEqual(findVocalIssues(p),[]);
  for(const target of ['cdlc','xml','vocal_xml'])assert.equal(findVocalIssues(p,target)[0].code,'vocal.xmlCharacter');
 }
 for(const point of [9,10,13,0x20,0x85,0xd7ff,0xe000,0xfffd,0x10000,0x1fffe,0x10ffff])assert.deepEqual(findVocalIssues(project([row({text:'Own'+String.fromCodePoint(point)})]),'xml'),[]);
});

test('100000 events are scanned linearly and every issue keeps the correct global vocal index',{timeout:15000},()=>{
 const p=project(Array.from({length:100000},(_,i)=>row({id:'own'+i,time:i/10,text:i%2?'Own':'a'.repeat(48)})),10001),before=p.vocals[99998].text;
 const issues=findVocalIssues(p,'cdlc');assert.equal(issues.length,50000);assert.equal(issues.at(-1).vocalIndex,99998);assert.equal(issues.at(-1).vocalId,'own99998');assert.equal(p.vocals[99998].text,before);
});
