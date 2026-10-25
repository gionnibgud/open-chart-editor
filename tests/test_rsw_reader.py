"""R+ Workshop .rsw read-only import, on synthetic projects written in the decoded layout."""
from pathlib import Path
import base64
import struct
import sys
import unittest
import zlib
from xml.etree import ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pack_io as p
import rsw_reader as rr


def text(value):
    data = value.encode('utf-8')
    return struct.pack('<I', len(data)) + data


def guid(n):
    return bytes([n]) * 16


def level(notes=(), chords=(), handshapes=(), anchors=((2.0, 3, 4),)):
    body = struct.pack('<I', len(anchors)) + b''.join(struct.pack('<fBB', *a) for a in anchors)
    body += struct.pack('<I', len(notes))
    for time, sustain, fret, string, left, right, bends, slide, flags in notes:
        body += struct.pack('<ffBBbb', time, sustain, fret, string, left, right) + struct.pack('<I', len(bends))
        body += b''.join(struct.pack('<ff', t, s) for t, s in bends) + struct.pack('<BI', slide, flags)
    body += struct.pack('<I', len(chords))
    for time, sustain, key, repeats in chords:
        body += struct.pack('<ff', time, sustain) + text(key) + struct.pack('<I', len(repeats)) + b''.join(struct.pack('<fB', t, f) for t, f in repeats)
    body += struct.pack('<I', len(handshapes)) + b''.join(struct.pack('<ff', s, e) + text(k) + struct.pack('<BB', mode, hide) for s, e, k, mode, hide in handshapes)
    return body


EMPTY_LEVEL = struct.pack('<4I', 0, 0, 0, 0)


def arrangement(*, version=23, instrument=0, arrangement_type=0, cents=0, capo=0, tuning=None, tempo=((0, 120.0),), meter=((0, 4, 4),),
                templates=(), legacy=0, default_tone=0, primary=None, secondary=EMPTY_LEVEL):
    tuning = tuning if tuning is not None else [0] * (4 if instrument == 1 else 6)
    body = guid(2) + struct.pack('<HHiB', instrument, arrangement_type, cents, capo) + struct.pack(f'<{len(tuning)}b', *tuning) + struct.pack('<ff', 12.0, 0.5)
    body += struct.pack('<I', len(tempo)) + b''.join(struct.pack('<If', b, bpm) for b, bpm in tempo)
    body += struct.pack('<I', len(meter))
    for b, num, den in meter:
        body += struct.pack('<III', b, den, num)
        if version >= 23:
            body += struct.pack('<I', num) + struct.pack(f'<{num}I', *([1] * num))
    body += struct.pack('<I', len(templates))
    for key, name, frets, fingers in templates:
        body += text(key) + text(name) + struct.pack('<I', len(frets)) + struct.pack(f'<{len(frets)}i', *frets) + struct.pack('<I', len(fingers)) + struct.pack(f'<{len(fingers)}i', *fingers)
    body += struct.pack('<I', legacy) + guid(default_tone)
    body += struct.pack('<I', 1) + struct.pack('<ff', 0, 12) + guid(3)                       # tones
    body += struct.pack('<I', 2) + text('default') + b'\x00' + text('A') + b'\x05'           # phrases and colours
    body += struct.pack('<I', 2) + struct.pack('<ff', 0, 2) + text('default') + struct.pack('<ff', 2, 10) + text('A')
    body += struct.pack('<I', 1) + struct.pack('<f', 2.0) + text('verse')                    # sections
    body += struct.pack('<I', 1) + struct.pack('<f', 0.0) + text('B0')                       # events
    return body + (primary if primary is not None else level()) + secondary


def build(*arrangements, version=23, trailer=b'', crc=True, **one):
    """A made-up song in the .rsw layout rsw_reader decodes."""
    arrangements = arrangements or (arrangement(version=version, **one),)
    body = guid(1) + text('Test Song') + struct.pack('<f', 12.0) + text('Nobody') + text('') + struct.pack('<I', 2024)
    body += struct.pack('<I', len(arrangements)) + b''.join(arrangements) + trailer
    if version == 21:
        return struct.pack('<H', 21) + body
    size = 10 + len(body)
    stored = zlib.crc32(body, 0xFFFFFFFB) & 0xFFFFFFFF if crc else 0x12345678
    return struct.pack('<HII', version, size, stored) + body


G = ('G_320003_210003', 'G', [3, 2, 0, 0, 0, 3], [2, 1, -1, -1, -1, 3])
NOTES = [(2.0, 0.0, 3, 0, 1, -1, [], 100, 1 << 5), (2.5, 0.5, 5, 1, 3, 2, [(2.6, 1.0)], 100, 1 << 10),
         (3.0, 0.4, 7, 2, -1, -1, [], 9, 1 << 2), (3.5, 0.2, 5, 2, -1, -1, [], 2, 1 << 18)]
# The G chord's own notes (flag bit 0), with their own sustain; string 4 also has an accent.
MEMBERS = [(4.0, 0.9, fret, string, -1, -1, [], 100, 1 | (1 << 3 if string == 4 else 0)) for string, fret in enumerate(G[2])]
SAMPLE = dict(templates=[G], tempo=((0, 120.0), (8, 60.0)),
              primary=level(NOTES + MEMBERS, chords=[(4.0, 0.75, 'G_320003_210003', [(4.25, 1), (4.5, 0)])],
                            handshapes=[(4.0, 4.9, 'G_320003_210003', 0, 0), (6.0, 6.9, 'G_320003_210003', 2, 0),
                                        (7.0, 7.9, 'G_320003_210003', 1, 1)]))


class ReaderTests(unittest.TestCase):
    def test_project_contents(self):
        project = p.load_project(build(**SAMPLE), 'song.rsw')
        self.assertEqual((project['title'], project['artist'], project['year']), ('Test Song', 'Nobody', 2024))
        arr = project['arrangements'][0]
        self.assertEqual((arr['type'], arr['stringCount'], arr['name']), ('guitar', 6, 'Lead'))
        notes = sorted(arr['notes'], key=lambda n: n['time'])
        self.assertEqual([(n['time'], n['string'], n['fret']) for n in notes], [(2.0, 0, 3), (2.5, 1, 5), (3.0, 2, 7), (3.5, 2, 5)])
        self.assertTrue(notes[0]['techniques'].get('palm_mute'))
        self.assertTrue(notes[1]['techniques'].get('hammer_on'))
        self.assertEqual(notes[1]['techniques'].get('right_hand'), 2)
        self.assertTrue(notes[2]['techniques'].get('link_next'))
        self.assertEqual(len(arr['chords']), 3, 'the chord and its two repeat strums')
        self.assertEqual({len(c['notes']) for c in arr['chords']}, {6})
        first = min(arr['chords'], key=lambda c: c['time'])
        self.assertEqual({n['sustain'] for n in first['notes']}, {0.9}, 'chord notes come from the chord-member notes, not doubled as single notes')
        self.assertTrue(next(n for n in first['notes'] if n['string'] == 4)['techniques'].get('accent'))
        self.assertEqual(arr['chord_templates'][0]['name'], 'G')
        self.assertEqual(len(arr['handshapes']), 3)
        names = {str(t.get('displayName')) for t in arr['chord_templates']}
        self.assertTrue({'G-arp', 'G-nop'} <= names, 'mode 2 is an arpeggio; the second byte hides the name')
        self.assertEqual(sum(1 for n in names if n.endswith('-arp')), 1, 'mode 1 is a normal hand shape, not an arpeggio')
        self.assertEqual([s['name'] for s in project['sections']], ['verse'])
        self.assertEqual(project['_import']['format'], 'rplus-oce-rsw')
        self.assertEqual(project['_import']['arrangements'][0]['phraseColours'], {'default': 0, 'A': 5})
        self.assertIn('read-only', ' '.join(project['import_warnings']))

    def test_chord_flags_and_negative_offset_beats(self):
        members = [(4.0, 0.0, f, s, -1, -1, [], 100, 1 | 1 << 2 | (1 << 3 if s == 0 else 0)) for s, f in enumerate(G[2])]
        rsw = rr.parse_rsw(build(templates=[G], primary=level(members, chords=[(4.0, 0.0, G[0], [(4.25, 1), (4.5, 2), (4.75, 4), (5.0, 0)])])))
        chords = ET.fromstring(rr._xml(rsw['song'], rsw['arrangements'][0])).findall('./levels/level/chords/chord')
        flags = [{k: v for k, v in c.attrib.items() if k not in ('time', 'chordId')} for c in chords]
        self.assertEqual(flags, [{'highDensity': '0', 'linkNext': '1'}, {'highDensity': '1', 'palmMute': '1'},
                                 {'highDensity': '1', 'fretHandMute': '1'}, {'highDensity': '1', 'accent': '1'}, {'highDensity': '1'}],
                         'first strike: flags all its notes share (accent is on one string only); repeats: their flag byte')
        rsw = rr.parse_rsw(build(**{**SAMPLE}))
        self.assertEqual(rr._beats(rsw['song'], rsw['arrangements'][0])[0]['time'], 0.0)
        late = rr.parse_rsw(build(primary=level()).replace(struct.pack('<ff', 12.0, 0.5), struct.pack('<ff', 12.0, -0.468), 1))
        self.assertAlmostEqual(rr._beats(late['song'], late['arrangements'][0])[0]['time'], 0.468, places=5)

    def test_note_flags(self):
        flags = {'accent': 1 << 3, 'mute': 1 << 6, 'harmonic': 1 << 8, 'harmonicPinch': 1 << 9, 'tremolo': 1 << 19}
        notes = [(1.0 + i, 0.0, 3, 0, -1, -1, [], 100, bit) for i, bit in enumerate(flags.values())]
        notes.append((9.0, 0.0, 3, 0, -1, -1, [], 100, (1 << 8) | (1 << 9)))     # both: harmonic wins
        rsw = rr.parse_rsw(build(primary=level(notes)))
        xml = rr._xml(rsw['song'], rsw['arrangements'][0]).decode()
        for name in flags:
            self.assertIn(f'{name}="1"', xml, name)
        self.assertIn('<note time="9.000" string="0" fret="3" sustain="0.000" harmonic="1" />', xml)
        warnings = ' '.join(p.load_project(build(primary=level([(1.0, 0.0, 3, 0, -1, -1, [], 100, 0b11)])), 'x.rsw')['import_warnings'])
        self.assertNotIn('flags this importer does not read', warnings, 'chord-member and continuation bits are known')

    def test_tuning_capo_cents_and_bass(self):
        arr = p.load_project(build(tuning=[-2, 0, 0, 0, 0, 0], capo=2, cents=-50), 'drop.rsw')['arrangements'][0]
        self.assertEqual((arr['tuning'], arr['capo'], arr['centOffset']), ([-2, 0, 0, 0, 0, 0], 2, -50))
        bass = p.load_project(build(instrument=1, arrangement_type=4, tuning=[-1, -1, -1, -1],
                                    primary=level([(2.0, 0.0, 3, 3, -1, -1, [], 100, 0)])), 'bass.rsw')['arrangements'][0]
        self.assertEqual((bass['type'], bass['stringCount'], bass['tuning'], bass['name']), ('bass', 4, [-1, -1, -1, -1], 'Bass'))
        with self.assertRaisesRegex(p.ProjectError, 'outside a 4-string bass'):
            p.load_project(build(instrument=1, primary=level([(2.0, 0.0, 3, 5, -1, -1, [], 100, 0)])), 'bad.rsw')
        with self.assertRaisesRegex(p.ProjectError, 'vocals arrangement'):
            rr._arrangement(rr._Reader(guid(2) + struct.pack('<H', 2)), 23)
        with self.assertRaisesRegex(p.ProjectError, 'instrument type 3'):
            rr._arrangement(rr._Reader(guid(2) + struct.pack('<H', 3)), 23)

    def test_arrangement_types(self):
        def opened(instrument, value):
            project = p.load_project(build(instrument=instrument, arrangement_type=value,
                                           primary=level([(2.0, 0.0, 3, 0, -1, -1, [], 100, 0)])), 'part.rsw')
            arr = project['arrangements'][0]
            return arr['name'], arr['role'], arr['priority'], ' '.join(project['import_warnings'])
        expected = {0: ('Lead', 'lead', 'main'), 1: ('Alt Lead', 'lead', 'alternative'), 2: ('Rhythm', 'rhythm', 'main'),
                    3: ('Alt Rhythm', 'rhythm', 'alternative')}
        for value, row in expected.items():
            self.assertEqual(opened(0, value)[:3], row, value)
        self.assertEqual(opened(1, 4)[:3], ('Bass', 'bass', 'main'))
        self.assertEqual(opened(1, 5)[:3], ('Alt Bass', 'bass', 'alternative'))
        self.assertEqual(opened(0, 6)[:3], ('Lead', 'lead', 'main'), 'converted as R+ Workshop does')
        self.assertEqual(opened(1, 8)[:3], ('Bass', 'bass', 'main'))
        name, role, _, warnings = opened(0, 666)
        self.assertEqual((name, role), ('Lead', 'lead')); self.assertIn('109001', warnings)
        name, _, _, warnings = opened(0, 4)
        self.assertEqual(name, 'Lead'); self.assertIn('the instrument is guitar', warnings)

    def test_formats_21_22_and_checksum(self):
        for version in (21, 22, 23):
            with self.subTest(version=version):
                project = p.load_project(build(version=version, **SAMPLE), 'song.rsw')
                self.assertEqual(project['_import']['version'], version)
                self.assertEqual(len(project['arrangements'][0]['notes']), 4)
        self.assertTrue(rr.parse_rsw(build(**SAMPLE))['checksumOk'])
        warnings = ' '.join(p.load_project(build(crc=False, **SAMPLE), 'changed.rsw')['import_warnings'])
        self.assertIn('checksum does not match', warnings)

    def test_several_arrangements_default_tone_trailer_and_scratch_track(self):
        data = build(arrangement(arrangement_type=1, default_tone=9), arrangement(instrument=1, arrangement_type=0, secondary=level([(5.0, 0.0, 1, 0, -1, -1, [], 100, 0)])),
                     trailer=b'\x00\x01')
        project = p.load_project(data, 'band.rsw')
        self.assertEqual([(a['name'], bool(a.get('editorOnly')), a.get('scratchFor')) for a in project['arrangements']],
                         [('Alt Lead', False, None), ('Bass', False, None), ('Scratch · Bass', True, 'rsw-1')])
        self.assertEqual(project['_import']['arrangements'][0]['defaultTone'], '09' * 16)
        warnings = ' '.join(project['import_warnings'])
        self.assertIn("project's scratch track opens as this part's scratch track", warnings)
        self.assertIn('2 bytes after the last arrangement', warnings)

    def test_tempo_and_meter_build_the_beat_map(self):
        rsw = rr.parse_rsw(build(tempo=((0, 120.0), (4, 60.0)), meter=((0, 4, 4), (8, 6, 8))))
        beats = rr._beats(rsw['song'], rsw['arrangements'][0])
        self.assertEqual([round(b['time'], 3) for b in beats[:6]], [0, 0.5, 1.0, 1.5, 2.0, 3.0], '120 then 60 BPM from beat 4')
        self.assertEqual([b['measure'] for b in beats[:9]], [1, -1, -1, -1, 2, -1, -1, -1, 3])
        # 6/8 from beat 8: eighth-note beats at half the quarter-note length, bars of six.
        self.assertAlmostEqual(beats[9]['time'] - beats[8]['time'], 0.5)
        self.assertEqual([b['measure'] >= 0 for b in beats[8:15]], [True, False, False, False, False, False, True])

    def test_slides_and_bends(self):
        rsw = rr.parse_rsw(build(**SAMPLE))
        xml = rr._xml(rsw['song'], rsw['arrangements'][0]).decode()
        self.assertIn('slideTo="9"', xml)
        self.assertIn('slideUnpitchTo="2"', xml)
        self.assertIn('bendValue time="2.600" step="1"', xml)
        self.assertIn('highDensity="1"', xml)

    def test_empty_project(self):
        project = p.load_project(build(primary=level(anchors=())), 'empty.rsw')
        self.assertEqual(project['arrangements'][0]['notes'], [])
        self.assertGreater(len(project['beats']), 20)

    def test_refuses_what_it_cannot_read(self):
        data = build(**SAMPLE)
        with self.assertRaisesRegex(p.ProjectError, 'size field'):
            p.load_project(data[:-3], 'cut.rsw')
        with self.assertRaisesRegex(p.ProjectError, 'old list'):
            p.load_project(build(legacy=1), 'more.rsw')
        with self.assertRaisesRegex(p.ProjectError, 'unknown chord shape'):
            p.load_project(build(templates=[G], primary=level(chords=[(1.0, 0.0, 'missing', [])])), 'shape.rsw')
        with self.assertRaisesRegex(p.ProjectError, 'Unsupported R\\+ Workshop project format'):
            p.load_project(struct.pack('<HII', 99, 10, 0), 'future.rsw')

    def test_original_bytes_are_kept(self):
        data = build(**SAMPLE)
        project = p.load_project(data, 'song.rsw')
        self.assertIn(data, [base64.b64decode(v) for k, v in project['_pack']['entries'].items() if k.endswith('.rsw')])


if __name__ == '__main__':
    unittest.main()
