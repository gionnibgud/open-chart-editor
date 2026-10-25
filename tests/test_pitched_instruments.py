"""Instrument labels for pitched parts, from a track name or a General MIDI program."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pack_io as p


class PitchedInstrumentTests(unittest.TestCase):
    def test_names_win(self):
        for name, label in [('Flute in C', 'flute'), ('Viola Ensemble', 'viola'), ('Violin Ensemble', 'violin'), ('Alto Saxophone', 'alto sax'),
                            ('Tenor Sax', 'tenor sax'), ('Sax', 'saxophone'), ('Bb Clarinet', 'clarinet'), ('A.Piano', 'piano'), ('Synthesizer', 'synth'),
                            ('Celesta', 'celesta'), ('Choir Aahs', 'voice'), ('Double Bass', 'contrabass')]:
            self.assertEqual(p.pitched_instrument(name, 0), label, name)

    def test_program_is_the_fallback(self):
        self.assertEqual(p.pitched_instrument('Track 7', 73), 'flute')
        self.assertEqual(p.pitched_instrument('Lead', 41), 'viola')
        self.assertEqual(p.pitched_instrument('Pad', 90), 'synth')
        self.assertEqual(p.pitched_instrument('Part 1', None), 'keys')


if __name__ == '__main__':
    unittest.main()
