"""Original vocal fixtures exercise canonical preservation and source decisions."""
import base64,copy,io,json,sys,unittest,zipfile
from pathlib import Path
from xml.etree import ElementTree as ET
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
sys.path.insert(0,str(Path(__file__).resolve().parent))
import pack_io as p
from test_pack_io import project
import yaml

def fixture(pitch_only=False):
    blob=p.save_feedpak(project());z=zipfile.ZipFile(io.BytesIO(blob));entries={name:z.read(name)for name in z.namelist()};manifest=yaml.safe_load(entries['manifest.yaml'])
    manifest.update(lyrics='own/lyrics.json',vocal_pitch='own/pitch.json',vocal_pitch_contour='own/contour.json',pitch_extraction={'engine':'Own','model':'Own','version':'1.0.0'},contour_extraction={'engine':'Own','model':'Own','version':'1.0.0'},lyrics_source='transcribed',lyric_transcription={'engine':'Own','model':'Own','version':'1.0.0'},lyric_tracks=[{'id':'original','file':'own/lyrics.json','language':'en','kind':'original','lyrics_source':'transcribed','lyric_transcription':{'engine':'Own','model':'Own','version':'1.0.0'}},{'id':'translation','file':'own/translation.json','language':'fr','kind':'translation','future':{'retain':True}}])
    entries.update({'own/lyrics.json':b'[ {"t":1,"d":0.5,"w":"Own & <original>","future":{"retain":1}} ]\n','own/pitch.json':json.dumps({'version':1,'future':{'retain':2},'notes':[{'t':2 if pitch_only else 1,'d':.5,'midi':0,'confidence':.75},{'t':3,'d':0,'midi':127}]}).encode(),'own/contour.json':b'{"version":1,"samples":[{"t":1,"hz":261.6}],"opaque":true}\n','own/translation.json':b'[ {"t":1,"d":0.5,"w":"Original traduction"} ]\n','own/future.bin':b'original opaque bytes\x00\xff'})
    entries['manifest.yaml']=yaml.safe_dump(manifest).encode();output=io.BytesIO()
    with zipfile.ZipFile(output,'w')as z:
        for name,data in entries.items():z.writestr(name,data)
    return output.getvalue(),entries

def unpack(song):
    z=zipfile.ZipFile(io.BytesIO(p.save_feedpak(song)));return yaml.safe_load(z.read('manifest.yaml')),{name:z.read(name)for name in z.namelist()}

class VocalContract(unittest.TestCase):
    def test_explicit_vocal_only_feedpak_has_native_vocal_transport_and_no_active_instrument_chart(self):
        blob,original_entries=fixture();song=p.load_feedpak(blob);before=copy.deepcopy(song)
        with zipfile.ZipFile(io.BytesIO(p.save_feedpak(song,vocal_only=True)))as z:
            manifest=yaml.safe_load(z.read('manifest.yaml'));self.assertEqual(len(manifest['arrangements']),1)
            part=manifest['arrangements'][0];self.assertEqual((part['name'],part['type']),('Vocals','vocals'))
            raw=json.loads(z.read(part['file']))
            for field in ('notes','chords','anchors','handshapes','templates','phrases'):self.assertEqual(raw.get(field,[]),[])
            for key in ('drum_tab','drum_tones','keys'):self.assertNotIn(key,manifest)
            self.assertEqual(z.read(manifest['lyrics']),original_entries['own/lyrics.json']);self.assertEqual(z.read(manifest['vocal_pitch']),original_entries['own/pitch.json'])
        self.assertEqual(song,before)
        normal,_=unpack(song);self.assertEqual(normal['arrangements'][0]['type'],'guitar')
        song['vocals']=[{'id':'unpitched','time':1,'length':1,'text':'Own'}]
        with self.assertRaisesRegex(p.ProjectError,'positive duration'):p.save_feedpak(song,vocal_only=True)
        song['vocals'][0].update(pitch=0,length=0)
        with self.assertRaisesRegex(p.ProjectError,'positive duration'):p.save_feedpak(song,vocal_only=True)

    def test_native_text_refuses_xml_controls_while_feedpak_retains_exact_json_text(self):
        for text in ['Own\x00tail','Own\x01tail','Own\x0btail','Own\ufffetail','Own\ufffftail']:
            song=project();song['vocals']=[{'id':'own','time':1,'length':.5,'text':text,'pitch':0}]
            with self.assertRaisesRegex(p.ProjectError,'XML1.0'):p.save_vocal_xml(song)
            with self.assertRaisesRegex(p.ProjectError,'XML1.0'):p.validate_cdlc_strings(song,['lead'],include_vocals=True)
            restored=p.load_feedpak(p.save_feedpak(song));self.assertEqual(restored['vocals'][0]['text'],text)

    def test_native_xml_valid_tabs_newlines_unicode_ranges_are_accepted(self):
        text='Own\t\n\r\u0020\ud7ff\ue000\ufffd\U00010000\U0010ffff'
        song=project();song['vocals']=[{'id':'own','time':1,'length':.5,'text':text,'pitch':0}]
        p.validate_cdlc_strings(song,['lead'],include_vocals=True)
        self.assertEqual(ET.fromstring(p.save_vocal_xml(song))[0].get('lyric'),text)

    def test_new_sidecar_names_never_overwrite_unreferenced_opaque_entries(self):
        song=project();opaque={'LYRICS.JSON':b'unknown original lyrics-name bytes','vocal_pitch.json':b'unknown original pitch-name bytes','EDITOR/OCE-LYRICS.JSON':b'unknown first fallback','editor/oce-vocal_pitch.json':b'unknown pitch fallback'}
        song['_pack']['entries'].update({name:base64.b64encode(value).decode()for name,value in opaque.items()})
        song['vocals']=[{'id':'original','time':1,'length':.5,'text':'Own','pitch':0}]
        manifest,out=unpack(song)
        self.assertEqual(manifest['lyrics'],'editor/oce-lyrics-2.json');self.assertEqual(manifest['vocal_pitch'],'editor/oce-vocal_pitch-2.json')
        for name,value in opaque.items():self.assertEqual(out[name],value)

    def test_actual_save_route_exposes_contour_warning_and_keeps_source_payload(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        import routes
        app=FastAPI();routes.setup(app,{})
        try:
            with TestClient(app)as client:
                blob,entries=fixture();song=p.load_feedpak(blob);song['vocals'][0]['pitch']=127
                response=client.post(routes.PREFIX+'/save',json={'project':song,'format':'feedpak'})
                self.assertEqual(response.status_code,200,response.text)
                self.assertTrue(any('detached' in w for w in json.loads(response.headers['X-OCE-Export-Warnings'])))
                with zipfile.ZipFile(io.BytesIO(response.content))as z:self.assertEqual(z.read('own/contour.json'),entries['own/contour.json'])
        finally:app.state.open_chart_editor_scratch.cleanup()

    def test_noop_preserves_exact_source_sidecars_and_does_not_invent_lyrics(self):
        for unmatched in [False,True]:
            blob,entries=fixture(unmatched);song=p.load_feedpak(blob)
            for i,row in enumerate(song['vocals']):row['id']='editor-identity-'+str(i)
            manifest,out=unpack(song)
            for name in ['own/lyrics.json','own/pitch.json','own/contour.json','own/translation.json','own/future.bin']:self.assertEqual(out[name],entries[name])
            self.assertEqual(manifest['lyrics_source'],'transcribed');self.assertEqual(p.vocal_export_warnings(song),[])
            self.assertEqual([v['pitch']for v in song['vocals']if 'pitch'in v],[0,127])

    def test_text_only_updates_primary_provenance_and_keeps_performance_pitch(self):
        blob,entries=fixture();song=p.load_feedpak(blob);song['vocals'][0]['text']='Edited own syllable'
        manifest,out=unpack(song)
        self.assertEqual(out['own/pitch.json'],entries['own/pitch.json'])
        self.assertEqual(manifest['vocal_pitch_contour'],'own/contour.json');self.assertIn('pitch_extraction',manifest);self.assertIn('contour_extraction',manifest)
        self.assertEqual(manifest['lyric_tracks'][0]['lyrics_source'],'authored');self.assertNotIn('lyric_transcription',manifest['lyric_tracks'][0]);self.assertEqual(out['own/translation.json'],entries['own/translation.json']);self.assertTrue(any('not automatically' in w for w in p.vocal_export_warnings(song)))

    def test_pitch_or_timing_detaches_only_stale_contour_refs_and_preserves_bytes(self):
        for field,value in [('pitch',127),('time',1.25),('length',.75)]:
            blob,entries=fixture();song=p.load_feedpak(blob);song['vocals'][0][field]=value
            manifest,out=unpack(song)
            self.assertNotIn('vocal_pitch_contour',manifest);self.assertNotIn('pitch_extraction',manifest);self.assertNotIn('contour_extraction',manifest);self.assertEqual(out['own/contour.json'],entries['own/contour.json']);self.assertEqual(out['own/translation.json'],entries['own/translation.json']);self.assertTrue(any('detached' in w for w in p.vocal_export_warnings(song)))
            notes=json.loads(out['own/pitch.json']);self.assertEqual(notes['future'],{'retain':2});self.assertEqual(notes['notes'][0]['confidence'],.75)
            if field=='pitch':self.assertEqual(out['own/lyrics.json'],entries['own/lyrics.json'])

    def test_unknown_wire_edit_is_not_silently_treated_as_noop(self):
        blob,_=fixture();song=p.load_feedpak(blob);song['vocals'][0]['_lyricWire']['future']['retain']=9
        manifest,out=unpack(song);self.assertEqual(json.loads(out[manifest['lyrics']])[0]['future'],{'retain':9});self.assertEqual(manifest['lyrics_source'],'transcribed');self.assertIn('vocal_pitch_contour',manifest)

    def test_xml_boundaries_unknown_attributes_and_syllables(self):
        source=b'<vocals count="2" future="own"><vocal time="1.125" length="0" note="0" lyric="Own &amp; &lt;one&gt;" future="a"/><vocal time="1.125" length="0.625" note="127" lyric="own+" future="b"/></vocals>'
        song=p.load_vocal_xml(source);before=copy.deepcopy(song);root=ET.fromstring(p.save_vocal_xml(song))
        self.assertEqual(song,before);self.assertEqual(root.get('future'),'own');self.assertEqual([(v.get('note'),v.get('lyric'),v.get('future'))for v in root],[('0','Own & <one>','a'),('127','own+','b')]);self.assertEqual([float(v.get('length'))for v in root],[0,.625])

    def test_explicit_vocal_merge_warps_duration_and_retains_opaque_source(self):
        blob,entries=fixture(True);incoming=p.load_feedpak(blob);target=project();target['beats']=[{'time':0,'measure':1},{'time':1,'measure':-1}]
        before=copy.deepcopy(incoming);result=p.merge_projects(target,incoming,[],align='beats',offset=1,include_vocals=True)['project']
        self.assertEqual(incoming,before);self.assertEqual(result['vocals'][0]['time'],3);self.assertEqual(result['vocals'][0]['length'],1)
        members=result['_pack']['entries'];self.assertTrue(any(base64.b64decode(value)==entries['own/future.bin']for value in members.values()));self.assertNotIn('vocals',target)

if __name__=='__main__':unittest.main()
