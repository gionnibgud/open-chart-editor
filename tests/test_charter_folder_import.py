"""A Lordszynencja/Charter project folder (has a *.rscp file at its root) is read directly,
the same way a loose FeedPak/Editor-on-Fire/legacy-XML folder already is."""
import io
import sys
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import export_targets as e
import pack_io as p
from test_charter_io import build_rscp, arrangement


def archive(entries):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as z:
        for name, data in entries.items():
            z.writestr(name, data)
    return output.getvalue()


def rscp_bytes():
    sound = '<sound p="0 0/1" ep="0 1/1" string="0" fret="1"/>'
    body = f'<levels><level><sounds>{sound}</sounds></level></levels>'
    return build_rscp(arrangement(body))


class CharterFolderImportTests(unittest.TestCase):
    def test_charter_folder_with_default_project_name_imports(self):
        entries = {'project.rscp': rscp_bytes(), 'guitar.ogg': b'fake-ogg-bytes'}
        project = e.load_folder_archive(archive(entries))
        self.assertEqual(project['_import']['format'], 'charter')
        self.assertEqual(len(project['arrangements'][0]['notes']), 1)

    def test_charter_folder_with_a_renamed_rscp_file_still_imports(self):
        entries = {'My Song.rscp': rscp_bytes(), 'guitar.ogg': b'fake-ogg-bytes'}
        project = e.load_folder_archive(archive(entries))
        self.assertEqual(project['_import']['format'], 'charter')

    def test_charter_folder_with_no_audio_is_rejected(self):
        entries = {'project.rscp': rscp_bytes()}
        with self.assertRaisesRegex(p.ProjectError, 'no owned full audio'):
            e.load_folder_archive(archive(entries))


if __name__ == '__main__':
    unittest.main()
