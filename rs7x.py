"""Seven-string guitar for the DLC Builder project export, in the RS7X layout.

RS7X (format 1) is the convention of the rs7string mod for Rocksmith 2014
Remastered: https://github.com/SomeeName/rs7string/blob/main/docs/release/RS7X-SPEC.md
(MIT). It applies to the RS2014 / DLC Builder output only. FeedPak and loose
FeedBack folders have their own extended-range schema and never pass through
here.

What this module does: puts a seven-string arrangement into the RS7X string
order (stock strings 0-5 = low E .. high e, the low B = string 6), checks the
spec's rules, and describes the extra data in `rs7x.json` beside the XML.

What it does not do: the RS7X block lives inside the compiled SNG, and the
`Rs7String6` tuning key in the package manifest and HSAN. Compiling SNG and
building packages is the job of a downstream tool; this editor writes sources
only (see docs/rs7x-export.md).
"""
import copy

try:
    from . import pack_io
except ImportError:
    import pack_io

SPEC_URL = 'https://github.com/SomeeName/rs7string/blob/main/docs/release/RS7X-SPEC.md'
SIDECAR = 'rs7x.json'
FORMAT = 'oce-rs7x-sources'
LOW_B = 35          # open MIDI pitch of RS7X string 6 at tuning offset 0
NAME_LIMIT = 30     # printable ASCII; the 32-byte name keeps its last byte 0


def applies(arr):
    """True for an arrangement the DLC Builder export writes in the RS7X layout."""
    return arr.get('type') == 'guitar' and arr.get('stringCount') == 7 and arr.get('editorOnly') is not True and arr.get('_notationOnly') is not True


def refusal(arr):
    """Why an extended-range part has no RS7X export, or None."""
    kind, count = arr.get('type'), arr.get('stringCount')
    if kind == 'guitar' and count == 8:
        return 'Eight-string guitar: RS7X defines it, but rs7string 1.0 does not play it yet, so it is not exported.'
    if kind == 'bass' and count in (5, 6):
        return 'Five- and six-string bass are not defined in RS7X version 1.'
    return None


def _rs_string(string):
    """Editor string (0 = lowest, the low B) to the RS7X index."""
    return 6 if string == 0 else string - 1


def _columns(values):
    """Editor-order per-string list to the RS7X order: [s1..s6, s0]."""
    values = list(values) + [-1] * (7 - len(values))
    return values[1:7] + values[:1]


def _ascii(text):
    return all(32 <= ord(c) < 127 for c in text)


def validate(project, arr):
    name = arr.get('name', arr.get('id', 'Arrangement'))
    def fail(message):
        raise pack_io.ProjectError(f'{name} (RS7X seven-string): {message}')
    if not applies(arr):
        fail('only seven-string guitar charts use the RS7X layout')
    bases = arr.get('basePitches') or pack_io._instrument_bases('guitar', 7)
    tuning = list(arr.get('tuning', [])) + [0] * 7
    open_pitches = [bases[i] + tuning[i] for i in range(min(7, len(bases)))]
    # The extra string sits below a guitar's six (top string at most F#4); a high-A
    # seven-string has no RS7X equivalent.
    if len(open_pitches) != 7 or open_pitches != sorted(set(open_pitches)) or open_pitches[6] > 66:
        fail('the seventh string must be the lowest (a low B type string); this string layout has no RS7X equivalent')
    pack_io.arrangement_role(arr)
    for owner in [arr] + arr.get('difficulties', []):
        for note in owner.get('notes', []) + [n for c in owner.get('chords', []) for n in c.get('notes', [])]:
            if not 0 <= note.get('fret', 0) <= 24:
                fail('frets must be 0-24')
    for index, template in enumerate(arr.get('chord_templates', [])):
        label = template.get('name') or f'chord shape {index + 1}'
        for key in ('name', 'displayName'):
            text = str(template.get(key, ''))
            if not _ascii(text) or len(text) > NAME_LIMIT:
                fail(f'chord name "{text}" must be printable ASCII of at most {NAME_LIMIT} characters')
        frets = list(template.get('frets', [])) + [-1] * 7
        fingers = list(template.get('fingers', [])) + [-1] * 7
        if not any(f >= 0 for f in frets[1:7]):
            fail(f'{label} uses only the low B; a chord shape needs at least one note on the six stock strings')
        if frets[0] == -1 and fingers[0] != -1:
            fail(f'{label} has a finger on the low B but no fret')
        if not -1 <= fingers[0] <= 4:
            fail(f'{label} has an invalid low B finger')
    for phrase in arr.get('phrases', project.get('phrases')) or []:
        if not _ascii(str(phrase.get('name', ''))):
            fail(f'phrase name "{phrase.get("name")}" must be printable ASCII')
    for section in project.get('sections', []):
        if not _ascii(str(section.get('name', ''))):
            fail(f'section name "{section.get("name")}" must be printable ASCII')


def stock_order(arr):
    """A copy of a seven-string arrangement in the RS7X string order.

    Notes and chord members move to the RS7X string index; chord shapes and
    the tuning reorder to [low E .. high e, low B]. `_rs7xOffsets` carries the
    seven tuning offsets save_xml writes (stock strings against E standard,
    string 6 against MIDI 35). Applying it twice changes nothing.
    """
    if arr.get('_rs7xOrdered'):
        return arr
    offsets, _ = pack_io._effective_tuning(arr)
    out = copy.deepcopy(arr)
    for owner in [out] + out.get('difficulties', []):
        for note in owner.get('notes', []):
            note['string'] = _rs_string(note['string'])
        for chord in owner.get('chords', []):
            for note in chord.get('notes', []):
                if 'string' in note:
                    note['string'] = _rs_string(note['string'])
                elif 's' in note:
                    note['s'] = _rs_string(note['s'])
    for template in out.get('chord_templates', []):
        for key in ('frets', 'fingers'):
            if key in template:
                template[key] = _columns(template[key])
    out['basePitches'] = _columns(arr.get('basePitches') or pack_io._instrument_bases('guitar', 7))
    out['tuning'] = _columns(arr.get('tuning', [0] * 7))
    out['_rs7xOffsets'] = _columns(offsets)
    out['_rs7xOrdered'] = True
    return out


def describe(project, arr, xml_path):
    """The sidecar record for one arrangement (written in the RS7X order)."""
    ordered = stock_order(arr)
    offsets = ordered['_rs7xOffsets']
    owners = [ordered] + ordered.get('difficulties', [])
    singles = sum(1 for o in owners for n in o.get('notes', []) if n.get('string') == 6)
    in_chords = sum(1 for o in owners for c in o.get('chords', []) if any(n.get('string') == 6 for n in c.get('notes', [])))
    templates = []
    for index, template in enumerate(ordered.get('chord_templates', [])):
        frets = template.get('frets', [-1] * 7)
        fingers = template.get('fingers', [-1] * 7)
        templates.append({'chordId': index, 'name': template.get('name', ''),
                          'stockFrets': frets[:6], 'stockFingers': fingers[:6],
                          'extended': [{'string': 6, 'fret': frets[6], 'finger': fingers[6] if frets[6] >= 0 else -1}]})
    times = sorted({n.get('time', 0) for o in owners for n in o.get('notes', []) if n.get('string') == 6} |
                   {c.get('time', c.get('t', 0)) for o in owners for c in o.get('chords', []) if any(n.get('string') == 6 for n in c.get('notes', []))})
    sections = sorted(project.get('sections', []), key=lambda s: s.get('start_time', s.get('time', 0)))
    def section_at(time):
        found = None
        for s in sections:
            if s.get('start_time', s.get('time', 0)) <= time:
                found = s.get('name')
        return found
    return {'id': arr['id'], 'name': arr.get('name', arr['id']), 'xml': xml_path,
            'role': pack_io.arrangement_role(arr), 'stringCount': 7,
            'tuning': offsets,
            'manifestTuning': {**{f'string{i}': offsets[i] for i in range(6)}, 'Rs7String6': offsets[6]},
            'lowBOpenMidi': LOW_B + offsets[6],
            'string6': {'singleNotes': singles, 'chords': in_chords,
                        'sections': sorted({s for s in map(section_at, times) if s is not None})},
            'chordTemplates': templates}


def sidecar(records):
    return {'format': FORMAT, 'version': 1,
            'spec': {'name': 'RS7X', 'formatVersion': 1, 'url': SPEC_URL},
            'stringOrder': 'strings 0-5 are the stock low E to high e; string 6 is the low B',
            'built': False,
            'note': ('Sources only. The arrangement XML already uses the RS7X string order and seven tuning entries. '
                     'A compiler still has to write the RS7X block (STRS, CHDT, CHNT) into the SNG, and '
                     'Rs7String6 (never string6) into the manifest and HSAN tuning. Stock DLC Builder cannot do this.'),
            'compilerRules': [
                'SNG MetaData tuning: exactly seven entries (tuning below).',
                'Chord templates: stock six columns as a valid view of strings 0-5; the low B goes to CHDT only, never into a spare stock MIDI slot; keep the 32-byte name\'s last byte 0.',
                'Deduplicate chord templates and ChordNotes on all seven columns.',
                'ChordNotes record when any string, stock or low B, is open or has a technique; an open low B needs OPEN (0x4) in CHNT.',
                'DOUBLE_STOP (0x02000000) counts the low B.',
                'Section StringMask bit 6 where the low B is used, chords included.',
                'Manifest and HSAN Tuning: string0..string5, then Rs7String6.',
                'Printable ASCII DLC key, file names and chord, section and phrase names.'],
            'arrangements': records}
