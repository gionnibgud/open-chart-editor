import io
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from fastapi import FastAPI
from fastapi.testclient import TestClient

spec=importlib.util.spec_from_file_location('folder_transport',Path(__file__).resolve().parents[1]/'folder_io.py')
folder=importlib.util.module_from_spec(spec);spec.loader.exec_module(folder)


class FolderTransportTests(unittest.TestCase):
    def test_snapshot_preserves_relative_tree_and_originals(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as tmp:
            root=Path(tmp);(root/'audio').mkdir()
            original={'manifest.yaml':b'feedpak_version: 1.19.0\n','audio/full.wav':b'own sound\x00\xff'}
            for name,data in original.items():(root/name).write_bytes(data)
            result=folder.snapshot_directory(root,4096)
            with zipfile.ZipFile(io.BytesIO(result)) as z:
                self.assertEqual({n:z.read(n) for n in z.namelist()},original)
            self.assertEqual({str(p.relative_to(root)).replace('\\','/'):p.read_bytes() for p in root.rglob('*') if p.is_file()},original)

    def test_tree_rejects_escape_collisions_devices_and_oversize(self):
        for names in ({'../x':b''},{'CON.xml':b''},{'a:stream':b''},{'x. /a':b''},
                      {'manifest.yaml':b'', 'A':b'', 'a/x':b''},
                      {'manifest.yaml':b'', 'A':b'', 'a':b''},
                      {'manifest.yaml':b'', 'A/x':b'', 'a/y':b''}):
            with self.subTest(names=list(names)),self.assertRaises(folder.FolderError):folder.entry_zip(names,4096)
        with self.assertRaises(folder.FolderError):folder.entry_zip({'manifest.yaml':b'x'*21},20)

    def test_changed_file_snapshot_is_refused(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as tmp:
            root=Path(tmp);(root/'manifest.yaml').write_bytes(b'own manifest')
            real=folder.os.fstat
            def changed(fd):
                info=real(fd)
                from types import SimpleNamespace
                return SimpleNamespace(st_dev=info.st_dev,st_ino=info.st_ino,st_size=info.st_size+1,st_mtime_ns=info.st_mtime_ns)
            with patch.object(folder.os,'fstat',changed),self.assertRaisesRegex(folder.FolderError,'changed'):folder.snapshot_directory(root,4096)

    def test_source_handoff_marker_is_transportable_without_fake_root_song_xml(self):
        data=folder.entry_zip({'source-manifest.json':b'{"version":1}', 'arrangements/lead.xml':b'<song/>'},4096)
        with zipfile.ZipFile(io.BytesIO(data)) as z:self.assertEqual(z.read('arrangements/lead.xml'),b'<song/>')

    def test_actual_http_upload_returns_zip_and_rejects_unsafe_names(self):
        app=FastAPI();folder.install_folder_source(app,max_bytes=4096)
        with TestClient(app) as client:
            response=client.post('/api/plugins/open_chart_editor/folder-source',files=[('files',('manifest.yaml',b'own manifest')),('files',('audio/full.wav',b'own audio'))])
            self.assertEqual(response.status_code,200,response.text)
            with zipfile.ZipFile(io.BytesIO(response.content)) as z:self.assertEqual(z.read('audio/full.wav'),b'own audio')
            for names in (['../manifest.yaml'],['manifest.yaml','Manifest.yaml'],['manifest.yaml','A','a/x']):
                response=client.post('/api/plugins/open_chart_editor/folder-source',files=[('files',(name,b'x')) for name in names])
                self.assertEqual(response.status_code,400,response.text)

if __name__=='__main__':unittest.main()
