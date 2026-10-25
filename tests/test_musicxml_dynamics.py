"""Production MusicXML numeric dynamics, source retention and loader isolation."""
import base64
import hashlib
import importlib.util
import io
import json
import pathlib
import shutil
import sys
import tempfile
import types
import unittest
import zipfile
from unittest.mock import patch
import pack_io
from test_musicxml_dynamics_candidate import score,note,direction

ROOT=pathlib.Path(__file__).resolve().parents[1]

def load(body):
    return pack_io.load_project(score(body),'own.musicxml')

def velocities(project):
    return [n.get('velocity') for n in project['arrangements'][0]['notes']]

class MusicXmlDynamicsProductionTests(unittest.TestCase):
    def test_source_counterexample_xml_and_compressed_mxl(self):
        data=(ROOT/'tests/fixtures/musicxml-dynamics-counterexample.musicxml').read_bytes()
        container=b'<container><rootfiles><rootfile full-path="score/own.musicxml"/></rootfiles></container>'
        buf=io.BytesIO()
        with zipfile.ZipFile(buf,'w') as z:
            z.writestr('META-INF/container.xml',container);z.writestr('score/own.musicxml',data)
        for payload,name in [(data,'own.musicxml'),(buf.getvalue(),'own.mxl')]:
            project=pack_io.load_project(payload,name)
            self.assertEqual(velocities(project),[45,90]);self.assertEqual(base64.b64decode(project['_import']['source']),data)
            self.assertEqual(velocities(pack_io.load_project(json.dumps(project).encode(),'own.json')),[45,90])

    def test_backup_forward_staff_voice_and_part_scope(self):
        body=direction('50')+note()+'<sound dynamics="80"/>'+note('D')+'<backup><duration>2</duration></backup>'+direction('100',scope='<voice>2</voice><staff>2</staff>')+note('C',3,staff='2',voice='2')+'<forward><duration>1</duration></forward>'+note('D',3,staff='2',voice='2')
        project=load(body);self.assertEqual(velocities(project),[45,72,90,72]);self.assertEqual([n['time'] for n in project['arrangements'][0]['notes']],[0,.5,0,1])
        data=score(direction('50')+note()).replace(b'</score-partwise>',('<part id="P2"><measure implicit="yes">'+note()+'</measure></part></score-partwise>').encode())
        project=pack_io.load_project(data,'own.musicxml');self.assertNotIn('velocity',project['arrangements'][1]['notes'][0])

    def test_chords_and_merged_ties_resolve_original_attack(self):
        project=load(note()+direction('100',offset='<offset sound="yes">-1</offset>')+note('E',chord=True)+note('G'))
        self.assertEqual(velocities(project),[90,90,90]);self.assertEqual([n['time'] for n in project['arrangements'][0]['notes']],[0,0,.5])
        project=load(direction('50')+note(tie='start')+direction('100')+note(tie='stop')+'<backup><duration>1</duration></backup>'+note('E',voice='2'))
        self.assertEqual(velocities(project),[45,90]);self.assertEqual(project['arrangements'][0]['notes'][0]['sustain'],1)

    def test_offsets_default_visual_yes_and_nested_sound_override(self):
        for flag,expected in [('',[None,45]),(' sound="no"',[None,45]),(' sound="yes"',[45,45])]:
            self.assertEqual(velocities(load(note()+direction('50',offset=f'<offset{flag}>-1</offset>')+note('E'))),expected)
        body=note()+'<direction><offset sound="yes">-1</offset><sound dynamics="50"><offset>1</offset></sound></direction>'+note('E')+note('G')
        self.assertEqual(velocities(load(body)),[None,None,45])
        self.assertEqual(velocities(load('<sound dynamics="50"><offset>1</offset></sound>'+note()+note('E'))),[None,45])

    def test_invalid_raw_conflict_and_offset_errors_leave_source_untouched(self):
        for body in [direction('-1')+note(),direction('NaN')+note(),direction('50')+direction('50.1')+note(),direction('50',scope='<staff>1</staff>')+direction('100',scope='<voice>1</voice>')+note(),direction('50',offset='<offset sound="yes">-1</offset>')+note(),'<sound dynamics="50" time-only="2"/>'+note()]:
            data=score(body);before=bytes(data)
            with self.assertRaises(pack_io.ProjectError):pack_io.load_project(data,'own.musicxml')
            self.assertEqual(data,before)

    def test_zero_clipping_exact_units_and_absent_fields(self):
        project=load(''.join(direction(value)+note() for value in ['0','55','150','141.2']))
        self.assertEqual(velocities(project),[0,50,127,127]);self.assertEqual(sum('clip' in w.lower() for w in project['import_warnings']),2)
        self.assertEqual(velocities(load(note()+note('E'))),[None,None])
        project=load('<direction><direction-type><dynamics><p/></dynamics><wedge type="crescendo"/></direction-type></direction>'+note())
        self.assertIsNone(velocities(project)[0]);self.assertTrue(any('wedges' in w for w in project['import_warnings']));self.assertTrue(any('symbolic dynamics' in w for w in project['import_warnings']))

    def test_nonkeys_velocities_stay_valid_and_warning_is_per_part(self):
        tab='<notations><technical><string>6</string><fret>0</fret></technical></notations>'
        body=direction('0')+note('E',2).replace('</note>',tab+'</note>')
        project=load(body);self.assertEqual(project['arrangements'][0]['type'],'guitar');self.assertIsNone(velocities(project)[0]);self.assertEqual(sum('velocities are unchanged' in w for w in project['import_warnings']),1)

    def test_bounds_are_aggregate_and_diagnostic_part_label_bounded(self):
        with patch.object(pack_io._musicxml_dynamics,'MAX_EVENTS',2):
            with self.assertRaisesRegex(pack_io.ProjectError,'aggregate'):
                load(direction('50')+direction('50')+direction('50')+note())
        data=score(direction('150')+note()).replace(b'id="P1"',b'id="'+b'X'*5000+b'"')
        project=pack_io.load_project(data,'own.musicxml');self.assertTrue(all(len(w)<1000 for w in project['import_warnings']))

    def test_unsupported_sound_controls_disclosed_without_changing_playback(self):
        for marker in ['<sound damper-pedal="yes"/>','<sound pizzicato="yes"/>','<sound><midi-instrument id="own"><midi-program>12</midi-program></midi-instrument></sound>','<direction><sound tempo="120" pizzicato="yes"/></direction>']:
            data=score(marker+note());project=pack_io.load_project(data,'own.musicxml')
            self.assertEqual(project['arrangements'][0]['notes'][0]['time'],0)
            self.assertEqual(base64.b64decode(project['_import']['source']),data)
            self.assertTrue(any('sound controls' in w for w in project['import_warnings']))
        project=load('<sound tempo="120" dynamics="50"/>'+note())
        self.assertEqual(velocities(project),[45]);self.assertFalse(any('sound controls' in w for w in project['import_warnings']))
        project=load('<sound pizzicato="yes"/>'*1000+note())
        self.assertEqual(sum('sound controls' in w for w in project['import_warnings']),1)

    def test_standalone_dynamic_and_package_imports_are_path_isolated(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'tests') as temp:
            target=pathlib.Path(temp)
            for filename in ['pack_io.py','notation_state.py','musicxml_dynamics.py','midi_programs.py','feedpak_contract.py']:shutil.copyfile(ROOT/filename,target/filename)
            # A stale conventional alias cannot substitute for this installation.
            alias='open_chart_editor_dynamics_'+hashlib.sha256(str((target/'musicxml_dynamics.py').resolve()).encode()).hexdigest()[:20]
            fake=types.ModuleType(alias);fake.__file__='different.py';sys.modules[alias]=fake
            spec=importlib.util.spec_from_file_location('own_standalone_pack',target/'pack_io.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
            self.assertEqual(velocities(module.load_project(score(direction('50')+note()),'own.musicxml')),[45])
            self.assertEqual(pathlib.Path(module._musicxml_dynamics.__file__).resolve(),(target/'musicxml_dynamics.py').resolve())
            self.assertIsNot(module._musicxml_dynamics,pack_io._musicxml_dynamics);self.assertEqual(pathlib.Path(module._midi_programs.__file__).resolve(),(target/'midi_programs.py').resolve())
            package=types.ModuleType('own_oce_package');package.__path__=[str(target)];sys.modules[package.__name__]=package
            try:
                spec=importlib.util.spec_from_file_location('own_oce_package.pack_io',target/'pack_io.py');host=importlib.util.module_from_spec(spec);sys.modules[spec.name]=host;spec.loader.exec_module(host)
                self.assertEqual(velocities(host.load_project(score(direction('100')+note()),'own.musicxml')),[90]);self.assertEqual(host._musicxml_dynamics.__name__,'own_oce_package.musicxml_dynamics');self.assertEqual(host._midi_programs.__name__,'own_oce_package.midi_programs')
            finally:
                for name in list(sys.modules):
                    if name.startswith('own_oce_package') or name==alias:sys.modules.pop(name,None)

if __name__=='__main__':unittest.main()
