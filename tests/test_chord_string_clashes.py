"""Converted chords with two notes on one string are made playable without changing pitch."""
from pathlib import Path
import sys
import unittest
import xml.etree.ElementTree as ET

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import pack_io as p

STANDARD=[40,45,50,55,59,64]


def chord(*notes):
    return ET.fromstring('<level><chords><chord time="1">'+''.join(f'<chordNote string="{s}" fret="{f}"/>' for s,f in notes)+'</chord></chords></level>')


def sounding(root):
    return sorted(STANDARD[int(n.get('string'))]+int(n.get('fret')) for n in root.iter('chordNote'))


class ChordStringClashTests(unittest.TestCase):
    def test_clean_chords_are_untouched(self):
        root=chord((0,3),(1,2),(2,0));before=ET.tostring(root)
        self.assertEqual(p._resolve_chord_string_clashes(root,STANDARD),(0,0));self.assertEqual(ET.tostring(root),before)

    def test_clash_moves_to_free_string_with_same_pitch(self):
        root=chord((5,3),(5,8),(0,0))            # G4 and C5 both on high e
        self.assertEqual(p._resolve_chord_string_clashes(root,STANDARD),(1,0))
        strings=[int(n.get('string')) for n in root.iter('chordNote')]
        self.assertEqual(len(strings),len(set(strings)));self.assertEqual(sounding(root),[40,67,72])

    def test_unison_duplicate_is_dropped(self):
        root=chord((3,2),(3,2),(1,2))
        self.assertEqual(p._resolve_chord_string_clashes(root,STANDARD),(0,1));self.assertEqual(sounding(root),[47,57])


if __name__=='__main__':
    unittest.main()
