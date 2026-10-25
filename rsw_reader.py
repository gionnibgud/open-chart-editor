"""Read-only import of R+ Workshop projects (.rsw), formats 21, 22 and 23.

All values little-endian; strings are u32 byte length + UTF-8; GUIDs are 16 raw bytes;
times are seconds. Checked against eight saved projects (format 23) and their
official charts: every file reads to its last byte and passes the checksum.

    u16 version (21, 22, 23)
    22+: u32 file size, u32 CRC-32 of every byte after offset 10 (zlib, seed 0xFFFFFFFB)
    song:   GUID, str title, f32 length, str artist, str album, u32 year, u32 arrangement count
    per arrangement:
      GUID id, u16 instrument type (0 guitar, 1 bass; 2 vocals is never saved to .rsw),
      u16 arrangement type (0 Lead, 1 Alt Lead, 2 Rhythm, 3 Alt Rhythm, 4 Bass, 5 Alt Bass;
      6 and 8 load as Lead or Bass; 666 not set),
      i32 cent offset, u8 capo, i8 tuning x 6 (guitar) or x 4 (bass), f32 arrangement length,
      f32 audio offset (<offset> in the R+ XML: 1.240 in both, for the Abuse projects)
      tempo:      u32 n, n * (u32 beat, f32 bpm)               beat 0 is at 0 s
      meter:      u32 n, n * (u32 beat, u32 den, u32 num [, 23+: u32 k, k * u32 group])
      templates:  u32 n, n * (str key, str name, u32 k, k * i32 fret, u32 k, k * i32 finger)
      u32 legacy tone count (tones once built inside R+ Workshop; always 0 now), GUID default tone
      tones:      u32 n, n * (f32 start, f32 end, GUID tone)
      phrases:    u32 n, n * (str name, u8 colour)
      iterations: u32 n, n * (f32 start, f32 length, str phrase)
      sections:   u32 n, n * (f32 start, str name)
      events:     u32 n, n * (f32 time, str code)
      chart, then the scratch pad (R+ Workshop's Scratch panel), each:
        anchors:    u32 n, n * (f32 time, u8 fret, u8 width)
        notes:      u32 n, n * (f32 time, f32 sustain, u8 fret, u8 string, i8 left hand,
                                i8 right hand, u32 k, k * (f32 time, f32 step),
                                u8 slide target (100 = none), u32 flags)
        chords:     u32 n, n * (f32 time, f32 sustain, str template key, u32 k,
                                k * (f32 repeat time, u8 flags: 1 palm mute, 2 fret-hand mute, 4 accent))
        handshapes: u32 n, n * (f32 start, f32 end, str template key,
                                u8 mode (0 chord zone, 1 hand shape, 2 arpeggio), u8 hide name)
    Note flags: bit 0 chord member, 1 continues the previous note, 2 linkNext, 3 accent,
    4 ignore, 5 palm mute, 6 fret-hand mute, 8 harmonic, 9 pinch harmonic (8 wins), 10 hammer-on,
    11 pull-off, 12 tap (inferred), 18 unpitched slide, 19 tremolo, 22 vibrato. Chord-member notes are the chords'
    own notes, at each chord's first strike.
    any remaining bytes: trailer

The checksum is verifiable, but this module still only reads: saving to .rsw is not
offered yet.
"""
import base64
import hashlib
import struct
import xml.etree.ElementTree as ET
import zlib

try:
    from . import pack_io
except ImportError:
    import pack_io

VERSIONS = (21, 22, 23)
MAX_BYTES = 64 * 1024 * 1024
MAX_ITEMS = 1_000_000
CRC_SEED = 0xFFFFFFFB
# Note flag bits, matched against the charts the projects were made from.
# Note flag bits, as RS2014 XML attributes.
FLAGS = {2: 'linkNext', 3: 'accent', 4: 'ignore', 5: 'palmMute', 6: 'mute', 8: 'harmonic', 9: 'harmonicPinch',
         10: 'hammerOn', 11: 'pullOff', 12: 'tap', 19: 'tremolo', 22: 'vibrato'}
# Bit 12 (tap) is inferred, not documented: in the projects seen, every note with it also has a
# right-hand finger, in rising runs high on the neck.
CHORD_MEMBER = 0      # the note is one of a chord's notes (its own sustain, techniques and fingers)
CONTINUES = 1         # continues the previous note's sustain (that note has linkNext)
UNPITCHED_SLIDE = 18
HARMONIC, PINCH = 8, 9                    # both set: harmonic wins
MODE_CHORD, MODE_HAND, MODE_ARPEGGIO = 0, 1, 2   # hand-shape mode: chord zone, normal hand shape, arpeggio
# Chord-level attributes: on a repeat strum from its flag byte; on the first strike from the
# flags all of its notes share. Both checked against R+ server charts.
REPEAT_FLAGS = {1: 'palmMute', 2: 'fretHandMute', 4: 'accent'}
CHORD_FLAGS_FROM_NOTES = {2: 'linkNext', 3: 'accent', 4: 'ignore', 5: 'palmMute', 6: 'fretHandMute'}
# Arrangement type (role, alternative, name). 6 and 8 are converted by R+ Workshop's loader
# to Lead (guitar) or Bass (bass); 666 is "not set" (R+ Workshop's validator error 109001).
ARRANGEMENT_TYPES = {0: ('lead', False, 'Lead'), 1: ('lead', True, 'Alt Lead'), 2: ('rhythm', False, 'Rhythm'),
                     3: ('rhythm', True, 'Alt Rhythm'), 4: ('bass', False, 'Bass'), 5: ('bass', True, 'Alt Bass')}
NOT_SET = 666
INSTRUMENT_VOCALS = 2


class RswError(pack_io.ProjectError):
    pass


def checksum(data):
    """The CRC a format 22/23 header stores: everything after the 10-byte header."""
    return zlib.crc32(data[10:], CRC_SEED) & 0xFFFFFFFF


class _Reader:
    def __init__(self, data):
        self.data, self.at = data, 0

    def take(self, fmt):
        size = struct.calcsize('<' + fmt)
        if self.at + size > len(self.data):
            raise RswError('R+ Workshop project ends early; the file may be cut short')
        values = struct.unpack_from('<' + fmt, self.data, self.at)
        self.at += size
        return values if len(values) > 1 else values[0]

    def count(self, what):
        n = self.take('I')
        if n > MAX_ITEMS:
            raise RswError(f'R+ Workshop project lists an implausible number of {what}')
        return n

    def text(self):
        n = self.take('I')
        if n > 4096 or self.at + n > len(self.data):
            raise RswError('R+ Workshop project has a malformed text field')
        value = self.data[self.at:self.at + n].decode('utf-8', 'replace')
        self.at += n
        return value

    def guid(self):
        if self.at + 16 > len(self.data):
            raise RswError('R+ Workshop project ends early; the file may be cut short')
        value = self.data[self.at:self.at + 16].hex()
        self.at += 16
        return value


def is_rsw(data, filename=''):
    if len(data) < 2 or struct.unpack_from('<H', data)[0] not in VERSIONS:
        return False
    if struct.unpack_from('<H', data)[0] == 21:
        return filename.lower().endswith('.rsw')
    return len(data) >= 10 and struct.unpack_from('<I', data, 2)[0] == len(data) and (filename.lower().endswith('.rsw') or not filename)


def _level(r):
    anchors = [{'time': r.take('f'), 'fret': r.take('B'), 'width': r.take('B')} for _ in range(r.count('anchors'))]
    notes = []
    for _ in range(r.count('notes')):
        time, sustain, fret, string, left, right = r.take('ffBBbb')
        bends = [r.take('ff') for _ in range(r.count('bend points'))]
        notes.append({'time': time, 'sustain': sustain, 'fret': fret, 'string': string, 'leftHand': left, 'rightHand': right,
                      'bends': bends, 'slide': r.take('B'), 'flags': r.take('I')})
    chords = []
    for _ in range(r.count('chords')):
        time, sustain, key = r.take('f'), r.take('f'), r.text()
        repeats = [r.take('fB') for _ in range(r.count('chord repeats'))]
        chords.append({'time': time, 'sustain': sustain, 'template': key, 'repeats': repeats})
    handshapes = [{'start': r.take('f'), 'end': r.take('f'), 'template': r.text(), 'mode': r.take('B'), 'hideName': r.take('B')}
                  for _ in range(r.count('hand shapes'))]
    return {'anchors': anchors, 'notes': notes, 'chords': chords, 'handshapes': handshapes}


def _arrangement(r, version):
    arr = {'id': r.guid(), 'instrument': r.take('H')}
    if arr['instrument'] == INSTRUMENT_VOCALS:
        raise RswError('This R+ Workshop project has a vocals arrangement; R+ Workshop does not save vocals in .rsw files, so it cannot be read. Nothing was imported')
    if arr['instrument'] > 1:
        raise RswError(f"R+ Workshop arrangement uses instrument type {arr['instrument']}, which has no known layout; nothing was imported")
    arr['type'], arr['centOffset'], arr['capo'] = r.take('H'), r.take('i'), r.take('B')
    arr['tuning'] = [r.take('b') for _ in range(4 if arr['instrument'] == 1 else 6)]
    arr['length'], arr['offset'] = r.take('f'), r.take('f')
    arr['tempo'] = [r.take('If') for _ in range(r.count('tempo changes'))]
    arr['meter'] = []
    for _ in range(r.count('time signatures')):
        beat, den, num = r.take('I'), r.take('I'), r.take('I')
        grouping = [r.take('I') for _ in range(r.count('beat groups'))] if version >= 23 else []
        arr['meter'].append({'beat': beat, 'numerator': num, 'denominator': den, 'grouping': grouping})
    arr['templates'] = []
    for _ in range(r.count('chord templates')):
        key, name = r.text(), r.text()
        frets = [r.take('i') for _ in range(r.count('frets'))]
        fingers = [r.take('i') for _ in range(r.count('fingers'))]
        arr['templates'].append({'key': key, 'name': name, 'frets': frets, 'fingers': fingers})
    if r.take('I'):
        raise RswError('This R+ Workshop project has tones built inside R+ Workshop the old way, which R+ Workshop itself no longer loads (an old list); nothing was imported')
    arr['defaultTone'] = r.guid()
    arr['tones'] = [{'start': r.take('f'), 'end': r.take('f'), 'tone': r.guid()} for _ in range(r.count('tone changes'))]
    arr['phrases'] = [{'name': r.text(), 'colour': r.take('B')} for _ in range(r.count('phrases'))]
    arr['iterations'] = [{'start': r.take('f'), 'length': r.take('f'), 'phrase': r.text()} for _ in range(r.count('phrase iterations'))]
    arr['sections'] = [{'start': r.take('f'), 'name': r.text()} for _ in range(r.count('sections'))]
    arr['events'] = [{'time': r.take('f'), 'code': r.text()} for _ in range(r.count('events'))]
    arr['primary'], arr['secondary'] = _level(r), _level(r)
    return arr


def parse_rsw(data):
    """Decoded .rsw content as plain data (no editor types)."""
    if len(data) > MAX_BYTES:
        raise RswError('R+ Workshop project exceeds the 64 MiB import limit')
    r = _Reader(data)
    version = r.take('H')
    if version not in VERSIONS:
        raise RswError(f'Unsupported R+ Workshop project format {version}; formats 21, 22 and 23 are read')
    stored = None
    if version >= 22:
        size, stored = r.take('I'), r.take('I')
        if size != len(data):
            raise RswError('R+ Workshop project size field does not match the file; it may be cut short or changed')
    song = {'id': r.guid(), 'title': r.text(), 'length': r.take('f'), 'artist': r.text(), 'album': r.text(), 'year': r.take('I')}
    arrangements = [_arrangement(r, version) for _ in range(r.count('arrangements'))]
    if not arrangements:
        raise RswError('R+ Workshop project has no arrangement')
    return {'version': version, 'checksum': stored, 'checksumOk': stored is None or stored == checksum(data),
            'song': song, 'arrangements': arrangements, 'trailer': len(data) - r.at}


def _beats(song, arr):
    """Beat times from the tempo map (beat 0 at 0 s) with measure numbers from the meter."""
    tempo = sorted(arr['tempo']) or [(0, 120.0)]
    meter = sorted(arr['meter'], key=lambda m: m['beat']) or [{'beat': 0, 'numerator': 4, 'denominator': 4}]
    notes = arr['primary']['notes'] + arr['secondary']['notes']
    end = max(song['length'], arr['length'], max((n['time'] + n['sustain'] for n in notes), default=0)) + 1
    # A negative audio offset moves the beat grid later by the same amount (checked against
    # the R+ server chart for Funeral Portrait); notes keep their own times.
    beats, time, beat, measure, index, bar_start = [], max(0.0, -arr['offset']), 0, 0, 0, None
    while time <= end and beat < 200000:
        while index + 1 < len(tempo) and tempo[index + 1][0] <= beat:
            index += 1
        current = max((m for m in meter if m['beat'] <= beat), key=lambda m: m['beat'], default=meter[0])
        if bar_start is None or current['beat'] == beat or beat - bar_start >= current['numerator']:
            bar_start, measure = beat, measure + 1
            beats.append({'time': time, 'measure': measure})
        else:
            beats.append({'time': time, 'measure': -1})
        bpm = tempo[index][1] if tempo[index][1] > 0 else 120.0
        # Tempo is in quarter notes; an eighth-note meter takes half the time per beat.
        time += 60.0 / bpm * 4.0 / max(1, current['denominator'])
        beat += 1
    return beats


def _kind(arr):
    """(role, alternative, name, note) for an arrangement. The instrument decides guitar or
    bass; the arrangement type gives the role and whether it is an alternative."""
    bass = arr['instrument'] == 1
    value = arr['type']
    if value in (6, 8):
        value = 4 if bass else 0                     # as R+ Workshop's own loader does
    if value == NOT_SET:
        role, alt, name = ARRANGEMENT_TYPES[4 if bass else 0]
        return role, alt, name, f'{name}: the arrangement type is not set in R+ Workshop (its validator reports error 109001); it opens as {name}.'
    if value not in ARRANGEMENT_TYPES:
        role, alt, name = ARRANGEMENT_TYPES[4 if bass else 0]
        return role, alt, name, f'{name}: unknown arrangement type {value}; it opens as {name}.'
    role, alt, name = ARRANGEMENT_TYPES[value]
    if (role == 'bass') != bass:
        role, alt, name = ARRANGEMENT_TYPES[(5 if alt else 4) if bass else (1 if alt else 0)]
        return role, alt, name, f'{name}: the arrangement type says {"bass" if not bass else "guitar"} but the instrument is {"bass" if bass else "guitar"}; it opens as {name}.'
    return role, alt, name, None


def _role(arr):
    return _kind(arr)[0]


def _xml(song, arr, level=None):
    """RS2014 song XML (version 7) for one decoded arrangement, for the editor's own reader."""
    level = level or arr['primary']
    role, alternative, _, _ = _kind(arr)
    strings = len(arr['tuning'])
    root = ET.Element('song', version='7')
    for tag, value in (('title', song['title']), ('arrangement', role.title()), ('artistName', song['artist']),
                       ('albumName', song['album']), ('albumYear', str(song['year'] or '')),
                       ('songLength', f"{max(song['length'], arr['length']):.3f}"), ('offset', '0'),
                       ('centOffset', str(arr['centOffset'])), ('capo', str(arr['capo']))):
        ET.SubElement(root, tag).text = value
    ET.SubElement(root, 'tuning', {f'string{i}': str(v) for i, v in enumerate(arr['tuning'])})
    ET.SubElement(root, 'arrangementProperties', {'pathLead': str(int(role == 'lead')), 'pathRhythm': str(int(role == 'rhythm')),
                                                  'pathBass': str(int(role == 'bass')), 'represent': str(int(not alternative))})
    names = [p['name'] for p in arr['phrases']] or ['default']
    phrases = ET.SubElement(root, 'phrases', count=str(len(names)))
    for name in names:
        ET.SubElement(phrases, 'phrase', disparity='0', ignore='0', maxDifficulty='0', name=name, solo='0')
    iterations = ET.SubElement(root, 'phraseIterations', count=str(len(arr['iterations'])))
    for it in arr['iterations']:
        ET.SubElement(iterations, 'phraseIteration', time=f"{it['start']:.3f}", phraseId=str(names.index(it['phrase']) if it['phrase'] in names else 0))
    # Arpeggio and hidden-name hand shapes use a copy of their template with an -arp or -nop
    # display name (RS2014 convention); the editor treats the two as exclusive, arpeggio first.
    templates = [dict(t, suffix='') for t in arr['templates']]
    keys = {t['key']: i for i, t in enumerate(templates)}
    variants = {}
    for h in level['handshapes']:
        suffix = '-arp' if h['mode'] == MODE_ARPEGGIO else '-nop' if h['hideName'] else ''
        if suffix and h['template'] in keys and (h['template'], suffix) not in variants:
            variants[(h['template'], suffix)] = len(templates)
            templates.append(dict(templates[keys[h['template']]], suffix=suffix))
    element = ET.SubElement(root, 'chordTemplates', count=str(len(templates)))
    for t in templates:
        attrs = {'chordName': t['name'], 'displayName': t['name'] + t['suffix']}
        for i in range(strings):
            attrs[f'fret{i}'] = str(t['frets'][i] if i < len(t['frets']) else -1)
            attrs[f'finger{i}'] = str(t['fingers'][i] if i < len(t['fingers']) else -1)
        ET.SubElement(element, 'chordTemplate', attrs)
    ebeats = ET.SubElement(root, 'ebeats')
    for b in _beats(song, arr):
        ET.SubElement(ebeats, 'ebeat', time=f"{b['time']:.3f}", measure=str(b['measure']))
    ebeats.set('count', str(len(ebeats)))
    sections = ET.SubElement(root, 'sections', count=str(len(arr['sections'])))
    numbers = {}
    for s in arr['sections']:
        numbers[s['name']] = numbers.get(s['name'], 0) + 1
        ET.SubElement(sections, 'section', name=s['name'], number=str(numbers[s['name']]), startTime=f"{s['start']:.3f}")
    events = ET.SubElement(root, 'events', count=str(len(arr['events'])))
    for e in arr['events']:
        ET.SubElement(events, 'event', time=f"{e['time']:.3f}", code=e['code'])
    levels = ET.SubElement(root, 'levels', count='1')
    xml_level = ET.SubElement(levels, 'level', difficulty='0')
    def note_element(tag, n, time=None):
        if not 0 <= n['string'] < strings:
            raise RswError(f'R+ Workshop note on a string outside a {strings}-string {"bass" if strings == 4 else "guitar"}; nothing was imported')
        attrs = {'time': f"{n['time'] if time is None else time:.3f}", 'string': str(n['string']), 'fret': str(n['fret']), 'sustain': f"{n['sustain']:.3f}"}
        if n['leftHand'] >= 0:
            attrs['leftHand'] = str(n['leftHand'])
        if n['rightHand'] >= 0:
            attrs['rightHand'] = str(n['rightHand'])
        for bit, name in FLAGS.items():
            if n['flags'] >> bit & 1 and not (bit == PINCH and n['flags'] >> HARMONIC & 1):
                attrs[name] = '1'
        if n['slide'] != 100:
            attrs['slideUnpitchTo' if n['flags'] >> UNPITCHED_SLIDE & 1 else 'slideTo'] = str(n['slide'])
        element = ET.Element(tag, attrs)
        if n['bends']:
            element.set('bend', f"{max(step for _, step in n['bends']):g}")
            values = ET.SubElement(element, 'bendValues', count=str(len(n['bends'])))
            for t, step in n['bends']:
                ET.SubElement(values, 'bendValue', time=f"{t:.3f}", step=f"{step:g}")
        return element

    # Chord-member notes belong to the chord struck at their time.
    members = {}
    for n in level['notes']:
        if n['flags'] >> CHORD_MEMBER & 1:
            members.setdefault(round(n['time'], 3), {})[n['string']] = n
    used = set()
    chord_rows = []
    for c in sorted(level['chords'], key=lambda c: c['time']):
        if c['template'] not in keys:
            raise RswError(f"R+ Workshop chord uses an unknown chord shape {c['template']!r}; nothing was imported")
        template = templates[keys[c['template']]]
        own = members.get(round(c['time'], 3), {})
        # The first strike takes the flags all its notes share (as R+ servers write it);
        # each repeat strum has its own flag byte. Repeats are high density (RS2014 convention).
        shared = ~0
        for n in own.values():
            shared &= n['flags']
        first = {CHORD_FLAGS_FROM_NOTES[bit]: '1' for bit in CHORD_FLAGS_FROM_NOTES if own and shared >> bit & 1}
        for time, flags in [(c['time'], None)] + list(c['repeats']):
            attrs = first if flags is None else {name: '1' for bit, name in REPEAT_FLAGS.items() if flags & bit}
            chord = ET.Element('chord', time=f"{time:.3f}", chordId=str(keys[c['template']]), highDensity='0' if flags is None else '1', **attrs)
            for s, fret in enumerate(template['frets'][:strings]):
                if fret < 0:
                    continue
                if time == c['time'] and s in own:
                    chord.append(note_element('chordNote', own[s], time))
                    used.add(id(own[s]))
                else:
                    ET.SubElement(chord, 'chordNote', time=f"{time:.3f}", string=str(s), fret=str(fret),
                                  sustain=f"{c['sustain'] if time == c['time'] else 0:.3f}")
            chord_rows.append(chord)
    singles = [n for n in sorted(level['notes'], key=lambda n: n['time']) if id(n) not in used]
    notes = ET.SubElement(xml_level, 'notes', count=str(len(singles)))
    for n in singles:
        notes.append(note_element('note', n))
    chords = ET.SubElement(xml_level, 'chords', count=str(len(chord_rows)))
    chords.extend(chord_rows)
    anchors = ET.SubElement(xml_level, 'anchors', count=str(len(level['anchors'])))
    for a in level['anchors']:
        ET.SubElement(anchors, 'anchor', time=f"{a['time']:.3f}", fret=str(a['fret']), width=str(a['width']))
    shapes = ET.SubElement(xml_level, 'handShapes', count=str(len(level['handshapes'])))
    for h in level['handshapes']:
        if h['template'] in keys:
            suffix = '-arp' if h['mode'] == MODE_ARPEGGIO else '-nop' if h['hideName'] else ''
            chord_id = variants[(h['template'], suffix)] if suffix else keys[h['template']]
            ET.SubElement(shapes, 'handShape', chordId=str(chord_id), startTime=f"{h['start']:.3f}", endTime=f"{h['end']:.3f}")
    return ET.tostring(root, encoding='utf-8', xml_declaration=True)


def _filled(level):
    return any(level[key] for key in ('anchors', 'notes', 'chords', 'handshapes'))


def load_rsw(data, filename='project.rsw'):
    """Editable project from an R+ Workshop .rsw (the original is kept; saving to .rsw is not offered)."""
    rsw = parse_rsw(data)
    song, first = rsw['song'], rsw['arrangements'][0]
    project = pack_io.load_xml(_xml(song, first))
    project['arrangements'] = []
    warnings = []
    for index, arr in enumerate(rsw['arrangements']):
        _, _, name, note = _kind(arr)
        if note:
            warnings.append(note)
        main = pack_io.load_xml(_xml(song, arr))['arrangements'][0]
        main.pop('_xml', None)
        main.update(id=f'rsw-{index}', name=name)
        project['arrangements'].append(main)
        if _filled(arr['secondary']):
            # R+ Workshop's Scratch panel saves its track as the second level: it becomes this part's scratch track.
            scratch = pack_io.load_xml(_xml(song, arr, arr['secondary']))['arrangements'][0]
            scratch.pop('_xml', None)
            scratch.update(id=f'rsw-{index}-scratch', name=f'Scratch · {name}', editorOnly=True, scratchFor=main['id'])
            project['arrangements'].append(scratch)
            warnings.append(f"{name}: the project's scratch track opens as this part's scratch track (View > Scratch).")
        if index and (arr['tempo'] != first['tempo'] or arr['meter'] != first['meter']):
            warnings.append(f'Arrangement {index + 1} has its own tempo map; the song uses the first arrangement\'s, and its notes keep their times.')
    project['duration'] = max(project.get('duration', 0), song['length'], *(a['length'] for a in rsw['arrangements']))
    project['_import'] = {'format': 'rplus-oce-rsw', 'version': rsw['version'], 'songId': song['id'], 'source': filename,
                          'arrangements': [{'id': a['id'], 'instrument': a['instrument'], 'arrangementType': a['type'], 'audioOffset': a['offset'],
                                            'defaultTone': a['defaultTone'], 'tones': a['tones'],
                                            'phraseColours': {p['name']: p['colour'] for p in a['phrases']},
                                            'handshapeModes': [[h['mode'], h['hideName']] for h in a['primary']['handshapes']]}
                                           for a in rsw['arrangements']]}
    name = 'sources/' + hashlib.sha256(data).hexdigest()[:16] + '.rsw'
    project.setdefault('_pack', {}).setdefault('entries', {})[name] = base64.b64encode(data).decode('ascii')
    warnings = [w for w in project.get('import_warnings', []) if 'TS:numerator' not in w] + warnings
    warnings.append('Opened from an R+ Workshop project (.rsw), read-only: saving back to .rsw is not offered yet. Save as a project, FeedPak or R+ song folder instead.')
    if not rsw['checksumOk']:
        warnings.append('The .rsw checksum does not match its contents: the file was changed outside R+ Workshop, so R+ Workshop may refuse it. It was imported as read.')
    if rsw['trailer']:
        warnings.append(f"The .rsw has {rsw['trailer']} bytes after the last arrangement; they are kept in the original file but not read.")
    known = sum(1 << b for b in (*FLAGS, UNPITCHED_SLIDE, CHORD_MEMBER, CONTINUES))
    unknown = sum(1 for a in rsw['arrangements'] for n in a['primary']['notes'] if n['flags'] & ~known)
    if unknown:
        warnings.append(f'{unknown} notes carry technique flags this importer does not read yet; those techniques were left off.')
    other = sum(1 for a in rsw['arrangements'] for h in a['primary']['handshapes'] if h['mode'] not in (MODE_CHORD, MODE_HAND, MODE_ARPEGGIO))
    if other:
        warnings.append(f'{other} hand shapes use an unknown hand-shape mode; they open as plain chord shapes.')
    both = sum(1 for a in rsw['arrangements'] for h in a['primary']['handshapes'] if h['mode'] == MODE_ARPEGGIO and h['hideName'])
    if both:
        warnings.append(f'{both} arpeggio hand shapes also hide their chord name; the editor keeps the arpeggio and shows the name.')
    project['import_warnings'] = warnings
    return pack_io.validate_project(project)
