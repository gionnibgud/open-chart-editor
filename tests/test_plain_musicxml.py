"""Actual runtime plain-score provenance and independently retained legacy MXL regressions."""
import base64
import copy
import importlib.util
import io
import json
from pathlib import Path
import sys
import unittest
import zipfile
from unittest.mock import patch
from probe_musicxml_archive import own_mxl
from test_pack_io import project as audio_fixture
ROOT=Path(__file__).resolve().parents[1]
import pack_io as p

def backing(project):
    data=audio_fixture()['_pack'];pack=project.setdefault('_pack',{});pack.setdefault('manifest',{})['stems']=data['manifest']['stems'];pack.setdefault('entries',{}).update(data['entries']);return project

def rewrite(archive,name,content):
    buffer=io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(archive)) as old,zipfile.ZipFile(buffer,'w') as new:
        for member in old.namelist():new.writestr(member,content if member==name else old.read(member))
    return buffer.getvalue()

# Written before the project was renamed; read under the current name.
LEGACY_MXL_SOURCE_PATH = 'editor/workshop-musicxml-sources.json'

class PlainMusicXmlTests(unittest.TestCase):
    def test_plain_musicxml_score_survives_json_native_json_and_does_not_override_edits(self):
        self.assertEqual(Path(p.__file__).resolve(),(ROOT/'pack_io.py').resolve())
        xml,_=own_mxl();project=p.load_project(xml,'own.musicxml');self.assertNotIn('_pack',project);project=backing(project);project['arrangements'][0]['notes'][0].update(pitch=72,string=3,fret=0);before=copy.deepcopy(project)
        project=p.load_project(p.save_project(project,'json')[0],'own.json');reopened=p.load_project(p.save_feedpak(project),'own.feedpak');self.assertEqual(base64.b64decode(reopened['_import']['source']),xml);self.assertNotIn('sourceArchive',reopened['_import']);self.assertEqual(reopened['arrangements'][0]['notes'][0]['pitch'],72);self.assertEqual(project,before)
        reopened=p.load_project(p.save_project(reopened,'json')[0],'own.json');self.assertEqual(base64.b64decode(reopened['_import']['source']),xml)

    def test_version2_plain_metadata_and_owned_score_member_have_exact_hashes(self):
        xml,_=own_mxl();project=backing(p.load_project(xml,'own.musicxml'));archive=p.save_feedpak(project)
        with zipfile.ZipFile(io.BytesIO(archive)) as z:
            doc=json.loads(z.read(p.MXL_SOURCE_PATH));self.assertEqual(doc['version'],2);self.assertIsNone(doc['sourceArchive']);ref=doc['score'];self.assertEqual(z.read(ref['entry']),xml);self.assertEqual(p.hashlib.sha256(xml).hexdigest(),ref['sha256']);self.assertEqual(ref['size'],len(xml))

    def test_legacy_mxl_version1_loads_and_metadata_bytes_remain_exact(self):
        original=(ROOT/'tests/fixtures/interop/legacy-v1-original.mxl').read_bytes();archive=(ROOT/'tests/fixtures/interop/legacy-v1-mxl.feedpak').read_bytes()
        with zipfile.ZipFile(io.BytesIO(original)) as z:xml=z.read('score/own.musicxml')
        with zipfile.ZipFile(io.BytesIO(archive)) as z:before=z.read(LEGACY_MXL_SOURCE_PATH);self.assertEqual(json.loads(before)['version'],1)
        project=p.load_project(archive,'own.feedpak');self.assertEqual(base64.b64decode(project['_import']['source']),xml);self.assertEqual(base64.b64decode(project['_pack']['entries'][project['_import']['sourceArchive']['entry']]),original)
        # Re-saving keeps the metadata; only the old format marker becomes the current one.
        with zipfile.ZipFile(io.BytesIO(p.save_feedpak(project))) as z:self.assertEqual(json.loads(z.read(p.MXL_SOURCE_PATH)),{**json.loads(before),'format':p.MXL_SOURCE_FORMAT})

    def test_normalized_utf16_score_preserved_without_reimporting_notes(self):
        xml,_=own_mxl();data=xml.decode().encode('utf-16');project=backing(p.load_project(data,'own.musicxml'));expected=base64.b64decode(project['_import']['source']);self.assertEqual(expected,xml);project['arrangements'][0]['notes'][0]['velocity']=0
        reopened=p.load_project(p.save_feedpak(project),'own.feedpak');self.assertEqual(base64.b64decode(reopened['_import']['source']),expected);self.assertEqual(reopened['arrangements'][0]['notes'][0]['velocity'],0)

    def test_unknown_future_malformed_wrong_version_and_tampered_score_stay_opaque(self):
        xml,_=own_mxl();archive=p.save_feedpak(backing(p.load_project(xml,'own.musicxml')))
        with zipfile.ZipFile(io.BytesIO(archive)) as z:document=json.loads(z.read(p.MXL_SOURCE_PATH))
        cases=[(p.MXL_SOURCE_PATH,b'{bad'),(p.MXL_SOURCE_PATH,b'['*1000+b']'*1000),(p.MXL_SOURCE_PATH,json.dumps({**document,'version':3}).encode()),(p.MXL_SOURCE_PATH,json.dumps({**document,'version':True}).encode()),(document['score']['entry'],b'changed original source')]
        for name,content in cases:
            reopened=p.load_project(rewrite(archive,name,content),'own.feedpak');self.assertNotIn('_import',reopened);self.assertTrue(any('not restored' in w for w in reopened['import_warnings']));self.assertEqual(base64.b64decode(reopened['_pack']['entries'][name]),content)
            with zipfile.ZipFile(io.BytesIO(p.save_feedpak(reopened))) as z:self.assertEqual(z.read(name),content)

    def test_reserved_path_collisions_and_invalid_source_are_transactional(self):
        xml,_=own_mxl();project=backing(p.load_project(xml,'own.musicxml'))
        for content in [b'{"unrelated":true}',json.dumps({'format':p.MXL_SOURCE_FORMAT,'version':3}).encode()]:
            bad=copy.deepcopy(project);bad['_pack']['entries'][p.MXL_SOURCE_PATH]=base64.b64encode(content).decode();before=copy.deepcopy(bad)
            with self.assertRaises(p.ProjectError):p.save_feedpak(bad)
            self.assertEqual(bad,before)
        bad=copy.deepcopy(project);bad['_import']['source']='not-base64';before=copy.deepcopy(bad)
        with self.assertRaises(p.ProjectError):p.save_project(bad,'json')
        self.assertEqual(bad,before)

    def test_source_member_path_hash_size_tamper_is_not_guessed(self):
        xml,_=own_mxl();archive=p.save_feedpak(backing(p.load_project(xml,'own.musicxml')))
        with zipfile.ZipFile(io.BytesIO(archive)) as z:document=json.loads(z.read(p.MXL_SOURCE_PATH))
        for key,value in [('entry','../score.musicxml'),('sha256','0'*64),('size',len(xml)+1)]:
            bad=copy.deepcopy(document);bad['score'][key]=value;restored=p.load_project(rewrite(archive,p.MXL_SOURCE_PATH,json.dumps(bad).encode()),'own.feedpak');self.assertNotIn('_import',restored);self.assertTrue(any('not restored' in w for w in restored['import_warnings']))

    def test_plain_source_metadata_and_serialized_reopen_budgets(self):
        xml,_=own_mxl();project=backing(p.load_project(xml,'own.musicxml'));before=copy.deepcopy(project)
        with patch.object(p,'MAX_MXL_METADATA',16):
            with self.assertRaisesRegex(p.ProjectError,'64 KiB'):p.save_feedpak(project)
        maximum=len(p.save_project(project,'json')[0])-1
        with patch.object(p,'MAX_BYTES',maximum):
            with self.assertRaisesRegex(p.ProjectError,'reopen limit'):p.save_project(project,'json')
        self.assertEqual(project,before)

if __name__=='__main__':unittest.main()
