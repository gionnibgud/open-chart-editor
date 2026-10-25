"""A fretted Guitar Pro track past fret 24 is kept as a pitched part at the same pitches."""
from pathlib import Path
import sys
import unittest
import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pack_io as p


CHART = '''<song version="7"><chordTemplates count="1"><chordTemplate chordName="X" fret0="3" fret1="5" /></chordTemplates>
<levels count="1"><level difficulty="0"><notes count="2"><note time="1.000" string="0" fret="31" sustain="0.5" slideTo="33" />
<note time="0.500" string="1" fret="2" sustain="0" /></notes><chords count="1"><chord time="2.000" chordId="0">
<chordNote string="0" fret="3" sustain="0.25" /><chordNote string="1" fret="5" sustain="0.25" /></chord></chords>
<handShapes count="1"><handShape chordId="0" startTime="2" endTime="2.5" /></handShapes></level></levels></song>'''


class PitchedFallbackTests(unittest.TestCase):
    def test_real_pitches_in_keys_encoding(self):
        root = ET.fromstring(p._fretted_xml_as_pitched(ET.fromstring(CHART), [40, 45], 2))
        notes = [(float(n.get('time')), int(n.get('string')) * 24 + int(n.get('fret'))) for n in root.iter('note')]
        # open 40 + capo 2 + fret 31 = 73; open 45 + 2 + 2 = 49; chord 40+2+3 and 45+2+5.
        self.assertEqual(notes, [(0.5, 49), (1.0, 73), (2.0, 45), (2.0, 52)])
        self.assertIsNone(root.find('.//note').get('slideTo'))
        self.assertEqual(root.find('.//chords').get('count'), '0')
        self.assertEqual(root.find('.//handShapes').get('count'), '0')
        self.assertEqual(root.find('chordTemplates').get('count'), '0')
        self.assertEqual([n.get('sustain') for n in root.iter('note')], ['0', '0.5', '0.25', '0.25'])


if __name__ == '__main__':
    unittest.main()
