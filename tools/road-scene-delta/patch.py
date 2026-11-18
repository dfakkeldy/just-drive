#!/usr/bin/env python3
"""Write a small reviewed delta to a NEW folder. Never write into the source land."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'pipeline'))
from dashcam_corrections import correct_roads, hand_buildings, hand_styles, remap_road_references


def sha(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return (json.dumps(value, separators=(',', ':'), allow_nan=False)+'\n').encode()


def make(source, output, verify=True):
    import numpy as np
    from osgeo import gdal
    gdal.UseExceptions()
    source, output = source.resolve(), output.resolve()
    live = (ROOT/'data').resolve()
    if output.exists() or output == source or output.is_relative_to(source) or source.is_relative_to(output) or output.is_relative_to(live):
        raise ValueError('Output must be NEW, separate from source, and outside data/')
    output.mkdir(parents=True)
    files = []
    def save(path, data):
        before = (source/path).read_bytes()
        if before == data:
            return
        target = output/path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        files[:] = [f for f in files if f['file'] != str(path)]
        files.append(dict(file=str(path), before=sha(before), sha256=sha(data)))
    for area, relative in [('judique', Path('areas/judique')), ('mabou', Path('terrain'))]:
        os.environ['MMM_AREA'] = area
        # Stage25's imports bind the area. Load its complete dependency graph afresh per area.
        for name in ['areas']:
            sys.modules.pop(name, None)
        import areas
        # The installed manifest already pins the snapped anchor; no raw vectors are needed.
        areas.current().__dict__['bake_anchor'] = tuple(json.loads((source/relative/'manifest.json').read_bytes())['village'])
        spec = importlib.util.spec_from_file_location('fields1199', ROOT/'pipeline/25_bake_road_fields.py')
        fields = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(fields)
        folder = source/relative
        raw = (folder/'roads.json').read_bytes()
        network = json.loads(raw)
        before = network['roads']
        after = correct_roads(before, area)
        old, new = fields.Field(before), fields.Field(after)
        changed = [r for r in after if r not in before]
        # Split parts are all marked. Width and explicit rail metadata are included in bounds.
        points = np.array([p for r in changed for p in r['pts']])
        lo, hi = points.min(axis=0)-13, points.max(axis=0)+13
        manifest_raw = (folder/'manifest.json').read_bytes()
        manifest = json.loads(manifest_raw)
        for level in (5,6,7,8):
            for name in manifest['roads']['levels'][str(level)]:
                i,j = map(int,name.split('_'))
                bb = fields.corridor.bounds(level,i,j)
                if bb[2]<lo[0] or bb[0]>hi[0] or bb[3]<lo[1] or bb[1]>hi[1]:
                    continue
                xs = bb[0]+np.arange(257)*fields.b.res(level)
                ys = bb[3]-np.arange(257)*fields.b.res(level)
                prior, revised = old.raster(xs,ys), new.raster(xs,ys)
                assert np.array_equal(prior[0], revised[0]), 'Road geometry changed'
                mask = np.any(prior != revised, axis=0)
                if not mask.any():
                    continue
                path = relative/f'{level}/{name}.r.png'
                actual = gdal.Open(str(source/path)).ReadAsArray()
                if not np.array_equal(actual[:,mask], prior[:,mask]):
                    raise ValueError(f'Stale road fields: {path}; regenerate/review on current land')
                actual[:,mask] = revised[:,mask]
                target = output/path
                target.parent.mkdir(parents=True, exist_ok=True)
                fields.b.write_png(str(target),actual)
                assert np.array_equal(gdal.Open(str(target)).ReadAsArray(),actual)
                assert np.array_equal(actual[:,~mask],gdal.Open(str(source/path)).ReadAsArray()[:,~mask])
                files.append(dict(file=str(path),before=sha((source/path).read_bytes()),sha256=sha(target.read_bytes())))
        network['roads'] = after
        road_bytes = json.dumps(network,separators=(',', ':')).encode()
        save(relative/'roads.json',road_bytes)
        cemetery = json.loads((folder/'cemeteries.json').read_bytes())
        if cemetery['roadsSha256'] != sha(raw):
            raise ValueError('Stale cemeteries road hash')
        cemetery = remap_road_references(cemetery, 'cemeteries', after)
        cemetery['roadsSha256'] = sha(road_bytes)
        save(relative/'cemeteries.json',encoded(cemetery))
        for kind in ('buildings', 'streams', 'props'):
            data = json.loads((folder/f'{kind}.json').read_bytes())
            revised = remap_road_references(data, kind, after)
            if revised != data:
                save(relative/f'{kind}.json', encoded(revised))
        if area == 'mabou':
            dtm = gdal.Open(str(fields.corridor.roads.AREA.elevation('dtm')))
            def ground(x,y):
                ds = gdal.Warp('',dtm,format='MEM',dstSRS='EPSG:2961',xRes=1,yRes=1,
                               outputBounds=(x-1,y-1,x+1,y+1),resampleAlg='bilinear',errorThreshold=0,dstNodata=-32767)
                a = ds.ReadAsArray()
                return float(np.median(a[a != -32767]))
            buildings = remap_road_references(json.loads((folder/'buildings.json').read_bytes()), 'buildings', after)
            buildings['buildings'] = hand_buildings(buildings['buildings'],area,ground,after)
            save(relative/'buildings.json',encoded(buildings))
            styles = json.loads((folder/'building-styles.json').read_bytes())
            hand_styles(styles,buildings['buildings'],after)
            save(relative/'building-styles.json',encoded(styles))
            manifest['buildings']['count'] = len(buildings['buildings'])
            manifest['buildingStyles']['count'] = len(styles['styles'])
            save(relative/'manifest.json',encoded(manifest))
            old_manifest = json.loads(manifest_raw)
            manifest_entry = next(f for f in files if f['file'] == str(relative/'manifest.json'))
            manifest_entry['ownedCounts'] = {state:{key:value[key]['count'] for key in ('buildings','buildingStyles')}
                                       for state,value in [('before',old_manifest),('after',manifest)]}
    report = dict(version=1, files=sorted(files,key=lambda f:f['file']))
    (output/'hashes.json').write_bytes(encoded(report))
    if verify:
        committed = json.loads((ROOT/'tools/road-scene-delta/hashes.json').read_text())
        if report != committed:
            raise ValueError('STALE RECEIPT: generated files differ from committed hashes. Do not install; review a new delta.')
    print(f'{len(files)} files, {sum((output/f["file"]).stat().st_size for f in files):,} bytes in {output}')
    return report



if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source',type=Path,help='baked root containing terrain/ and areas/')
    parser.add_argument('output',type=Path)
    parser.add_argument('--record',action='store_true',help='prepare changed receipt for review; never installs or edits committed receipt')
    args = parser.parse_args()
    make(args.source,args.output,verify=not args.record)
