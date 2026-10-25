"""Numeric MusicXML sound tempo playback offsets; visual directions stay separate."""
import base64
import copy
import json
from pathlib import Path
import unittest
from xml.etree import ElementTree as E
import pack_io
from test_musicxml_dynamics_candidate import score,note

ROOT=Path(__file__).resolve().parents[1]

def imported(marker):
    return pack_io.load_project(score(note()+marker+note('E')+note('G')),'own-tempo.musicxml')

def attacks(project):
    return [n['time'] for n in project['arrangements'][0]['notes']]

class MusicXmlTempoOffsetTests(unittest.TestCase):
    def test_direction_default_and_explicit_no_offsets_are_visual_only(self):
        for flag in ['', ' sound="no"']:
            project=imported(f'<direction><offset{flag}>-1</offset><sound tempo="60"/></direction>')
            self.assertEqual(attacks(project),[0,.5,1.5]);self.assertEqual([b['time'] for b in project['beats'][:4]],[0,.5,1.5,2.5]);self.assertEqual(project['tempos'],[{'time':0.0,'bpm':120.0},{'time':.5,'bpm':60.0}])

    def test_direction_sound_yes_offset_changes_numeric_tempo_playback(self):
        project=imported('<direction><offset sound="yes">-1</offset><sound tempo="60"/></direction>')
        self.assertEqual(attacks(project),[0,1,2]);self.assertEqual(project['tempos'],[{'time':0.0,'bpm':60.0}])

    def test_nested_sound_offset_overrides_direction_offset(self):
        project=imported('<direction><offset sound="yes">-1</offset><sound tempo="60"><offset>1</offset></sound></direction>')
        self.assertEqual(attacks(project),[0,.5,1]);self.assertEqual([b['time'] for b in project['beats'][:4]],[0,.5,1,2]);self.assertEqual(project['tempos'][1],{'time':1.0,'bpm':60.0})

    def test_direct_sound_child_offset_is_honored(self):
        project=imported('<sound tempo="60"><offset>1</offset></sound>')
        self.assertEqual(attacks(project),[0,.5,1]);self.assertEqual(project['tempos'][1],{'time':1.0,'bpm':60.0})

    def test_fractional_offsets_use_current_divisions_exactly(self):
        data=score('<attributes><divisions>2</divisions></attributes>'+note()+'<direction><offset sound="yes">0.5</offset><sound tempo="60"/></direction>'+note('E')+note('G'))
        project=pack_io.load_project(data,'own.musicxml');self.assertEqual(attacks(project),[0,.25,.625]);self.assertEqual(project['tempos'][1],{'time':.375,'bpm':60.0})

    def test_visual_metronome_and_rehearsal_policy_is_unchanged(self):
        project=imported('<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>60</per-minute></metronome><rehearsal>Own section</rehearsal></direction-type><offset>-1</offset></direction>')
        self.assertEqual(attacks(project),[0,1,2]);self.assertEqual(project['sections'][0]['start_time'],0)
        project=imported('<direction><direction-type><rehearsal>Own section</rehearsal></direction-type><offset>-1</offset><sound tempo="60"/></direction>')
        self.assertEqual(attacks(project),[0,.5,1.5]);self.assertEqual(project['sections'][0]['start_time'],0)

    def test_reject_invalid_playback_offset_and_existing_tempo_conflicts_transactionally(self):
        for marker in ['<sound tempo="60"><offset>-2</offset></sound>','<sound tempo="60"><offset>NaN</offset></sound>','<direction><offset sound="bad">1</offset><sound tempo="60"/></direction>','<sound tempo="60"/><sound tempo="90"/>']:
            data=score(note()+marker+note('E'));before=bytes(data)
            with self.assertRaises(pack_io.ProjectError):pack_io.load_project(data,'own.musicxml')
            self.assertEqual(data,before)

    def test_native_xml_ebeat_times_and_exact_source_preservation(self):
        technical='<notations><technical><string>6</string><fret>0</fret></technical></notations>'
        attack=note('E',2).replace('</note>',technical+'</note>')
        data=score(attack+'<direction><offset>-1</offset><sound tempo="60"/></direction>'+attack+attack)
        project=pack_io.load_project(data,'own-tab.musicxml');before=copy.deepcopy(project)
        xml=E.fromstring(pack_io.save_xml(project));self.assertEqual([float(n.get('time')) for n in xml.findall('./ebeats/ebeat')[:4]],[0,.5,1.5,2.5]);self.assertEqual([float(n.get('time')) for n in xml.findall('./levels/level/notes/note')],[0,.5,1.5]);self.assertEqual(base64.b64decode(project['_import']['source']),data);self.assertEqual(project,before)

if __name__=='__main__':unittest.main()
