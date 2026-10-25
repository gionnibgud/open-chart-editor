"""Worker-local GPIF repairs: chromatic Tone steps, pitch-only fretted notes, unmapped drum lanes."""
from pathlib import Path
import sys
import types
import unittest
import xml.etree.ElementTree as ET

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import pack_io as p


def prop(name,tag,value):return f'<Property name="{name}"><{tag}>{value}</{tag}></Property>'


def gpif(bass_notes,drum_notes,piano_notes):
    """One bar, one beat per track; note ids are b*, d*, k*."""
    notes=''.join(f'<Note id="{i}"{tie}><Properties>{body}</Properties></Note>' for i,body,tie in bass_notes+drum_notes+piano_notes)
    beat=lambda bid,group:f'<Beat id="{bid}"><Notes>{" ".join(i for i,_,_ in group)}</Notes></Beat>'
    return ET.fromstring('<GPIF><MasterBars><MasterBar><Bars>0 1 2</Bars></MasterBar></MasterBars>'
        '<Bars><Bar id="0"><Voices>0</Voices></Bar><Bar id="1"><Voices>1</Voices></Bar><Bar id="2"><Voices>2</Voices></Bar></Bars>'
        '<Voices><Voice id="0"><Beats>0</Beats></Voice><Voice id="1"><Beats>1</Beats></Voice><Voice id="2"><Beats>2</Beats></Voice></Voices>'
        f'<Beats>{beat(0,bass_notes)}{beat(1,drum_notes)}{beat(2,piano_notes)}</Beats><Notes>{notes}</Notes></GPIF>')


def fake_converter(root):
    tracks=[{'name':'Bass','num_staves':1,'stave_columns':[0],'string_pitches':[28,33,38,43],'is_drums':False},
            {'name':'Drums','num_staves':1,'stave_columns':[1],'string_pitches':[],'is_drums':True},
            {'name':'Piano','num_staves':1,'stave_columns':[2],'string_pitches':[],'is_drums':False}]
    module=types.SimpleNamespace(_load_gpif=lambda path:root,_gpif_tracks=lambda r:tracks,
        _notes_by_id=lambda r:{n.get('id'):n for n in r.find('Notes')},_note_midi=lambda note,*a,**k:'original')
    return module


class GpifNoteRepairTests(unittest.TestCase):
    def setUp(self):
        bass=[('b1',prop('Octave','Number',3)+prop('Tone','Step',10),''),   # Bb2 = 46
              ('b2',prop('Octave','Number',2)+prop('Tone','Step',4),''),    # E1 = 28, open low string
              ('b3',prop('Octave','Number',9),'')]                          # no Tone: C9, unplayable
        drums=[('d1',prop('String','String',1)+prop('Fret','Fret',6),''),('d2',prop('String','String',0)+prop('Fret','Fret',3),'')]
        piano=[('k1',prop('Octave','Number',5),''),('k2',prop('Octave','Number',5)+prop('Tone','Step',3),'')]
        self.root=gpif(bass,drums,piano);self.gpx=fake_converter(self.root)
        self.report=p._gpif_note_repairs(self.gpx);self.gpx._load_gpif('song.gpx')
        self.notes={n.get('id'):n for n in self.root.find('Notes')}

    def tab(self,note_id):
        props={q.get('name'):q for q in self.notes[note_id].iter('Property')}
        return (int(props['String'].findtext('String')),int(props['Fret'].findtext('Fret'))) if 'String' in props else None

    def test_pitch_only_bass_gets_distinct_playable_strings(self):
        placed={i:self.tab(i) for i in ('b1','b2')}
        self.assertEqual({[28,33,38,43][s]+f for s,f in placed.values()},{46,28})
        self.assertNotEqual(placed['b1'][0],placed['b2'][0])
        self.assertIsNone(self.tab('b3'))
        self.assertEqual((self.report[0]['tabFilled'],self.report[0]['tabUnplaced']),(2,1))

    def test_piano_reads_chromatic_steps_and_omitted_tone_as_c(self):
        self.assertEqual([self.gpx._note_midi(self.notes[i],[]) for i in ('k1','k2')],[60,63])
        self.assertEqual((self.report[2]['pitchFixed'],self.report[2]['toneDefaulted']),(2,1))

    def test_unmapped_drums_become_stable_lane_codes(self):
        self.assertEqual(self.report[1]['drumLanes'],{1:[0,3],2:[1,6]})
        self.assertEqual([self.gpx._note_midi(self.notes[i],[]) for i in ('d2','d1')],[1,2])

    def test_gp6_grand_staff_gets_explicit_staves_only_when_columns_agree(self):
        def tracks_xml(columns):
            return ET.fromstring('<GPIF><Tracks><Track><Name>Piano</Name><Instrument ref="a-piano-gs"/></Track>'
                '<Track><Name>Bass</Name><Instrument ref="e-bass4"/></Track></Tracks>'
                f'<MasterBars><MasterBar><Bars>{" ".join(map(str,range(columns)))}</Bars></MasterBar></MasterBars><Notes/></GPIF>')
        for columns,expected in ((3,2),(2,0)):
            root=tracks_xml(columns);gpx=fake_converter(root);gpx._gpif_tracks=lambda r:[]
            report=p._gpif_note_repairs(gpx);gpx._load_gpif('song.gpx')
            self.assertEqual(len(root.findall('./Tracks/Track/Staves/Staff')),expected)
            self.assertEqual(report.get('grandStaves'),['Piano'] if expected else None)

    def test_diatonic_files_are_left_to_the_converter(self):
        root=gpif([],[],[('k1',prop('Octave','Number',4)+prop('Tone','Step',3),'')]);gpx=fake_converter(root)
        self.assertEqual(p._gpif_note_repairs(gpx),{});gpx._load_gpif('song.gpx')
        self.assertEqual(gpx._note_midi(root.find('Notes')[0],[]),'original')


if __name__=='__main__':
    unittest.main()
