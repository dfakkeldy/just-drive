#!/usr/bin/env python3
"""Create a surface-only delta in a new output directory; never modify the input."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import numpy as np
from osgeo import gdal

p = argparse.ArgumentParser()
p.add_argument('source', type=Path)
p.add_argument('output', type=Path)
p.add_argument('--industrial', action='store_true', help='Point Tupper road 107 (the only delta to install)')
p.add_argument('--width', action='store_true', help='stage road 107 width and paint on surface-corrected land')
a = p.parse_args()
if not (a.industrial or a.width):
    # Road 634 at Mabou is withdrawn (16 Nov 2026): kind 2 makes a driveway a public road. See README.
    raise SystemExit('Road 634 is withdrawn and not installable; see tools/industrial-surface/README.md')
os.environ['MMM_AREA'] = 'pointtupper'
a.source = a.source.resolve()
a.output = a.output.resolve()
if a.output == a.source or a.source in a.output.parents or a.output in a.source.parents:
    raise ValueError('Source and output must be separate trees')
if a.output.exists():
    raise ValueError('Output must be new')
root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / 'pipeline'))
spec = importlib.util.spec_from_file_location('fields', root / 'pipeline/25_bake_road_fields.py')
f = importlib.util.module_from_spec(spec)
spec.loader.exec_module(f)
raw = (a.source / 'roads.json').read_bytes()
network = json.loads(raw)
road_id = 107
expected_name = 'Industrial Park Road'
start = [629754.71, 5047949.24]
end = [628480.9, 5051737.82]
road = next(r for r in network['roads'] if r['id'] == road_id)
kind_before = 2 if a.width else 4
if not (road['kind'] == kind_before and road['name'] == expected_name and road['halfWidth'] == 1.5):
    raise ValueError('Unexpected road classification')
if road['pts'][0] != start:
    raise ValueError('Unexpected road start')
if road['pts'][-1] != end:
    raise ValueError('Unexpected road end')
old = f.Field(network['roads'])
road['kind'] = 2
if a.width:
    # Bear Head LNG environmental assessment, table 6.38: two 3.6 m travel lanes.
    road.update(halfWidth=3.6, pavement='double-yellow')
new = f.Field(network['roads'])
manifest = json.loads((a.source / 'manifest.json').read_bytes())
a.output.mkdir(parents=True)
changed = []
def save(relative, data, before):
    target = a.output / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    changed.append(dict(file=relative, before=hashlib.sha256(before).hexdigest(),
                        sha256=hashlib.sha256(data).hexdigest()))
roads_out = json.dumps(network, separators=(',', ':')).encode()
save('roads.json', roads_out, raw)
# Stage 32_bake_cemeteries pins the SHA-256 of roads.json in cemeteries.json. A re-bake on the patched roads
# (16 Nov 2026, both areas) changed that field and nothing else, so write the bake's own bytes with the new hash.
cemeteries_raw = (a.source / 'cemeteries.json').read_bytes()
cemeteries = json.loads(cemeteries_raw)
if (json.dumps(cemeteries, separators=(',', ':')) + '\n').encode() != cemeteries_raw:
    raise ValueError('cemeteries.json is not in the bake format')
if cemeteries['roadsSha256'] != hashlib.sha256(raw).hexdigest():
    raise ValueError('Stale cemeteries.json: it was baked from another roads.json')
cemeteries['roadsSha256'] = hashlib.sha256(roads_out).hexdigest()
save('cemeteries.json', (json.dumps(cemeteries, separators=(',', ':')) + '\n').encode(), cemeteries_raw)
pts = np.array(road['pts'])
lo, hi = pts.min(axis=0)-12.7, pts.max(axis=0)+12.7
pixels = 0
for level in (5, 6, 7, 8):
    for name in manifest['roads']['levels'][str(level)]:
        i,j = map(int, name.split('_'))
        bb = f.corridor.bounds(level,i,j)
        if bb[2] < lo[0] or bb[0] > hi[0] or bb[3] < lo[1] or bb[1] > hi[1]:
            continue
        xs = bb[0]+np.arange(257)*f.b.res(level)
        ys = bb[3]-np.arange(257)*f.b.res(level)
        prior, after = old.raster(xs,ys), new.raster(xs,ys)
        if not np.array_equal(prior[0], after[0]) or (not a.width and not np.array_equal(prior[1], after[1])):
            raise ValueError('Geometry or width changed')
        mask = np.any(prior != after, axis=0)
        if not mask.any(): continue
        relative = f'{level}/{name}.r.png'
        source = a.source / relative
        actual = gdal.Open(str(source)).ReadAsArray()
        if not np.array_equal(actual[:,mask], prior[:,mask]):
            raise ValueError(f'Stale source field: {relative}')
        if a.width:
            on_pavement = np.abs(actual[0].astype(int) - 128) * 2 <= actual[1]
            pixels += int((mask & on_pavement).sum())
        actual[:,mask] = after[:,mask]
        target = a.output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        f.b.write_png(str(target), actual)
        verified = gdal.Open(str(target)).ReadAsArray()
        original = gdal.Open(str(source)).ReadAsArray()
        if not np.array_equal(verified, actual):
            raise ValueError('Output did not round-trip')
        if not np.array_equal(verified[0], original[0]) or (not a.width and not np.array_equal(verified[1], original[1])):
            raise ValueError('Output geometry or width changed')
        if not np.array_equal(verified[:,~mask], original[:,~mask]):
            raise ValueError('Output changed outside target road')
        changed.append(dict(file=relative,before=hashlib.sha256(source.read_bytes()).hexdigest(),
                            sha256=hashlib.sha256(target.read_bytes()).hexdigest(),pixels=int(mask.sum())))
        if not a.width:
            pixels += int(mask.sum())
report = dict(road=road_id,kindBefore=kind_before,kindAfter=2,pixels=pixels,files=changed)
if a.width:
    report.update(halfWidthBefore=1.5, halfWidthAfter=3.6, pixelsMeaning='paved samples before widening')
(a.output/'hashes.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
