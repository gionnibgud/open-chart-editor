"""Original export fixtures. Staged only; do not execute during audio freeze."""
import base64
import copy
import io
import json
import sys
import unittest
import wave
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import export_targets as e


def fixture():
    audio=io.BytesIO()
    with wave.open(audio,'wb') as wav:
        wav.setparams((1,2,8000,0,'NONE','not compressed'))
        wav.writeframes(b'\0\0'*16000)
    arr={'id':'own-lead','type':'guitar','name':'Own lead','stringCount':6,
         'tuning':[0]*6,'notes':[{'id':'n','time':.5,'string':0,'fret':3,'sustain':.25,'techniques':{}}],
         'chords':[],'chord_templates':[],'anchors':[],'handshapes':[]}
    return {'version':1,'title':'Own Source Study','artist':'Original Author',
            'duration':2,'beats':[{'time':0,'measure':1},{'time':.5,'measure':-1}],
            'sections':[],'arrangements':[arr],
            '_pack':{'manifest':{'stems':[{'id':'full','file':'audio/own.wav'}],
                                 'unknown':{'keep':True}},
                     'entries':{'audio/own.wav':base64.b64encode(audio.getvalue()).decode('ascii'),
                                'unknown/original.bin':base64.b64encode(b'own opaque').decode('ascii')}}}


class EntryTreeTests(unittest.TestCase):
    def test_no_traversal_or_platform_ambiguity(self):
        for path in ('../x','/x','x\\y','x//y','./x','C:x','x/../y','CON','x.','x '):
            with self.subTest(path=path),self.assertRaises(e.pack_io.ProjectError):
                e.EntryTree().add(path,b'own')

    def test_duplicates_and_file_directory_collisions(self):
        for first,second in (('a','A'),('a','a/b'),('a/b','a')):
            tree=e.EntryTree(); tree.add(first,b'own')
            with self.assertRaises(e.pack_io.ProjectError): tree.add(second,b'own')

    def test_zip_is_deterministic_and_no_symlinks(self):
        tree=e.EntryTree();tree.add('parts/a.json',b'{}')
        self.assertEqual(tree.zip_bytes(),tree.zip_bytes())
        with zipfile.ZipFile(io.BytesIO(tree.zip_bytes())) as archive:
            self.assertEqual(archive.read('parts/a.json'),b'{}')
            self.assertEqual(archive.infolist()[0].external_attr>>16,0o100644)


class SourceProjectTests(unittest.TestCase):
    def test_all_source_and_master_bytes_preserved(self):
        project=fixture(); before=copy.deepcopy(project)
        tree,report=e.rs2014_sources(project,['own-lead'])
        self.assertEqual(project,before)
        self.assertEqual(json.loads(tree.entries['editable.oce.json']),before)
        self.assertEqual(tree.entries['audio/original.wav'],base64.b64decode(project['_pack']['entries']['audio/own.wav']))
        dto=json.loads(tree.entries['project.rs2dlc'])
        self.assertEqual(dto['Version'],'1')
        self.assertEqual(dto['AudioFile']['Path'],'audio/original.wav')
        part=dto['Arrangements'][0]['Fields'][0]
        self.assertEqual((part['Name'],part['RouteMask'],part['Priority']),(0,1,0))
        xml=ET.fromstring(tree.entries[part['XML']])
        self.assertEqual(xml.findtext('tonebase'),part['BaseTone'])
        self.assertEqual(dto['Tones'][0]['Key'],part['BaseTone'])
        self.assertTrue(tree.entries['cover.png'].startswith(b'\x89PNG'))
        self.assertFalse(report['readyToPlay'])
        self.assertFalse(any(name.endswith('.psarc') for name in tree.entries))
        self.assertEqual(report['sha256'],{k:v for k,v in tree.hashes().items() if k!='source-manifest.json'})

    def test_incompatible_subset_is_explicit_never_lost(self):
        project=fixture();other=copy.deepcopy(project['arrangements'][0])
        other.update(id='own-seven',stringCount=7,tuning=[0]*7)
        project['arrangements'].append(other)
        with self.assertRaises(e.pack_io.ProjectError):e.rs2014_sources(project,['own-seven'])
        tree,report=e.rs2014_sources(project,['own-lead'])
        self.assertEqual(len(json.loads(tree.entries['editable.oce.json'])['arrangements']),2)
        self.assertEqual(report['stockCompatibility'][1]['compatible'],False)

    def test_source_selection_errors(self):
        for ids in (None,[],['missing'],['own-lead','own-lead']):
            with self.subTest(ids=ids),self.assertRaises(e.pack_io.ProjectError):
                e.rs2014_sources(fixture(),ids)

    def test_vocals_and_multirole_project(self):
        project=fixture();bass=copy.deepcopy(project['arrangements'][0])
        bass.update(id='own-bass',type='bass',name='Bass',stringCount=4,tuning=[0]*4,priority='alternative')
        project['arrangements'].append(bass)
        project['vocals']=[{'id':'v','time':.5,'length':.25,'text':'own','pitch':60}]
        tree,_=e.rs2014_sources(project,['own-lead','own-bass'],include_vocals=True)
        dto=json.loads(tree.entries['project.rs2dlc'])
        self.assertEqual([x['Case'] for x in dto['Arrangements']],['Instrumental','Instrumental','Vocals'])
        bassdto=dto['Arrangements'][1]['Fields'][0]
        self.assertEqual((bassdto['Name'],bassdto['RouteMask'],bassdto['Priority']),(3,4,1))
        self.assertEqual(ET.fromstring(tree.entries['arrangements/vocals.xml']).find('vocal').get('lyric'),'own')

    def test_audio_requires_pcm_copy_and_keeps_original(self):
        project=fixture(); raw=b'own compressed bytes'
        with self.assertRaises(e.pack_io.ProjectError):
            e.rs2014_sources(project,['own-lead'],audio=('own.mp3',raw))
        pcm=base64.b64decode(project['_pack']['entries']['audio/own.wav'])
        tree,_=e.rs2014_sources(project,['own-lead'],audio=('own.mp3',raw),normalized_wav=pcm)
        self.assertEqual(tree.entries['audio/original.mp3'],raw)
        self.assertEqual(tree.entries['audio/source.wav'],pcm)

    def test_two_same_named_authored_tones_do_not_collide(self):
        project=fixture();second=copy.deepcopy(project['arrangements'][0]);second['id']='other'
        definition={'gearList':{'Amp':{'Key':'Amp_MarshallPlexi','KnobValues':{}}},'volume':-7.25}
        for arr in (project['arrangements'][0],second):
            arr['tones']={'base':'Own','changes':[],'definitions':{'Own':copy.deepcopy(definition)}}
        project['arrangements'].append(second); before=copy.deepcopy(project)
        tree,_=e.rs2014_sources(project,['own-lead','other'])
        dto=json.loads(tree.entries['project.rs2dlc'])
        self.assertEqual([t['Key'] for t in dto['Tones']],['WS0_Own','WS1_Own'])
        self.assertEqual([t['Volume'] for t in dto['Tones']],['-7.25','-7.25'])
        self.assertEqual(project,before)

    def test_public_rhythm_enum_and_nested_lower_camel_tone(self):
        project=fixture();arr=project['arrangements'][0];arr['role']='rhythm'
        arr['tones']={'base':'Own','changes':[], 'definitions':{'Own':{
            'gearList':{'amp':{'key':'Amp_MarshallPlexi','knobValues':{}}},'volume':-5}}}
        tree,_=e.rs2014_sources(project,['own-lead'])
        dto=json.loads(tree.entries['project.rs2dlc'])
        self.assertEqual(dto['Arrangements'][0]['Fields'][0]['Name'],2)
        self.assertEqual(dto['Arrangements'][0]['Fields'][0]['RouteMask'],2)
        self.assertEqual(dto['Tones'][0]['GearList']['Amp']['Key'],'Amp_MarshallPlexi')

    def test_native_source_normalizes_sparse_dd_preserves_authored_tiers(self):
        project=fixture();arr=project['arrangements'][0]
        fields=('notes','chords','chord_templates','anchors','handshapes')
        arr['difficulties']=[{'difficulty':value,**{field:copy.deepcopy(arr.get(field,[])) for field in fields}}
                             for value in (0,3,7)]
        arr['activeDifficulty']=3
        before=copy.deepcopy(project)
        tree,report=e.rs2014_sources(project,['own-lead'])
        root=ET.fromstring(tree.entries['arrangements/00_lead.xml'])
        authored=ET.fromstring(tree.entries['authored-xml/00_lead.xml'])
        self.assertEqual([int(n.get('difficulty')) for n in root.findall('./levels/level')],[0,1,2])
        self.assertEqual([int(n.get('difficulty')) for n in authored.findall('./levels/level')],[0,3,7])
        self.assertEqual(report['nativeProjection']['own-lead']['difficultyMap'],{0:0,3:1,7:2})
        self.assertEqual(root.find('arrangementProperties').get('slapPop'),'0')
        self.assertEqual(project,before)

    def test_mixed_muted_chord_source_expands_without_losing_voices(self):
        root=ET.fromstring('<song><levels><level difficulty="0"><notes count="0"/><chords count="1"><chord time="1" palmMute="1"><chordNote string="0" fret="3" mute="1"/><chordNote string="1" fret="5" mute="0"/></chord></chords></level></levels></song>')
        result=e._native_source_xml(root,'lead','main')
        notes=root.findall('./levels/level/notes/note')
        self.assertEqual([(n.get('string'),n.get('fret'),n.get('mute'),n.get('palmMute')) for n in notes],
                         [('0','3','1','1'),('1','5','0','1')])
        self.assertFalse(root.findall('./levels/level/chords/chord'))
        self.assertEqual(result['expandedMixedMutedChords'],[{'time':'1','voices':2}])


if __name__=='__main__':unittest.main()
