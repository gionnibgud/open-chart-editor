Local FeedBack installation and host verification

This plugin has the separate id open_chart_editor. Its destination is:
  I:\Dev\freedBack\feedBack\plugins\open_chart_editor
It does not rename, replace or delete the existing editor plugin (id editor),
edit host core, invoke Git, install dependencies, restart the user's running
FeedBack service or touch the user's music library/configuration.

1. Verify an isolated snapshot using actual FeedBack loaders:
     python tools/verify-host.py

   The test uses the local host source at I:\Dev\freedBack\feedBack. It imports
   plugins/__init__.py directly, substitutes an isolated PLUGINS_DIR, and loads
   only open_chart_editor. No server.py import or unrelated plugins are involved.
   It validates the real manifest schema, setup/routes, plugin API metadata,
   source/assets MIME, ETag revalidation and traversal rejection. A temporary
   loopback-only server then runs actual core static/js/plugin-loader.js in a
   minimal shell with public navigation/event seams and core Tailwind. Headless
   Chromium verifies nav/style/module injection, visible canvas drawing, tones,
   leave/re-enter state and repeated loader hydration without duplication.
   It loads actual static/capabilities.js and capabilities/playback.js, then
   runs the original playtest module through real plugin Feedpak export and
   core upload/delete routes. An isolated MetadataDB and library contain only
   the test's original silent WAV and two empty charts. Beginning/cursor times,
   arrangement index, native dispatch result/session identity, removal and
   retained editor selection are verified. The physical player adapter and
   origin navigation are explicit test doubles; no audio/highway playback is
   claimed. Scanner requests are counted without starting the real scanner.
   Network requests outside loopback are blocked. No browser/dependencies are
   downloaded. Existing .NET/audio tooling is not run by this test.

   All candidate/config/library/temp/log/screenshot files stay under
   tools/.host-runs/<uuid>. The result is research/host-integration.json.
   The installer is also checked for unchanged-file idempotence and exact
   changed-file backups inside that isolated directory.

   This covers the real backend/frontend loader boundary. It does not claim
   the full production shell, every other installed plugin, user audio devices,
   a complete CDLC build or game playback has been tested.

   Additional production shell/audio/highway gate:
     python tools/verify-highway.py

   This imports actual host server.py, runs its production v3 shell, core
   playback adapter, WebSocket chart loader and actual highway renderers.
   The staged OCE plugin and only the actual installed Piano, Keys Highway
   3D and Drum Highway 3D providers are loaded through the real plugin loader.
   Exact workspace junctions expose those providers read-only; their assets are
   neither copied into our plugin nor packaged. Provider identity/version/hashes
   are recorded. MIDI permission is rejected by a browser stub before renderer
   initialization, so no input hardware can be opened.
   CONFIG_DIR/DLC_DIR/cache/temp/log/profile/SQLite stay in tools/.host-runs.
   FEEDBACK_SKIP_STARTUP_TASKS=1 and FEEDBACK_ENRICH_OFFLINE=1 disable normal
   startup/enrichment; the router's scanner scheduling dependency is an
   observable no-op in this test process. Outbound server sockets/DNS and
   external browser requests are blocked. Core source files are never edited.
   The existing cached pure-Python structlog/asgi-correlation-id/defusedxml
   wheels may be read via zipimport if those dependencies are absent. Their
   paths/hashes are reported; nothing is installed, copied or downloaded.

   It builds original WAV audio and guitar, five-string bass, eight-string
   guitar, piano boundary pitches 0/127 with hands, and canonical drum hits.
   The source project deliberately places drums before the other pitched
   arrangements to expose index/remapping and unrelated-renderer mistakes.
   Actual upload, beginning/cursor play, decoded duration/media clock,
   received chart data, instrument-specific canvas, and return with selection,
   zoom and scroll intact. It removes only its own UUID preview archives.
   Chromium is muted; physical audio devices and game compatibility are not
   tested. A workspace-only test profile bypasses unrelated first-run setup.

   Targeted playbackPassed and fullShellClean are separate report fields.
   Every unexpected core HTTP error is retained. This Windows/Python host
   baseline exhibited concurrent SQLite statement-cache errors in library,
   enrichment and stats APIs. A separately reviewed one-line host compatibility
   change resolved the reproduced cases and passed 142 existing host tests;
   research/host-fixes/applied.json records its backup and exact source hash.
   The highway report records the actual loaded MetadataDB path/hash. Neither
   this verifier nor the plugin installer changes that host source. Missing
   optional tuner/minigames routes and blocked Google Fonts are also reported.
   See research/highway-integration.json and the run's screenshots/server log.

   Full-range piano uses the separately installed local Piano Highway provider
   (piano, 4.1.0+oce.1). Bundled Keys Highway 3D requires notation sidecars
   and its visible key range is MIDI21..108; it cannot replace the full-range
   wire-note provider. Drum Highway 3D consumes the native drum-tab export and
   needs WebGL2; the gate renders it with software SwiftShader and checks the
   real composited canvas. This does not establish physical device accuracy.

   tools/install-piano.py prepares a reviewed local derivative from the existing
   MIT-declared I:\Dev\freedBack\feedBack-plugin-piano repository. Its closed
   allowlist has four runtime files plus NOTICE.txt, exact original/local hashes,
   a narrow patch and a digest. --apply --expect-source-digest refuses any
   existing Piano destination rather than overwriting another installation.
   The patch removes automatic MIDI discovery/remote synth loading on chart view
   and settings open; Connect MIDI and Enable sound (downloads) are explicit.
   MIDI dropdown/range settings remain usable; optional live sound still uses
   upstream WebAudioFont downloads when explicitly enabled. Preparation,
   installation and tests download nothing. tests/browser-piano-dependency.mjs
   proves these controls using fake MIDI and blocked network; no device opens.
   Provenance, license notice, patch and installation hashes are recorded under
   research/piano-dependency. Existing 3D providers and user settings are not edited.

2. Review the explicit installation plan (does not copy anything):
     python tools/install-local.py

   The JSON lists every selected relative file, byte count and SHA256, plus
   prior destination hashes/actions. sourceDigest binds the complete reviewed
   runtime list to its contents. Only the closed RUNTIME_FILES allowlist and
   optional original feature-coverage.json can be installed. No directory glob
   can copy research, decompilation, private .rsw, fixtures/tests, PSARCs, build
   outputs, .git, node_modules or bytecode caches. Review any allowlist expansion
   if the frontend later imports additional runtime modules.

3. After source changes stop, apply the reviewed digest:
     python tools/install-local.py --apply --expect-source-digest <sourceDigest>

   The current sandbox may require tool elevation because this destination is
   outside the research workspace. The operation is authorized as a local
   installation; it performs no remote publication. Changed existing explicit
   files are first copied to tools/.host-backups/<uuid>, with an installation
   record. Unexpected files are left alone. Existing destination manifests for
   another plugin and symlink paths are refused. No recursive deletion or
   directory replacement occurs. Sources changing after review cause refusal.

4. Start the intended local FeedBack host normally when ready. Open its Plugins
   navigation and select OCE. A browser refresh picks up frontend changes;
   backend route changes need a normal host restart. These scripts do not
   control or restart an existing user service.

The development standalone preview remains available separately with
dev_server.py. Passing its browser tests alone is not host-loader verification;
use verify-host.py for that integration boundary.

The production highway gate also checks normal library export independently of
playtest preparation: unchanged imported notation keeps its exact source bytes;
editing its pitch/hand detaches the stale manifest reference with an export
warning while retaining the opaque file. Actual host Auto then consumes the
edited wire chart through the compatible Piano renderer. The gate verifies the
SaveAs warning in the editor. This does not generate or reconstruct engraving.

History supports clicking retained undo/redo steps and setting/returning to one
checkpoint. Checkpoints expire when their state is evicted or discarded by a
new branch. Merely opening history or setting a checkpoint changes no song data;
navigating steps changes the editable project and marks it unsaved.

File > Welcome and File > Open Recent offer complete browser-cached files.
Only explicitly opened files and saved editable JSON are cached, with at most
12 entries, 128 MiB total and 64 MiB per file. Saving editable JSON replaces
its source entry with the latest full project and embedded original audio.
Cache eviction/quota/private-mode failures do not prevent authoring or saving;
keep actual saved files for permanent storage. Remove deletes only a cache
entry. No folder scanning, native file permission request or network occurs.

Chords > Generate fingerprint zones groups existing matching-template strums
using explicit beat gap/tail/gutter controls. It preserves notes and sustains,
protects existing fingerprint/arpeggio overlaps, and skips incompatible held
notes or partly contained child chord zones. Remove fingerprint zones supports
a selected half-open time range or the entire current difficulty; an explicit
all-zone option also removes ordinary chord/arpeggio zones. Neither command
deletes sounding chords or notes. Other stored difficulty levels stay intact.
Both commands use ordinary undo. This is an original defined algorithm, not an
assertion of the retail missing-chord-data autocomplete algorithm.
