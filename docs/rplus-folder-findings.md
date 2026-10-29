# R+ loose folders, keyboard charts and .rsw: findings (2026-10-24)

Status: research notes; R+ folder import and keyboard export have since been implemented.

## Offset handling (2026-10-29)
- On folder import, each arrangement's `<offset>` is subtracted from absolute
  timestamps (notes, beats, sections, phrase iterations, events and tone changes).
  Pre-audio beat markers are omitted, and the chart is normalized to zero offset
  so edits/export do not apply the source offset a second time.
- The song grid is selected from Official non-HumStrum charts, favoring the beat map
  shared by the other arrangements and the authored lyrics beat map. Keyboard-only
  grid sources are avoided when a playable guitar/bass chart is available.
  HumStrum maps do not set the shared grid; a divergent map is reported as a warning.
- Lyrics vocal event times subtract `<offset>` to place syllables on the audio
  reference. For Bluey, `Mum` at 14.026 s becomes 11.705 s.
- Bluey Theme Tune (Instrument Parade): Lead, Bass, Simple/Keyboard and lyrics use
  the same 396-beat map with offset `2.321`; one HumStrum chart has a divergent map
  and offset `1.610`. The shared grid's measure 9 moves from `10.934` to `8.613` s.

## Goal (user request)
1. Open and edit an R+ song folder (test bed: Opeth - In My Time of Need scrape:
   `Official_*.xml` v19, `metadata.json`, `tone_*.json`, `lyrics_*.xml`, `audio.wem`,
   `album_art.jpg`, plus a separate piano `.mid`).
2. Import the MIDI piano onto the song's R+ beat map, check alignment against the audio.
3. Save a new R+-schema keyboard chart (`Official_Keyboard1_<uuid>_v1.xml`) into the
   same folder, never overwriting. FeedBack reads it as a loose folder as-is.
4. Optional: `.rsw` (R+ Workshop project) as a source, and save to it if safe.

## Today
- `export_targets.load_folder_archive` refuses R+ folders: `load_xml` requires
  `<song version="7">`; R+ is `version="19"` (one corpus file is 17).
- R+ `metadata.json` keys (`songName`, `artistName`, `albumName`, `songYear`,
  `arrangementInfoList`...) are not read; the loader looks for `title/artist/album/year`.
- Lyrics root is `<trueVocals>` (vocal: time, note, length, lyric), not `<vocals>`.
- `audio.wem` is Wwise Vorbis (fmt codec 0xFFFF): FFmpeg cannot decode it. vgmstream can:
  `C:/Program Files/Slopsmith/current/resources/bin/vgmstream-cli.exe` (also
  `I:/Dev/gp to feedpak docker/_ml_drift_model/vgmstream/`). FeedBack's
  `lib/audio.py` `_vgmstream_cmd` shows a resolution order worth mirroring.
- FeedBack `lib/loosefolder.py` already loads loose folders with `Official_Keyboard1_*.xml`
  ("keyboard" -> keys) and reads `midi=` as absolute pitch (`lib/song.py`).

## R+ keyboard XML conventions (949 official charts, measured)
- Header: `keyLower`/`keyUpper` after `<arrangement>`; `arrangement`/`instrument` = `Keyboard`;
  `tuning` all 0 on string0-5; `instrumentTone id` all zeros; `capo` 0.
- Note: `fret = midi - 20` (always), `midi`, `name` (spelling follows the `Key:` event;
  flats in flat keys), `octave = midi//12 - 1` (exceptions only for Cb/B#), `string="0"`,
  `staff` 1 = right hand/treble, 0 = left/bass; `clef` usually matches staff;
  `rightHand`/`leftHand` = finger 1-5 (optional); `sustain` (missing on ~0.7%).
  Optional: staccato, accent, graceNote, arp, voice, tremolo, linkNext, trill, slideTo,
  slideUnpitchTo, vibrato, bend; `<ottava>` child.
- Every note has `<beats><beat measure position length dots/></beats>`:
  `measure` = ebeat measure number + 1 (always); `position` = 1 + beat index in bar
  + fraction (matches ebeats for ~95%); `length` in beats (0.25, 0.5, 1, 2, 4, 0.3333
  triplets...), `dots` 0/1 (length is the undotted value); several `<beat>`s = tied
  pieces across barlines. Triplets also listed in `<level><tuplets>` (type 3).
- Level 0 only: `chords count=0`, `handShapes count=0`, `notes`, `anchors`, `tuplets`.
- Anchors sit at phrase-iteration times, `fret=keyLower`, `width = keyUpper-keyLower+1`.
  `keyLower/keyUpper` = min/max note fret in ~70% of charts, else padded.
- Events: `Key:F`/`Key:Bbm`, `tone:grandpiano`/`tone:synthstrings`, `Ped:on`/`Ped:off`,
  `B0`/`B1` (count-in), `Swing 8ths`/`Straight 16ths`.
- Phrases `default, A, B, ..., END` (maxDifficulty 0); sections as guitar charts.
- `metadata.json` `arrangementInfoList` rows: arrangementId, revision, arrangementType,
  instrument, tuning, toneIds, `supportedKeyboard`, `keyboardRange`. A new keyboard
  chart likely needs a row for R+ itself (unverified); FeedBack does not need it.

## Opeth MIDI (`Opeth - In My Time of Need (2) [MIDIfind.com].mid`)
`pack_io.load_midi` reads it: constant 70 BPM 4/4 (R+ map averages ~138, i.e. double
time), 378 beats, 323.6 s (R+ song 348.4 s). Tracks: "Guitarra 1" (2070 notes, from 0 s),
"Bajo" (463, from 13.7 s), "Teclados/Guit. 2" (248, from 51.4 s, pitch 52-79, the likely
keys part), drums (1393). Alignment needs work: half-tempo grid plus a different start.
Plan: merge with `align='beats'` after doubling MIDI beats (or fit with
`_audio_warp`/ensemble against the decoded audio), then check onsets vs the R+ guitar
charts, which share the audio's beat map.

## .rsw (R+ Workshop project)
Prior Codex research: `open-chart-editor/research/rsw-format.json` (opaque, unsupported).
New today: header `u16 version (23)`, `u32 file size`, `u32 checksum` (changes with
content; not CRC32/CRC32C/Adler32/FNV/Murmur3 over any tail), 16-byte GUID, int32-length
strings (album, title...), float song length, int32 year, tempo floats, then chord
templates as `Name_frets_fingers` strings plus 6 fret and 6 finger int32s (-1 = unused).
RSWorkshop.exe: `C:/Program Files (x86)/Ubisoft/Ubisoft Game Launcher/games/Rocksmith+/RSWorkshop/`.
Writing .rsw is blocked on the checksum; reading a subset (metadata, tempo, chord
templates, notes) looks feasible.

## Build plan
1. `rplus_io.py`: detect R+ folder; v19 guitar/bass -> v7 for `load_xml` (keep original
   XML; write unchanged charts back byte-identical); keyboard reader (pitch = `midi`,
   hand from staff, R+ extras kept per note); `trueVocals` lyrics; `metadata.json` details;
   tones kept as raw entries; `album_art.jpg` as cover.
2. `.wem` decode through vgmstream for preview, waveform and auto-align.
3. Keyboard writer per the conventions above; export "R+ song folder" adds only new files.
4. Tests: synthetic fixtures only (no R+ data in the repo).
5. MIDI piano import and alignment check on Opeth; write the chart into the song folder.
6. `.rsw` read-only import, if time allows.
