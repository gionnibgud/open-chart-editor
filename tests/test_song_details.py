"""Song details filled from imports and audio tags, never over values the user set."""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import pack_io as p
from test_pack_io import project


class SongDetailsTests(unittest.TestCase):
    def test_only_default_fields_are_filled(self):
        song={'title':'Untitled','artist':'Local author','album':'','year':2026}
        self.assertEqual(p.fill_song_details(song,{'title':'Hurt','artist':'Johnny Cash','album':'American IV','year':2002}),['title','artist','album','year'])
        self.assertEqual(song,{'title':'Hurt','artist':'Johnny Cash','album':'American IV','year':2002})
        mine={'title':'My take','artist':'Me','album':'Demos','year':2019}
        self.assertEqual(p.fill_song_details(mine,{'title':'Hurt','artist':'Johnny Cash','album':'American IV','year':2002}),[])
        self.assertEqual(mine['title'],'My take')

    def test_defaults_and_bad_values_in_the_source_are_ignored(self):
        song={'title':'Untitled','artist':'Local author','album':'','year':2026}
        self.assertEqual(p.fill_song_details(song,{'title':'Untitled','artist':'  ','year':True,'album':None}),[])
        self.assertEqual(p.fill_song_details(song,{'year':123}),[])

    def test_import_fills_a_default_song_and_keeps_a_named_one(self):
        incoming=project();incoming.update(title='Hurt',artist='Johnny Cash',album='American IV')
        blank=project();blank.update(title='Untitled',artist='Local author',album='')
        merged=p.merge_projects(blank,incoming)
        self.assertEqual((merged['project']['title'],merged['project']['artist'],merged['project']['album']),('Hurt','Johnny Cash','American IV'))
        self.assertIn('Song details filled from the import: title, artist, album',merged['warnings'])
        named=project();named.update(title='Own backing',artist='Own band',album='')
        merged=p.merge_projects(named,incoming)['project']
        self.assertEqual((merged['title'],merged['artist'],merged['album']),('Own backing','Own band','American IV'))


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'),'ffmpeg/ffprobe not installed')
class AudioTagRouteTests(unittest.TestCase):
    def test_audio_upload_returns_its_tags(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        import routes
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'tagged.wav'
            subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','anullsrc=r=8000:cl=mono','-t','0.2',
                            '-metadata','title=Own Song','-metadata','artist=Own Artist','-metadata','album=Own Album','-metadata','date=2019-05-01',str(path)],check=True)
            app=FastAPI();routes.setup(app,{})
            try:
                with TestClient(app) as client:
                    result=client.post('/api/plugins/open_chart_editor/audio',files={'file':('tagged.wav',path.read_bytes(),'audio/wav')}).json()
            finally:app.state.open_chart_editor_scratch.cleanup()
        self.assertEqual(result['tags'],{'title':'Own Song','artist':'Own Artist','album':'Own Album','year':2019})


if __name__=='__main__':
    unittest.main()
