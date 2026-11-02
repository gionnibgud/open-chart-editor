"""Read-only binary parser for Editor on Fire (.eof) project files ("notes.eof").

Ground-truthed against EOF's own loader (eof_load_song_pf / eof_read_pro_guitar_note in
raynebc/editor-on-fire src/song.c), not the stale "proposed project format" document that
circulates online - that document diverges from the shipped format in several places
(track flags have no extended-flags chain; top-level custom data block sizes exclude their
own 4-byte type field while per-track custom data block sizes include it). Verified
byte-exact (every byte of the file accounted for, nothing left over) against real EOF
project folders.

Only pro guitar/bass tracks (EOF's Rocksmith-oriented track format) are mapped to OCE
arrangements; EOF's other track formats (5-lane legacy, pro keys, vocal, variable-lane
legacy/drums) are detected but not converted - they're a different project in scope.
"""
from __future__ import annotations
import struct

MAGIC = b'EOFSONH\x00'

INI_STRING_FIELDS = {2: 'artist', 3: 'title', 4: 'frettist', 6: 'year', 7: 'loading_text', 8: 'album', 9: 'genre', 10: 'tracknumber'}

TRACK_FORMAT_LEGACY, TRACK_FORMAT_VOCAL, TRACK_FORMAT_PRO_KEYS, TRACK_FORMAT_PRO_GUITAR, TRACK_FORMAT_VARIABLE_LEGACY = 1, 2, 3, 4, 5
TRACK_FLAG_ALT_NAME = 2

SECTION_BOOKMARK, SECTION_FRET_CATALOG, SECTION_FRET_HAND_POS, SECTION_RS_POPUP, SECTION_RS_TONE_CHANGE, SECTION_HANDSHAPE, SECTION_ARPEGGIO = 3, 4, 16, 17, 18, 19, 10

# EOF_PRO_GUITAR_NOTE_FLAG_* (src/song.h); only the ones mapped to an OCE technique are named.
NOTE_FLAG_ACCENT, NOTE_FLAG_P_HARMONIC, NOTE_FLAG_LINKNEXT, NOTE_FLAG_UNPITCH_SLIDE = 32, 64, 128, 256
NOTE_FLAG_HO, NOTE_FLAG_PO, NOTE_FLAG_TAP, NOTE_FLAG_SLIDE_UP, NOTE_FLAG_SLIDE_DOWN = 512, 1024, 2048, 4096, 8192
NOTE_FLAG_STRING_MUTE, NOTE_FLAG_PALM_MUTE, NOTE_FLAG_BEND = 16384, 32768, 2097152
NOTE_FLAG_HARMONIC, NOTE_FLAG_VIBRATO, NOTE_FLAG_RS_NOTATION = 4194304, 16777216, 33554432
NOTE_FLAG_POP, NOTE_FLAG_SLAP = 67108864, 134217728
NOTE_FLAG_EXTENDED = 2147483648


class EofError(ValueError):
    pass


class _Reader:
    __slots__ = ('data', 'off')

    def __init__(self, data):
        self.data = data
        self.off = 0

    def _need(self, n):
        if self.off + n > len(self.data):
            raise EofError('Unexpected end of EOF project data')

    def u8(self):
        self._need(1)
        v = self.data[self.off]
        self.off += 1
        return v

    def i8(self):
        self._need(1)
        v = struct.unpack_from('<b', self.data, self.off)[0]
        self.off += 1
        return v

    def u16(self):
        self._need(2)
        v = struct.unpack_from('<H', self.data, self.off)[0]
        self.off += 2
        return v

    def u32(self):
        self._need(4)
        v = struct.unpack_from('<I', self.data, self.off)[0]
        self.off += 4
        return v

    def lenstr(self):
        n = self.u16()
        self._need(n)
        s = self.data[self.off:self.off + n]
        self.off += n
        return s.decode('utf-8', 'replace')

    def skip(self, n):
        if n < 0:
            raise EofError('Negative skip in EOF project data')
        self._need(n)
        self.off += n


def is_eof_file(data):
    return isinstance(data, bytes) and data[:8] == MAGIC


def _read_pro_guitar_note(r):
    name = r.lenstr()
    r.u8()  # chord number: unused by EOF itself
    difficulty = r.u8()
    string_mask = r.u8()
    ghost_mask = r.u8()
    frets = [None] * 8
    for bit in range(8):
        if string_mask & (1 << bit):
            frets[bit] = r.u8()
    r.u8()  # legacy bitmask: superseded by the flags below
    pos = r.u32()
    length = r.u32()
    flags = r.u32()
    slide_end = bend_strength = unpitch_end = None
    if flags & NOTE_FLAG_RS_NOTATION:
        if flags & (NOTE_FLAG_SLIDE_UP | NOTE_FLAG_SLIDE_DOWN):
            slide_end = r.u8()
        if flags & NOTE_FLAG_BEND:
            bend_strength = r.u8()
    if flags & NOTE_FLAG_UNPITCH_SLIDE:
        unpitch_end = r.u8()
    if flags & NOTE_FLAG_EXTENDED:
        r.u32()
    return {'name': name, 'difficulty': difficulty, 'string_mask': string_mask, 'ghost_mask': ghost_mask,
            'frets': frets, 'pos': pos, 'length': length, 'flags': flags,
            'slide_end': slide_end, 'bend_strength': bend_strength, 'unpitch_end': unpitch_end}


def _skip_legacy_notes(r):
    count = r.u32()
    for _ in range(count):
        r.lenstr(); r.u8(); r.u8(); r.u32(); r.u32()
        flags = r.u32()
        if flags & NOTE_FLAG_EXTENDED:
            r.u32()
    return count


def _skip_vocal_lyrics(r):
    r.u8()  # tone set
    count = r.u32()
    for _ in range(count):
        r.lenstr(); r.u8(); r.u8(); r.u32(); r.u32()
        flags = r.u32()
        if flags & NOTE_FLAG_EXTENDED:
            r.u32()
    return count


def _skip_pro_keys_chords(r):
    r.u8(); r.u8(); r.u8()  # tone set, lowest note, highest note
    count = r.u32()
    for _ in range(count):
        r.lenstr(); r.u8(); r.u8()
        keys = r.u8()
        for _ in range(keys):
            r.u8(); r.u8(); r.u8()
        r.u8(); r.u32(); r.u32()
        flags = r.u32()
        if flags & NOTE_FLAG_EXTENDED:
            r.u32()
    return count


def _read_sections(r):
    """Common per-track section list: {type: [(name,difficulty,start,end,flags), ...]}."""
    sections = {}
    for _ in range(r.u16()):
        section_type = r.u16()
        count = r.u32()
        rows = []
        for _ in range(count):
            name = r.lenstr()
            difficulty = r.u8()
            start = r.u32()
            end = r.u32()
            flags = r.u32()
            rows.append((name, difficulty, start, end, flags))
        sections.setdefault(section_type, []).extend(rows)
    return sections


def _read_finger_array(r, size, notes):
    """Decode block id 2 in place: per note, one finger byte per set string bit, in string order."""
    end_marker_off = r.off + max(0, size - 4)
    for note in notes:
        fingers = {}
        for string in range(8):
            if note['string_mask'] & (1 << string):
                fingers[string] = r.u8()
        note['fingers'] = fingers
    if r.off != end_marker_off:
        raise EofError('Pro guitar finger array block did not consume exactly its declared size')


def _read_pro_guitar_track(r):
    numfrets = r.u8()
    numstrings = r.u8()
    if numstrings > 8:
        raise EofError('Unsupported number of strings in a pro guitar/bass track')
    tuning = [r.i8() for _ in range(numstrings)]
    note_count = r.u32()
    notes = [_read_pro_guitar_note(r) for _ in range(note_count)]
    sections = _read_sections(r)
    tech_notes = []
    arrangement_type = None
    for _ in range(r.u32()):
        size = r.u32()
        block_id = r.u32()
        remaining = max(0, size - 4)
        end = r.off + remaining
        if block_id == 2:
            _read_finger_array(r, size, notes)
        elif block_id == 7:
            tech_count = r.u32()
            for _ in range(tech_count):
                tech_notes.append(_read_pro_guitar_note(r))
        elif block_id == 3:
            arrangement_type = r.u8()
        if r.off > end:
            raise EofError('EOF custom data block read past its declared size')
        r.off = min(end, len(r.data))
    return {'numfrets': numfrets, 'numstrings': numstrings, 'tuning': tuning, 'notes': notes,
            'sections': sections, 'tech_notes': tech_notes, 'arrangement_type': arrangement_type}


def parse_eof(data):
    """Parse a notes.eof binary into a neutral dict. Raises EofError on anything that does
    not look like a well-formed EOF project (never partially trusts malformed input)."""
    if not is_eof_file(data):
        raise EofError('Not an EOF project file (missing EOFSONH header)')
    r = _Reader(data)
    r.skip(16)  # magic (8) + reserved padding (8)
    revision = r.u32()
    timing_format = r.u8()
    if timing_format != 0:
        raise EofError('EOF delta-tick timing is unsupported; only millisecond timing is read')
    r.u32()  # time division: meaningful only for delta timing
    strings = {}
    for _ in range(r.u16()):
        kind = r.u8()
        value = r.lenstr()
        if kind in INI_STRING_FIELDS:
            strings[INI_STRING_FIELDS[kind]] = value
    for _ in range(r.u16()):
        r.u8()
    for _ in range(r.u16()):
        r.u8(); r.u32()
    oggs = []
    for _ in range(r.u16()):
        filename = r.lenstr(); r.lenstr(); r.lenstr()
        delay = r.u32(); flags = r.u32()
        oggs.append({'filename': filename, 'delay_ms': delay, 'flags': flags})
    beat_count = r.u32()
    beats = []
    for _ in range(beat_count):
        r.u32()  # ppqn: tempo, not needed since positions are already in milliseconds
        pos = r.u32()
        flags = r.u32()
        r.i8()  # key signature
        beats.append({'pos_ms': pos, 'flags': flags})
    text_count = r.u32()
    texts = []
    for _ in range(text_count):
        text = r.lenstr()
        beat_index = r.u32()
        track = r.u16()
        flags = r.u16()
        texts.append({'text': text, 'beat_index': beat_index, 'track': track, 'flags': flags})
    for _ in range(r.u32()):  # top-level custom data blocks: beat float timings / start-end
        size = r.u32()
        r.u32()
        r.skip(size)  # top-level blocks: size excludes the id field already read (confirmed via save routine)
    track_count = r.u32()
    tracks = []
    for index in range(track_count):
        name = r.lenstr()
        fmt = r.u8(); behavior = r.u8(); ttype = r.u8(); difficulty = r.u8()
        flags = r.u32()
        r.u16()  # compliance flags: unused
        altname = r.lenstr() if flags & TRACK_FLAG_ALT_NAME else ''
        track = {'index': index, 'name': name, 'altname': altname, 'format': fmt, 'behavior': behavior,
                 'type': ttype, 'difficulty': difficulty, 'flags': flags}
        if fmt == 0:
            pass
        elif fmt == TRACK_FORMAT_LEGACY or fmt == TRACK_FORMAT_VARIABLE_LEGACY:
            r.u8()  # lane/key count
            track['note_count'] = _skip_legacy_notes(r)
        elif fmt == TRACK_FORMAT_VOCAL:
            track['lyric_count'] = _skip_vocal_lyrics(r)
        elif fmt == TRACK_FORMAT_PRO_KEYS:
            track['chord_count'] = _skip_pro_keys_chords(r)
        elif fmt == TRACK_FORMAT_PRO_GUITAR:
            track.update(_read_pro_guitar_track(r))
        else:
            raise EofError(f'Unsupported EOF track format {fmt} in track {index}')
        if fmt != TRACK_FORMAT_PRO_GUITAR:
            track['sections'] = _read_sections(r)
            for _ in range(r.u32()):
                size = r.u32(); r.u32()
                r.skip(max(0, size - 4))
        tracks.append(track)
    return {'revision': revision, **strings, 'oggs': oggs, 'beats_ms': beats, 'texts': texts, 'tracks': tracks}


# --- Mapping onto OCE's project/arrangement schema -------------------------------------

BEAT_FLAG_START_4_4, BEAT_FLAG_START_3_4, BEAT_FLAG_START_5_4, BEAT_FLAG_START_6_4 = 4, 8, 16, 32
BEAT_FLAG_CUSTOM_TS, BEAT_FLAG_START_2_4 = 64, 512
_BEAT_START_TS = {BEAT_FLAG_START_2_4: (2, 4), BEAT_FLAG_START_3_4: (3, 4), BEAT_FLAG_START_4_4: (4, 4),
                  BEAT_FLAG_START_5_4: (5, 4), BEAT_FLAG_START_6_4: (6, 4)}


def _beats_seconds(beats):
    """OCE's beat grid: {time, measure (-1 off the downbeat), numerator, denominator,
    meterStart}, matching the same convention used for native Rocksmith XML import."""
    out = []
    measure = 0
    numerator, denominator = 4, 4
    for index, beat in enumerate(beats):
        pos_ms, flags = beat['pos_ms'], beat['flags']
        start = False
        if flags & BEAT_FLAG_CUSTOM_TS:
            numerator = (flags >> 24) & 0xFF
            denominator = (flags >> 16) & 0xFF
            start = True
        else:
            for bit, ts in _BEAT_START_TS.items():
                if flags & bit:
                    numerator, denominator = ts
                    start = True
                    break
        if start or index == 0:
            measure += 1
        out.append({'time': round(pos_ms / 1000.0, 9), 'measure': measure if start or index == 0 else -1,
                    'numerator': numerator, 'denominator': denominator, 'meterStart': index == 0})
    return out


def _note_techniques(note, warnings):
    flags = note['flags']
    tech = {}
    if flags & NOTE_FLAG_HO:
        tech['hammer_on'] = True
    if flags & NOTE_FLAG_PO:
        tech['pull_off'] = True
    if flags & NOTE_FLAG_TAP:
        tech['tap'] = True
    if flags & (NOTE_FLAG_SLIDE_UP | NOTE_FLAG_SLIDE_DOWN):
        # OCE requires an integer slide destination fret (>= -1); EOF only stores one when
        # RS_NOTATION is also set.
        tech['slide_to'] = note['slide_end'] if note['slide_end'] is not None else -1
    if flags & NOTE_FLAG_UNPITCH_SLIDE:
        tech['slide_unpitch_to'] = note['unpitch_end'] if note['unpitch_end'] is not None else -1
    if flags & NOTE_FLAG_BEND:
        # OCE requires a finite bend amount; EOF only stores one when RS_NOTATION is also set.
        tech['bend'] = note['bend_strength'] if note['bend_strength'] is not None else 1
    if flags & NOTE_FLAG_HARMONIC:
        tech['harmonic'] = True
    if flags & NOTE_FLAG_P_HARMONIC:
        tech['harmonic_pinch'] = True
    if flags & NOTE_FLAG_STRING_MUTE:
        tech['mute'] = True
    if flags & NOTE_FLAG_PALM_MUTE:
        tech['palm_mute'] = True
    if flags & NOTE_FLAG_VIBRATO:
        tech['vibrato'] = True
    if flags & NOTE_FLAG_ACCENT:
        tech['accent'] = True
    if flags & NOTE_FLAG_LINKNEXT:
        tech['link_next'] = True
    if flags & NOTE_FLAG_POP:
        tech['pluck'] = True
    if flags & NOTE_FLAG_SLAP:
        tech['slap'] = True
    return tech


def _track_frets(note, numstrings):
    """{string_index: fret} for every string this note actually plays, in OCE's string
    numbering (string 0 = the same string EOF/Rocksmith's own bit 0 and tuning[0] mean)."""
    return {string: note['frets'][string] for string in range(numstrings) if note['string_mask'] & (1 << string)}


def _eof_track_arrangement(track, index, warnings):
    numstrings = track['numstrings']
    tuning = list(track['tuning'])
    kind = 'bass' if numstrings == 4 else 'guitar'
    name = track['altname'] or track['name'] or f'Arrangement {index + 1}'
    notes, chords = [], []
    templates, template_index = [], {}
    sections = track['sections']
    # Fret hand positions (anchors): EOF reuses the generic section's "end" slot to carry the
    # fret, not a real end-timestamp (confirmed against EOF's own save code); width is a
    # runtime-computed display value in EOF itself, not stored, so OCE's default stands in.
    anchors = [{'time': round(start / 1000.0, 9), 'fret': max(1, fret), 'width': 4}
               for _, _, start, fret, _ in sections.get(SECTION_FRET_HAND_POS, [])]
    # Tone changes: name carries the tone name directly; "end"==1 marks the track's default tone.
    tone_changes = [{'time': round(start / 1000.0, 9), 'name': tone_name}
                     for tone_name, _, start, is_default, _ in sections.get(SECTION_RS_TONE_CHANGE, []) if tone_name]
    for n_index, note in enumerate(track['notes']):
        time = round(note['pos'] / 1000.0, 9)
        sustain = round(note['length'] / 1000.0, 9)
        frets = _track_frets(note, numstrings)
        if not frets:
            continue
        techniques = _note_techniques(note, warnings)
        if len(frets) == 1:
            (string, fret), = frets.items()
            note_techniques = dict(techniques)
            finger = (note.get('fingers') or {}).get(string)
            if finger is not None:
                note_techniques['left_hand'] = finger
            notes.append({'id': f'n{n_index}', 'time': time, 'string': string, 'fret': fret,
                          'sustain': sustain, 'techniques': note_techniques})
        else:
            key = (tuple(sorted(frets.items())), note['name'] or None)
            template_id = template_index.get(key)
            if template_id is None:
                template_id = len(templates)
                template_index[key] = template_id
                template_frets = [-1] * numstrings
                template_fingers = [-1] * numstrings
                for string, fret in frets.items():
                    template_frets[string] = fret
                    finger = (note.get('fingers') or {}).get(string)
                    if finger is not None:
                        template_fingers[string] = finger
                templates.append({'frets': template_frets, 'fingers': template_fingers,
                                   'displayName': note['name'] or f'Chord {template_id + 1}'})
            chord_notes = []
            for string, fret in sorted(frets.items()):
                note_techniques = dict(techniques)
                finger = (note.get('fingers') or {}).get(string)
                if finger is not None:
                    note_techniques['left_hand'] = finger
                chord_notes.append({'id': f'chord-{n_index}-string-{string}', 'time': time, 'string': string,
                                    'fret': fret, 'sustain': sustain, 'techniques': note_techniques})
            chords.append({'id': f'c{n_index}', 'time': time, 'sustain': sustain, 'chord_id': template_id,
                          'notes': chord_notes})
    if track['tech_notes']:
        warnings.append(f"{name}: {len(track['tech_notes'])} EOF 'tech notes' (alternate fingering/technique "
                         "variants) were not imported; only the primary note data was read")
    arr = {'id': f'eof-track-{track["index"]}', 'name': name, 'type': kind, 'tuning': tuning,
           'stringCount': numstrings, 'capo': 0, 'notes': notes, 'chords': chords,
           'chord_templates': templates, 'anchors': anchors, 'handshapes': []}
    if tone_changes:
        arr['tones'] = {'base': tone_changes[0]['name'], 'changes': tone_changes, 'definitions': {}}
    return arr


def eof_project(parsed, warnings=None):
    """Build an OCE project dict (minus _pack/audio, which the caller attaches) from a
    parsed EOF project. Only pro guitar/bass tracks become arrangements."""
    if warnings is None:
        warnings = []
    beats = _beats_seconds(parsed['beats_ms'])
    # EOF keeps a fixed catalog of track slots regardless of whether a song actually uses
    # them (e.g. a second bass track reserved but never charted); skip the empty ones.
    pro_guitar_tracks = [t for t in parsed['tracks'] if t['format'] == TRACK_FORMAT_PRO_GUITAR and t['notes']]
    if not pro_guitar_tracks:
        raise EofError('This EOF project has no pro guitar/bass notes to import')
    arrangements = [_eof_track_arrangement(t, i, warnings) for i, t in enumerate(pro_guitar_tracks)]
    duration = max([beats[-1]['time'] if beats else 0] +
                   [n['time'] + n['sustain'] for arr in arrangements for n in arr['notes']] +
                   [c['time'] + c['sustain'] for arr in arrangements for c in arr['chords']])
    project = {'version': 1, 'title': parsed.get('title', 'Untitled'), 'artist': parsed.get('artist', ''),
               'duration': duration, 'beats': beats, 'sections': [], 'arrangements': arrangements}
    for key in ('album', 'year'):
        if parsed.get(key):
            project[key] = parsed[key]
    if parsed.get('frettist'):
        project['charterName'] = parsed['frettist']
    if warnings:
        project['import_warnings'] = warnings
    return project
