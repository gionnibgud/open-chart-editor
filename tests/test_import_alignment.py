"""Real piano/drum sources aligned at an insertion point in a changing song map."""
import base64
import copy
import io
import json
from pathlib import Path
import sys
import unittest
import zipfile

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import pack_io as p
from test_pack_io import project, original_gp_binary


def original_musicxml():
    notes=''.join(f'<note><pitch><step>{step}</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>' for step in ('C','E','G'))
    hits=''.join(f'<note><unpitched><display-step>C</display-step><display-octave>5</display-octave></unpitched><duration>1</duration><instrument id="{instrument}"/><type>quarter</type></note>' for instrument in ('kick','snare','kick'))
    attributes='<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>'
    return ('<score-partwise version="4.0"><part-list><score-part id="p"><part-name>Own Piano</part-name></score-part>'
            '<score-part id="d"><part-name>Own Drums</part-name><midi-instrument id="kick"><midi-channel>10</midi-channel><midi-unpitched>37</midi-unpitched></midi-instrument>'
            '<midi-instrument id="snare"><midi-channel>10</midi-channel><midi-unpitched>39</midi-unpitched></midi-instrument></score-part></part-list>'
            '<part id="p"><measure number="1">'+attributes+'<direction><sound tempo="60" dynamics="50"/></direction>'+notes+'</measure></part>'
            '<part id="d"><measure number="1">'+attributes+'<direction><sound dynamics="80"/></direction>'+hits+'</measure></part></score-partwise>').encode()


def changing_backing():
    target=project();target['title']='Own existing backing';target['duration']=12
    target['beats']=[{'time':t,'measure':1 if i%4==0 else -1,'denominator':4} for i,t in enumerate([0,.5,1,2,3,3.5,4,5,6])]
    return target


class ImportAlignmentTests(unittest.TestCase):
    def test_actual_musicxml_all_piano_and_drums_follow_map_from_insertion(self):
        raw=original_musicxml();incoming=p.load_project(raw,'own-piano-drums.musicxml');target=changing_backing();before=copy.deepcopy(target);original=copy.deepcopy(incoming)
        self.assertEqual([a['type'] for a in incoming['arrangements']],['keys','drums'])
        result=p.merge_projects(target,incoming,align='beats',offset=1);merged=result['project'];added=merged['arrangements'][1:]
        self.assertEqual(target,before);self.assertEqual(incoming,original)
        for field in ('title','duration','beats','sections','_pack'):  # opaque imports extend only the output copy
            if field!='_pack':self.assertEqual(merged[field],before[field])
        self.assertEqual(merged['arrangements'][0],before['arrangements'][0])
        for part,source in zip(added,incoming['arrangements']):
            self.assertEqual([n['time'] for n in part['notes']],[1,2,3])
            if part['type']=='keys':
                self.assertEqual([n['sustain'] for n in part['notes']],[1,1,.5]);self.assertEqual([n['pitch'] for n in part['notes']],[60,64,67])
            else:self.assertEqual([n['piece'] for n in part['notes']],['kick','snare','kick']);self.assertEqual([n['sustain'] for n in part['notes']],[0,0,0])
            self.assertEqual([n.get('velocity') for n in part['notes']],[n.get('velocity') for n in source['notes']])
        snapshot=merged['_imports'][0]['snapshot'];self.assertEqual(json.loads(base64.b64decode(merged['_pack']['entries'][snapshot])),incoming)
        reopened=p.load_project(p.save_feedpak(merged),'own.feedpak');self.assertEqual([a['type'] for a in reopened['arrangements']],['guitar','keys','drums'])
        self.assertEqual(base64.b64decode(incoming['_import']['source']),raw)

    def test_destination_meter_pulses_are_compared_in_quarter_units(self):
        source=p.load_project(original_musicxml(),'own.musicxml');target=changing_backing()
        target['beats']=[{'time':t,'measure':1 if i==0 else -1,'denominator':4 if i<2 else 8} for i,t in enumerate([0,.5,1,1.25,1.5,1.75,2,2.25,2.5])]
        result=p.merge_projects(target,source,align='beats',offset=1)['project']
        self.assertEqual([n['time'] for n in result['arrangements'][1]['notes']],[1,1.5,2])
        self.assertEqual([n['sustain'] for n in result['arrangements'][1]['notes']],[.5,.5,.5])
        self.assertEqual(result['beats'],target['beats'])

    @unittest.skipIf(p.feedback_core() is None,'FeedBack Guitar Pro converters not available')
    def test_real_guitar_pro_piano_drums_and_all_other_paths_retained(self):
        raw=original_gp_binary(multiple=True);source=p.load_project(raw,'own.gp5');target=changing_backing()
        result=p.merge_projects(target,source,align='beats',offset=1)['project']
        self.assertEqual([a['type'] for a in result['arrangements'][1:]],['guitar','bass','keys','drums'])
        for part,original in zip(result['arrangements'][1:],source['arrangements']):
            self.assertEqual(len(part['notes']),len(original['notes']));self.assertEqual(part['notes'][0]['time'],1)
            self.assertEqual(part['notes'][0]['sustain'],0 if part['type']=='drums' else 1)
        self.assertEqual(result['arrangements'][-1]['notes'][0]['velocity'],95)
        self.assertEqual(base64.b64decode(source['_import']['source']),raw)

    def test_read_only_score_merge_is_refused_without_mutating_either_project(self):
        from test_feedpak_contract import notation_fixture
        from test_pack_io import archive
        source=p.load_feedpak(archive(notation_fixture()));target=changing_backing();before=copy.deepcopy(target);original=copy.deepcopy(source)
        with self.assertRaisesRegex(p.ProjectError,'notation-only'):p.merge_projects(target,source,align='beats',offset=1)
        self.assertEqual(source,original);self.assertEqual(target,before)

    def test_score_timing_takes_the_score_tempo_map(self):
        raw=original_musicxml();incoming=p.load_project(raw,'own-piano-drums.musicxml');target=changing_backing();target['arrangements'][0]['notes']=[];target['arrangements'][0]['chords']=[]
        result=p.merge_projects(target,incoming,align='score',offset=1);merged=result['project']
        self.assertEqual([b['time'] for b in merged['beats']],[round(b['time']+1,9) for b in incoming['beats']])
        self.assertEqual([n['time'] for n in merged['arrangements'][1]['notes']],[round(n['time']+1,9) for n in incoming['arrangements'][0]['notes']])
        self.assertFalse(any('check them against the new beat grid' in w for w in result['warnings']))
        busy=changing_backing();warned=p.merge_projects(busy,incoming,align='score')['warnings']
        self.assertTrue(any('check them against the new beat grid' in w for w in warned))
        mapless=copy.deepcopy(incoming);mapless['beats']=[]
        with self.assertRaisesRegex(p.ProjectError,'no tempo map'):p.merge_projects(target,mapless,align='score')


    def test_audio_timing_follows_a_measured_map(self):
        raw=original_musicxml();incoming=p.load_project(raw,'own-piano-drums.musicxml');target=changing_backing();target['arrangements'][0]['notes']=[];target['arrangements'][0]['chords']=[]
        # Score seconds 0..4 map to audio 1..9 (half tempo), with one backwards point ignored.
        audio_map={'chart_t':[0,2,3,4],'audio_t':[1,5,4.9,9]}
        result=p.merge_projects(target,incoming,align='audio',audio_map=audio_map)['project']
        self.assertEqual([n['time'] for n in result['arrangements'][1]['notes']],[1+2*n['time'] for n in incoming['arrangements'][0]['notes']])
        self.assertEqual(result['beats'][0]['time'],1);self.assertEqual(len(result['beats']),len(incoming['beats']))
        with self.assertRaisesRegex(p.ProjectError,'measured map'):p.merge_projects(target,incoming,align='audio',audio_map=None)


if __name__=='__main__':unittest.main()
