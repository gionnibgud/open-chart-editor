"""Original notation-reference safety cases, independent of score heuristics."""
import copy
import json
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import notation_state as ns

def project():
    return {'title':'Own score','duration':8,'beats':[{'time':0,'measure':1},{'time':.5,'measure':-1}],
            'tempos':[{'t':0,'bpm':120}],'time_signatures':[{'t':0,'numerator':4,'denominator':4}],
            'arrangements':[{'id':'keys','name':'Piano','type':'keys','stringCount':6,'tuning':[0]*6,'basePitches':[],
              'capo':0,'notes':[{'id':'first','time':1,'string':2,'fret':12,'pitch':60,'sustain':.7,'hand':'rh','velocity':90,'techniques':{}}],
              'chords':[],'chord_templates':[],'_entry':{'id':'keys','notation':'source-score.json','file':'keys.json'}}],
            '_pack':{'entries':{'source-score.json':'EXACT opaque source bytes','unrelated.bin':'OTHER original bytes'}}}

class NotationStateTests(unittest.TestCase):
    def stamped(self):
        p=project();ns.stamp_notation_baselines(p);return p,p['arrangements'][0]

    def test_fresh_source_adds_only_private_state_and_retains_opaque_bytes(self):
        p=project();before=copy.deepcopy(p);ns.stamp_notation_baselines(p)
        state=p['arrangements'][0].pop(ns.STATE_KEY);self.assertEqual(p,before)
        p['arrangements'][0][ns.STATE_KEY]=state
        decision=ns.notation_reference_decision(p,p['arrangements'][0]);self.assertTrue(decision['retain']);self.assertIsNone(decision['warning'])

    def test_pitch_time_sustain_hand_velocity_and_fingering_edits_invalidate(self):
        edits=[lambda n:n.update(pitch=61),lambda n:n.update(time=1.000001),lambda n:n.update(sustain=.71),
               lambda n:n.update(hand='lh'),lambda n:n.update(velocity=91),lambda n:n['techniques'].update(left_hand=0)]
        for edit in edits:
            with self.subTest(edit=edit):
                p,a=self.stamped();edit(a['notes'][0]);decision=ns.notation_reference_decision(p,a)
                self.assertFalse(decision['retain']);self.assertEqual(decision['reason'],'chart-changed');self.assertIn('remains in the archive',decision['warning'])
                self.assertEqual(p['_pack']['entries']['source-score.json'],'EXACT opaque source bytes')

    def test_absolute_pitch_controls_canonical_keys_export_even_with_legacy_coordinate_change(self):
        p,a=self.stamped();a['notes'][0].update(string=0,fret=0)
        self.assertTrue(ns.notation_reference_decision(p,a)['retain'])
        a['notes'][0]['pitch']=127
        self.assertFalse(ns.notation_reference_decision(p,a)['retain'])

    def test_grid_changes_with_notes_kept_in_place_retain_the_notation(self):
        # The notation's times are seconds; notes that did not move still match it.
        edits=[lambda p:p['beats'][1].update(time=.51),lambda p:p['beats'][0].update(measure=2),
               lambda p:p['tempos'][0].update(bpm=121),lambda p:p['time_signatures'][0].update(denominator=8),
               lambda p:p['beats'][0].update(futureMeterGrouping=[2,2]),lambda p:p.update(duration=9)]
        for edit in edits:
            p,a=self.stamped();edit(p);decision=ns.notation_reference_decision(p,a)
            self.assertEqual(decision['reason'],'grid-changed-notes-kept');self.assertTrue(decision['retain']);self.assertNotIn('retime',decision)

    def test_notes_moved_with_the_beat_map_retime_the_notation(self):
        p,a=self.stamped()
        p['beats'][1]['time']=1.0                      # half tempo: every beat position twice as late
        note=a['notes'][0];note.update(time=2.0,sustain=1.4)
        decision=ns.notation_reference_decision(p,a)
        self.assertEqual(decision['reason'],'grid-changed-notes-moved');self.assertTrue(decision['retain'])
        warp=ns.beat_warp(decision['retime']['from'],decision['retime']['to'])
        doc={'measures':[{'idx':1,'t':0.5,'tempo':120,'staves':{'rh':{'voices':[{'beats':[{'t':1.0,'dur':4}]}]}}},{'idx':2,'t':2.5}]}
        ns.retime_notation(doc,warp)
        self.assertEqual([m['t'] for m in doc['measures']],[1.0,5.0])
        self.assertEqual(doc['measures'][0]['staves']['rh']['voices'][0]['beats'][0]['t'],2.0)
        self.assertEqual(doc['measures'][0]['tempo'],60,'written tempo halves with the beats')
        note['time']=2.1                                # a real edit on top of the move
        self.assertEqual(ns.notation_reference_decision(p,a)['reason'],'chart-changed')

    def test_ids_metadata_guitar_only_techniques_and_order_do_not_invalidate(self):
        p,a=self.stamped();a['notes'].append(copy.deepcopy(a['notes'][0]));ns.stamp_notation_baselines(p)
        p.update(title='Renamed',artist='Own artist');a['name']='Renamed piano'
        a['notes'].reverse();a['notes'][0]['id']='new-ui-id';a['notes'][0]['techniques']['palm_mute']=True
        a['chord_templates'].append({'name':'Unused library item','frets':[0,1]})
        self.assertTrue(ns.notation_reference_decision(p,a)['retain'])

    def test_duplicate_unison_counts_are_preserved(self):
        p,a=self.stamped();a['notes'].append(copy.deepcopy(a['notes'][0]))
        self.assertFalse(ns.notation_reference_decision(p,a)['retain'])

    def test_missing_baseline_and_changed_reference_are_explicitly_unverified(self):
        p=project();a=p['arrangements'][0];decision=ns.notation_reference_decision(p,a)
        self.assertEqual(decision['reason'],'unverified-source');self.assertFalse(decision['retain'])
        ns.stamp_notation_baselines(p);a['_entry']['notation']='another-score.json'
        self.assertEqual(ns.notation_reference_decision(p,a)['reason'],'unverified-source')

    def test_undo_to_original_and_private_json_roundtrip_restore_reference_eligibility(self):
        p,a=self.stamped();before=copy.deepcopy(p);a['notes'][0]['pitch']=72
        self.assertFalse(ns.notation_reference_decision(p,a)['retain'])
        restored=json.loads(json.dumps(before));self.assertTrue(ns.notation_reference_decision(restored,restored['arrangements'][0])['retain'])

    def test_highest_exported_level_includes_live_edits_and_ignores_lower_only_edits(self):
        p=project();a=p['arrangements'][0];high=copy.deepcopy(a['notes']);low=[{**copy.deepcopy(high[0]),'pitch':48}]
        a.update(difficulties=[{'difficulty':3,'notes':high,'chords':[]},{'difficulty':0,'notes':low,'chords':[]}],activeDifficulty=3)
        ns.stamp_notation_baselines(p)
        a['activeDifficulty']=0;a['notes']=copy.deepcopy(low);a['notes'][0]['pitch']=49
        self.assertTrue(ns.notation_reference_decision(p,a)['retain'],'Lower-only edit must not discard the unchanged top-level score')
        a['difficulties'][0]['notes'][0]['pitch']=61
        self.assertFalse(ns.notation_reference_decision(p,a)['retain'],'Stored highest level changed while a lower level was visible')
        a['difficulties'][0]['notes'][0]['pitch']=60;a['activeDifficulty']=3;a['notes']=copy.deepcopy(high);a['notes'][0]['pitch']=62
        self.assertFalse(ns.notation_reference_decision(p,a)['retain'],'Live highest edits must override its stored snapshot')

    def test_projection_matches_current_writer_snapshot_semantics_without_mutation(self):
        import pack_io
        p=project();a=p['arrangements'][0];a.update(difficulties=[{'difficulty':0,'notes':[]},{'difficulty':4,'notes':copy.deepcopy(a['notes'])}],activeDifficulty=0)
        before=copy.deepcopy(a);exported=pack_io._snapshot_arrangement(a)
        exported.update({key:copy.deepcopy(exported['difficulties'][-1].get(key,[]))for key in pack_io.LEVEL_FIELDS})
        self.assertEqual(ns.content_fingerprint(a),ns.content_fingerprint(exported,already_exported=True));self.assertEqual(a,before)

    def test_chord_child_onset_uses_exported_parent_attack_and_note_order_is_immaterial(self):
        p,a=self.stamped();a['type']='guitar';a['notes'][0].pop('pitch');a['notes'][0].pop('hand');note=copy.deepcopy(a['notes'][0])
        original=ns.content_fingerprint(a);a['notes']=[];note['time']=99;a['chords']=[{'time':1,'chord_id':0,'notes':[note]}]
        self.assertEqual(original,ns.content_fingerprint(a))

    def test_export_warning_collection_skips_scratch_and_leaves_source_references_intact(self):
        p,a=self.stamped();a['notes'][0]['pitch']=61;scratch=copy.deepcopy(a);scratch.update(id='scratch',editorOnly=True);p['arrangements'].append(scratch)
        warnings=ns.notation_export_warnings(p);self.assertEqual(len(warnings),1);self.assertEqual(warnings[0]['arrangement'],'keys');self.assertIn('source-score.json',warnings[0]['warning'])
        self.assertEqual(a['_entry']['notation'],'source-score.json');self.assertEqual(p['_pack']['entries']['unrelated.bin'],'OTHER original bytes')

    def test_numeric_json_roundtrip_does_not_invalidate_and_nonfinite_data_is_rejected(self):
        p,a=self.stamped();p['duration']=8.0;p['beats'][0]['time']=0.0
        self.assertTrue(ns.notation_reference_decision(p,a)['retain'])
        a['notes'][0]['time']=float('nan')
        with self.assertRaisesRegex(ValueError,'finite'):ns.notation_reference_decision(p,a)

if __name__=='__main__':unittest.main()
