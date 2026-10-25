"""FeedPak 5.3.2 portability: a saved pack always has an OGG or WAV stem."""
import base64
import io
import math
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
import wave
import zipfile

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pack_io as p
import routes
from test_pack_io import project


def tone(seconds=1.0, rate=22050):
    out = io.BytesIO()
    with wave.open(out, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes(b''.join(struct.pack('<h', int(3000 * math.sin(2 * math.pi * 330 * i / rate))) for i in range(int(seconds * rate))))
    return out.getvalue()


def with_stem(name, data):
    song = project()
    song['_pack'] = {'manifest': {'stems': [{'id': 'full', 'file': name, 'default': True, 'name': 'Full mix'}]},
                     'entries': {name: base64.b64encode(data).decode('ascii')}}
    return song


def saved_stems(song):
    app = FastAPI(); routes.setup(app)
    with TestClient(app) as client:
        response = client.post(routes.PREFIX + '/save', json={'project': song, 'format': 'feedpak'})
    if response.status_code != 200:
        raise AssertionError(response.text)
    with zipfile.ZipFile(io.BytesIO(response.content)) as z:
        manifest = p.yaml.safe_load(z.read('manifest.yaml'))
        return manifest['stems'], set(z.namelist()), response.headers.get('X-OCE-Export-Warnings', '')


class BaselineStemTests(unittest.TestCase):
    def test_wav_stem_is_left_alone(self):
        stems, names, warnings = saved_stems(with_stem('audio/full.wav', tone()))
        self.assertEqual([s['id'] for s in stems], ['full'])
        self.assertNotIn('full mix decoded', warnings)

    def test_old_extension_codecs_are_written_as_feedpak_codec_names(self):
        song = with_stem('audio/full.wav', tone())
        song['_pack']['manifest']['stems'][0]['codec'] = 'wav'
        with zipfile.ZipFile(io.BytesIO(p.save_feedpak(song))) as z:
            manifest = p.yaml.safe_load(z.read('manifest.yaml'))
        self.assertEqual(manifest['stems'][0]['codec'], 'pcm')
        self.assertEqual(manifest['feedpak_version'], '1.25.0')

    @unittest.skipUnless(shutil.which('ffmpeg'), 'needs FFmpeg to make an MP3')
    def test_mp3_only_pack_gains_an_ogg_full_mix_and_keeps_the_original(self):
        with tempfile.TemporaryDirectory() as directory:
            wav, mp3 = Path(directory) / 'in.wav', Path(directory) / 'in.mp3'
            wav.write_bytes(tone())
            subprocess.run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-i', str(wav), str(mp3)], check=True)
            data = mp3.read_bytes()
        stems, names, warnings = saved_stems(with_stem('audio/song.mp3', data))
        full = next(s for s in stems if s['id'] == 'full')
        self.assertEqual((full['file'], full['codec'], full['default']), ('audio/full.ogg', 'vorbis', True))
        source = next(s for s in stems if s['id'] == 'source')
        self.assertEqual((source['file'], source['default'], source['name']), ('audio/song.mp3', False, 'Original audio'))
        self.assertIn('audio/full.ogg', names)
        self.assertIn('audio/song.mp3', names)
        self.assertIn('Added an OGG full mix decoded from song.mp3', warnings)


if __name__ == '__main__':
    unittest.main()
