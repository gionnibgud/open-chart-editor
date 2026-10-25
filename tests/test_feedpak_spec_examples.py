"""The FeedPak spec's own example packs: folder and zip open alike, a re-save keeps
every file the editor does not interpret, and the re-saved pack passes the spec validator.

Reads the examples from a local spec checkout (FEEDPAK_SPEC, default the sibling
freedBack checkout); skipped when it is not present. Nothing from the spec is copied here.
"""
import base64
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import export_targets as e
import pack_io as p

SPEC = Path(os.environ.get('FEEDPAK_SPEC', r'I:\Dev\freedBack\feedback-feedpak-spec'))
EXAMPLES = sorted((SPEC / 'examples').glob('*.feedpak')) if (SPEC / 'examples').is_dir() else []


def zipped(folder):
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w') as z:
        for path in sorted(folder.rglob('*')):
            if path.is_file():
                z.write(path, path.relative_to(folder).as_posix())
    return out.getvalue()


def comparable(project):
    """Project content without per-load bookkeeping."""
    keep = {k: v for k, v in project.items() if k not in ('_import', 'import_warnings', '_pack')}
    entries = {k: base64.b64decode(v) for k, v in project.get('_pack', {}).get('entries', {}).items()}
    return keep, entries


@unittest.skipUnless(EXAMPLES, 'FeedPak spec checkout with examples not found')
class SpecExampleTests(unittest.TestCase):
    def test_folder_and_zip_forms_open_the_same(self):
        for folder in EXAMPLES:
            with self.subTest(example=folder.name):
                data = zipped(folder)
                as_zip = p.load_project(data, folder.name)
                as_folder = e.load_folder_archive(data)
                self.assertEqual(comparable(as_zip), comparable(as_folder))

    def test_resave_keeps_uninterpreted_files_and_passes_the_spec_validator(self):
        with tempfile.TemporaryDirectory() as directory:
            written = []
            for folder in EXAMPLES:
                with self.subTest(example=folder.name):
                    original = zipped(folder)
                    saved = p.save_feedpak(p.load_project(original, folder.name))
                    with zipfile.ZipFile(io.BytesIO(original)) as before, zipfile.ZipFile(io.BytesIO(saved)) as after:
                        missing = set(before.namelist()) - set(after.namelist())
                        self.assertEqual(missing, set(), 'every original file is still in the pack')
                        for name in before.namelist():
                            if not name.endswith(('.json', '.yaml', '.yml', '.jsonc')):
                                self.assertEqual(before.read(name), after.read(name), name)
                    target = Path(directory) / folder.name
                    target.write_bytes(saved)
                    written.append(str(target))
            run = subprocess.run([sys.executable, str(SPEC / 'tools' / 'validate.py'), *written], capture_output=True, text=True)
            self.assertEqual(run.returncode, 0, run.stdout + run.stderr)


if __name__ == '__main__':
    unittest.main()
