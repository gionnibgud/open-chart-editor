"""Keys parts and notation, from the 2026-10-25 FeedBack review: hands from staves, the
authored keys type, no guitar fields on keys, no invented year/album, key signatures,
and lesson checks."""
import base64
import copy
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pack_io as p
import rplus_io
from test_pack_io import archive
from test_feedpak_contract import members, fixture, manifest, index


def keys_pack(*, notation=True, kind='piano', hands=False, extra=None):
    """A pack with one keys part (two notes) and, optionally, its notation with rh/lh staves."""
    entries = fixture(); doc = manifest(entries)
    notes = [{'t': 1.0, 's': 72 // 24, 'f': 72 % 24, 'm': 72, 'sus': 0.5}, {'t': 1.0, 's': 48 // 24, 'f': 48 % 24, 'm': 48, 'sus': 0.5}]
    if hands:
        notes[0]['hand'] = 'lh'      # authored hand that disagrees with the stave
    entries['keys/piano.json'] = json.dumps({'version': 1, 'name': 'Piano', 'notes': notes, 'chords': []}).encode()
    entry = {'id': 'piano', 'name': 'Piano', 'type': kind, 'file': 'keys/piano.json'}
    if notation:
        entries['keys/piano.notation.json'] = json.dumps({'version': 1, 'staves': [{'id': 'rh', 'clef': 'G2'}, {'id': 'lh', 'clef': 'F4'}],
            'measures': [{'idx': 1, 't': 0.0, 'ts': [4, 4], 'ks': -1, 'staves': {
                'rh': {'voices': [{'v': 1, 'beats': [{'t': 1.0, 'dur': 4, 'notes': [{'midi': 72}]}]}]},
                'lh': {'voices': [{'v': 1, 'beats': [{'t': 1.0, 'dur': 4, 'notes': [{'midi': 48}]}]}]}}}]}).encode()
        entry['notation'] = 'keys/piano.notation.json'
    doc['arrangements'] = doc['arrangements'] + [entry]
    if extra:
        extra(entries, doc)
    return index(entries, doc)


def piano(project):
    return next(a for a in project['arrangements'] if a['id'] == 'piano')


def test_hands_filled_from_staves_without_overwriting_authored_ones():
    arr = piano(p.load_feedpak(archive(keys_pack())))
    assert sorted((n['pitch'], n.get('hand')) for n in arr['notes']) == [(48, 'lh'), (72, 'rh')]
    arr = piano(p.load_feedpak(archive(keys_pack(hands=True))))
    assert sorted((n['pitch'], n.get('hand')) for n in arr['notes']) == [(48, 'lh'), (72, 'lh')], 'authored hand kept'


def test_authored_keys_type_and_no_guitar_fields_on_keys():
    project = p.load_feedpak(archive(keys_pack(notation=False)))
    out = members(p.save_feedpak(project))
    entry = next(e for e in manifest(out)['arrangements'] if e['id'] == 'piano')
    assert entry['type'] == 'piano'
    assert 'tuning' not in entry and 'capo' not in entry
    wire = json.loads(out[entry['file']])
    assert not {'tuning', 'capo', 'stringCount', 'basePitches'} & set(wire)
    # It still reopens as the same keys part.
    again = piano(p.load_feedpak(p.save_feedpak(p.load_feedpak(p.save_feedpak(project)))))
    assert sorted(n['pitch'] for n in again['notes']) == [48, 72]


def test_no_invented_year_or_album():
    def strip(entries, doc):
        doc.pop('year', None); doc.pop('album', None)
    project = p.load_feedpak(archive(keys_pack(extra=strip)))
    assert 'year' not in project and 'album' not in project
    doc = manifest(members(p.save_feedpak(project)))
    assert 'year' not in doc and 'album' not in doc
    project['year'] = 1999
    assert manifest(members(p.save_feedpak(project)))['year'] == 1999


def test_key_signatures_from_notation_rplus_and_names():
    assert piano(p.load_feedpak(archive(keys_pack())))['keySignature'] == {'fifths': -1, 'minor': False}
    for name, fifths, minor in [('F', -1, False), ('Bbm', -5, True), ('F#m', 3, True), ('C', 0, False), ('Am', 0, True), ('G#m', 5, True)]:
        signature = p.key_signature_from_name(name)
        assert signature == {'fifths': fifths, 'minor': minor}, name
        assert p.key_signature_name(signature) == name
    assert p.key_signature_from_name('H') is None


def test_beat_map_change_with_notes_kept_retains_notation():
    project = p.load_feedpak(archive(keys_pack()))
    project['beats'][1]['time'] += 0.01
    entry = next(e for e in manifest(members(p.save_feedpak(project)))['arrangements'] if e['id'] == 'piano')
    assert entry['notation'] == 'keys/piano.notation.json'
    assert p.save_notices(project) == []


def lesson_pack(lesson):
    def add(entries, doc):
        entries['lessons/scales.json'] = json.dumps(lesson).encode()
        doc['lessons'] = [{'id': 'scales', 'file': 'lessons/scales.json', 'title': 'Scales'}]
    return keys_pack(extra=add)


LESSON = {'version': 1, 'id': 'scales', 'title': 'Scales', 'input': {'source': 'midi'},
          'stages': [{'id': 's1', 'type': 'song', 'chart': {'arrangement': 'piano', 'bars': [1, 2]}}]}


def test_invalid_lesson_is_a_warning_and_kept():
    bad = {'version': 1, 'id': 'scales'}                 # misses title, input and stages
    entries = lesson_pack(bad); project = p.load_feedpak(archive(entries))
    assert any('lesson schema' in w for w in project['import_warnings'])
    assert members(p.save_feedpak(project))['lessons/scales.json'] == entries['lessons/scales.json']


def test_save_notices_for_lessons_and_detached_notation():
    project = p.load_feedpak(archive(lesson_pack(LESSON)))
    assert p.save_notices(project) == []
    arr = piano(project); arr['notes'][0]['pitch'] = 73; arr['notes'][0]['fret'] = 73 % 24
    arr['name'] = 'Grand piano'
    project['beats'][1]['time'] += 0.01
    notices = p.save_notices(project)
    assert any(n.startswith('Grand piano: its notes were edited') for n in notices)
    assert any('judges Grand piano, which loses its notation link' in n for n in notices)
    assert any('the beat map has changed' in n for n in notices)
    assert any('was written for "Piano", now named "Grand piano"' in n for n in notices)
    arr['hidden'] = True
    assert any('leaves out (deleted or hidden)' in n for n in p.save_notices(project))


def test_rplus_writer_uses_a_known_key():
    project = p.load_feedpak(archive(keys_pack()))
    arr = piano(project); arr['keySignature'] = {'fifths': -5, 'minor': True}
    xml = rplus_io.save_keyboard_xml(project, 'piano').decode()
    assert 'code="Key:Bbm"' in xml


def test_musicxml_key_signature():
    from probe_musicxml_archive import own_mxl
    xml, _ = own_mxl()
    assert b'<divisions>' in xml
    keyed = xml.replace(b'</divisions>', b'</divisions><key><fifths>-2</fifths><mode>minor</mode></key>', 1)
    arr = p.load_project(keyed, 'own.musicxml')['arrangements'][0]
    assert arr['keySignature'] == {'fifths': -2, 'minor': True}
    assert 'keySignature' not in p.load_project(xml, 'own.musicxml')['arrangements'][0]
