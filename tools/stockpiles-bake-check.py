#!/usr/bin/env python3
"""Exercise real height-mask extraction against holes, roads, roofs and nodata."""
import importlib.util
from pathlib import Path
import numpy as np
from osgeo import ogr
p=Path(__file__).absolute().parents[1]/'pipeline/33_bake_stockpiles.py'
spec=importlib.util.spec_from_file_location('piles',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def box(x,y,w,h):
    return ogr.CreateGeometryFromWkt(f'POLYGON (({x} {y},{x+w} {y},{x+w} {y+h},{x} {y+h},{x} {y}))')
g=box(0,0,100,100);gt=(0,4,0,100,0,-4)
dtm=np.full((25,25),10.); dsm=dtm.copy();dsm[4:21,4:21]=14
roof=box(28,28,12,12);road=box(56,0,12,100)
dsm[10,10]=-32767
parts=m.mesh(g,[roof,road],dtm,dsm,gt,'logs',4)
assert parts,'measured stack extracted'
for part in parts:
 for i in range(0,len(part['indices']),3):
  vertices=[part['vertices'][j] for j in part['indices'][i:i+3]]
  ring=ogr.Geometry(ogr.wkbLinearRing)
  for v in vertices+[vertices[0]]:ring.AddPoint_2D(v[0],v[1])
  face=ogr.Geometry(ogr.wkbPolygon);face.AddGeometry(ring)
  assert g.Contains(face) and not face.Intersects(roof) and not face.Intersects(road)
  assert all(v[3]>=v[2] and v[3]-v[2]<8 for v in vertices)
assert not m.mesh(g,[],dtm,dtm.copy(),gt,'logs',4),'flat yard is not a log stack'
assert not m.mesh(g,[],dtm,np.full_like(dtm,-32767),gt,'logs',4),'missing data makes no pile'
assert not m.mesh(g,[],dtm,dtm+20,gt,'logs',4),'tall tree/conveyor returns rejected'
print('PASS bake masks: measured stacks, polygon faces, road/roof exclusions, flat/nodata/tall-return rejection')
