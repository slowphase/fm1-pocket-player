#!/usr/bin/env python3
"""Build a finished ZIP from a site or the exact intended rolling-release files."""
import argparse
from pathlib import Path
import shutil
from hosting_guard import make_archive

p=argparse.ArgumentParser(description=__doc__)
g=p.add_mutually_exclusive_group(required=True);g.add_argument("--source");g.add_argument("--files")
p.add_argument("--stage");p.add_argument("--zip",required=True);a=p.parse_args()
if a.files:
    if not a.stage: p.error("--stage is required with --files")
    root=Path(a.stage)
    if root.exists(): raise ValueError("Stage must be new")
    root.mkdir();seen=set()
    for line in Path(a.files).read_text().splitlines():
        if not line: continue
        f=Path(line)
        if not f.is_file() or f.is_symlink() or not f.resolve().is_relative_to(Path.cwd().resolve()): raise ValueError("Unsafe/missing staged file: "+line)
        if f.name in seen: raise ValueError("Duplicate upload filename: "+f.name)
        seen.add(f.name);shutil.copyfile(f,root/f.name)
else: root=Path(a.source)
if Path(a.zip).resolve().is_relative_to(root.resolve()): raise ValueError("ZIP must be outside the source tree")
make_archive(root,a.zip)
