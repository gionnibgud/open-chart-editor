"""Original compressed-source retention without reimporting edited charts."""
import base64
import copy
import hashlib
import io
import json
import unittest
import zipfile
from unittest.mock import patch
import pack_io as p
from probe_musicxml_archive import own_mxl
from test_pack_io import project as own_audio


def imported():
    inner,archive=own_mxl();return inner,archive,p.load_project(archive,'path/own.mxl')

def backing(project):
    source=own_audio()['_pack'];project['_pack'].setdefault('manifest',{})['stems']=source['manifest']['stems'];project['_pack']['entries'].update(source['entries']);return project

def rewrite(archive,name,content):
    result=io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(archive)) as old,zipfile.ZipFile(result,'w') as new:
        for member in old.namelist():new.writestr(member,content if member==name else old.read(member))
    return result.getvalue()

class MusicXmlArchiveTests(unittest.TestCase):
    def test_mxl_json_feedpak_json_exact_archive_score_other_members_and_edited_chart(self):
        inner,archive,project=imported();ref=project['_import']['sourceArchive'];self.assertEqual(ref['filename'],'own.mxl');self.assertEqual(ref['sha256'],hashlib.sha256(archive).hexdigest());self.assertEqual(base64.b64decode(project['_import']['source']),inner)
        self.assertEqual(sum(base64.b64decode(v)==archive for v in project['_pack']['entries'].values()),1)
        project['arrangements'][0]['notes'][0]['pitch']=72;project['arrangements'][0]['notes'][0]['string']=3;project['arrangements'][0]['notes'][0]['fret']=0
        backing(project);before=copy.deepcopy(project)
        current=p.load_project(p.save_project(project,'json')[0],'own.json')
        current=p.load_project(p.save_feedpak(current),'own.feedpak')
        current=p.load_project(p.save_project(current,'json')[0],'own.json')
        self.assertEqual(current['_import'],project['_import']);self.assertEqual(current['arrangements'][0]['notes'][0]['pitch'],72);self.assertEqual(project,before)
        restored=base64.b64decode(current['_pack']['entries'][ref['entry']]);self.assertEqual(restored,archive)
        with zipfile.ZipFile(io.BytesIO(restored)) as z:self.assertEqual(z.read('own/extra.bin'),b'Original extra bytes\x00\xff');self.assertEqual(z.read('own/notes.txt'),b'Own annotation')

    def test_plain_xml_import_has_no_archive_attachment(self):
        inner,_,_=imported();project=p.load_project(inner,'own.musicxml');self.assertNotIn('sourceArchive',project['_import']);self.assertNotIn('_pack',project)

    def test_tampered_canonical_member_hash_size_path_score_and_filename_reject_atomically(self):
        _,_,project=imported()
        for mutation in ['bytes','hash','size','path','score','filename','version']:
            bad=copy.deepcopy(project);ref=bad['_import']['sourceArchive']
            if mutation=='bytes':bad['_pack']['entries'][ref['entry']]=base64.b64encode(b'changed').decode()
            elif mutation=='hash':ref['sha256']='0'*64
            elif mutation=='size':ref['size']+=1
            elif mutation=='path':ref['entry']='../own.mxl'
            elif mutation=='score':bad['_import']['source']=base64.b64encode(b'<changed/>').decode()
            elif mutation=='filename':ref['filename']='../own.mxl'
            elif mutation=='version':ref['version']=True
            before=copy.deepcopy(bad)
            with self.assertRaises(p.ProjectError):p.save_project(bad,'json')
            self.assertEqual(bad,before)

    def test_stale_sidecar_reference_withholds_provenance_retains_bytes_and_chart(self):
        _,_,project=imported();backing(project);native=p.save_feedpak(project);ref=project['_import']['sourceArchive']
        for name,content in [(ref['entry'],b'changed'),(p.MXL_SOURCE_PATH,b'{malformed'),(p.MXL_SOURCE_PATH,b'['*1000+b']'*1000),(p.MXL_SOURCE_PATH,json.dumps({'format':p.MXL_SOURCE_FORMAT,'version':2}).encode()),(p.MXL_SOURCE_PATH,b'{"unrelated":"own"}')]:
            broken=rewrite(native,name,content);restored=p.load_project(broken,'own.feedpak');self.assertNotIn('_import',restored);self.assertTrue(any('not restored' in w for w in restored['import_warnings']));self.assertEqual(base64.b64decode(restored['_pack']['entries'][name]),content)
            self.assertEqual(restored['arrangements'][0]['notes'][0]['pitch'],60)
            again=p.load_project(p.save_feedpak(restored),'own.feedpak');self.assertEqual(base64.b64decode(again['_pack']['entries'][name]),content)

    def test_owned_reserved_metadata_collision_refused_without_overwrite(self):
        _,_,project=imported();backing(project)
        for data in [b'{"unrelated":true}',b'{bad',json.dumps({'format':p.MXL_SOURCE_FORMAT,'version':9}).encode()]:
            bad=copy.deepcopy(project);bad['_pack']['entries'][p.MXL_SOURCE_PATH]=base64.b64encode(data).decode();before=copy.deepcopy(bad)
            with self.assertRaisesRegex(p.ProjectError,'Reserved MusicXML'):p.save_feedpak(bad)
            self.assertEqual(bad,before)

    def test_attachment_cap_keeps_score_and_precise_warning_after_unwrap_validation(self):
        inner,archive=own_mxl()
        with patch.object(p,'MAX_MXL_ATTACHMENT',len(archive)-1):
            project=p.load_project(archive,'own.mxl');self.assertNotIn('sourceArchive',project['_import']);self.assertEqual(base64.b64decode(project['_import']['source']),inner);self.assertTrue(any('archive was not retained' in w and 'other archive members are not' in w for w in project['import_warnings']))
        with patch.object(p,'MAX_BYTES',len(inner)-1):
            with self.assertRaises(p.ProjectError):p.load_project(archive,'own.mxl')

    def test_metadata_budget_and_aggregate_retained_asset_budget(self):
        _,_,project=imported();backing(project);before=copy.deepcopy(project)
        with patch.object(p,'MAX_MXL_METADATA',16):
            with self.assertRaisesRegex(p.ProjectError,'64 KiB'):p.save_feedpak(project)
        total=sum(len(base64.b64decode(v)) for v in project['_pack']['entries'].values())
        with patch.object(p,'MAX_BYTES',total-1):
            with self.assertRaises(p.ProjectError):p.save_project(project,'json')
        self.assertEqual(project,before)

    def test_json_serialized_budget_refuses_an_unreopenable_archive_project(self):
        _,_,project=imported();before=copy.deepcopy(project)
        decoded=sum(len(base64.b64decode(v)) for v in project['_pack']['entries'].values())
        encoded=len(p.save_project(project,'json')[0]);self.assertGreater(encoded,decoded)
        with patch.object(p,'MAX_BYTES',encoded-1):
            with self.assertRaisesRegex(p.ProjectError,'reopen limit'):p.save_project(project,'json')
        self.assertEqual(project,before)

    def test_valid_metadata_cannot_substitute_another_original_score(self):
        _,_,project=imported();backing(project);native=p.save_feedpak(project)
        with zipfile.ZipFile(io.BytesIO(native)) as z:meta=json.loads(z.read(p.MXL_SOURCE_PATH))
        meta['sourceArchive']['scoreSha256']='0'*64
        altered=rewrite(native,p.MXL_SOURCE_PATH,json.dumps(meta).encode());current=p.load_project(altered,'own.feedpak');self.assertNotIn('_import',current);self.assertTrue(any('not restored' in w for w in current['import_warnings']))

if __name__=='__main__':unittest.main()
