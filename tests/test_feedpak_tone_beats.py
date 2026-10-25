"""FeedPak 1.20 beat-anchored tone changes stay coherent with t on the saved grid."""
import copy
import io
import json
from pathlib import Path
import sys
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pack_io as p
from test_pack_io import project


def saved_changes(song, index=0):
    with zipfile.ZipFile(io.BytesIO(p.save_feedpak(copy.deepcopy(song)))) as z:
        manifest = p.yaml.safe_load(z.read('manifest.yaml'))
        return json.loads(z.read(manifest['arrangements'][index]['file']))['tones']['changes']


def song_with(changes, **arrangement):
    song = project()
    song['beats'] = [{'time': i / 2, 'measure': i // 4 + 1 if i % 4 == 0 else -1} for i in range(41)]
    song['arrangements'][0]['tones'] = {'base': 'Clean', 'changes': changes, 'definitions': {}}
    song['arrangements'][0].update(arrangement)
    return song


class ToneBeatTests(unittest.TestCase):
    def test_stale_beat_is_recomputed_from_t(self):
        changes = saved_changes(song_with([{'time': 4.25, 'name': 'Lead', 'beat': 99}]))
        self.assertEqual(changes, [{'name': 'Lead', 't': 4.25, 'beat': 8.5}])

    def test_no_beat_is_invented(self):
        self.assertEqual(saved_changes(song_with([{'time': 5, 'name': 'Crunch'}])), [{'name': 'Crunch', 't': 5}])

    def test_outside_the_grid_or_own_tempos_drops_beat(self):
        self.assertEqual(saved_changes(song_with([{'time': 30.0, 'name': 'Late', 'beat': 60}])), [{'name': 'Late', 't': 30.0}])
        changes = saved_changes(song_with([{'time': 4.25, 'name': 'Lead', 'beat': 8.5}], tempos=[{'time': 0, 'bpm': 90}]))
        self.assertNotIn('beat', changes[0])

    def test_grid_index(self):
        beats = [{'time': 0}, {'time': 0.5}, {'time': 1.5}]
        self.assertEqual(p._grid_index(beats, 1.0), 1.5)
        self.assertEqual(p._grid_index(beats, 0), 0)
        self.assertIsNone(p._grid_index(beats, 2.0))


if __name__ == '__main__':
    unittest.main()
