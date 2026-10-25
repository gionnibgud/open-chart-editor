"""Original GPIF fixtures, staged adapter only; never install reference code."""
import copy
import base64
import io
import importlib.util
import json
from pathlib import Path
import subprocess
import struct
import sys
import tempfile
import unittest
from xml.etree import ElementTree as E
import zipfile
from unittest.mock import patch
from test_pack_io import original_gpif,project as own_project
ROOT=Path(__file__).resolve().parents[1];STAGE=ROOT/'research/staging/gpif-capo'
spec=importlib.util.spec_from_file_location('oce_gpif_staging',STAGE/'pack_io.py');p=importlib.util.module_from_spec(spec);sys.modules[spec.name]=p;spec.loader.exec_module(p)
CORE=Path(r'I:\Dev\freedBack\feedBack\lib')

def capo_property(parent,value):
    properties=E.SubElement(parent,'Properties');prop=E.SubElement(properties,'Property',name='CapoFret');E.SubElement(prop,'Fret').text=str(value);return properties

def source(capo=3):
    root=E.fromstring(original_gpif());track=root.find('./Tracks/Track');capo_property(track,capo);note=root.find('./Notes/Note');note.find('./Property[@name="Fret"]/Fret').text='0';return root

def worker(root,container='zip'):
    with tempfile.TemporaryDirectory(prefix='oce-own-gpif-') as temp:
        directory=Path(temp);source=directory/('own.gp' if container=='zip' else 'own.gpx')
        if container=='zip':
            with zipfile.ZipFile(source,'w') as z:z.writestr('Content/score.gpif',E.tostring(root))
        else:
            data=E.tostring(root);assert len(data)<=4096
            content=bytearray(4+3*4096);content[:4]=b'BCFS';offset=4+4096;struct.pack_into('<I',content,offset,2);content[offset+4:offset+14]=b'score.gpif';struct.pack_into('<I',content,offset+0x8c,len(data));struct.pack_into('<I',content,offset+0x94,2);content[4+8192:4+8192+len(data)]=data
            if container=='bcfz':
                chunks=[content[i:i+3] for i in range(0,len(content),3)];bits=''.join('0'+format(len(chunk),'02b')[::-1]+''.join(format(byte,'08b') for byte in chunk) for chunk in chunks);bits+='0'*((-len(bits))%8);content=b'BCFZ'+struct.pack('<I',len(content))+bytes(int(bits[i:i+8],2) for i in range(0,len(bits),8))
            source.write_bytes(content)
        request={'core':str(CORE),'source':str(source),'output':str(directory/'converted')}
        result=subprocess.run([sys.executable,'-I','-X','utf8',str(STAGE/'pack_io.py'),'--gp-worker'],input=json.dumps(request),capture_output=True,text=True,encoding='utf-8',timeout=30)
        document=json.loads(result.stdout)
        if result.returncode or not document.get('ok'):raise p.ProjectError(document.get('error',result.stderr))
        return document['result']

def loaded(root):
    buffer=io.BytesIO()
    with zipfile.ZipFile(buffer,'w') as z:z.writestr('Content/score.gpif',E.tostring(root));z.writestr('Own/source-extra.txt',b'original own source extra')
    data=buffer.getvalue();actual_run=subprocess.run
    def run(command,**kwargs):
        command=list(command)
        if command[-1]=='--gp-worker':command[-2]=str(STAGE/'pack_io.py')
        return actual_run(command,**kwargs)
    # Staging isn't beside the real FeedBack checkout. Resolve the public core
    # as production does while executing the actual staged worker unchanged.
    with patch.object(p,'__file__',str(ROOT/'pack_io.py')),patch.object(p.subprocess,'run',run):result=p.load_project(data,'own.gp8')
    return result,data

def multi_source():
    root=E.fromstring(original_gpif());tracks=root.find('Tracks');tracks.clear()
    for tag in ('Bars','Voices','Beats','Notes'):root.find(tag).clear()
    layouts=[('six',[40,45,50,55,59,64],24),('seven',[35,40,45,50,55,59,64],24),('eight',[30,35,40,45,50,55,59,64],24),('bass',[23,28,33,38,43],33)]
    for i,(name,pitches,program) in enumerate(layouts):
        track=E.SubElement(tracks,'Track',id='source-'+name);E.SubElement(track,'Name').text='Own '+name
        tuning=E.SubElement(track,'Property',name='Tuning');E.SubElement(tuning,'Pitches').text=' '.join(map(str,pitches));gm=E.SubElement(track,'GeneralMidi');E.SubElement(gm,'Program').text=str(program);capo_property(track,i+1)
        bar=E.SubElement(root.find('Bars'),'Bar',id=str(i));E.SubElement(bar,'Voices').text=str(i);voice=E.SubElement(root.find('Voices'),'Voice',id=str(i));E.SubElement(voice,'Beats').text=f'{i}a {i}b'
        for suffix,fret in [('a',0),('b',2)]:
            key=f'{i}{suffix}';beat=E.SubElement(root.find('Beats'),'Beat',id=key);E.SubElement(beat,'Rhythm',ref='r0');E.SubElement(beat,'Notes').text=key;note=E.SubElement(root.find('Notes'),'Note',id=key)
            for prop,value in [('String',0),('Fret',fret)]:node=E.SubElement(note,'Property',name=prop);E.SubElement(node,prop).text=str(value)
    root.find('./MasterBars/MasterBar/Bars').text='0 1 2 3';return root,layouts

class GpifCapoTests(unittest.TestCase):
    def test_real_public_converter_open_string_capofret_retained(self):
        root=source(3);before=E.tostring(root);result=worker(root);self.assertEqual(result['tracks'][0]['capo'],3);self.assertEqual(E.tostring(root),before)
        raw=E.fromstring(result['tracks'][0]['xml']);self.assertEqual(raw.findtext('capo'),'0');self.assertEqual(raw.find('./levels/level/notes/note').get('fret'),'0')
        self.assertFalse(any('capo metadata is not established' in warning for warning in result['warnings']))

    def test_actual_import_multi_extended_open_and_nonzero_pitch_once_source_exact(self):
        root,layouts=multi_source();before=E.tostring(root);song,data=loaded(root);self.assertEqual(E.tostring(root),before);self.assertEqual(base64.b64decode(song['_import']['source']),data)
        self.assertEqual([info['gpif_track_id'] for info in song['_import']['tracks']],['source-'+name for name,_,_ in layouts])
        for index,(arr,(_,pitches,_)) in enumerate(zip(song['arrangements'],layouts)):
            self.assertEqual(arr['stringCount'],len(pitches));self.assertEqual(arr['capo'],index+1);self.assertEqual([n['fret'] for n in arr['notes']],[0,2]);self.assertEqual(arr['basePitches'],pitches)
            self.assertEqual([arr['basePitches'][n['string']]+arr['tuning'][n['string']]+arr['capo']+n['fret'] for n in arr['notes']],[pitches[0]+index+1,pitches[0]+index+3])
        xml=E.fromstring(p.save_xml(song,song['arrangements'][0]['id']));self.assertEqual([n.get('fret') for n in xml.findall('./levels/level/notes/note')],['0','3']);self.assertEqual(xml.findtext('capo'),'1')
        json_reopen=p.load_project(p.save_project(song,'json')[0],'own.json');self.assertEqual([a['capo'] for a in json_reopen['arrangements']],[1,2,3,4]);self.assertEqual(base64.b64decode(json_reopen['_import']['source']),data)
        backing=own_project()['_pack'];song['_pack']['manifest']=backing['manifest'];song['_pack']['entries'].update(backing['entries']);reopened=p.load_feedpak(p.save_feedpak(song));self.assertEqual([a['capo'] for a in reopened['arrangements']],[1,2,3,4]);self.assertEqual(base64.b64decode(reopened['_pack']['entries']['sources/original.gp']),data)

    def test_absent_capo_zero_without_obsolete_blanket_warning(self):
        song,_=loaded(E.fromstring(original_gpif()));self.assertEqual(song['arrangements'][0]['capo'],0);self.assertFalse(any('capo metadata is not established' in w for w in song['import_warnings']))
        root=E.fromstring(original_gpif());root.find('./Tracks/Track').attrib.pop('id');self.assertEqual(worker(root)['tracks'][0]['capo'],0)

    def test_staff_and_track_document_order_precedence(self):
        for track_last in (False,True):
            root=source(2);track=root.find('./Tracks/Track');staves=E.SubElement(track,'Staves');staff=E.SubElement(staves,'Staff');capo_property(staff,4)
            if track_last:
                properties=track.find('Properties');track.remove(properties);track.append(properties)
            expected=2 if track_last else 4;self.assertEqual(worker(root)['tracks'][0]['capo'],expected)

    def test_new_staff_defaults_and_conflicting_staff_capos_rejected(self):
        root=source(3);track=root.find('./Tracks/Track');staves=E.SubElement(track,'Staves');E.SubElement(staves,'Staff');E.SubElement(staves,'Staff')
        with self.assertRaisesRegex(p.ProjectError,'conflicting staff capos'):worker(root)
        for staff in staves:capo_property(staff,3)
        self.assertEqual(worker(root)['tracks'][0]['capo'],3)
        staves[1].find('./Properties/Property/Fret').text='5';properties=track.find('Properties');track.remove(properties);track.append(properties)
        self.assertEqual(worker(root)['tracks'][0]['capo'],3)

    def test_gp6_original_bcfs_and_bcfz_capo_metadata(self):
        for container in ('bcfs','bcfz'):
            with self.subTest(container=container):self.assertEqual(worker(source(3),container)['tracks'][0]['capo'],3)

    def test_invalid_present_metadata_and_physical_fret_limit_rejected(self):
        for value in ('broken','3.5',-1,25,''):
            with self.subTest(value=value):
                with self.assertRaisesRegex(p.ProjectError,'CapoFret/Fret'):worker(source(value))
        root=source(3);root.find('./Notes/Note/Property[@name="Fret"]/Fret').text='22'
        with self.assertRaisesRegex(p.ProjectError,'physical fret24'):worker(root)

    def test_public_track_source_identity_rejects_duplicate_or_reordered_mapping(self):
        root,layouts=multi_source();tracks=list(root.find('Tracks'));raw=[{'_el':track,'id':track.get('id'),'name':track.findtext('Name'),'num_staves':1,'stave_pitches':[]} for track in tracks];infos=[{'index':i,'name':row['name']} for i,row in enumerate(raw)]
        self.assertEqual([row['staffCapos'] for row in p._gpif_capo_metadata(root,raw,infos)],[[1],[2],[3],[4]])
        for change in ('reordered','duplicate','name','missing','oversized'):
            with self.subTest(change=change):
                copied=copy.deepcopy(raw);copy_root=E.Element('GPIF');container=E.SubElement(copy_root,'Tracks')
                for row in copied:container.append(row['_el'])
                altered=copy.deepcopy(infos)
                if change=='reordered':copied.reverse()
                if change=='duplicate':copied[1]['id']=copied[0]['id'];copied[1]['_el'].set('id',copied[0]['id'])
                if change=='name':altered[0]['name']='different source'
                if change=='missing':copied.pop()
                if change=='oversized':copied[0]['id']='x'*1025;copied[0]['_el'].set('id',copied[0]['id'])
                with self.assertRaisesRegex(p.ProjectError,'track'):p._gpif_capo_metadata(copy_root,copied,altered)

    def test_capo_at_unsupported_location_rejected_and_nonfretted_retained_only(self):
        root=source(3);track=root.find('./Tracks/Track');properties=track.find('Properties');prop=properties.find('Property');properties.remove(prop);track.append(prop)
        with self.assertRaisesRegex(p.ProjectError,'outside supported'):worker(root)
        root=source(3);root.find('./Tracks/Track/Name').text='Piano';result=worker(root);self.assertEqual(result['tracks'][0]['kind'],'keys');self.assertEqual(result['tracks'][0]['capo'],0);self.assertTrue(any('not applied to a non-fretted' in warning for warning in result['warnings']))

    def test_conflicting_staff_tunings_rejected_for_nonzero_shared_capo(self):
        root=source(3);track=root.find('./Tracks/Track');staves=E.SubElement(track,'Staves')
        for pitches in ([40,45,50,55,59,64],[38,45,50,55,59,64]):
            staff=E.SubElement(staves,'Staff');properties=capo_property(staff,3);tuning=E.SubElement(properties,'Property',name='Tuning');E.SubElement(tuning,'Pitches').text=' '.join(map(str,pitches))
        with self.assertRaisesRegex(p.ProjectError,'different tunings'):worker(root)

if __name__=='__main__':unittest.main()
