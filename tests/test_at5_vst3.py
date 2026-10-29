import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import FastAPI
from fastapi.testclient import TestClient
import at5_vst3
import routes


DEFAULT_PROGRAM = (
    '<?xml version="1.0" encoding="UTF-8"?>'
    '<Program Version="2" Format="at5p" GUID="default" PresetName="Default" '
    'PresetPath="Default.at5p"><Chain /><AmpA Model="default" />'
    '<Preferences /><Automation /></Program>'
)
SOURCE_PRESET = (
    '<?xml version="1.0" encoding="UTF-8"?>'
    '<Preset Version="1" Format="at5p" GUID="source" PresetBPM="120" '
    'ProgramChange="-1"><Chain Preset="Chain11" />'
    '<AmpA Model="test-amp" /></Preset>'
)


def state_with_program(program):
    component = bytearray(b"\x00" * 176)
    component[16:20] = b"CcnK"
    component[24:28] = b"FBCh"
    body = program.encode("utf-8") + b"\x00"
    value_size = len(body) + 1
    segment = b"\x02" + value_size.to_bytes(2, "little") + b"\x08" + body
    component.extend(b"JState\x00\x00\x01\x03PresetData\x00" + segment + b"\x00Panels\x00")
    struct.pack_into(">I", component, 20, len(component) - 24)
    struct.pack_into(">I", component, 172, len(component) - 176)
    encoded = at5_vst3._juce_encode(bytes(component))
    outer = f"<VST3PluginState><IComponent>{encoded}</IComponent></VST3PluginState>".encode("latin-1")
    return b"VC2!" + struct.pack("<I", len(outer)) + outer + b"\x00"


class FakePlugin:
    def __init__(self):
        self.calls = []
        self.raw_state = b"default-state"

    def process(self, audio, sample_rate, *, buffer_size, reset):
        self.calls.append((sample_rate, buffer_size, reset))
        return audio * 2


class At5Vst3Tests(unittest.TestCase):
    def test_preset_merges_into_default_program_and_keeps_default_sections(self):
        result = at5_vst3._preset_program_xml(SOURCE_PRESET, DEFAULT_PROGRAM, "my-tone.at5p")
        self.assertIn('<Program Version="2"', result)
        self.assertIn('PresetName="my-tone"', result)
        self.assertIn('GUID="source"', result)
        self.assertIn('<AmpA Model="test-amp"', result)
        self.assertIn("<Preferences", result)
        self.assertIn("<Automation", result)

    def test_preset_state_wrapper_round_trips_and_updates_component_lengths(self):
        original = state_with_program(DEFAULT_PROGRAM)
        updated = at5_vst3._replace_preset_state(original, SOURCE_PRESET, "my-tone.at5p")
        outer, component = at5_vst3._component_state(updated)
        self.assertIn("<VST3PluginState>", outer)
        program = at5_vst3.ET.fromstring(at5_vst3._embedded_program_xml(component))
        self.assertEqual(program.tag, "Program")
        self.assertEqual(program.get("PresetName"), "my-tone")
        self.assertEqual(program.find("AmpA").get("Model"), "test-amp")
        self.assertEqual(struct.unpack_from(">I", component, 20)[0], len(component) - 24)
        self.assertEqual(struct.unpack_from(">I", component, 172)[0], len(component) - 176)

    def test_live_processor_uses_reset_only_for_the_first_audio_block(self):
        import numpy as np

        plugin = FakePlugin()
        processor = at5_vst3.At5LiveProcessor(plugin)
        audio = np.full(at5_vst3.FRAME_COUNT, 0.25, dtype="<f4").tobytes()
        first = processor.process_chunk(audio, 48000)
        second = processor.process_chunk(audio, 48000)
        first_output = np.frombuffer(first, dtype="<f4").reshape(2, -1)
        self.assertTrue(np.allclose(first_output, 0.5))
        self.assertEqual(plugin.calls, [(48000, 1024, True), (48000, 1024, False)])
        self.assertEqual(len(second), at5_vst3.FRAME_COUNT * 2 * 4)

    def test_live_processor_accepts_supported_block_sizes(self):
        import numpy as np

        for frame_count in at5_vst3.SUPPORTED_FRAME_COUNTS:
            with self.subTest(frame_count=frame_count):
                plugin = FakePlugin()
                processor = at5_vst3.At5LiveProcessor(plugin)
                audio = np.full(frame_count, 0.25, dtype="<f4").tobytes()
                output = processor.process_chunk(audio, 48000, frame_count)
                self.assertEqual(len(output), frame_count * 2 * 4)
                self.assertEqual(plugin.calls, [(48000, frame_count, True)])

    def test_live_processor_rejects_unsupported_block_size(self):
        processor = at5_vst3.At5LiveProcessor(FakePlugin())
        with self.assertRaisesRegex(at5_vst3.At5Vst3Error, "block size is unsupported"):
            processor.process_chunk(b"\x00" * 128 * 4, 48000, 128)

    def test_live_processor_reconfigures_preset_and_restores_default_state(self):
        plugin = FakePlugin()
        processor = at5_vst3.At5LiveProcessor(plugin)
        with patch.object(at5_vst3, "_replace_preset_state", return_value=b"preset-state"):
            processor.configure("<Preset />", "test.at5p")
        self.assertEqual(plugin.raw_state, b"preset-state")
        processor.first_chunk = False
        processor.configure()
        self.assertEqual(plugin.raw_state, b"default-state")
        self.assertTrue(processor.first_chunk)

    def test_rocksmith_conversion_uses_feedBack_converter_with_normalized_knobs(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            converter_path = Path(temp_dir) / "cdlc_to_at5.py"
            converter_path.write_text(
                "import json\n"
                "from pathlib import Path\n"
                "def _convert_tone_from_gearlist(key, name, gear, source, output, **options):\n"
                " path = Path(output) / 'converted.at5p'\n"
                " path.write_text(json.dumps({'key': key, 'name': name, 'gear': gear, 'options': options}))\n"
                " return [path]\n",
                encoding="utf-8",
            )
            with patch.object(at5_vst3, "find_tone_converter_path", return_value=converter_path):
                result = at5_vst3.convert_rocksmith_tone(
                    "lead",
                    "Lead",
                    {
                        "Amp": {
                            "Key": "Amp_MarshallJCM800",
                            "KnobValues": {"Amp_MarshallJCM800_Gain": 65},
                        },
                        "Cabinet": {"Key": "Cab_Marshall1960a"},
                    },
                    tier="se",
                )
        converted = json.loads(result)
        self.assertEqual(converted["key"], "lead")
        self.assertEqual(converted["gear"]["Amp"]["Knobs"], {"Amp_MarshallJCM800_Gain": 65})
        self.assertEqual(converted["options"], {"free_mode": False, "tier": "se"})

    def test_rocksmith_conversion_rejects_tones_without_an_amp(self):
        with self.assertRaisesRegex(at5_vst3.At5Vst3Error, "no amplifier mapping"):
            at5_vst3._normalise_gearlist({"Cabinet": {"Key": "Cab_Test"}})

    def test_local_websocket_policy_rejects_non_loopback_or_cross_origin(self):
        self.assertTrue(
            at5_vst3.local_websocket_origin_allowed(
                "127.0.0.1:8767", "127.0.0.1", "http://127.0.0.1:8767"
            )
        )
        self.assertFalse(
            at5_vst3.local_websocket_origin_allowed(
                "127.0.0.1:8767", "192.168.1.5", "http://127.0.0.1:8767"
            )
        )
        self.assertFalse(
            at5_vst3.local_websocket_origin_allowed(
                "127.0.0.1:8767", "127.0.0.1", "http://evil.example"
            )
        )

    def test_status_route_reports_host_readiness_without_loading_the_plugin(self):
        app = FastAPI()
        routes.setup(app, {"plugin_dir": str(Path(__file__).resolve().parents[1])})
        expected = {
            "available": False,
            "plugin_available": False,
            "plugin": "AmpliTube 5",
            "plugin_path": None,
            "pedalboard": False,
            "tone_converter": False,
            "tone_converter_path": None,
            "message": "Host not installed",
        }
        with patch.object(routes.at5_vst3, "host_status", return_value=expected):
            with TestClient(app) as client:
                response = client.get("/api/plugins/open_chart_editor/at5/status")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), expected)


if __name__ == "__main__":
    unittest.main()
