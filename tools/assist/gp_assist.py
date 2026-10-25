"""Optional import assistance from a local gp-to-feedpak checkout (not bundled).

Commands (JSON result written to OUT):
  align-sync     SCORE AUDIO OUT   production FFT sync engine (run with the checkout's venv)
  align-ensemble SCORE AUDIO OUT   beat-SSM ensemble (run inside gp-to-feedpak:eval-beatthis)
  suggest        SCORE OUT [TRACK[:ROLE]...]  ML anchors/fingering/techniques, piano hands, per track
                 (ROLE: Lead, Rhythm, Bass, Keys... overrides the checkout's own track selection)

Paths: GP_TO_FEEDPAK_LIB (the checkout's lib), GP_TO_FEEDPAK_BATCH (its _msb_batch
research folder, ensemble only), OCE_EDITOR (this editor, for its GPIF repairs).
Never uses the Songsterr/YouTube network fallback.
"""
import json
import os
import sys
import tempfile
import types

HERE = os.path.dirname(os.path.abspath(__file__))
EDITOR = os.environ.get("OCE_EDITOR") or os.environ.get("WORKSHOP_EDITOR", os.path.dirname(os.path.dirname(HERE)))
LIB = os.environ.get("GP_TO_FEEDPAK_LIB", r"I:\Dev\gp to feedpak docker\lib")
for path in (os.environ.get("GP_TO_FEEDPAK_BATCH"), LIB, EDITOR):
    if path:
        sys.path.insert(0, path)

# The Songsterr/YouTube fallback goes online; an empty stand-in keeps it unusable.
sys.modules["songsterr_sync"] = types.ModuleType("songsterr_sync")
import gp_pipeline as gpp  # noqa: E402
import gp2rs_gpx  # noqa: E402
import pack_io  # noqa: E402

# Same bar-column, pitch and drum repairs the editor's own Guitar Pro import uses,
# so sync and ML see the bars and pitches the editor imports.
pack_io._gpif_note_repairs(gp2rs_gpx)


def _sync_tracks(score):
    tracks = gpp.list_tracks(score)
    _, names = gpp.gp2rs.auto_select_tracks(score)
    dense = gpp.filter_sparse_tracks(names, tracks)
    pick = lambda pool: {i: n for i, n in pool.items() if not n.lower().startswith(("drums", "keys"))}
    return tracks, pick(dense) or pick(names)


def align_sync(score, audio, out):
    import sync_engine as se
    tracks, primary = _sync_tracks(score)
    with tempfile.TemporaryDirectory() as work:
        xmls = [str(p) for p in gpp.convert(score, os.path.join(work, "conv"), list(primary), primary, audio_offset=0.0)]
        result, pool, _ = gpp.detect_sync_offset_robust(score, audio, work, list(primary), primary, tracks,
                                                        quiet=True, exhaustive=True, fill_gaps=True)
        _, chart, _ = se._parse_timestamps(xmls)
        _, duration = se.load_onset_envelope(audio)
        ship_ok, coverage, reason, _ = gpp.ship_gate(result, duration, reject_thin_coverage=True)
    trusted = sorted(((s.window_start_s + s.window_end_s) / 2.0, s.offset_s) for s in result.segments if s.trusted)
    fallback = result.offset if result.passed else 0.0
    chart = [float(t) for t in chart]
    audio_t = [t + se._interp_offset_for_time(t, trusted, fallback) for t in chart]
    confidence_ms = None if result.confidence_ms == float("inf") else round(result.confidence_ms, 1)
    _write(out, {"method": "sync-engine", "chart_t": chart, "audio_t": audio_t,
                 "confidence": {"good": bool(ship_ok), "summary": "passes the sync ship gate" if ship_ok else f"below the ship gate: {reason}",
                                "spreadMs": confidence_ms, "trustedWindows": len(trusted), "windows": len(result.segments),
                                "coverage": round(coverage, 3), "pool": pool}})


def align_ensemble(score, audio, out):
    import numpy as np
    import beat_ssm_sync as B
    import sync_engine as se
    _, primary = _sync_tracks(score)
    with tempfile.TemporaryDirectory() as work:
        xmls = [str(p) for p in gpp.convert(score, os.path.join(work, "conv"), list(primary), primary, audio_offset=0.0)]
        _, ebeats, _ = se._parse_timestamps(xmls)
        eb = np.asarray(ebeats, float)
        runs = {"dp": dict(tracker="dp", trusted_frac=9.0), "bt": dict(tracker="bt", downbeat_mu=0.3, offdiag_extra=0.1, diag_band=0)}
        maps = {}
        for key, kw in runs.items():
            r = B.sync_refined(xmls, eb, audio, tempo_prior="coarse", **kw)
            maps[key] = np.interp(eb, r["chart_t"], r["audio_t"])
        ens = B.sync_ensemble(xmls, eb, audio)
    agree = np.abs(maps["dp"] - maps["bt"])
    within = float((agree <= 0.1).mean())
    _write(out, {"method": "beat-ssm-ensemble", "chart_t": eb.tolist(), "audio_t": np.asarray(ens["audio_t"]).tolist(),
                 "confidence": {"good": within >= 0.6, "summary": f"its two beat trackers agree within 100 ms on {round(100 * within)}% of beats",
                                "agreeWithin100ms": round(within, 3), "agreeMedianMs": round(float(np.median(agree) * 1000), 1)}})


def suggest(score, out, indices):
    import torch
    import feedpak_build as fb
    import piano_pipeline as pp
    import rs_inference_v1 as ri
    device = torch.device("cpu")
    models, cal = ri.load_models(device), ri.load_calibration()
    tracks = {t["index"]: t for t in gpp.list_tracks(score)}
    _, names = gpp.gp2rs.auto_select_tracks(score)
    roles = {int(spec.split(":")[0]): spec.split(":")[1] for spec in indices if ":" in spec}
    wanted = [int(spec.split(":")[0]) for spec in indices] or sorted(names)
    suggestions, skipped = [], []
    with tempfile.TemporaryDirectory() as work:
        for index in wanted:
            role = roles.get(index) or names.get(index)
            name = tracks.get(index, {}).get("name", str(index))
            if not role:
                skipped.append({"track": index, "name": name, "reason": "no playable arrangement role"})
                continue
            # One track per conversion: tracks sharing a role (two "Combo" guitars) stay separate.
            xmls = [str(p) for p in gpp.convert(score, os.path.join(work, str(index)), [index], {index: role}, audio_offset=0.0)]
            try:
                if role.lower().startswith("keys"):
                    arrangement, kind = fb.build_piano_arrangement(pp.author_piano_track(xmls[0], device), name=role), "keys"
                elif role in gpp.GUITAR_BASS_ARRANGEMENTS:
                    records = gpp.extract_zone_records(xmls, "", "", "", [(xmls[0], role)])
                    if not records:
                        raise ValueError("no anchor zones in the converted track")
                    results = gpp.run_inference(records, models, device, cal)
                    bass = role.lower().endswith("bass")
                    arrangement = fb.build_bass_arrangement(records, results) if bass else fb.build_arrangement(role, records, results)
                    kind = "bass" if bass else "guitar"
                else:
                    skipped.append({"track": index, "name": name, "reason": f"no ML model for {role}"})
                    continue
            except Exception as error:  # report per track, keep the others
                skipped.append({"track": index, "name": name, "reason": f"{type(error).__name__}: {error}"})
                continue
            suggestions.append({"track": index, "name": name, "role": role, "type": kind, "arrangement": arrangement})
    _write(out, {"suggestions": suggestions, "skipped": skipped})


def _write(out, data):
    with open(out, "w", encoding="utf-8") as stream:
        json.dump(data, stream)


if __name__ == "__main__":
    command, *args = sys.argv[1:]
    if command == "align-sync":
        align_sync(*args[:3])
    elif command == "align-ensemble":
        align_ensemble(*args[:3])
    elif command == "suggest":
        suggest(args[0], args[1], args[2:])
    else:
        raise SystemExit("unknown command " + command)
