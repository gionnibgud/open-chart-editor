import asyncio,importlib.util,tempfile,unittest,subprocess,os
from unittest.mock import patch
from types import SimpleNamespace
from pathlib import Path
from urllib.parse import unquote
from fastapi import HTTPException
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('oce_runtime_library_source',HERE.parent/'library_source.py');reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)
class ReaderTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(dir=HERE,prefix='own-library-case-');self.base=Path(self.temp.name).resolve();assert self.base.is_relative_to(HERE);self.root=self.base/'library';self.root.mkdir();self.file=self.root/'Artist'/'Æ own.feedpak';self.file.parent.mkdir();self.file.write_bytes(b'PK-own original source bytes\x00\xff');self.context={'get_dlc_dir':lambda:self.root};self.payload={'providerId':'local','filename':'Artist/Æ own.feedpak'}
 def tearDown(self):
  assert self.base.is_relative_to(HERE);self.temp.cleanup()
 def test_exact_selected_bytes_and_no_library_writes(self):
  before={str(p.relative_to(self.root)):p.read_bytes() for p in self.root.rglob('*') if p.is_file()};name,data=reader.read_library_source(self.payload,self.context,1024);self.assertEqual(name,self.payload['filename']);self.assertEqual(data,self.file.read_bytes());self.assertEqual(before,{str(p.relative_to(self.root)):p.read_bytes() for p in self.root.rglob('*') if p.is_file()})
 def test_absolute_traversal_stream_null_unsupported_and_unknown_provider(self):
  for name in ['../outside.feedpak','Artist/../own.feedpak','/own.feedpak','C:\\own.feedpak','http://invalid/a.feedpak','a:ads.feedpak','a\x00.feedpak','Artist//own.feedpak','own.json','']:
   with self.subTest(name=repr(name)),self.assertRaises(HTTPException):reader.read_library_source({**self.payload,'filename':name},self.context,1024)
  with self.assertRaises(HTTPException):reader.read_library_source({**self.payload,'providerId':'remote'},self.context,1024)
 def test_request_cannot_choose_another_root(self):
  outside=self.base/'outside.feedpak';outside.write_bytes(b'other');name,data=reader.read_library_source({**self.payload,'root':str(self.base),'path':str(outside)},self.context,1024);self.assertEqual(data,self.file.read_bytes())
 def test_unconfigured_missing_and_folder_form_are_explicit(self):
  for context,status in [({},503),({'get_dlc_dir':lambda:None},503),({'get_dlc_dir':lambda:self.base/'missing'},404)]:
   with self.subTest(status=status),self.assertRaises(HTTPException) as error:reader.read_library_source(self.payload,context,1024)
   self.assertEqual(error.exception.status_code,status)
  directory=self.root/'own-folder.feedpak';directory.mkdir()
  with self.assertRaises(HTTPException) as error:reader.read_library_source({'providerId':'local','filename':directory.name},self.context,1024)
  self.assertIn('nonempty song folder',error.exception.detail)
 def test_valid_selected_song_folder_is_snapshotted_without_library_writes(self):
  import io,zipfile
  directory=self.root/'Own song v1.2';directory.mkdir();(directory/'lead.xml').write_bytes(b'<song version="7"/>')
  name,data=reader.read_library_source({'providerId':'local','filename':directory.name},self.context,4096)
  self.assertEqual(name,directory.name)
  with zipfile.ZipFile(io.BytesIO(data)) as archive:self.assertEqual(archive.read('lead.xml'),b'<song version="7"/>')
  self.assertEqual(list(directory.iterdir()),[directory/'lead.xml'])
 def test_import_limit_applies_before_read(self):
  with self.assertRaises(HTTPException) as error:reader.read_library_source(self.payload,self.context,2)
  self.assertEqual(error.exception.status_code,413)
 def test_selected_symlink_cannot_escape_configured_library(self):
  outside=self.base/'outside.feedpak';outside.write_bytes(b'outside');link=self.root/'linked.feedpak'
  try:link.symlink_to(outside)
  except OSError as exc:self.skipTest('OS denies symbolic-link creation: '+str(exc))
  with self.assertRaises(HTTPException) as error:reader.read_library_source({'providerId':'local','filename':link.name},self.context,1024)
  self.assertEqual(error.exception.status_code,400)
 def test_route_adapter_uses_public_lazy_root_and_no_store_encoded_filename(self):
  class App:
   def post(inner,path):
    inner.path=path
    def accept(fn):inner.handler=fn;return fn
    return accept
  app=App();reader.install_library_source(app,self.context,max_bytes=1024);self.assertEqual(app.path,'/api/plugins/open_chart_editor/library-source');response=asyncio.run(app.handler(self.payload));self.assertEqual(response.body,self.file.read_bytes());self.assertEqual(response.headers['cache-control'],'no-store');self.assertEqual(unquote(response.headers['x-oce-library-filename']),self.payload['filename'])
 def test_resolved_containment_branch_refuses_outside_even_with_archive_suffix(self):
  outside=self.base/'outside.feedpak';outside.write_bytes(b'outside');original=Path.resolve
  def resolved(path,*args,**kwargs):
   return outside if path.name=='linked.feedpak' else original(path,*args,**kwargs)
  with patch.object(Path,'resolve',resolved),self.assertRaises(HTTPException) as error:reader.read_library_source({'providerId':'local','filename':'linked.feedpak'},self.context,1024)
  self.assertEqual(error.exception.status_code,400)
 def test_source_change_during_read_refuses_partial_snapshot(self):
  original=reader.os.fstat;count=0
  def changed(fd):
   nonlocal count
   count+=1;value=original(fd)
   return SimpleNamespace(st_size=value.st_size,st_mtime_ns=value.st_mtime_ns+(count>1))
  with patch.object(reader.os,'fstat',changed),self.assertRaises(HTTPException) as error:reader.read_library_source(self.payload,self.context,1024)
  self.assertEqual(error.exception.status_code,409)
 def test_real_windows_junction_escape_is_refused_without_changing_target(self):
  if os.name!='nt':self.skipTest('Windows junction regression')
  outside=self.base/'outside-folder';outside.mkdir();target=outside/'own.feedpak';target.write_bytes(b'controlled outside original');link=self.root/'owned-junction'
  self.assertTrue(outside.resolve().is_relative_to(HERE));self.assertTrue(link.resolve(strict=False).is_relative_to(HERE))
  literal=lambda p:"'"+str(p).replace("'","''")+"'"
  result=subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-Command','New-Item -ItemType Junction -Path '+literal(link)+' -Target '+literal(outside)+' | Out-Null'],capture_output=True,text=True)
  if result.returncode:self.skipTest('Junction creation unavailable: '+result.stderr[:200])
  try:
   self.assertTrue(link.is_junction());self.assertEqual(link.resolve(),outside.resolve())
   with self.assertRaises(HTTPException) as error:reader.read_library_source({'providerId':'local','filename':'owned-junction/own.feedpak'},self.context,1024)
   self.assertEqual(error.exception.status_code,400);self.assertEqual(target.read_bytes(),b'controlled outside original')
  finally:
   if link.is_junction():
    self.assertEqual(link.parent.resolve(),self.root.resolve());self.assertEqual(link.resolve(),outside.resolve());os.rmdir(link)
if __name__=='__main__':unittest.main(verbosity=2)
