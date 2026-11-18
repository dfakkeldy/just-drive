#!/usr/bin/env python3
"""Synthetic utility exclusions, including a real detect() integration check."""
import importlib.util
import json
import sys
import tempfile
from pathlib import Path
import numpy as np
from osgeo import ogr, osr
sys.path.insert(0, str(Path(__file__).absolute().parent.parent/'pipeline'))
from utility_masks import UtilityMask
from areas import AREAS
assert AREAS["pointtupper"].exclude_utility_trees
assert not AREAS["mabou"].exclude_utility_trees
assert not AREAS["judique"].exclude_utility_trees

x0, y1 = 628000, 5052000
src, dst = osr.SpatialReference(), osr.SpatialReference()
src.ImportFromEPSG(2961); dst.ImportFromEPSG(4326)
for s in (src,dst): s.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
transform = osr.CoordinateTransformation(src,dst)
def feature(wkt, desc):
    g=ogr.CreateGeometryFromWkt(wkt); g.Transform(transform)
    return dict(type='Feature',properties=dict(FEAT_DESC=desc),geometry=json.loads(g.ExportToJson()))
with tempfile.TemporaryDirectory(prefix='mmm-utility-check-') as temp:
    root=Path(temp)
    groups={
      '01_utility_points':[feature(f'POINT ({x0+150} {y1-30})','TOWER (all except transmission line towers) point')],
      '02_utility_lines':[feature(f'LINESTRING ({x0+30} {y1+10}, {x0+30} {y1-110})','TRANSMISSION LINE (electrical) line')],
      '03_utility_polygons':[feature(f'POLYGON (({x0+170} {y1-20},{x0+190} {y1-20},{x0+190} {y1-40},{x0+170} {y1-40},{x0+170} {y1-20}))','TANK (over 15m diameter) polygon')]}
    for suffix,features in groups.items():
        (root/f'BASE_NSTDB_10k_Utilities_WM84__{suffix}.geojson').write_text(json.dumps(dict(type='FeatureCollection',features=features)))
    mask=UtilityMask(root)
    grid=mask.mask((100,220),x0,y1)
    assert grid[30,30] and grid[30,40] and not grid[30,50], 'wire corridor with nearby crown retained'
    assert grid[30,150] and not grid[30,160], 'tower footprint'
    assert grid[30,180] and not grid[30,195], 'tank footprint'
    assert not mask.mask((20,20),x0+1000,y1).any(), 'remote blocks are empty'
    spec=importlib.util.spec_from_file_location('utility_tree_check',Path(__file__).absolute().parent.parent/'pipeline/28_bake_trees.py')
    tree=importlib.util.module_from_spec(spec);spec.loader.exec_module(tree)
    rows,cols=np.mgrid[:96,:96]
    canopy=np.maximum(14*np.exp(-((rows-40)**2+(cols-30)**2)/8),10*np.exp(-((rows-40)**2+(cols-70)**2)/8)).astype(np.float32)
    class Buildings:
        def masks(self,*args):return np.zeros((96,96),dtype=bool),np.zeros((96,96),dtype=bool)
    class Roads:
        def query(self,*args):return ()
    ground, surface = tree.f.corridor.warp_exact, tree.warp_surface
    try:
        tree.f.corridor.warp_exact=lambda *args:np.full((96,96),2.,dtype=np.float32)
        tree.warp_surface=lambda *args:canopy+2
        meta=dict(cover=dict(xmin=x0,ymax=y1,res=5))
        args=((x0,y1-95,x0+95,y1),meta,np.zeros((3,20,20),dtype=np.uint8),Buildings(),Roads())
        before=tree.detect(*args);after=tree.detect(*args,utilities=mask)
        assert set(before[0])=={x0+30,x0+70}
        assert list(after[0])==[x0+70], 'mapped wire peak removed; separate crown remains'
        assert after[-1]['utilityMaskedCells']>0
        # A masked high wire must not defeat an adjacent, unmasked crown.
        edge=int(np.flatnonzero(mask.mask((96,96),x0,y1)[40])[-1])
        crown_col=edge+2; wire_col=edge-1
        canopy=(25*np.exp(-((rows-40)**2+(cols-crown_col)**2)/8)).astype(np.float32)
        alone=tree.detect(*args,utilities=mask)
        assert ((alone[0]==x0+crown_col)&(alone[1]==y1-40)).any(), 'boundary crown survives alone'
        canopy=canopy.copy(); canopy[40,wire_col]=38
        beside_wire=tree.detect(*args,utilities=mask)
        assert ((beside_wire[0]==x0+crown_col)&(beside_wire[1]==y1-40)).any(), 'masked wire must not suppress adjacent crown'
    finally:
        tree.f.corridor.warp_exact=ground;tree.warp_surface=surface
    missing=root/'BASE_NSTDB_10k_Utilities_WM84__01_utility_points.geojson';missing.unlink()
    try:UtilityMask(root)
    except RuntimeError as e:assert 'needs fetched vectors' in str(e)
    else:raise AssertionError('missing source accepted')
print('PASS utility buffers, remote block, real treetop detection and missing-source rejection')

if '--baked' in sys.argv or '--records' in sys.argv:
    area=AREAS[sys.argv[sys.argv.index('--area')+1] if '--area' in sys.argv else 'pointtupper']
    if '--records' in sys.argv:
        records=json.loads(Path(sys.argv[sys.argv.index('--records')+1]).read_text())
    else:
        manifest=json.loads((area.output/'manifest.json').read_text())
        dtype=np.dtype([('x','<u2'),('y','<u2'),('height','u1'),('crown','u1'),('kind','u1'),('seed','u1')])
        records=[]
        for name in manifest['trees']['tiles']:
            i,j=map(int,name.split('_'));a=np.fromfile(area.output/'8'/f'{name}.t.bin',dtype=dtype)
            east=area.origin[0]+i*256+a['x'].astype(float)/256
            north=area.origin[1]-j*256-a['y'].astype(float)/256
            take=(east>622300)&(east<623600)&(north>5055100)&(north<5056400)&(a['height']>100)
            records.extend(zip(east[take],north[take],a['height'][take].astype(float)/5))
    lines=[]
    for f in json.loads((area.raw/'vectors/BASE_NSTDB_10k_Utilities_WM84__02_utility_lines.geojson').read_text())['features']:
        if not f['properties'].get('FEAT_DESC','').startswith('TRANSMISSION LINE'):continue
        g=ogr.CreateGeometryFromJson(json.dumps(f['geometry']));g.Transform(osr.CoordinateTransformation(dst,src));lines.append(g)
    assert lines,'mapped transmission lines exist'
    checked=0;bad=[]
    for x,y,height,*_ in records:
        if not(622300<x<623600 and 5055100<y<5056400 and height>20):continue
        checked+=1;p=ogr.Geometry(ogr.wkbPoint);p.AddPoint_2D(float(x),float(y))
        if min(line.Distance(p) for line in lines)<10:bad.append([float(x),float(y),float(height)])
    assert checked,'crossing-region tall-tree sample exists'
    assert not bad,f'{len(bad)} tall wire peaks remain in baked trees: {bad[:3]}'
    print(f'PASS independent mapped-line distance check for {checked} tall crossing-region trees')
