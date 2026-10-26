"""A song's year comes from its sources or the user, never a made-up default."""
from pathlib import Path
import json
import sys
import unittest
from unittest import mock
import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import export_targets as e
import pack_io as p


class SongYearTests(unittest.TestCase):
    def test_years_from_text(self):
        for value, year in [('1991', 1991), ('1991-09-17', 1991), (1991, 1991), ('19__', None), ('', None), (None, None), (True, None), (20260, None), ('12345', None)]:
            self.assertEqual(p.song_year(value), year, value)

    def test_xml_without_a_year_has_none_and_is_saved_without_one(self):
        xml = b'<?xml version="1.0"?><song version="7"><title>T</title><arrangement>Lead</arrangement><songLength>4</songLength><tuning string0="0" string1="0" string2="0" string3="0" string4="0" string5="0"/><ebeats count="2"><ebeat time="0" measure="1"/><ebeat time="0.5" measure="-1"/></ebeats><levels count="1"><level difficulty="0"><notes count="1"><note time="1" string="0" fret="3"/></notes><chords count="0"/><anchors count="0"/><handShapes count="0"/></level></levels></song>'
        project = p.load_xml(xml)
        self.assertNotIn('year', project)
        root = ET.fromstring(p.save_xml(project, project['arrangements'][0]['id']))
        self.assertIsNone(root.find('albumYear'))
        project['year'] = 1991
        self.assertEqual(ET.fromstring(p.save_xml(project, project['arrangements'][0]['id'])).findtext('albumYear'), '1991')

    def test_audio_tags_fill_only_an_empty_year(self):
        project = {'title': 'Score title', 'artist': 'Score artist', 'album': ''}
        self.assertEqual(p.fill_song_details(project, {'title': 'Tag title', 'year': 1991}), ['year'])
        self.assertEqual((project['title'], project['year']), ('Score title', 1991))

    def test_gpa_folder_takes_the_year_from_its_audio(self):
        score = {'version': 1, 'title': 'Song', 'artist': 'Band', 'album': '', 'duration': 4, 'beats': [], 'sections': [], 'arrangements': [], '_pack': {'entries': {}, 'manifest': {}}}
        sync = b'<track title="Song"><scoreUrl>song.gpx</scoreUrl><audioUrl>song.mp3</audioUrl><sync>1#0;0;0;500#</sync></track>'
        with mock.patch.object(p, 'load_guitarpro', return_value=score), mock.patch.object(p, 'validate_project', side_effect=lambda x: x), \
             mock.patch.object(p, 'audio_bytes_tags', return_value={'year': 1991, 'title': 'Tag title'}):
            project = e._gpa_song({'song.xml': sync, 'song.gpx': b'gp', 'song.mp3': b'mp3'})
        self.assertEqual((project['year'], project['title']), (1991, 'Song'))
        self.assertIn('Song year filled from the tags of song.mp3', project['import_warnings'])

    def test_dlc_builder_project_needs_a_year(self):
        from test_export_targets import fixture
        project = fixture()
        project.pop('year')
        with self.assertRaisesRegex(p.ProjectError, 'needs the song year'):
            e.rs2014_sources(project, ['own-lead'])
        project['year'] = 1991
        tree, _ = e.rs2014_sources(project, ['own-lead'])
        self.assertEqual(json.loads(tree.entries['project.rs2dlc'])['Year'], 1991)


if __name__ == '__main__':
    unittest.main()
