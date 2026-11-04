"""Check a built standalone program: python tools/smoke-standalone.py <path to program>."""
from __future__ import annotations
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT/'tests/fixtures/interop/legacy-v1-mxl.feedpak'
PREFIX = '/api/plugins/open_chart_editor'
# Stands in for FeedBack's converter: reports from inside the Guitar Pro worker which libssl it loaded.
FAKE_CONVERTER = '''
from pathlib import Path
import ssl
maps = Path('/proc/self/maps')
loaded = [line for line in maps.read_text().splitlines() if 'libssl' in line] if maps.exists() else []
raise ValueError('worker ran, libssl '+('system' if any('_internal' not in line for line in loaded) else 'bundled'))
'''


def main(program):
    program = Path(program).resolve()
    if os.name == 'nt':
        program = program.with_suffix('.exe')
    with socket.socket() as probe:
        probe.bind(('127.0.0.1',0))
        port = probe.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    with tempfile.TemporaryDirectory() as lib, tempfile.TemporaryFile() as log:
        (Path(lib)/'gp2rs.py').write_text(FAKE_CONVERTER,encoding='utf-8')
        (Path(lib)/'gp2rs_gpx.py').write_text('',encoding='utf-8')
        env = {**os.environ,'OCE_PORT':str(port),'OCE_NO_BROWSER':'1','OCE_FEEDBACK_LIB':lib}
        server = subprocess.Popen([program],env=env,stdout=log,stderr=log)
        try:
            run_checks(base,server)
        except BaseException:
            log.seek(0)
            print(log.read().decode('utf-8','replace'))
            raise
        finally:
            server.terminate()
            server.wait(30)
    print('standalone smoke test passed')


def load_request(base,name,data):
    boundary = 'oce-smoke-boundary'
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\n'
            'Content-Type: application/octet-stream\r\n\r\n').encode()+data+f'\r\n--{boundary}--\r\n'.encode()
    return urllib.request.Request(base+PREFIX+'/load',body,{'Content-Type':f'multipart/form-data; boundary={boundary}'})


def run_checks(base,server):
    deadline = time.time()+120
    while True:
        try:
            health = json.load(urllib.request.urlopen(base+PREFIX+'/health',timeout=5))
            break
        except (urllib.error.URLError,OSError):
            assert server.poll() is None, f'server exited with {server.returncode}'
            assert time.time()<deadline, 'server did not answer within 120 s'
            time.sleep(0.5)
    assert health['ok']
    for path in ('/',PREFIX+'/screen.js',PREFIX+'/src/main.js',PREFIX+'/src/spectrum-worker.js',PREFIX+'/assets/editor.css'):
        assert urllib.request.urlopen(base+path,timeout=30).status == 200, path
    # The Guitar Pro worker must run the converter with the bundled libraries, not start a second server.
    try:
        urllib.request.urlopen(load_request(base,'song.gp5',b'not a score'),timeout=120)
        raise AssertionError('the fake converter should have failed the import')
    except urllib.error.HTTPError as error:
        detail = json.load(error)['detail']
    assert 'worker ran, libssl bundled' in detail, detail
    # Load and save a real project: this reaches PyYAML, jsonschema and the vendored schemas.
    project = json.load(urllib.request.urlopen(load_request(base,FIXTURE.name,FIXTURE.read_bytes()),timeout=60))['project']
    request = urllib.request.Request(base+PREFIX+'/save',json.dumps({'project':project,'format':'feedpak'}).encode(),{'Content-Type':'application/json'})
    with zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(request,timeout=60).read())) as pack:
        assert 'manifest.yaml' in pack.namelist(), pack.namelist()


if __name__ == '__main__':
    main(sys.argv[1])
