import dataclasses
import hashlib
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import rsw_io as rsw


def synthetic(payload=b'\x00\x01\x02\x03' + struct.pack('<I', 16) + b'Original fixture', version=23):
    return struct.pack('<HII', version, 10 + len(payload), 0x12345678) + payload


class RswInspectorTests(unittest.TestCase):
    def test_candidate_metadata_explicitly_has_no_semantic_or_integrity_claim(self):
        raw = synthetic()
        result = rsw.inspect_rsw(raw)
        self.assertEqual(result['bytes'], len(raw))
        self.assertEqual(result['sha256'], hashlib.sha256(raw).hexdigest())
        self.assertEqual(result['headerCandidates']['versionU16LEAt0'], 23)
        self.assertFalse(result['editable'])
        self.assertFalse(result['schemaEstablished'])
        self.assertFalse(result['structureVerified'])
        self.assertFalse(result['checksumVerified'])
        self.assertIsNone(result['knownObservedSample'])
        self.assertNotIn('Original fixture', json.dumps(result))
        self.assertEqual(result['asciiRunObservations'][0]['precedingU32Candidate'], 16)

    def test_unknown_binary_regions_and_input_buffers_are_preserved_immutably(self):
        raw = synthetic(bytes(range(256)) * 3)
        mutable = bytearray(raw)
        document = rsw.load_rsw(mutable)
        mutable[-1] = 7
        self.assertEqual(document.opaque_bytes(), raw)
        with self.assertRaises(dataclasses.FrozenInstanceError):
            document.source_name = 'modified'
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'opaque.rsw'
            report = rsw.copy_opaque_rsw(document, target)
            self.assertEqual(target.read_bytes(), raw)
            self.assertFalse(report['editableExport'])
            with self.assertRaises(FileExistsError):
                rsw.copy_opaque_rsw(document, target)

    def test_no_editable_generation_or_decode_is_implicitly_offered(self):
        document = rsw.load_rsw(synthetic())
        with self.assertRaises(rsw.UnsupportedRswEditing):
            document.as_editable_project()
        with self.assertRaises(rsw.UnsupportedRswEditing):
            rsw.save_rsw(document)
        with self.assertRaises(rsw.UnsupportedRswEditing):
            rsw.save_rsw({'title': 'Changed'})
        with self.assertRaises(rsw.UnsupportedRswEditing):
            rsw.copy_opaque_rsw({'bytes': synthetic()}, 'must-not-write.rsw')

    def test_short_bad_size_unknown_variant_and_non_binary_inputs_refused(self):
        for value in [b'', synthetic()[:9], synthetic()[:-1], synthetic() + b'x', synthetic(version=21), synthetic(version=24), 'text', {'version': 23}, b'<song version="17"/>', b'PK\x03\x04' + bytes(20), struct.pack('<HII',23,10,0)]:
            with self.subTest(value=repr(value)[:40]):
                with self.assertRaises(rsw.RswError):
                    rsw.inspect_rsw(value)

    def test_bounded_input_and_scan_controls(self):
        raw = synthetic()
        with self.assertRaises(rsw.RswError):
            rsw.inspect_rsw(raw, max_bytes=len(raw)-1)
        for bound in [-1,257,True,0.5]:
            with self.assertRaises(rsw.RswError):
                rsw.inspect_rsw(raw,max_ascii_runs=bound)
        self.assertEqual(rsw.inspect_rsw(raw,max_ascii_runs=0)['asciiRunObservations'], [])
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'original.rsw'
            source.write_bytes(raw)
            with self.assertRaises(rsw.RswError):
                rsw.read_rsw(source,max_bytes=len(raw)-1)
            self.assertEqual(rsw.read_rsw(source).opaque_bytes(),raw)

    def test_payload_mutation_is_not_falsely_claimed_detectable_by_unknown_checksum(self):
        raw = bytearray(synthetic())
        first = rsw.inspect_rsw(raw)
        raw[-1] ^= 1
        second = rsw.inspect_rsw(raw)
        self.assertNotEqual(first['sha256'],second['sha256'])
        self.assertFalse(second['checksumVerified'])
        self.assertFalse(second['structureVerified'])

    def test_read_only_local_observed_samples_when_available(self):
        directory = Path(r'I:\Dev\R Plus CDLC\oce-research\paid-ui-20261023')
        expected = [('demo-working.rsw',22,7440,'060ccd919f3227153cdf0a67ddaa3af7cef4638ce16f58d8970822fd5335bbc9'),
                    ('demo-roundtrip.rsw',23,7460,'1d7d06f0c7658c441c2fae9dd97e02c5ee1e8967702c5d0a6b3ca3c6b7910853'),
                    ('demo-alestorm-scratch.rsw',23,30730,'a6f413324d230a7e320227bd39b62e405d7ec5791128cb8494a5c2fb635ef45f')]
        if not all((directory/name).is_file() for name,*_ in expected):
            self.skipTest('Private local observations are not bundled with the tests')
        for name,version,size,digest in expected:
            with self.subTest(name=name):
                document = rsw.read_rsw(directory/name)
                report = document.inspect()
                self.assertEqual(report['sha256'],digest)
                self.assertEqual(report['bytes'],size)
                self.assertEqual(report['headerCandidates']['versionU16LEAt0'],version)
                self.assertIsNotNone(report['knownObservedSample'])
                self.assertFalse(report['checksumVerified'])
                self.assertFalse(report['ordinaryChecksumComparisons']['unknownWordEqualsCrc32After10'])
                self.assertFalse(report['ordinaryChecksumComparisons']['unknownWordEqualsAdler32After10'])


if __name__ == '__main__':
    unittest.main()
