// Combining arrangements into one chart with tone changes (src/combine.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {makeProject,makeArrangement,makeNote} from '../src/model.js';
import {combineProblem,findOverlaps,combineArrangements} from '../src/combine.js';

// Four Guitar Pro style guitar tracks for one guitarist.
function song(){
 const p=makeProject();p.duration=30;
 const part=(name,notes,extra={})=>{const a=makeArrangement('guitar');a.name=name;a.notes=notes.map(([t,s,f,sus=0])=>makeNote(a,t,s,f,sus));a.tones={base:name,changes:[],definitions:{}};Object.assign(a,extra);return a;};
 const acoustic=part('Acoustic',[[0,0,3],[1,1,2],[2,2,0,.5]]);
 const rhythm=part('Rhythm',[[4,0,5],[5,1,7],[6,2,7,.4],[10,0,5,1.5],[11,1,7]]);
 const lead=part('Lead',[[6,2,7,.4],[10.5,4,12],[11,5,15,.5],[13,5,17]]);
 const delay=part('Delay',[[16,3,9],[17,3,11]]);
 rhythm.chord_templates=[{name:'A5',displayName:'A5',frets:[5,7,-1,-1,-1,-1],fingers:[1,3,-1,-1,-1,-1]}];
 rhythm.chords=[{time:8,chord_id:0,notes:[{string:0,fret:5,sustain:.5},{string:1,fret:7,sustain:.5}]}];
 rhythm.handshapes=[{chord_id:0,start_time:8,end_time:8.6}];
 lead.chord_templates=[{name:'E5',displayName:'E5',frets:[-1,-1,-1,-1,5,7],fingers:[-1,-1,-1,-1,1,3]},{name:'A5',displayName:'A5',frets:[5,7,-1,-1,-1,-1],fingers:[1,3,-1,-1,-1,-1]}];
 lead.chords=[{time:13.5,chord_id:1,notes:[{string:0,fret:5},{string:1,fret:7}]}];
 rhythm.anchors=[{time:4,fret:5,width:4}];lead.anchors=[{time:10,fret:12,width:4},{time:13,fret:15,width:4}];
 p.arrangements=[acoustic,rhythm,lead,delay];
 return p;
}
const ids=p=>p.arrangements.map(a=>a.id);

test('only compatible arrangements can be combined', () => {
 const p=song(),[a,b]=p.arrangements;
 assert.match(combineProblem(p,[a.id]),/at least two/);
 const bass=makeArrangement('bass');p.arrangements.push(bass);assert.match(combineProblem(p,[a.id,bass.id]),/same instrument/);
 b.tuning=b.tuning.map(()=>-1);assert.match(combineProblem(p,[a.id,b.id]),/different tuning/);
 b.tuning=b.tuning.map(()=>0);b.capo=2;assert.match(combineProblem(p,[a.id,b.id]),/different capo/);
 b.capo=0;b.difficulties=[{difficulty:0},{difficulty:1}];assert.match(combineProblem(p,[a.id,b.id]),/difficulty levels/);
});

test('overlaps are found and classified', () => {
 const p=song(),overlaps=findOverlaps(p,ids(p));
 assert.deepEqual(overlaps.map(o=>[o.kind,o.start,o.sameString]),[['duplicate',6,true],['conflict',10,false]]);
 assert.deepEqual(overlaps[1].sources,[p.arrangements[1].id,p.arrangements[2].id]);
 assert.equal(overlaps[1].decision,'keep:'+p.arrangements[1].id,'the default keeps the part listed first');
});

test('combining keeps one chart with a tone change per part', () => {
 const p=song(),before=JSON.stringify(p),[acoustic,rhythm,lead,delay]=p.arrangements;
 const overlaps=findOverlaps(p,ids(p));
 const {arrangement:out,report}=combineArrangements(p,ids(p),{name:'Guitar',overlaps,tones:{[delay.id]:'Écho'},decisions:{[overlaps[1].id]:'keep:'+lead.id}});
 assert.equal(JSON.stringify(p),before,'sources are not modified');
 assert.deepEqual(out.notes.map(n=>n.time),[0,1,2,4,5,6,10.5,11,13,16,17],'duplicate kept once; rhythm notes inside the solo overlap dropped');
 assert.deepEqual(out.tones.changes.map(c=>[+c.time.toFixed(2),c.name]),[[3.5,'Rhythm'],[10,'Lead'],[15.5,'Écho']]);
 assert.equal(out.tones.base,'Acoustic');assert.deepEqual(Object.keys(out.tones.definitions).sort(),['Acoustic','Lead','Rhythm','Écho'].sort());
 assert.deepEqual(out.chord_templates.map(t=>t.name),['A5','E5'],'identical A5 shapes merged');
 assert.deepEqual(out.chords.map(c=>[c.time,c.chord_id]),[[8,0],[13.5,0]],'chord shape references remapped');
 assert.deepEqual(out.handshapes.map(h=>[h.start_time,h.chord_id]),[[8,0]]);
 assert.deepEqual(out.anchors.map(a=>[a.time,a.fret]),[[4,5],[10.5,12],[13,15]],'each run uses its own part\'s hand positions');
 assert.equal(report.dropped,3);assert.equal(out.combineReview.length,2);
 assert.ok(new Set([...out.notes.map(n=>n.id),...p.arrangements.flatMap(a=>a.notes.map(n=>n.id))]).size===out.notes.length+p.arrangements.reduce((n,a)=>n+a.notes.length,0),'new note IDs');
});

test('keeping both parts: refused for clashes, sustains trimmed otherwise', () => {
 const p=song(),[,rhythm,lead]=p.arrangements;
 lead.notes.find(n=>n.time===11).string=1;lead.notes.find(n=>n.time===11).fret=9;     // same string, same time, other fret
 let overlaps=findOverlaps(p,[rhythm.id,lead.id]);
 assert.throws(()=>combineArrangements(p,[rhythm.id,lead.id],{overlaps,decisions:{[overlaps[1].id]:'both'}}),/same string/);
 const q=song(),[,r2,l2]=q.arrangements;l2.notes=[makeNote(l2,10.5,0,7)];
 overlaps=findOverlaps(q,[r2.id,l2.id]);const solo=overlaps.find(o=>o.start===10);
 const {arrangement:out}=combineArrangements(q,[r2.id,l2.id],{overlaps,decisions:{[solo.id]:'both'}});
 assert.equal(+out.notes.find(n=>n.time===10).sustain.toFixed(3),.49,'rhythm sustain stops before the lead note on the same string');
 assert.deepEqual(out.tones.changes.map(c=>[c.time,c.name]),[[13,'Lead']],'no tone switching inside the kept-both overlap; one switch for the later lead chord');
});
