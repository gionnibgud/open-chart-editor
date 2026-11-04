"""Entry point of the packaged build (tools/standalone.spec). From source, run dev_server.py."""
import os
from pathlib import Path
import runpy
import socket
import sys
import threading
import time
import webbrowser

ROOT = Path(__file__).resolve().parent

# Programs started from here (ffmpeg, xdg-open) must load their own libraries, not the
# bundled ones the launcher points LD_LIBRARY_PATH at on Linux. The Guitar Pro worker
# re-runs this program, so it is told to set up its own environment from scratch.
os.environ['PYINSTALLER_RESET_ENVIRONMENT'] = '1'
if 'LD_LIBRARY_PATH' in os.environ:
    original = os.environ.pop('LD_LIBRARY_PATH_ORIG', None)
    if original is None:
        del os.environ['LD_LIBRARY_PATH']
    else:
        os.environ['LD_LIBRARY_PATH'] = original


def open_browser(port):
    """Open the editor once the server answers; start-up takes several seconds."""
    for _ in range(600):
        try:
            socket.create_connection(('127.0.0.1', int(port)), timeout=1).close()
        except OSError:
            time.sleep(0.1)
        else:
            webbrowser.open(f'http://127.0.0.1:{port}')
            return


if '--gp-worker' in sys.argv:
    # pack_io re-runs itself through sys.executable, which in this build is this program.
    sys.argv = [sys.argv[-2], '--gp-worker']
    runpy.run_path(sys.argv[0], run_name='__main__')
else:
    if not os.environ.get('OCE_NO_BROWSER'):
        port = os.environ.get('OCE_PORT') or os.environ.get('WORKSHOP_PORT') or '8766'
        threading.Thread(target=open_browser, args=(port,), daemon=True).start()
    runpy.run_path(str(ROOT / 'dev_server.py'), run_name='__main__')
