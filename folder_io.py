"""Bounded user-selected folder transport. Never follows links or writes files."""
from __future__ import annotations

import io
import os
from pathlib import Path, PurePosixPath
import stat
import zipfile
from fastapi import File, HTTPException, UploadFile
from fastapi.responses import Response

MAX_FILES = 4096
RESERVED = {'CON', 'PRN', 'AUX', 'NUL', *(f'COM{i}' for i in range(1, 10)), *(f'LPT{i}' for i in range(1, 10))}


class FolderError(ValueError):
    pass


def relative_name(name):
    if not isinstance(name, str) or not name or len(name) > 2048:
        raise FolderError('Invalid folder entry name')
    parts = name.split('/')
    if any(not p or p in ('.', '..') or p.endswith((' ', '.')) or
           any(ord(c) < 32 or c in '<>:"\\|?*' for c in p) or
           p.split('.')[0].upper() in RESERVED for p in parts):
        raise FolderError('Unsafe folder entry name: ' + name)
    if PurePosixPath(name).is_absolute():
        raise FolderError('Absolute folder entry refused')
    return name


def entry_zip(entries, max_bytes):
    """Validate the complete tree before producing an in-memory transport ZIP."""
    if not isinstance(entries, dict) or not entries or len(entries) > MAX_FILES:
        raise FolderError('Choose a nonempty song folder with at most 4096 files')
    names, prefixes = {}, {}
    total = 0
    for name, data in entries.items():
        relative_name(name)
        key = name.casefold()
        if key in names:
            raise FolderError('Case-colliding folder entries')
        names[key] = name
        parts = name.split('/')
        for i in range(1, len(parts) + 1):
            prefix = '/'.join(parts[:i])
            folded = prefix.casefold()
            if folded in prefixes and prefixes[folded] != prefix:
                raise FolderError('Case-colliding folder paths')
            prefixes[folded] = prefix
        if not isinstance(data, bytes):
            raise FolderError('Folder entry must contain file bytes')
        total += len(data)
        if total > max_bytes:
            raise FolderError('Song folder exceeds the OCE import limit')
    for key in names:
        parts = key.split('/')
        if any('/'.join(parts[:i]) in names for i in range(1, len(parts))):
            raise FolderError('File/directory collision in song folder')
    if not any(n in names for n in ('manifest.yaml', 'manifest.yml', 'manifest.json', 'source-manifest.json')) and not any('/' not in n and n.endswith('.xml') for n in names):
        raise FolderError('Select a FeedPak, FeedBack song or source-handoff folder containing a root manifest or arrangement XML')
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(entries.items()):
            archive.writestr(name, data)
    result = output.getvalue()
    if len(result) > max_bytes:
        raise FolderError('Song folder transport exceeds the OCE import limit')
    return result


def _plain(path, root):
    """Check lexical parents too: resolve() alone hides Windows junctions."""
    try:
        path.absolute().relative_to(root.absolute())
        path.resolve(strict=True).relative_to(root.resolve(strict=True))
    except ValueError as exc:
        raise FolderError('Folder entry escapes the selected song folder') from exc
    current = path
    while True:
        info = current.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT:
            raise FolderError('Linked or reparse-point folder entries are not supported')
        if current == root:
            return
        current = current.parent


def snapshot_directory(selected, max_bytes):
    selected = Path(selected).absolute()
    _plain(selected, selected)
    if not selected.is_dir():
        raise FolderError('Selected song folder is unavailable')
    entries, observed, directories = {}, {}, {}
    total = 0
    stack = [selected]
    while stack:
        directory = stack.pop()
        _plain(directory, selected)
        before = directory.stat()
        children = sorted(directory.iterdir(), key=lambda p: p.name)
        directories[directory] = (before.st_mtime_ns, tuple(p.name for p in children))
        for path in children:
            _plain(path, selected)
            info = path.lstat()
            if stat.S_ISDIR(info.st_mode):
                stack.append(path)
                if len(directories) + len(stack) > MAX_FILES:
                    raise FolderError('Song folder contains too many directories')
                continue
            if not stat.S_ISREG(info.st_mode):
                raise FolderError('Only regular files are supported in song folders')
            name = relative_name(path.relative_to(selected).as_posix())
            if len(entries) >= MAX_FILES or info.st_size > max_bytes - total:
                raise FolderError('Song folder exceeds the OCE import limit')
            with path.open('rb') as stream:
                first = os.fstat(stream.fileno())
                data = stream.read(max_bytes - total + 1)
                last = os.fstat(stream.fileno())
            _plain(path, selected)
            identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns)
            if identity(info) != identity(first) or identity(first) != identity(last) or len(data) != last.st_size:
                raise FolderError('Song folder changed while being read; open it again')
            entries[name] = data
            observed[path] = identity(last)
            total += len(data)
    for path, identity in observed.items():
        _plain(path, selected)
        now = path.stat()
        if identity != (now.st_dev, now.st_ino, now.st_size, now.st_mtime_ns):
            raise FolderError('Song folder changed while being read; open it again')
    for path, (mtime, children) in directories.items():
        _plain(path, selected)
        if path.stat().st_mtime_ns != mtime or tuple(sorted(p.name for p in path.iterdir())) != children:
            raise FolderError('Song folder changed while being read; open it again')
    return entry_zip(entries, max_bytes)


def install_folder_source(app, *, max_bytes):
    """Browser uploads contain relative entry names, never server file paths."""
    @app.post('/api/plugins/open_chart_editor/folder-source')
    async def folder_source(files: list[UploadFile] = File(...)):
        if not files or len(files) > MAX_FILES:
            raise HTTPException(400, 'Choose a song folder with at most 4096 files')
        entries, total = {}, 0
        try:
            for file in files:
                name = relative_name(file.filename)
                if name in entries:
                    raise FolderError('Duplicate folder entry')
                data = bytearray()
                while chunk := await file.read(min(1024 * 1024, max_bytes - total + 1)):
                    total += len(chunk)
                    if total > max_bytes:
                        raise FolderError('Song folder exceeds the OCE import limit')
                    data.extend(chunk)
                entries[name] = bytes(data)
            result = entry_zip(entries, max_bytes)
        except FolderError as exc:
            raise HTTPException(400, str(exc)) from exc
        return Response(result, media_type='application/zip', headers={'Cache-Control': 'no-store'})
    return folder_source
