"""Historical proposal probes, updated to distinguish approved reference-only storage."""
import base64
import copy
import hashlib
import io
import json
import unittest
import zipfile
import pack_io
from test_musicxml_dynamics_candidate import score,note
from test_pack_io import project


def own_mxl():
    inner=score(note());out=io.BytesIO()
    with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr('META-INF/container.xml','<container><rootfiles><rootfile full-path="score/own.musicxml"/></rootfiles></container>')
        z.writestr('score/own.musicxml',inner);z.writestr('own/extra.bin',b'Original extra bytes\x00\xff');z.writestr('own/notes.txt','Own annotation')
    return inner,out.getvalue()

class MxlArchiveProposalTests(unittest.TestCase):
    def test_archive_reference_keeps_inner_score_and_exact_original_compressed_member(self):
        inner,archive=own_mxl();p=pack_io.load_project(archive,'own.mxl')
        self.assertEqual(base64.b64decode(p['_import']['source']),inner);self.assertEqual(base64.b64decode(p['_pack']['entries'][p['_import']['sourceArchive']['entry']]),archive)
        self.assertNotEqual(base64.b64decode(p['_import']['source']),archive)

    def test_rejected_inline_proposal_is_not_accepted_as_canonical_reference(self):
        inner,archive=own_mxl();p=project();p['_import']={'format':'musicxml','source':base64.b64encode(inner).decode(),'sourceArchive':{'version':1,'filename':'own.mxl','mediaType':'application/vnd.recordare.musicxml','size':len(archive),'sha256':hashlib.sha256(archive).hexdigest(),'source':base64.b64encode(archive).decode()}}
        before=copy.deepcopy(p)
        with self.assertRaises(pack_io.ProjectError):pack_io.save_project(p,'json')
        self.assertEqual(p,before)

    def test_one_reserved_binary_archive_member_survives_existing_feedpak_json_paths_exactly(self):
        _,archive=own_mxl();p=project();digest=hashlib.sha256(archive).hexdigest();path='editor/musicxml-sources/'+digest+'.mxl'
        p['_pack']['entries'][path]=base64.b64encode(archive).decode();before=copy.deepcopy(p)
        restored=pack_io.load_project(pack_io.save_feedpak(p),'own.feedpak');self.assertEqual(base64.b64decode(restored['_pack']['entries'][path]),archive)
        restored=pack_io.load_project(pack_io.save_project(restored,'json')[0],'own.json');self.assertEqual(base64.b64decode(restored['_pack']['entries'][path]),archive);self.assertEqual(p,before)
        # Existing opaque-member preservation is feasible; no canonical sourceArchive restoration is claimed.
        self.assertNotIn('_import',restored)

    def test_existing_uncompressed_archive_budget_is_enforced(self):
        from unittest.mock import patch
        _,archive=own_mxl()
        with patch.object(pack_io,'MAX_BYTES',16):
            with self.assertRaises(pack_io.ProjectError):pack_io.load_project(archive,'own.mxl')

if __name__=='__main__':unittest.main()
