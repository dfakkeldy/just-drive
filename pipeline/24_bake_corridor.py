#!/usr/bin/env python3
"""Rebuild L7/L8 village + route corridors, preserving L0..L6 and cover.png.

Run in the GDAL container after 23_bake_roads.py. Uses the original terrain encode,
PNG writer and halve. One L5 block (2048 m) plus a 2 m halo is warped at a time.
Exact coordinate transforms and halo samples ensure identical block boundaries.
Every selected tile is rebuilt. Stale L7/L8 height tiles are removed explicitly.
"""
import collections
import gc
import json
import math
import os
import importlib.util

from osgeo import gdal, ogr
import numpy as np

from areas import current
from terrain_height_range import update_height_range

AREA = current()

spec = importlib.util.spec_from_file_location('roads', os.path.join(os.path.dirname(os.path.abspath(__file__)), '23_bake_roads.py'))
roads = importlib.util.module_from_spec(spec)
spec.loader.exec_module(roads)
b = roads.terrain


def bounds(level, i, j):
    size = b.SIZE / 2**level
    return (b.X0+i*size, b.Y1-(j+1)*size, b.X0+(i+1)*size, b.Y1-j*size)


def select(manifest, network):
    selected = {}
    mid = manifest['mid']
    for level, radius in [(7,450), (8,160)]:
        size = b.SIZE / 2**level
        chosen = set()
        for road in network:
            # The route's roads, and the rail trail (kind 5): it is driven too, and close up coarse ground looks wrong.
            if not b.AREA.corridor_road(road):
                continue
            g = ogr.Geometry(ogr.wkbLineString)
            for x,y in road['pts']:
                g.AddPoint_2D(x,y)
            x0,x1,y0,y1 = g.GetEnvelope()
            for j in range(math.floor((b.Y1-y1-radius)/size), math.floor((b.Y1-y0+radius)/size)+1):
                for i in range(math.floor((x0-radius-b.X0)/size), math.floor((x1+radius-b.X0)/size)+1):
                    bb = bounds(level,i,j)
                    if bb[0]<mid[0] or bb[1]<mid[1] or bb[2]>mid[2] or bb[3]>mid[3]:
                        continue
                    if g.Distance(roads.rectangle(bb)) <= radius:
                        chosen.add((i,j))
        # The original village box is a fixed part of the selection, independent of
        # a previous corridor run's manifest lists.
        fine = manifest['fine']
        for j in range(round((b.Y1-fine[3])/size),round((b.Y1-fine[1])/size)):
            for i in range(round((fine[0]-b.X0)/size),round((fine[2]-b.X0)/size)):
                bb = bounds(level,i,j)
                if bb[0]>=mid[0] and bb[1]>=mid[1] and bb[2]<=mid[2] and bb[3]<=mid[3]:
                    chosen.add((i,j))
        # Extra boxes an area asks for by hand (a quarry, a shore): every tile that touches one, inside mid.
        for x0, y0, x1, y1 in b.AREA.extra_fine:
            for j in range(math.floor((b.Y1-y1)/size), math.ceil((b.Y1-y0)/size)):
                for i in range(math.floor((x0-b.X0)/size), math.ceil((x1-b.X0)/size)):
                    bb = bounds(level,i,j)
                    if bb[0]>=mid[0] and bb[1]>=mid[1] and bb[2]<=mid[2] and bb[3]<=mid[3]:
                        chosen.add((i,j))
        selected[level] = chosen
    return selected


def warp_exact(path, bb):
    x0,y0,x1,y1 = bb
    ds = gdal.Warp('', path, format='MEM', dstSRS='EPSG:2961', xRes=1,yRes=1,
                   outputBounds=(x0-.5,y0-.5,x1+.5,y1+.5),resampleAlg='bilinear',
                   dstNodata=b.NODATA, errorThreshold=0, warpMemoryLimit=128*1024*1024,
                   multithread=False)
    a = ds.GetRasterBand(1).ReadAsArray().astype(np.float32)
    a[~np.isfinite(a)] = b.NODATA
    return a


def main():
    manifest = json.load(open(f'{b.OUT}/manifest.json'))
    network = json.load(open(f'{b.OUT}/roads.json'))['roads']
    selected = select(manifest,network)
    print('Selection:', {k:len(v) for k,v in selected.items()}, flush=True)
    if len(selected[8]) > b.AREA.fine_tile_limit:
        raise RuntimeError(f'L8 tile count exceeds {b.AREA.fine_tile_limit}; no terrain changed')
    # Before writing, bound the size at 120 kB per RGB tile. Measured on 10 Nov 2026: 101 kB a tile at level 7
    # and 90 kB at level 8. (The first bound, 200 kB, refused the rail trail's 200 extra tiles.) The loop below
    # still stops at 300 MiB of real output.
    # An area with a higher tile guard gets a byte guard in the same ratio (300 MiB for the usual 1500 tiles).
    limit_mib = 300*b.AREA.fine_tile_limit//1500
    estimate = sum(len(v) for v in selected.values())*120000
    if estimate > limit_mib*1024*1024:
        raise RuntimeError(f'Conservative size estimate {estimate} exceeds {limit_mib} MiB; no terrain changed')
    blocks = collections.defaultdict(list)
    for level, tiles in selected.items():
        for i,j in tiles:
            blocks[(i//2**(level-5), j//2**(level-5))].append((level,i,j))
    total = 0
    # >>> road-ground trial (off unless asked for): shape the 1 m ground under the roads. See road_ground.py.
    shaping = None
    if os.environ.get('MMM_ROAD_GROUND') == '1':
        import road_ground
        streams = road_ground.baked_brooks(f'{b.OUT}/streams.json')
        profiles, flagged = road_ground.profiles(road_ground.DemSampler(str(AREA.elevation('dtm'))), network)
        shaping = dict(profiles=profiles, streams=streams, blocks=[])
        print(f'Road ground: {len(profiles)} roads get a height line; {len(flagged)} stretches held at the {road_ground.LIMIT} m limit', flush=True)
    # <<< road-ground trial
    for n, ((bi,bj),tiles) in enumerate(sorted(blocks.items()),1):
        bb = bounds(5,bi,bj)
        halo = (bb[0]-2,bb[1]-2,bb[2]+2,bb[3]+2)
        dtm = warp_exact(str(AREA.elevation("dtm")), halo)
        dsm = warp_exact(str(AREA.elevation("dsm")), halo)
        # >>> road-ground trial
        if shaping:
            # The shaping reads ground further out than the 2 m the tiles need; the tiles are cut from the middle.
            wide = (bb[0]-road_ground.HALO,bb[1]-road_ground.HALO,bb[2]+road_ground.HALO,bb[3]+road_ground.HALO)
            shaped, stats = road_ground.shape_block(warp_exact(str(AREA.elevation("dtm")), wide), wide[0], wide[3],
                                                    shaping['profiles'], shaping['streams'], AREA.keep_roads)
            cut = road_ground.HALO-2
            shaped = np.ascontiguousarray(shaped[cut:-cut,cut:-cut])
            # Trees and roofs keep their height above the ground that moved under them.
            both = (dtm != b.NODATA) & (dsm != b.NODATA)
            dsm[both] += (shaped - dtm)[both]
            dtm = shaped
            shaping['blocks'].append(dict(block=[bi,bj], **stats))
        # <<< road-ground trial
        # Pad extends beyond the cut, so halve's edge padding is never sampled.
        hdtm, hdsm = b.halve(dtm), b.halve(dsm)
        for level,i,j in sorted(tiles):
            tb = bounds(level,i,j)
            r = b.res(level)
            col, row = round((tb[0]-halo[0])/r), round((halo[3]-tb[3])/r)
            a,c = (dtm,dsm) if level==8 else (hdtm,hdsm)
            rgb,_ = b.encode(a[row:row+257,col:col+257], c[row:row+257,col:col+257])
            assert rgb.shape == (3,257,257)
            os.makedirs(f'{b.OUT}/{level}',exist_ok=True)
            path = f'{b.OUT}/{level}/{i}_{j}.png'
            b.write_png(path,rgb)
            total += os.path.getsize(path)
        del dtm,dsm,hdtm,hdsm,a,c,rgb
        gc.collect()
        print(f'Block {n}/{len(blocks)}; {total:,} bytes written',flush=True)
        if total > limit_mib*1024*1024:
            raise RuntimeError(f'{limit_mib} MiB limit reached; stopped before manifest update')
    for level,tiles in selected.items():
        names = {f'{i}_{j}' for i,j in tiles}
        stale = []
        for filename in os.listdir(f'{b.OUT}/{level}'):
            if filename.endswith('.png') and not filename.endswith('.r.png') and filename[:-4] not in names:
                os.remove(f'{b.OUT}/{level}/{filename}')
                stale.append(filename)
        manifest['levels'][str(level)] = [f'{i}_{j}' for i,j in sorted(tiles,key=lambda p:(p[1],p[0]))]
        print(f'L{level}: {len(tiles)} tiles; removed {len(stale)} stale height tiles',flush=True)
    update_height_range(manifest, b.OUT)
    with open(f'{b.OUT}/manifest.json','w') as f:
        json.dump(manifest,f)
    print(f'Corridor height total: {total:,} bytes',flush=True)
    # >>> road-ground trial
    if shaping:
        os.makedirs(b.OVERVIEW, exist_ok=True)
        with open(f'{b.OVERVIEW}/road-ground-report.json','w') as f:
            # Stretches that the grid itself held at the limit join the list (a block names a road by its id).
            names = {p['id']: p['name'] for p in shaping['profiles'].values()}
            on_grid = [dict(name=names.get(h['id']), where='grid', **h) for s in shaping['blocks'] for h in s.pop('held')]
            json.dump(dict(roads=len(shaping['profiles']), flagged=flagged + on_grid, blocks=shaping['blocks']), f, indent=1)
        print(f"Road ground: {sum(s['cells'] for s in shaping['blocks']):,} square metres changed", flush=True)
    # <<< road-ground trial


if __name__=='__main__':
    main()
