"""Unallowlisted prototype tests: actual native Feedpak rigs + local guide DTO."""
import base64
import copy
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import sys
import time
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'research'))
import midi_program_candidate as candidate
import pack_io
from probe_midi_programs import track,own_midi
from test_pack_io import project as audio_fixture

def source(tracks):return b'MThd'+struct.pack('>IHHH',6,0 if len(tracks)==1 else 1,len(tracks),480)+b''.join(track(events) for events in tracks)
def run(data):return candidate.decorate(pack_io.load_project(data,'own.mid'),data)
def backing(p):
    fixture=audio_fixture()['_pack'];p['_pack'].setdefault('manifest',{})['stems']=fixture['manifest']['stems'];p['_pack']['entries'].update(fixture['entries']);return p

def voices(p):
    script="import {resolveGuideVoice,guideVoiceTimelineDTO} from './src/guide-voice.js';let raw='';for await(const b of process.stdin)raw+=b;const p=JSON.parse(raw),a=p.arrangements[0];console.log(JSON.stringify({regions:[0,.5].map(time=>{const v=resolveGuideVoice(a,{rigLibrary:p.rigLibrary,time});return {time,source:v.source,family:v.family,program:v.program}}),timeline:guideVoiceTimelineDTO(a,{rigLibrary:p.rigLibrary})}))"
    return json.loads(subprocess.run(['node','--input-type=module','-e',script],input=json.dumps(p),text=True,capture_output=True,cwd=ROOT,check=True).stdout)

class MidiProgramPrototypeTests(unittest.TestCase):
    def test_midtrack_programs_actual_native_rigs_json_feedpak_and_worker_timeline(self):
        data=own_midi();original=pack_io.load_project(data,'own.mid');before=copy.deepcopy(original);out=candidate.decorate(original,data);p=out['project'];self.assertEqual(original,before);self.assertEqual(out['report']['mapped'],['midi-0-2']);self.assertNotIn('guideVoice',p['arrangements'][0]);self.assertTrue(any('approximate GM' in w for w in out['report']['warnings']))
        v=voices(p);self.assertEqual([(r['family'],r['program']) for r in v['regions']],[('pipe',73),('strings',40)]);self.assertEqual([r['time'] for r in v['timeline']['changes']],[0,.5]);self.assertEqual(p['arrangements'][0]['notes'],before['arrangements'][0]['notes'])
        backing(p);p['arrangements'][0]['notes'][0].update(pitch=72,string=3,fret=0)
        reopened=pack_io.load_project(pack_io.save_project(p,'json')[0],'own.json');reopened=candidate.restore(pack_io.load_project(pack_io.save_feedpak(reopened),'own.feedpak'));reopened=pack_io.load_project(pack_io.save_project(reopened,'json')[0],'own.json')
        self.assertEqual(base64.b64decode(reopened['_import']['source']),data);self.assertEqual(reopened['arrangements'][0]['midiProgramIntent'],p['arrangements'][0]['midiProgramIntent']);self.assertEqual(reopened['arrangements'][0]['notes'][0]['pitch'],72);self.assertEqual(voices(reopened),v)
        import jsonschema
        schema=json.loads(Path(r'I:\Dev\freedBack\feedback-feedpak-spec\schemas\rigs.schema.json').read_text(encoding='utf-8'));jsonschema.validate(p['rigLibrary'],schema)

    def test_cross_track_channel_state_is_applied_when_boundaries_are_unambiguous(self):
        data=source([[(0,b'\xc2\x49'),(480,b'\xc2\x28')],[(240,b'\x92\x3c\x64'),(240,b'\x82\x3c\0'),(240,b'\x92\x40\x64'),(240,b'\x82\x40\0')]])
        out=run(data);self.assertEqual(out['report']['mapped'],['midi-1-2']);events=out['project']['arrangements'][0]['midiProgramIntent']['events'];self.assertTrue(all(e['sourceTrack']==0 for e in events));self.assertEqual([e['time'] for e in events],[0,.5])

    def test_ambiguous_timing_banks_sysex_withhold_entire_channel_without_mutating_notes(self):
        notes=[(0,b'\x92\x3c\x64'),(480,b'\x82\x3c\0')]
        cases=[('follows an attack',source([notes[:1]+[(0,b'\xc2\x49')]+notes[1:]])),('nonzero bank',source([[(0,b'\xb2\0\x01'),(0,b'\xb2\x20\0'),(0,b'\xc2\x49')]+notes])),('partial/unresolved',source([[(0,b'\xb2\0\0'),(0,b'\xc2\x49')]+notes])),('SysEx',source([[(0,b'\xf0\x03\x7d\x01\xf7'),(0,b'\xc2\x49')]+notes])),('intertrack',own_midi(1)),('conflicting',source([[(0,b'\xc2\x49')],[(0,b'\xc2\x28')]+notes]))]
        for label,data in cases:
            before=pack_io.load_project(data,'own.mid');out=candidate.decorate(before,data);arr=out['project']['arrangements'][0];self.assertEqual(out['report']['mapped'],[],label);self.assertTrue(out['report']['withheld'],label);self.assertTrue(any(label in w for w in out['report']['warnings']),label);self.assertNotIn('tones',arr);self.assertEqual(arr['notes'],before['arrangements'][0]['notes']);self.assertEqual(base64.b64decode(out['project']['_import']['source']),data);self.assertEqual(arr['midiProgramIntent']['interpretation'],'raw')

    def test_no_program_messages_leave_existing_project_exact(self):
        data=source([[(0,b'\x92\x3c\x64'),(480,b'\x82\x3c\0')]])
        p=pack_io.load_project(data,'own.mid');out=candidate.decorate(p,data);self.assertEqual(out['project'],p);self.assertEqual(out['report'],{'mapped':[],'withheld':[],'warnings':[]})

    def test_running_status_program_data_and_independent_channels(self):
        data=source([[(0,b'\xc2\x49'),(240,b'\x28'),(0,b'\x92\x3c\x64'),(240,b'\x82\x3c\0'),(0,b'\xc3\x10'),(0,b'\x93\x40\x64'),(240,b'\x83\x40\0')]])
        out=run(data);self.assertEqual(len(out['report']['mapped']),2);p=out['project'];self.assertEqual([e['value'] for e in p['arrangements'][0]['midiProgramIntent']['events']],[73,40]);self.assertEqual(p['arrangements'][1]['midiProgramIntent']['events'][0]['value'],16)

    def test_drums_keep_kit_program_as_raw_and_do_not_acquire_melodic_rigs(self):
        data=source([[(0,b'\xc9\x10'),(0,b'\x99\x24\x64'),(480,b'\x89\x24\0')]])
        out=run(data);self.assertEqual(out['report']['mapped'],[]);self.assertIn('percussion',out['report']['warnings'][0]);self.assertEqual(out['project']['arrangements'][0]['type'],'drums')

    def test_explicit_zero_bank_pair_is_safe_but_existing_authoring_override_is_preserved(self):
        data=source([[(0,b'\xb2\0\0'),(0,b'\xb2\x20\0'),(0,b'\xc2\x49'),(0,b'\x92\x3c\x64'),(480,b'\x82\x3c\0')]])
        self.assertTrue(run(data)['report']['mapped']);p=pack_io.load_project(data,'own.mid');p['arrangements'][0]['guideVoice']={'version':1,'family':'organ','program':16};out=candidate.decorate(p,data);self.assertEqual(out['report']['mapped'],[]);self.assertEqual(out['project']['arrangements'][0]['guideVoice'],p['arrangements'][0]['guideVoice'])

    def test_owned_metadata_collision_budgets_and_tamper_are_transactional(self):
        data=own_midi();p=pack_io.load_project(data,'own.mid');p['_pack']={'entries':{candidate.PATH:base64.b64encode(b'own opaque').decode()}};before=copy.deepcopy(p)
        with self.assertRaises(candidate.ProgramError):candidate.decorate(p,data)
        self.assertEqual(p,before)
        with patch.object(candidate,'MAX_EVENTS',1):
            with self.assertRaises(candidate.ProgramError):run(data)
        with patch.object(candidate,'MAX_METADATA',16):
            with self.assertRaises(candidate.ProgramError):run(data)
        p=run(data)['project'];p['_pack']['entries'][candidate.PATH]=base64.b64encode(b'{bad').decode();restored=candidate.restore(p);self.assertTrue(any('withheld' in w for w in restored['import_warnings']))

    def test_tempo_changes_map_program_boundaries_using_actual_score_time(self):
        data=source([[(0,b'\xc2\x49'),(0,b'\x92\x3c\x64'),(480,b'\x82\x3c\0'),(0,b'\xff\x51\x03\x0f\x42\x40'),(480,b'\xc2\x28'),(0,b'\x92\x40\x64'),(480,b'\x82\x40\0')]])
        p=run(data)['project'];self.assertEqual(p['arrangements'][0]['tones']['changes'][0]['time'],1.5);self.assertEqual([e['time'] for e in p['arrangements'][0]['midiProgramIntent']['events']],[0,1.5])

    def test_source_rigs_opaque_bytes_and_free_paths_are_preserved(self):
        data=own_midi();p=pack_io.load_project(data,'own.mid')
        original={'version':1,'rigs':[{'id':'oce-midi-gm-73','blocks':[{'role':'source','intent':{'kind':'instrument','gm':{'program':0}}}],'opaque':{'own':[1,2]}}]}
        old_bytes=b'{"own_original_sidecar":"preserve exactly"}'
        p['_pack']={'manifest':{'rigs':'original-rigs.json'},'entries':{'original-rigs.json':base64.b64encode(old_bytes).decode(),'editor/oce-midi-rigs.json':base64.b64encode(b'original unrelated bytes').decode()}}
        p['rigLibrary']=original;before=copy.deepcopy(p);out=candidate.decorate(p,data)['project']
        self.assertEqual(p,before);self.assertEqual(out['_pack']['entries']['original-rigs.json'],before['_pack']['entries']['original-rigs.json']);self.assertEqual(out['_pack']['entries']['editor/oce-midi-rigs.json'],before['_pack']['entries']['editor/oce-midi-rigs.json']);self.assertEqual(out['_pack']['manifest']['rigs'],'editor/oce-midi-rigs-2.json');self.assertEqual(out['rigLibrary']['rigs'][0],original['rigs'][0]);self.assertTrue(any(r['id']=='oce-midi-gm-73-2' for r in out['rigLibrary']['rigs']))

    def test_original_notation_baseline_is_not_invalidated_by_guide_intent_metadata(self):
        import notation_state
        data=own_midi();p=pack_io.load_project(data,'own.mid');p['arrangements'][0]['_entry']={'notation':'own-original-notation.json'};notation_state.stamp_notation_baselines(p)
        out=candidate.decorate(p,data)['project'];decision=notation_state.notation_reference_decision(out,out['arrangements'][0]);self.assertTrue(decision['retain']);self.assertEqual(decision['reason'],'unchanged')

    def test_dense_same_tick_stream_is_indexed_not_events_times_attacks(self):
        data=source([[(0,b'\xc2'+bytes([i%128])) for i in range(5000)]+[(0,b'\x92\x3c\x64'),(1,b'\x82\x3c\0')]*2000]);start=time.perf_counter();out=run(data);self.assertLess(time.perf_counter()-start,10);self.assertTrue(out['report']['mapped'])

if __name__=='__main__':unittest.main()
