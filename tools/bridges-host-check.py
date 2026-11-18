#!/usr/bin/env python3
"""Keep OGR source fixtures off hosts that do not provide the bake's GDAL bindings."""
import ast
import contextlib
import csv
import importlib.util
import io
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('bridge_host_runner', root/'tools/remote_runner.py')
runner = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = runner
spec.loader.exec_module(runner)
names = ['bridges-source', 'bridges-source-mutations']
hosts = {r['name']: r for r in csv.DictReader((root/'tools/checks-hosts.tsv').open(), delimiter='\t')}
assert any(isinstance(n, ast.ImportFrom) and n.module == 'osgeo'
           for n in ast.walk(ast.parse((root/'pipeline/bridge_spans.py').read_text()))), \
    'GDAL dependency changed: review the source-fixture host classification too'


def verify(rows):
    assert all(rows.get(name, {}).get('where') == 'mac-only' for name in names), \
        'OGR source fixtures need the Mac GDAL environment, not portable clean-clone CI'
    with contextlib.redirect_stdout(io.StringIO()):
        assert runner.filter_rows(names, rows, 'Linux', True) == ([], True), \
            'allow-unproven must not send GDAL fixtures to a host without their runtime'
        assert runner.filter_rows(names, rows, 'Darwin', False) == (names, False), \
            'both real source commands remain selected on the Mac'


verify(hosts)
for name in names:
    broken = {key: dict(row) for key, row in hosts.items()}
    del broken[name]
    try:
        verify(broken)
    except AssertionError:
        print('KILLED missing GDAL host declaration:', name)
    else:
        raise AssertionError('missing host declaration survived: ' + name)
print('PASS bridge source host selection; source geometry assertions remain on the Mac')
