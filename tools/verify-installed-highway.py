"""Run actual production highways against the recorded installed plugin bytes.
Only an isolated workspace host/library/config is started. No user service use.
"""
from pathlib import Path
import importlib.util,json,sys,uuid
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]

def main():
    spec=importlib.util.spec_from_file_location('installed_production_gate',ROOT/'tools'/'verify-highway.py');gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)
    installer=gate.install_module();original_plan=installer.make_plan
    record=json.loads((ROOT/'research'/'installed-local.json').read_text(encoding='utf-8'));installed=Path(record['destination'])
    if installed.resolve()!=Path(r'I:\Dev\freedBack\feedBack\plugins\open_chart_editor').resolve():raise ValueError('Unexpected installed plugin destination')
    installer.RUNTIME_FILES=tuple(item['path']for item in record['files']if item['path']not in installer.OPTIONAL_FILES)
    installer.make_plan=lambda destination,source=installed:original_plan(destination,source)
    gate.install_module=lambda:installer
    run=ROOT/'tools'/'.host-runs'/uuid.uuid4().hex;run.mkdir(parents=True)
    try:
        result=gate.verify(gate.HOST,run)
        if result['sourceDigest']!=record['sourceDigest']:raise ValueError('Installed source digest differs from installation record')
        result.update(installedSource=str(installed),installedSnapshotVerified=True,userServiceRestarted=False)
    except Exception as error:result={'ok':False,'error':str(error),'runDirectory':str(run),'userLibraryTouched':False,'externalDestinationInstalled':False}
    (run/'report.json').write_text(json.dumps(result,indent=2),encoding='utf-8');(ROOT/'research'/'installed-highway-verification.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'ok':result['ok'],'sourceDigest':result.get('sourceDigest'),'runDirectory':str(run),'error':result.get('error')},indent=2));return 0 if result['ok']else 1
if __name__=='__main__':raise SystemExit(main())
