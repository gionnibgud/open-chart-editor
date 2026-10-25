"""PSARC packages are refused with a clear message; no PSARC code or key is used."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import pack_io as p


class PsarcRefusedTests(unittest.TestCase):
    def test_signature_or_extension_is_refused_before_any_parsing(self):
        for data,name in ((b'PSAR'+bytes(28),'song_p.psarc'),(b'PSAR'+bytes(28),'renamed.bin'),(b'{}','song.psarc')):
            with self.assertRaisesRegex(p.ProjectError,'PSARC packages are not supported'):
                p.load_project(data,name)


if __name__=='__main__':
    unittest.main()
