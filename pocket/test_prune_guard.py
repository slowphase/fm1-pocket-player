import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from prune_guard import plan

ROOT = Path(__file__).resolve().parent


def assets(count):
    return [{'name': n} for i in range(count) for n in (f'f{i}.fwsc', f'shot-f{i}.png')] + [{'name': 'packages.json'}]


class PruneGuardTests(unittest.TestCase):
    def test_empty_keep_deletes_nothing(self):
        p = plan(assets(100), [])
        self.assertFalse(p['deletionAllowed']); self.assertEqual(p['delete'], [])

    def test_short_fetch_deletes_nothing(self):
        p = plan(assets(100), [f'f{i}.fwsc' for i in range(20)])
        self.assertFalse(p['deletionAllowed']); self.assertEqual(p['delete'], [])

    def test_more_than_ten_percent_count_drop_blocks_cleanup(self):
        self.assertFalse(plan(assets(100), [f'f{i}.fwsc' for i in range(89)])['deletionAllowed'])
        self.assertTrue(plan(assets(100), [f'f{i}.fwsc' for i in range(90)])['deletionAllowed'])

    def test_new_names_cannot_disguise_mass_removal(self):
        p = plan(assets(100), [f'new{i}.fwsc' for i in range(100)])
        self.assertFalse(p['deletionAllowed']); self.assertEqual(p['delete'], [])

    def test_twenty_percent_removal_boundary(self):
        self.assertTrue(plan(assets(100), [f"f{i}.fwsc" for i in range(20, 120)])["deletionAllowed"])
        self.assertFalse(plan(assets(100), [f"f{i}.fwsc" for i in range(21, 121)])["deletionAllowed"])

    def test_screenshot_mass_removal_is_independently_blocked(self):
        a = assets(100) + [{'name': f'shot-unexpected{i}.png'} for i in range(100)]
        self.assertFalse(plan(a, [f'f{i}.fwsc' for i in range(100)])['deletionAllowed'])

    def test_normal_bounded_cleanup_preserves_metadata(self):
        p = plan(assets(100), [f'f{i}.fwsc' for i in range(3, 102)])
        self.assertTrue(p['deletionAllowed'])
        self.assertEqual(set(p['delete']), {n for i in range(3) for n in (f'f{i}.fwsc', f'shot-f{i}.png')})
        self.assertNotIn('packages.json', p['delete'])

    def test_missing_directory_overwrites_stale_delete_list_with_empty(self):
        with tempfile.TemporaryDirectory() as t:
            root = Path(t); (root/'assets.json').write_text(json.dumps({'assets': assets(100)}))
            (root/'delete.txt').write_text('f1.fwsc\n')
            subprocess.run([sys.executable, '-B', str(ROOT/'prune_guard.py'), '--assets', str(root/'assets.json'),
                            '--keep-dir', str(root/'missing'), '--delete-list', str(root/'delete.txt'),
                            '--report', str(root/'report.json')], check=True, capture_output=True)
            self.assertEqual((root/'delete.txt').read_text(), '')
            self.assertFalse(json.loads((root/'report.json').read_text())['deletionAllowed'])

    def test_workflow_deletes_only_guard_output_and_tests_it(self):
        text = (ROOT.parent/'.github/workflows/pocket-sync.yml').read_text()
        step = text.split('      - name: Keep only checked packages in pocket-packages')[1].split('\n  #')[0]
        self.assertLess(step.index('pocket/prune_guard.py'), step.index('gh release delete-asset'))
        self.assertIn('done < package-delete.txt', step)
        self.assertNotIn('ls hosted/pkg', step)
        for name in ['pocket-sync.yml', 'pocket-check.yml']:
            self.assertIn('pocket/test_prune_guard.py', (ROOT.parent/'.github/workflows'/name).read_text())
        self.assertIn("github.event_name == 'workflow_dispatch' || vars.POCKET_SCHEDULE_PAUSED != 'true'", text)


if __name__ == '__main__': unittest.main()
