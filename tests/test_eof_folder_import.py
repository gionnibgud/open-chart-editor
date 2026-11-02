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


def eof_bytes_with_tuning(name, tuning, numstrings=6, note_count=1):
    note = _note(string_mask=0b000001, frets=(3,))
    track = _track(name, e.eof_io.TRACK_FORMAT_PRO_GUITAR,
                    _pro_guitar_track([note] * note_count, numstrings=numstrings, tuning=tuning))
    return build_eof(tracks=[track])


RS2DLC_BASS_AND_PITCH_TRICK = b'''{"Arrangements": [{"Fields": [
    {"XML": "PART REAL_GUITAR_RS2.xml", "Name": 2, "TuningPitch": 220}]}]}'''

DLC_XML_BASS_AND_PITCH_TRICK = b'''<?xml version="1.0"?>
<DLCPackageData xmlns="http://schemas.datacontract.org/2004/07/RocksmithToolkitLib.DLCPackage">
  <Arrangements>
    <Arrangement>
      <ArrangementName>Bass</ArrangementName>
      <SongXml><File>PART REAL_GUITAR_RS2.xml</File></SongXml>
      <TuningPitch>220</TuningPitch>
    </Arrangement>
  </Arrangements>
</DLCPackageData>'''


class ExtendedRangeBassChartedAsGuitarTests(unittest.TestCase):
    def test_a220_toolkit_pitch_trick_and_bass_label_flag_a_six_string_guitar_track(self):
        entries = {'notes.eof': eof_bytes_with_tuning('PART REAL_GUITAR', [-7, -5, -5, -5, -4, -4]),
                   'guitar.wav': b'RIFF' + b'\0' * 40, 'song.rs2dlc': RS2DLC_BASS_AND_PITCH_TRICK}
        project = e.load_folder_archive(archive(entries))
        warnings = ' '.join(project.get('import_warnings') or [])
        self.assertIn('may actually be a 6-string bass chart', warnings)
        self.assertIn('labels this arrangement as Bass', warnings)
        self.assertIn('220Hz instead of 440Hz', warnings)

    def test_legacy_dlc_xml_toolkit_project_gives_the_same_signal(self):
        entries = {'notes.eof': eof_bytes_with_tuning('PART REAL_GUITAR', [-7, -5, -5, -5, -4, -4]),
                   'guitar.wav': b'RIFF' + b'\0' * 40, 'song_RS2014.dlc.xml': DLC_XML_BASS_AND_PITCH_TRICK}
        project = e.load_folder_archive(archive(entries))
        warnings = ' '.join(project.get('import_warnings') or [])
        self.assertIn('may actually be a 6-string bass chart', warnings)
        self.assertIn('labels this arrangement as Bass', warnings)

    def test_uniformly_deep_tuning_offset_flags_a_guitar_track_with_no_toolkit_file_present(self):
        entries = {'notes.eof': eof_bytes_with_tuning('PART REAL_GUITAR', [-7, -5, -5, -5, -4, -4]),
                   'guitar.wav': b'RIFF' + b'\0' * 40}
        project = e.load_folder_archive(archive(entries))
        warnings = ' '.join(project.get('import_warnings') or [])
        self.assertIn('may actually be a 6-string bass chart', warnings)
        self.assertIn('tuned -7 to -4 semitones below standard', warnings)

    def test_a_real_sibling_bass_track_suppresses_the_tuning_only_heuristic(self):
        bass_note = _note(string_mask=0b0001, frets=(3,))
        bass_track = _track('PART REAL_BASS', e.eof_io.TRACK_FORMAT_PRO_GUITAR,
                             _pro_guitar_track([bass_note], numstrings=4, tuning=[-5, -5, -5, -5]))
        guitar_note = _note(string_mask=0b000001, frets=(3,))
        guitar_track = _track('PART REAL_GUITAR', e.eof_io.TRACK_FORMAT_PRO_GUITAR,
                               _pro_guitar_track([guitar_note], numstrings=6, tuning=[-5] * 6))
        entries = {'notes.eof': build_eof(tracks=[bass_track, guitar_track]),
                   'guitar.wav': b'RIFF' + b'\0' * 40}
        project = e.load_folder_archive(archive(entries))
        self.assertFalse(project.get('import_warnings'))

    def test_standard_tuning_is_never_flagged(self):
        entries = {'notes.eof': eof_bytes_with_tuning('PART REAL_GUITAR', [0] * 6),
                   'guitar.wav': b'RIFF' + b'\0' * 40}
        project = e.load_folder_archive(archive(entries))
        self.assertFalse(project.get('import_warnings'))


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
