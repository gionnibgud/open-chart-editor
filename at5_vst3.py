from __future__ import annotations

import importlib.util
import ipaddress
import os
import re
import struct
import tempfile
from copy import deepcopy
from pathlib import Path
from urllib.parse import urlsplit
from xml.etree import ElementTree as ET


FRAME_COUNT = 1024
SUPPORTED_FRAME_COUNTS = (256, 512, FRAME_COUNT)
MAX_PRESET_BYTES = 1024 * 1024
MAX_STATE_BYTES = 64 * 1024 * 1024
JUCE_BASE64 = ".ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+"
_PRESET_DATA = b"PresetData\x00"
AT5_TIERS = ("cs", "se", "at5", "max")


class At5Vst3Error(RuntimeError):
    pass


def _plugin_binary(path: Path) -> Path:
    if path.is_dir():
        return path / "Contents" / "x86_64-win" / "AmpliTube 5.vst3"
    return path


def find_plugin_path() -> Path | None:
    configured = os.environ.get("OCE_AMPLITUBE_VST3")
    if configured:
        candidate = _plugin_binary(Path(configured).expanduser())
        return candidate if candidate.is_file() else None

    program_files = os.environ.get("ProgramFiles", r"C:\Program Files")
    candidate = (
        Path(program_files)
        / "Common Files"
        / "VST3"
        / "AmpliTube 5.vst3"
        / "Contents"
        / "x86_64-win"
        / "AmpliTube 5.vst3"
    )
    return candidate if candidate.is_file() else None


def find_tone_converter_path() -> Path | None:
    configured = os.environ.get("OCE_AT5_TONE_PLUGIN") or os.environ.get("FEEDBACK_PLUGIN_AT5_TONE")
    candidates = []
    if configured:
        configured_path = Path(configured).expanduser()
        candidates.append(configured_path / "cdlc_to_at5.py" if configured_path.is_dir() else configured_path)

    appdata = os.environ.get("APPDATA")
    if appdata:
        candidates.append(Path(appdata) / "feedback-desktop" / "plugins" / "at5_tone" / "cdlc_to_at5.py")
    candidates.extend((
        Path(__file__).resolve().parent.parent / "feedback-plugin-at5-tone" / "cdlc_to_at5.py",
        Path(__file__).resolve().parent / "plugins" / "at5_tone" / "cdlc_to_at5.py",
    ))
    return next((candidate for candidate in candidates if candidate.is_file()), None)


def host_status() -> dict:
    path = find_plugin_path()
    pedalboard_available = importlib.util.find_spec("pedalboard") is not None
    converter_path = find_tone_converter_path()
    plugin_available = path is not None and pedalboard_available
    available = plugin_available and converter_path is not None
    if path is None:
        message = "AmpliTube 5 VST3 was not found. Set OCE_AMPLITUBE_VST3 to its VST3 binary or bundle path."
    elif not pedalboard_available:
        message = "The optional VST3 host is not installed. Install requirements-vst3.txt."
    elif converter_path is None:
        message = "The FeedBack RS-to-AT5 tone converter was not found. Set OCE_AT5_TONE_PLUGIN to its plugin folder."
    else:
        message = "AmpliTube 5 VST3 and the FeedBack RS-to-AT5 tone converter are ready."
    return {
        "available": available,
        "plugin_available": plugin_available,
        "plugin": "AmpliTube 5",
        "plugin_path": str(path) if path else None,
        "pedalboard": pedalboard_available,
        "tone_converter": converter_path is not None,
        "tone_converter_path": str(converter_path) if converter_path else None,
        "message": message,
    }


def _load_tone_converter():
    path = find_tone_converter_path()
    if path is None:
        raise At5Vst3Error(
            "The FeedBack RS-to-AT5 tone converter was not found. "
            "Set OCE_AT5_TONE_PLUGIN to its plugin folder."
        )
    spec = importlib.util.spec_from_file_location("oce_feedback_at5_tone_converter", path)
    if spec is None or spec.loader is None:
        raise At5Vst3Error(f"Could not load the FeedBack tone converter at {path}.")
    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
    except Exception as exc:
        raise At5Vst3Error(f"Could not load the FeedBack tone converter: {exc}") from exc
    if not callable(getattr(module, "_convert_tone_from_gearlist", None)):
        raise At5Vst3Error("The selected FeedBack tone converter does not support GearList conversion.")
    return module


def _normalise_gearlist(gear: dict) -> dict:
    if not isinstance(gear, dict):
        raise At5Vst3Error("The selected Rocksmith tone has no valid GearList.")
    normalised = {}
    for slot, item in gear.items():
        if not isinstance(slot, str) or not isinstance(item, dict):
            continue
        key = item.get("Key") or item.get("PedalKey")
        if not isinstance(key, str) or not key:
            continue
        knobs = item.get("Knobs") or item.get("KnobValues") or {}
        if isinstance(knobs, list):
            knobs = {
                entry["Key"]: entry["Value"]
                for entry in knobs
                if isinstance(entry, dict) and isinstance(entry.get("Key"), str) and "Value" in entry
            }
        if not isinstance(knobs, dict):
            raise At5Vst3Error(f"The Rocksmith tone has invalid knob values in {slot}.")
        normalised[slot] = {"Key": key, "Knobs": knobs}
    if not normalised.get("Amp", {}).get("Key"):
        raise At5Vst3Error("The selected Rocksmith tone has no amplifier mapping.")
    return normalised


def convert_rocksmith_tone(
    tone_key: str,
    tone_name: str,
    gear: dict,
    tier: str = "max",
) -> str:
    return convert_rocksmith_tone_with_warnings(tone_key, tone_name, gear, tier)[0]


def convert_rocksmith_tone_with_warnings(
    tone_key: str,
    tone_name: str,
    gear: dict,
    tier: str = "max",
) -> tuple[str, list[str]]:
    if tier not in AT5_TIERS:
        raise At5Vst3Error(f"AmpliTube tier must be one of {', '.join(AT5_TIERS)}.")
    if not isinstance(tone_key, str) or not tone_key.strip():
        raise At5Vst3Error("The selected Rocksmith tone has no name or key.")
    if not isinstance(tone_name, str) or not tone_name.strip():
        tone_name = tone_key
    converter = _load_tone_converter()
    converter_messages = []
    converter.print = lambda *values, **kwargs: converter_messages.append(
        " ".join(str(value) for value in values)
    )
    gearlist = _normalise_gearlist(gear)
    with tempfile.TemporaryDirectory(prefix="oce-at5-tone-") as temp_dir:
        output_dir = Path(temp_dir)
        try:
            converted = converter._convert_tone_from_gearlist(
                tone_key,
                tone_name,
                gearlist,
                Path("OCE live Rocksmith tone"),
                output_dir,
                free_mode=tier == "cs",
                tier=tier,
            )
        except Exception as exc:
            raise At5Vst3Error(f"FeedBack could not convert Rocksmith tone '{tone_name}': {exc}") from exc
        preset_paths = [Path(path) for path in converted or ()]
        if not preset_paths:
            raise At5Vst3Error(f"FeedBack could not create an AmpliTube preset for '{tone_name}'.")
        try:
            return preset_paths[0].read_text(encoding="utf-8"), converter_messages
        except OSError as exc:
            raise At5Vst3Error(f"FeedBack's converted preset for '{tone_name}' could not be read: {exc}") from exc


def local_websocket_origin_allowed(host_header: str, client_host: str, origin: str) -> bool:
    try:
        client_is_loopback = ipaddress.ip_address(client_host).is_loopback
    except ValueError:
        return False
    if not client_is_loopback or not host_header or not origin:
        return False

    host = urlsplit("//" + host_header)
    parsed_origin = urlsplit(origin)
    host_name = (host.hostname or "").lower()
    origin_name = (parsed_origin.hostname or "").lower()
    allowed_names = {"localhost", "127.0.0.1", "::1"}
    return (
        parsed_origin.scheme in {"http", "https"}
        and host_name in allowed_names
        and origin_name == host_name
        and parsed_origin.port == host.port
    )


def _juce_decode(encoded: str) -> bytes:
    size_text, separator, body = encoded.partition(".")
    if not separator or not size_text.isdecimal():
        raise At5Vst3Error("AmpliTube returned an unrecognized VST3 state.")
    size = int(size_text)
    if size < 1 or size > MAX_STATE_BYTES or len(body) != (size * 8 + 5) // 6:
        raise At5Vst3Error("AmpliTube returned an invalid VST3 state length.")

    result = bytearray(size)
    for index, character in enumerate(body):
        value = JUCE_BASE64.find(character)
        if value < 0:
            raise At5Vst3Error("AmpliTube returned invalid encoded VST3 state.")
        bit_offset = index * 6
        for bit in range(6):
            position = bit_offset + bit
            if position < size * 8 and value & (1 << bit):
                result[position >> 3] |= 1 << (position & 7)
    return bytes(result)


def _juce_encode(data: bytes) -> str:
    bit_length = len(data) * 8
    encoded = []
    for index in range((bit_length + 5) // 6):
        value = 0
        for bit in range(6):
            position = index * 6 + bit
            if position < bit_length and data[position >> 3] & (1 << (position & 7)):
                value |= 1 << bit
        encoded.append(JUCE_BASE64[value])
    return f"{len(data)}." + "".join(encoded)


def _component_state(raw_state: bytes) -> tuple[str, bytes]:
    if len(raw_state) < 9 or raw_state[:4] != b"VC2!":
        raise At5Vst3Error("AmpliTube returned an unsupported VST3 state wrapper.")
    outer_size = struct.unpack_from("<I", raw_state, 4)[0]
    if outer_size > MAX_STATE_BYTES or len(raw_state) < 8 + outer_size:
        raise At5Vst3Error("AmpliTube returned a truncated VST3 state.")

    outer_xml = raw_state[8 : 8 + outer_size].decode("latin-1")
    match = re.search(r"<IComponent>([^<]+)</IComponent>", outer_xml)
    if match is None:
        raise At5Vst3Error("AmpliTube's VST3 state has no component data.")
    return outer_xml, _juce_decode(match.group(1))


def _preset_region(component: bytes) -> tuple[int, int, bytes]:
    marker = component.find(_PRESET_DATA)
    if marker < 0:
        raise At5Vst3Error("AmpliTube's VST3 state has no preset data.")
    size_offset = marker + len(_PRESET_DATA)
    if size_offset >= len(component):
        raise At5Vst3Error("AmpliTube's VST3 preset data is truncated.")

    size_width = component[size_offset]
    if not 1 <= size_width <= 4 or size_offset + 1 + size_width >= len(component):
        raise At5Vst3Error("AmpliTube's VST3 preset length is invalid.")
    value_size = int.from_bytes(
        component[size_offset + 1 : size_offset + 1 + size_width], "little"
    )
    value_type_offset = size_offset + 1 + size_width
    if component[value_type_offset] != 0x08 or value_size < 2:
        raise At5Vst3Error("AmpliTube's VST3 preset value has an unsupported format.")

    xml_start = value_type_offset + 1
    xml_end = xml_start + value_size - 1
    if xml_end > len(component):
        raise At5Vst3Error("AmpliTube's VST3 preset XML is truncated.")
    return size_offset, xml_end, component[xml_start:xml_end].rstrip(b"\x00")


def _embedded_program_xml(component: bytes) -> str:
    _, _, xml_bytes = _preset_region(component)
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as exc:
        raise At5Vst3Error("AmpliTube's default preset XML is invalid.") from exc
    if root.tag != "Program":
        raise At5Vst3Error("AmpliTube's default state does not contain a Program preset.")
    return ET.tostring(root, encoding="unicode", xml_declaration=True)


def _preset_program_xml(preset_xml: str, default_xml: str, preset_name: str) -> str:
    if len(preset_xml.encode("utf-8")) > MAX_PRESET_BYTES:
        raise At5Vst3Error("The .at5p preset exceeds the 1 MiB size limit.")
    try:
        source = ET.fromstring(preset_xml)
        program = ET.fromstring(default_xml)
    except ET.ParseError as exc:
        raise At5Vst3Error("The selected .at5p preset is not valid XML.") from exc
    if source.tag not in {"Preset", "Program"} or source.get("Format", "").lower() != "at5p":
        raise At5Vst3Error("Choose an AmpliTube 5 .at5p preset.")
    if program.tag != "Program":
        raise At5Vst3Error("AmpliTube's default program state is invalid.")

    replaced = 0
    for source_child in source:
        for index, current in enumerate(program):
            if current.tag == source_child.tag:
                program.remove(current)
                program.insert(index, deepcopy(source_child))
                replaced += 1
                break
    if replaced == 0:
        raise At5Vst3Error("The .at5p preset contains no sections supported by AmpliTube.")

    for attribute in ("GUID", "PresetBPM", "ProgramChange"):
        if attribute in source.attrib:
            program.set(attribute, source.attrib[attribute])
    safe_name = preset_name.replace("\\", "/").rsplit("/", 1)[-1]
    safe_name = safe_name.rsplit(".", 1)[0].strip()[:128]
    if not safe_name:
        safe_name = source.get("PresetName", "OCE live preset")[:128]
    program.set("PresetName", safe_name)
    return ET.tostring(program, encoding="unicode", xml_declaration=True)


def _replace_preset_state(raw_state: bytes, preset_xml: str, preset_name: str) -> bytes:
    outer_xml, component = _component_state(raw_state)
    if (
        len(component) < 176
        or component[16:20] != b"CcnK"
        or component[24:28] != b"FBCh"
    ):
        raise At5Vst3Error("AmpliTube's VST3 state layout is unsupported.")

    _, _, default_xml_bytes = _preset_region(component)
    try:
        default_program = ET.fromstring(default_xml_bytes)
    except ET.ParseError as exc:
        raise At5Vst3Error("AmpliTube's default preset XML is invalid.") from exc
    if default_program.tag != "Program":
        raise At5Vst3Error("AmpliTube's default state does not contain a Program preset.")
    default_xml = ET.tostring(default_program, encoding="unicode", xml_declaration=True)
    merged_xml = _preset_program_xml(preset_xml, default_xml, preset_name)

    size_offset, old_end, _ = _preset_region(component)
    body = merged_xml.encode("utf-8") + b"\x00"
    value_size = len(body) + 1
    size_width = 2 if value_size < 0x10000 else 3 if value_size < 0x1000000 else 4
    replacement = (
        bytes([size_width])
        + value_size.to_bytes(size_width, "little")
        + b"\x08"
        + body
    )
    updated = bytearray(component[:size_offset] + replacement + component[old_end:])
    struct.pack_into(">I", updated, 20, len(updated) - 24)
    struct.pack_into(">I", updated, 172, len(updated) - 176)

    match = re.search(r"<IComponent>([^<]+)</IComponent>", outer_xml)
    if match is None:
        raise At5Vst3Error("AmpliTube's VST3 state has no component data.")
    updated_outer = outer_xml.replace(match.group(1), _juce_encode(updated), 1).encode("latin-1")
    return b"VC2!" + struct.pack("<I", len(updated_outer)) + updated_outer + b"\x00"


class At5LiveProcessor:
    def __init__(self, plugin, preset_xml: str | None = None, preset_name: str = ""):
        self.plugin = plugin
        try:
            self.default_state = bytes(self.plugin.raw_state)
        except Exception as exc:
            raise At5Vst3Error(f"AmpliTube could not read its default VST3 state: {exc}") from exc
        self.first_chunk = True
        self.configure(preset_xml, preset_name)

    def configure(self, preset_xml: str | None = None, preset_name: str = "") -> None:
        if self.plugin is None:
            raise At5Vst3Error("The AmpliTube live processor is closed.")
        state = self.default_state
        if preset_xml is not None:
            try:
                state = _replace_preset_state(self.default_state, preset_xml, preset_name)
            except At5Vst3Error:
                raise
            except Exception as exc:
                raise At5Vst3Error(f"AmpliTube could not load the selected preset: {exc}") from exc
        try:
            self.plugin.raw_state = state
        except Exception as exc:
            message = (
                "AmpliTube could not load the selected preset"
                if preset_xml is not None
                else "AmpliTube could not restore its default state"
            )
            raise At5Vst3Error(f"{message}: {exc}") from exc
        self.first_chunk = True

    def process_chunk(self, pcm: bytes, sample_rate: int, frame_count: int = FRAME_COUNT) -> bytes:
        if frame_count not in SUPPORTED_FRAME_COUNTS:
            raise At5Vst3Error("The live audio block size is unsupported.")
        if len(pcm) != frame_count * 4:
            actual_samples = len(pcm) // 4 if len(pcm) % 4 == 0 else f"{len(pcm)} bytes"
            raise At5Vst3Error(
                f"The live audio block has an invalid size "
                f"({actual_samples} samples received; {frame_count} expected)."
            )
        if sample_rate < 8000 or sample_rate > 192000:
            raise At5Vst3Error("The browser audio sample rate is unsupported.")

        import numpy as np

        mono = np.frombuffer(pcm, dtype="<f4")
        if not np.isfinite(mono).all():
            raise At5Vst3Error("The live audio block contains invalid samples.")
        stereo = np.stack((mono, mono))
        try:
            output = self.plugin.process(
                stereo,
                sample_rate,
                buffer_size=frame_count,
                reset=self.first_chunk,
            )
        except Exception as exc:
            raise At5Vst3Error(f"AmpliTube failed to process live audio: {exc}") from exc
        self.first_chunk = False

        output = np.asarray(output, dtype=np.float32)
        if output.ndim != 2 or output.shape[1] != frame_count:
            raise At5Vst3Error("AmpliTube returned an unexpected live audio block.")
        if output.shape[0] == 1:
            output = np.repeat(output, 2, axis=0)
        if output.shape[0] != 2 or not np.isfinite(output).all():
            raise At5Vst3Error("AmpliTube returned invalid stereo audio.")
        return np.asarray(output, dtype="<f4", order="C").tobytes()

    def close(self) -> None:
        self.plugin = None
        self.default_state = b""


def open_live_processor(
    plugin_path: str | Path | None = None,
    preset_xml: str | None = None,
    preset_name: str = "",
) -> At5LiveProcessor:
    path = Path(plugin_path) if plugin_path else find_plugin_path()
    if path is None or not path.is_file():
        raise At5Vst3Error("AmpliTube 5 VST3 was not found.")
    try:
        from pedalboard import load_plugin
    except ImportError as exc:
        raise At5Vst3Error("The optional VST3 host is not installed. Install requirements-vst3.txt.") from exc
    try:
        plugin = load_plugin(str(path))
    except Exception as exc:
        raise At5Vst3Error(f"AmpliTube 5 VST3 could not be loaded: {exc}") from exc
    return At5LiveProcessor(plugin, preset_xml, preset_name)
