import json
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tempfile
import unittest
import zipfile
from cache_guard import stage
from hosting_guard import make_archive

ROOT = Path(__file__).resolve().parent


class CacheGuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.source = self.root/'working'; self.source.mkdir()
        self.target = self.root/'cache-metadata'
        self.compat = b'{"schema":1,"builds":{},"macos":{}}\n'
        (self.source/'compat.json').write_bytes(self.compat)

    def test_held_and_uncleared_payloads_never_reach_finished_cache(self):
        held = b'held shifl package fixture'; uncleared = b'uncleared original fixture'
        (self.source/'shifl.fwsc').write_bytes(held)
        (self.source/'new.fwsc').write_bytes(uncleared)
        (self.source/'unknown.rfm1').write_bytes(b'\0asm firmware fixture')
        (self.source/'shot-shifl.png').write_bytes(b'\x89PNG held screenshot fixture')
        nested = self.source/'.stage'; nested.mkdir(); (nested/'candidate.rfm1').write_bytes(uncleared)
        with zipfile.ZipFile(self.source/'hidden.zip', 'w') as z: z.writestr('shifl.fwsc', held)
        result = stage(self.source, self.target)
        archive = self.root/'finished-cache.zip'; make_archive(self.target, archive)
        with zipfile.ZipFile(archive) as z:
            self.assertEqual(z.namelist(), ['compat.json'])
            self.assertEqual(z.read('compat.json'), self.compat)
            self.assertNotIn(held, z.read('compat.json')); self.assertNotIn(uncleared, z.read('compat.json'))
        self.assertIn('shifl.fwsc', result['ignored']); self.assertIn('.stage', result['ignored'])

    def test_raw_firmware_disguised_as_metadata_rejected_before_cache_save(self):
        (self.source/'compat.json').write_bytes(b'\x00\xffheld firmware fixture')
        marker = self.root/'cache-save-ran'
        command = shlex.join([sys.executable, '-B', str(ROOT/'cache_guard.py'), '--source', str(self.source), '--target', str(self.target)])
        result = subprocess.run(['bash', '-e', '-c', command+'\n'+shlex.join(['touch', str(marker)])], capture_output=True)
        self.assertNotEqual(result.returncode, 0); self.assertFalse(marker.exists()); self.assertFalse(self.target.exists())

    def test_unknown_json_payload_and_symlink_rejected(self):
        (self.source/'compat.json').write_text('{"payload":"not approved metadata"}')
        with self.assertRaises(ValueError): stage(self.source, self.target)
        self.assertFalse(self.target.exists())
        (self.source/'compat.json').unlink(); (self.source/'compat.json').symlink_to(self.root/'outside')
        with self.assertRaises(ValueError): stage(self.source, self.target)

    def test_valid_metadata_preserved_byte_for_byte_and_missing_cache_is_safe(self):
        hub = b'{"fetchedAt":"2026-11-23T00:00:00Z","catalog":{"firmwares":[]}}'
        (self.source/'hub-catalog.json').write_bytes(hub)
        (self.source/'native-macos.json').write_text('{"verified":true,"results":{}}')
        stage(self.source, self.target)
        self.assertEqual((self.target/'hub-catalog.json').read_bytes(), hub)
        self.assertEqual((self.target/'compat.json').read_bytes(), self.compat)
        self.assertEqual(stage(self.root/'missing', self.root/'empty')['copied'], [])

    def test_every_workflow_cache_is_metadata_only_and_guarded(self):
        saves = []
        for p in (ROOT.parent/'.github/workflows').glob('*.yml'):
            text = p.read_text()
            for block in re.split(r'(?m)^      - ', text):
                if re.search(r'uses: actions/cache(?:@|/save@)', block):
                    saves.append((p.name, block))
                    self.assertIn('path: cache-metadata', block)
                    self.assertIn("steps.metadata_guard.outputs.passed == 'true'", block)
                if 'uses: actions/cache/restore@' in block:
                    self.assertIn('path: cache-metadata', block)
        self.assertEqual(len(saves), 1)
        text = (ROOT.parent/'.github/workflows/pocket-sync.yml').read_text()
        self.assertNotIn('emu-pkgs-', text); self.assertNotIn('pocket-store-${{ github.run_id }}', text)
        self.assertIn('pocket/cache_guard.py --source pocket-store --target cache-metadata-next', text)
        self.assertIn('pocket/cache_guard.py --source cache-metadata --target pocket-store', text)
        for name in ['pocket-check.yml', 'pocket-sync.yml']:
            self.assertIn('pocket/test_cache_guard.py', (ROOT.parent/'.github/workflows'/name).read_text())


if __name__ == '__main__': unittest.main()
