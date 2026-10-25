"""Loose folders as FeedBack's own loose loader reads them (lib/loosefolder.py + song.load_song):
it plays audio.wem or audio.mp3 and loads every *.xml anywhere in the folder as a chart."""
import base64
import copy
import io
import math
from pathlib import Path
import struct
import sys
import unittest
import wave
import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import export_targets as e
import pack_io as p
from test_pack_io import project


def tone():
    out = io.BytesIO()
    with wave.open(out, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000)
        w.writeframes(b''.join(struct.pack('<h', int(2000 * math.sin(i / 3))) for i in range(8000)))
    return out.getvalue()


def song():
    s = project()
    s['beats'] = [{'time': i / 2, 'measure': i // 4 + 1 if i % 4 == 0 else -1} for i in range(41)]
    keys = {'id': 'piano', 'name': 'Piano', 'type': 'keys', 'stringCount': 6, 'tuning': [0] * 6, 'basePitches': [], 'capo': 0,
            'notes': [{'id': 'n1', 'time': 1.0, 'sustain': 0.4, 'string': 60 // 24, 'fret': 60 % 24, 'pitch': 60, 'techniques': {}}],
            'chords': [{'time': 2.0, 'chord_id': 0, 'notes': [{'id': f'c{p_}', 'time': 2.0, 'sustain': 0.4, 'string': p_ // 24, 'fret': p_ % 24, 'pitch': p_, 'techniques': {}} for p_ in (64, 67)]}],
            'chord_templates': [{'name': '', 'displayName': '', 'frets': [-1] * 6, 'fingers': [-1] * 6}], 'anchors': [], 'handshapes': []}
    s['arrangements'].append(keys)
    s['_pack'] = {'manifest': {'stems': [{'id': 'full', 'file': 'audio/full.wav', 'default': True}]},
                  'entries': {'audio/full.wav': base64.b64encode(tone()).decode(),
                              'Official_Lead1_kept_v1.xml': base64.b64encode(b'<song version="19"><title>kept</title></song>').decode()}}
    return p.validate_project(s)


class LooseFolderTests(unittest.TestCase):
    def test_folder_for_feedbacks_loose_loader(self):
        tree, report = e.feedback_loose(copy.deepcopy(song()), flat_mp3=b'ID3 not really an mp3')
        names = set(tree.entries)
        self.assertIn('audio.mp3', names, 'FeedBack plays audio.wem or audio.mp3')
        xml = sorted(n for n in names if n.lower().endswith('.xml'))
        self.assertEqual(xml, sorted(m['file'] for m in report['legacyNativeMirrors']), 'only the mirrors are *.xml')
        self.assertIn('editor/original-source/Official_Lead1_kept_v1.xml.original', names)
        keyboard = next(m for m in report['legacyNativeMirrors'] if m['type'] == 'keys')
        self.assertTrue(keyboard['file'].endswith('_keyboard.xml'))
        root = ET.fromstring(tree.entries[keyboard['file']])
        self.assertEqual(sorted(int(n.get('midi')) for n in root.iter('note')), [60, 64, 67], 'chord members included')

    def test_without_an_mp3_the_wav_is_kept_with_a_warning(self):
        tree, report = e.feedback_loose(copy.deepcopy(song()))
        self.assertIn('audio.wav', tree.entries)
        self.assertTrue(any('audio.wem or audio.mp3' in w for w in report['warnings']))

    def test_folders_written_before_the_rename_still_open(self):
        import json
        tree, _ = e.feedback_loose(copy.deepcopy(song()), flat_mp3=b'ID3')
        entries = dict(tree.entries)
        metadata = json.loads(entries.pop('manifest.json'))
        bridge = metadata.pop(e.BRIDGE)
        # Old names: editable.workshop.json and the workshopPerformance bridge key.
        entries[e.OLD_MASTER] = entries.pop(e.MASTER)
        bridge['entries'][e.OLD_MASTER] = bridge['entries'].pop(e.MASTER)
        metadata[e.OLD_BRIDGE] = bridge
        entries['manifest.json'] = e._json(metadata)
        out = io.BytesIO()
        import zipfile
        with zipfile.ZipFile(out, 'w') as z:
            for name, data in entries.items():
                z.writestr(name, data)
        reopened = e.load_folder_archive(out.getvalue())
        self.assertEqual([a['name'] for a in reopened['arrangements']], [a['name'] for a in song()['arrangements']])


if __name__ == '__main__':
    unittest.main()
