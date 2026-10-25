// Own original fixtures. No native project payloads or proprietary code.
import {makeProject} from '../../../src/model.js';
export const activeNotes=content=>[...content.notes,...content.chords.flatMap(chord=>chord.notes||[])];
export function muteFixture(){
 const project=makeProject();project.title='Own mute command isolation';project.duration=12;project.beats=project.beats.slice(0,25);
 project._pack={manifest:{own:true},entries:{'own/source.bin':'b3duIHNvdXJjZQ=='}};
 project.ownMetadata={source:['retained',0,false]};
 const arrangement=project.arrangements[0];arrangement.id='own-mute-arrangement';
 const note=(id,time,string,fret,techniques)=>({id,time,string,fret,sustain:.75,techniques:{slide_to:-1,slide_unpitch_to:-1,left_hand:-1,tap:-1,bend_values:[],ownTechnique:{retained:true},...techniques},_xml:`<note time="${time}" string="${string}" fret="${fret}" sustain="0.75" palmMute="1" mute="1" fretHandMute="1" ownSource="${id}"/>`,opaque:{native:'retained'}});
 arrangement.notes=[
  note('own-fhm',1,0,5,{palm_mute:0,fret_hand_mute:3,mute:7,hammer_on:true}),
  note('own-pm',2,1,7,{palm_mute:5,fret_hand_mute:0,mute:0}),
  note('own-contradictory',8,4,12,{palm_mute:true,fret_hand_mute:true,mute:true}),
 ];
 arrangement.chord_templates=[{name:'Own shape',displayName:'Own shape',frets:[-1,-1,9,10,-1,-1],fingers:[-1,-1,1,2,-1,-1],opaque:{retained:'template'}}];
 arrangement.chords=[{id:'own-chord',time:3,chord_id:0,techniques:{accent:true},notes:[note('own-child-a',3,2,9,{palm_mute:1,fret_hand_mute:true,mute:true}),note('own-child-b',3,3,10,{palm_mute:-1,fret_hand_mute:0,mute:-1})],opaque:{retained:'chord'}}];
 arrangement.anchors=[{time:0,fret:5,width:4}];arrangement.handshapes=[{chord_id:0,start_time:2.5,end_time:4}];
 arrangement.activeDifficulty=0;arrangement.difficulties=[{difficulty:0,notes:structuredClone(arrangement.notes),chords:structuredClone(arrangement.chords),anchors:structuredClone(arrangement.anchors),handshapes:structuredClone(arrangement.handshapes)},{difficulty:3,notes:[note('own-hidden',1.25,5,15,{palm_mute:true,fret_hand_mute:true,mute:true})],chords:[],anchors:[],handshapes:[],opaque:{hidden:'exact'}}];
 return project;
}
// Explicit expected authored values, independent of the production flag helper.
export function expectedMute(project,ids,key,enabled,{excludeOpposite=true}={}){
 const next=structuredClone(project),selected=new Set(ids),arrangement=next.arrangements[0],active=arrangement.difficulties.find(level=>level.difficulty===arrangement.activeDifficulty);
 for(const content of [arrangement,active])for(const note of activeNotes(content))if(selected.has(note.id)){
  note.techniques[key]=key==='vibrato'?(enabled?80:0):enabled;
  if(key==='fret_hand_mute'&&Object.hasOwn(note.techniques,'mute'))note.techniques.mute=enabled;
  if(enabled&&excludeOpposite&&key==='palm_mute'){note.techniques.fret_hand_mute=false;if(Object.hasOwn(note.techniques,'mute'))note.techniques.mute=false;}
  if(enabled&&excludeOpposite&&key==='fret_hand_mute')note.techniques.palm_mute=false;
 }
 return next;
}
