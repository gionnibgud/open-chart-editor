"""Owned folder projection/identity fixtures, no host/native/browser actions."""
import copy
import io
import json
import sys
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import export_targets as e
from test_export_targets import fixture


def archive(entries):
    output=io.BytesIO()
    with zipfile.ZipFile(output,'w',compression=zipfile.ZIP_DEFLATED) as z:
        for name,data in entries.items():z.writestr(name,data)
    return output.getvalue()


class LooseProjectionTests(unittest.TestCase):
    def test_real_flat_legacy_files_plus_typed_identity(self):
        project=fixture();before=copy.deepcopy(project)
        tree,report=e.feedback_loose(project)
        self.assertEqual(project,before)
        for name in ('audio.wav','00_lead.xml','manifest.json','manifest.yaml','editable.oce.json','cover.png'):
            self.assertIn(name,tree.entries)
        metadata=json.loads(tree.entries['manifest.json'])
        self.assertEqual(metadata['ocePerformance']['version'],1)
        self.assertEqual(metadata['arrangements'][0]['file'],'00_lead.xml')
        reopened=e.load_folder_archive(tree.zip_bytes())
        self.assertEqual(reopened['arrangements'],project['arrangements'])
        self.assertEqual(reopened['_pack'],project['_pack'])
        self.assertTrue(report['allChartsInTypedPerformance'])

    def test_extended_charts_are_typed_without_fake_native_xml(self):
        project=fixture();arr=project['arrangements'][0]
        arr.update(stringCount=8,tuning=[0]*8)
        tree,report=e.feedback_loose(project)
        self.assertFalse(any('/' not in name and name.endswith('.xml') for name in tree.entries))
        self.assertFalse(report['legacyNativeMirrors'])
        reopened=e.load_folder_archive(tree.zip_bytes())
        self.assertEqual(reopened['arrangements'][0]['stringCount'],8)

    def test_corrupt_bound_xml_master_or_typed_manifest_refused(self):
        tree,_=e.feedback_loose(fixture())
        for name in ('00_lead.xml','editable.oce.json','manifest.yaml'):
            entries=dict(tree.entries);entries[name]+=b' '
            with self.subTest(name=name),self.assertRaisesRegex(e.pack_io.ProjectError,'changed|identity'):
                e.load_folder_archive(archive(entries))

    def test_new_unbound_editable_file_or_changed_legacy_metadata_refused(self):
        tree,_=e.feedback_loose(fixture())
        entries=dict(tree.entries);entries['new.xml']=b'<song/>'
        with self.assertRaisesRegex(e.pack_io.ProjectError,'Unbound'):
            e.load_folder_archive(archive(entries))
        entries=dict(tree.entries);meta=json.loads(entries['manifest.json']);meta['title']='Changed externally'
        entries['manifest.json']=json.dumps(meta).encode()
        with self.assertRaisesRegex(e.pack_io.ProjectError,'metadata'):
            e.load_folder_archive(archive(entries))

    def test_source_folder_master_requires_complete_identity(self):
        tree,_=e.rs2014_sources(fixture(),['own-lead'])
        opened=e.load_folder_archive(tree.zip_bytes())
        self.assertEqual(opened['title'],'Own Source Study')
        entries=dict(tree.entries);entries['editable.oce.json']+=b' '
        with self.assertRaises(e.pack_io.ProjectError):e.load_folder_archive(archive(entries))
        entries=dict(tree.entries);entries['added.xml']=b'<song/>'
        with self.assertRaisesRegex(e.pack_io.ProjectError,'unbound'):e.load_folder_archive(archive(entries))

    def test_plain_legacy_folder_all_xml_and_unknown_source_retained(self):
        project=fixture();native=e.pack_io.save_xml(copy.deepcopy(project),'own-lead')
        audio=e.source_audio(project)[1]
        entries={'lead.xml':native,'rhythm.xml':native,'audio.wav':audio,
                 'manifest.json':b'{"title":"Original folder metadata"}','unknown.bin':b'own opaque'}
        opened=e.load_folder_archive(archive(entries))
        self.assertEqual(len(opened['arrangements']),2)
        self.assertEqual(opened['title'],'Original folder metadata')
        self.assertEqual(set(opened['_pack']['entries']),set(entries))
        self.assertEqual(entries['unknown.bin'],e._asset_bytes(opened['_pack']['entries']['unknown.bin'],'own'))

    def test_plain_piano_xml_is_not_fabricated_as_guitar(self):
        project=fixture();native=e.pack_io.save_xml(copy.deepcopy(project),'own-lead')
        entries={'piano.xml':native,'audio.wav':e.source_audio(project)[1]}
        with self.assertRaisesRegex(e.pack_io.ProjectError,'fake guitar'):
            e.load_folder_archive(archive(entries))

    def test_zip_path_and_symlink_rejected_before_loading(self):
        with self.assertRaises(e.pack_io.ProjectError):e.entry_tree_from_zip(archive({'../outside':b'own'}))
        output=io.BytesIO()
        with zipfile.ZipFile(output,'w') as z:
            entry=zipfile.ZipInfo('link.json');entry.create_system=3;entry.external_attr=0o120777<<16
            z.writestr(entry,b'../outside')
        with self.assertRaisesRegex(e.pack_io.ProjectError,'Linked'):e.entry_tree_from_zip(output.getvalue())

    def test_declared_bad_yaml_never_falls_back_to_valid_legacy_xml(self):
        project=fixture();native=e.pack_io.save_xml(copy.deepcopy(project),'own-lead')
        data=archive({'manifest.yaml':b'key: [broken','lead.xml':native,
                      'audio.wav':e.source_audio(project)[1]})
        with self.assertRaises(e.pack_io.ProjectError):e.load_folder_archive(data)

    def test_explicit_folder_http_bad_yaml_is400(self):
        from fastapi.testclient import TestClient
        from dev_server import app
        data=archive({'manifest.yaml':b'key: [broken','audio.wav':b'own'})
        with TestClient(app) as client:
            response=client.post('/api/plugins/open_chart_editor/load',
                files={'file':('own.oce-folder.zip',data,'application/zip')})
        self.assertEqual(response.status_code,400)
        self.assertIn('detail',response.json())


if __name__=='__main__':unittest.main()
