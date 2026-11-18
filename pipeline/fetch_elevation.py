#!/usr/bin/env python3
"""Fetch federal HRDEM on its native grid; --dry-run reads metadata only.

New areas use horizontal source-grid strips around the rotated mid box plus
300 m. A VRT joins them without resampling or duplicating pixel data. Windows
are split at the 10_3 / 11_3 mosaic boundary. DEFLATE preserves Float32 samples.
"""
import argparse
import json
import math
import os

from osgeo import gdal, ogr, osr
from areas import current

gdal.UseExceptions()
for key, value in dict(GDAL_HTTP_MAX_RETRY='8', GDAL_HTTP_RETRY_DELAY='5',
                       GDAL_CACHEMAX='512', CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif,.vrt').items():
    gdal.SetConfigOption(key, os.environ.get(key, value))
BASE = '/vsicurl/https://canelevation-dem.s3.ca-central-1.amazonaws.com/hrdem-mosaic-1m'


def source(tile, kind):
    return f'{BASE}/{tile}-mosaic-1m-{kind}.vrt'


def transform(src, dst):
    a, b = osr.SpatialReference(), osr.SpatialReference()
    a.ImportFromEPSG(src); b.ImportFromEPSG(dst)
    for s in (a, b):
        s.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    return osr.CoordinateTransformation(a, b)


def polygon(points):
    ring = ogr.Geometry(ogr.wkbLinearRing)
    for x, y in points:
        ring.AddPoint_2D(x, y)
    ring.CloseRings()
    out = ogr.Geometry(ogr.wkbPolygon); out.AddGeometry(ring)
    return out


def footprint(area):
    x0, y0, x1, y1 = area.mid
    g = polygon([(x0-300, y0-300), (x1+300, y0-300),
                 (x1+300, y1+300), (x0-300, y1+300)])
    # Densify before projecting so curved edges cannot truncate a corner.
    g.Segmentize(100)
    g.Transform(transform(2961, 3979))
    return g


def windows(area, kind):
    shape = footprint(area)
    lo, hi, bottom, top = shape.GetEnvelope()
    result = []
    tiles = ('11_3',) if area.elevation_window else (
        ('10_3', '11_3') if lo < 2500000 < hi else (('10_3',) if hi <= 2500000 else ('11_3',)))
    for tile in tiles:
        ds = gdal.Open(source(tile, kind))
        gt = ds.GetGeoTransform()
        if gt[1] != 1 or gt[5] != -1 or gt[2] or gt[4]:
            raise RuntimeError('HRDEM native grid changed; expected north-up 1 m samples')
        if area.elevation_window:
            # Keep the exact legacy window and single source for Mabou.
            if tile != '11_3':
                continue
            x0, y0, x1, y1 = area.elevation_window
            c0, r0 = math.floor(x0-gt[0]), math.floor(gt[3]-y1)
            c1, r1 = math.ceil(x1-gt[0]), math.ceil(gt[3]-y0)
            result.append(dict(tile=tile, window=[c0,r0,c1-c0,r1-r0],
                               bounds=[x0,y0,x1,y1], pixels=(c1-c0)*(r1-r0)))
            continue
        r0 = max(0, math.floor(gt[3]-top)); r1 = min(ds.RasterYSize, math.ceil(gt[3]-bottom))
        for row in range(r0, r1, 256):
            end = min(row+256, r1)
            y0, y1 = gt[3]-end, gt[3]-row
            strip = shape.Intersection(polygon([(lo-1,y0),(hi+1,y0),(hi+1,y1),(lo-1,y1)]))
            if strip.IsEmpty():
                continue
            left, right, _, _ = strip.GetEnvelope()
            col = max(0, math.floor(left-gt[0])); last = min(ds.RasterXSize, math.ceil(right-gt[0]))
            if last <= col:
                continue
            result.append(dict(tile=tile, window=[col,row,last-col,end-row],
                bounds=[gt[0]+col,y0,gt[0]+last,y1], pixels=(last-col)*(end-row)))
    if not result:
        raise RuntimeError('No source windows cover this area')
    return result


def budget(area, plan, limit=900_000_000):
    pixels = sum(w['pixels'] for w in plan)
    # Float32 source samples plus conservative compression/container allowance.
    # The network transfer is block-based and server-compressed, so it is an estimate.
    raw = math.ceil(pixels*8*1.01)
    ni = area.mid_tiles[2]-area.mid_tiles[0]; nj = area.mid_tiles[3]-area.mid_tiles[1]
    mid = ni*nj
    # Every possible tile, even sea, at every baked level; PNG's raw RGB size plus overhead.
    height_tiles = sum(4**level for level in range(5))+mid*sum(4**k for k in range(4))
    field_tiles = mid*sum(4**k for k in range(4))
    png = (height_tiles+field_tiles)*200000
    trees = 60_000_000  # existing pipeline's hard cap
    cover = math.ceil((ni*2048/5)*(nj*2048/5)*3*1.01)
    vectors, json_bytes = 50_000_000, 20_000_000
    baked = png+trees+cover+json_bytes
    g = footprint(area); l,r,b,t = g.GetEnvelope()
    return dict(area=area.id, windowPixelsPerKind=pixels, nativeFloatBytesBoth=pixels*8,
                estimatedDownloadBytesBoth=raw, rawDiskUpperEstimate=raw,
                envelopePixels=math.ceil(r-l)*math.ceil(t-b), polygonSquareMetres=round(g.GetArea()),
                vectorReserveBytes=vectors, bakedUpperEstimateBytes=baked,
                completeUpperEstimateBytes=raw+vectors+baked, limitBytes=limit,
                method='256-row native windows, Float32 lossless DEFLATE; no resampling; wide rasters shared by path')


def fetch(area, kind, plan):
    out = area.elevation(kind); out.parent.mkdir(parents=True, exist_ok=True)
    receipt = out.with_suffix('.fetch.json')
    previous = json.loads(receipt.read_text()) if receipt.exists() else {}
    if out.exists() and (area.elevation_window or (previous.get('windows') == plan and
            all((out.parent / name).is_file() for name in previous.get('files', [])))):
        print(f'have {out}', flush=True); return
    parts = []
    for index, item in enumerate(plan):
        target = out if area.elevation_window else out.parent / f'{kind}-{index:03d}-{item["tile"]}.tif'
        reuse = target.exists()
        if reuse and not area.elevation_window:
            ds = gdal.Open(str(target))
            x0,y0,x1,y1 = item['bounds']
            reuse = (ds.RasterXSize,ds.RasterYSize) == tuple(item['window'][2:]) and \
                    ds.GetGeoTransform() == (x0,1,0,y1,0,-1)
            ds = None
        if not reuse:
            temporary = target.with_suffix(target.suffix+'.part')
            print(f'fetch {kind} {index+1}/{len(plan)} {item}', flush=True)
            gdal.Translate(str(temporary), source(item['tile'],kind), format='GTiff',
                srcWin=item['window'], creationOptions=['TILED=YES','COMPRESS=DEFLATE','PREDICTOR=3','BIGTIFF=IF_SAFER'])
            os.replace(temporary,target)
        print(json.dumps(dict(file=str(target),downloadedFileBytes=target.stat().st_size)), flush=True)
        parts.append(str(target))
    if not area.elevation_window:
        temporary = out.with_suffix('.part.vrt')
        ds = gdal.BuildVRT(str(temporary),parts, resolution='highest'); ds = None
        # Relative source paths keep the raw area folder portable.
        os.replace(temporary,out)
        receipt.write_text(json.dumps(dict(windows=plan, files=[os.path.basename(p) for p in parts]), indent=2)+'\n')
        # Remove only obsolete strips named in our previous receipt, after the new VRT is complete.
        for name in set(previous.get('files', [])) - {os.path.basename(p) for p in parts}:
            if os.path.basename(name) == name and name.startswith(kind+'-') and name.endswith('.tif'):
                (out.parent / name).unlink(missing_ok=True)
    print(f'{out}: {out.stat().st_size:,} bytes', flush=True)


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--dry-run',action='store_true'); ap.add_argument('--wide',action='store_true')
    ap.add_argument('--max-total-bytes',type=int,default=900_000_000,
                    help='Complete-area disk budget; default is the first-bite 900 MB gate')
    args=ap.parse_args(); area=current()
    if args.wide:
        for kind in ('dtm','dsm'):
            out=area.wide(kind)
            print(json.dumps(dict(file=str(out), sharedFrom=area.wide_source, pixels=4097**2,
                 estimatedUncompressedBytes=4097**2*4, exists=out.exists())),flush=True)
            if args.dry_run or out.exists(): continue
            if area.wide_source:
                raise RuntimeError(f'Shared wide raster is missing: {out}; fetch it explicitly for its owning area')
            x0,y1=area.origin; out.parent.mkdir(parents=True,exist_ok=True)
            temp=out.with_suffix('.part.tif')
            # Preserve the legacy root fetch; new roots can span both mosaics.
            tiles = ('11_3',) if area.legacy_manifest else ('10_3','11_3')
            gdal.Warp(str(temp),[source(t,kind) for t in tiles],format='GTiff',
                dstSRS='EPSG:2961',outputBounds=(x0-8,y1-65536-8,x0+65536+8,y1+8),
                xRes=16,yRes=16,resampleAlg='average',overviewLevel='AUTO',warpMemoryLimit=512*1024*1024,
                creationOptions=['TILED=YES','COMPRESS=DEFLATE','PREDICTOR=3'])
            os.replace(temp,out)
        return
    # A complete legacy (Mabou) download needs no network: skip before any remote metadata is read.
    if not args.dry_run and area.elevation_window and all(
            area.elevation(kind).is_file() and area.elevation(kind).stat().st_size for kind in ('dtm','dsm')):
        for kind in ('dtm','dsm'): print(f'have {area.elevation(kind)}',flush=True)
        return
    plans={kind:windows(area,kind) for kind in ('dtm','dsm')}
    if plans['dtm'] != plans['dsm']:
        raise RuntimeError('DTM and DSM native grids differ; inspect the source windows before downloading')
    estimate=budget(area,plans['dtm'],args.max_total_bytes)
    print(json.dumps(estimate,indent=2),flush=True)
    for kind,plan in plans.items():
        print(json.dumps(dict(kind=kind,windows=plan)),flush=True)
    if args.dry_run: return
    if not area.legacy_manifest and estimate['completeUpperEstimateBytes']>estimate['limitBytes']:
        raise RuntimeError(f'Complete estimate exceeds {estimate["limitBytes"]:,} bytes; nothing downloaded')
    for kind,plan in plans.items(): fetch(area,kind,plan)


if __name__=='__main__': main()
