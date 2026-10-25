"""Editor on Fire writes Rocksmith 2014 XML as version 8; OCE opens it and keeps it as written."""
import sys
import unittest
from pathlib import Path
from xml.etree import ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pack_io as p


def eof(strings=6, version='8', arrangement='Lead'):
    tuning = ' '.join(f'string{i}="-2"' for i in range(9))
    return f"""<?xml version='1.0' encoding='UTF-8'?>
<song version="{version}">
  <title>Own EOF chart</title><arrangement>{arrangement}</arrangement><part>1</part><offset>0</offset><centOffset>0</centOffset>
  <songLength>8</songLength><startBeat>0</startBeat><averageTempo>120</averageTempo>
  <tuning {tuning} strings="{strings}"/><capo>0</capo><artistName>Original</artistName>
  <arrangementProperties pathLead="{int(arrangement=='Lead')}" pathRhythm="0" pathBass="{int(arrangement=='Bass')}"/>
  <ebeats count="2"><ebeat time="0" measure="1"/><ebeat time="0.5"/></ebeats>
  <phrases count="1"><phrase name="A" maxDifficulty="0"/></phrases>
  <phraseIterations count="1"><phraseIteration time="0" phraseId="0"/></phraseIterations>
  <chordTemplates count="1"><chordTemplate chordName="" displayName="" finger1="1" finger3="3" fret1="9" fret3="11"/></chordTemplates>
  <levels count="1"><level difficulty="0">
    <notes count="1"><note time="1.000" string="{strings - 1}" fret="3"/></notes>
    <chords count="1"><chord time="2.000" chordId="0"><chordNote string="1" fret="9"/><chordNote string="3" fret="11"/></chord></chords>
    <fretHandMutes count="0"/><anchors count="0"/><handShapes count="0"/>
  </level></levels>
</song>""".encode()


class EofVersion8Tests(unittest.TestCase):
    def test_opens_and_keeps_the_eof_format(self):
        project = p.load_project(eof(), 'own_RS2.xml')
        arr = project['arrangements'][0]
        self.assertEqual((arr['stringCount'], arr['tuning']), (6, [-2] * 6))
        self.assertEqual([(n['string'], n['fret']) for n in arr['notes']], [(5, 3)])
        self.assertEqual(arr['chord_templates'][0]['frets'], [-1, 9, -1, 11, -1, -1])
        out = ET.fromstring(p.save_xml(project, arr['id']))
        self.assertEqual(out.get('version'), '8', 'EOF output stays version 8, which DLC Builder reads')
        self.assertEqual(out.find('tuning').get('strings'), '6')
        self.assertEqual(out.find('tuning').get('string8'), '-2')
        self.assertIsNotNone(out.find('./levels/level/fretHandMutes'))
        arr['tuning'] = [0] * 6
        self.assertEqual(ET.fromstring(p.save_xml(project, arr['id'])).find('tuning').get('string0'), '0')

    def test_eof_string_count_is_used(self):
        seven = p.load_project(eof(strings=7), 'own_RS2.xml')['arrangements'][0]
        self.assertEqual((seven['stringCount'], len(seven['tuning']), seven['basePitches'][0]), (7, 7, 35))
        self.assertEqual([(n['string'], n['fret']) for n in seven['notes']], [(0, 3)], 'RS7X string 6 (low B) is the lowest editor string')
        bass = p.load_project(eof(strings=5, arrangement='Bass'), 'own_RS2.xml')['arrangements'][0]
        self.assertEqual((bass['type'], bass['stringCount'], bass['basePitches'][0]), ('bass', 5, 23))
        with self.assertRaisesRegex(p.ProjectError, '9 strings'):
            p.load_project(eof(strings=9), 'own_RS2.xml')

    def test_feedback_string_count_keeps_lowest_first_order(self):
        data = eof(strings=7).replace(b' strings="7"', b' stringCount="7"')
        seven = p.load_project(data, 'own.xml')
        arr = seven['arrangements'][0]
        self.assertEqual((arr['stringCount'], [(n['string'], n['fret']) for n in arr['notes']]), (7, [(6, 3)]))
        self.assertFalse(any('RS7X' in w for w in seven.get('import_warnings', [])))

    def test_other_versions_still_refused(self):
        with self.assertRaisesRegex(p.ProjectError, 'version 7, or version 8'):
            p.load_project(eof(version='19'), 'own.xml')


if __name__ == '__main__':
    unittest.main()
