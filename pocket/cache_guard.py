#!/usr/bin/env python3
"""Copy only validated JSON metadata into/out of the Actions cache.

No firmware, screenshots, archives, staging folders or arbitrary files are cached.
The working firmware stores are deliberately outside this boundary.
"""
import argparse
import json
from pathlib import Path

FIELDS = {
    'hub-catalog.json': {'fetchedAt', 'url', 'userAgent', 'catalog'},
    'compat.json': {'schema', 'builds', 'macos', 'runtimes'},
    'native-macos.json': {'runtime', 'engine', 'environment', 'date', 'verified', 'missing', 'results'},
}


def stage(source, target):
    source, target = Path(source), Path(target)
    if source.is_symlink() or (source.exists() and not source.is_dir()):
        raise ValueError('Metadata source must be a normal directory')
    if target.exists(): raise ValueError('Metadata destination must be new')
    selected = {}
    for name, allowed in FIELDS.items():
        f = source/name
        if not f.exists() and not f.is_symlink(): continue
        if f.is_symlink() or not f.is_file(): raise ValueError('Unsafe metadata path: '+name)
        data = f.read_bytes()
        if len(data) > 16*1024*1024: raise ValueError('Oversized metadata: '+name)
        value = json.loads(data)
        if not isinstance(value, dict) or set(value)-allowed: raise ValueError('Unrecognised metadata fields: '+name)
        if name == 'hub-catalog.json' and not (isinstance(value.get('catalog'), dict) and isinstance(value['catalog'].get('firmwares'), list) and value.get('fetchedAt')):
            raise ValueError('Invalid Hub metadata')
        if name == 'compat.json' and not (value.get('schema') == 1 and isinstance(value.get('builds'), dict)):
            raise ValueError('Invalid compatibility metadata')
        if name == 'native-macos.json' and not isinstance(value.get('results'), dict):
            raise ValueError('Invalid native metadata')
        selected[name] = data
    # Write only bytes already validated; a failed check leaves no cache stage.
    target.mkdir(parents=True)
    for name, data in selected.items(): (target/name).write_bytes(data)
    return {'copied': sorted(selected), 'ignored': sorted(f.name for f in source.iterdir() if f.name not in selected) if source.exists() else []}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source', required=True); p.add_argument('--target', required=True)
    a = p.parse_args()
    print(json.dumps(stage(a.source, a.target), indent=2))


if __name__ == '__main__': main()
