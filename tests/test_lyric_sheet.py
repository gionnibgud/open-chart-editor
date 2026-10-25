"""Untimed lyric sheet syllables (Lyrics tab) survive JSON and FeedPak, in any script."""
import copy
import io
import json
import sys
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pack_io as p
from test_pack_io import project as own

UNTIMED = ['星が', 'ти-', 'ха+', 'corazón+']


def song():
    project = own()
    project['vocals'] = [{'id': 'v1', 'time': 0.5, 'length': 0.2, 'text': '夜空に'}]
    project['lyricSheet'] = {'untimed': list(UNTIMED)}
    return project


class LyricSheetTests(unittest.TestCase):
    def test_feedpak_round_trip(self):
        archive = p.save_feedpak(song())
        with zipfile.ZipFile(io.BytesIO(archive)) as z:
            sidecar = json.loads(z.read(p.LYRIC_SHEET_PATH))
        self.assertEqual(sidecar, {'format': p.LYRIC_SHEET_FORMAT, 'untimed': UNTIMED})
        reopened = p.load_feedpak(archive)
        self.assertEqual(reopened['lyricSheet'], {'untimed': UNTIMED})
        self.assertEqual([v['text'] for v in reopened['vocals']], ['夜空に'])

    def test_json_round_trip(self):
        data, _, _ = p.save_project(song(), 'json')
        self.assertEqual(p.load_project(data, 'own.json')['lyricSheet'], {'untimed': UNTIMED})

    def test_sidecar_removed_when_everything_is_timed(self):
        archive = p.save_feedpak(song())
        project = p.load_feedpak(archive)
        project.pop('lyricSheet')
        with zipfile.ZipFile(io.BytesIO(p.save_feedpak(project))) as z:
            self.assertNotIn(p.LYRIC_SHEET_PATH, z.namelist())

    def test_unrelated_file_at_the_path_is_not_overwritten(self):
        project = song()
        project['_pack']['entries'][p.LYRIC_SHEET_PATH] = p.base64.b64encode(b'{"other":true}').decode()
        with self.assertRaisesRegex(p.ProjectError, 'unrelated'):
            p.save_feedpak(copy.deepcopy(project))
        project.pop('lyricSheet')
        with zipfile.ZipFile(io.BytesIO(p.save_feedpak(project))) as z:
            self.assertEqual(z.read(p.LYRIC_SHEET_PATH), b'{"other":true}')

    def test_invalid_sheet_refused(self):
        project = song()
        project['lyricSheet'] = {'untimed': ['ok', 3]}
        with self.assertRaisesRegex(p.ProjectError, 'list of text'):
            p.save_feedpak(project)


if __name__ == '__main__':
    unittest.main()
