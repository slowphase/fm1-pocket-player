#!/usr/bin/env python3
"""Plan bounded rolling-package cleanup. A suspicious keep list deletes nothing."""
import argparse
import json
from pathlib import Path


def plan(assets, keep):
    current = {a['name'] for a in assets}
    packages = {n for n in current if n.endswith('.fwsc')}
    shots = {n for n in current if n.startswith('shot-') and n.endswith('.png')}
    keep = set(keep)
    keep_shots = {'shot-' + n[:-5] + '.png' for n in keep}
    obsolete_packages, obsolete_shots = packages - keep, shots - keep_shots
    reasons = []
    if not keep:
        reasons.append('Keep list is empty or package directory is missing')
    if len(keep) * 100 < len(packages) * 90:
        reasons.append('Expected package count shrank by more than 10%')
    for label, old, removed in [('packages', packages, obsolete_packages), ('screenshots', shots, obsolete_shots)]:
        if len(removed) * 100 > len(old) * 20:
            reasons.append('Cleanup would remove more than 20% of current ' + label)
    return {'deletionAllowed': not reasons, 'reasons': reasons,
            'currentPackages': len(packages), 'currentScreenshots': len(shots),
            'keepPackages': len(keep), 'proposedPackageDeletions': len(obsolete_packages),
            'proposedScreenshotDeletions': len(obsolete_shots),
            'delete': sorted(obsolete_packages | obsolete_shots) if not reasons else []}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--assets', required=True); p.add_argument('--keep-dir', required=True)
    p.add_argument('--delete-list', required=True); p.add_argument('--report', required=True)
    a = p.parse_args()
    directory = Path(a.keep_dir)
    keep = [f.name for f in directory.glob('*.fwsc') if f.is_file() and not f.is_symlink()] if directory.is_dir() else []
    result = plan(json.loads(Path(a.assets).read_text())['assets'], keep)
    Path(a.delete_list).write_text(''.join(n + '\n' for n in result['delete']))
    Path(a.report).write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))
    if not result['deletionAllowed']:
        print('::warning::Rolling package cleanup skipped: ' + '; '.join(result['reasons']))


if __name__ == '__main__': main()
