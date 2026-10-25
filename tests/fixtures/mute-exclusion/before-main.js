// Lines extracted from the pre-fix editor (mute-exclusion baseline) for tests/mute-exclusion.test.mjs.
 const editableNotes=()=>[...arrangement().notes,...arrangement().chords.flatMap(c=>c.notes||[])];
 const selected=()=>editableNotes().filter(n=>selection.has(n.id));
 const change=(label,fn)=>{countIn.cancel();history.commit(label,p=>{fn(p);for(const a of p.arrangements)if(a.difficulties?.length)snapshotDifficulty(a);});dirty=true;audio.setProject(project(),arrangement());syncProjectAudio();render();queueDraft();};
 function editSelection(label,fn){if(!selected().length)throw Error('Select one or more notes first');change(label,()=>{const notes=selected(),before=new Map(notes.map(n=>[n.id,{fret:n.fret,finger:n.techniques.left_hand}]));for(const n of notes)fn(n);synchronizeChordVoicings(arrangement(),notes.filter(n=>n.fret!==before.get(n.id).fret||n.techniques.left_hand!==before.get(n.id).finger).map(n=>n.id));});}
 function toggleTechnique(key){const enabled=!selected().every(n=>techniqueEnabled(n,key));editSelection(key.replaceAll('_',' '),n=>{if(key==='vibrato')n.techniques[key]=enabled?80:0;else setTechniqueFlag(n,key,enabled);});}
