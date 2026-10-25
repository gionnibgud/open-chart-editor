"""Bounded inspection of observed R+ Workshop .rsw candidate envelopes.

This is NOT an arrangement decoder or an editable .rsw writer. Three locally
observed samples support little-endian candidate version/size words only. The
four bytes at offset 6 have unknown meaning; no checksum is implemented. There
is no established magic, chunk directory, object schema or integrity algorithm.
Consequently a structurally plausible candidate is not an authenticated project.

All unknown bytes remain in an immutable opaque document. An explicit opaque
copy is byte-exact; that claim does not imply semantic round-trip editing.
Prerelease XML/version-17 behavior is not evidence for this retail binary format.
No proprietary sample payload is bundled in this module or its tests.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass, field
import hashlib
import json
from pathlib import Path
import re
import struct
import zlib

OBSERVED_VERSION_CANDIDATES = frozenset({22, 23})
MAX_INPUT_BYTES = 128 * 1024 * 1024
HEADER_BYTES = 10
KNOWN_SAMPLE_HASHES = {
    '060ccd919f3227153cdf0a67ddaa3af7cef4638ce16f58d8970822fd5335bbc9': 'shipped-demo/copied-working-v22',
    '1d7d06f0c7658c441c2fae9dd97e02c5ee1e8967702c5d0a6b3ca3c6b7910853': 'retail-save-as-demo-v23',
    'a6f413324d230a7e320227bd39b62e405d7ec5791128cb8494a5c2fb635ef45f': 'retail-scratch-import-v23',
}


class RswError(ValueError):
    """Malformed or unsupported candidate envelope."""


class UnsupportedRswEditing(RswError):
    """The retail semantic schema has not been established."""


def _validated_bytes(data, max_bytes=MAX_INPUT_BYTES):
    if not isinstance(max_bytes, int) or isinstance(max_bytes, bool) or max_bytes < HEADER_BYTES:
        raise RswError('Input bound must be an integer of at least 10 bytes')
    if not isinstance(data, (bytes, bytearray, memoryview)):
        raise RswError('Expected binary bytes, not a decoded or editable project')
    if len(data) > max_bytes:
        raise RswError(f'Candidate exceeds the {max_bytes}-byte inspection bound')
    payload = bytes(data)
    if len(payload) < HEADER_BYTES:
        raise RswError('Candidate is shorter than the observed 10-byte envelope')
    if payload.startswith((b'PK\x03\x04', b'<?xml', b'<song', b'{', b'[')):
        raise RswError('ZIP/XML/JSON is not the observed retail binary envelope')
    version, declared_bytes, _ = struct.unpack_from('<HII', payload)
    if version not in OBSERVED_VERSION_CANDIDATES:
        raise RswError(f'Unsupported version candidate {version}; only observed candidates 22/23 can be inspected')
    if declared_bytes != len(payload):
        raise RswError(f'Declared-size candidate {declared_bytes} differs from actual byte count {len(payload)}')
    if len(payload) == HEADER_BYTES:
        raise RswError('Candidate has no opaque payload; none of the observed projects is empty')
    return payload


@dataclass(frozen=True, slots=True)
class OpaqueRswDocument:
    """An immutable original byte sequence; no parsed editable arrangement."""
    _data: bytes = field(repr=False)
    source_name: str = ''
    sha256: str = field(init=False)

    def __post_init__(self):
        data = _validated_bytes(self._data)
        object.__setattr__(self, '_data', data)
        object.__setattr__(self, 'sha256', hashlib.sha256(data).hexdigest())

    def opaque_bytes(self):
        """Return all original bytes unchanged, including every unknown region."""
        return self._data

    def inspect(self, max_ascii_runs=32):
        return inspect_rsw(self._data, max_ascii_runs=max_ascii_runs, source_name=self.source_name)

    def as_editable_project(self):
        raise UnsupportedRswEditing('Retail .rsw arrangement decoding is unavailable: object boundaries, references and integrity are unestablished')


def inspect_rsw(data, *, max_bytes=MAX_INPUT_BYTES, max_ascii_runs=32, source_name=''):
    """Return metadata only. ASCII offsets are observations, never field names.

    Printable bytes are deliberately not returned. An apparent preceding length
    is a candidate relationship, not proof of the general string encoding.
    """
    payload = _validated_bytes(data, max_bytes)
    if not isinstance(max_ascii_runs, int) or isinstance(max_ascii_runs, bool) or not 0 <= max_ascii_runs <= 256:
        raise RswError('ASCII run bound must be an integer from 0 to 256')
    version, declared_bytes, unknown_word = struct.unpack_from('<HII', payload)
    digest = hashlib.sha256(payload).hexdigest()
    runs = []
    if max_ascii_runs:
        for match in re.finditer(rb'[\x20-\x7e]{8,}', payload):
            before = struct.unpack_from('<I', payload, match.start() - 4)[0] if match.start() >= 4 else None
            runs.append({'offset': match.start(), 'length': len(match[0]),
                         'precedingU32Candidate': before, 'precedingValueMatchesLength': before == len(match[0])})
            if len(runs) == max_ascii_runs:
                break
    return {
        'inspectionKind': 'opaque-retail-rsw-candidate-envelope',
        'sourceName': str(source_name), 'bytes': len(payload), 'sha256': digest,
        'knownObservedSample': KNOWN_SAMPLE_HASHES.get(digest),
        'headerCandidates': {'versionU16LEAt0': version, 'totalBytesU32LEAt2': declared_bytes,
                             'unknownWordU32LEAt6': unknown_word, 'declaredSizeMatches': True},
        'opaquePayload': {'offset': HEADER_BYTES, 'bytes': len(payload) - HEADER_BYTES,
                          'sha256': hashlib.sha256(payload[HEADER_BYTES:]).hexdigest()},
        'asciiRunObservations': runs,
        'ordinaryChecksumComparisons': {'crc32After10': zlib.crc32(payload[10:]) & 0xffffffff,
                                        'adler32After10': zlib.adler32(payload[10:]) & 0xffffffff,
                                        'unknownWordEqualsCrc32After10': unknown_word == zlib.crc32(payload[10:]) & 0xffffffff,
                                        'unknownWordEqualsAdler32After10': unknown_word == zlib.adler32(payload[10:]) & 0xffffffff},
        'schemaEstablished': False, 'editable': False, 'checksumVerified': False,
        'structureVerified': False, 'opaqueBytesPreserved': True,
        'limitations': ['No established magic or payload/object/chunk schema',
                        'Size/version candidates cannot establish project validity',
                        'Opaque header word meaning and integrity algorithm unknown',
                        'No notes, tempo, gear, metadata, audio or editor state decoded',
                        'No semantic editing, XML conversion or retail project generation'],
    }


def load_rsw(data, *, source_name='', max_bytes=MAX_INPUT_BYTES):
    """Hold an opaque candidate; this does not import its notes into the editor."""
    return OpaqueRswDocument(_validated_bytes(data, max_bytes), str(source_name))


def read_rsw(path, *, max_bytes=MAX_INPUT_BYTES):
    """Read at most max_bytes+1, rejecting oversized input before full loading."""
    if not isinstance(max_bytes, int) or isinstance(max_bytes, bool) or max_bytes < HEADER_BYTES:
        raise RswError('Invalid input bound')
    source = Path(path)
    with source.open('rb') as handle:
        data = handle.read(max_bytes + 1)
    return load_rsw(data, source_name=source.name, max_bytes=max_bytes)


def copy_opaque_rsw(document, destination):
    """Explicit byte-exact copy only. Never overwrite or repair a project."""
    if not isinstance(document, OpaqueRswDocument):
        raise UnsupportedRswEditing('Only an immutable original opaque document can be copied; editable .rsw generation is unsupported')
    target = Path(destination)
    with target.open('xb') as handle:
        handle.write(document.opaque_bytes())
    return {'operation': 'opaque-byte-copy-only', 'bytes': len(document.opaque_bytes()),
            'sha256': document.sha256, 'editableExport': False}


def save_rsw(_project, *_args, **_kwargs):
    """Intentionally refuse an API name that might imply semantic export."""
    raise UnsupportedRswEditing('Editable retail .rsw export is unsupported; preserve the original with copy_opaque_rsw instead')


def main(argv=None):
    parser = argparse.ArgumentParser(description='Inspect a retail .rsw candidate without importing or editing its chart')
    parser.add_argument('file', type=Path)
    parser.add_argument('--max-ascii-runs', type=int, default=32)
    args = parser.parse_args(argv)
    try:
        report = read_rsw(args.file).inspect(max_ascii_runs=args.max_ascii_runs)
    except (OSError, RswError) as error:
        print(json.dumps({'ok': False, 'error': str(error)}))
        return 1
    print(json.dumps({'ok': True, **report}, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
