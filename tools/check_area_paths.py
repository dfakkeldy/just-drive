#!/usr/bin/env python3
"""Prove that actual Python and bake.sh entry points stay inside a symlink proof root.

No raw data is required, and no bake runs. This catches Python's sys.path[0]
symlink resolution, which a simple `python -c` import probe does not exercise.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).absolute().parent.parent


def main():
    env = dict(os.environ, BAKE_IN='local', PYTHONDONTWRITEBYTECODE='1')
    env.pop('AREA', None)
    env.pop('MMM_AREA', None)
    with tempfile.TemporaryDirectory(prefix='mmm-area-paths-') as folder:
        root = Path(folder).resolve()
        (root/'pipeline').symlink_to(ROOT/'pipeline')
        (root/'tools').symlink_to(ROOT/'tools')
        for name in ('mabou', 'judique'):
            env['MMM_AREA'] = name
            for command in ([sys.executable, str(root/'pipeline/areas.py'), '--paths'],
                            ['/bin/bash', str(root/'tools/bake.sh'), 'areas.py', '--paths']):
                result = subprocess.run(command, cwd=root, env=env, text=True,
                                        capture_output=True, check=True)
                record = next(json.loads(line) for line in result.stdout.splitlines() if line.startswith('{'))
                assert record['root'] == str(root), record
                assert record['area'] == name, record
                raw = 'data/raw' if name == 'mabou' else 'data/raw/areas/judique'
                output = 'data/baked/terrain' if name == 'mabou' else 'data/baked/areas/judique'
                overview = 'data/work/overview' if name == 'mabou' else 'data/work/overview/judique'
                assert record['raw'] == str(root/raw), record
                assert record['output'] == str(root/output), record
                assert record['overview'] == str(root/overview), record
        # A bake step removes the area's READY marker. The area name is part of that path, so a name that is
        # not a plain name must stop bake.sh before it touches any file.
        areas = root/'data/baked/areas'
        marker = areas/'judique/READY'
        marker.parent.mkdir(parents=True)
        victim = root/'victim/READY'
        victim.parent.mkdir()
        bash = ['/bin/bash', str(root/'tools/bake.sh'), 'areas.py', '--paths']
        # kk_KZ.PT154: on macOS its [a-z] range also matches '.' and '/'. Where it is not installed bash uses C.
        for locale in (None, 'kk_KZ.PT154'):
            for name in ('../../../victim', 'judique/../../../../victim', '/tmp', 'Judique', '', ' judique', 'judique\n', 'judique.x', '1judique'):
                # The file that an unchecked name would remove. It must exist before the run, or the case proves nothing.
                target = Path(os.path.normpath(f'{areas}/{name}/READY')) if name else None
                for key in ('AREA', 'MMM_AREA'):
                    marker.write_text('ready'); victim.write_text('keep')
                    if target:
                        target.parent.mkdir(parents=True, exist_ok=True); target.write_text('keep')
                    bad = dict({k: v for k, v in env.items() if k != 'MMM_AREA'}, **{key: name}, **({'LC_ALL': locale} if locale else {}))
                    result = subprocess.run(bash, cwd=root, env=bad, text=True, capture_output=True)
                    if name == '':      # an empty name means the default area, Mabou, which has no marker
                        assert result.returncode == 0 and '"area": "mabou"' in result.stdout, (name, result)
                    else:
                        assert result.returncode == 1 and 'plain area name' in result.stderr and not result.stdout, (locale, key, name, result)
                        assert target.read_text() == 'keep', (locale, key, name)
                    assert victim.read_text() == 'keep' and marker.exists(), (locale, key, name)
        env['MMM_AREA'] = 'judique'
        marker.write_text('ready')
        subprocess.run(bash, cwd=root, env=env, check=True, capture_output=True)
        assert not marker.exists() and victim.read_text() == 'keep', 'a step for a real area still removes its own READY marker only'
    print('PASS: direct Python and bake.sh stay in the symlink proof root for both areas; temporary root removed.')
    print('PASS: bake.sh refuses an area name that is not a plain name, before it removes any READY marker.')


if __name__ == '__main__':
    main()
