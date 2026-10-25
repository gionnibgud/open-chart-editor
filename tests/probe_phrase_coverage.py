"""Original staged Feedpak authored-DD coverage and phrase edit regressions."""
import base64
import copy
import importlib.util
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
import zipfile
from test_pack_io import project,SCHEMAS,jsonschema
ROOT=Path(__file__).resolve().parents[1];STAGE=ROOT/'research/staging/phrase-coverage'
spec=importlib.util.spec_from_file_location('oce_phrase_staging',STAGE/'pack_io.py');p=importlib.util.module_from_spec(spec);sys.modules[spec.name]=p;spec.loader.exec_module(p)
FIELDS=['notes','chords','anchors','handshapes']

def source():
    song=project();a=song['arrangements'][0];a['chord_templates']=[{'name':'Own','frets':[3,5,-1,-1,-1,-1],'fingers':[1,3,-1,-1,-1,-1]}]
    a['difficulties']=[{'difficulty':0,**{field:[] for field in FIELDS}},{'difficulty':2,**{field:copy.deepcopy(a[field]) for field in FIELDS}}];a['activeDifficulty']=2
    a['_wire']={'phrases':[{'name':'Own source phrase','start_time':0,'end_time':4,'ownOpaque':{'retain':'source row'},'levels':[{'difficulty':0,'ownOpaqueLevel':{'retain':True}}]}]}
    return p.load_feedpak(p.save_feedpak(song))

def record(field,time):
    return {'notes':{'id':'own-lower','time':time,'string':1,'fret':5,'sustain':.5,'techniques':{}},'chords':{'id':'own-lower-chord','time':time,'chord_id':0},'anchors':{'time':time,'fret':5,'width':4},'handshapes':{'start_time':time,'end_time':time+1,'chord_id':0}}[field]

def native(song):
    with zipfile.ZipFile(io.BytesIO(p.save_feedpak(song))) as archive:
        manifest=p.yaml.safe_load(archive.read('manifest.yaml'));return json.loads(archive.read(manifest['arrangements'][0]['file']))

class PhraseCoverageTests(unittest.TestCase):
    def test_uncovered_lower_records_refuse_transactionally_before_archive_creation(self):
        for field in FIELDS:
            with self.subTest(field=field):
                song=source();song['arrangements'][0]['difficulties'][0][field]=[record(field,9)];before=copy.deepcopy(song)
                with patch.object(p.zipfile,'ZipFile') as output:
                    with self.assertRaisesRegex(p.ProjectError,'lead.*difficulty 0.*'+field+'.*9'):p.save_feedpak(song)
                    output.assert_not_called()
                self.assertEqual(song,before)

    def test_canonical_edited_phrase_rebuild_covers_all_levels_and_retains_source_metadata(self):
        song=source();a=song['arrangements'][0];a['phrases'][0]['name']='Own edited phrase';a['phrases'].append({'id':'own-new-marker','name':'Own second','time':6})
        for field in FIELDS:a['difficulties'][0][field]=[record(field,9)]
        before=copy.deepcopy(song);raw=native(song);self.assertEqual([(r['name'],r['start_time'],r['end_time']) for r in raw['phrases']],[('Own edited phrase',0,6),('Own second',6,12)]);self.assertEqual(raw['phrases'][0]['ownOpaque'],{'retain':'source row'});self.assertEqual(raw['phrases'][0]['levels'][0]['ownOpaqueLevel'],{'retain':True})
        reopened=p.load_feedpak(p.save_feedpak(song));low=reopened['arrangements'][0]['difficulties'][0]
        for field in FIELDS:self.assertEqual(len(low[field]),1)
        self.assertEqual(song,before)
        if jsonschema:jsonschema.validate(raw,json.loads((SCHEMAS/'arrangement.schema.json').read_text(encoding='utf-8')))

    def test_exact_last_boundary_and_new_prefix_refuse_without_epsilon(self):
        for field in FIELDS:
            with self.subTest(field=field):
                song=source();a=song['arrangements'][0];a['phrases']=[];a['difficulties'][0][field]=[record(field,12)]
                with self.assertRaisesRegex(p.ProjectError,'duration'):p.save_feedpak(song)
        song=source();a=song['arrangements'][0];a['phrases']=[{'id':'own-only','name':'Own late','time':5}]
        with self.assertRaisesRegex(p.ProjectError,'phrase'):p.save_feedpak(song)

    def test_overlapping_source_intervals_refuse_instead_of_duplicating_hidden_notes(self):
        song=source();a=song['arrangements'][0];a['_wire']['phrases'].append({'name':'Own overlapping','start_time':1,'end_time':4,'levels':[]});a['phrases'].append({'id':'p1','name':'Own overlapping','time':1})
        with self.assertRaisesRegex(p.ProjectError,'overlap'):p.save_feedpak(song)

    def test_unchanged_native_intervals_and_crossing_sustained_tails_remain_exact(self):
        song=source();a=song['arrangements'][0];a['difficulties'][0]['notes']=[record('notes',3.5)];a['difficulties'][0]['notes'][0]['sustain']=5;a['difficulties'][0]['handshapes']=[{'start_time':3,'end_time':8,'chord_id':0}]
        raw=native(song);self.assertEqual(raw['phrases'][0]['end_time'],4);self.assertEqual(raw['phrases'][0]['levels'][0]['notes'][0]['sus'],5);self.assertEqual(raw['phrases'][0]['levels'][0]['handshapes'][0]['end_time'],8)

    def test_rename_only_preserves_original_native_end_and_all_unknown_fields(self):
        song=source();song['arrangements'][0]['phrases'][0]['name']='Own renamed phrase';raw=native(song);self.assertEqual(raw['phrases'][0]['name'],'Own renamed phrase');self.assertEqual(raw['phrases'][0]['end_time'],4);self.assertEqual(raw['phrases'][0]['ownOpaque'],{'retain':'source row'})

    def test_invalid_marker_container_or_identity_refuses_without_silent_fallback(self):
        for value in (None,{},[{'id':[], 'time':0,'name':'Own invalid'}],[{'id':'same','time':0,'name':'A'},{'id':'same','time':4,'name':'B'}]):
            with self.subTest(value=value):
                song=source();song['arrangements'][0]['phrases']=value
                with self.assertRaisesRegex(p.ProjectError,'phrase marker'):p.save_feedpak(song)

    def test_empty_zero_duration_and_deleted_markers_have_lossless_default(self):
        song=source();song['duration']=0;a=song['arrangements'][0]
        for owner in [a]+a['difficulties']:
            for field in FIELDS:owner[field]=[]
        a['phrases']=[];raw=native(song);self.assertEqual([(v['start_time'],v['end_time']) for v in raw['phrases']],[(0,0)])

    def test_merged_offset_phrase_rows_and_authored_records_keep_same_alignment(self):
        song=source();song['arrangements'][0]['difficulties'][0]['notes']=[record('notes',3)];target=project();merged=p.merge_projects(target,song,offset=4)['project'];reopened=p.load_feedpak(p.save_feedpak(merged));a=reopened['arrangements'][1];self.assertEqual(a['difficulties'][0]['notes'][0]['time'],7);self.assertEqual(a['_wire']['phrases'][0]['start_time'],4);self.assertEqual(a['_wire']['phrases'][0]['end_time'],8)

    def test_removed_or_empty_canonical_difficulties_never_resurrect_native_source_levels(self):
        for remove in (False,True):
            with self.subTest(remove=remove):
                song=source();a=song['arrangements'][0];a['notes']=[]
                if remove:a.pop('difficulties')
                else:a['difficulties']=[]
                with self.assertRaisesRegex(p.ProjectError,'lead.*difficulties.*removed'):p.save_feedpak(song)

    def test_current_visible_low_edits_are_snapshotted_before_coverage_check(self):
        song=source();a=song['arrangements'][0];a['activeDifficulty']=0;a['notes']=[record('notes',9)];before=copy.deepcopy(song)
        with self.assertRaisesRegex(p.ProjectError,'difficulty 0 notes.*9'):p.save_feedpak(song)
        self.assertEqual(song,before)

    def test_add_marker_at_old_native_end_covers_same_onset_without_time_shift(self):
        song=source();a=song['arrangements'][0];a['difficulties'][0]['notes']=[record('notes',4)]
        with self.assertRaisesRegex(p.ProjectError,'add or move a phrase marker'):p.save_feedpak(song)
        a['phrases'].append({'id':'own-boundary-marker','name':'Own new coverage','time':4});reopened=p.load_feedpak(p.save_feedpak(song));self.assertEqual(reopened['arrangements'][0]['difficulties'][0]['notes'][0]['time'],4);self.assertEqual([(v['start_time'],v['end_time']) for v in reopened['arrangements'][0]['_wire']['phrases']],[(0,4),(4,12)])

    def test_seven_layouts_schema_valid_ladders_and_source_bytes_unchanged(self):
        for kind,count in [('guitar',6),('guitar',7),('guitar',8),('bass',4),('bass',5),('keys',6),('drums',6)]:
            with self.subTest(kind=kind,count=count):
                song=project(kind,count);a=song['arrangements'][0]
                if kind=='keys':a['notes'][0].update(pitch=73,hand='lh',velocity=0)
                if kind=='drums':a['notes']=[{'id':'own-hit','time':2,'piece':'own-custom-piece','velocity':90,'ghost':True}]
                low=copy.deepcopy(a['notes']);low[0]['time']=1;a['difficulties']=[{'difficulty':0,**{field:low if field=='notes' else [] for field in FIELDS}},{'difficulty':2,**{field:copy.deepcopy(a[field]) for field in FIELDS}}];a['activeDifficulty']=2
                a['_wire']={'phrases':[{'name':'Own source','start_time':0,'end_time':4,'levels':[]}]};song['_pack']['entries']['opaque/own.bin']=base64.b64encode(b'original own\x00extra').decode();before=copy.deepcopy(song)
                payload=p.save_feedpak(song);reopened=p.load_feedpak(payload);self.assertEqual(reopened['arrangements'][0]['difficulties'][0]['notes'][0]['time'],1);self.assertEqual(base64.b64decode(reopened['_pack']['entries']['opaque/own.bin']),b'original own\x00extra');self.assertEqual(song,before)
                with zipfile.ZipFile(io.BytesIO(payload)) as archive:
                    manifest=p.yaml.safe_load(archive.read('manifest.yaml'));entry=manifest['arrangements'][0];raw=json.loads(archive.read(entry.get('drum_tab') or entry['file']))
                    if jsonschema:
                        jsonschema.validate(manifest,json.loads((SCHEMAS/'manifest.schema.json').read_text(encoding='utf-8')));jsonschema.validate(raw,json.loads((SCHEMAS/('drum-tab.schema.json' if kind=='drums' else 'arrangement.schema.json')).read_text(encoding='utf-8')))
                a=reopened['arrangements'][0];a['difficulties'][0]['notes'][0]['time']=9
                if kind=='drums':self.assertEqual(p.load_feedpak(p.save_feedpak(reopened))['arrangements'][0]['difficulties'][0]['notes'][0]['time'],9)
                else:
                    with self.assertRaisesRegex(p.ProjectError,'difficulty 0 notes.*9'):p.save_feedpak(reopened)

if __name__=='__main__':unittest.main()
