#!/usr/bin/env python3
"""Detect reproducible LiDAR treetops, in 512 m blocks with a 32 m halo.

Run with GDAL/numpy in the OSGeo container. No scipy or shapely is needed.
Only the trees manifest key is changed. --tiles i_j ... --output-dir DIR bakes
complete sample tiles without touching the manifest. --check verifies the full
artifact and rebakes three sample tiles twice in temporary directories.
"""
import argparse
import collections
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import tempfile

import numpy as np
from osgeo import gdal, ogr, osr

from areas import current

AREA = current()


def _stage_dir():
    """Scratch folder for staged tree tiles: Mabou keeps data/work; another area stays inside its own work folder."""
    if AREA.id == 'mabou':
        return f'{b.P}/data/work'
    os.makedirs(AREA.overview, exist_ok=True)
    return str(AREA.overview)

spec = importlib.util.spec_from_file_location('fields', os.path.join(os.path.dirname(os.path.abspath(__file__)), '25_bake_road_fields.py'))
f = importlib.util.module_from_spec(spec)
spec.loader.exec_module(f)
b = f.b
OUT = Path(b.OUT)
OVERVIEW = Path(b.OVERVIEW)
HALO = 32
RECORD = np.dtype([('x','<u2'),('y','<u2'),('height','u1'),('crown','u1'),('kind','u1'),('seed','u1')])
COLOURS = [(35,139,115),(239,75,65),(255,205,65),(191,143,245),(87,225,156)]


def blur(a, weight=30):
    """Small separable Gaussian-like kernel, sigma about 0.25 m."""
    p = np.pad(a, 1, mode='edge')
    v = (p[:-2] + weight*p[1:-1] + p[2:])/(weight+2)
    return (v[:,:-2] + weight*v[:,1:-1] + v[:,2:])/(weight+2)


def cover_at(cover, meta, xs, ys):
    # Match the displayed coverRect, including the original truncated 5m edges.
    rx=(meta['xmax']-meta['xmin'])/cover.shape[2] if meta.get('ground') else meta['res']
    ry=(meta['ymax']-meta['ymin'])/cover.shape[1] if meta.get('ground') else meta['res']
    col = np.floor((xs-meta['xmin'])/rx).astype(int)
    row = np.floor((meta['ymax']-ys)/ry).astype(int)
    valid = (col>=0)&(col<cover.shape[2])&(row>=0)&(row<cover.shape[1])
    result = np.zeros((3,)+np.broadcast_shapes(col.shape,row.shape), dtype=np.uint8)
    cc, rr = np.broadcast_arrays(col,row)
    good = np.broadcast_to(valid,cc.shape)
    result[:,good] = cover[:,rr[good],cc[good]]
    return result


class Buildings:
    def __init__(self):
        src, dst = osr.SpatialReference(), osr.SpatialReference()
        src.ImportFromEPSG(4326); dst.ImportFromEPSG(2961)
        src.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
        self.srs = dst
        tr = osr.CoordinateTransformation(src,dst)
        self.polygons = []
        self.points = []
        prefix = Path(b.RAW)/'vectors/BASE_NSTDB_10k_Buildings_WM84__'
        for suffix in ['04_building_polygons','02_classified','03_unclassified']:
            ds = ogr.Open(str(prefix)+suffix+'.geojson')
            for feat in ds.GetLayer():
                geom = feat.GetGeometryRef().Clone()
                geom.Transform(tr)
                if suffix=='04_building_polygons':
                    geom = geom.Buffer(2)
                    self.polygons.append((geom.GetEnvelope(),geom))
                else:
                    self.points.append((geom.GetX(),geom.GetY()))
        self.points = np.array(self.points)

    def masks(self, canopy, dsm, x0, y1):
        h,w = canopy.shape
        x1,y0 = x0+w-1,y1-h+1
        polygon = np.zeros((h,w),dtype=bool)
        hits = [g for (lx,hx,ly,hy),g in self.polygons if lx<=x1 and hx>=x0 and ly<=y1 and hy>=y0]
        if hits:
            vec = ogr.GetDriverByName('Memory').CreateDataSource('')
            layer = vec.CreateLayer('buildings',self.srs,ogr.wkbUnknown)
            for geom in hits:
                feat=ogr.Feature(layer.GetLayerDefn()); feat.SetGeometry(geom); layer.CreateFeature(feat)
            raster=gdal.GetDriverByName('MEM').Create('',w,h,1,gdal.GDT_Byte)
            raster.SetGeoTransform((x0-.5,1,0,y1+.5,0,-1)); raster.SetProjection(self.srs.ExportToWkt())
            gdal.RasterizeLayer(raster,[1],layer,burn_values=[1])
            polygon=raster.ReadAsArray()!=0
        # A planar pitched roof has little deviation from its smoothed DSM.
        # Crowns usually have a much larger deviation. Restrict every point
        # search and flood to 8 m. Never remove an entire connected forest blob.
        residual=np.sqrt(np.maximum(blur((dsm-blur(dsm,6))**2,6),0))
        roof=np.zeros_like(polygon)
        points=self.points[(self.points[:,0]>=x0-8)&(self.points[:,0]<=x1+8)&
                           (self.points[:,1]>=y0-8)&(self.points[:,1]<=y1+8)]
        for x,y in points:
            c,r=round(x-x0),round(y1-y)
            c0,c1=max(0,c-8),min(w,c+9); r0,r1=max(0,r-8),min(h,r+9)
            yy,xx=np.mgrid[r0:r1,c0:c1]
            distance2=(xx-(x-x0))**2+(yy-(y1-y))**2
            high=canopy[r0:r1,c0:c1]>2.2
            smooth=high&(residual[r0:r1,c0:c1]<.38)&(distance2<=64)
            seeds=smooth&(distance2<=36)
            # Require a roof-sized connected smooth patch, not one flat crown cell.
            seen=np.zeros_like(smooth)
            for sr,sc in zip(*np.where(seeds)):
                if seen[sr,sc]:
                    continue
                stack=[(sr,sc)]; seen[sr,sc]=True; blob=[]
                while stack:
                    rr,cc=stack.pop(); blob.append((rr,cc))
                    for dr,dc in [(0,1),(0,-1),(1,0),(-1,0)]:
                        nr,nc=rr+dr,cc+dc
                        if 0<=nr<smooth.shape[0] and 0<=nc<smooth.shape[1] and smooth[nr,nc] and not seen[nr,nc]:
                            seen[nr,nc]=True; stack.append((nr,nc))
                if len(blob)<12:
                    continue
                local=np.zeros_like(smooth)
                rr,cc=np.array(blob).T; local[rr,cc]=True
                # One-cell dilation includes the ridge and eaves of the roof.
                p=np.pad(local,1)
                grown=np.logical_or.reduce([p[dr:dr+local.shape[0],dc:dc+local.shape[1]]
                                            for dr in range(3) for dc in range(3)])
                roof[r0:r1,c0:c1] |= grown&high&(distance2<=64)
        return polygon,roof


def maxima(canopy, excluded=None):
    smooth=blur(canopy)
    if excluded is not None:
        smooth[excluded] = -1  # blurred neighbours must not re-enter utility cells
    radius=1.5+3*np.clip((smooth-3)/22,0,1)**6
    candidate=smooth>=2.5
    # Equal plateaus choose the northern, then western sample. All comparisons
    # use the same world grid in every block, including overlapping halos.
    h,w=smooth.shape
    p=np.pad(smooth,5,constant_values=-1)
    for dr in range(-4,5):
        for dc in range(-4,5):
            d2=dr*dr+dc*dc
            if not d2 or d2>4.5**2:
                continue
            neighbour=p[5+dr:5+dr+h,5+dc:5+dc+w]
            earlier=dr<0 or (dr==0 and dc<0)
            loses=(neighbour>=smooth) if earlier else (neighbour>smooth)
            candidate &= ~((radius*radius>=d2)&loses)
    candidate[:6]=False; candidate[-6:]=False; candidate[:,:6]=False; candidate[:,-6:]=False
    rr,cc=np.where(candidate)
    return rr,cc,smooth[rr,cc]


def crown_radii(canopy, rr, cc, heights):
    if not len(rr):
        return np.empty(0)
    rays=[]
    for angle in np.arange(16)*math.tau/16:
        distances=np.full(len(rr),7.,dtype=float)
        live=np.ones(len(rr),dtype=bool)
        for distance in np.arange(1,7.01,.5):
            r=np.clip(np.rint(rr+math.sin(angle)*distance).astype(int),0,canopy.shape[0]-1)
            c=np.clip(np.rint(cc+math.cos(angle)*distance).astype(int),0,canopy.shape[1]-1)
            stop=live&(canopy[r,c]<heights*.6)
            distances[stop]=distance-.5; live[stop]=False
        rays.append(distances)
    radius=np.mean(rays,axis=0)
    bins=collections.defaultdict(list)
    for n,(r,c) in enumerate(zip(rr,cc)):
        bins[(int(r)//14,int(c)//14)].append(n)
    for n,(r,c) in enumerate(zip(rr,cc)):
        others=[v for dr in [-1,0,1] for dc in [-1,0,1]
                for v in bins.get((int(r)//14+dr,int(c)//14+dc),()) if v!=n]
        if others:
            nearest=np.sqrt(np.min((rr[others]-r)**2+(cc[others]-c)**2))
            radius[n]=min(radius[n],nearest/2)
    return np.clip(radius,.8,7)


def tree_random(i,j,x,y):
    # Explicit 32-bit avalanche, independent of Python's salted hash and RNG versions.
    v=((i*73856093)^(j*19349663)^(int(x)*83492791)^(int(y)*2654435761))&0xffffffff
    v=((v^(v>>16))*0x7feb352d)&0xffffffff
    v=((v^(v>>15))*0x846ca68b)&0xffffffff
    v=(v^(v>>16))&0xffffffff
    return (v>>8)/16777216, v&255


def warp_surface(bb):
    # Nearest resampling preserves native 1 m crown peaks. Bilinear DTM keeps
    # slope interpolation stable. Exact transforms share the corridor grid.
    x0,y0,x1,y1=bb
    ds=gdal.Warp('',str(AREA.elevation("dsm")),
                 format='MEM',dstSRS='EPSG:2961',xRes=1,yRes=1,
                 outputBounds=(x0-.5,y0-.5,x1+.5,y1+.5),resampleAlg='near',
                 dstNodata=b.NODATA,errorThreshold=0,warpMemoryLimit=64*1024*1024,
                 multithread=False)
    values=ds.ReadAsArray().astype(np.float32)
    values[~np.isfinite(values)]=b.NODATA
    return values


def open_crown_duplicates(canopy,rr,cc,heights,stands):
    """Reject lower bumps joined to a taller open-grown peak by a high saddle.

    Each decision uses all nearby candidates, not a mutable greedy set, so
    the result is independent of block order. Closed forest is unaffected.
    """
    drop=np.zeros(len(rr),dtype=bool)
    bins=collections.defaultdict(list)
    for n,(r,c) in enumerate(zip(rr,cc)):
        bins[(int(r)//8,int(c)//8)].append(n)
    for n in np.flatnonzero(stands[2]!=1):
        r,c=rr[n],cc[n]
        others=[v for dr in [-1,0,1] for dc in [-1,0,1]
                for v in bins.get((int(r)//8+dr,int(c)//8+dc),())
                if (heights[v]>heights[n] or (heights[v]==heights[n] and (rr[v],cc[v])<(r,c)))
                and (rr[v]-r)**2+(cc[v]-c)**2<=49]
        for other in others:
            rows=np.rint(np.linspace(r,rr[other],16)).astype(int)
            cols=np.rint(np.linspace(c,cc[other],16)).astype(int)
            if np.min(canopy[rows,cols])>=heights[n]*.75:
                drop[n]=True; break
    return drop


def detect(bb, manifest, cover, buildings, field, utilities=None):
    x0,y0,x1,y1=bb
    dtm=f.corridor.warp_exact(str(AREA.elevation("dtm")),bb)
    dsm=warp_surface(bb)
    valid=(dtm!=b.NODATA)&(dsm!=b.NODATA)
    canopy=np.where(valid,np.maximum(dsm-dtm,0),0)
    utility_cells = utilities.mask(canopy.shape, x0, y1) if utilities is not None else None
    # Remove structures before smoothing and peak competition, not just after
    # detection: a taller masked wire can otherwise defeat a crown outside it.
    competition = np.where(utility_cells, 0, canopy) if utility_cells is not None else canopy
    rr,cc,heights=maxima(competition, utility_cells)
    xs,ys=x0+cc,y1-rr
    stands=cover_at(cover,manifest['cover'],xs,ys)
    polygon,roof=buildings.masks(canopy,np.where(valid,dsm,0),x0,y1)
    keep=(dtm[rr,cc]>-.2)&~np.isin(stands[2],[4,6,8])&~polygon[rr,cc]&~roof[rr,cc]
    road_drop=np.zeros(len(rr),dtype=bool)
    # Exact geometry, rather than the rounded road field, at candidate tops.
    ids=field.query(x0-14,y0-14,x1+14,y1+14)
    for n in ids:
        threshold=field.a[n,4]+.7
        possible=(xs>=field.lo[n,0]-threshold)&(xs<=field.hi[n,0]+threshold)&\
                 (ys>=field.lo[n,1]-threshold)&(ys<=field.hi[n,1]+threshold)
        take=np.flatnonzero(possible)
        road_drop[take] |= field.d2(xs[take],ys[take],n)<=threshold**2
    utility_drop = utility_cells[rr,cc] if utility_cells is not None else np.zeros(len(rr),dtype=bool)
    # Excluded structures must not suppress a valid nearby yard crown.
    eligible=np.flatnonzero(keep&~road_drop&~utility_drop)
    duplicates=np.zeros(len(rr),dtype=bool)
    duplicates[eligible]=open_crown_duplicates(competition,rr[eligible],cc[eligible],heights[eligible],stands[:,eligible])
    keep &= ~road_drop&~duplicates&~utility_drop
    stats={'utilityMaskedCells':int(utility_cells.sum()) if utility_cells is not None else 0,'utility':int(utility_drop.sum()),'candidates':len(rr),'polygon':int(polygon[rr,cc].sum()),'roof':int(roof[rr,cc].sum()),
           'road':int(road_drop.sum()),'openCrownDuplicate':int(duplicates.sum()),'waterOrLowGround':int(((dtm[rr,cc]<=-.2)|(stands[2]==4)).sum())}
    rr,cc,heights,stands=rr[keep],cc[keep],heights[keep],stands[:,keep]
    radii=crown_radii(competition,rr,cc,heights)
    return x0+cc,y1-rr,heights,radii,stands,stats


def pack_tile(i,j,detected):
    xs,ys,heights,radii,stands,_=detected
    bb=f.corridor.bounds(8,i,j)
    # North edge is included; east/south edge belongs to the next tile.
    keep=(xs>=bb[0])&(xs<bb[2])&(ys<=bb[3])&(ys>bb[1])
    xx,yy=xs[keep]-bb[0],bb[3]-ys[keep]
    heights,radii,stands=heights[keep],radii[keep],stands[:,keep]
    rec=np.zeros(len(xx),dtype=RECORD)
    rec['x']=np.floor(xx*65536/256).astype(np.uint16)
    rec['y']=np.floor(yy*65536/256).astype(np.uint16)
    rec['height']=np.clip(np.rint(heights*5),0,255).astype(np.uint8)
    rec['crown']=np.clip(np.rint(radii*10),8,70).astype(np.uint8)
    for n,(x,y,height) in enumerate(zip(xx,yy,heights)):
        draw,seed=tree_random(i,j,x,y)
        red,yellow=(stands[0,n]/250,stands[1,n]/250) if stands[2,n]==1 else (.3,.4)
        if red+yellow>1:
            red,yellow=red/(red+yellow),yellow/(red+yellow)
        larch=yellow*.1 if stands[2,n]==1 and yellow>=.5 and red<=.2 else 0
        kind=1 if draw<red else 2 if draw<red+yellow-larch else 3 if draw<red+yellow else 0
        rec['kind'][n]=4 if height<4 else kind
        rec['seed'][n]=seed
    return np.sort(rec,order=['y','x'])


def bake(names, manifest, output):
    output=Path(output); output.mkdir(parents=True,exist_ok=True)
    cover=gdal.Open(str(OUT/'cover.png')).ReadAsArray()
    buildings=Buildings()
    utilities = None
    if AREA.exclude_utility_trees:
        from utility_masks import UtilityMask
        utilities = UtilityMask(AREA.raw/'vectors')
    field=f.Field(json.load(open(OUT/'roads.json'))['roads'])
    blocks=collections.defaultdict(list)
    for name in names:
        i,j=map(int,name.split('_')); blocks[(i//2,j//2)].append((i,j))
    total=0; counts={}; kinds=np.zeros(5,dtype=np.int64); stats=collections.Counter()
    for number,((bi,bj),tiles) in enumerate(sorted(blocks.items()),1):
        bb=f.corridor.bounds(7,bi,bj)
        halo=(bb[0]-HALO,bb[1]-HALO,bb[2]+HALO,bb[3]+HALO)
        detected=detect(halo,manifest,cover,buildings,field,utilities)
        # Rejection counts include overlapping halos; clearly labelled in report.
        stats.update(detected[-1])
        for i,j in sorted(tiles):
            name=f'{i}_{j}'; rec=pack_tile(i,j,detected)
            total+=len(rec); counts[name]=len(rec)
            if total>6_000_000 or total*8>60_000_000:
                raise RuntimeError(f'Limit exceeded: {total:,} trees / {total*8:,} bytes; manifest and live trees unchanged')
            kinds+=np.bincount(rec['kind'],minlength=5)
            if len(rec):
                (output/f'{name}.t.bin').write_bytes(rec.tobytes())
        if number%10==0 or number==len(blocks):
            print(f'Block {number}/{len(blocks)}: {total:,} trees, {total*8:,} bytes',flush=True)
    return counts,kinds,dict(stats)


def samples(manifest,cover):
    # Find closed stands from the cover raster and baked 1 m canopy, not a
    # hand-picked density result. 100 m squares give hectares directly.
    best={}
    for name in manifest['levels']['8']:
        i,j=map(int,name.split('_')); bb=f.corridor.bounds(8,i,j)
        x,y=bb[0]+128,bb[3]-128
        a=gdal.Open(str(OUT/f'8/{name}.png')).ReadAsArray()[2,78:178,78:178]
        closed=float(np.mean(a>=12.5))
        grid=cover_at(cover,manifest['cover'],x+np.arange(-50,50)[None,:],y-np.arange(-50,50)[:,None])
        forest=float(np.mean(grid[2]==1))
        if forest<.95 or closed<.8:
            continue
        red,yellow=float(np.mean(grid[0])/250),float(np.mean(grid[1])/250)
        category='hardwood' if red+yellow>=.6 else 'conifer' if red+yellow<=.35 else None
        if category and (category not in best or closed>best[category]['canopyFraction']):
            best[category]=dict(centre=[x,y],tile=name,canopyFraction=closed,forestFraction=forest,
                                redShare=red,yellowShare=yellow)
    if AREA.require_forest_samples and set(best)!={'hardwood','conifer'}:
        raise RuntimeError(f'Could not find closed sample stands: {best}')
    vx, vy = AREA.bake_anchor
    vi=math.floor((vx-b.X0)/256); vj=math.floor((b.Y1-vy)/256)
    result={'village':dict(centre=list(AREA.bake_anchor),tile=f'{vi}_{vj}'),**best}
    for area in result.values():
        x,y=area['centre']; area['bounds']=[x-50,y-50,x+50,y+50]; area['hectares']=1
    return result


def report(manifest,counts,kinds,stats):
    cover=gdal.Open(str(OUT/'cover.png')).ReadAsArray()
    areas=samples(manifest,cover)
    for area in areas.values():
        x0,y0,x1,y1=area['bounds']; count=0
        for name in counts:
            i,j=map(int,name.split('_')); bb=f.corridor.bounds(8,i,j)
            if bb[0]>=x1 or bb[2]<=x0 or bb[1]>=y1 or bb[3]<=y0:
                continue
            path=OUT/f'8/{name}.t.bin'
            if path.exists():
                rec=np.fromfile(path,dtype=RECORD)
                xx=bb[0]+rec['x'].astype(float)/256; yy=bb[3]-rec['y'].astype(float)/256
                count+=int(((xx>=x0)&(xx<x1)&(yy>y0)&(yy<=y1)).sum())
        area['tops']=count; area['topsPerHectare']=count
        area['withinForestTarget']=250<=count<=900 if 'forestFraction' in area else None
    values=list(counts.values())
    data=dict(count=sum(values),bytes=sum(values)*8,tilesWithTrees=sum(v>0 for v in values),
              tilesProcessed=len(values),perKind=dict(zip(['conifer','redHardwood','yellowHardwood','larch','smallTree'],map(int,kinds))),
              perTile=dict(min=min(values),median=float(np.median(values)),max=max(values)),
              samples=areas,haloRejections=stats,
              method=dict(blockMetres=512,overlapMetres=HALO,smoothing='[1,30,1]/32 separable, sigma 0.25 m',surfaceResampling='nearest',groundResampling='bilinear',
                          maximumRadius='1.5 + 3 * clamp((height - 3) / 22, 0, 1)^6 metres; 1.5 m at 3 m, 4.5 m at 25 m',minimumHeight=2.5,
                          roof='DSM residual RMS <0.38 m; >=12 connected cells; within 8 m of a building point; one-cell dilation',
                          roofLimit='Point-only roofs beyond 8 m and irregular roofs can remain; flat crowns near points can be removed. Polygon roofs have a strict 2 m buffer.'))
    OVERVIEW.mkdir(parents=True,exist_ok=True)
    (OVERVIEW/'trees-report.json').write_text(json.dumps(data,indent=2)+'\n')
    print(json.dumps(data,indent=2),flush=True)
    return data


def picture(manifest, tree_dir=None):
    # Original DTM hillshade at 1 m, lightly shaded by canopy to show crowns.
    tree_dir=Path(tree_dir) if tree_dir is not None else OUT/'8'
    x0,y1=AREA.bake_anchor[0]-700,AREA.bake_anchor[1]+550; w,h=1401,1101
    bb=(x0,y1-h+1,x0+w-1,y1)
    dtm=f.corridor.warp_exact(str(AREA.elevation("dtm")),bb)
    dsm=f.corridor.warp_exact(str(AREA.elevation("dsm")),bb)
    valid=(dtm!=b.NODATA)&(dsm!=b.NODATA)
    terrain=np.where(valid,dtm,-4); surface=np.where(valid,dsm,terrain)
    dy,dx=np.gradient(terrain)
    light=np.clip((.7-dx*.45+dy*.55)/np.sqrt(1+dx*dx+dy*dy),0,1)
    sy,sx=np.gradient(surface)
    crowns=np.clip((.7-sx*.45+sy*.55)/np.sqrt(1+sx*sx+sy*sy),0,1)
    shade=(55+170*(.55*light+.45*crowns)).astype(np.uint8)
    rgb=np.repeat(shade[None],3,axis=0)
    for name in manifest['trees']['tiles']:
        i,j=map(int,name.split('_')); tb=f.corridor.bounds(8,i,j)
        if tb[0]>bb[2] or tb[2]<bb[0] or tb[1]>bb[3] or tb[3]<bb[1]:
            continue
        rec=np.fromfile(tree_dir/f'{name}.t.bin',dtype=RECORD)
        xx=tb[0]+rec['x'].astype(float)/256; yy=tb[3]-rec['y'].astype(float)/256
        for x,y,kind in zip(xx,yy,rec['kind']):
            c,r=round(x-x0),round(y1-y)
            if 1<=r<h-1 and 1<=c<w-1:
                rgb[:,r,c]=COLOURS[kind]
                for dr,dc in [(0,1),(0,-1),(1,0),(-1,0)]:
                    rgb[:,r+dr,c+dc]=COLOURS[kind]
    b.write_png(str(OVERVIEW/'trees-check-village.png'),rgb)


def check(manifest):
    info=manifest['trees']; assert info['level']==8 and info['record']==8
    expected={OUT/f'8/{name}.t.bin' for name in info['tiles']}
    actual=set(OUT.glob('*/*.t.bin')); assert actual==expected,(actual-expected,expected-actual)
    assert len(info['tiles'])==len(set(info['tiles']))
    assert set(info['tiles'])<=set(manifest['levels']['8'])
    total=0
    cover=gdal.Open(str(OUT/'cover.png')).ReadAsArray()
    field=f.Field(json.load(open(OUT/'roads.json'))['roads'])
    buildings=Buildings(); near8=0; near12=0
    for path in sorted(expected):
        assert path.stat().st_size%8==0 and path.stat().st_size>0,path
        rec=np.fromfile(path,dtype=RECORD); total+=len(rec)
        assert (rec['height']>=12).all() and (rec['kind']<=4).all(),path
        assert ((rec['crown']>=8)&(rec['crown']<=70)).all(),path
        keys=rec['y'].astype(np.uint64)*65536+rec['x']
        assert (keys[1:]>keys[:-1]).all(),path
        assert (rec['height'][rec['kind']==4]<=20).all(),path
        assert (rec['height'][rec['kind']!=4]>=20).all(),path
        i,j=map(int,path.name[:-6].split('_')); bb=f.corridor.bounds(8,i,j)
        xx=bb[0]+rec['x'].astype(float)/256; yy=bb[3]-rec['y'].astype(float)/256
        assert (cover_at(cover,manifest['cover'],xx,yy)[2]!=4).all(),path
        terrain=gdal.Open(str(OUT/f'8/{i}_{j}.png')).ReadAsArray()
        ground=(terrain[0].astype(float)*256+terrain[1])*.01-100
        assert (ground[rec['y']//256,rec['x']//256]>=-.200001).all(),path
        points=buildings.points[(buildings.points[:,0]>=bb[0]-12)&(buildings.points[:,0]<=bb[2]+12)&
                                 (buildings.points[:,1]>=bb[1]-12)&(buildings.points[:,1]<=bb[3]+12)]
        distance=np.full(len(rec),np.inf)
        for px,py in points:
            distance=np.minimum(distance,(xx-px)**2+(yy-py)**2)
        near8+=int((distance<=64).sum()); near12+=int((distance<=144).sum())
        for (lx,hx,ly,hy),polygon in buildings.polygons:
            if lx>bb[2] or hx<bb[0] or ly>bb[3] or hy<bb[1]:
                continue
            possible=np.flatnonzero((xx>=lx)&(xx<=hx)&(yy>=ly)&(yy<=hy))
            for n in possible:
                point=ogr.Geometry(ogr.wkbPoint); point.AddPoint_2D(float(xx[n]),float(yy[n]))
                assert not polygon.Contains(point),(path,'tree inside buffered building')
        for n in field.query(bb[0]-14,bb[1]-14,bb[2]+14,bb[3]+14):
            assert (field.d2(xx,yy,n)>(field.a[n,4]+.7)**2).all(),(path,'tree on road')
    assert total==info['count'],(total,info['count'])
    # Every manifest file reference, including another agent's buildings file.
    for level,names in manifest['levels'].items():
        for name in names:
            assert (OUT/f'{level}/{name}.png').is_file()
    for level,names in manifest['roads']['levels'].items():
        for name in names:
            assert (OUT/f'{level}/{name}.r.png').is_file()
    def files(value):
        if isinstance(value,dict):
            for k,v in value.items():
                if k=='file':
                    assert (OUT/v).is_file(),v
                else:
                    files(v)
        elif isinstance(value,list):
            for v in value:
                files(v)
    files(manifest)
    areas=json.load(open(OVERVIEW/'trees-report.json'))['samples']
    names=sorted(set(area['tile'] for area in areas.values()))
    hashes={}
    with tempfile.TemporaryDirectory(prefix='trees-repeat-',dir=_stage_dir()) as temp:
        for run in ['one','two']:
            dest=Path(temp)/run; bake(names,manifest,dest)
            for name in names:
                path=dest/f'{name}.t.bin'; content=path.read_bytes() if path.exists() else b''
                live=OUT/f'8/{name}.t.bin'
                assert content==(live.read_bytes() if live.exists() else b''),(run,name,'full bake mismatch')
                digest=hashlib.sha256(content).hexdigest()
                if run=='two':
                    assert digest==hashes[name],name
                hashes[name]=digest
    result=dict(filesChecked=len(expected),records=total,bytes=total*8,repeatedSampleHashes=hashes,
                survivingTopsWithin8mOfBuildingPoints=near8,survivingTopsWithin12mOfBuildingPoints=near12)
    (OVERVIEW/'trees-checks.json').write_text(json.dumps(result,indent=2)+'\n')
    summary=json.load(open(OVERVIEW/'trees-report.json'))
    summary['validation']=result
    (OVERVIEW/'trees-report.json').write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps(result,indent=2),flush=True)


def self_test():
    # Three distinct crowns must produce three tops, including a small tree.
    yy,xx=np.mgrid[:96,:96]
    canopy=np.zeros((96,96),dtype=np.float32)
    for r,c,h in [(20,20,10),(45,45,18),(72,72,3.5)]:
        canopy=np.maximum(canopy,h*np.exp(-((yy-r)**2+(xx-c)**2)/8))
    rr,cc,heights=maxima(canopy)
    assert set(zip(rr,cc))=={(20,20),(45,45),(72,72)}
    assert ((crown_radii(canopy,rr,cc,heights)>=.8)&(crown_radii(canopy,rr,cc,heights)<=7)).all()
    # North/east shared corner belongs to exactly one tile.
    bb=f.corridor.bounds(8,128,128)
    detected=(np.array([bb[2]-1,bb[2]]),np.array([bb[3]-1,bb[3]-1]),
              np.array([8.,8.]),np.array([2.,2.]),np.zeros((3,2),dtype=np.uint8),{})
    left=pack_tile(128,128,detected); right=pack_tile(129,128,detected)
    assert len(left)==len(right)==1 and left['x'][0]==65280 and right['x'][0]==0
    assert pack_tile(128,128,detected).tobytes()==left.tobytes()
    # A flat roof is removed; a nearby distinct yard crown survives.
    buildings=Buildings.__new__(Buildings)
    buildings.polygons=[]; buildings.points=np.array([[30.,-30.]])
    surface=np.zeros((64,64),dtype=np.float32); surface[24:37,24:37]=7
    yr,xc=np.mgrid[:64,:64]
    surface=np.maximum(surface,10*np.exp(-((yr-30)**2+(xc-42)**2)/5))
    _,roof=buildings.masks(surface,surface,0,0)
    assert roof[30,30] and not roof[30,42]
    # A continuous open crown has one top even when its surface has two bumps.
    canopy=np.zeros((32,32)); canopy[10:16,10:17]=9
    canopy[12,12]=10; canopy[12,15]=9.5
    drops=open_crown_duplicates(canopy,np.array([12,12]),np.array([12,15]),
                               np.array([10,9.5]),np.zeros((3,2),dtype=np.uint8))
    assert drops.tolist()==[False,True]
    forest=np.zeros((3,2),dtype=np.uint8); forest[2]=1
    assert not open_crown_duplicates(canopy,np.array([12,12]),np.array([12,15]),np.array([10,9.5]),forest).any()
    # End-to-end regression: an excluded roof peak must not suppress a yard top.
    class Masks:
        def masks(self, canopy, surface, x0, y1):
            polygon=np.zeros_like(canopy,dtype=bool); roof=polygon.copy()
            roof[30,30]=True
            return polygon,roof
    class EmptyRoads:
        def query(self,*args):
            return ()
    canopy=np.zeros((64,64),dtype=np.float32); canopy[25:36,25:40]=8
    canopy[30,30]=10; canopy[30,34]=9.5
    original_ground=f.corridor.warp_exact; original_surface=globals()['warp_surface']
    try:
        f.corridor.warp_exact=lambda *args:np.full((64,64),2.,dtype=np.float32)
        globals()['warp_surface']=lambda bb:canopy+2
        metadata=dict(cover=dict(xmin=0,ymax=63,res=5))
        detected=detect((0,0,63,63),metadata,np.zeros((3,13,13),dtype=np.uint8),Masks(),EmptyRoads())
        assert ((detected[0]==34)&(detected[1]==33)).any()
    finally:
        f.corridor.warp_exact=original_ground; globals()['warp_surface']=original_surface
    print('Synthetic crown, shared-edge ownership, seed, roof and yard checks passed',flush=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tiles',nargs='+')
    parser.add_argument('--output-dir')
    parser.add_argument('--check',action='store_true')
    parser.add_argument('--self-test',action='store_true')
    args=parser.parse_args()
    if args.self_test:
        self_test(); return
    manifest=json.load(open(OUT/'manifest.json'))
    if args.check:
        self_test()
        check(manifest); return
    names=args.tiles or manifest['levels']['8']
    if not set(names)<=set(manifest['levels']['8']):
        parser.error('All requested tiles must be in levels[8]')
    if args.tiles and not args.output_dir:
        parser.error('--tiles requires --output-dir; sample runs never edit the live manifest')
    if args.output_dir:
        bake(names,manifest,args.output_dir); return
    # Stage all output. Enforce the total size limit before changing live files.
    with tempfile.TemporaryDirectory(prefix='trees-stage-',dir=_stage_dir()) as temp:
        counts,kinds,stats=bake(names,manifest,temp)
        wanted={f'{name}.t.bin' for name,count in counts.items() if count}
        for filename in sorted(wanted):
            os.replace(Path(temp)/filename,OUT/'8'/filename)
        for path in OUT.glob('*/*.t.bin'):
            if path.parent.name!='8' or path.name not in wanted:
                path.unlink()
        # Preserve roads/buildings and any other concurrently updated keys.
        manifest=json.load(open(OUT/'manifest.json'))
        manifest['trees']=dict(level=8,record=8,tiles=[n for n in names if counts[n]],count=sum(counts.values()))
        temporary=OUT/'manifest.trees.tmp'
        temporary.write_text(json.dumps(manifest))
        os.replace(temporary,OUT/'manifest.json')
    report(manifest,counts,kinds,stats)
    picture(manifest)


if __name__=='__main__':
    main()
