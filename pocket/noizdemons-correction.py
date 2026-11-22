#!/usr/bin/env python3
"""Prepare the approved, single-entry correction from an existing Pages artifact. Never publishes."""
import copy
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import tarfile
import urllib.request

BASE = 'https://slowphase.github.io/fm1-pocket-player/'
OLD = 'b1c14859d45bd8ea1d5ea6ca630083e2a647178f1a45b33865e92da7a01e9b8a'
NEW = 'c5607f06ff33288c92be1ba24a226d9c7b4ab1643aa82ecc994462ff036cc35a'
MAKER = 'https://github.com/SPIKE-the-Percussionist/noiz_demons/releases/download/v666/noiz_demons.fwsc'
ROOT = Path(sys.argv[1])
SITE = ROOT / 'site'
STATE = ROOT / 'state'
STATE.mkdir(parents=True, exist_ok=True)
SITE.mkdir(parents=True, exist_ok=True)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'FM-1 Pocket catalogue correction (+https://github.com/slowphase/fm1-pocket-player)', 'Cache-Control': 'no-cache'})
    return urllib.request.urlopen(req, timeout=60).read()


def download_release(tag, name):
    subprocess.run(['gh', 'release', 'download', tag, '--repo', 'slowphase/fm1-pocket-player', '--pattern', name,
                    '--output', str(STATE / name), '--clobber'], check=True)
    return (STATE / name).read_bytes()


def inventory():
    return {p.relative_to(SITE).as_posix(): sha(p.read_bytes()) for p in SITE.rglob('*') if p.is_file()}


with tarfile.open(ROOT / 'baseline/artifact.tar') as archive:
    for member in archive:
        path = PurePosixPath(member.name)
        assert not path.is_absolute() and '..' not in path.parts, member.name
        assert member.isdir() or member.isfile(), 'links and special files are not allowed'
        dst = SITE.joinpath(*path.parts)
        if member.isdir():
            dst.mkdir(parents=True, exist_ok=True)
        else:
            dst.parent.mkdir(parents=True, exist_ok=True)
            with archive.extractfile(member) as source, dst.open('wb') as target:
                shutil.copyfileobj(source, target)

before_files = inventory()
cat_path = SITE / 'data/catalog-v2.json'
original_bytes = cat_path.read_bytes()
assert fetch(BASE + 'data/catalog-v2.json') == original_bytes, 'live catalogue no longer matches baseline'
assert sha(fetch(BASE)) == before_files['index.html'], 'live player no longer matches baseline'
catalogue = json.loads(original_bytes)
original = copy.deepcopy(catalogue)
matches = [i for i, e in enumerate(catalogue['firmwares']) if e['id'] == 'noizdemons']
assert len(matches) == 1
index = matches[0]
entry = catalogue['firmwares'][index]
assert entry['emu']['package']['sha256'] == OLD
assert entry['emu']['package']['url'] == MAKER
assert sha(fetch(MAKER)) == NEW, 'maker asset changed again; review required'

manifest_bytes = download_release('pocket-packages', 'packages.json')
manifest = json.loads(manifest_bytes)
original_manifest = copy.deepcopy(manifest)
rows = [i for i, row in enumerate(manifest['firmwares']) if row['hub'] == 'noizdemons']
assert len(rows) == 1
row_index = rows[0]
row = manifest['firmwares'][row_index]
assert row['status'] == 'found' and row['sha256'] == OLD and row['url'] == MAKER
hub = json.loads(download_release('pocket-current', 'hub-catalog.json'))
assert next(e for e in hub['catalog']['firmwares'] if e['id'] == 'noizdemons')['sha256'] == OLD, 'Hub record changed; review rather than disable a newly verified package'
correction = copy.deepcopy(row)
correction['status'] = "maker's packages differ from the Hub's SHA-256"
correction['mismatched'] = ['noiz_demons.fwsc']
correction.pop('reused', None)
manifest['firmwares'][row_index] = correction
(STATE / 'packages.json').write_text(json.dumps(manifest, indent=1) + '\n')

# Use the normal generator on this entry only, so no other firmware can acquire new status or metadata.
single = copy.deepcopy(catalogue)
single['firmwares'] = [copy.deepcopy(entry)]
candidate = STATE / 'single-entry.json'
candidate.write_text(json.dumps(single))
(STATE / 'empty-store').mkdir(exist_ok=True)
subprocess.run([sys.executable, 'pocket/emu/catalog.py', '--v2', str(candidate), '--packages', str(STATE / 'packages.json'),
                '--emu-ledger', str(STATE / 'unused-ledger.json'), '--rfm1-ledger', str(STATE / 'unused-rfm1-ledger.json'),
                '--store', str(STATE / 'empty-store')], check=True)
replacement = json.loads(candidate.read_text())['firmwares'][0]
assert replacement['emu']['package'] is None
assert all(replacement['emu'][p]['state'] == 'unavailable' for p in ('mac', 'web'))
assert not replacement['emu']['preferred']
mutable = {'emu', 'confidence', 'knownIssues', 'listened'}
assert {k: v for k, v in entry.items() if k not in mutable} == {k: v for k, v in replacement.items() if k not in mutable}

# Adjust the aggregate counts by this entry's contribution only; retain all other metadata.
def contribution(e):
    em = e['emu']
    out = {('packages',): int(bool(em.get('package'))), ('hosted',): int(bool((em.get('package') or {}).get('file')))}
    for player in ('mac', 'web'):
        out[(player, em[player]['state'])] = 1
        pref = em.get('preferred', {}).get(player, {}).get('engine')
        if pref:
            out[('preferred', player, pref)] = 1
        confidence = e.get('confidence', {}).get(player, {})
        for value in confidence.values():
            key = ('confidence', player, value['level'])
            out[key] = out.get(key, 0) + 1
        if pref in confidence:
            out[('preferredConfidence', player, confidence[pref]['level'])] = 1
    return out

old_counts, new_counts = contribution(entry), contribution(replacement)
for path in old_counts.keys() | new_counts.keys():
    delta = new_counts.get(path, 0) - old_counts.get(path, 0)
    if delta:
        target = catalogue['counts']['emu']
        for key in path[:-1]:
            target = target.setdefault(key, {})
        target[path[-1]] = target.get(path[-1], 0) + delta
        assert target[path[-1]] >= 0
catalogue['firmwares'][index] = replacement
from datetime import datetime, timezone
catalogue['updated'] = datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
assert len(catalogue['firmwares']) == len(original['firmwares'])
assert all(a == b for i, (a, b) in enumerate(zip(original['firmwares'], catalogue['firmwares'])) if i != index)
assert {k: v for k, v in catalogue.items() if k not in {'firmwares', 'counts', 'updated'}} == {k: v for k, v in original.items() if k not in {'firmwares', 'counts', 'updated'}}
assert {k: v for k, v in catalogue['counts'].items() if k != 'emu'} == {k: v for k, v in original['counts'].items() if k != 'emu'}
assert all(a == b for i, (a, b) in enumerate(zip(original_manifest['firmwares'], manifest['firmwares'])) if i != row_index)
cat_path.write_text(json.dumps(catalogue, indent=1) + '\n')
after_files = inventory()
assert before_files.keys() == after_files.keys()
changed = [name for name in before_files if before_files[name] != after_files[name]]
assert changed == ['data/catalog-v2.json'], changed

(STATE / 'catalog-v2.before.json').write_bytes(original_bytes)
(STATE / 'packages.before.json').write_bytes(manifest_bytes)
shutil.copyfile(cat_path, STATE / 'catalog-v2.json')
audit = {'changedFiles': changed, 'preservedFiles': len(before_files) - 1,
         'catalogueBeforeSHA256': sha(original_bytes), 'catalogueAfterSHA256': sha(cat_path.read_bytes()),
         'packagesBeforeSHA256': sha(manifest_bytes), 'packagesAfterSHA256': sha((STATE / 'packages.json').read_bytes()),
         'noizdemonsBefore': entry, 'noizdemonsAfter': replacement,
         'emuCountsBefore': original['counts']['emu'], 'emuCountsAfter': catalogue['counts']['emu']}
(STATE / 'audit.json').write_text(json.dumps(audit, indent=2) + '\n')
print(json.dumps({'changedFiles': changed, 'preservedFiles': audit['preservedFiles'], 'catalogueAfterSHA256': audit['catalogueAfterSHA256']}))
