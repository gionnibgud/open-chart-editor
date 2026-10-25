"""R+ Workshop .rsw read-only import, on synthetic projects written in the decoded layout."""
from pathlib import Path
import struct
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pack_io as p
import rsw_reader as rr


def text(value):
    data = value.encode('utf-8')
    return struct.pack('<I', len(data)) + data


def guid(n):
    return bytes([n]) * 16


def build(*, notes=(), chords=(), handshapes=(), tempo=((0, 120.0),), meter=((0, 4, 4),), templates=(), reserved=0, trailing=b''):
    """A made-up song in the .rsw layout rsw_reader decodes."""
    body = guid(1) + text('Test Song') + struct.pack('<f', 12.0) + text('Nobody') + text('') + struct.pack('<I', 2024)
    body += struct.pack('<I', 1) + guid(2) + struct.pack('<HIIIB', 0, 1, 0, 0, 0) + struct.pack('<ff', 12.0, 0.5)
    body += struct.pack('<I', len(tempo)) + b''.join(struct.pack('<If', b, bpm) for b, bpm in tempo)
    body += struct.pack('<I', len(meter)) + b''.join(struct.pack('<IIII', b, den, num, num) + struct.pack(f'<{num}I', *([1] * num)) for b, num, den in meter)
    body += struct.pack('<I', len(templates))
    for key, name, frets, fingers in templates:
        body += text(key) + text(name) + struct.pack('<I', 6) + struct.pack('<6i', *frets) + struct.pack('<I', 6) + struct.pack('<6i', *fingers)
    body += struct.pack('<5I', reserved, 0, 0, 0, 0)
    body += struct.pack('<I', 1) + struct.pack('<ff', 0, 12) + guid(3)                       # tones
    body += struct.pack('<I', 2) + text('default') + b'\x00' + text('A') + b'\x01'           # phrases
    body += struct.pack('<I', 2) + struct.pack('<ff', 0, 2) + text('default') + struct.pack('<ff', 2, 10) + text('A')
    body += struct.pack('<I', 1) + struct.pack('<f', 2.0) + text('verse')                    # sections
    body += struct.pack('<I', 1) + struct.pack('<f', 0.0) + text('B0')                       # events
    body += struct.pack('<I', 1) + struct.pack('<fBB', 2.0, 3, 4)                            # anchors
    body += struct.pack('<I', len(notes))
    for time, sustain, fret, string, finger, bends, slide, flags in notes:
        body += struct.pack('<ffBBbb', time, sustain, fret, string, finger, -1) + struct.pack('<I', len(bends))
        body += b''.join(struct.pack('<ff', t, s) for t, s in bends) + struct.pack('<BI', slide, flags)
    body += struct.pack('<I', len(chords))
    for time, key, repeats in chords:
        body += struct.pack('<ff', time, 0) + text(key) + struct.pack('<I', len(repeats)) + b''.join(struct.pack('<fB', t, f) for t, f in repeats)
    body += struct.pack('<I', len(handshapes)) + b''.join(struct.pack('<ff', s, e) + text(k) + b'\x01\x01' for s, e, k in handshapes)
    body += struct.pack('<4I', 0, 0, 0, 0) + trailing
    size = 10 + len(body)
    return struct.pack('<HII', 23, size, 0x12345678) + body


G = ('G_320003_210003', 'G', [3, 2, 0, 0, 0, 3], [2, 1, -1, -1, -1, 3])
SAMPLE = dict(templates=[G], tempo=((0, 120.0), (8, 60.0)),
              notes=[(2.0, 0.0, 3, 0, 1, [], 100, 1 << 5), (2.5, 0.5, 5, 1, 3, [(2.6, 1.0)], 100, 1 << 10),
                     (3.0, 0.4, 7, 2, -1, [], 9, 1 << 2), (3.5, 0.2, 5, 2, -1, [], 2, 1 << 18)],
              chords=[(4.0, 'G_320003_210003', [(4.25, 1), (4.5, 0)])], handshapes=[(4.0, 4.9, 'G_320003_210003')])


class ReaderTests(unittest.TestCase):
    def test_project_contents(self):
        project = p.load_project(build(**SAMPLE), 'song.rsw')
        self.assertEqual((project['title'], project['artist'], project['year']), ('Test Song', 'Nobody', 2024))
        arr = project['arrangements'][0]
        self.assertEqual((arr['type'], arr['stringCount']), ('guitar', 6))
        notes = sorted(arr['notes'], key=lambda n: n['time'])
        self.assertEqual([(n['time'], n['string'], n['fret']) for n in notes], [(2.0, 0, 3), (2.5, 1, 5), (3.0, 2, 7), (3.5, 2, 5)])
        self.assertTrue(notes[0]['techniques'].get('palm_mute'))
        self.assertTrue(notes[1]['techniques'].get('hammer_on'))
        self.assertTrue(notes[2]['techniques'].get('link_next'))
        self.assertEqual(len(arr['chords']), 3, 'the chord and its two repeat strums')
        self.assertEqual({len(c['notes']) for c in arr['chords']}, {6})
        self.assertEqual(arr['chord_templates'][0]['name'], 'G')
        self.assertEqual(len(arr['handshapes']), 1)
        self.assertEqual([s['name'] for s in project['sections']], ['verse'])
        self.assertEqual(project['_import']['format'], 'rplus-oce-rsw')
        warnings = ' '.join(project['import_warnings'])
        self.assertIn('read-only', warnings)
        self.assertIn('standard tuning', warnings)

    def test_tempo_and_meter_build_the_beat_map(self):
        beats = rr._beats(rr.parse_rsw(build(tempo=((0, 120.0), (4, 60.0)), meter=((0, 4, 4), (8, 6, 8)))))
        self.assertEqual([round(b['time'], 3) for b in beats[:6]], [0, 0.5, 1.0, 1.5, 2.0, 3.0], '120 then 60 BPM from beat 4')
        self.assertEqual([b['measure'] for b in beats[:9]], [1, -1, -1, -1, 2, -1, -1, -1, 3])
        # 6/8 from beat 8: eighth-note beats at half the quarter-note length, bars of six.
        self.assertAlmostEqual(beats[9]['time'] - beats[8]['time'], 0.5)
        self.assertEqual([b['measure'] >= 0 for b in beats[8:15]], [True, False, False, False, False, False, True])

    def test_slides_and_bends(self):
        xml = rr._xml(rr.parse_rsw(build(**SAMPLE))).decode()
        self.assertIn('slideTo="9"', xml)
        self.assertIn('slideUnpitchTo="2"', xml)
        self.assertIn('bendValue time="2.600" step="1"', xml)
        self.assertIn('highDensity="1"', xml)

    def test_empty_project(self):
        project = p.load_project(build(), 'empty.rsw')
        self.assertEqual(project['arrangements'][0]['notes'], [])
        self.assertGreater(len(project['beats']), 20)

    def test_refuses_what_it_cannot_read(self):
        data = build(**SAMPLE)
        with self.assertRaisesRegex(p.ProjectError, 'size field'):
            p.load_project(data[:-3], 'cut.rsw')
        with self.assertRaisesRegex(p.ProjectError, 'does not read yet'):
            p.load_project(build(reserved=1), 'more.rsw')
        with self.assertRaisesRegex(p.ProjectError, 'after the chart'):
            p.load_project(build(trailing=b'\x01\x00\x00\x00'), 'trailing.rsw')
        with self.assertRaisesRegex(p.ProjectError, 'unknown chord shape'):
            p.load_project(build(templates=[G], chords=[(1.0, 'missing', [])]), 'shape.rsw')
        with self.assertRaisesRegex(p.ProjectError, 'Unsupported R\\+ Workshop project format'):
            p.load_project(struct.pack('<HII', 99, 10, 0), 'future.rsw')

    def test_original_bytes_are_kept(self):
        data = build(**SAMPLE)
        project = p.load_project(data, 'song.rsw')
        import base64
        self.assertIn(data, [base64.b64decode(v) for k, v in project['_pack']['entries'].items() if k.endswith('.rsw')])


if __name__ == '__main__':
    unittest.main()
