"""Unit tests for eof_io.py against a hand-built, original minimal .eof binary (never a real
chart file - those are copyrighted content, not test fixtures)."""
import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import eof_io as e
import pack_io as p


def _str(value):
    data = value.encode('utf-8')
    return struct.pack('<H', len(data)) + data


def _note(name='', difficulty=0, string_mask=0b000011, frets=(3, 5), flags=0, slide_end=None, bend_strength=None, unpitch_end=None):
    out = _str(name)
    out += bytes([0])  # chord number: unused
    out += bytes([difficulty, string_mask, 0])  # difficulty, string mask, ghost mask
    for fret in frets:
        out += bytes([fret])
    out += bytes([0])  # legacy bitmask
    out += struct.pack('<II', 1000, 500)  # pos, length (ms)
    out += struct.pack('<I', flags)
    if flags & e.NOTE_FLAG_RS_NOTATION:
        if flags & (e.NOTE_FLAG_SLIDE_UP | e.NOTE_FLAG_SLIDE_DOWN):
            out += bytes([slide_end if slide_end is not None else 0])
        if flags & e.NOTE_FLAG_BEND:
            out += bytes([bend_strength if bend_strength is not None else 0])
    if flags & e.NOTE_FLAG_UNPITCH_SLIDE:
        out += bytes([unpitch_end if unpitch_end is not None else 0])
    return out


def _sections(rows_by_type):
    out = struct.pack('<H', len(rows_by_type))
    for section_type, rows in rows_by_type.items():
        out += struct.pack('<HI', section_type, len(rows))
        for name, difficulty, start, end, flags in rows:
            out += _str(name) + bytes([difficulty]) + struct.pack('<III', start, end, flags)
    return out


def _custom_blocks(blocks):
    out = struct.pack('<I', len(blocks))
    for block_id, payload in blocks:
        out += struct.pack('<II', len(payload) + 4, block_id) + payload
    return out


def _pro_guitar_track(notes, numfrets=24, numstrings=6, tuning=None, sections=None, custom=b''):
    tuning = tuning if tuning is not None else [0] * numstrings
    out = bytes([numfrets, numstrings]) + b''.join(struct.pack('<b', t) for t in tuning)
    out += struct.pack('<I', len(notes))
    for note in notes:
        out += note
    out += _sections(sections or {})
    out += custom if custom else struct.pack('<I', 0)
    return out


def _track(name, fmt, body=b'', behavior=0, ttype=0, difficulty=0xFF, altname=None):
    out = _str(name)
    flags = e.TRACK_FLAG_ALT_NAME if altname is not None else 0
    out += bytes([fmt, behavior, ttype, difficulty]) + struct.pack('<I', flags) + struct.pack('<H', 0)
    if altname is not None:
        out += _str(altname)
    out += body
    return out


def build_eof(title='Test Song', artist='Test Artist', tracks=(), frettist=None):
    header = e.MAGIC + b'\x00' * 8
    header += struct.pack('<I', 1) + bytes([0]) + struct.pack('<I', 0)
    strings = [(3, title), (2, artist)] + ([(4, frettist)] if frettist is not None else [])
    header += struct.pack('<H', len(strings))
    for kind, value in strings:
        header += bytes([kind]) + _str(value)
    header += struct.pack('<H', 0)  # booleans
    header += struct.pack('<H', 0)  # numbers
    header += struct.pack('<H', 0)  # ogg profiles
    beats = [(0, 0, e.BEAT_FLAG_START_4_4, 0), (500, 0, 0, 0), (1000, 0, 0, 0)]
    header += struct.pack('<I', len(beats))
    for ppqn, pos, flags, key in beats:
        header += struct.pack('<III', ppqn, pos, flags) + struct.pack('<b', key)
    header += struct.pack('<I', 0)  # text events
    header += struct.pack('<I', 0)  # top-level custom data blocks
    header += struct.pack('<I', 1 + len(tracks))  # track 0 (global) + the given tracks
    header += _track('', 0, _sections({}) + struct.pack('<I', 0))
    for track_bytes in tracks:
        header += track_bytes
    return header


class EofIoTests(unittest.TestCase):
    def test_header_and_single_note_round_trip(self):
        note = _note(frets=(3, 5), string_mask=0b000011)
        track = _track('PART REAL_GUITAR', e.TRACK_FORMAT_PRO_GUITAR, _pro_guitar_track([note]), altname='Lead')
        data = build_eof(tracks=[track])
        parsed = e.parse_eof(data)
        self.assertEqual(parsed['title'], 'Test Song')
        self.assertEqual(parsed['artist'], 'Test Artist')
        guitar = next(t for t in parsed['tracks'] if t['format'] == e.TRACK_FORMAT_PRO_GUITAR)
        self.assertEqual(guitar['altname'], 'Lead')
        self.assertEqual(len(guitar['notes']), 1)
        self.assertEqual(guitar['notes'][0]['frets'][:2], [3, 5])

    def test_frettist_field_becomes_the_project_charter_name(self):
        note = _note(frets=(3,), string_mask=0b000001)
        track = _track('PART REAL_GUITAR', e.TRACK_FORMAT_PRO_GUITAR, _pro_guitar_track([note]))
        data = build_eof(tracks=[track], frettist='Jane Charter')
        project = e.eof_project(e.parse_eof(data))
        self.assertEqual(project['charterName'], 'Jane Charter')

    def test_chord_with_techniques_and_finger_array_builds_a_template(self):
        flags = e.NOTE_FLAG_HO | e.NOTE_FLAG_PALM_MUTE
        note = _note(name='Em', string_mask=0b000111, frets=(0, 2, 2), flags=flags)
        fingers = struct.pack('<BBB', 0, 2, 3)  # one byte per set string bit, in string order
        track = _track('PART REAL_GUITAR', e.TRACK_FORMAT_PRO_GUITAR,
                        _pro_guitar_track([note], custom=_custom_blocks([(2, fingers)])))
        data = build_eof(tracks=[track])
        parsed = e.parse_eof(data)
        project = e.eof_project(parsed)
        arr = project['arrangements'][0]
        self.assertEqual(len(arr['chords']), 1)
        chord = arr['chords'][0]
        self.assertEqual(len(chord['notes']), 3)
        self.assertEqual(arr['chord_templates'][chord['chord_id']]['displayName'], 'Em')
        for note_row in chord['notes']:
            self.assertTrue(note_row['techniques']['hammer_on'])
            self.assertTrue(note_row['techniques']['palm_mute'])
        self.assertEqual({n['string']: n['techniques'].get('left_hand') for n in chord['notes']}, {0: 0, 1: 2, 2: 3})

    def test_fret_hand_position_and_tone_change_sections(self):
        note = _note()
        sections = {e.SECTION_FRET_HAND_POS: [('', 0, 2000, 5, 0)],
                    e.SECTION_RS_TONE_CHANGE: [('Lead Tone', 0xFF, 0, 1, 0)]}
        track = _track('PART REAL_GUITAR', e.TRACK_FORMAT_PRO_GUITAR, _pro_guitar_track([note], sections=sections))
        data = build_eof(tracks=[track])
        project = e.eof_project(e.parse_eof(data))
        arr = project['arrangements'][0]
        self.assertEqual(arr['anchors'], [{'time': 2.0, 'fret': 5, 'width': 4}])
        self.assertEqual(arr['tones']['changes'], [{'time': 0.0, 'name': 'Lead Tone'}])

    def test_slide_and_bend_with_rs_notation_carry_real_values(self):
        flags = e.NOTE_FLAG_RS_NOTATION | e.NOTE_FLAG_SLIDE_UP
        note = _note(string_mask=0b000001, frets=(3,), flags=flags, slide_end=7)
        track = _track('PART REAL_GUITAR', e.TRACK_FORMAT_PRO_GUITAR, _pro_guitar_track([note]))
        data = build_eof(tracks=[track])
        project = e.eof_project(e.parse_eof(data))
        self.assertEqual(project['arrangements'][0]['notes'][0]['techniques']['slide_to'], 7)

    def test_bend_without_rs_notation_still_gets_a_valid_finite_value(self):
        note = _note(string_mask=0b000001, frets=(3,), flags=e.NOTE_FLAG_BEND)
        track = _track('PART REAL_GUITAR', e.TRACK_FORMAT_PRO_GUITAR, _pro_guitar_track([note]))
        data = build_eof(tracks=[track])
        project = e.eof_project(e.parse_eof(data))
        self.assertIsInstance(project['arrangements'][0]['notes'][0]['techniques']['bend'], (int, float))

    def test_full_project_validates_against_oce_schema(self):
        note = _note(name='Em', string_mask=0b000111, frets=(0, 2, 2))
        track = _track('PART REAL_BASS', e.TRACK_FORMAT_PRO_GUITAR, _pro_guitar_track([note], numstrings=4, tuning=[0, 0, 0, 0]))
        data = build_eof(tracks=[track])
        project = e.eof_project(e.parse_eof(data))
        p.validate_project(project)

    def test_rejects_non_eof_data_and_wrong_timing_format(self):
        with self.assertRaises(e.EofError):
            e.parse_eof(b'not an eof file')
        delta_timed = e.MAGIC + b'\x00' * 8 + struct.pack('<I', 1) + bytes([1]) + struct.pack('<I', 0)
        with self.assertRaises(e.EofError):
            e.parse_eof(delta_timed)

    def test_track_with_no_notes_is_skipped_and_project_without_any_pro_guitar_track_errors(self):
        empty_track = _track('PART REAL_BASS_22', e.TRACK_FORMAT_PRO_GUITAR, _pro_guitar_track([], numstrings=4))
        data = build_eof(tracks=[empty_track])
        with self.assertRaises(e.EofError):
            e.eof_project(e.parse_eof(data))

    def test_truncated_file_raises_rather_than_reading_past_the_end(self):
        note = _note()
        track = _track('PART REAL_GUITAR', e.TRACK_FORMAT_PRO_GUITAR, _pro_guitar_track([note]))
        data = build_eof(tracks=[track])
        with self.assertRaises(e.EofError):
            e.parse_eof(data[:-10])


if __name__ == '__main__':
    unittest.main()
