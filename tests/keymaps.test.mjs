import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ACTIONS,ACTION_IDS,PROFILES,PROFILE_IDS,baseCommand,comboFromEvent,normalizeCombo,displayCombo,buildKeymap,isStructural} from '../src/keymaps.js';

const event=(code,{ctrl=false,alt=false,shift=false,key=''}={})=>({code,key,ctrlKey:ctrl,metaKey:false,altKey:alt,shiftKey:shift});

test('keys are named by position and modifiers in one order', () => {
 assert.equal(comboFromEvent(event('KeyS',{ctrl:true,shift:true})),'Ctrl+Shift+S');
 assert.equal(comboFromEvent(event('Digit3',{alt:true})),'Alt+3');
 assert.equal(comboFromEvent(event('Comma',{ctrl:true,shift:true})),'Ctrl+Shift+Comma');
 assert.equal(comboFromEvent(event('KeyF'),{insertHeld:true}),'Insert+F', 'Charter: Insert held as a modifier');
 assert.equal(comboFromEvent(event('ShiftLeft',{shift:true})),null, 'a modifier alone is no command');
 assert.equal(normalizeCombo('shift+ctrl+s'),'Ctrl+Shift+S');
 assert.equal(displayCombo('Ctrl+Shift+Period'),'Ctrl+Shift+.');
});

test('every profile binds only real commands, and no key twice', () => {
 for (const id of PROFILE_IDS) {
  const seen=new Map();
  for (const [command,combos] of Object.entries(PROFILES[id].bindings)) {
   assert.ok(ACTION_IDS.has(baseCommand(command)),`${id}: ${command}`);
   for (const combo of combos.map(normalizeCombo)) {
    assert.ok(!seen.has(combo),`${id}: ${combo} runs both ${seen.get(combo)} and ${command}`);
    seen.set(combo,command);
   }
  }
 }
});

test('the profiles differ where those editors differ', () => {
 const run=(profile,combo)=>buildKeymap(profile).byCombo.get(combo);
 assert.equal(run('oce','P'),'tech-palm-mute');assert.equal(run('eof','P'),'tech-pull-off');assert.equal(run('charter','P'),'tech-slap-pop-cycle');
 assert.equal(run('rplus','Shift+U'),'tech-unpitched-slide');assert.equal(run('eof','Ctrl+U'),'tech-unpitched-slide');
 assert.equal(run('eof','Ctrl+H'),'tech-harmonic');assert.equal(run('eof','Shift+H'),'tech-pinch-harmonic');
 assert.equal(run('charter','Alt+A'),'tech-accent:each');assert.equal(run('charter','Insert+H'),'chord-zone');
 assert.equal(run('rplus','F1'),'tab');assert.equal(run('eof','F1'),'help');
});

test('user changes win: a moved key leaves its old command, an empty list unbinds', () => {
 const map=buildKeymap('oce',{'tech-palm-mute':['X'],'tech-accent':[]});
 assert.equal(map.byCombo.get('X'),'tech-palm-mute');assert.equal(map.byCombo.get('P'),undefined,'P no longer palm-mutes');
 assert.equal(map.byCombo.get('C'),undefined);assert.ok(!map.byCommand.has('tech-accent'));
 assert.ok(!map.byCommand.get('cut')?.includes('X'),'X was taken from cut');
 assert.equal(buildKeymap('oce',{'tech-palm-mute':['Shift+S']}).byCombo.get('Shift+S'),'tech-palm-mute');
});

test('fret digits, arrows and Delete stay the editor\'s own unless a profile binds them', () => {
 for (const combo of ['3','Numpad7','Ctrl+Numpad2','ArrowUp','Shift+ArrowLeft','Delete','Escape','Enter']) assert.ok(isStructural(combo),combo);
 for (const combo of ['P','Shift+S','Ctrl+3','Alt+1','Insert+F','Shift+2']) assert.ok(!isStructural(combo),combo);
});

test('the editor implements every command a profile can bind', () => {
 const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
 const menu=source.match(/const MENU_COMMANDS=\[([^\]]+)\]/)[1];
 for (const {id} of ACTIONS) {
  const generated=/^(cursor-(next|prev)-(grid|beat|measure|note|anchor)|lane-\d|finger-\d|fret-\d+)$/.test(id);
  assert.ok(generated||menu.includes(`'${id}'`)||source.includes(`'${id}':`)||source.includes(`${id}:async`)||source.includes(` ${id}:`),`main.js has no command for ${id}`);
 }
});
