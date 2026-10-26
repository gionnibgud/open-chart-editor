// Writes the wiki's Keyboard-Profiles.md from src/keymaps.js: node tools/keyboard-profiles-md.mjs <out.md>
import {writeFileSync} from 'node:fs';
import {ACTIONS,PROFILES,PROFILE_IDS,buildKeymap,displayCombo,BROWSER_RESERVED} from '../src/keymaps.js';

const maps=Object.fromEntries(PROFILE_IDS.map(id=>[id,buildKeymap(id)]));
const cell=(id,command)=>{const keys=[...(maps[id].byCommand.get(command)||[]),...(maps[id].byCommand.get(command+':each')||[]).map(k=>k+' (each note)')];return keys.length?keys.map(k=>`\`${displayCombo(k.replace(' (each note)',''))}\`${k.endsWith(' (each note)')?' each note':''}${BROWSER_RESERVED.has(k)?' ⚠':''}`).join(', '):'';};
const lines=['# Keyboard profiles','',
 'Edit > **Keyboard and mouse…** (also under Help) picks one of four keyboard profiles. Each follows the',
 'shortcuts of an editor you may already know, for every command OCE shares with it:','',
 ...PROFILE_IDS.map(id=>`- **${PROFILES[id].label}:** ${PROFILES[id].note}`),'',
 'In the same dialog you can give any command a different key (**Set…**, then press the key),',
 'remove a key (Backspace), or put a command back (**Reset**). A key you give to one command is',
 'taken from any other. Your changes are kept per profile and remembered.','',
 '**Technique keys set each selected note on its own** is an option there too: with it, toggling a',
 'technique on a mixed selection flips each note, instead of making them all the same.','',
 'Keys every profile shares: fret numbers (0-9, and the number pad for 10-19), arrows to move the',
 'cursor and change string, Shift+arrows to select, Delete, Escape. A profile that uses one of',
 'those keys for something else (for example Charter\'s arrows) takes it over.','',
 '⚠ marks keys a browser tab may keep for itself (for example Ctrl+T); they work in the FeedBack',
 'desktop app. A blank cell means that editor has no key for the command.','',
 'This table is generated from the editor\'s own key lists.',''];
for(const group of [...new Set(ACTIONS.map(a=>a.group))]){
 const rows=ACTIONS.filter(a=>a.group===group&&PROFILE_IDS.some(id=>cell(id,a.id)));
 if(!rows.length)continue;
 lines.push(`## ${group}`,'',`| Command | ${PROFILE_IDS.map(id=>PROFILES[id].label).join(' | ')} |`,`|---|${PROFILE_IDS.map(()=>'---').join('|')}|`);
 for(const a of rows)lines.push(`| ${a.label} | ${PROFILE_IDS.map(id=>cell(id,a.id)).join(' | ')} |`);
 lines.push('');
}
writeFileSync(process.argv[2],lines.join('\n'));
console.log('wrote',process.argv[2]);
