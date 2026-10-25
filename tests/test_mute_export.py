"""Production mute output semantics; no browser, native compiler or hardware."""
import base64
import copy
import importlib.util
import io
import json
from pathlib import Path
import sys
import types
import wave
import zipfile
from xml.etree import ElementTree as ET

import pytest

ROOT = Path(__file__).resolve()
while not (ROOT / 'src/model.js').exists():
    ROOT = ROOT.parent
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT))
import pack_io as p


def note(techniques, *, identity='own-note', string=0, fret=7, time=2):
    return {
        'id': identity, 'time': time, 'string': string, 'fret': fret, 'sustain': .5,
        'techniques': {**techniques, 'ownTechnique': {'keep': [1, 2, 3]}},
        '_wire': {'pm': True, 'mt': True, 'fhm': True, 'ownWire': identity},
        '_xml': f'<note time="{time}" string="{string}" fret="{fret}" sustain="0.5" palmMute="1" mute="1" fretHandMute="1" ownNative="{identity}"/>',
        'opaque': {'exact': identity},
    }


def project():
    audio = io.BytesIO()
    with wave.open(audio, 'wb') as wav:
        wav.setparams((1, 2, 8000, 0, 'NONE', 'not compressed'))
        wav.writeframes(b'\0\0' * 800)
    return {
        'version': 1, 'title': 'Own mute projection checks', 'artist': 'Own author', 'duration': 12,
        'beats': [{'time': 0, 'measure': 1}, {'time': .5, 'measure': -1}], 'sections': [],
        'arrangements': [{'id': 'own-lead', 'name': 'Own Lead', 'type': 'guitar', 'stringCount': 6,
                          'tuning': [0] * 6, 'notes': [], 'chords': [], 'chord_templates': [],
                          'anchors': [], 'handshapes': []}],
        '_pack': {'manifest': {'stems': [{'id': 'full', 'file': 'audio/own.wav', 'default': True}]},
                  'entries': {'audio/own.wav': base64.b64encode(audio.getvalue()).decode(),
                              'sources/own.txt': base64.b64encode(b'Own untouched source archive member').decode()}},
    }


def exports(song):
    before = copy.deepcopy(song)
    source_json = json.dumps(song, sort_keys=True, allow_nan=False)
    xml = ET.fromstring(p.save_xml(song))
    feedpak = p.save_feedpak(song)
    loaded = p.load_feedpak(feedpak)
    assert song == before
    assert json.dumps(song, sort_keys=True, allow_nan=False) == source_json
    assert loaded['_pack']['entries']['sources/own.txt'] == song['_pack']['entries']['sources/own.txt']
    charts = []
    with zipfile.ZipFile(io.BytesIO(feedpak)) as archive:
        for path in archive.namelist():
            if path.startswith('arrangements/') and path.endswith('.json'):
                charts.append(json.loads(archive.read(path)))
    return xml, loaded, charts


def flags(element):
    return element.get('palmMute', '0') == '1', element.get('mute', element.get('fretHandMute', '0')) == '1'


def wire_notes(value):
    if isinstance(value, dict):
        if 'ownWire' in value:
            yield value
        for child in value.values():
            yield from wire_notes(child)
    elif isinstance(value, list):
        for child in value:
            yield from wire_notes(child)


@pytest.mark.parametrize('key,wire_key,expected_slot', [('palm_mute', 'pm', 0), ('fret_hand_mute', 'fhm', 1), ('mute', 'mt', 1)])
@pytest.mark.parametrize('value,enabled', [(False, False), (True, True), (-1, False), (0, False), (127, True), (.125, True), (-.25, False), (5, True)])
def test_real_note_exports_follow_authored_activity_without_mutating_source(key, wire_key, expected_slot, value, enabled):
    song = project()
    song['arrangements'][0]['notes'] = [note({key: value})]
    xml, loaded, charts = exports(song)
    emitted = xml.find('./levels/level/notes/note')
    expected = [False, False]
    expected[expected_slot] = enabled
    assert flags(emitted) == tuple(expected)
    assert 'fretHandMute' not in emitted.attrib
    assert emitted.get('ownNative') == 'own-note'
    assert emitted.get('fret') == '7'
    wire = list(wire_notes(charts))[0]
    assert wire[wire_key] is enabled
    for field in ('pm', 'mt', 'fhm'):
        assert field not in wire or isinstance(wire[field], bool)
    for field in {'pm', 'mt', 'fhm'} - {wire_key}:
        assert field not in wire
    reopened = loaded['arrangements'][0]['notes'][0]
    assert reopened['techniques'][key] is enabled
    assert reopened['_wire']['ownWire'] == 'own-note'


@pytest.mark.parametrize('techniques,expected', [({}, False), ({'mute': False}, False), ({'fret_hand_mute': False}, False), ({'fret_hand_mute': False, 'mute': False}, False), ({'fret_hand_mute': False, 'mute': 127}, True), ({'fret_hand_mute': .125, 'mute': -1}, True), ({'fret_hand_mute': -1, 'mute': 0}, False)])
def test_authored_alias_or_and_authoritative_absence_clear_stale_source_flags(techniques, expected):
    song = project()
    song['arrangements'][0]['notes'] = [note(techniques)]
    xml, loaded, charts = exports(song)
    emitted = xml.find('./levels/level/notes/note')
    assert flags(emitted) == (False, expected)
    assert 'fretHandMute' not in emitted.attrib
    reopened_xml = p.load_xml(ET.tostring(xml))['arrangements'][0]['notes'][0]['techniques']
    assert bool(reopened_xml.get('mute', False) or reopened_xml.get('fret_hand_mute', False)) is expected
    assert emitted.get('ownNative') == 'own-note'


def test_all_difficulties_and_mixed_chord_voices_emit_independent_binary_flags():
    song = project()
    arr = song['arrangements'][0]
    arr['chord_templates'] = [{'name': 'Own two voices', 'frets': [7, 9, -1, -1, -1, -1], 'fingers': [-1] * 6}]
    levels = []
    for difficulty, value in [(0, -1), (2, 127)]:
        chord = {'id': 'own-chord', 'time': 3, 'chord_id': 0,
                 '_wire': {'pm': True, 'mt': True, 'fhm': True, 'ownParentWire': 'keep'},
                 '_xml': '<chord time="3" chordId="0" palmMute="1" mute="1" fretHandMute="1" ownParentNative="keep"/>',
                 'notes': [note({'palm_mute': value, 'fret_hand_mute': 0, 'mute': -1}, identity=f'own-pm-{difficulty}', time=3),
                           note({'palm_mute': -1, 'fret_hand_mute': .125, 'mute': 0}, identity=f'own-fhm-{difficulty}', string=1, fret=9, time=3)]}
        levels.append({'difficulty': difficulty, 'notes': [note({'palm_mute': value}, identity=f'own-level-{difficulty}')],
                       'chords': [chord], 'anchors': [], 'handshapes': []})
    arr.update(activeDifficulty=0, difficulties=levels, phrases=[{'time': 0, 'name': 'Own complete phrase'}])
    for field in ('notes', 'chords', 'anchors', 'handshapes'):
        arr[field] = copy.deepcopy(levels[0][field])
    xml, loaded, charts = exports(song)
    assert [int(level.get('difficulty')) for level in xml.findall('./levels/level')] == [0, 2]
    for level in xml.findall('./levels/level'):
        positive = int(level.get('difficulty')) == 2
        assert flags(level.find('./notes/note')) == (positive, False)
        chord = level.find('./chords/chord')
        assert flags(chord) == (False, False)
        assert chord.get('ownParentNative') == 'keep'
        assert [flags(child) for child in chord.findall('chordNote')] == [(positive, False), (False, True)]
        assert [child.get('fret') for child in chord.findall('chordNote')] == ['7', '9']
    all_wire = list(wire_notes(charts))
    assert len(all_wire) >= 6
    for emitted in all_wire:
        for field in ('pm', 'mt', 'fhm'):
            assert field not in emitted or isinstance(emitted[field], bool)
    for level in loaded['arrangements'][0]['difficulties']:
        children = level['chords'][0]['notes']
        assert children[0]['techniques']['mute'] is False
        assert children[1]['techniques']['fret_hand_mute'] is True


@pytest.mark.parametrize('explicit,expected', [({'palm_mute': -1, 'fret_hand_mute': False}, (False, False)), ({'palm_mute': .125, 'fret_hand_mute': False, 'mute': 127}, (True, True))])
def test_implicit_parent_uses_same_authoritative_alias_projection_for_xml_and_feedpak(explicit, expected):
    song = project()
    arr = song['arrangements'][0]
    arr['chord_templates'] = [{'name': 'Own parent', 'frets': [7, 9, -1, -1, -1, -1], 'fingers': [-1] * 6}]
    parent = {'time': 3, 'chord_id': 0, 'pm': 127, 'mt': 127, 'fhm': 127, 'palmMute': 127, 'mute': 127,
              'techniques': explicit, 'notes': [],
              '_wire': {'pm': True, 'mt': True, 'fhm': True, 'ownParentWire': 'keep'},
              '_xml': '<chord time="3" chordId="0" palmMute="1" mute="1" fretHandMute="1" ownParentNative="keep"/>'}
    arr['chords'] = [parent]
    xml, loaded, charts = exports(song)
    assert flags(xml.find('./levels/level/chords/chord')) == expected
    assert xml.find('./levels/level/chords/chord').get('ownParentNative') == 'keep'
    children = loaded['arrangements'][0]['chords'][0]['notes']
    assert len(children) == 2
    for child in children:
        t = child['techniques']
        assert (t.get('palm_mute', False), bool(t.get('fret_hand_mute', False) or t.get('mute', False))) == expected
    assert loaded['arrangements'][0]['chords'][0]['_wire']['ownParentWire'] == 'keep'


def test_derived_parent_materialization_does_not_reinterpret_negative_flags_as_active():
    arrangement = {'stringCount': 6, 'chord_templates': [{'frets': [7, 9, -1, -1, -1, -1]}],
                   'chords': [{'time': 3, 'chord_id': 0, 'pm': -1, 'mt': -1, 'fhm': -1, 'notes': []}]}
    source = copy.deepcopy(arrangement)
    p._materialize_chords(arrangement)
    assert arrangement['chords'][0]['pm'] == source['chords'][0]['pm'] == -1
    for child in arrangement['chords'][0]['notes']:
        assert child['techniques']['palm_mute'] is False
        assert child['techniques']['fret_hand_mute'] is False
        assert child['techniques']['mute'] is False


@pytest.mark.parametrize('key', ['palm_mute', 'fret_hand_mute', 'mute'])
@pytest.mark.parametrize('value', ['false', None, [], {}, float('nan'), float('inf'), float('-inf')])
def test_non_boolean_non_finite_flag_values_refuse_instead_of_using_truthiness(key, value):
    with pytest.raises(p.ProjectError, match='boolean or finite number'):
        p._emit_note(note({key: value}))


def test_authored_contradictory_booleans_remain_contradictory_until_an_explicit_editor_command():
    song = project()
    song['arrangements'][0]['notes'] = [note({'palm_mute': True, 'fret_hand_mute': True, 'mute': True})]
    xml, loaded, charts = exports(song)
    assert flags(xml.find('./levels/level/notes/note')) == (True, True)
    wire = list(wire_notes(charts))[0]
    assert wire['pm'] is wire['mt'] is wire['fhm'] is True


def test_absent_canonical_techniques_do_not_resurrect_raw_wire_or_xml_flags():
    song = project()
    n = note({})
    n.pop('techniques')
    n['_wire'].update(pm=-1, mt=-1, fhm=0)
    song['arrangements'][0]['notes'] = [n]
    xml, loaded, charts = exports(song)
    assert flags(xml.find('./levels/level/notes/note')) == (False, False)
    assert 'fretHandMute' not in xml.find('./levels/level/notes/note').attrib
    wire = list(wire_notes(charts))[0]
    assert all(key not in wire for key in ('pm', 'mt', 'fhm'))
    assert loaded['arrangements'][0]['notes'][0]['techniques'] == {}


@pytest.mark.parametrize('value,expected', [(10 ** 400, True), (-10 ** 400, False)])
def test_arbitrary_precision_integer_flags_are_projected_without_float_overflow(value, expected):
    song = project()
    song['arrangements'][0]['notes'] = [note({'palm_mute': value, 'fret_hand_mute': value})]
    xml, loaded, charts = exports(song)
    assert flags(xml.find('./levels/level/notes/note')) == (expected, expected)
    wire = list(wire_notes(charts))[0]
    assert wire['pm'] is wire['fhm'] is expected
