"""Seven-string guitar in the DLC Builder project export (RS7X layout), and nowhere else."""
import copy
import io
import json
import sys
import unittest
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import export_targets as e
import rs7x
from test_export_targets import fixture

p = e.pack_io


def seven(tuning=(-2, 0, 0, 0, 0, 0, 0)):
    """Own seven-string part: editor string 0 is the low B (here Drop A)."""
    project = fixture()
    arr = {'id': 'own-seven', 'type': 'guitar', 'name': 'Own seven', 'role': 'rhythm', 'stringCount': 7,
           'basePitches': [35, 40, 45, 50, 55, 59, 64], 'tuning': list(tuning),
           'notes': [{'id': 'b', 'time': .5, 'string': 0, 'fret': 0, 'sustain': 0, 'techniques': {}},
                     {'id': 'e', 'time': .75, 'string': 1, 'fret': 3, 'sustain': 0, 'techniques': {}}],
           'chords': [{'time': 1.0, 'chord_id': 0, 'notes': [{'string': 0, 'fret': 2, 'sustain': 0, 'techniques': {}},
                                                              {'string': 1, 'fret': 4, 'sustain': 0, 'techniques': {}}]}],
           'chord_templates': [{'name': 'B5', 'displayName': 'B5', 'frets': [2, 4, -1, -1, -1, -1, -1], 'fingers': [1, 3, -1, -1, -1, -1, -1]}],
           'anchors': [], 'handshapes': []}
    project['arrangements'].append(arr)
    project['sections'] = [{'name': 'riff', 'number': 1, 'start_time': 0}]
    return project


def built(project, ids):
    tree, report = e.rs2014_sources(project, ids)
    return tree.entries, report


class Rs7xExportTests(unittest.TestCase):
    def test_xml_uses_rs7x_string_order_and_seven_tuning_entries(self):
        entries, _ = built(seven(), ['own-seven'])
        root = ET.fromstring(entries['arrangements/00_rhythm.xml'])
        tuning = root.find('tuning').attrib
        self.assertEqual([tuning[f'string{i}'] for i in range(7)], ['0'] * 6 + ['-2'])
        notes = {(n.get('time'), n.get('string'), n.get('fret')) for n in root.iter('note')}
        self.assertEqual(notes, {('0.5', '6', '0'), ('0.75', '0', '3')}, 'low B is string 6, low E string 0')
        template = root.find('./chordTemplates/chordTemplate').attrib
        self.assertEqual((template['fret0'], template['finger0'], template['fret6'], template['finger6']), ('4', '3', '2', '1'))
        self.assertEqual({c.get('string') for c in root.iter('chordNote')}, {'0', '6'})

    def test_sidecar_carries_manifest_tuning_without_string6(self):
        entries, report = built(seven(), ['own-seven'])
        sidecar = json.loads(entries['rs7x.json'])
        record = sidecar['arrangements'][0]
        self.assertEqual(record['manifestTuning'], {'string0': 0, 'string1': 0, 'string2': 0, 'string3': 0, 'string4': 0, 'string5': 0, 'Rs7String6': -2})
        self.assertNotIn('string6', record['manifestTuning'])
        self.assertEqual(record['lowBOpenMidi'], 33)
        self.assertEqual(record['string6'], {'singleNotes': 1, 'chords': 1, 'sections': ['riff']})
        self.assertEqual(record['chordTemplates'][0]['extended'], [{'string': 6, 'fret': 2, 'finger': 1}])
        self.assertFalse(sidecar['built'])
        self.assertEqual(report['rs7x'], 'rs7x.json')
        self.assertTrue(any('rs7string' in w and 'Rs7String6' in w for w in report['warnings']))
        project = json.loads(entries['project.rs2dlc'])
        self.assertEqual(len(project['Arrangements'][0]['Fields'][0]['Tuning']), 6)

    def test_master_keeps_editor_string_order(self):
        source = seven()
        before = copy.deepcopy(source)
        entries, _ = built(source, ['own-seven'])
        self.assertEqual(source, before)
        master = json.loads(entries[e.MASTER])
        self.assertEqual([n['string'] for n in master['arrangements'][1]['notes']], [0, 1])

    def test_six_string_beside_seven_stays_stock(self):
        entries, report = built(seven(), ['own-lead', 'own-seven'])
        lead = ET.fromstring(entries['arrangements/00_lead.xml'])
        self.assertNotIn('string6', lead.find('tuning').attrib)
        self.assertEqual([r['id'] for r in json.loads(entries['rs7x.json'])['arrangements']], ['own-seven'])
        entries, report = built(fixture(), ['own-lead'])
        self.assertNotIn('rs7x.json', entries)
        self.assertIsNone(report['rs7x'])

    def test_rule_failures(self):
        cases = [
            (lambda a: a['chord_templates'][0].update(name='Bö5'), 'ASCII'),
            (lambda a: a['chord_templates'][0].update(displayName='x' * 31), 'ASCII of at most 30'),
            (lambda a: a.update(basePitches=[40, 45, 50, 55, 59, 64, 69]), 'lowest'),
            (lambda a: a['chord_templates'][0].update(frets=[2, -1, -1, -1, -1, -1, -1]), 'stock strings'),
        ]
        for change, message in cases:
            project = seven()
            change(project['arrangements'][1])
            with self.subTest(message=message), self.assertRaisesRegex(p.ProjectError, message):
                e.rs2014_sources(project, ['own-seven'])

    def test_eight_string_and_extended_bass_refused(self):
        project = fixture()
        for identifier, kind, count in (('own-eight', 'guitar', 8), ('own-bass5', 'bass', 5)):
            arr = copy.deepcopy(project['arrangements'][0])
            arr.update(id=identifier, type=kind, role='bass' if kind == 'bass' else 'lead', stringCount=count, tuning=[0] * count, basePitches=p._instrument_bases(kind, count))
            project['arrangements'].append(arr)
        rows = {r['id']: r for r in e.native_compatibility(project)}
        self.assertIn('Eight-string', rows['own-eight']['reason'])
        self.assertIn('not defined in RS7X', rows['own-bass5']['reason'])
        for identifier in ('own-eight', 'own-bass5'):
            with self.assertRaisesRegex(p.ProjectError, 'not stock RS2014 compatible'):
                e.rs2014_sources(project, [identifier])

    def test_plain_xml_export_stays_stock_only(self):
        with self.assertRaisesRegex(p.ProjectError, 'six-string guitar'):
            p.save_xml(seven(), 'own-seven')
        with self.assertRaisesRegex(p.ProjectError, 'RS7X string order'):
            p.save_xml(seven(), 'own-seven', rs7x=True)


class FeedBackTargetsUntouchedTests(unittest.TestCase):
    """RS7X is a DLC Builder / rs7string convention; FeedBack output has its own schema."""
    def test_loose_folder_and_feedpak_have_no_rs7x_data(self):
        tree, _ = e.feedback_loose(seven(), flat_mp3=b'ID3')
        self.assertNotIn('rs7x.json', tree.entries)
        mirrors = [name for name in tree.entries if name.endswith('.xml') and '/' not in name]
        self.assertFalse(any(b'string6=' in tree.entries[name] for name in mirrors), 'no seven-string RS XML mirror')
        self.assertFalse(any(b'Rs7String6' in data for data in tree.entries.values()))
        with zipfile.ZipFile(io.BytesIO(p.save_feedpak(seven()))) as z:
            self.assertFalse(any(b'Rs7String6' in z.read(name) or name.endswith('rs7x.json') for name in z.namelist()))

    def test_compatible_flag_unchanged_for_seven_string(self):
        row = next(r for r in e.native_compatibility(seven()) if r['id'] == 'own-seven')
        self.assertEqual((row['compatible'], row['rs7x']), (False, True))


if __name__ == '__main__':
    unittest.main()
