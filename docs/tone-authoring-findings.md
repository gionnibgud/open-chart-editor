# Tones for FeedBack content: AmpliTube 5, Tone3000/NAM (findings, 2026-10-25)

Sources read: FeedPak spec 1.25 (§6.9 tones, §7.9
`rigs.json`), FeedBack core `lib/tones.py`/`feedpak.py`, plugins `at5_tone` 0.7.0 (desktop
user plugins), `nam_tone` 1.2.3, `tone3000_match` 0.5.4, `rig_builder` 3.1.6.

## OCE live AmpliTube preview status

OCE can host the installed AmpliTube 5 VST3 for live-input monitoring. Install
`requirements-vst3.txt` and make the FeedBack `at5_tone` plugin source available. OCE
discovers it from the sibling development checkout or the standard FeedBack Desktop plugin
folder; otherwise set `OCE_AT5_TONE_PLUGIN` to that plugin folder. If AmpliTube is not in the
standard Windows VST3 location, set `OCE_AMPLITUBE_VST3` to its binary or bundle path.

Open Mixer > Monitor live instrument, choose **AmpliTube 5 VST3**, and select the installed
AmpliTube model tier. OCE converts the currently selected chart tone's Rocksmith GearList
with FeedBack's existing RS-to-AT5 converter before monitoring starts, then applies converted
presets as chart tone markers change during playback. MAX is the default tier for the closest
available model matches. The conversion is an approximation, not an emulation of Rocksmith's
native DSP; unsupported gear may be omitted or mapped to a fallback by the converter.

Audio stays on the local machine and is not recorded. After the first session, OCE keeps the
VST3 instance loaded for reuse and releases it when the server shuts down. The browser-to-host
bridge supports 256-, 512-, and 1024-sample blocks, with 1024 as the default. Choose a smaller
block in the live-monitor dialog to reduce bridge latency; if you hear dropouts, select a larger
block. Block duration is only one part of total latency, and smaller blocks require more frequent
browser-to-host processing. Software tone preview remains available as a separate approximate
option.

## What the pack format already allows

FeedPak `rigs.json` (§7.9) is an engine-neutral rig library. Arrangements bind rigs by time
through `tones.base_rig` and `tones.changes[].rig` (beat-anchored since 1.x). Each block lists
`realizations` in preference order; a player renders the first engine it supports:

- `nam`: `ref` = pack-relative `.nam` capture (+ `sha256`). Tone3000 captures fit here.
- `ir`: `ref` = cabinet impulse response.
- `plugin`: `format` (`vst3`...), `id`, `name`, `vendor`, `preset`, `state` (base64), `params`.
  AmpliTube 5 fits here.
- `builtin`, `soundfont` (MIDI-voiced parts).

Every block SHOULD carry `intent` (kind/family/tags) and `params` so a player without that
engine or plugin can still approximate it. Readers that do not interpret rigs MUST keep
`rigs.json` verbatim. Rigs also live in loose folders through the typed bridge the editor
already writes (`manifest.yaml` + `rigs.json` inside the typed projection).

## What FeedBack actually reads today

| Piece | Reads rigs.json? | Where per-song tone data comes from |
|---|---|---|
| Core (`lib/tones.py`) | carries `base_rig`/`rig` bindings through; does not resolve them | `tones` in the chart |
| `at5_tone` | no (code comment: rig-aware matching is future work) | 1. `<song dir>/at5/<free|max>/<tone_key>.at5p`, song-local presets; 2. live conversion of Rocksmith-style gear data (`tone_*.json` sidecars, `tones.definitions`, legacy manifest entries) |
| `nam_tone` | no | its own uploaded `.nam`/IR store, presets (one model + optional IR), and a per-song tone-name -> preset mapping set in its UI |
| `tone3000_match` | no | reads the song's gear chains (same three shapes as at5), searches Tone3000, caches song-local in `tone3000_cache/` (loose / directory packs) or in config, then pushes models/presets/mappings into `nam_tone` over its HTTP API |

Consequences:

- **AmpliTube 5 works now** if a loose folder (or directory-form FeedPak) ships
  `at5/max/<tone>.at5p` (and/or `at5/free/` for the free edition), named after the chart's
  tone names. A zipped `.feedpak` cannot hold them where the plugin looks (it uses a folder
  beside the pack).
- **NAM / Tone3000 do not work from the pack yet.** A `.nam` file inside a pack is ignored by
  `nam_tone` today; the tone3000 plugin can fill the gap at play time from gear data, or a
  tool can push models/presets/mappings into `nam_tone` through its API.
- **Rocksmith tone data is the common input.** Both at5 and tone3000 convert RS-style gear
  lists (`tone_*.json` `toneData.GearList`). Keeping those definitions in exported content
  keeps both plugins working without any new tone authoring.

## Remaining proposed editor work

1. **Tone engines in the Tones view.** Per tone name: attach a NAM capture (+ optional cab IR),
   an authored AmpliTube 5 preset (`.at5p`, free/max), and/or a Tone3000 tone link (id, URL,
   licence), alongside the existing Rocksmith-style definition. Keep everything in the project
   master. Live AT5 monitoring currently uses the existing RS-to-AT5 conversion rather than
   persisted per-tone `.at5p` attachments.
2. **FeedPak / typed loose export.** Write one rig per tone in `rigs.json`: amp block
   realizations `nam` (asset under `rigs/nam/<sha256>.nam`) then `plugin` (vst3, IK
   Multimedia AmpliTube 5, preset name, preset file as an extra asset); cab block `ir`; always
   an `intent` and `params` derived from the RS gear where known. Bind with `base_rig` /
   `changes[].rig` (beat-anchored).
3. **Compatibility copies for today's plugins.** Loose folders and directory packs also get
   `at5/max|free/<tone>.at5p`, and RS-style `tone_*.json` / `tones.definitions` stay as they
   are, so `at5_tone` and `tone3000_match` work unchanged.
4. **Upstream (FeedBack, small):** `nam_tone` resolves `nam`/`ir` realizations from the
   song's `rigs.json` on load (auto-preset and mapping); `at5_tone` uses `plugin` realizations
   (vendor IK / AmpliTube 5) before converting gear. Both keep their current paths as fallback.
5. **Optional hand-off when the editor runs inside FeedBack:** push models/presets/mappings to
   `nam_tone`'s API, as tone3000 does, so authored tones work before the upstream change.

## Licensing and limits

- Tone3000 captures carry their own licences. Only redistributable ones (e.g. CC0, CC-BY,
  Tone3000 standard terms where they allow sharing) should be embedded in a shared pack;
  NC/ND captures should be linked by id, not packed. Record the licence with each rig.
- `.at5p` presets need the player's own AmpliTube 5 (free or max, gear differs by edition).
  The pack carries the preset, not IK's software or models.
- Rocksmith tones beyond pass-through (native DSP equivalence, gear licensing) remain out of
  scope for now, as agreed.

## Pipe dream (user, 2026-10-25): hear Rocksmith 2014 tones in the editor

Replicating the RS2014 tone system for testing tones would add a layer of compatibility, but
RS2014 renders gear through an old, proprietary Wwise build, so exact reproduction is unlikely.
What exists today: the editor auditions tones with its own original approximate models (amp
EQ plus 84 of 100 pedal/rack descriptors, unsupported ones disclosed); they are not the native
DSP. Routes worth watching rather than building now: per-gear NAM/IR captures of the RS amps
and cabs (a community capture set would let `nam`/`ir` realizations stand in for RS gear), and
the at5_tone gear mapping (RS gear -> AmpliTube equivalents) as a second approximation.
