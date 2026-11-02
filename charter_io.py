"""Read-only parser for Lordszynencja/Charter project files (project.rscp, or any *.rscp).

Charter's native format is XML (XStream), unlike Editor on Fire's binary notes.eof. Several
of its classes use custom XStream converters rather than plain reflection-based serialization,
so the exact attribute shapes here are read from those converters' own marshal/unmarshal code
(github.com/Lordszynencja/Charter, src/main/java/log/charter/io/rsc/xml/converters), not
guessed from the plain Java field layout. Not yet validated against a real .rscp file - only
against Charter's own source and a hand-built synthetic fixture.

Positions are "beatId fraction" (a beat index plus a fractional offset within that beat),
converted to absolute seconds by interpolating against the project's own beat grid (which is
itself stored as absolute milliseconds), the same way Charter's own FractionalPosition.
getPosition() does.
"""
from __future__ import annotations
from fractions import Fraction
from xml.etree import ElementTree as ET

RSCP_VERSION = 3

MUTE_TECHNIQUE = {'FULL': 'mute', 'PALM': 'palm_mute'}
HOPO_TECHNIQUE = {'HAMMER_ON': 'hammer_on', 'PULL_OFF': 'pull_off', 'TAP': 'tap'}
HARMONIC_TECHNIQUE = {'NORMAL': 'harmonic', 'PINCH': 'harmonic_pinch'}
BASS_PICKING_TECHNIQUE = {'POP': 'pluck', 'SLAP': 'slap'}

# Tuning.TuningType's own reference offsets (9 slots: low string .. high string on an
# 8-string instrument), ground-truthed from Tuning.java. Only CUSTOM carries an explicit
# per-string tuningValues attribute; every other type is looked up here.
TUNING_TYPES = {
    'HIGH_F_SHARP_STANDARD': [2] * 9, 'HIGH_F_STANDARD': [1] * 9, 'E_STANDARD': [0] * 9,
    'E_DROP_D': [0, 0, 0, -2, 0, 0, 0, 0, 0], 'E_DROP_C': [0, 0, 0, -4, 0, 0, 0, 0, 0],
    'E_FLAT_STANDARD': [-1] * 9, 'E_FLAT_DROP_D_FLAT': [-1, -1, -1, -3, -1, -1, -1, -1, -1],
    'D_STANDARD': [-2] * 9, 'D_DROP_C': [-2, -2, -2, -4, -2, -2, -2, -2, -2],
    'D_FLAT_STANDARD': [-3] * 9, 'D_FLAT_DROP_B': [-3, -3, -3, -5, -3, -3, -3, -3, -3],
    'C_STANDARD': [-4] * 9, 'C_DROP_B_FLAT': [-4, -4, -4, -6, -4, -4, -4, -4, -4],
    'B_STANDARD': [-5] * 9, 'B_DROP_A': [-5, -5, -5, -7, -5, -5, -5, -5, -5],
    'B_FLAT_STANDARD': [-6] * 9, 'B_FLAT_DROP_A_FLAT': [-6, -6, -6, -8, -6, -6, -6, -6, -6],
    'A_STANDARD': [-7] * 9, 'A_DROP_G': [-7, -7, -7, -9, -7, -7, -7, -7, -7],
    'A_FLAT_STANDARD': [-8] * 9, 'G_STANDARD': [-9] * 9, 'G_FLAT_STANDARD': [-10] * 9,
    'LOW_F_STANDARD': [-11] * 9,
    'OPEN_D': [-2, -2, -2, -2, 0, 0, -1, -2, -2], 'OPEN_E': [0, 0, 0, 0, 2, 2, 1, 0, 0],
    'OPEN_G': [-2, -2, -2, -2, -2, 0, 0, 0, -2], 'OPEN_A': [0, 0, 0, 0, 0, 2, 2, 2, 0],
    'DADGAD': [-2, -2, -2, -2, 0, 0, 0, -2, -2], 'CUSTOM': [0] * 9,
}
# Renamed TuningType values Charter's own TuningConverter.readTuningType() remaps on load.
TUNING_TYPE_ALIASES = {
    'F_STANDARD': 'LOW_F_STANDARD', 'C_SHARP_STANDARD': 'D_FLAT_STANDARD',
    'C_SHARP_DROP_B': 'D_FLAT_DROP_B', 'A_SHARP_STANDARD': 'B_FLAT_STANDARD',
    'G_SHARP_STANDARD': 'A_FLAT_STANDARD', 'F_SHARP_STANDARD': 'G_FLAT_STANDARD',
    'B_FLAT_DROP_G': 'B_FLAT_DROP_A_FLAT', 'A_DROP_G_FLAT': 'A_DROP_G',
}


class CharterError(ValueError):
    pass


def _tuning_values(base, strings):
    """Port of Tuning.getTuningValues/getFullTuning: stretches/windows the 9-slot reference
    tuning to the requested string count, repeating the last value for extra low strings."""
    full = [base[-1]] * 9
    if len(base) > 9:
        full = base[len(base) - 9:]
    else:
        offset = 9 - max(6, len(base))
        full[offset:offset + len(base)] = base
    offset = 9 - max(6, strings)
    if offset >= 0:
        return full[offset:offset + strings]
    result = [base[-1]] * (-offset) + full
    return result[:strings]


def _fraction(value):
    numerator, denominator = value.split('/')
    return Fraction(int(numerator), int(denominator))


def _position(value):
    """'beatId fraction' -> (beatId, Fraction), matching FractionalPosition.fromString."""
    if value is None:
        return None
    beat_id, fraction = value.split(' ', 1)
    return int(beat_id), _fraction(fraction)


def _seconds(position, beats_ms):
    """FractionalPosition.getPosition(beats): interpolates between two beats' absolute ms
    positions, extrapolating past the last beat using the final beat interval."""
    beat_id, fraction = position
    if beat_id + 1 < len(beats_ms):
        start, end = beats_ms[beat_id], beats_ms[beat_id + 1]
    else:
        used = max(0, len(beats_ms) - 2)
        start, end = beats_ms[used], beats_ms[used + 1]
        length = end - start
        start, end = start + length * (beat_id - used), start + length * (beat_id - used) + length
    return round((start + float(fraction) * (end - start)) / 1000.0, 9)


def _bool(element, name):
    return element.get(name) == 'T'


def _parse_bend_values(value, beats_ms):
    if not value:
        return []
    points = []
    for item in value.split(';'):
        position_str, amount = item.rsplit('=', 1)
        points.append({'t': _seconds(_position(position_str), beats_ms), 'v': float(amount)})
    return points


def _note_techniques(element, beats_ms):
    techniques = {}
    if _bool(element, 'accent'):
        techniques['accent'] = True
    if _bool(element, 'crazy'):
        techniques['ignore'] = True
    bass_picking = element.get('bassPicking')
    if bass_picking in BASS_PICKING_TECHNIQUE:
        techniques[BASS_PICKING_TECHNIQUE[bass_picking]] = True
    mute = element.get('mute')
    if mute in MUTE_TECHNIQUE:
        techniques[MUTE_TECHNIQUE[mute]] = True
    hopo = element.get('hopo')
    if hopo in HOPO_TECHNIQUE:
        techniques[HOPO_TECHNIQUE[hopo]] = True
    harmonic = element.get('harmonic')
    if harmonic in HARMONIC_TECHNIQUE:
        techniques[HARMONIC_TECHNIQUE[harmonic]] = True
    if _bool(element, 'vibrato'):
        techniques['vibrato'] = True
    if _bool(element, 'tremolo'):
        techniques['tremolo'] = True
    if _bool(element, 'linkNext'):
        techniques['link_next'] = True
    slide_to = element.get('slideTo')
    if slide_to is not None:
        if _bool(element, 'unpitchedSlide'):
            techniques['slide_unpitch_to'] = int(slide_to)
        else:
            techniques['slide_to'] = int(slide_to)
    bend_values = _parse_bend_values(element.get('bendValues'), beats_ms)
    if bend_values:
        techniques['bend_values'] = bend_values
        techniques['bend'] = max(point['v'] for point in bend_values)
    return techniques


def _parse_note(element, beats_ms):
    position = _seconds(_position(element.get('p')), beats_ms)
    end = _seconds(_position(element.get('ep')), beats_ms)
    return {'id': 'n', 'time': position, 'string': int(element.get('string')), 'fret': int(element.get('fret')),
            'sustain': max(0.0, round(end - position, 9)), 'techniques': _note_techniques(element, beats_ms)}


def _parse_chord(element, beats_ms):
    position = _seconds(_position(element.get('p')), beats_ms)
    template_id = int(element.get('templateId'))
    techniques = {}
    if _bool(element, 'accent'):
        techniques['accent'] = True
    if _bool(element, 'crazy'):
        techniques['ignore'] = True
    notes = []
    for child in element.findall('chordNote'):
        string = int(child.get('string'))
        end = _seconds(_position(child.get('ep')), beats_ms)
        note_techniques = dict(techniques)
        note_techniques.update(_note_techniques(child, beats_ms))
        notes.append({'id': f'chord-string-{string}', 'time': position, 'string': string, 'fret': None,
                      'sustain': max(0.0, round(end - position, 9)), 'techniques': note_techniques})
    return {'id': 'c', 'time': position, 'chord_id': template_id, 'notes': notes,
            'highDensity': _bool(element, 'splitIntoNotes')}


def _parse_chord_template(element):
    def read_map(attribute):
        value = element.get(attribute)
        result = {}
        if value:
            for pair in value.split(','):
                key, val = pair.split('=')
                result[int(key)] = int(val)
        return result
    return {'name': element.get('chordName') or '', 'arpeggio': _bool(element, 'arpeggio'),
            'frets': read_map('frets'), 'fingers': read_map('fingers')}


def _tuning_for(tuning_element):
    tuning_type = tuning_element.get('type')
    tuning_type = TUNING_TYPE_ALIASES.get(tuning_type, tuning_type)
    strings = int(tuning_element.get('strings'))
    if tuning_type == 'CUSTOM':
        raw = tuning_element.get('tuningValues')
        values = [int(v) for v in raw.split(',')] if raw else [0] * strings
        return _tuning_values(values, strings), strings
    base = TUNING_TYPES.get(tuning_type)
    if base is None:
        raise CharterError(f'Unknown Charter tuning type: {tuning_type}')
    return _tuning_values(base, strings), strings


def parse_charter(data):
    try:
        root = ET.fromstring(data)
    except ET.ParseError as exc:
        raise CharterError(f'Cannot read Charter project: {exc}') from exc
    if root.tag != 'project':
        raise CharterError('Not a Charter project file (expected a <project> root element)')
    version_text = root.findtext('chartFormatVersion')
    version = int(version_text) if version_text and version_text.isdigit() else 1
    if version != RSCP_VERSION:
        raise CharterError(f'Unsupported Charter project format version {version}; only {RSCP_VERSION} is supported')

    beats_ms = [float(b.get('t')) for b in root.findall('./beats/beat2')]
    if len(beats_ms) < 2:
        raise CharterError('Charter project has no usable beat grid')
    beats = []
    measure = 0
    for element in root.findall('./beats/beat2'):
        sig = element.get('sig', '4/4').split('/')
        first = _bool(element, 'bar')
        if first:
            measure += 1
        beats.append({'time': round(float(element.get('t')) / 1000.0, 9), 'measure': measure if first else -1,
                      'numerator': int(sig[0]), 'denominator': int(sig[1]), 'meterStart': len(beats) == 0})

    stems = [{'name': s.get('name'), 'path': s.get('path')} for s in root.findall('./stems/stem')]

    arrangements = []
    for element in root.findall('./arrangements/arrangement'):
        tuning, strings = _tuning_for(element.find('tuning'))
        chord_templates = [_parse_chord_template(t) for t in element.findall('./chordTemplates/chordTemplate')]
        level = element.find('./levels/level')
        notes, chords = [], []
        if level is not None:
            for sound in level.findall('./sounds/sound'):
                if sound.get('chord') == 'T':
                    chords.append(_parse_chord(sound, beats_ms))
                else:
                    notes.append(_parse_note(sound, beats_ms))
        anchors = []
        if level is not None:
            for anchor in level.findall('./anchors/anchor'):
                anchors.append({'time': _seconds(_position(anchor.get('p')), beats_ms), 'fret': int(anchor.get('fret')),
                                'width': int(anchor.get('width', 4))})
        handshapes = []
        if level is not None:
            for shape in level.findall('./handShapes/handShape'):
                template_id = shape.get('templateId')
                if template_id is None:
                    continue
                handshapes.append({'chord_id': int(template_id),
                                   'start_time': _seconds(_position(shape.get('p')), beats_ms),
                                   'end_time': _seconds(_position(shape.get('ep')), beats_ms)})
        tone_changes = [{'time': _seconds(_position(t.get('p')), beats_ms), 'name': t.get('tone')}
                         for t in element.findall('./toneChanges/toneChange') if t.get('tone')]
        sections = []
        for point in element.findall('./eventPoints/eventPoint'):
            section = point.get('section')
            if section:
                sections.append({'name': section, 'time': _seconds(_position(point.get('p')), beats_ms)})
        arrangements.append({
            'arrangement_type': element.get('type', 'Lead'), 'tuning': tuning, 'string_count': strings,
            'capo': int(float(element.get('capo', '0'))), 'starting_tone': element.get('startingTone'),
            'chord_templates': chord_templates, 'notes': notes, 'chords': chords, 'anchors': anchors,
            'handshapes': handshapes, 'tone_changes': tone_changes, 'sections': sections,
        })
    if not arrangements:
        raise CharterError('Charter project has no arrangements')

    return {
        'title': root.findtext('title') or 'Untitled', 'artist': root.findtext('artistName') or '',
        'album': root.findtext('albumName') or '', 'year': root.findtext('albumYear'),
        'music_file_name': root.findtext('musicFileName'), 'stems': stems,
        'beats': beats, 'arrangements': arrangements,
    }


_ARRANGEMENT_KIND = {'Bass': 'bass', 'Lead': 'guitar', 'Rhythm': 'guitar', 'Combo': 'guitar'}


def _dense_template(template, string_count):
    frets = [-1] * string_count
    fingers = [-1] * string_count
    for string, fret in template['frets'].items():
        if 0 <= string < string_count:
            frets[string] = fret
    for string, finger in template['fingers'].items():
        if 0 <= string < string_count:
            fingers[string] = finger
    return {'frets': frets, 'fingers': fingers, 'displayName': template['name'] or f'Chord {len(frets)}str',
            'arp': template['arpeggio']}


def _charter_arrangement(raw, index):
    string_count = raw['string_count']
    kind = _ARRANGEMENT_KIND.get(raw['arrangement_type'], 'guitar')
    templates = [_dense_template(t, string_count) for t in raw['chord_templates']]
    chords = []
    for chord in raw['chords']:
        notes = []
        template = templates[chord['chord_id']] if 0 <= chord['chord_id'] < len(templates) else None
        for note in chord['notes']:
            fret = template['frets'][note['string']] if template and 0 <= note['string'] < string_count else 0
            notes.append({**note, 'fret': fret})
        chords.append({'id': f"c{len(chords)}", 'time': chord['time'], 'chord_id': chord['chord_id'],
                       'notes': notes, 'highDensity': chord['highDensity']})
    notes = [{**note, 'id': f'n{i}'} for i, note in enumerate(raw['notes'])]
    arr = {'id': f'charter-arr-{index}', 'name': raw['arrangement_type'], 'type': kind, 'tuning': raw['tuning'],
           'stringCount': string_count, 'capo': raw['capo'], 'notes': notes, 'chords': chords,
           'chord_templates': templates, 'anchors': raw['anchors'], 'handshapes': raw['handshapes']}
    if raw['tone_changes']:
        arr['tones'] = {'base': raw['starting_tone'] or raw['tone_changes'][0]['name'],
                        'changes': raw['tone_changes'], 'definitions': {}}
    elif raw['starting_tone']:
        arr['tones'] = {'base': raw['starting_tone'], 'changes': [], 'definitions': {}}
    return arr, raw['sections']


def charter_project(parsed, warnings=None):
    """Build an OCE project dict (minus _pack/audio, which the caller attaches)."""
    if warnings is None:
        warnings = []
    arrangements = []
    sections = []
    for index, raw in enumerate(parsed['arrangements']):
        arr, arr_sections = _charter_arrangement(raw, index)
        arrangements.append(arr)
        sections.extend(arr_sections)
    sections.sort(key=lambda s: s['time'])
    duration = max([parsed['beats'][-1]['time'] if parsed['beats'] else 0] +
                   [n['time'] + n['sustain'] for arr in arrangements for n in arr['notes']] +
                   [c['time'] + max((n['sustain'] for n in c['notes']), default=0) for arr in arrangements for c in arr['chords']])
    project = {'version': 1, 'title': parsed['title'], 'artist': parsed['artist'], 'duration': duration,
               'beats': parsed['beats'], 'sections': sections, 'arrangements': arrangements}
    if parsed.get('album'):
        project['album'] = parsed['album']
    if parsed.get('year') and parsed['year'].isdigit():
        project['year'] = int(parsed['year'])
    if warnings:
        project['import_warnings'] = warnings
    return project
