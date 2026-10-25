"""Build a closed-file local runtime ZIP. No dependency downloads or Git calls."""
from __future__ import annotations
import hashlib
import importlib.util
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('oce_installer', ROOT/'tools/install-local.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)
EXTRA_FILES = (
    'dev_server.py', 'launch.cmd', 'README.txt', 'THIRD-PARTY-NOTICES.txt', 'tools/install-local.py', 'tools/README.txt',
    'tools/package-local.py',
    'tools/verify-host.py', 'tools/verify-highway.py',
)

def main():
    selected = installer.RUNTIME_FILES + installer.OPTIONAL_FILES + EXTRA_FILES
    if len(set(selected)) != len(selected):
        raise ValueError('Duplicate archive path')
    installer.validate_module_closure(ROOT,selected)
    contents = {}
    for relative in selected:
        path = ROOT/relative
        installer.ensure_plain(path, ROOT)
        contents[relative] = path.read_bytes()
    manifest = {
        'pluginId':'open_chart_editor', 'completion':'in progress; see feature-coverage.json',
        'files':[{'path':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
                 for name,data in sorted(contents.items())],
        'externalDependenciesBundled':False,
        'excluded':'Private research, decompilation, test recordings, generated PSARCs, caches, Git metadata and all unlisted files',
    }
    fingerprint = hashlib.sha256(json.dumps(manifest,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    manifest['sourceDigest'] = fingerprint
    output = ROOT/'dist'/f'open-chart-editor-local-{fingerprint[:12]}.zip'
    output.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(output,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
        for name,data in sorted({**contents,'package-manifest.json':json.dumps(manifest,indent=2).encode()}.items()):
            info = zipfile.ZipInfo('open_chart_editor/'+name, date_time=(2026,1,1,0,0,0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info,data)
    with zipfile.ZipFile(output) as archive:
        assert archive.testzip() is None
        for name,data in contents.items():
            assert archive.read('open_chart_editor/'+name) == data
    report = {'ok':True,'archive':str(output),'bytes':output.stat().st_size,
              'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),**manifest}
    (ROOT/'dist'/'latest.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps({key:report[key] for key in ('ok','archive','bytes','sha256','sourceDigest')},indent=2))

if __name__ == '__main__':
    main()
