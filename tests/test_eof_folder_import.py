"""An Editor on Fire project folder is read from its own notes.eof, even when the folder
also holds loose arrangement XML exported earlier (that export can be stale/incomplete)."""
import io
import sys
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import export_targets as e
import pack_io as p
from test_eof_io import build_eof, _track, _pro_guitar_track, _note


def archive(entries):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as z:
        for name, data in entries.items():
            z.writestr(name, data)
    return output.getvalue()


# A plain loose-XML arrangement (just enough for pack_io.load_xml to accept it), with
# deliberately few notes - standing in for a stale/incomplete toolkit export.
STALE_XML = b'''<?xml version="1.0"?>
<song version="8"><title>Stub</title><arrangement>Lead</arrangement>
<tuning string0="0" string1="0" string2="0" string3="0" string4="0" string5="0"/>
<levels count="1"><level difficulty="0"><notes count="1"><note time="0" fret="1" string="0"/></notes></level></levels>
</song>'''


def eof_bytes(note_count=2):
    note = _note(string_mask=0b000001, frets=(3,))
    track = _track('PART REAL_GUITAR', e.eof_io.TRACK_FORMAT_PRO_GUITAR,
                    _pro_guitar_track([note] * note_count))
    return build_eof(tracks=[track])


class EofFolderPriorityTests(unittest.TestCase):
    def test_eof_folder_with_stale_loose_xml_reads_from_notes_eof(self):
        entries = {'notes.eof': eof_bytes(5), 'Lead_RS2.xml': STALE_XML, 'guitar.wav': b'RIFF' + b'\0' * 40}
        project = e.load_folder_archive(archive(entries))
        self.assertEqual(project['_import']['format'], 'editor-on-fire')
        self.assertEqual(len(project['arrangements'][0]['notes']), 5)

    def test_eof_only_folder_with_no_loose_xml_still_imports(self):
        entries = {'notes.eof': eof_bytes(3), 'guitar.wav': b'RIFF' + b'\0' * 40}
        project = e.load_folder_archive(archive(entries))
        self.assertEqual(project['_import']['format'], 'editor-on-fire')
        self.assertEqual(len(project['arrangements'][0]['notes']), 3)

    def test_plain_xml_folder_with_no_eof_project_keeps_the_legacy_loose_path(self):
        entries = {'Lead_RS2.xml': STALE_XML, 'guitar.wav': b'RIFF' + b'\0' * 40}
        project = e.load_folder_archive(archive(entries))
        self.assertEqual(project['_import']['format'], 'feedback-legacy-loose')


if __name__ == '__main__':
    unittest.main()
