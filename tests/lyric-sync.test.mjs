// Lyric sheet, English syllable suggestion and tap timing (src/lyric-sync.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {sheetSyllables,sheetText,lines,suggestSyllables,suggestSheet,syllables,reconcileSheet,TapSession,commitTaps,karaoke,snapStarts,longLines,lineOf} from '../src/lyric-sync.js';

let next=0;const uid=()=>'new'+(++next);

test('sheet text becomes wire syllables and back', () => {
 const wires=sheetSyllables('Here comes the morn-ing light\n\na-cross the hills').map(s=>s.text);
 assert.deepEqual(wires,['Here','comes','the','morn-','ing','light+','a-','cross','the','hills+']);
 assert.equal(sheetText(wires),'Here comes the morn-ing light\na-cross the hills');
 assert.deepEqual(lines(wires).map(l=>[l.start,l.end,l.text]),[[0,5,'Here comes the morn-ing light'],[6,9,'a-cross the hills']]);
});

test('any language or script is kept exactly', () => {
 const text='夜空に 星が 光る\nCorazón, mi a-mor\nНочь ти-ха\nكل شيء\n🎵 la la';
 const wires=sheetSyllables(text).map(s=>s.text);
 assert.equal(sheetText(wires),text);
 assert.deepEqual(wires.slice(0,3),['夜空に','星が','光る+']);
 assert.ok(wires.includes('ти-')&&wires.includes('ха+'));
 assert.deepEqual(suggestSheet(text).changes,[],'non-English words are never split by the suggestion');
 for(const word of ['café','naïve','Straße','corazón','夜空','Ночь'])assert.deepEqual(suggestSyllables(word),[word]);
});

test('English suggestions cover common lyric words', () => {
 const expected={morning:'morn-ing',across:'a-cross',again:'a-gain',little:'lit-tle',table:'ta-ble',beautiful:'beau-ti-ful',running:'run-ning',wanted:'want-ed',walked:'walked',times:'times',fire:'fire',nation:'na-tion',revolution:'re-vo-lu-tion',remember:'re-mem-ber',yesterday:'yes-ter-day',people:'peo-ple',someone:'some-one',sunshine:'sun-shine',window:'win-dow',under:'un-der',into:'in-to',stronger:'strong-er',Hallelujah:'Hal-le-lu-jah',Tonight:'To-night'};
 for(const [word,split] of Object.entries(expected))assert.equal(suggestSyllables(word).join('-'),split,word);
 assert.deepEqual(suggestSyllables("don't"),["don't"]);
});

test('suggestions keep punctuation and the author\'s own hyphens', () => {
 const result=suggestSheet('(Oh) the morning,\nwo-ah again!');
 assert.equal(result.text,'(Oh) the morn-ing,\nwo-ah a-gain!');
 assert.deepEqual(result.changes.map(c=>c.from),['morning,','again!']);
});

test('applying text renames timed syllables in order and queues the rest', () => {
 const vocals=[{id:'b',time:2,length:.4,text:'world+',pitch:64},{id:'a',time:1,length:.4,text:'hello'}];
 const plan=reconcileSheet(vocals,'Hel-lo world\nagain');
 assert.deepEqual(plan.renames,[{id:'a',text:'Hel-'},{id:'b',text:'lo'}]);
 assert.deepEqual(plan.untimed,['world+','again+']);
 assert.deepEqual(reconcileSheet(vocals,'hi').removed,['b']);
});

test('tap session: hold for length, quick taps take the next start, undo rewinds', () => {
 const session=new TapSession({start:0,end:3,latency:.05});
 session.down(1.05);session.up(1.55);
 session.down(2.05);session.up(2.1);          // quick tap
 session.down(2.65);session.up(3.05);
 assert.deepEqual(session.result().map(t=>[t.index,+t.time.toFixed(3),+t.length.toFixed(3)]),[[0,1,.5],[1,2,.58],[2,2.6,.4]]);
 assert.equal(+session.undo().toFixed(3),.6);assert.equal(session.next,2);
 assert.equal(session.up(5),null,'no key held');
 assert.equal(session.down(1.9),null,'a press before the previous tap is ignored');
 session.down(3);session.up(3.5);session.down(4);session.up(4.4);assert.equal(session.done,true);assert.equal(session.down(5),null);
});

test('committing taps times untimed syllables and keeps IDs, text and pitch', () => {
 const vocals=[{id:'a',time:1,length:.3,text:'Hel-',pitch:60},{id:'b',time:1.4,length:.3,text:'lo'}];
 const result=commitTaps(vocals,['world+','a-','gain+'],[{index:2,time:2,length:.5},{index:3,time:2.6,length:.3}],{uid,duration:10});
 assert.deepEqual(result.vocals.map(v=>[v.text,v.time,v.length]),[['Hel-',1,.3],['lo',1.4,.3],['world+',2,.5],['a-',2.6,.3]]);
 assert.equal(result.vocals[0].pitch,60);assert.deepEqual(result.untimed,['gain+']);
 const retap=commitTaps(result.vocals,result.untimed,[{index:0,time:1.1,length:.3},{index:1,time:2.2,length:.6}],{uid,duration:10});
 assert.deepEqual(retap.vocals.map(v=>[v.id,+v.time.toFixed(2)]),[['a',1.1],['b',2.2],[result.vocals[2].id,2.81],[result.vocals[3].id,3.32]]);
 assert.equal(retap.nudged,2,'later syllables move after the re-tapped ones, keeping the lyric order');
 assert.throws(()=>commitTaps(vocals,['x+'],[{index:5,time:1,length:1}],{uid}),/no longer exists/);
});

test('karaoke line, long lines, line lookup and onset snapping', () => {
 const vocals=[{id:'1',time:1,length:.4,text:'morn-'},{id:'2',time:1.5,length:.4,text:'ing+'},{id:'3',time:3,length:.4,text:'next+'}];
 const now=karaoke(vocals,1.6);
 assert.deepEqual(now.words.map(w=>[w.text,w.sung,w.active,w.join]),[['morn',true,false,true],['ing',true,true,false]]);
 assert.equal(now.next,'next');assert.equal(karaoke(vocals,2.5).line,1);
 assert.equal(longLines(['a '.repeat(30).trim()+'+'],20).length,1);
 assert.deepEqual(lineOf(vocals.map(v=>v.text),1),{start:0,end:1,text:'morn-ing'});
 assert.deepEqual(snapStarts(vocals,[1.08,1.7,3.5]).map(u=>[u.id,u.time,+u.length.toFixed(3)]),[['1',1.08,.32]]);
 assert.deepEqual(syllables([],['x+']).map(s=>s.timed),[false]);
});
