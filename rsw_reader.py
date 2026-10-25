"""Read-only import of R+ Workshop projects (.rsw).

The layout below was worked out from saved projects (format 23; 22 in the shipped
demo) by matching them against the charts they were made from. Every field the
editor uses is decoded; the 4-byte word at offset 6 is a checksum whose
algorithm is unknown, so this module never writes .rsw files. Tuning is not
stored in any decoded field: projects open in standard tuning, with a warning.

    u16 version, u32 file size, u32 checksum
    song: GUID, str title, f32 length (s), str artist, str album, u32 year
    u32 arrangement count (1 seen), arrangement GUID
    u16, u32, u32, u32, u8, f32 length, f32 (unknown, ~first beat)
    tempo:      u32 n, n * (u32 beat, f32 bpm)        beat 0 is at 0 s
    meter:      u32 n, n * (u32 beat, u32 den, u32 num, u32 k, k * u32 grouping)
    templates:  u32 n, n * (str key, str name, u32 k, k * i32 fret, u32 k, k * i32 finger)
    5 * u32     lists not seen populated (must be empty)
    tones:      u32 n, n * (f32 start, f32 end, GUID tone)
    phrases:    u32 n, n * (str name, u8)             definitions
    iterations: u32 n, n * (f32 start, f32 length, str phrase)
    sections:   u32 n, n * (f32 start, str name)
    events:     u32 n, n * (f32 time, str code)
    anchors:    u32 n, n * (f32 time, u8 fret, u8 width)
    notes:      u32 n, n * (f32 time, f32 sustain, u8 fret, u8 string, i8 finger, i8,
                            u32 k, k * (f32 time, f32 step), u8 slide target (100 = none), u32 flags)
    chords:     u32 n, n * (f32 time, f32, str template key, u32 k, k * (f32 time, u8 flag))
    handshapes: u32 n, n * (f32 start, f32 end, str template key, u8, u8)
    4 * u32     lists not seen populated

Strings are u32 length + UTF-8; all values little-endian. Times are seconds.
"""
import base64
import hashlib
import struct
import xml.etree.ElementTree as ET

try:
    from . import pack_io
except ImportError:
    import pack_io

VERSIONS = (22, 23)
MAX_BYTES = 64 * 1024 * 1024
MAX_ITEMS = 1_000_000
# Note flag bits, matched against the charts the projects were made from.
FLAGS = {5: 'palmMute', 10: 'hammerOn', 11: 'pullOff', 2: 'linkNext', 4: 'ignore', 22: 'vibrato'}
UNPITCHED_SLIDE = 18


class RswError(pack_io.ProjectError):
    pass


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
    return len(data) >= 10 and struct.unpack_from('<H', data)[0] in VERSIONS and \
        struct.unpack_from('<I', data, 2)[0] == len(data) and (filename.lower().endswith('.rsw') or not filename)


def parse_rsw(data):
    """Decoded .rsw content as plain data (no editor types)."""
    if len(data) > MAX_BYTES:
        raise RswError('R+ Workshop project exceeds the 64 MiB import limit')
    r = _Reader(data)
    version, size, checksum = r.take('H'), r.take('I'), r.take('I')
    if version not in VERSIONS:
        raise RswError(f'Unsupported R+ Workshop project format {version}; formats 22 and 23 are read')
    if size != len(data):
        raise RswError('R+ Workshop project size field does not match the file; it may be cut short or changed')
    song = {'id': r.guid(), 'title': r.text(), 'length': r.take('f'), 'artist': r.text(), 'album': r.text(), 'year': r.take('I')}
    arrangements = r.take('I')
    song['arrangementId'] = r.guid()
    song['unknown'] = [r.take('H'), r.take('I'), r.take('I'), r.take('I'), r.take('B')]
    song['length2'], song['firstBeat'] = r.take('f'), r.take('f')
    tempo = [r.take('If') for _ in range(r.count('tempo changes'))]
    meter = []
    for _ in range(r.count('time signatures')):
        beat, den, num, k = r.take('I'), r.take('I'), r.take('I'), r.count('beat groups')
        meter.append({'beat': beat, 'numerator': num, 'denominator': den, 'grouping': [r.take('I') for _ in range(k)]})
    templates = []
    for _ in range(r.count('chord templates')):
        key, name = r.text(), r.text()
        frets = [r.take('i') for _ in range(r.count('frets'))]
        fingers = [r.take('i') for _ in range(r.count('fingers'))]
        templates.append({'key': key, 'name': name, 'frets': frets, 'fingers': fingers})
    reserved = [r.take('I') for _ in range(5)]
    if any(reserved):
        raise RswError('This R+ Workshop project uses data this importer does not read yet; nothing was imported')
    tones = [{'start': r.take('f'), 'end': r.take('f'), 'tone': r.guid()} for _ in range(r.count('tone changes'))]
    phrases = [{'name': r.text(), 'value': r.take('B')} for _ in range(r.count('phrases'))]
    iterations = [{'start': r.take('f'), 'length': r.take('f'), 'phrase': r.text()} for _ in range(r.count('phrase iterations'))]
    sections = [{'start': r.take('f'), 'name': r.text()} for _ in range(r.count('sections'))]
    events = [{'time': r.take('f'), 'code': r.text()} for _ in range(r.count('events'))]
    anchors = [{'time': r.take('f'), 'fret': r.take('B'), 'width': r.take('B')} for _ in range(r.count('anchors'))]
    notes = []
    for _ in range(r.count('notes')):
        time, sustain, fret, string, finger, extra = r.take('ffBBbb')
        bends = [r.take('ff') for _ in range(r.count('bend points'))]
        notes.append({'time': time, 'sustain': sustain, 'fret': fret, 'string': string, 'finger': finger, 'extra': extra,
                      'bends': bends, 'slide': r.take('B'), 'flags': r.take('I')})
    chords = []
    for _ in range(r.count('chords')):
        time, value, key = r.take('f'), r.take('f'), r.text()
        repeats = [r.take('fB') for _ in range(r.count('chord repeats'))]
        chords.append({'time': time, 'value': value, 'template': key, 'repeats': repeats})
    handshapes = [{'start': r.take('f'), 'end': r.take('f'), 'template': r.text(), 'a': r.take('B'), 'b': r.take('B')} for _ in range(r.count('hand shapes'))]
    trailing = [r.take('I') for _ in range(4)] if r.at + 16 <= len(data) else []
    if any(trailing) or r.at != len(data):
        raise RswError('This R+ Workshop project has data after the chart this importer does not read yet; nothing was imported')
    return {'version': version, 'checksum': checksum, 'arrangements': arrangements, 'song': song, 'tempo': tempo, 'meter': meter,
            'templates': templates, 'tones': tones, 'phrases': phrases, 'iterations': iterations, 'sections': sections,
            'events': events, 'anchors': anchors, 'notes': notes, 'chords': chords, 'handshapes': handshapes}


def _beats(rsw):
    """Beat times from the tempo map (beat 0 at 0 s) with measure numbers from the meter."""
    tempo = sorted(rsw['tempo']) or [(0, 120.0)]
    meter = sorted(rsw['meter'], key=lambda m: m['beat']) or [{'beat': 0, 'numerator': 4, 'denominator': 4}]
    end = max(rsw['song']['length'], max((n['time'] + n['sustain'] for n in rsw['notes']), default=0)) + 1
    beats, time, beat, measure, index, bar_start = [], 0.0, 0, 0, 0, None
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


def _xml(rsw):
    """RS2014 song XML (version 7) for the decoded project, for the editor's own reader."""
    song = ET.Element('song', version='7')
    for tag, value in (('title', rsw['song']['title']), ('arrangement', 'Lead'), ('artistName', rsw['song']['artist']),
                       ('albumName', rsw['song']['album']), ('albumYear', str(rsw['song']['year'] or '')),
                       ('songLength', f"{rsw['song']['length']:.3f}"), ('offset', '0'), ('centOffset', '0'), ('capo', '0')):
        ET.SubElement(song, tag).text = value
    ET.SubElement(song, 'tuning', {f'string{i}': '0' for i in range(6)})
    ET.SubElement(song, 'arrangementProperties', pathLead='1')
    names = [p['name'] for p in rsw['phrases']] or ['default']
    phrases = ET.SubElement(song, 'phrases', count=str(len(names)))
    for name in names:
        ET.SubElement(phrases, 'phrase', disparity='0', ignore='0', maxDifficulty='0', name=name, solo='0')
    iterations = ET.SubElement(song, 'phraseIterations', count=str(len(rsw['iterations'])))
    for it in rsw['iterations']:
        ET.SubElement(iterations, 'phraseIteration', time=f"{it['start']:.3f}", phraseId=str(names.index(it['phrase']) if it['phrase'] in names else 0))
    keys = {t['key']: i for i, t in enumerate(rsw['templates'])}
    templates = ET.SubElement(song, 'chordTemplates', count=str(len(rsw['templates'])))
    for t in rsw['templates']:
        attrs = {'chordName': t['name'], 'displayName': t['name']}
        for i in range(6):
            attrs[f'fret{i}'] = str(t['frets'][i] if i < len(t['frets']) else -1)
            attrs[f'finger{i}'] = str(t['fingers'][i] if i < len(t['fingers']) else -1)
        ET.SubElement(templates, 'chordTemplate', attrs)
    ebeats = ET.SubElement(song, 'ebeats')
    for b in _beats(rsw):
        ET.SubElement(ebeats, 'ebeat', time=f"{b['time']:.3f}", measure=str(b['measure']))
    ebeats.set('count', str(len(ebeats)))
    sections = ET.SubElement(song, 'sections', count=str(len(rsw['sections'])))
    numbers = {}
    for s in rsw['sections']:
        numbers[s['name']] = numbers.get(s['name'], 0) + 1
        ET.SubElement(sections, 'section', name=s['name'], number=str(numbers[s['name']]), startTime=f"{s['start']:.3f}")
    events = ET.SubElement(song, 'events', count=str(len(rsw['events'])))
    for e in rsw['events']:
        ET.SubElement(events, 'event', time=f"{e['time']:.3f}", code=e['code'])
    levels = ET.SubElement(song, 'levels', count='1')
    level = ET.SubElement(levels, 'level', difficulty='0')
    notes = ET.SubElement(level, 'notes', count=str(len(rsw['notes'])))
    for n in sorted(rsw['notes'], key=lambda n: n['time']):
        if not 0 <= n['string'] < 6:
            raise RswError('R+ Workshop note on a string outside a six-string guitar; nothing was imported')
        attrs = {'time': f"{n['time']:.3f}", 'string': str(n['string']), 'fret': str(n['fret']), 'sustain': f"{n['sustain']:.3f}"}
        if n['finger'] >= 0:
            attrs['leftHand'] = str(n['finger'])
        for bit, name in FLAGS.items():
            if n['flags'] >> bit & 1:
                attrs[name] = '1'
        if n['slide'] != 100:
            attrs['slideUnpitchTo' if n['flags'] >> UNPITCHED_SLIDE & 1 else 'slideTo'] = str(n['slide'])
        element = ET.SubElement(notes, 'note', attrs)
        if n['bends']:
            element.set('bend', f"{max(step for _, step in n['bends']):g}")
            values = ET.SubElement(element, 'bendValues', count=str(len(n['bends'])))
            for t, step in n['bends']:
                ET.SubElement(values, 'bendValue', time=f"{t:.3f}", step=f"{step:g}")
    chords = ET.SubElement(level, 'chords')
    for c in sorted(rsw['chords'], key=lambda c: c['time']):
        if c['template'] not in keys:
            raise RswError(f"R+ Workshop chord uses an unknown chord shape {c['template']!r}; nothing was imported")
        template = rsw['templates'][keys[c['template']]]
        # The chord itself, then each repeat strum; repeats flagged 1 are high density.
        for time, dense in [(c['time'], 0)] + list(c['repeats']):
            chord = ET.SubElement(chords, 'chord', time=f"{time:.3f}", chordId=str(keys[c['template']]), highDensity=str(int(bool(dense))))
            for s, fret in enumerate(template['frets'][:6]):
                if fret >= 0:
                    ET.SubElement(chord, 'chordNote', time=f"{time:.3f}", string=str(s), fret=str(fret), sustain='0')
    chords.set('count', str(len(chords)))
    anchors = ET.SubElement(level, 'anchors', count=str(len(rsw['anchors'])))
    for a in rsw['anchors']:
        ET.SubElement(anchors, 'anchor', time=f"{a['time']:.3f}", fret=str(a['fret']), width=str(a['width']))
    shapes = ET.SubElement(level, 'handShapes', count=str(len(rsw['handshapes'])))
    for h in rsw['handshapes']:
        if h['template'] in keys:
            ET.SubElement(shapes, 'handShape', chordId=str(keys[h['template']]), startTime=f"{h['start']:.3f}", endTime=f"{h['end']:.3f}")
    return ET.tostring(song, encoding='utf-8', xml_declaration=True)


def load_rsw(data, filename='project.rsw'):
    """Editable project from an R+ Workshop .rsw (the original is kept; saving to .rsw is not offered)."""
    rsw = parse_rsw(data)
    project = pack_io.load_xml(_xml(rsw))
    arr = project['arrangements'][0]
    arr.update(id='rsw-0', name='Guitar')
    arr.pop('_xml', None)
    project['duration'] = max(project.get('duration', 0), rsw['song']['length'])
    project['_import'] = {'format': 'rplus-oce-rsw', 'version': rsw['version'], 'songId': rsw['song']['id'],
                          'arrangementId': rsw['song']['arrangementId'], 'source': filename,
                          'tones': rsw['tones'], 'phraseValues': {p['name']: p['value'] for p in rsw['phrases']}}
    name = 'sources/' + hashlib.sha256(data).hexdigest()[:16] + '.rsw'
    project.setdefault('_pack', {}).setdefault('entries', {})[name] = base64.b64encode(data).decode('ascii')
    warnings = [w for w in project.get('import_warnings', []) if 'TS:numerator' not in w]
    warnings.append('Opened from an R+ Workshop project (.rsw), read-only: the editor cannot save back to .rsw because its checksum is unknown. Save as a project, FeedPak or R+ song folder instead.')
    warnings.append('The .rsw does not record tuning in any field this importer reads; the guitar opens in standard tuning. Set the real tuning in the arrangement settings if it differs.')
    unknown = sum(1 for n in rsw['notes'] if n['flags'] & ~sum(1 << b for b in (*FLAGS, UNPITCHED_SLIDE)))
    if unknown:
        warnings.append(f'{unknown} notes carry technique flags this importer does not read yet; those techniques were left off.')
    project['import_warnings'] = warnings
    return pack_io.validate_project(project)
