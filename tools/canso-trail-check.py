#!/usr/bin/env python3
"""Bounded gap estimate, preservation, joins and unchanged area paths."""
import json,sys
from pathlib import Path
import numpy as np
from osgeo import gdal
sys.path.insert(0,str(Path(__file__).absolute().parent.parent/'pipeline'))
from areas import AREAS
from canso_trail import fill_missing, estimated_heights, estimated_surface, trail_geometry, transform, NODATA

original=np.array([[4,NODATA],[NODATA,8]],dtype=np.float32)
mask=np.array([[True,True],[False,True]])
heights=np.full((2,2),1,dtype=np.float32)
result,fill=fill_missing(original,mask,heights)
assert np.array_equal(result,[[4,1],[NODATA,8]])
assert fill.sum()==1
assert np.array_equal(estimated_heights(np.array([5058740,5058882.5,5059025]),1,2),[1,1.5,2])
section=np.array([[0,5058740],[0,5059025]],dtype=float)
assert np.allclose(estimated_surface(np.array([0,5,8.5,12]),np.full(4,5058882.5),section,1,2),[1.5,1.5,-1.25,-4])
for key,area in AREAS.items():
 if key!='cansocauseway':
  assert not area.interpolate_coastal_trail
  owner=AREAS[area.wide_source] if area.wide_source else area
  assert area.wide('dtm')==owner.raw/'elevation/wide-dtm-16m-utm20.tif'
# A fresh source fetch must work before the derived interpolation VRT exists.
import importlib.util, contextlib, io
from unittest import mock
spec=importlib.util.spec_from_file_location('fresh_fetch_check',Path(__file__).absolute().parent.parent/'pipeline/fetch_elevation.py')
fetch=importlib.util.module_from_spec(spec);spec.loader.exec_module(fetch)
a=AREAS['cansocauseway'];derived={a.bake_wide(k) for k in ('dtm','dsm')}
shared={a.wide(k) for k in ('dtm','dsm')}
exists=Path.exists
with mock.patch.object(fetch,'current',return_value=a), mock.patch.object(sys,'argv',['fetch_elevation.py','--wide']), \
     mock.patch.object(Path,'exists',lambda p: p in shared if p in derived|shared else exists(p)), \
     mock.patch.object(fetch.gdal,'Warp',side_effect=AssertionError('existing shared sources must not be fetched')), \
     contextlib.redirect_stdout(io.StringIO()) as captured:
 fetch.main()
records=[json.loads(line) for line in captured.getvalue().splitlines()]
assert len(records)==2 and all(q['exists'] and q['sharedFrom']=='pointtupper' for q in records)
assert a.wide('dtm')==AREAS['pointtupper'].wide('dtm')
print('PASS fresh wide-source fetch with derived bake VRTs hidden')
print('PASS synthetic bounds, valid-cell preservation, linear estimate and existing area paths')

if '--data' in sys.argv:
 a=AREAS['cansocauseway'];g=trail_geometry(a);g.Segmentize(2)
 tr=transform(2961,3979)
 evidence={}
 for kind in ('dtm','dsm'):
  base=gdal.Open(str(a.raw/f'elevation/land-{kind}-1m-epsg3979-federal.vrt'))
  patched=gdal.Open(str(a.elevation(kind)))
  assert base.GetGeoTransform()==patched.GetGeoTransform()
  assert (base.RasterXSize,base.RasterYSize)==(patched.RasterXSize,patched.RasterYSize)
  # Every native source cell is compared; only tiny bounded supplement cells may change.
  gt=base.GetGeoTransform();count=0
  supplement=gdal.Open(str(a.raw/f'elevation/trail-{kind}-1m-epsg3979.tif'))
  for row in range(0,base.RasterYSize,256):
   n=min(256,base.RasterYSize-row)
   before=base.ReadAsArray(0,row,base.RasterXSize,n);after=patched.ReadAsArray(0,row,base.RasterXSize,n)
   changed=before!=after
   assert not (changed&(before!=NODATA)).any(),'overwrote measured source data'
   count+=int(changed.sum())
  samples=[]
  for x,y,*_ in g.GetPoints():
   if 5058700<y<5059430:
    ex,ny,*_=tr.TransformPoint(x,y);i=int((ex-gt[0])/gt[1]);j=int((ny-gt[3])/gt[5])
    h=float(patched.ReadAsArray(i,j,1,1)[0,0]);assert h!=NODATA and h>0,(x,y,h)
    samples.append(h)
  assert len(samples)>100
  receipt=json.loads((a.raw/'elevation/trail-interpolation.json').read_text())
  assert count==receipt['files'][kind]['filledCells']
  evidence[kind]=dict(changedCells=count,measuredCellsChanged=0,trailSamples=len(samples),min=min(samples),max=max(samples))
 print(json.dumps(evidence,indent=2));print('PASS complete source comparison and dense dry-trail/joins coverage')
