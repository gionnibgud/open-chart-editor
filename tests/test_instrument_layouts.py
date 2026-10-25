"""PREPARED ONLY: pure writer/host layout tests; no browser/native process."""
from pathlib import Path
import base64,copy,hashlib,importlib.util,io,json,os,sys,unittest,wave,zipfile
import xml.etree.ElementTree as ET
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
HOST=Path(os.environ.get('OCE_FEEDBACK_HOST',r'I:\Dev\freedBack\feedBack'))
# The typed host song.py is a patched copy of FeedBack (AGPL-3.0), so it is not bundled.
HOST_SONG=Path(os.environ.get('OCE_TYPED_HOST_SONG',str(ROOT/'research/staging/layouts-0.11/files/host/lib/song.py')))
if not (HOST/'lib').is_dir() or not HOST_SONG.is_file():
    raise unittest.SkipTest('Needs a local FeedBack checkout and the typed host song.py (not bundled)')
sys.path.insert(0,str(HOST/'lib'))

def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module);return module

candidate=load('layout_candidate_pack',ROOT/'pack_io.py')
legacy=load('layout_legacy_pack',ROOT/'tests/fixtures/layouts-0.11/pack_io-before.py')
host=load('layout_candidate_song',HOST_SONG)
DEFAULTS={'guitar':{4:[40,45,50,55],5:[40,45,50,55,59],6:[40,45,50,55,59,64],7:[35,40,45,50,55,59,64],8:[30,35,40,45,50,55,59,64]},'bass':{4:[28,33,38,43],5:[23,28,33,38,43],6:[23,28,33,38,43,48],7:[23,28,33,38,43,48,53],8:[23,28,33,38,43,48,53,58]}}
canonical=lambda p:json.dumps(p,sort_keys=True,separators=(',',':'),ensure_ascii=False)

def own_project(kind,count,custom=True):
    buffer=io.BytesIO()
    with wave.open(buffer,'wb') as wav:wav.setparams((1,2,8000,0,'NONE','not compressed'));wav.writeframes(b'\0\0'*800)
    bases=DEFAULTS[kind][count][:];offsets=[0]*count
    if custom:
        bases=[value+(1 if i%2==0 else -2) for i,value in enumerate(bases)];offsets=[-1 if i%2==0 else 2 for i in range(count)]
    notes=[{'id':'low','time':1,'string':0,'fret':5,'sustain':.25,'techniques':{'palm_mute':True},'_wire':{'ownFuture':17}},{'id':'high','time':2,'string':count-1,'fret':7,'sustain':.5,'techniques':{'slide_to':9}}]
    template={'name':'Own full-width shape','frets':[3+i%3 for i in range(count)],'fingers':[-1]*count}
    chord={'time':3,'chord_id':0,'notes':[{'id':'child'+str(i),'time':3,'string':i,'fret':template['frets'][i],'sustain':.25,'techniques':{}}for i in range(count)]}
    levels=[{'difficulty':0,'notes':copy.deepcopy(notes[:1]),'chords':[],'anchors':[],'handshapes':[]},{'difficulty':3,'notes':copy.deepcopy(notes),'chords':[copy.deepcopy(chord)],'anchors':[],'handshapes':[]}]
    arr={'id':'own-'+kind+str(count),'name':'Own Bass label' if kind=='guitar' else 'Own Lead label','type':kind,'instrument':'Own custom instrument','role':'bass' if kind=='bass' else 'lead','stringCount':count,'basePitches':bases,'tuning':offsets,'capo':3,'centOffset':11.8,'notes':notes,'chords':[chord],'chord_templates':[template],'anchors':[],'handshapes':[],'phrases':[{'id':'main','name':'main','time':0}], 'difficulties':levels,'activeDifficulty':3,'_wire':{'ownArrangement':True,'phrases':[{'start_time':0,'end_time':12,'levels':[]}]}}
    return {'version':1,'title':'Own layout study','artist':'Local author','duration':12,'beats':[{'time':i/2,'measure':i//4+1 if i%4==0 else -1}for i in range(25)],'sections':[],'arrangements':[arr],'_pack':{'manifest':{'stems':[{'id':'full','file':'audio/own.wav','default':True}]},'entries':{'audio/own.wav':base64.b64encode(buffer.getvalue()).decode(),'own/opaque.bin':base64.b64encode(b'Own retained source').decode()}}}

def raw_chart(blob):
    import yaml
    with zipfile.ZipFile(io.BytesIO(blob))as z:
        name=next(n for n in ('manifest.yaml','manifest.yml','manifest.json')if n in z.namelist());manifest=yaml.safe_load(z.read(name));entry=manifest['arrangements'][0];return json.loads(z.read(entry['file'])),entry,entry['file']

def rewrite(blob,name,fn):
    output=io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(blob))as source,zipfile.ZipFile(output,'w')as target:
        for member in source.infolist():target.writestr(member,fn(source.read(member))if member.filename==name else source.read(member))
    return output.getvalue()

class LayoutTests(unittest.TestCase):
    def test_all10_public_projection_roundtrip_host_pitch_and_source_immutability(self):
        for kind in ('guitar','bass'):
            for count in range(4,9):
                with self.subTest(kind=kind,count=count):
                    project=own_project(kind,count);before=canonical(project);arr=project['arrangements'][0];blob=candidate.save_feedpak(project);self.assertEqual(canonical(project),before)
                    raw,entry,_=raw_chart(blob);wire_bases=DEFAULTS[kind][count] if kind=='bass' and count in (4,5) else DEFAULTS['guitar'][count]
                    self.assertEqual(raw['basePitches'],wire_bases);self.assertEqual(raw['stringCount'],count);self.assertEqual(len(raw['tuning']),count);self.assertEqual(entry['tuning'],raw['tuning'])
                    self.assertEqual([raw['basePitches'][i]+raw['tuning'][i]for i in range(count)],[arr['basePitches'][i]+arr['tuning'][i]for i in range(count)])
                    self.assertEqual(raw['oceStringLayout']['version'],2);self.assertEqual(raw['oceStringLayout']['wire'],{k:raw[k]for k in ('stringCount','basePitches','tuning')})
                    native=host.arrangement_from_wire(raw,instrument_type=entry['type']);self.assertEqual(host.arrangement_string_count(native),count);self.assertEqual(host.arrangement_base_pitches(native),wire_bases)
                    self.assertEqual(host.arrangement_is_bass(native),kind=='bass');self.assertFalse(host.arrangement_is_keys(native));self.assertFalse(host.arrangement_is_drums(native))
                    for actual,authored in zip(native.notes,arr['notes']):self.assertEqual(host.note_pitch_midi(native,actual),arr['basePitches'][authored['string']]+arr['tuning'][authored['string']]+arr['capo']+authored['fret'])
                    for _ in range(3):
                        loaded=candidate.load_feedpak(blob);part=loaded['arrangements'][0];self.assertEqual(part['basePitches'],arr['basePitches']);self.assertEqual(part['tuning'],arr['tuning']);self.assertEqual(part['stringCount'],count);self.assertEqual(part['instrument'],arr['instrument']);self.assertEqual([d['difficulty']for d in part['difficulties']],[0,3]);self.assertEqual(part['difficulties'][1]['notes'][-1]['string'],count-1);self.assertEqual(part['chord_templates'][0]['frets'],arr['chord_templates'][0]['frets']);self.assertEqual(len(part['chords'][0]['notes']),count);blob=candidate.save_feedpak(loaded)
                    self.assertEqual(canonical(project),before)
                    with zipfile.ZipFile(io.BytesIO(blob))as z:self.assertEqual(z.read('audio/own.wav'),base64.b64decode(project['_pack']['entries']['audio/own.wav']));self.assertEqual(z.read('own/opaque.bin'),b'Own retained source')

    def test_explicit_counts_survive_sparse_and_empty_host_charts(self):
        for kind in ('guitar','bass'):
            for count in range(4,9):
                for notes in ([],[{'t':1,'s':0,'f':3}],[{'t':1,'s':count-1,'f':3}]):
                    raw={'name':'Piano Bass label','stringCount':count,'basePitches':DEFAULTS[kind][count],'tuning':[0]*count,'notes':notes};arr=host.arrangement_from_wire(raw,instrument_type=kind);self.assertEqual(host.arrangement_string_count(arr),count);self.assertEqual(host.arrangement_is_bass(arr),kind=='bass');self.assertFalse(host.arrangement_is_keys(arr));self.assertEqual(host.arrangement_to_wire(arr)['basePitches'],DEFAULTS[kind][count])

    def test_actual_frozen010_writer_archives_restore_once_and_upgrade_to_v2(self):
        for kind in ('guitar','bass'):
            for count in range(4,9):
                with self.subTest(kind=kind,count=count):
                    project=own_project(kind,count);before=canonical(project);blob=legacy.save_feedpak(project);self.assertEqual(canonical(project),before)
                    raw,entry,path=raw_chart(blob);self.assertEqual(raw['workshopStringLayout']['version'],1)
                    for archive in (blob,rewrite(blob,path,lambda data:json.dumps({**json.loads(data),'basePitches':project['arrangements'][0]['basePitches']}).encode())):
                        loaded=candidate.load_feedpak(archive);part=loaded['arrangements'][0];self.assertEqual(part['basePitches'],project['arrangements'][0]['basePitches']);self.assertEqual(part['tuning'],project['arrangements'][0]['tuning']);old_host=host.arrangement_from_wire(raw_chart(archive)[0],instrument_type=kind);self.assertEqual(host.arrangement_base_pitches(old_host),legacy._instrument_bases(kind,count));migrated=candidate.save_feedpak(loaded);migrated_part=candidate.load_feedpak(migrated)['arrangements'][0];self.assertEqual(migrated_part['basePitches'],part['basePitches']);self.assertEqual(migrated_part['tuning'],part['tuning'])

    def test_hash_or_projection_mismatches_refuse_without_mutating_input_archive(self):
        project=own_project('bass',6);blob=candidate.save_feedpak(project);raw,entry,path=raw_chart(blob);original_hash=hashlib.sha256(blob).hexdigest()
        mutations=[lambda row:row['tuning'].__setitem__(0,row['tuning'][0]+1),lambda row:row['basePitches'].__setitem__(0,row['basePitches'][0]+1),lambda row:row['oceStringLayout']['authoring']['tuning'].__setitem__(0,1)]
        for mutate in mutations:
            def change(data):
                row=json.loads(data);mutate(row);return json.dumps(row).encode()
            bad=rewrite(blob,path,change)
            with self.assertRaises(candidate.ProjectError):candidate.load_feedpak(bad)
            self.assertEqual(hashlib.sha256(blob).hexdigest(),original_hash)

    def test_stock_exact_layout_and_basis_remain_separate(self):
        for kind in ('guitar','bass'):
            for count in range(4,9):
                project=own_project(kind,count,custom=False);arr=project['arrangements'][0];arr['basePitches']=[v+1 for v in arr['basePitches']];arr['tuning']=[0]*count
                if count==(4 if kind=='bass' else 6):
                    xml=ET.fromstring(candidate.save_xml(project));self.assertEqual(int(xml.find('tuning').get('string0')),1)
                else:
                    with self.assertRaises(candidate.ProjectError):candidate.save_xml(project)

if __name__=='__main__':unittest.main()
