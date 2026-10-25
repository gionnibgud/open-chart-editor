"""Apply one already-verified isolated OCE snapshot with exact digests.
No service restart, publication, directory deletion or existing-editor changes.
Run only after reviewing the production report and source digest.
"""
from pathlib import Path
import argparse,hashlib,importlib.util,json,sys
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
DESTINATION=Path(r'I:\Dev\freedBack\feedBack\plugins\open_chart_editor')
EDITOR=Path(r'I:\Dev\freedBack\feedback-plugin-editor')

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--verified-report',required=True,type=Path);parser.add_argument('--expect-source-digest',required=True);parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    report_path=args.verified_report.resolve()
    if not report_path.is_relative_to((ROOT/'tools'/'.host-runs').resolve()):raise ValueError('Only workspace production verification reports accepted')
    report=json.loads(report_path.read_text(encoding='utf-8'));browser=report.get('browser',{})
    if not report.get('ok')or not browser.get('playbackPassed')or not browser.get('fullShellClean')or len(browser.get('cases',[]))!=7 or not browser.get('normalExport',{}).get('uiWarningVisible'):raise ValueError('Full seven-target production and normal-export warning verification required')
    if report['sourceDigest']!=args.expect_source_digest:raise ValueError('Reviewed digest differs from production report')
    source=report_path.parent/'plugins'/'open_chart_editor'
    spec=importlib.util.spec_from_file_location('checkpoint_installer',ROOT/'tools'/'install-local.py');installer=importlib.util.module_from_spec(spec);spec.loader.exec_module(installer)
    plan=installer.make_plan(DESTINATION,source)
    if plan['sourceDigest']!=args.expect_source_digest:raise ValueError('Verified staged snapshot changed')
    if not args.apply:print(json.dumps(plan,indent=2));return 0
    editor_hashes=lambda:{str(EDITOR/name):hashlib.sha256((EDITOR/name).read_bytes()).hexdigest()for name in ['plugin.json','screen.js']}
    before=editor_hashes();record_path=ROOT/'research'/'installed-local.json';previous=record_path.read_bytes()if record_path.exists()else None
    result=installer.apply_plan(plan,expected_digest=args.expect_source_digest)
    after=editor_hashes()
    if before!=after:raise ValueError('Existing editor changed during installation')
    installed=installer.make_plan(DESTINATION,source)
    if any(item['action']!='unchanged'for item in installed['files']):raise ValueError('Installed checkpoint differs from verified snapshot')
    if previous and result['backup']:(Path(result['backup'])/'previous-installation.json').write_bytes(previous)
    result.update(baselineSource='Verified local checkpoint; overall OCE parity remains in progress',productionVerification=str(report_path),existingEditorBefore=before,existingEditorAfter=after,installedHashesVerified=True,userServiceRestarted=False)
    record_path.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'applied':True,'sourceDigest':result['sourceDigest'],'destination':str(DESTINATION),'writtenFiles':len(result['writtenFiles']),'backup':result['backup'],'record':str(record_path)},indent=2));return 0
if __name__=='__main__':raise SystemExit(main())
