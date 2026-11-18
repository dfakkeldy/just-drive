#!/usr/bin/env python3
"""Bake LOOK-ONLY labelled stockpiles from NSTDB polygons and elevation only.

No imagery is read. Input data is read-only. Usage:
  python3 pipeline/33_bake_stockpiles.py SOURCE_DATA NEW_OUTPUT_FOLDER
The output folder must be new and outside baked and site data. The reviewed pack
is committed at tools/stockpiles-delta/, and the main thread installs it from there.
"""
import argparse
import json
import math
from pathlib import Path

import numpy as np
from osgeo import gdal, ogr, osr

ROOT = Path(__file__).absolute().parents[1]
SITES = ((3718, 'DAPI40', 'coal'), (1039, 'DASA42', 'logs'))
gdal.UseExceptions()
osr.UseExceptions()


def projected(feature):
    source = osr.SpatialReference(); source.ImportFromEPSG(4326)
    source.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    target = osr.SpatialReference(); target.ImportFromEPSG(2961)
    geom = ogr.CreateGeometryFromJson(json.dumps(feature['geometry']))
    geom.Transform(osr.CoordinateTransformation(source, target))
    return geom


def point(x, y):
    p = ogr.Geometry(ogr.wkbPoint); p.AddPoint_2D(float(x), float(y)); return p


def components(mask):
    remaining = set(zip(*np.where(mask)))
    while remaining:
        start = min(remaining); remaining.remove(start); todo = [start]; cells = []
        while todo:
            r, c = todo.pop(); cells.append((r, c))
            for q in ((r-1,c),(r+1,c),(r,c-1),(r,c+1)):
                if q in remaining:
                    remaining.remove(q); todo.append(q)
        yield sorted(cells)


def height_grid(path, bounds, step):
    ds = gdal.Warp('', str(path), format='MEM', dstSRS='EPSG:2961',
                   outputBounds=bounds, xRes=step, yRes=step,
                   resampleAlg='bilinear', dstNodata=-32767)
    return ds.ReadAsArray().astype(float), ds.GetGeoTransform()


def mesh(geom, exclusions, dtm, dsm, gt, kind, step):
    rows, cols = dtm.shape
    x = gt[0] + (np.arange(cols)+.5)*gt[1]
    y = gt[3] + (np.arange(rows)+.5)*gt[5]
    safe = geom.Buffer(-3)
    mask = np.zeros_like(dtm, dtype=bool)
    # A square's entire footprint must be in the open-data polygon, clear of
    # mapped buildings and roads. Do not fill imagery-derived outlines.
    for r,c in np.ndindex(mask.shape):
        p = point(x[c],y[r])
        mask[r,c] = safe.Contains(p) and not any(e.Intersects(p) for e in exclusions)
    valid = (dtm > -1000) & (dsm > -1000) & np.isfinite(dtm) & np.isfinite(dsm)
    edge = mask & ~np.logical_and.reduce([np.roll(mask,k,axis=a) for a in (0,1) for k in (-1,1)])
    base_values = dtm[edge & valid]
    if len(base_values)<4: return []
    baseline = float(np.percentile(base_values,30))
    above = dsm-dtm
    # Coal relief is already in the DTM: the skin takes the mapped pile from half a
    # metre above its foot, so the flanks are coal too and only the flat toe is left.
    # Log stacks are surface returns above the yard. Tall returns (trees/conveyors)
    # are omitted, never painted black.
    mask &= valid & ((above >= 1.2) & (above <= 8) if kind=='logs' else (above < 2.5) & (dtm > baseline+0.5))
    result=[];smallest=80 if kind=='coal' else 120
    for cells in components(mask):
        if len(cells)*step*step < smallest: continue
        lookup={p:i for i,p in enumerate(cells)}; vertices=[]; indices=[]
        for r,c in cells:
            ground=float(dtm[r,c]); top=ground if kind=='coal' else float(dsm[r,c])
            vertices.append([round(float(x[c]),2),round(float(y[r]),2),round(ground,2),round(top+.1,2)])
        for r,c in cells:
            # No bridge over missing/unsafe pixels. Boundary faces are omitted.
            square=((r,c),(r+1,c),(r,c+1),(r+1,c+1))
            if not all(p in lookup for p in square): continue
            # Verify the whole face also clears small holes, roads and buildings.
            ring=ogr.Geometry(ogr.wkbLinearRing)
            for rr,cc in (square[0],square[1],square[3],square[2],square[0]):ring.AddPoint_2D(float(x[cc]),float(y[rr]))
            face=ogr.Geometry(ogr.wkbPolygon);face.AddGeometry(ring)
            if not safe.Contains(face) or any(e.Intersects(face) for e in exclusions):continue
            a,b,c1,d=(lookup[p] for p in square)
            indices.extend([a,b,c1,b,d,c1])
        # A part whose kept faces are a speck (a few square metres) is noise, not a pile.
        if len(indices)//6*step*step < smallest:continue
        used=sorted(set(indices)); remap={v:i for i,v in enumerate(used)}
        vertices=[vertices[i] for i in used];indices=[remap[i] for i in indices]
        # The row direction is a line, not an arrow: an eigenvector's sign is not fixed, so the angle is kept in 0..pi.
        _,axes=np.linalg.eigh(np.cov(np.array([[v[0],v[1]] for v in vertices]).T));axis=axes[:,-1]
        result.append(dict(vertices=vertices,indices=indices,axis=round(math.atan2(float(axis[1]),float(axis[0]))%math.pi,5)))
    # A part of a few cells has no direction of its own (its grid gives 0): it takes the largest part's.
    if result:
        largest=max(result,key=lambda part:len(part['vertices']))
        for part in result:
            if len(part['vertices'])<12:part['axis']=largest['axis']
    return result


def bake(raw, baked):
    vectors=raw/'vectors'
    designated=json.loads((vectors/'BASE_NSTDB_10k_Designated_Areas_WM84__01_designated_area_polygons.geojson').read_text())['features']
    buildings=[projected(f) for f in json.loads((vectors/'BASE_NSTDB_10k_Buildings_WM84__04_building_polygons.geojson').read_text())['features']]
    roads=json.loads((baked/'roads.json').read_text())['roads']
    piles=[];report=[]
    for fid,code,kind in SITES:
        feature=next(f for f in designated if f['properties']['OBJECTID']==fid and f['properties']['FEAT_CODE']==code)
        geom=projected(feature);x0,x1,y0,y1=geom.GetEnvelope()
        bounds=(math.floor(x0/8)*8-8,math.floor(y0/8)*8-8,math.ceil(x1/8)*8+8,math.ceil(y1/8)*8+8)
        exclusions=[b.Buffer(4) for b in buildings if b.Intersects(geom.Buffer(4))]
        for road in roads:
            line=ogr.Geometry(ogr.wkbLineString)
            for p in road['pts']:line.AddPoint_2D(*p[:2])
            if line.Intersects(geom.Buffer(20)):exclusions.append(line.Buffer(road['halfWidth']+3))
        levels={}
        for name,step in (('high',4),('low',8)):
            dtm,gt=height_grid(raw/'elevation/land-dtm-1m-epsg3979.vrt',bounds,step)
            dsm,_=height_grid(raw/'elevation/land-dsm-1m-epsg3979.vrt',bounds,step)
            levels[name]=mesh(geom,exclusions,dtm,dsm,gt,kind,step)
        if not levels['high'] or not levels['low']:raise ValueError(f'{fid}: no measured mound in both qualities')
        c=geom.Centroid()
        piles.append(dict(id=f'{code}/{fid}',kind=kind,center=[round(c.GetX(),2),round(c.GetY(),2)],**levels))
        report.append(dict(id=f'{code}/{fid}',kind=kind,**{q:dict(mounds=len(parts),vertices=sum(len(p['vertices']) for p in parts),triangles=sum(len(p['indices'])//3 for p in parts)) for q,parts in levels.items()}))
    return dict(version=1,crs='EPSG:2961',area='pointtupper',piles=piles),report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source_data',type=Path,help='read-only data folder (holds raw/ and baked/)')
    parser.add_argument('output',type=Path,help='a NEW folder for stockpiles.json and report.json')
    args=parser.parse_args()
    out=args.output.absolute()
    # Never write into a land: the output must be a new folder outside the source data.
    if out.exists():raise SystemExit(f'Output folder already exists: {out}')
    if out.resolve().is_relative_to((args.source_data/'baked').resolve()) or out.resolve().is_relative_to((args.source_data/'site').resolve()):
        raise SystemExit(f'Output must not be inside baked or site data: {out}')
    data,report=bake(args.source_data/'raw/areas/pointtupper',args.source_data/'baked/areas/pointtupper')
    out.mkdir(parents=True)
    (out/'stockpiles.json').write_text(json.dumps(data,separators=(',',':'))+'\n')
    (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))


if __name__=='__main__':main()
