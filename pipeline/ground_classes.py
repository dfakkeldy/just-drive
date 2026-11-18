"""Open ground classes. Pinned vector/derived-index inputs; no source image reads.

The command writes only a separate work root. It never edits shipped terrain.
The original RGB cover remains three bytes: class is still exactly its B byte.
The small row-run sidecar supplies class 6/8 to CPU vegetation and wheel readers.
"""
import argparse
import functools
import hashlib
import json
import math
from pathlib import Path
import struct

import numpy as np
from PIL import Image
from osgeo import gdal, ogr, osr
import shapely
from shapely.geometry import shape, box
from shapely.ops import unary_union

from areas import AREAS
import hand_sites

REPO = Path(__file__).absolute().parent.parent
LEGEND = {0:'unknown', 1:'forest', 2:'field', 3:'built/lawn', 4:'water', 5:'mixed open',
          6:'confirmed mineral', 7:'rock/cliff', 8:'open wetland', 9:'wooded wetland',
          10:'beach/dune', 11:'utility cut', 12:'narrow rail/trail bed', 13:'low brush/heath'}
PITS = {'DAPT40','DAPT44','DAQU40','DAQU44','DAMNOP40','DAMNOP44','DADP40','DAPC40'}
gdal.UseExceptions(); ogr.UseExceptions(); osr.UseExceptions()
SRS = osr.SpatialReference(); SRS.ImportFromEPSG(2961)
WGS = osr.SpatialReference(); WGS.ImportFromEPSG(4326)
for s in (SRS, WGS): s.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
TR = osr.CoordinateTransformation(WGS, SRS)
CANOPY_PINS = {}
CANOPY_USED = set()


def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def sources(root, area):
    """Refuse drift before making any result; never silently refetch a snapshot."""
    pin = json.loads((REPO/'pipeline/ground_sources.json').read_text())
    relevant = [p for p in pin['inputs'] if ('/'+area+'-' in p['path'] or
                (area == 'mabou' and p['path'].startswith('data/raw/vectors/')) or
                p['path'].startswith('data/raw/areas/'+area+'/'))]
    if len(relevant) != 5: raise ValueError('Incomplete ground source snapshot: '+area)
    for item in relevant:
        if sha(root/item['path']) != item['sha256']: raise ValueError('Ground source drift: '+item['path'])
    receipt=pin['terrain_receipts']
    if sha(root/receipt['path'])!=receipt['sha256']: raise ValueError('Terrain receipt snapshot drift')
    global CANOPY_PINS
    CANOPY_PINS={path.split('/data/baked/',1)[1]:digest for path,digest in
                 json.loads((root/receipt['path']).read_text()).items() if '/data/baked/' in path}
    return relevant


def rows(path, bounds):
    result = []; clip = box(*bounds)
    for f in json.loads(Path(path).read_text())['features']:
        if not f.get('geometry'): continue
        g = ogr.CreateGeometryFromJson(json.dumps(f['geometry'])); g.Transform(TR)
        poly = shapely.from_wkb(bytes(g.ExportToWkb()))
        if not poly.is_valid: poly = shapely.make_valid(poly)
        if poly.intersects(clip):
            poly = poly.intersection(clip)
            if not poly.is_empty: result.append((poly, {k.upper():v for k,v in f['properties'].items()}))
    return result


def raster(items, bounds, width, height, value, resolution=5, touched=False):
    ds = ogr.GetDriverByName('MEM').CreateDataSource('')
    layer = ds.CreateLayer('f', SRS, ogr.wkbUnknown); layer.CreateField(ogr.FieldDefn('v', ogr.OFTInteger))
    for geom, props in items:
        v = value(props)
        if v is None: continue
        f = ogr.Feature(layer.GetLayerDefn()); f.SetGeometry(ogr.CreateGeometryFromWkb(geom.wkb)); f.SetField('v', int(v)); layer.CreateFeature(f)
    out = gdal.GetDriverByName('MEM').Create('', width, height, 1, gdal.GDT_Byte)
    rx=(bounds[2]-bounds[0])/width if resolution==5 else resolution
    ry=(bounds[3]-bounds[1])/height if resolution==5 else resolution
    out.SetGeoTransform((bounds[0],rx,0,bounds[3],0,-ry)); out.SetProjection(SRS.ExportToWkt())
    if layer.GetFeatureCount():
        gdal.RasterizeLayer(out,[1],layer,options=['ATTRIBUTE=v']+(['ALL_TOUCHED=TRUE'] if touched else []))
    return out.ReadAsArray()


def site_mask(root, area, bounds, width, height):
    """Consume the canonical paved-open reservations; no second site recipe."""
    return raster([(shape(s['geometry']), {}) for s in hand_sites.ground_records(root)],
                  bounds, width, height, lambda p: 1, touched=True).astype(bool)


def forest_class(p):
    c = p.get('FORNON'); wc = (p.get('WC_TYPE') or '').strip()
    if wc in {'B','D'} or c == 94: return 10
    if wc in {'C','R'} or c == 84: return 7
    if wc == 'S' or c in {70,71,72,74,75}: return 8
    if c == 73: return 9
    if c in {96,97}: return 11
    if c in {85,91,99}: return 13
    return None  # Includes stale forest and old forestry cuts: no phase-2 clearing.


def wet_class(p):
    name = p.get('CNWI_CLASS_EN','').lower()
    if 'swamp' in name: return 9
    if any(c in name for c in ('bog','fen','marsh')): return 8
    return None  # Peatland/unclassified does not prove an open wetland.


def coarse_cells(cells, bounds, width, height):
    """Every 10m source cell that a selected displayed cell overlaps."""
    r0,r1,c0,c1=coarse_index(bounds,width,height)
    out=np.zeros((math.ceil((bounds[3]-bounds[1])/10),math.ceil((bounds[2]-bounds[0])/10)),bool)
    rr,cc=np.nonzero(cells)
    for r in (r0[rr],r1[rr]):
        for c in (c0[cc],c1[cc]): out[r,c]=True
    return out


def open_wetland(wet, canopy10, bounds):
    """CNWI bog, fen and marsh are open wetland (8) only where every overlapped 10m
    cell has a known baked canopy of 2m or less. A treed stand inside the polygon
    (black spruce on a bog) stays wooded wetland (9) and keeps its trees."""
    open5=refine_support(canopy10<=2,bounds,wet.shape[1],wet.shape[0])
    result=wet.copy(); result[(wet==8)&~open5]=9
    return result


def baseline_cover(meta):
    """Today's classes must come from the unpromoted bake. A promoted cover would carry
    old class 6/8 cells into a new bake after a source drops them."""
    if 'ground' in meta or 'classes' in meta:
        raise ValueError('Promoted baseline: bake from the unpromoted cover.png and manifest.json')


def bed_geometry(line, corridor):
    """Five metres total, clipped to the actual rail-corridor polygon."""
    return line.buffer(2.5,cap_style=2).intersection(corridor)


def confirmed_bare(bare25, bare26, canopy_max, envelope):
    """A 10m source cell must qualify itself. Neighbours can only subtract cells."""
    supported = envelope & ((bare25 & bare26) | ((bare25 | bare26) & (canopy_max <= 2)))
    padded = np.pad(supported.astype(np.uint8),1)
    neighbours = sum(padded[dy:dy+supported.shape[0],dx:dx+supported.shape[1]]
                     for dy in range(3) for dx in range(3))
    return supported & (neighbours >= 3)


def coarse_index(bounds, width, height):
    """First and last 10m source cell under each displayed column and row."""
    x=np.arange(width+1)*(bounds[2]-bounds[0])/width/10
    y=np.arange(height+1)*(bounds[3]-bounds[1])/height/10
    c0=np.floor(x[:-1]).astype(int); c1=np.floor(x[1:]-1e-8).astype(int)
    r0=np.floor(y[:-1]).astype(int); r1=np.floor(y[1:]-1e-8).astype(int)
    return r0,r1,c0,c1


def refine_support(support, bounds, width, height):
    """A displayed 5m cell may clear only if every overlapped 10m cell qualifies.

    The original bake truncates dimensions then stretches to coverRect. A simple
    2x repeat would shift the far edge by up to 4m and invent confirmed ground.
    This intersection-only resample can shrink edges; it cannot expand evidence.
    """
    r0,r1,c0,c1=coarse_index(bounds,width,height)
    return (support[np.ix_(r0,c0)] & support[np.ix_(r0,c1)] &
            support[np.ix_(r1,c0)] & support[np.ix_(r1,c1)])


def clip_mineral_cells(mineral, bounds, envelope):
    """A root anywhere in a clearing cell must still be inside the envelope."""
    h,w=mineral.shape; r,c=np.nonzero(mineral)
    rx=(bounds[2]-bounds[0])/w; ry=(bounds[3]-bounds[1])/h
    cells=shapely.box(bounds[0]+c*rx,bounds[3]-(r+1)*ry,
                      bounds[0]+(c+1)*rx,bounds[3]-r*ry)
    contained=shapely.covers(envelope,cells)
    result=mineral.copy()
    result[r[~contained],c[~contained]]=False
    return result


@functools.lru_cache(maxsize=160)
def tile(path):
    key=str(path).split('/data/baked/',1)[1]
    if CANOPY_PINS.get(key)!=sha(path): raise ValueError('Baked canopy snapshot drift: '+key)
    CANOPY_USED.add(Path(path))
    return np.array(Image.open(path))


def canopy_at(root, area, east, north):
    """Finest available baked node, never a fabricated canopy height. Missing = inf."""
    east, north = np.broadcast_arrays(east,north); result = np.full(east.shape,np.inf)
    baked = root/('data/baked/terrain' if area.id=='mabou' else 'data/baked/areas/'+area.id)
    for level in (8,7,6,5,4):
        size = 65536/2**level; step = size/256
        i = np.floor((east-area.origin[0])/size).astype(int); j = np.floor((area.origin[1]-north)/size).astype(int)
        missing = ~np.isfinite(result)
        for ii,jj in np.unique(np.stack((i[missing],j[missing]),axis=-1),axis=0):
            path = baked/str(level)/f'{ii}_{jj}.png'
            if not path.exists(): continue
            use = missing & (i==ii) & (j==jj)
            col = np.clip(np.rint((east[use]-area.origin[0]-ii*size)/step).astype(int),0,256)
            row = np.clip(np.rint((area.origin[1]-jj*size-north[use])/step).astype(int),0,256)
            pixels=tile(str(path))[row,col]
            # SEA_FLOOR (-4m) is also the bake's NoData encoding. A zero B
            # there is not evidence of measured bare land; try a coarser tile.
            known=(pixels[:,0].astype(np.uint16)*256+pixels[:,1])!=9600
            result[use] = np.where(known,pixels[:,2].astype(float)*.2,np.inf)
    return result


def canopy_cells(root, area, bounds, targets):
    """Maximum of all 1m samples in each selected 10m cell; fine/coarse fallback is explicit."""
    result = np.full(targets.shape,np.inf); rr,cc = np.nonzero(targets)
    # Include all integer nodes and the shared boundary. Half-node rounding can
    # otherwise skip every other 1m sample and miss a narrow tall crown.
    dy,dx = np.mgrid[0:11,0:11]; dx=dx.ravel(); dy=dy.ravel()
    for start in range(0,len(rr),512):
        r,c=rr[start:start+512],cc[start:start+512]
        e=bounds[0]+c[:,None]*10+dx; n=bounds[3]-r[:,None]*10-dy
        result[r,c]=np.max(canopy_at(root,area,e,n),axis=1)
    return result


def ground_runs(classes):
    """GC01: width,height,count u32; row-contained records start u32,len u16,class u8,reserved u8."""
    records=[]
    for row in range(classes.shape[0]):
        a=np.where(np.isin(classes[row],[6,8]),classes[row],0).astype(np.uint8)
        cuts=np.r_[0,np.flatnonzero(a[1:]!=a[:-1])+1,len(a)]
        for start,end in zip(cuts[:-1],cuts[1:]):
            if a[start]: records.append(struct.pack('<IHBB',row*len(a)+int(start),int(end-start),int(a[start]),0))
    return b'GC01'+struct.pack('<III',classes.shape[1],classes.shape[0],len(records))+b''.join(records)


def compose(today, proposed, mineral, protected, paved):
    result=today.copy(); replace=proposed>0; result[replace]=proposed[replace]
    result[mineral]=6
    # Highest precedence last. Water includes the shipped swamp/wet-feature choice: unchanged in this phase.
    result[today==4]=4
    result[paved]=today[paved]
    result[protected]=today[protected]
    return result


def validate_result(before, after, mineral, protected, paved):
    if before.shape!=after.shape or after.dtype!=np.uint8 or after.shape[2]!=3:
        raise ValueError('Ground RGB layout changed')
    cls=after[:,:,2]; old=before[:,:,2]
    if not np.isin(cls,list(LEGEND)).all(): raise ValueError('Ground class outside legend')
    if not np.array_equal(before[protected],after[protected]): raise ValueError('Hand site changed')
    if not np.array_equal(before[paved],after[paved]): raise ValueError('Paved priority changed')
    if not np.array_equal(old==4,cls==4) or not np.array_equal(before[old==4],after[old==4]):
        raise ValueError('Water changed')
    if np.any((cls==6)&~mineral): raise ValueError('Mineral clearing lacks confirmed support')
    eligible=mineral&~protected&~paved&(old!=4)
    if not np.all(cls[eligible]==6): raise ValueError('Confirmed mineral missing')


def validate_output_files(output):
    allowed={'cover.png','cover-ground.bin','manifest.json','promotion.json'}
    if any(p.name not in allowed or not p.is_file() for p in Path(output).iterdir()):
        raise ValueError('Unexpected ground output: class bytes and metadata only')


def bake(root, area_id, output):
    root=Path(root).absolute(); output=Path(output).absolute(); area=AREAS[area_id]
    for forbidden in (root/'data/baked',root/'data/site',REPO/'data/baked',REPO/'data/site'):
        if output.resolve().is_relative_to(forbidden.resolve()): raise ValueError('Ground output must be a work root')
    pinned=sources(root,area_id)
    CANOPY_USED.clear(); tile.cache_clear()
    baked=root/('data/baked/terrain' if area_id=='mabou' else 'data/baked/areas/'+area_id)
    raw=root/('data/raw' if area_id=='mabou' else 'data/raw/areas/'+area_id)
    manifest=json.loads((baked/'manifest.json').read_text()); meta=manifest['cover']; baseline_cover(meta)
    bounds=(meta['xmin'],meta['ymin'],meta['xmax'],meta['ymax'])
    if tuple(bounds)!=tuple(area.mid): raise ValueError('Ground box drift: '+area_id)
    rgb=np.array(Image.open(baked/'cover.png')); today=rgb[:,:,2]; h,w=today.shape
    forest=rows(raw/'vectors/FOR_Forest_WM84__01_leading_forest_species.geojson',bounds)
    designated=rows(root/f'data/raw/ground-classes/{area_id}-designated.geojson',bounds)
    wetlands=rows(root/f'data/raw/ground-classes/{area_id}-cnwi.geojson',bounds)
    proposed=raster(forest,bounds,w,h,forest_class)
    wet=raster(wetlands,bounds,w,h,wet_class)
    cnwi_open=wet==8
    if cnwi_open.any(): wet=open_wetland(wet,canopy_cells(root,area,bounds,coarse_cells(cnwi_open,bounds,w,h)),bounds)
    cnwi_wooded=cnwi_open&(wet==9)
    proposed[wet>0]=wet[wet>0]
    # Rail bed only where a mapped rail/trail centreline intersects its source corridor.
    corridors=unary_union([g for g,p in forest if p.get('FORNON')==99])
    road_file=json.loads((baked/'roads.json').read_text())
    from shapely.geometry import LineString
    lines=[bed_geometry(LineString(r['pts']),corridors)
           for r in road_file['roads'] if r['kind']==5 and len(r['pts'])>1]
    # The baked Canso kind-5 line already includes pipeline/canso_trail.py's owner-approved alignment.
    # Other mapped rail lines also qualify; they create ground only, never rail models.
    rail_path=raw/'vectors/BASE_NSTDB_10k_Roads_WM84__06_railways.geojson'
    rails=rows(rail_path,bounds)
    extra_inputs=[]
    if area_id=='cansocauseway':
        # Do not paint the old displaced provincial line as a second bed beside
        # the owner-approved canso_trail.py alignment already in roads.json.
        from canso_trail import ALIGN_SOUTH, ALIGN_NORTH
        bridge_path=raw/'vectors/BASE_NSTDB_10k_Roads_WM84__05_bridges.geojson'
        old=[g for g,p in rows(bridge_path,bounds) if p.get('ROADSEGID')==700024]
        if not old: raise ValueError('Canso trail source join missing')
        superseded=unary_union(old).buffer(4).intersection(box(bounds[0],ALIGN_SOUTH,bounds[2],ALIGN_NORTH))
        rails=[(g.difference(superseded),p) for g,p in rails]
        extra_inputs=[bridge_path,REPO/'pipeline/canso_trail.py']
    lines += [bed_geometry(g,corridors) for g,p in rails]
    rail=raster([(g,{}) for g in lines if not g.is_empty],bounds,w,h,lambda p:12)
    proposed[rail==12]=12
    envelope_rows=[(g,p) for g,p in designated if p.get('FEAT_CODE') in PITS]
    envelope_rows += [(g,p) for g,p in forest if p.get('FORNON')==95]
    evidence=[]
    for year in (2025,2026):
        z=np.load(root/f'data/work/threads/ground-classes/{area_id}-sentinel-{year}-indices.npz')
        ndvi=z['ndvi']; bsi=z['bsi']; evidence.append(np.isfinite(ndvi)&np.isfinite(bsi)&(ndvi<.30)&(bsi>0))
        if not np.array_equal(z['bounds'][:1],np.array(bounds[:1])) or z['bounds'][3]!=bounds[3]: raise ValueError('Sentinel grid drift')
    env10=raster(envelope_rows,bounds,evidence[0].shape[1],evidence[0].shape[0],lambda p:1,10)>0
    canopy=canopy_cells(root,area,bounds,env10 & (evidence[0]^evidence[1]))
    support=confirmed_bare(*evidence,canopy,env10)
    mineral=refine_support(support,bounds,w,h)
    # Clip source-cell support back to the actual mapped envelope on the 5m grid.
    env5=raster(envelope_rows,bounds,w,h,lambda p:1)>0; mineral &= env5
    mineral=clip_mineral_cells(mineral,bounds,unary_union([g for g,p in envelope_rows]))
    protected=site_mask(root,area_id,bounds,w,h)
    paved=raster(designated,bounds,w,h,lambda p:1 if p.get('FEAT_CODE') in {'DAPA41','DASA41'} else None,touched=True)>0
    after=compose(today,proposed,mineral,protected,paved)
    # Unconfirmed parts of an extraction envelope keep today's class, even if a lower layer suggests wetland/rock.
    after[env5 & ~mineral & ~protected & ~paved & (today!=4)]=today[env5 & ~mineral & ~protected & ~paved & (today!=4)]
    rgb[:,:,2]=after; output.mkdir(parents=True,exist_ok=True)
    # New class 9 only changes the floor. Preserve the old far-tree palette too:
    # nonforest classes used the shader's effective 30/40 percent shares, not R/G.
    nonforest_wet=(after==9)&(today!=1)
    rgb[:,:,0][nonforest_wet]=75; rgb[:,:,1][nonforest_wet]=100
    validate_result(np.array(Image.open(baked/'cover.png')),rgb,mineral,protected,paved)
    Image.fromarray(rgb).save(output/'cover.png',compress_level=9)
    (output/'cover-ground.bin').write_bytes(ground_runs(after))
    manifest['cover']['ground']={'file':'cover-ground.bin','version':1,'width':w,'height':h}
    manifest['cover']['classes']={str(k):v for k,v in LEGEND.items()}
    (output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    pixel_area=(bounds[2]-bounds[0])*(bounds[3]-bounds[1])/(w*h)
    qpath=root/'data/work/threads/ground-classes/quarries.geojson'; sites=[]
    clear=after==6
    for f in json.loads(qpath.read_text())['features']:
        p=f['properties']
        if p['area']!=area_id: continue
        geom=shape(f['geometry']); site=raster([(geom,{})],bounds,w,h,lambda p:1)>0
        sites.append({'id':p['id'],'area_m2':p['area_m2'],'cleared_m2':round(float(np.count_nonzero(site&clear))*pixel_area,2)})
    input_paths=[baked/'cover.png',baked/'manifest.json',baked/'roads.json',rail_path,qpath]
    input_paths += extra_inputs
    input_paths += sorted(CANOPY_USED)
    input_paths += hand_sites.ground_source_files(root)+hand_sites.catalog_inputs(root)
    input_paths += [REPO/'pipeline/ground_classes.py',REPO/'pipeline/hand_sites.py',REPO/'pipeline/ground_sources.json']
    receipts=[{'path':str(p.relative_to(root)) if p.is_relative_to(root) else str(p.relative_to(REPO)), 'sha256':sha(p)} for p in input_paths]
    promotion={'version':1,'area':area_id,'crs':'EPSG:2961','bounds':bounds,'promoted':False,
        'classes':manifest['cover']['classes'],'class_m2':{str(k):round(float(np.count_nonzero(after==k))*pixel_area,2) for k in LEGEND},
        'before_cover_bytes':(baked/'cover.png').stat().st_size,'after_cover_bytes':(output/'cover.png').stat().st_size,
        'ground_runs_bytes':(output/'cover-ground.bin').stat().st_size,'class_bytes_per_pixel':1,'new_draw_calls':0,
        'source_snapshot':pinned,'input_hashes':receipts,'quarry_clearing':sites,
        'wetland_rule':'CNWI bog, fen or marsh is open wetland (8) only where every overlapped 10m cell has a known baked canopy <=2m; otherwise wooded wetland (9), trees kept',
        'cnwi_wooded_m2':round(float(np.count_nonzero(cnwi_wooded))*pixel_area,2),
        'mineral_rule':'both summers bare OR one summer bare plus maximum known baked canopy <=2m; subtractive 10m smoothing; each displayed 5m cell fully supported and contained in the mapped envelope',
        'water_unchanged':bool(np.array_equal(today[today==4],after[today==4])),
        'hand_sites_unchanged':bool(np.array_equal(rgb[protected],np.array(Image.open(baked/'cover.png'))[protected])),
        'outputs':{name:sha(output/name) for name in ('cover.png','cover-ground.bin','manifest.json')}}
    (output/'promotion.json').write_text(json.dumps(promotion,indent=2)+'\n')
    validate_output_files(output)
    tile.cache_clear()
    return promotion


def main():
    p=argparse.ArgumentParser(description=__doc__); p.add_argument('--data-root',required=True,type=Path)
    p.add_argument('--work-root',required=True,type=Path); p.add_argument('--area',choices=[*AREAS,'all'],default='all')
    args=p.parse_args()
    for key in AREAS if args.area=='all' else [args.area]:
        result=bake(args.data_root,key,args.work_root/key)
        print(key,result['after_cover_bytes'],result['ground_runs_bytes'],sum(s['cleared_m2'] for s in result['quarry_clearing']),flush=True)


if __name__=='__main__': main()
