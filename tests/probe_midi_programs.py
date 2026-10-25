"""Read-only counterexamples for MIDI program intent currently retained only as raw source."""
import base64
import json
from pathlib import Path
import struct
import subprocess
import unittest
import pack_io

ROOT=Path(__file__).resolve().parents[1]

def vlq(number):
    values=[number&127];number>>=7
    while number:values.insert(0,128|(number&127));number>>=7
    return bytes(values)

def track(events):
    body=b''.join(vlq(delta)+event for delta,event in events)+b'\0\xff\x2f\0'
    return b'MTrk'+struct.pack('>I',len(body))+body

def own_midi(format=0):
    programs=[(0,b'\xc2\x49'),(480,b'\xc2\x28')]
    notes=[(0,b'\x92\x3c\x64'),(480,b'\x82\x3c\0'),(0,b'\x92\x40\x64'),(480,b'\x82\x40\0')]
    tracks=[track([(0,b'\xc2\x49')]+notes[:2]+[(0,b'\xc2\x28')]+notes[2:])] if format==0 else [track(programs),track(notes)]
    return b'MThd'+struct.pack('>IHHH',6,format,len(tracks),480)+b''.join(tracks)

class MidiProgramCounterexampleTests(unittest.TestCase):
    def test_actual_import_discards_static_and_midtrack_programs_from_editable_intent(self):
        for format in [0,1]:
            data=own_midi(format);project=pack_io.load_project(data,'own-programs.mid');arr=project['arrangements'][0]
            self.assertEqual(base64.b64decode(project['_import']['source']),data);self.assertEqual([n['time'] for n in arr['notes']],[0,.5]);self.assertEqual(arr['sourceChannel'],2);self.assertEqual(arr['sourceTrack'],format)
            self.assertNotIn('guideVoice',arr);self.assertNotIn('tones',arr);self.assertNotIn('rigLibrary',project);self.assertTrue(any('program' in w for w in project['import_warnings']))

    def test_actual_production_resolver_defaults_both_program_regions_to_piano(self):
        project=pack_io.load_project(own_midi(),'own-programs.mid')
        script="import {resolveGuideVoice} from './src/guide-voice.js';let raw='';for await(const p of process.stdin)raw+=p;const p=JSON.parse(raw);console.log(JSON.stringify([0,.5].map(time=>{const v=resolveGuideVoice(p.arrangements[0],{rigLibrary:p.rigLibrary,time});return {time,source:v.source,family:v.family,program:v.program}})))"
        result=subprocess.run(['node','--input-type=module','-e',script],input=json.dumps(project),text=True,cwd=ROOT,capture_output=True,check=True)
        self.assertEqual(json.loads(result.stdout),[{'time':0,'source':'editor-default','family':'piano','program':0},{'time':.5,'source':'editor-default','family':'piano','program':0}])

if __name__=='__main__':unittest.main()
