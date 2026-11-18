#!/usr/bin/env python3
"""Prove version/capability selection using tiny local executables, no network."""
import os
from pathlib import Path
import shlex
import subprocess
import tempfile
ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='mmm-wrangler-test-') as folder:
    root = Path(folder)
    def fake(name, version, supported):
        p = root / name
        p.write_text('#!/bin/sh\nif [ "$1" = --version ]; then echo '+shlex.quote(version)+'; else echo '+shlex.quote('--infer-origin-from-routes' if supported else '--other-flag')+'; fi\n')
        p.chmod(0o755); return p
    older = fake('older', '4.160.0', True)
    latest = fake('latest', '4.161.0', True)
    unsupported = fake('unsupported', '4.999.0', False)
    bin=root/'bin';bin.mkdir();fallback=fake('bin/wrangler','9.0.0',True)
    def select(*paths, explicit=None, require=False):
        env = dict(os.environ); env.pop('WRANGLER', None);env['PATH']=str(bin)+os.pathsep+env['PATH']
        if explicit is not None: env['WRANGLER'] = str(explicit)
        command = 'source '+shlex.quote(str(ROOT/'tools/wrangler.sh'))+'; mmm_select_wrangler "$@" || exit $?; printf "%s" "$WRANGLER"'
        return subprocess.run(['bash','-c',command,'selection',*(['--require-origin-flag'] if require else []),*map(str, paths)],env=env,capture_output=True,text=True)
    r = select(older, unsupported, latest, require=True); assert r.returncode == 0 and r.stdout == str(latest),r
    r = select(older, latest, explicit=unsupported, require=True); assert r.returncode == 0 and r.stdout == str(unsupported),r
    r=select(older,unsupported,latest);assert r.returncode==0 and r.stdout==str(unsupported),'MP checks must not require the unused flag'
    r=select(unsupported,require=True);assert r.returncode==0 and r.stdout==str(fallback),'PATH must be a fallback'
    banner=fake('banner','4.100.0\nupdate available 99.0.0',True)
    r=select(banner,latest,require=True);assert r.returncode==0 and r.stdout==str(latest),'update banner must not rank a candidate'
    fake('bin/wrangler','9.0.0',False)
    r = select(unsupported,require=True); assert r.returncode == 2 and '4.999.0' in r.stderr and '9.0.0' in r.stderr,r
print('PASS Wrangler: cache priority, PATH fallback, first-line version, optional capability, environment priority, versions named')
