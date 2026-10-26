"""Slides: MusicXML import, and every save path keeps pitched and unpitched targets."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import pack_io as p
from test_musicxml_dynamics_candidate import score


def tab_note(step, octave, string, fret, slide=''):
    return (f'<note><pitch><step>{step}</step><octave>{octave}</octave></pitch><duration>1</duration><voice>1</voice>'
            f'<notations>{slide}<technical><string>{string}</string><fret>{fret}</fret></technical></notations></note>')


class MusicXmlSlideTests(unittest.TestCase):
    def load(self, body):
        return p.load_project(score(body).replace(b'<part-name>Piano</part-name>', b'<part-name>Guitar</part-name>'), 'own.musicxml')

    def test_slides_and_glissandos_become_pitched_slides_to_the_next_note(self):
        body = (tab_note('A', 2, 5, 0)
                + tab_note('D', 3, 5, 5, '<slide type="start"/>')
                + tab_note('E', 3, 5, 7, '<slide type="stop"/><glissando type="start" line-type="wavy"/>')
                + tab_note('C', 3, 5, 3, '<glissando type="stop" line-type="wavy"/>'))
        project = self.load(body)
        notes = sorted(project['arrangements'][0]['notes'], key=lambda n: n['time'])
        self.assertEqual([(n['fret'], n['techniques'].get('slide_to', -1)) for n in notes], [(0, -1), (5, 7), (7, 3), (3, -1)])

    def test_a_slide_with_no_end_is_reported(self):
        project = self.load(tab_note('D', 3, 5, 5, '<slide type="start"/>') + tab_note('E', 3, 4, 2))
        self.assertEqual(project['arrangements'][0]['notes'][0]['techniques'].get('slide_to', -1), -1)
        self.assertTrue(any('slide with no end note' in w for w in project['import_warnings']))


if __name__ == '__main__':
    unittest.main()
