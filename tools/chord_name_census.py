"""Census of official Rocksmith+ chord names (local scrape, read-only).

For every chordTemplate: real pitches from tuning + capo + frets, the official
chordName split into root / suffix / slash bass, and the intervals the suffix
stands for. Output: research/chord-name-census.json (counts only, no song data; not tracked).
Usage: python tools/chord_name_census.py [SONGS_ROOT] [MAX_FILES]
"""
import collections
import json
import re
import sys
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else r"I:\Docker\RocksmithScrape\Songs")
LIMIT = int(sys.argv[2]) if len(sys.argv) > 2 else 4000
GUITAR, BASS = [40, 45, 50, 55, 59, 64], [28, 33, 38, 43]
LETTERS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
NAME = re.compile(r"^([A-G])([#b]?)(.*?)(?:/([A-G])([#b]?))?$")


def pitch_class(letter, accidental):
    return (LETTERS[letter] + {"#": 1, "b": -1, "": 0}[accidental]) % 12


suffixes = collections.defaultdict(collections.Counter)  # suffix -> interval-set counts
spelling = collections.defaultdict(collections.Counter)  # pitch class -> spelled root counts
slash = collections.Counter()
unnamed = collections.Counter()
strings_seen = collections.Counter()
files = 0
for path in sorted(ROOT.rglob("Official_*.xml")):
    if files >= LIMIT:
        break
    if "Vocals" in path.name or "lyrics" in path.name:
        continue
    try:
        root = ET.parse(path).getroot()
    except ET.ParseError:
        continue
    files += 1
    bass = "bass" in (root.findtext("arrangement") or "").lower()
    base = BASS if bass else GUITAR
    tuning = root.find("tuning")
    offsets = [int(tuning.get(f"string{i}", 0)) for i in range(6)] if tuning is not None else [0] * 6
    capo = int(root.findtext("capo") or 0)
    for template in root.iter("chordTemplate"):
        frets = [int(template.get(f"fret{i}", -1)) for i in range(6)]
        played = [(i, f) for i, f in enumerate(frets) if f >= 0 and i < len(base)]
        if len(played) < 2:
            continue
        strings_seen[len(played)] += 1
        pitches = sorted(base[i] + offsets[i] + f + (capo if f > 0 else 0) for i, f in played)
        name = (template.get("chordName") or "").strip()
        classes = frozenset(p % 12 for p in pitches)
        if not name:
            unnamed[len(classes)] += 1
            continue
        match = NAME.match(name)
        if not match:
            suffixes["<unparsed>"][name] += 1
            continue
        letter, accidental, suffix, bass_letter, bass_accidental = match.groups()
        root_pc = pitch_class(letter, accidental)
        spelling[root_pc][letter + accidental] += 1
        intervals = tuple(sorted({(p - root_pc) % 12 for p in pitches}))
        suffixes[suffix][intervals] += 1
        if bass_letter:
            slash["named bass is lowest pitch" if pitch_class(bass_letter, bass_accidental) == pitches[0] % 12 else "named bass is not lowest"] += 1
        else:
            slash["no slash, root is lowest" if pitches[0] % 12 == root_pc else "no slash, root not lowest"] += 1

report = {
    "files": files,
    "suffixes": {s: {"count": sum(c.values()), "intervals": [[list(k), v] for k, v in c.most_common(4)]}
                 for s, c in sorted(suffixes.items(), key=lambda kv: -sum(kv[1].values()))},
    "rootSpelling": {pc: dict(c) for pc, c in sorted(spelling.items())},
    "slash": dict(slash),
    "unnamedByPitchClassCount": dict(sorted(unnamed.items())),
    "notesPerShape": dict(sorted(strings_seen.items())),
}
out = Path(__file__).resolve().parents[1] / "research" / "chord-name-census.json"  # local evidence, not tracked
out.write_text(json.dumps(report, indent=1), encoding="utf-8")
print("files", files, "suffix kinds", len(report["suffixes"]), "->", out)
