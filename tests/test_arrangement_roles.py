"""Actual runtime source-authoritative roles, independent of display names."""
import base64
import copy
import io
import json
import hashlib
from pathlib import Path
import sys
import unittest
import zipfile
from xml.etree import ElementTree as E
from test_pack_io import project as own_project
from test_pack_io import archive, SCHEMAS, jsonschema
import yaml
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import pack_io as p
assert Path(p.__file__).resolve()==ROOT/'pack_io.py', 'Regression must exercise the actual root runtime'

def fixture():
    project=own_project();project['arrangements'][0].update(name='Own guitar six',role='rhythm',priority='alternative')
    bass=copy.deepcopy(own_project('bass',4)['arrangements'][0]);bass.update(id='bass-own',name='Own bass four',role='bass',priority='bonus');project['arrangements'].append(bass);return project

class ArrangementRoleRuntimeTests(unittest.TestCase):
    def test_neutral_names_keep_explicit_roles_and_priorities_through_native_json_xml(self):
        project=fixture();before=copy.deepcopy(project);reopened=p.load_project(p.save_feedpak(project),'own.feedpak');reopened=p.load_project(p.save_project(reopened,'json')[0],'own.json')
        self.assertEqual([(a.get('role'),a.get('priority')) for a in reopened['arrangements']],[('rhythm','alternative'),('bass','bonus')]);self.assertEqual(project,before)
        guitar=E.fromstring(p.save_xml(reopened,'lead'));bass=E.fromstring(p.save_xml(reopened,'bass-own'));self.assertEqual(guitar.findtext('arrangement'),'Rhythm');self.assertEqual(guitar.find('arrangementProperties').get('represent'),'0');self.assertEqual(guitar.find('arrangementProperties').get('bonusArr'),'0');self.assertEqual(bass.findtext('arrangement'),'Bass');self.assertEqual(bass.find('arrangementProperties').get('bonusArr'),'1')

    def entries(self,project=None):
        with zipfile.ZipFile(io.BytesIO(p.save_feedpak(project or fixture()))) as z:return {name:z.read(name) for name in z.namelist()}

    def test_native_contract_unchanged_and_unknown_members_exact(self):
        project=fixture();project['_pack']['entries']['opaque/original.bin']=base64.b64encode(b'own\x00unknown').decode()
        entries=self.entries(project);manifest=yaml.safe_load(entries['manifest.yaml'])
        self.assertEqual(entries['opaque/original.bin'],b'own\x00unknown')
        if jsonschema:jsonschema.validate(manifest,json.loads((SCHEMAS/'manifest.schema.json').read_text()))
        for entry in manifest['arrangements']:
            raw=json.loads(entries[entry['file']]);self.assertNotIn('role',entry);self.assertNotIn('priority',entry);self.assertNotIn('role',raw);self.assertNotIn('priority',raw)
            if jsonschema:jsonschema.validate(raw,json.loads((SCHEMAS/'arrangement.schema.json').read_text()))

    def test_display_name_changes_do_not_change_independent_role(self):
        entries=self.entries();manifest=yaml.safe_load(entries['manifest.yaml']);manifest['arrangements'][0]['name']='Lead-looking arbitrary display name';entries['manifest.yaml']=yaml.safe_dump(manifest).encode()
        reopened=p.load_feedpak(archive(entries));self.assertEqual(reopened['arrangements'][0]['role'],'rhythm');self.assertEqual(reopened['arrangements'][0]['priority'],'alternative')

    def test_native_chart_edit_withholds_only_stale_row_and_preserves_source(self):
        entries=self.entries();sidecar=entries[p.ROLE_PATH];row=json.loads(sidecar)['arrangements'][0];raw=json.loads(entries[row['file']]);raw['ownOpaque']={'changed':True};entries[row['file']]=json.dumps(raw).encode()
        reopened=p.load_feedpak(archive(entries));self.assertNotIn('role',reopened['arrangements'][0]);self.assertEqual(reopened['arrangements'][1]['role'],'bass');self.assertTrue(any('withheld' in w and 'bytes changed' in w for w in reopened['import_warnings']));self.assertEqual(base64.b64decode(reopened['_pack']['entries'][p.ROLE_PATH]),sidecar)

    def test_dual_native_pointers_bind_actual_drum_tab_not_unused_file(self):
        project=fixture();drums=own_project('drums')['arrangements'][0];drums.update(id='drums-own',role='drums',priority='main',notes=[{'id':'hit','time':1,'piece':'snare','velocity':80}],_entry={'file':'opaque/unused-chart.json'});project['arrangements'].append(drums);project['_pack']['entries']['opaque/unused-chart.json']=base64.b64encode(b'{"originalUnused":true}').decode()
        entries=self.entries(project);manifest=yaml.safe_load(entries['manifest.yaml']);entry=next(a for a in manifest['arrangements'] if a['id']=='drums-own');entry['file']='opaque/unused-chart.json';entries['manifest.yaml']=yaml.safe_dump(manifest).encode()
        p._store_roles(project,entries,manifest)
        doc=json.loads(entries[p.ROLE_PATH]);row=next(a for a in doc['arrangements'] if a['id']=='drums-own');self.assertEqual(row['file'],entry['drum_tab'])
        with self.assertRaisesRegex(p.ProjectError,'drum part cannot also carry'):p.load_feedpak(archive(entries))
        entry.pop('file');entries['manifest.yaml']=yaml.safe_dump(manifest).encode()
        ordinary=p.load_feedpak(archive(entries));self.assertEqual(ordinary['arrangements'][2]['priority'],'main')
        raw=json.loads(entries[entry['drum_tab']]);raw['hits']=[];entries[entry['drum_tab']]=json.dumps(raw).encode();changed=p.load_feedpak(archive(entries));self.assertNotIn('priority',changed['arrangements'][2]);self.assertEqual(changed['arrangements'][0]['role'],'rhythm');self.assertEqual(entries['opaque/unused-chart.json'],b'{"originalUnused":true}')

    def test_future_and_malformed_metadata_preserved_with_warning_collision_refused(self):
        for mutation in (lambda d:d.update(version=2),lambda d:d['arrangements'].append(copy.deepcopy(d['arrangements'][0])),lambda d:d['arrangements'][0].update(file='../outside')):
            with self.subTest(mutation=mutation):
                entries=self.entries();doc=json.loads(entries[p.ROLE_PATH]);mutation(doc);original=json.dumps(doc).encode();entries[p.ROLE_PATH]=original
                reopened=p.load_feedpak(archive(entries));self.assertNotIn('role',reopened['arrangements'][0]);self.assertTrue(any('metadata was withheld' in w for w in reopened['import_warnings']))
                unchanged=self.entries(reopened);self.assertEqual(unchanged[p.ROLE_PATH],original)
                reopened['arrangements'][0]['role']='rhythm';before=copy.deepcopy(reopened)
                with self.assertRaisesRegex(p.ProjectError,'Reserved role metadata'):p.save_feedpak(reopened)
                self.assertEqual(reopened,before)

    def test_clearing_authoring_fields_does_not_resurrect_old_metadata(self):
        entries=self.entries();original=entries[p.ROLE_PATH];reopened=p.load_feedpak(archive(entries))
        for arr in reopened['arrangements']:arr.pop('role');arr.pop('priority')
        cleared=self.entries(reopened);self.assertEqual(json.loads(cleared[p.ROLE_PATH])['arrangements'],[]);self.assertEqual(cleared['editor/arrangement-role-sources/'+hashlib.sha256(original).hexdigest()+'.json'],original)
        self.assertTrue(all('role' not in a and 'priority' not in a for a in p.load_feedpak(archive(cleared))['arrangements']))

    def test_explicit_null_empty_and_legacy_absence_remain_distinct(self):
        project=fixture();project['arrangements'][0].update(role=None,priority='');project['arrangements'][1].pop('priority');project['arrangements'][1].pop('role')
        reopened=p.load_feedpak(p.save_feedpak(project));self.assertIsNone(reopened['arrangements'][0]['role']);self.assertEqual(reopened['arrangements'][0]['priority'],'');self.assertNotIn('role',reopened['arrangements'][1]);self.assertNotIn('priority',reopened['arrangements'][1])
        self.assertNotIn(p.ROLE_PATH,self.entries(own_project()))

    def test_clearing_only_one_field_retains_other_without_resurrection(self):
        for field,remaining in [('role','priority'),('priority','role')]:
            with self.subTest(field=field):
                reopened=p.load_feedpak(p.save_feedpak(fixture()));value=reopened['arrangements'][0][remaining];reopened['arrangements'][0].pop(field)
                again=p.load_feedpak(p.save_feedpak(reopened));self.assertNotIn(field,again['arrangements'][0]);self.assertEqual(again['arrangements'][0][remaining],value)

    def test_identity_binding_rejects_id_type_and_path_reassignment(self):
        for field,value in [('id','new-id'),('type','bass'),('file','arrangements/moved.json')]:
            with self.subTest(field=field):
                entries=self.entries();manifest=yaml.safe_load(entries['manifest.yaml']);entry=manifest['arrangements'][0]
                if field=='file':entries[value]=entries[entry['file']]
                entry[field]=value;entries['manifest.yaml']=yaml.safe_dump(manifest).encode();reopened=p.load_feedpak(archive(entries));self.assertNotIn('role',reopened['arrangements'][0]);self.assertNotIn('priority',reopened['arrangements'][0])

    def test_merge_namespaces_metadata_and_retains_imported_intent(self):
        source=p.load_feedpak(p.save_feedpak(fixture()));before=copy.deepcopy(source);target=own_project();merged=p.merge_projects(target,source,offset=1)
        merged=merged['project']
        reopened=p.load_feedpak(p.save_feedpak(merged));self.assertEqual([(a.get('role'),a.get('priority')) for a in reopened['arrangements'][1:]],[('rhythm','alternative'),('bass','bonus')]);self.assertEqual(source,before)
        source_roles=[base64.b64decode(data) for name,data in reopened['_pack']['entries'].items() if name.startswith('imports/') and name.endswith(p.ROLE_PATH)]
        self.assertEqual(source_roles,[base64.b64decode(source['_pack']['entries'][p.ROLE_PATH])])

    def test_backup_collision_refuses_without_mutation(self):
        entries=self.entries();original=entries[p.ROLE_PATH];entries['editor/arrangement-role-sources/'+hashlib.sha256(original).hexdigest()+'.json']=b'original unrelated opaque data';reopened=p.load_feedpak(archive(entries));reopened['arrangements'][0]['priority']='main';before=copy.deepcopy(reopened)
        with self.assertRaisesRegex(p.ProjectError,'backup path'):p.save_feedpak(reopened)
        self.assertEqual(reopened,before)

    def test_metadata_bound_and_invalid_role_fail_before_source_mutation(self):
        project=fixture();before=copy.deepcopy(project)
        from unittest.mock import patch
        with patch.object(p,'MAX_ROLE_METADATA',64):
            with self.assertRaisesRegex(p.ProjectError,'four MiB'):p.save_feedpak(project)
        self.assertEqual(project,before)
        project['arrangements'][0]['role']='bass'
        with self.assertRaises(p.ProjectError):p.save_feedpak(project)

    def test_reorder_clone_and_delete_use_current_native_identity(self):
        project=p.load_feedpak(p.save_feedpak(fixture()));clone=copy.deepcopy(project['arrangements'][0]);clone.update(id='own-clone',priority='bonus');clone.pop('_entry',None);project['arrangements']=[project['arrangements'][1],clone]
        reopened=p.load_feedpak(p.save_feedpak(project));self.assertEqual([(a['id'],a['role'],a['priority']) for a in reopened['arrangements']],[('bass-own','bass','bonus'),('own-clone','rhythm','bonus')]);self.assertEqual(len(json.loads(base64.b64decode(reopened['_pack']['entries'][p.ROLE_PATH]))['arrangements']),2)

if __name__=='__main__':unittest.main()
