"""Original proposal tests only; the production importer is not modified."""
import base64
import copy
from fractions import Fraction as F
from pathlib import Path
import sys
import time
import unittest
import xml.etree.ElementTree as E

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tests'/'fixtures'))
import musicxml_dynamics_candidate as d
import pack_io

def score(body):
    return ('<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1" implicit="yes"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>'+body+'</measure></part></score-partwise>').encode()
def note(step='C',octave=4,*,staff='1',voice='1',chord=False,tie=None):
    return '<note>'+('<chord/>' if chord else '')+f'<pitch><step>{step}</step><octave>{octave}</octave></pitch><duration>1</duration>'+('' if tie is None else f'<tie type="{tie}"/>')+f'<voice>{voice}</voice><staff>{staff}</staff></note>'
def direction(percent,*,scope='',offset=''):
    return '<direction><direction-type><words>Own dynamic</words></direction-type>'+offset+scope+f'<sound dynamics="{percent}"/></direction>'

class MusicXmlDynamicsCandidateTests(unittest.TestCase):
    def test_real_production_counterexample_and_original_source_bytes(self):
        data=(Path(__file__).resolve().parents[1]/'tests/fixtures/musicxml-dynamics-counterexample.musicxml').read_bytes()
        song=pack_io.load_project(data,'own-dynamics.musicxml');notes=song['arrangements'][0]['notes'];self.assertEqual([n['velocity'] for n in notes],[45,90]);self.assertEqual(base64.b64decode(song['_import']['source']),data)
        timeline=d.NumericDynamics('P1');sounds=E.fromstring(data).findall('.//sound');timeline.add_sound(sounds[0],F(0),F(1));timeline.add_sound(sounds[1],F(1),F(1));before=copy.deepcopy(notes);out=timeline.apply(notes,[F(0),F(1)]);self.assertEqual([n['velocity'] for n in out.notes],[45,90]);self.assertEqual(notes,before)

    def test_forte90_units_exact_decimal_half_up_zero_and_clipping(self):
        timeline=d.NumericDynamics('P1')
        for index,raw in enumerate(['50','100','55','140','0','150','141.2','0.5']):timeline.add(F(index),raw)
        self.assertEqual([timeline.velocity_at(F(i)) for i in range(8)],[45,90,50,126,0,127,127,0]);self.assertEqual(len(timeline.warnings),3)
        for raw in ['-1','NaN','INF','1e2','','  ','1/2','9'*129]:
            with self.assertRaises(d.DynamicsError):d.NumericDynamics('P1').add(F(0),raw)
        self.assertEqual(d.decimal_value('+50.00',nonnegative=True),F(50));self.assertEqual(d.decimal_value('-0',nonnegative=True),F(0))

    def test_no_matching_explicit_event_never_adds_or_changes_velocity(self):
        notes=[{'id':'own-none','opaque':{'keep':[1]}},{'id':'own-existing','velocity':23}];timeline=d.NumericDynamics('P1');out=timeline.apply(notes,[F(0),F(1)]);self.assertIs(out.notes[0],notes[0]);self.assertIs(out.notes[1],notes[1]);self.assertEqual(out.updates,());timeline.add(F(2),'100');self.assertEqual(timeline.apply(notes,[F(0),F(1)]).notes,tuple(notes))

    def test_scope_resolution_preserves_staff_voice_and_obeys_explicit_latest_then_specific_policy(self):
        timeline=d.NumericDynamics('P1');timeline.add(F(0),'50');timeline.add(F(0),'100',staff='02',voice='2');timeline.add(F(1),'80')
        records=[{'staff':'1','voice':'1'},{'staff':'02','voice':'2'},{'staff':'2','voice':'02'},{'staff':'2','voice':'2'}];out=timeline.apply(records,[F(0),F(0),F(0),F(2)]);self.assertEqual([n['velocity'] for n in out.notes],[45,90,45,72]);self.assertEqual(out.notes[1]['staff'],'02');self.assertEqual(out.notes[2]['voice'],'02');self.assertTrue(all('velocity' not in n for n in records))

    def test_raw_same_scope_and_equal_specificity_conflicts_reject_without_record_mutation(self):
        notes=[{'id':'own','staff':'1','voice':'1','opaque':{'keep':[1]}}];before=copy.deepcopy(notes)
        timeline=d.NumericDynamics('P1');timeline.add(F(0),'50');timeline.add(F(0),'50.1') # Both would round45; raw values still conflict.
        with self.assertRaisesRegex(d.DynamicsError,'conflicting raw'):timeline.apply(notes,[F(0)])
        self.assertEqual(notes,before)
        timeline=d.NumericDynamics('P1');timeline.add(F(0),'50',staff='1');timeline.add(F(0),'100',voice='1')
        with self.assertRaisesRegex(d.DynamicsError,'equally-specific'):timeline.apply(notes,[F(0)])
        self.assertEqual(notes,before);timeline.add(F(0),'80',staff='1',voice='1');self.assertEqual(timeline.apply(notes,[F(0)]).notes[0]['velocity'],72)

    def test_exact_playback_offset_default_no_yes_and_sound_child_override(self):
        for flag,expected in [('',F(1)),(' sound="no"',F(1)),(' sound="yes"',F(0))]:
            node=E.fromstring(direction('50',offset=f'<offset{flag}>-2</offset>'));self.assertEqual(d.playback_position(node.find('sound'),F(1),F(2),direction=node),expected)
        node=E.fromstring('<direction><offset sound="yes">-2</offset><sound dynamics="50"><offset>1</offset></sound></direction>');self.assertEqual(d.playback_position(node.find('sound'),F(1),F(2),direction=node),F(3,2))
        with self.assertRaises(d.DynamicsError):d.playback_position(E.fromstring('<sound><offset>-1</offset></sound>'),F(0),F(2))
        with self.assertRaises(d.DynamicsError):d.playback_position(E.fromstring('<sound/>'),.5,F(2))

    def test_real_backup_forward_part_scope_fixture_maps_by_rational_onset_not_document_order(self):
        body=direction('50')+note()+ '<sound dynamics="80"/>'+note('D')+'<backup><duration>2</duration></backup>'+direction('100',scope='<voice>2</voice><staff>2</staff>')+note('C',3,staff='2',voice='2')+'<forward><duration>1</duration></forward>'+note('D',3,staff='2',voice='2')
        data=score(body);song=pack_io.load_musicxml(data);records=song['arrangements'][0]['notes'];self.assertEqual([n['time'] for n in records],[0,.5,0,1]);timeline=d.NumericDynamics('P1');root=E.fromstring(data);directions=root.findall('.//direction');timeline.add_sound(directions[0].find('sound'),F(0),F(1),direction=directions[0]);timeline.add_sound(root.find('./part/measure/sound'),F(1),F(1));timeline.add_sound(directions[1].find('sound'),F(0),F(1),direction=directions[1]);out=timeline.apply(records,[F(0),F(1),F(0),F(2)]);self.assertEqual([n['velocity'] for n in out.notes],[45,72,90,72]);self.assertEqual([n['hand'] for n in out.notes],['rh','rh','lh','lh'])

    def test_real_chord_fixture_all_voices_use_parent_onset_even_if_marker_serialized_after_first_note(self):
        data=score(note()+direction('100',offset='<offset sound="yes">-1</offset>')+note('E',chord=True)+note('G'));song=pack_io.load_musicxml(data);records=song['arrangements'][0]['notes'];self.assertEqual([n['time'] for n in records],[0,0,.5]);node=E.fromstring(data).find('.//direction');timeline=d.NumericDynamics('P1');timeline.add_sound(node.find('sound'),F(1),F(1),direction=node);self.assertEqual([n['velocity'] for n in timeline.apply(records,[F(0),F(0),F(1)]).notes],[90,90,90])

    def test_real_tie_merge_keeps_first_attack_velocity_without_fabricated_sustain_ramp(self):
        data=score(direction('50')+note(tie='start')+direction('100')+note(tie='stop')+'<backup><duration>1</duration></backup>'+note('E',voice='2'));song=pack_io.load_musicxml(data);records=song['arrangements'][0]['notes'];self.assertEqual(len(records),2);self.assertEqual(records[0]['sustain'],1);timeline=d.NumericDynamics('P1');timeline.add(F(0),'50');timeline.add(F(1),'100');out=timeline.apply(records,[F(0),F(1)]);self.assertEqual([n['velocity'] for n in out.notes],[45,90]);self.assertEqual(out.notes[0]['sustain'],1)

    def test_keys_zero_is_valid_while_other_roles_keep_existing_fields_and_one_part_warning(self):
        song=pack_io.load_musicxml(score(direction('0')+note()));records=song['arrangements'][0]['notes'];timeline=d.NumericDynamics('P1');timeline.add(F(0),'0');song['arrangements'][0]['notes']=list(timeline.apply(records,[F(0)]).notes);self.assertEqual(pack_io.validate_project(song)['arrangements'][0]['notes'][0]['velocity'],0)
        for kind in ['drums','guitar','bass']:
            timeline=d.NumericDynamics('OwnPart',kind);timeline.add(F(0),'0');timeline.add(F(1),'150');records=[{'velocity':100},{'opaque':{'keep':True}}];before=copy.deepcopy(records);out=timeline.apply(records,[F(0),F(1)]);self.assertEqual(out.notes,tuple(before));self.assertEqual(out.updates,());self.assertEqual(len(out.warnings),1);self.assertIn(kind,out.warnings[0]);self.assertEqual(records,before)

    def test_reports_are_bounded_per_event_not_per_note_and_events_have_a_hard_limit(self):
        timeline=d.NumericDynamics('P1')
        for i in range(100):timeline.add(F(i),'150')
        warnings=timeline.warnings;out=timeline.apply([{} for _ in range(2000)],[F(100)]*2000);self.assertEqual(out.warnings,warnings);self.assertEqual(len(warnings),65);self.assertIn('36 additional',warnings[-1]);self.assertTrue(all(n['velocity']==127 for n in out.notes))
        limited=d.NumericDynamics('P1',event_limit=3)
        for i in range(3):limited.add(F(i),'50')
        with self.assertRaisesRegex(d.DynamicsError,'event limit'):limited.add(F(3),'100')
        self.assertEqual(len(limited.events),3)

    def test_independent_part_context_never_leaks_and_repeat_specific_markers_reject(self):
        a=d.NumericDynamics('P1');b=d.NumericDynamics('P2');a.add(F(0),'50');self.assertEqual(a.velocity_at(F(0)),45);self.assertIsNone(b.velocity_at(F(0)));sound=E.fromstring('<sound dynamics="50" time-only="1"/>')
        with self.assertRaisesRegex(d.DynamicsError,'time-only'):b.add_sound(sound,F(0),F(1))
        self.assertEqual(b.events,[])

    def test_unsupported_letters_wedges_and_note_attributes_are_disclosed_without_guessed_values(self):
        root=E.fromstring('<part><direction><direction-type><dynamics><p/></dynamics><wedge type="crescendo"/></direction-type></direction><note dynamics="55" end-dynamics="10"><notations><dynamics><sfz/></dynamics></notations></note></part>');warnings=d.expression_warnings(root);self.assertEqual(len(warnings),4);supported=E.fromstring(direction('50').replace('<words>Own dynamic</words>','<dynamics><p/></dynamics>'));self.assertEqual(d.expression_warnings(supported),())

    def test_20000_notes_and_2000_events_use_indexed_four_scope_queries(self):
        timeline=d.NumericDynamics('P1');timeline.add(F(0),'50')
        for i in range(2000):timeline.add(F(i),'80',staff='2',voice='2')
        records=[{'staff':'2' if i%2 else '1','voice':'2' if i%2 else '1'} for i in range(20000)];start=time.perf_counter();out=timeline.apply(records,[F(i,10) for i in range(20000)]);elapsed=time.perf_counter()-start;self.assertEqual(out.query_count,20000);self.assertEqual([n['velocity'] for n in out.notes[:4]],[45,72,45,72]);self.assertLess(elapsed,10)

    def test_aggregate_event_budget_and_warning_cap_apply_to_the_entire_score(self):
        contexts=[d.NumericDynamics('OwnPart'+str(i)) for i in range(3)]
        for timeline in contexts:
            for i in range(100):timeline.add(F(i),'150')
        self.assertEqual(d.validate_collection(contexts),300)
        with self.assertRaisesRegex(d.DynamicsError,'aggregate'):d.validate_collection(contexts,event_limit=299)
        warnings=d.aggregate_warnings(contexts,extra=['Own expression warning']);self.assertEqual(len(warnings),65);self.assertIn('237 additional',warnings[-1]);self.assertEqual(d.aggregate_warnings(contexts,limit=0),('MusicXML: 300 additional numeric-dynamics/expression warnings were summarized across all parts.',))

    def test_same_scope_conflict_in_a_later_part_is_detected_before_any_collection_application(self):
        first=d.NumericDynamics('P1');second=d.NumericDynamics('P2');first.add(F(0),'50');second.add(F(0),'50');second.add(F(0),'50.1');records=[{'text':'Own untouched'}];before=copy.deepcopy(records)
        with self.assertRaisesRegex(d.DynamicsError,'conflicting raw'):d.validate_collection([first,second])
        self.assertEqual(records,before)

if __name__=='__main__':unittest.main()
