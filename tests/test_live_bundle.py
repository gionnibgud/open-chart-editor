"""The live view's data for FeedBack's highway renderers: one part in FeedBack's wire shapes."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pack_io as p


class LiveBundleTests(unittest.TestCase):
    def test_a_part_in_feedback_wire_shapes(self):
        arrangement = {'type': 'guitar', 'name': 'Lead', 'stringCount': 6, 'tuning': [-2, 0, 0, 0, 0, 0], 'capo': 0,
                       'notes': [{'id': 'b', 'time': 2, 'string': 1, 'fret': 5, 'sustain': 0, 'techniques': {'hammer_on': True}},
                                 {'id': 'a', 'time': 1, 'string': 0, 'fret': 3, 'sustain': 0.5, 'techniques': {}}],
                       'chords': [{'time': 3, 'chord_id': 0, 'notes': [{'id': 'c1', 'time': 3, 'string': 1, 'fret': 0, 'sustain': 0, 'techniques': {}},
                                                                      {'id': 'c2', 'time': 3, 'string': 2, 'fret': 2, 'sustain': 0, 'techniques': {}}]}],
                       'chord_templates': [{'name': 'Am', 'displayName': 'Am_X02210_XX231X', 'frets': [-1, 0, 2, 2, 1, 0], 'fingers': [-1, -1, 2, 3, 1, -1]},
                                           {'name': '', 'displayName': 'XX9X12X_XX1X4X-arp', 'frets': [-1, -1, 9, -1, 12, -1], 'fingers': [-1, -1, 1, -1, 4, -1]}],
                       'anchors': [{'time': 0, 'fret': 1, 'width': 4}], 'handshapes': [{'start_time': 3, 'end_time': 4, 'chord_id': 0}]}
        bundle = p.live_bundle(arrangement, [{'time': 0, 'measure': 1}], [{'name': 'verse', 'start_time': 0}], {'title': 'Song'})
        self.assertEqual([(n['t'], n['s'], n['f']) for n in bundle['notes']], [(1, 0, 3), (2, 1, 5)], 'sorted by time')
        self.assertTrue(bundle['notes'][1].get('ho'))
        self.assertEqual(bundle['chords'][0]['id'], 0)
        self.assertEqual([t['displayName'] for t in bundle['chordTemplates']], ['Am', ''], 'R+ codes are not names')
        self.assertEqual([t['arp'] for t in bundle['chordTemplates']], [False, True], 'an -arp display name marks an arpeggio')
        self.assertEqual(bundle['handShapes'], [{'chord_id': 0, 'start_time': 3, 'end_time': 4, 'arp': False}])
        self.assertEqual(bundle['sections'], [{'name': 'verse', 'time': 0}])
        self.assertEqual((bundle['songInfo']['title'], bundle['songInfo']['tuning'], bundle['stringCount']), ('Song', [-2, 0, 0, 0, 0, 0], 6))


if __name__ == '__main__':
    unittest.main()
