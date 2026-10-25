"""Review/create the exact local Piano dependency; no network or service control."""
from pathlib import Path
import argparse,difflib,hashlib,json
ROOT=Path(__file__).resolve().parents[1]
UPSTREAM=Path(r'I:\Dev\freedBack\feedBack-plugin-piano')
STAGED=ROOT/'research'/'piano-dependency'/'staged'
DESTINATION=Path(r'I:\Dev\freedBack\feedBack\plugins\piano')
FILES=('plugin.json','screen.js','settings.html','assets/thumb.svg','NOTICE.txt')
sha=lambda b:hashlib.sha256(b).hexdigest()
def replace_once(text,old,new):
    if text.count(old)!=1:raise ValueError('Upstream changed; local patch needs fresh source review: '+old[:70])
    return text.replace(old,new,1)
def prepare():
    original={name:(UPSTREAM/name).read_bytes()for name in FILES if name!='NOTICE.txt'}
    source=original['screen.js'].decode('utf-8').replace('\r\n','\n')
    patched='// Local OCE compatibility patch: explicit MIDI/sound initialization only.\n'+source
    patched=replace_once(patched,'        if (_settingsVisible) {\n            _midiInit();\n            _synthInit();\n            _midiUpdateAllDeviceLists();\n','        if (_settingsVisible) {\n            _midiUpdateAllDeviceLists();\n')
    patched=replace_once(patched,'            // Kick off MIDI + synth. One-time init — subsequent\n            // instances no-op out because the module singletons are\n            // already populated.\n            _midiInit();\n            _synthInit();','            // Local patch: viewing a chart does not discover MIDI or download synth scripts.\n            // Explicit controls in the settings panel initialize those optional features.')
    patched=replace_once(patched,'                    <span style="font-size:10px;color:#666;">MIDI</span>','                    <button class="piano-midi-connect" type="button">Connect MIDI</button>')
    patched=replace_once(patched,'                    <span style="font-size:10px;color:#666;">Sound</span>','                    <button class="piano-sound-enable" type="button" title="Downloads WebAudioFont player and soundfont for optional live keyboard sound">Enable sound (downloads)</button>')
    patched=replace_once(patched,"        panel.querySelector('.piano-midi-select').onchange = function () {\n            _midiConnect(this.value);\n            _synthInit();\n        };", "        panel.querySelector('.piano-midi-connect').onclick = async function () {\n            await _midiInit();\n            _midiUpdateAllDeviceLists();\n        };\n        panel.querySelector('.piano-sound-enable').onclick = function () { _synthInit(); };\n        panel.querySelector('.piano-midi-select').onchange = function () {\n            _midiConnect(this.value);\n        };")
    output=dict(original);output['screen.js']=patched.encode('utf-8')
    output['NOTICE.txt']=('''Piano Highway local dependency notice

Upstream local source: I:\\Dev\\freedBack\\feedBack-plugin-piano
Project identified by upstream README: https://github.com/got-feedback/feedback-plugin-piano
Upstream version: 4.1.0. Local version: 4.1.0+oce.1.
The upstream README states "License" / "MIT". No LICENSE, COPYING, NOTICE,
copyright holder or copyright year was supplied in the inspected repository.
Existing source comments are retained; no ownership attribution is invented.
The standard MIT permission and disclaimer terms accompany that declaration below.
Local changes remove automatic MIDI/synth initialization and add explicit controls.
Original source hashes and the exact local patch are retained in the local research
workspace under open-chart-editor/research/piano-dependency.

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
''').encode('utf-8')
    manifest=json.loads(original['plugin.json']);manifest['version']='4.1.0+oce.1'
    manifest['description']='Piano / keys playback; local OCE patch makes MIDI and downloaded live sound explicit.'
    output['plugin.json']=(json.dumps(manifest,indent=2)+'\n').encode('utf-8')
    from jsonschema import Draft202012Validator
    schema=json.loads(Path(r'I:\Dev\freedBack\feedBack\docs\plugin-manifest.schema.json').read_text())
    Draft202012Validator(schema).validate(manifest)
    for name,data in output.items():
        path=STAGED/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
    diff=''.join(difflib.unified_diff(source.splitlines(True),patched.splitlines(True),fromfile='upstream/screen.js',tofile='local/screen.js'))
    (STAGED.parent/'screen.patch').write_text(diff,encoding='utf-8')
    record={'upstream':str(UPSTREAM),'sourceVersion':'4.1.0','localVersion':manifest['version'],
            'license':'MIT, declared in upstream README.md (local copy retained at original repository)',
            'licenseEvidence':{'path':str(UPSTREAM/'README.md'),'sha256':sha((UPSTREAM/'README.md').read_bytes()),'line':70},
            'files':[{'path':name,'originalSha256':sha(original[name])if name in original else None,'localSha256':sha(output[name]),'bytes':len(output[name])}for name in FILES],
            'changes':['Remove MIDI discovery and remote synth loading on renderer mount and settings open','Connect MIDI explicitly discovers/selects existing saved source; MIDI dropdown no longer initializes downloaded sound','Enable sound (downloads) and instrument selection explicitly initialize optional WebAudioFont'],
            'network':'No network performed during preparation/install/test. Optional live synth script/soundfont downloads require explicit sound action; backing WAV playback stays local.',
            'hardware':'No discovery on chart view/gear open; explicit MIDI action uses host permission boundary. Tests use denying/fake provider only.',
            'settings':'Unchanged upstream settings.html persists range preferences in localStorage; its Scan button explicitly discovers devices; no Python routes or user configuration files.',
            'gitOperations':False,'serviceRestarted':False}
    (STAGED.parent/'provenance.json').write_text(json.dumps(record,indent=2),encoding='utf-8')
    return record
def plan():
    if STAGED.is_symlink()or DESTINATION.is_symlink():raise ValueError('Symlink plugin roots refused')
    files=[]
    if DESTINATION.exists():
        # This narrowly scoped dependency installer never replaces a plugin.
        raise ValueError('Piano destination already exists; review separately rather than overwrite')
    for name in FILES:
        path=STAGED/name
        if path.is_symlink()or not path.is_file():raise ValueError('Missing or linked staged runtime file')
        files.append({'path':name,'sha256':sha(path.read_bytes()),'bytes':path.stat().st_size,'existingSha256':None,'action':'create'})
    return {'source':str(STAGED),'destination':str(DESTINATION),'pluginId':'piano','files':files,'sourceDigest':sha(json.dumps([(f['path'],f['sha256'])for f in files],separators=(',',':')).encode()),'deletes':[],'network':False,'gitOperations':False}
def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--prepare',action='store_true');parser.add_argument('--apply',action='store_true');parser.add_argument('--expect-source-digest');args=parser.parse_args()
    if args.prepare:prepare()
    reviewed=plan()
    if args.apply:
        if reviewed['sourceDigest']!=args.expect_source_digest:raise ValueError('Reviewed exact digest required')
        if plan()!=reviewed:raise ValueError('Source/destination changed during review')
        for item in reviewed['files']:
            data=(STAGED/item['path']).read_bytes()
            if sha(data)!=item['sha256']:raise ValueError('Source changed during installation')
            target=DESTINATION/item['path'];target.parent.mkdir(parents=True,exist_ok=True)
            with target.open('xb')as file:file.write(data)
            if sha(target.read_bytes())!=item['sha256']:raise ValueError('Installed hash mismatch')
        reviewed.update(applied=True,backup=None,reason='New separate dependency; no existing destination overwritten',serviceRestarted=False)
    output=STAGED.parent/('installed.json'if args.apply else'install-plan.json');output.write_text(json.dumps(reviewed,indent=2),encoding='utf-8');print(json.dumps(reviewed,indent=2))
if __name__=='__main__':main()
