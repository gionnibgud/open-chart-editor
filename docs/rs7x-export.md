# Seven-string export (RS7X) and the SNG / PSARC boundary

Decision recorded 2026-10-25.

## What OCE does

The DLC Builder project export (`rs2014_sources`) writes seven-string guitar
arrangements in the layout of the RS7X specification, format 1, used by the
rs7string mod for Rocksmith 2014 Remastered:
https://github.com/SomeeName/rs7string/blob/main/docs/release/RS7X-SPEC.md (MIT).

- Selecting a seven-string guitar part for the DLC Builder project always uses
  this layout. There is no other RS2014 path for seven strings.
- The arrangement XML uses the RS7X string order: strings 0-5 are the stock
  low E to high e, and the low B is string 6. Notes, chord members and chord
  shapes (`fret6`/`finger6`) are reordered on the output copy. The tuning has
  seven entries (`string0`..`string6`).
- `rs7x.json` sits beside the XML. It holds the manifest/HSAN tuning object
  (`string0`..`string5` then `Rs7String6`, never `string6`), each chord shape's
  low-B column, where the low B is used, and the rules a compiler must follow.
- The rules checked before export: guitar with exactly seven strings, the
  extra string is the lowest, frets 0-24, every chord shape keeps a note on the
  six stock strings, and chord, phrase and section names are printable ASCII
  (chord names at most 30 characters). Eight-string guitar and five- or
  six-string bass are refused: RS7X 1.0 does not cover them for players.
- `project.rs2dlc` stays the public DLC Builder format, with six tuning
  offsets. Stock DLC Builder cannot write the RS7X block, so the export says
  so and is marked not ready to play.
- Six-string guitar and four-string bass in the same project are written
  exactly as before.
- The editable master keeps the editor's own string order.

The code is `rs7x.py`, used only by `export_targets.rs2014_sources` and by
`pack_io.save_xml(..., rs7x=True)`.

## FeedPak and loose folders are separate

RS7X is a Rocksmith 2014 / rs7string convention. FeedPak and FeedBack loose
folders have their own extended-range schema. Nothing from RS7X (`rs7x.json`,
`Rs7String6`, the string reordering or its limits) goes into those outputs, and
`native_compatibility()['compatible']` stays false for seven-string parts, so
the loose folder writes no seven-string XML mirror.

## What OCE does not do, and why

OCE does not compile SNG files, does not build PSARC packages, and does not
touch PSARC or SNG encryption. It writes sources for another tool to build.

- The RS7X block itself (`STRS`, `CHDT`, `CHNT`) lives inside the compressed
  SNG body. The SNG chord-template projection, ChordNotes records,
  double-stop bits and section string masks are SNG data too.
- `Rs7String6` belongs in the package manifest and HSAN, which are written
  when the package is built.
- The spec's package is a plain (unencrypted) PSARC.

OCE stays a project producer: it hands DLC Builder, or another builder, a
ready project and does not do the builder's job.

## If rs7chart (or another RS7X builder) publishes an input format

The spec names rs7chart as its reference writer, to be published later, with
a YAML chart input. When its input format is published, OCE can add an export
for it, or extend `rs7x.json`, as long as the export stays on the source side.

Allowed: anything that describes the chart for the builder, such as chart
data, the seven-column chord shapes, tuning, tones, manifest values and
section names, in whatever text or JSON format the builder reads.

Not allowed: anything that needs or touches Ubisoft's PSARC or SNG encryption
keys, in any direction (encrypting, decrypting, signing, or reading encrypted
packages). If a builder's input ever requires that, OCE stops at the step
before it.

The longer-term option is RS7X support in DLC Builder itself (its SNG and
manifest code is in Rocksmith2014.NET, MIT). That would let the same project
build directly.
