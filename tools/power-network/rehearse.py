#!/usr/bin/env python3
"""Serve a validated power delta through temporary public symlinks; never install land."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('power_delta', Path(__file__).with_name('make_delta.py'))
D=importlib.util.module_from_spec(spec)
spec.loader.exec_module(D)


def replacement(delta, relative, name):
    # Never overlay a road/building or any other unreviewed input supplied beside the step-29 output.
    return delta/relative/name if name in ('props.json', 'manifest.json') else None


def run(delta, command):
    delta=delta.resolve()
    D.check_properties(ROOT/'data/baked', overlay=delta, require_after=True)
    public=ROOT/'web/public'
    prior={name:os.readlink(public/name) for name in ('terrain','areas')}
    with tempfile.TemporaryDirectory(prefix='mmm-power1210-public-') as folder:
        scratch=Path(folder)
        def area(source,target,relative):
            target.mkdir(parents=True)
            for child in source.iterdir():
                revised=replacement(delta, relative, child.name)
                (target/child.name).symlink_to(revised if revised is not None else child)
        area((public/'terrain').resolve(),scratch/'terrain',Path('terrain'))
        (scratch/'areas').mkdir()
        for child in (public/'areas').resolve().iterdir():
            if child.is_dir() and (delta/'areas'/child.name).is_dir():
                area(child,scratch/'areas'/child.name,Path('areas')/child.name)
            else:
                (scratch/'areas'/child.name).symlink_to(child)
        try:
            for name in prior:
                (public/name).unlink()
                (public/name).symlink_to(scratch/name)
            return subprocess.run(command,cwd=ROOT,env={**os.environ,'POWER_1210_REHEARSAL':'1'}).returncode
        finally:
            for name,target in prior.items():
                (public/name).unlink()
                (public/name).symlink_to(target)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('delta',type=Path)
    parser.add_argument('command',nargs=argparse.REMAINDER)
    a=parser.parse_args()
    if not a.command:parser.error('command is required')
    raise SystemExit(run(a.delta,a.command))
