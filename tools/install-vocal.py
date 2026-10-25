"""Prepare/review a private local Vocal Highway dependency; never bundle it.

No upstream license grant was found. User-authorized local research only.
An exact-digest apply creates a NEW plugin; no overwrite/service control.
"""
from pathlib import Path
import argparse,difflib,hashlib,json,re
ROOT=Path(__file__).resolve().parents[1]
UPSTREAM=Path(r'I:\Dev\freedBack\feedback-plugin-vocal-highway')
STAGED=ROOT/'research/vocal-dependency/staged'
DESTINATION=Path(r'I:\Dev\freedBack\feedBack/plugins/vocal_highway')
SOURCE_FILES=tuple('''plugin.json screen.js settings.html routes.py assets/thumb.svg
src/main.js src/engine/yin-worker.js src/engine/voiced-policy.js src/engine/pitch-engine.js src/engine/metrics.js src/engine/capture-worklet.js src/engine/calibrate.js
src/styles/unified/scene.js src/styles/unified/palette.js src/styles/unified/index.js src/styles/unified/hud.js src/styles/unified/gems.js
src/core/song-filename.js src/core/settings.js src/core/renderer.js src/core/math.js src/core/lyric-lines.js src/core/lyric-labels.js src/core/karaoke-guard.js src/core/generate.js src/core/demo.js src/core/chart-store.js
src/styles/precision/rack.js src/styles/precision/palette.js src/styles/precision/index.js src/styles/precision/field.js src/styles/precision/faceplates.js src/styles/precision/chrome.js
src/calibration/stage-range.js src/calibration/stage-mic.js src/calibration/index.js src/calibration/flow.js
src/readiness/range.js src/readiness/drone.js src/practice/loop-coach.js
src/styles/aurora/vials.js src/styles/aurora/stages/vector-drive.js src/styles/aurora/stages/storm-anvil.js src/styles/aurora/stages/overworld.js src/styles/aurora/stages/night-aurora.js src/styles/aurora/stages/eternity-pool.js src/styles/aurora/stages/bayside-shine.js
src/styles/aurora/halo.js src/styles/aurora/framework.js src/styles/aurora/comet.js src/styles/aurora/art-tint.js src/styles/aurora/islands.js src/styles/aurora/index.js
src/share/share-card.js src/scoring/session.js src/scoring/results.js src/scoring/judge.js'''.split())
FILES=SOURCE_FILES+('src/core/explicit-microphone.js','NOTICE.txt')
sha=lambda b:hashlib.sha256(b).hexdigest()
CONTROL='''// Original local control: viewing a chart never requests microphone access.
export function createMicrophoneControl(start,stop){
 let button=null,state='off';
 const update=()=>{if(button){button.textContent=state==='off'?'Start microphone':'Stop microphone';button.setAttribute('aria-pressed',String(state!=='off'));button.title=state==='off'?'Optional live vocal input; requests microphone permission':'Stop local microphone input';}};
 return {mount(canvas){this.destroy();button=document.createElement('button');button.type='button';button.dataset.vocalMicrophone='explicit';button.style.cssText='position:absolute;z-index:90;left:14px;top:66px;padding:7px 12px;color:#fff;background:#20232c;border:1px solid #8993a8;border-radius:5px;cursor:pointer';button.onclick=()=>{if(state==='off'){state='starting';update();start();}else{stop();state='off';update();}};canvas.parentElement.append(button);state='off';update();},setState(value){state=['off','denied','unsupported','error'].includes(value)?'off':value;update();},destroy(){button?.remove();button=null;state='off';}};
}
'''
def replace_once(text,old,new):
    if text.count(old)!=1:raise ValueError('Upstream changed; inspect patch again: '+old[:65])
    return text.replace(old,new,1)
def prepare():
    original={name:(UPSTREAM/name).read_bytes()for name in SOURCE_FILES}
    source=original['src/core/renderer.js'].decode('utf-8').replace('\r\n','\n');patched=source
    patched=replace_once(patched,"import { acquire } from '../engine/pitch-engine.js';","import { acquire } from '../engine/pitch-engine.js';\nimport { createMicrophoneControl } from './explicit-microphone.js';")
    patched=replace_once(patched,"  function startEngine() {","  function stopEngine() {\n    if (engine) { engine.release(); engine = null; }\n    engineState = 'off';\n    microphone.setState('off');\n  }\n  const microphone = createMicrophoneControl(startEngine, stopEngine);\n\n  function startEngine() {")
    patched=replace_once(patched,"      onState: (s) => { engineState = s; },","      onState: (s) => { engineState = s; microphone.setState(s); },")
    patched=replace_once(patched,"    if (engine) return;","    if (engine && ['denied', 'unsupported', 'error'].includes(engineState)) stopEngine();\n    if (engine) return;")
    patched=replace_once(patched,"      startEngine();\n      registerShortcuts();","      // Local patch: optional microphone requires the explicit overlay button.\n      stopEngine();\n      microphone.mount(cv);\n      // A persisted coach setting must not make chart-only viewing sound notes.\n      coach.applySetting('practiceLoop', false);\n      registerShortcuts();")
    patched=replace_once(patched,"      if (engine) { engine.release(); engine = null; engineState = 'off'; }","      stopEngine();\n      microphone.destroy();")
    output=dict(original);output['src/core/renderer.js']=patched.encode();output['src/core/explicit-microphone.js']=CONTROL.encode()
    route_source=original['routes.py'].decode('utf-8').replace('\r\n','\n')
    route_patch=replace_once(route_source,'    dlc_path = (dlc / filename).resolve()\n    if not dlc_path.exists():','    dlc_path = (dlc / filename).resolve()\n    if not dlc_path.is_relative_to(Path(dlc).resolve()):\n        return None\n    if not dlc_path.exists():')
    route_patch=replace_once(route_patch,'    p = source_dir / str(rel)\n    if not p.exists():','    p = (source_dir / str(rel)).resolve()\n    if not p.is_relative_to(Path(source_dir).resolve()):\n        return None\n    if not p.exists():')
    output['routes.py']=route_patch.encode()
    manifest=json.loads(output['plugin.json']);manifest['version']='0.3.7+oce.1';manifest['description']+=' Local private patch: chart viewing is silent; live microphone starts explicitly.'
    for setting in manifest.get('capabilities',{}).get('visualization',{}).get('settings',[]):
        if 'options' in setting:
            setting['options']=[{'id':value,'label':value}if isinstance(value,str)else value for value in setting['options']]
    output['plugin.json']=(json.dumps(manifest,indent=2)+'\n').encode()
    output['NOTICE.txt']=('Vocal Highway PRIVATE LOCAL DEPENDENCY\n\nUpstream local repository: '+str(UPSTREAM)+'\nUpstream version0.3.7; local patch0.3.7+oce.1.\nUpstream CLAUDE.md identifies "Authored plugin (Christian)".\nNo LICENSE/COPYING/NOTICE or README license grant was found. No MIT grant,\ncopyright year or owner is invented here. Existing source comments retained.\nThis staged copy is for the user-authorized private local research/build only.\nIt is NOT included in the OCE plugin ZIP or represented as redistributable.\n\nOriginal local changes: explicit Start/Stop microphone overlay; no automatic\nmic acquisition on renderer init; persisted practice coach starts disabled.\nExplicit calibration/reference-tone/generation controls remain upstream features.\nSource hashes and exact diff are retained beside this staging directory.\n').encode()
    from jsonschema import Draft202012Validator
    Draft202012Validator(json.loads(Path(r'I:\Dev\freedBack\feedBack/docs/plugin-manifest.schema.json').read_text())).validate(manifest)
    for name,data in output.items():
        path=STAGED/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
    (STAGED.parent/'renderer.patch').write_text(''.join(difflib.unified_diff(source.splitlines(True),patched.splitlines(True),fromfile='upstream/src/core/renderer.js',tofile='local/src/core/renderer.js')),encoding='utf-8')
    diff=[]
    for name in FILES:
        if name in original and original[name]==output[name]:continue
        before=original.get(name,b'').decode('utf-8').replace('\r\n','\n')
        after=output[name].decode('utf-8').replace('\r\n','\n')
        diff.extend(difflib.unified_diff(before.splitlines(True),after.splitlines(True),fromfile='upstream/'+name,tofile='local/'+name))
    (STAGED.parent/'local.patch').write_text(''.join(diff),encoding='utf-8')
    provenance={'upstream':str(UPSTREAM),'sourceVersion':'0.3.7','localVersion':manifest['version'],'licenseGrant':'Unspecified; private user-authorized local research only; not redistributed','licenseEvidence':{name:sha((UPSTREAM/name).read_bytes())for name in ['README.md','CLAUDE.md']},'files':[{'path':name,'originalSha256':sha(original[name])if name in original else None,'localSha256':sha(output[name]),'bytes':len(output[name])}for name in FILES],'behavior':['No microphone capture on registration, init or settings restore','Explicit overlay starts/stops mic; destruction releases engine and removes overlay','Persisted practiceLoop is disabled at init so chart-only loops remain silent; user may explicitly enable coach later','Explicit calibration facade and R reference tone remain user-triggered; generation G remains explicit'],'network':'Only existing local host endpoints during chart rendering; no remote assets/dependency downloads. Optional G generation calls local lyrics_karaoke producer if installed.','hardware':'Tests deny real input and inject fake capture only; no physical microphone claim','bundledWithOce':False,'externalCopyApplied':False}
    provenance['behavior']+=['Normalize manifest select options to current host {id,label} schema','Confine DLC filename and vocal-pitch sidecar reads to their owned source directories']
    (STAGED.parent/'provenance.json').write_text(json.dumps(provenance,indent=2),encoding='utf-8')
def plan():
    if DESTINATION.exists():raise ValueError('Destination exists; refuse overwrite and request separate concrete review')
    if STAGED.is_symlink()or DESTINATION.is_symlink():raise ValueError('Linked plugin root refused')
    files=[]
    for name in FILES:
        path=STAGED/name
        if path.is_symlink()or not path.is_file():raise ValueError('Missing/linked staged file '+name)
        data=path.read_bytes();files.append({'path':name,'sha256':sha(data),'bytes':len(data),'action':'create','existingSha256':None})
    selected=set(FILES)
    for name in FILES:
        if name.endswith('.js'):
            text=(STAGED/name).read_text(encoding='utf-8')
            for match in re.finditer(r'''(?:from\s*|import\s*|new URL\()\s*['"](\.[^'"]+)['"]''',text):
                target=(STAGED/name).parent/match.group(1)
                rel=target.resolve().relative_to(STAGED.resolve()).as_posix()
                if rel not in selected:raise ValueError('Missing closed dependency '+rel)
    return {'source':str(STAGED),'destination':str(DESTINATION),'pluginId':'vocal_highway','version':'0.3.7+oce.1','files':files,'sourceDigest':sha(json.dumps([(x['path'],x['sha256'])for x in files],separators=(',',':')).encode()),'deletes':[],'network':False,'gitOperations':False,'licenseGrant':'Unspecified; local private user-authorized copy only','bundledWithOce':False,'serviceRestarted':False}
def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--prepare',action='store_true');parser.add_argument('--apply',action='store_true');parser.add_argument('--expect-source-digest');args=parser.parse_args()
    if args.prepare:prepare()
    reviewed=plan()
    if args.apply:
        if reviewed['sourceDigest']!=args.expect_source_digest:raise ValueError('Reviewed exact digest required')
        if plan()!=reviewed:raise ValueError('Review changed')
        for item in reviewed['files']:
            data=(STAGED/item['path']).read_bytes();assert sha(data)==item['sha256']
            target=DESTINATION/item['path'];target.parent.mkdir(parents=True,exist_ok=True)
            with target.open('xb')as f:f.write(data)
            assert sha(target.read_bytes())==item['sha256']
        reviewed.update(applied=True,backup=None,reason='New dependency only; no existing destination overwritten')
    path=STAGED.parent/('installed.json'if args.apply else'install-plan.json');path.write_text(json.dumps(reviewed,indent=2),encoding='utf-8');print(json.dumps({k:v for k,v in reviewed.items()if k!='files'},indent=2))
if __name__=='__main__':main()
