import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DRUMS} from '../src/model.js';
import {deriveDrumLayout,drumGuideCue} from '../src/drum-layout.js';

test('canonical lanes retain existing order and missing IDs never alias lane zero',()=>{
 const layout=deriveDrumLayout({type:'drums',notes:[]});
 assert.deepEqual(layout.ids,DRUMS);
 assert.equal(layout.indexOf('kick'),0);assert.equal(layout.indexOf('missing'),-1);
 assert.equal(layout.pieceAt(-1),null);assert.equal(layout.pieceAt(.5),null);
 assert.equal(layout.pieceAt(100),null);assert.equal(layout.pieceAt(0),'kick');
 assert.equal(layout.hasCustom,false);assert.ok(Object.isFrozen(layout.lanes[0]));
});

test('source legend adds distinct custom lanes and exact human labels without timbre guessing',()=>{
 const arr={type:'drums',_wire:{kit:[{id:'own metal',name:'Own metal label',gm:36,opaque:1},{id:'kick',name:'Own kick label'},{id:'unused',name:'Unused voice'},{id:'own metal',name:'Conflicting label'},{id:' padded ',name:'  Source label  '}]},notes:[{piece:'own metal'}]};
 const before=structuredClone(arr),layout=deriveDrumLayout(arr);
 assert.deepEqual(layout.ids.slice(DRUMS.length),['own metal','unused',' padded ']);
 assert.equal(layout.labelFor('kick'),'Own kick label');assert.equal(layout.labelFor('own metal'),'Own metal label');
 assert.equal(layout.labelFor(' padded '),'  Source label  ');assert.equal(layout.indexOf('padded'),-1);
 assert.equal(layout.lanes[layout.indexOf('unused')].used,false);
 assert.ok(layout.warnings.some(w=>w.includes('first valid')));assert.deepEqual(arr,before);
});

test('all live and hidden level standalone and chord child identities contribute deterministically',()=>{
 const arr={type:'drums',activeDifficulty:0,notes:[{piece:'zeta'},{piece:'snare'}],chords:[{notes:[{piece:'beta'},{p:'wire'}]}],difficulties:[{difficulty:0,notes:[{piece:'alpha'}]},{difficulty:9,notes:[{piece:'hidden'}],chords:[{notes:[{piece:'custom-child'}]}]}]};
 const before=structuredClone(arr),first=deriveDrumLayout(arr);
 assert.deepEqual(first.ids.slice(DRUMS.length),['alpha','beta','custom-child','hidden','wire','zeta']);
 assert.equal(first.indexOf({p:'wire'}),first.indexOf('wire'));
 const reordered=structuredClone(arr);reordered.notes.reverse();reordered.difficulties.reverse();reordered.activeDifficulty=9;
 assert.deepEqual(deriveDrumLayout(reordered).ids,first.ids);assert.deepEqual(arr,before);
});

test('canonical wins over wire alias; prototype-like and markup IDs remain plain distinct data',()=>{
 const layout=deriveDrumLayout({type:'drums',notes:[{piece:'__proto__'},{piece:'constructor'},{piece:'<custom>'},{piece:'own',p:'wrong'}]});
 for(const id of ['__proto__','constructor','<custom>','own'])assert.notEqual(layout.indexOf(id),-1);
 assert.equal(layout.indexOf('wrong'),-1);assert.equal(layout.labelFor('<custom>'),'<custom>');
});

test('first valid duplicate legend label wins while malformed metadata is disclosed and unchanged',()=>{
 const arr={type:'drums',_wire:{kit:[null,{id:''},{id:'own',name:5},{id:'own',name:'Valid'},{id:'own',name:'Later'}]},notes:[null,{piece:''},{piece:'own'}]};
 const before=structuredClone(arr),layout=deriveDrumLayout(arr);
 assert.equal(layout.labelFor('own'),'Valid');assert.equal(layout.indexOf(''),-1);
 assert.ok(layout.warnings.some(w=>w.includes('no valid piece')));assert.deepEqual(arr,before);
});

test('bounds throw transactionally instead of hiding extra lanes or records',()=>{
 const arr={type:'drums',_wire:{kit:[{id:'own'}]},notes:[{piece:'another'},{piece:'snare'}]};const before=structuredClone(arr);
 assert.throws(()=>deriveDrumLayout(arr,{maxPieces:19}),/piece count/);
 assert.throws(()=>deriveDrumLayout(arr,{maxRecords:1}),/records/);
 assert.throws(()=>deriveDrumLayout({...arr,_wire:{kit:[{id:'a'},{id:'b'}]}},{maxKitEntries:1}),/legend/);
 assert.throws(()=>deriveDrumLayout({...arr,difficulties:[{},{}]},{maxLevels:1}),/difficulty count/);
 assert.throws(()=>deriveDrumLayout(arr,{maxPieces:1}),/canonical/);
 assert.throws(()=>deriveDrumLayout(arr,{maxRecords:Infinity}),/Invalid/);
 assert.deepEqual(arr,before);
});

test('large repeated arrangements preserve one lane per exact ID without deduplicating source hits',()=>{
 const arr={type:'drums',notes:Array.from({length:150000},(_,i)=>({piece:i%2?'own':'snare',time:i/100}))};
 const layout=deriveDrumLayout(arr);assert.equal(layout.ids.length,DRUMS.length+1);
 assert.equal(arr.notes.length,150000);assert.equal(arr.notes[1].piece,'own');
});

test('custom guide disclosure makes no source-name or GM inference',()=>{
 const cue=drumGuideCue('huge-kick-like-name');
 assert.equal(cue.generic,true);assert.equal(cue.piece,'huge-kick-like-name');
 assert.equal(cue.label,'Generic percussion guide cue');assert.ok(cue.warning.includes('not established'));
 assert.equal(drumGuideCue('kick').generic,false);
});
