// Piano-roll note colour presets. Everything except 'oce' follows FeedBack's Keys Highway 3D
// palettes (core plugins/keys_highway_3d/src/keys-constants.js, AGPL-3.0-only), so a part looks
// the same here as on the player's highway. Tables are indexed by pitch class (midi % 12).
const hex=n=>'#'+n.toString(16).padStart(6,'0');
const twoTone=(natural,sharp)=>[natural,sharp,natural,sharp,natural,natural,sharp,natural,sharp,natural,sharp,natural];
const isSharp=pc=>[1,3,6,8,10].includes(pc);
// The editor's original colours: its eight string colours, cycled by pitch class on the roll.
export const EDITOR_COLORS=['#d84d49','#cfbb5d','#438acc','#d88138','#6ba744','#a67fc9','#54bdc9','#d87ba5'];
const TABLES={
 classic:[0xff3030,0xb04818,0xffd400,0x9aa018,0x2870ff,0x8fb8c8,0x4a7a68,0x30c050,0x807838,0xff8020,0xa05870,0xc050ff],
 emerald:twoTone(0x3fe25f,0x17863a),
 vivid:[0xff2020,0xd45a10,0xffe000,0xb8c010,0x1e6aff,0x9fd0e8,0x2fae7e,0x20e050,0xa89a20,0xff8a00,0xd05888,0xd040ff],
 pastel:[0xff9a9a,0xd0a078,0xffe9a0,0xcfd08a,0x9ec0ff,0xc8dde8,0x9ecfba,0x9fe8b0,0xcfc79a,0xffc890,0xd8a8ba,0xe0b0ff],
 ice:twoTone(0x58c8ff,0x2a6a9a),
 // Keys 3D colours an accidental its notation spells by that letter (A flat = A); the editor has no
 // spelling, so accidentals always use these sharp entries (darker naturals).
 legacy:[0xfe050c,0xcb040a,0xf2e942,0xc1ba35,0x1b8ff5,0xffb81e,0xcc9318,0x82fa3a,0x68c82e,0x6424de,0x501db2,0xfd3cf6],
};
// Octaves: one hue per octave (C1-B1 red ... C8 magenta), sharps at half brightness.
const OCTAVE_HUES=[0xe23a3a,0xe2803a,0xe0c73a,0x5fc23a,0x3ac2a0,0x3a86e2,0x6a4ae2,0xc23ae2],BELOW_C1=0x8090a0;
const darken=(n,f)=>(Math.round((n>>16&255)*f)<<16)|(Math.round((n>>8&255)*f)<<8)|Math.round((n&255)*f);
export const PIANO_PALETTES=[['oce','Editor (original)'],['classic','Classic'],['emerald','Emerald'],['vivid','Vivid'],['pastel','Pastel'],['ice','Ice'],['legacy','Legacy'],['octaves','Octaves']];
const IDS=new Set(PIANO_PALETTES.map(([id])=>id));
export const pianoPaletteId=id=>IDS.has(id)?id:'oce';
export function pianoNoteColor(palette,midi){
 const pc=((midi%12)+12)%12,id=pianoPaletteId(palette);
 if(id==='oce')return EDITOR_COLORS[pc%EDITOR_COLORS.length];
 if(id==='octaves'){const octave=Math.floor(midi/12)-1,hue=octave<=0?BELOW_C1:OCTAVE_HUES[(octave-1)%OCTAVE_HUES.length];return hex(isSharp(pc)?darken(hue,.5):hue);}
 return hex(TABLES[id][pc]);
}
