"""Staged original flat phrase preservation; no native DD is invented."""
import base64
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
import zipfile
from fastapi import FastAPI
from fastapi.testclient import TestClient
from test_pack_io import project,archive,SCHEMAS,jsonschema
from probe_phrase_coverage import p,ROOT,STAGE

def fixture():
    song=project();song['arrangements'][0]['phrases']=[{'id':'own-flat','name':'Own flat marker','time':1,'ownOpaque':{'original':[1,2]}},{'id':'own-flat-second','name':'Own second marker','time':4}];return song

def entries(song):
    with zipfile.ZipFile(io.BytesIO(p.save_feedpak(song))) as z:return {name:z.read(name) for name in z.namelist()}

class FlatPhraseTests(unittest.TestCase):
    def test_native_flat_has_no_fake_dd_source_exact_json_and_native_reopen(self):
        song=fixture();song['_pack']['entries']['opaque/own.bin']=base64.b64encode(b'original own\0source').decode();before=copy.deepcopy(song);parts=entries(song);manifest=p.yaml.safe_load(parts['manifest.yaml']);raw=json.loads(parts[manifest['arrangements'][0]['file']]);self.assertNotIn('phrases',raw);self.assertNotIn('difficulties',raw)
        if jsonschema:
            jsonschema.validate(raw,json.loads((SCHEMAS/'arrangement.schema.json').read_text(encoding='utf-8')));jsonschema.validate(manifest,json.loads((SCHEMAS/'manifest.schema.json').read_text(encoding='utf-8')))
        reopened=p.load_feedpak(archive(parts));again=p.load_project(p.save_project(reopened,'json')[0],'own.json');self.assertEqual(again['arrangements'][0]['phrases'],song['arrangements'][0]['phrases']);self.assertNotIn('difficulties',again['arrangements'][0]);self.assertEqual(base64.b64decode(again['_pack']['entries']['opaque/own.bin']),b'original own\0source');self.assertEqual(song,before)

    def test_clear_empty_and_absence_do_not_resurrect_owned_marker_payload(self):
        for remove in (False,True):
            with self.subTest(remove=remove):
                song=p.load_feedpak(p.save_feedpak(fixture()));old=base64.b64decode(song['_pack']['entries'][p.FLAT_PHRASE_PATH])
                if remove:song['arrangements'][0].pop('phrases')
                else:song['arrangements'][0]['phrases']=[]
                reopened=p.load_feedpak(p.save_feedpak(song));a=reopened['arrangements'][0]
                if remove:self.assertNotIn('phrases',a)
                else:self.assertEqual(a['phrases'],[])
                self.assertEqual(base64.b64decode(reopened['_pack']['entries']['editor/flat-phrase-sources/'+hashlib.sha256(old).hexdigest()+'.json']),old)
        self.assertNotIn(p.FLAT_PHRASE_PATH,entries(project()))

    def test_clear_source_native_flat_markers_uses_private_override(self):
        song=project();song['arrangements'][0]['_wire']={'phrases':[{'name':'Own original native header','start_time':0,'end_time':4,'ownOpaque':True}]};song=p.load_feedpak(p.save_feedpak(song));song['arrangements'][0]['phrases']=[]
        parts=entries(song);manifest=p.yaml.safe_load(parts['manifest.yaml']);raw=json.loads(parts[manifest['arrangements'][0]['file']]);self.assertTrue(raw['phrases'][0]['ownOpaque']);self.assertEqual(p.load_feedpak(archive(parts))['arrangements'][0]['phrases'],[])

    def test_external_native_edit_withholds_private_markers_and_preserves_opaque_sidecar(self):
        parts=entries(fixture());original=parts[p.FLAT_PHRASE_PATH];row=json.loads(original)['arrangements'][0];raw=json.loads(parts[row['file']]);raw['notes'][0]['f']=8;parts[row['file']]=json.dumps(raw).encode();song=p.load_feedpak(archive(parts));self.assertNotIn('phrases',song['arrangements'][0]);self.assertEqual(song['arrangements'][0]['notes'][0]['fret'],8);self.assertEqual(base64.b64decode(song['_pack']['entries'][p.FLAT_PHRASE_PATH]),original);self.assertTrue(any('flat phrase' in w and 'withheld' in w for w in song['import_warnings']))

    def test_unknown_future_malformed_and_collisions_preserve_or_refuse(self):
        for change in ('future','duplicate','unsafe'):
            with self.subTest(change=change):
                parts=entries(fixture());doc=json.loads(parts[p.FLAT_PHRASE_PATH])
                if change=='future':doc['version']=2
                if change=='duplicate':doc['arrangements'].append(copy.deepcopy(doc['arrangements'][0]))
                if change=='unsafe':doc['arrangements'][0]['file']='../outside'
                original=json.dumps(doc).encode();parts[p.FLAT_PHRASE_PATH]=original;song=p.load_feedpak(archive(parts));self.assertNotIn('phrases',song['arrangements'][0]);self.assertTrue(any('flat phrase' in w and 'withheld' in w for w in song['import_warnings']));self.assertEqual(entries(song)[p.FLAT_PHRASE_PATH],original)
                song['arrangements'][0]['phrases']=fixture()['arrangements'][0]['phrases'];before=copy.deepcopy(song)
                with self.assertRaisesRegex(p.ProjectError,'Reserved flat phrase'):p.save_feedpak(song)
                self.assertEqual(song,before)

    def test_backup_collision_and_budget_refuse_transactionally(self):
        song=p.load_feedpak(p.save_feedpak(fixture()));original=base64.b64decode(song['_pack']['entries'][p.FLAT_PHRASE_PATH]);song['_pack']['entries']['editor/flat-phrase-sources/'+hashlib.sha256(original).hexdigest()+'.json']=base64.b64encode(b'other own original bytes').decode();song['arrangements'][0]['phrases'][0]['time']=2;before=copy.deepcopy(song)
        with self.assertRaisesRegex(p.ProjectError,'backup'):p.save_feedpak(song)
        self.assertEqual(song,before)
        with patch.object(p,'MAX_FLAT_PHRASES',64):
            with self.assertRaisesRegex(p.ProjectError,'four MiB'):p.save_feedpak(fixture())

    def test_merge_rebinds_marker_index_and_retains_exact_original_source_sidecar(self):
        source=p.load_feedpak(p.save_feedpak(fixture()));before=copy.deepcopy(source);merged=p.merge_projects(project(),source,offset=2)['project'];song=p.load_feedpak(p.save_feedpak(merged));a=song['arrangements'][1];self.assertEqual([v['time'] for v in a['phrases']],[3,6]);self.assertEqual(a['phrases'][0]['ownOpaque'],{'original':[1,2]});self.assertNotEqual(a['id'],'lead');self.assertEqual(source,before)
        retained=[base64.b64decode(v) for name,v in song['_pack']['entries'].items() if name.startswith('imports/') and name.endswith(p.FLAT_PHRASE_PATH)];self.assertEqual(retained,[base64.b64decode(source['_pack']['entries'][p.FLAT_PHRASE_PATH])])

    def test_staged_http_download_warns_meaningfully_and_reload_preserves_markers(self):
        spec=importlib.util.spec_from_file_location('oce_flat_phrase_routes',STAGE/'routes.py');routes=importlib.util.module_from_spec(spec);sys.modules[spec.name]=routes;spec.loader.exec_module(routes);app=FastAPI();routes.setup(app)
        with TestClient(app) as client:
            response=client.post(routes.PREFIX+'/save',json={'project':fixture(),'format':'feedpak'});self.assertEqual(response.status_code,200,response.text);self.assertIn('This flat chart has no native phrase ladder',response.headers['X-OCE-Export-Warnings']);loaded=client.post(routes.PREFIX+'/load',files={'file':('own.feedpak',response.content,'application/zip')});self.assertEqual(loaded.status_code,200,loaded.text);self.assertEqual(loaded.json()['project']['arrangements'][0]['phrases'],fixture()['arrangements'][0]['phrases'])

    def test_native_identity_type_and_file_pointer_changes_withhold_metadata(self):
        for field,value in [('id','different-own-id'),('type','bass'),('file','arrangements/moved-own.json')]:
            with self.subTest(field=field):
                parts=entries(fixture());manifest=p.yaml.safe_load(parts['manifest.yaml']);entry=manifest['arrangements'][0]
                if field=='file':parts[value]=parts[entry['file']]
                entry[field]=value;parts['manifest.yaml']=p.yaml.safe_dump(manifest).encode();song=p.load_feedpak(archive(parts));self.assertNotIn('phrases',song['arrangements'][0]);self.assertIn(p.FLAT_PHRASE_PATH,song['_pack']['entries'])

    def test_flat_to_authored_dd_does_not_restore_old_private_markers(self):
        song=p.load_feedpak(p.save_feedpak(fixture()));a=song['arrangements'][0];old=base64.b64decode(song['_pack']['entries'][p.FLAT_PHRASE_PATH]);a['difficulties']=[{'difficulty':0,**{field:copy.deepcopy(a.get(field,[])) for field in ['notes','chords','anchors','handshapes']}}];a['activeDifficulty']=0
        parts=entries(song);self.assertEqual(json.loads(parts[p.FLAT_PHRASE_PATH])['arrangements'],[]);reopened=p.load_feedpak(archive(parts));self.assertIn('difficulties',reopened['arrangements'][0]);self.assertEqual([v['time'] for v in reopened['arrangements'][0]['phrases']],[1,4]);self.assertNotEqual(reopened['arrangements'][0]['phrases'][0]['id'],'own-flat')
        parts[p.FLAT_PHRASE_PATH]=old;again=p.load_feedpak(archive(parts));self.assertTrue(any('withheld' in w and 'difficulty mode changed' in w for w in again['import_warnings']));self.assertIn('difficulties',again['arrangements'][0])

    def test_seven_layouts_and_scratch_use_appropriate_preservation_path(self):
        for kind,count in [('guitar',6),('guitar',7),('guitar',8),('bass',4),('bass',5),('keys',6),('drums',6)]:
            with self.subTest(kind=kind,count=count):
                song=project(kind,count);song['arrangements'][0]['phrases']=copy.deepcopy(fixture()['arrangements'][0]['phrases'])
                if kind=='keys':song['arrangements'][0]['notes'][0]['pitch']=73
                if kind=='drums':song['arrangements'][0]['notes']=[{'id':'hit','time':2,'piece':'own-custom','velocity':90}]
                parts=entries(song);again=p.load_feedpak(archive(parts));self.assertEqual(again['arrangements'][0]['phrases'],song['arrangements'][0]['phrases']);self.assertEqual(p.FLAT_PHRASE_PATH in parts,kind!='drums')
        song=project();scratch=copy.deepcopy(fixture()['arrangements'][0]);scratch.update(id='own-scratch',editorOnly=True);song['arrangements'].append(scratch);parts=entries(song);self.assertNotIn(p.FLAT_PHRASE_PATH,parts);self.assertEqual(p.load_feedpak(archive(parts))['arrangements'][1]['phrases'],scratch['phrases'])

    def test_null_marker_container_refuses_rather_than_silently_clears(self):
        song=project();song['arrangements'][0]['phrases']=None
        with self.assertRaisesRegex(p.ProjectError,'Flat phrase markers must be an array'):p.save_feedpak(song)

if __name__=='__main__':unittest.main()
