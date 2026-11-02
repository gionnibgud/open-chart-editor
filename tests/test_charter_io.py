"""Unit tests for charter_io.py against a hand-built, original minimal .rscp (XStream) XML
fixture - not a real Charter project (none has been supplied to validate against yet; see the
module docstring)."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import charter_io as c
import pack_io as p


def build_rscp(arrangement_xml, beats_xml=None):
    beats_xml = beats_xml or '''
    <beat2 t="0.0" sig="4/4" bar="T"/>
    <beat2 t="500.0" sig="4/4"/>
    <beat2 t="1000.0" sig="4/4"/>
    <beat2 t="1500.0" sig="4/4"/>
    <beat2 t="2000.0" sig="4/4" bar="T"/>
    '''
    return f'''<?xml version="1.0"?>
    <project>
      <chartFormatVersion>3</chartFormatVersion>
      <title>Test Song</title>
      <artistName>Test Artist</artistName>
      <albumName>Test Album</albumName>
      <albumYear>2024</albumYear>
      <musicFileName>guitar.ogg</musicFileName>
      <stems><stem name="full" path="guitar.ogg" local="true"/></stems>
      <beats>{beats_xml}</beats>
      <arrangements>{arrangement_xml}</arrangements>
    </project>'''.encode()


def arrangement(body, arr_type='Lead', tuning='<tuning type="E_STANDARD" strings="6"/>'):
    return f'<arrangement type="{arr_type}" subtype="MAIN" capo="0">{tuning}{body}</arrangement>'


class CharterIoTests(unittest.TestCase):
    def test_header_and_metadata(self):
        data = build_rscp(arrangement('<levels><level/></levels>'))
        parsed = c.parse_charter(data)
        self.assertEqual(parsed['title'], 'Test Song')
        self.assertEqual(parsed['artist'], 'Test Artist')
        self.assertEqual(parsed['album'], 'Test Album')
        self.assertEqual(parsed['year'], '2024')
        self.assertEqual(len(parsed['beats']), 5)

    def test_beat_absolute_time_and_measure_markers(self):
        data = build_rscp(arrangement('<levels><level/></levels>'))
        parsed = c.parse_charter(data)
        self.assertEqual(parsed['beats'][0]['time'], 0.0)
        self.assertEqual(parsed['beats'][2]['time'], 1.0)
        self.assertEqual(parsed['beats'][0]['measure'], 1)
        self.assertEqual(parsed['beats'][1]['measure'], -1)
        self.assertEqual(parsed['beats'][4]['measure'], 2)

    def test_single_note_position_and_techniques(self):
        # beat 2, half way through that beat (fraction 1/2) -> 1.0 + 0.25 = 1.25s
        sound = '<sound p="2 1/2" ep="2 3/4" string="2" fret="5" hopo="HAMMER_ON" vibrato="T"/>'
        body = f'<levels><level><sounds>{sound}</sounds></level></levels>'
        data = build_rscp(arrangement(body))
        project = c.charter_project(c.parse_charter(data))
        note = project['arrangements'][0]['notes'][0]
        self.assertAlmostEqual(note['time'], 1.25)
        self.assertAlmostEqual(note['sustain'], 0.125)
        self.assertEqual(note['string'], 2)
        self.assertEqual(note['fret'], 5)
        self.assertTrue(note['techniques']['hammer_on'])
        self.assertTrue(note['techniques']['vibrato'])

    def test_chord_resolves_frets_from_template(self):
        templates = '<chordTemplates><chordTemplate chordName="Em" frets="0=0,1=2,2=2" fingers="1=2,2=3"/></chordTemplates>'
        sound = ('<sound p="0 0/1" chord="T" templateId="0">'
                 '<chordNote string="0" ep="0 1/1"/>'
                 '<chordNote string="1" ep="0 1/1"/>'
                 '<chordNote string="2" ep="0 1/1"/>'
                 '</sound>')
        body = f'{templates}<levels><level><sounds>{sound}</sounds></level></levels>'
        data = build_rscp(arrangement(body))
        project = c.charter_project(c.parse_charter(data))
        arr = project['arrangements'][0]
        chord = arr['chords'][0]
        self.assertEqual({n['string']: n['fret'] for n in chord['notes']}, {0: 0, 1: 2, 2: 2})
        self.assertEqual(arr['chord_templates'][0]['displayName'], 'Em')
        self.assertEqual(arr['chord_templates'][0]['fingers'][1], 2)

    def test_anchor_and_tone_change_and_section(self):
        body = ('<toneChanges><toneChange p="0 0/1" tone="Clean"/></toneChanges>'
                '<eventPoints><eventPoint p="2 0/1" section="VERSE"/></eventPoints>'
                '<levels><level><anchors><anchor p="0 0/1" fret="3" width="5"/></anchors></level></levels>')
        data = build_rscp(arrangement(body))
        project = c.charter_project(c.parse_charter(data))
        arr = project['arrangements'][0]
        self.assertEqual(arr['anchors'], [{'time': 0.0, 'fret': 3, 'width': 5}])
        self.assertEqual(arr['tones']['changes'], [{'time': 0.0, 'name': 'Clean'}])
        self.assertEqual(project['sections'], [{'name': 'VERSE', 'time': 1.0}])

    def test_bass_tuning_and_drop_tuning_resolve_correctly(self):
        data = build_rscp(arrangement('<levels><level/></levels>', arr_type='Bass',
                                       tuning='<tuning type="E_STANDARD" strings="4"/>'))
        project = c.charter_project(c.parse_charter(data))
        arr = project['arrangements'][0]
        self.assertEqual(arr['type'], 'bass')
        self.assertEqual(arr['tuning'], [0, 0, 0, 0])

        data = build_rscp(arrangement('<levels><level/></levels>',
                                       tuning='<tuning type="E_DROP_D" strings="6"/>'))
        project = c.charter_project(c.parse_charter(data))
        self.assertEqual(project['arrangements'][0]['tuning'], [-2, 0, 0, 0, 0, 0])

    def test_custom_tuning_uses_explicit_values(self):
        data = build_rscp(arrangement('<levels><level/></levels>',
                                       tuning='<tuning type="CUSTOM" strings="6" tuningValues="0,0,0,-2,-2,0"/>'))
        project = c.charter_project(c.parse_charter(data))
        self.assertEqual(project['arrangements'][0]['tuning'], [0, 0, 0, -2, -2, 0])

    def test_full_project_validates_against_oce_schema(self):
        sound = '<sound p="0 0/1" ep="0 1/1" string="0" fret="1"/>'
        body = f'<levels><level><sounds>{sound}</sounds></level></levels>'
        data = build_rscp(arrangement(body))
        project = c.charter_project(c.parse_charter(data))
        project['_pack'] = {'manifest': {'stems': [{'id': 'full', 'file': 'guitar.ogg', 'default': True}]}, 'entries': {}}
        p.validate_project(project)

    def test_rejects_non_charter_data_and_wrong_version(self):
        with self.assertRaises(c.CharterError):
            c.parse_charter(b'<not-a-project/>')
        bad_version = build_rscp(arrangement('<levels><level/></levels>')).replace(b'<chartFormatVersion>3</chartFormatVersion>', b'<chartFormatVersion>2</chartFormatVersion>')
        with self.assertRaises(c.CharterError):
            c.parse_charter(bad_version)


if __name__ == '__main__':
    unittest.main()
