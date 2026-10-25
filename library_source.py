"""Original bounded selected-library archive reader; no core changes.
Supports bounded selected song-folder snapshots as well as archive bytes.
"""
from pathlib import Path
import os
from urllib.parse import quote
import asyncio
import importlib.util
from fastapi import HTTPException
from fastapi.responses import Response
try:
    from . import folder_io
except ImportError:
    _spec=importlib.util.spec_from_file_location('oce_folder_io',Path(__file__).with_name('folder_io.py'))
    folder_io=importlib.util.module_from_spec(_spec);_spec.loader.exec_module(folder_io)
EXTENSIONS={'.feedpak','.sloppak'}
def filename(value):
    if not isinstance(value,str) or not value or len(value)>2048 or any(c in value for c in ('\x00',':')):raise HTTPException(400,'Choose a supported archive from My Library')
    name=value.replace('\\','/')
    if name.startswith('/') or any(part in ('','.','..') for part in name.split('/')):raise HTTPException(400,'Choose a supported song from My Library')
    try:folder_io.relative_name(name)
    except folder_io.FolderError as exc:raise HTTPException(400,str(exc)) from exc
    return name

def read_library_source(payload,context,max_bytes,*,with_kind=False):
    if not isinstance(payload,dict) or payload.get('providerId')!='local':raise HTTPException(400,'Only My Library archives are supported')
    name=filename(payload.get('filename'));resolver=(context or {}).get('get_dlc_dir')
    configured=resolver() if callable(resolver) else None
    if not configured:raise HTTPException(503,'My Library folder is not configured')
    try:
        root=Path(configured).resolve(strict=True)
        if not root.is_dir():raise HTTPException(503,'My Library folder is not configured')
        original=root/name
        selected=original.resolve(strict=True)
        try:selected.relative_to(root)
        except ValueError:raise HTTPException(400,'The selected archive is outside My Library')
        folder_io._plain(original,root)
        if selected.is_dir():
            result=(name,folder_io.snapshot_directory(original,max_bytes))
            return (*result,'folder') if with_kind else result
        if not selected.is_file():raise HTTPException(404,'The selected library archive is unavailable')
        if selected.suffix.lower() not in EXTENSIONS:raise HTTPException(400,'The selected file is not a supported library archive')
        with selected.open('rb') as stream:
            before=os.fstat(stream.fileno())
            if before.st_size>max_bytes:raise HTTPException(413,'Library archive exceeds the OCE import limit')
            data=stream.read(max_bytes+1);after=os.fstat(stream.fileno())
        if len(data)>max_bytes:raise HTTPException(413,'Library archive exceeds the OCE import limit')
        if (before.st_size,before.st_mtime_ns)!=(after.st_size,after.st_mtime_ns) or len(data)!=after.st_size:raise HTTPException(409,'The library archive changed while being read; open it again')
        return (name,data,'archive') if with_kind else (name,data)
    except FileNotFoundError as exc:raise HTTPException(404,'The selected library archive is unavailable') from exc
    except PermissionError as exc:raise HTTPException(403,'The selected library archive cannot be read') from exc
    except folder_io.FolderError as exc:raise HTTPException(400,str(exc)) from exc

def install_library_source(app,context,*,max_bytes):
    """Call from existing routes.setup only after review, passing pack_io.MAX_BYTES.
    Uses the host's public lazy get_dlc_dir plugin context; never trusts a root
    supplied by a request, scans the library or mutates its files.
    """
    @app.post('/api/plugins/open_chart_editor/library-source')
    async def library_source(payload:dict):
        name,data,kind=await asyncio.to_thread(read_library_source,payload,context,max_bytes,with_kind=True)
        return Response(data,media_type='application/octet-stream',headers={'Cache-Control':'no-store','X-OCE-Library-Filename':quote(name,safe=''),'X-OCE-Library-Transport':kind})
    return library_source
