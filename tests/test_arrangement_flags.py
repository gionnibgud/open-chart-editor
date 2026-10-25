"""Hidden and locked arrangements: kept in the project, hidden ones left out of builds."""
import copy
import io
import json
import sys
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import export_targets as e
import pack_io as p
from test_pack_io import project as own
from test_export_targets import fixture


def with_hidden(base):
    project = copy.deepcopy(base)
    extra = copy.deepcopy(project['arrangements'][0])
    extra.update(id='own-hidden', name='Hidden take', hidden=True)
    for key in [k for k in extra if k.startswith('_')]:
        extra.pop(key)
    project['arrangements'].append(extra)
    return project


class FlagTests(unittest.TestCase):
    def test_feedpak_keeps_hidden_out_of_the_playable_pack(self):
        archive = p.save_feedpak(with_hidden(own()))
        with zipfile.ZipFile(io.BytesIO(archive)) as z:
            manifest = z.read('manifest.yaml').decode()
            scratch = json.loads(z.read(p.SCRATCH_PATH))
        self.assertNotIn('Hidden take', manifest)
        self.assertEqual([row['name'] for row in scratch['arrangements']], ['Hidden take'])
        reopened = p.load_feedpak(archive)
        hidden = [a for a in reopened['arrangements'] if a.get('hidden')]
        self.assertEqual([(a['name'], a.get('editorOnly')) for a in hidden], [('Hidden take', None)])

    def test_all_hidden_is_refused(self):
        project = own()
        project['arrangements'][0]['hidden'] = True
        with self.assertRaisesRegex(p.ProjectError, 'unhide'):
            p.save_feedpak(project)

    def test_lock_survives_feedpak(self):
        project = own()
        project['arrangements'][0]['locked'] = True
        reopened = p.load_feedpak(p.save_feedpak(project))
        self.assertIs(reopened['arrangements'][0].get('locked'), True)
        project['arrangements'][0].pop('locked')
        self.assertNotIn('locked', p.load_feedpak(p.save_feedpak(project))['arrangements'][0])

    def test_hidden_not_exported_elsewhere(self):
        project = with_hidden(fixture())
        with self.assertRaisesRegex(p.ProjectError, 'hidden'):
            p.save_xml(project, 'own-hidden')
        rows = {r['id']: r for r in e.native_compatibility(project)}
        self.assertFalse(rows['own-hidden']['compatible'])
        self.assertIn('Hidden', rows['own-hidden']['reason'])
        with self.assertRaisesRegex(p.ProjectError, 'not stock RS2014 compatible'):
            e.rs2014_sources(project, ['own-hidden'])
        tree, _ = e.rs2014_sources(project, ['own-lead'])
        master = json.loads(tree.entries[e.MASTER])
        self.assertTrue(any(a.get('hidden') for a in master['arrangements']), 'the master keeps hidden parts')


if __name__ == '__main__':
    unittest.main()
