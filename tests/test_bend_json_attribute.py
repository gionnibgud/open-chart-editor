"""FeedBack GP-converter bend curves: JSON bendValues attribute on import and export."""
import json
from pathlib import Path
import sys
import unittest
import xml.etree.ElementTree as ET

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import pack_io as p


def note_xml(attribute,child=''):
    return ET.fromstring(f'<note time="2" string="1" fret="7" sustain="1" bend="1" bendIntent="1" bendValues=\'{attribute}\'>{child}</note>')


class BendJsonAttributeTests(unittest.TestCase):
    def test_json_curve_becomes_relative_points_sorted_by_time(self):
        note=p._xml_note(note_xml('[{"t":0.5,"v":1},{"t":0,"v":0},{"t":0.25,"v":true}]'),0)
        self.assertEqual(note['techniques']['bend_values'],[{'t':0.0,'v':0.0},{'t':0.5,'v':1.0}])

    def test_malformed_curve_is_omitted_but_kept_in_raw_xml_and_export(self):
        note=p._xml_note(note_xml('not json'),0)
        self.assertNotIn('bend_values',note['techniques'])
        self.assertEqual(p._emit_note(note).get('bendValues'),'not json')

    def test_child_element_still_wins(self):
        child='<bendValues count="1"><bendValue time="2.25" step="2"/></bendValues>'
        note=p._xml_note(note_xml('[{"t":0.5,"v":1}]',child),0)
        self.assertEqual(note['techniques']['bend_values'],[{'t':0.25,'v':2.0}])

    def test_export_keeps_attribute_in_step_with_edits(self):
        note=p._xml_note(note_xml('[{"t":0,"v":0},{"t":0.5,"v":1}]'),0)
        note['techniques']['bend_values']=[{'t':0,'v':0},{'t':0.75,'v':2}]
        el=p._emit_note(note)
        self.assertEqual(json.loads(el.get('bendValues')),[{'t':0,'v':0},{'t':0.75,'v':2}])
        self.assertEqual([b.get('step') for b in el.find('bendValues')],['0','2'])
        del note['techniques']['bend_values']
        self.assertNotIn('bendValues',p._emit_note(note).attrib)


if __name__=='__main__':
    unittest.main()
