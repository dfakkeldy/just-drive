#!/usr/bin/env python3
"""A later wing must not collide with another accepted building."""
import importlib.util,sys,copy
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).absolute().parent.parent/'pipeline'))
spec=importlib.util.spec_from_file_location('wing_check',Path(__file__).absolute().parent.parent/'pipeline/27_bake_buildings.py')
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
def box(x0,y0,x1,y1):
 p=np.array([[x0,y0],[x1,y0],[x1,y1],[x0,y1]],dtype=float)
 return (p.mean(axis=0),np.array([1,0]),np.array([0,1]),x1-x0,y1-y0,p)
def item(bid,coords):
 p=coords[-1]
 return dict(id=bid,x=float(p[:,0].mean()),y=float(p[:,1].mean()),footprint=p.tolist(),axisDeg=90,length=4,width=4,source='osm')
first=box(0,0,4,4);next_building=box(6,0,10,4)
originals=[item(1,first),item(2,next_building)]
seeds=[dict(id=1,source='osm',geom=b.polygon(first[-1]))]
audit=[dict(id=1),dict(id=2)]
real_split=b.split_outline
try:
 b.split_outline=lambda _: [first,box(3,0,9,4)]
 old,_=b.add_wings(originals,seeds,copy.deepcopy(audit))
 new,splits=b.add_wings(originals,seeds,copy.deepcopy(audit),avoid_overlaps=True)
 def overlap(a,c):
  a,c=b.polygon(a['footprint']),b.polygon(c['footprint'])
  return a.Intersection(c).GetArea()/min(a.GetArea(),c.GetArea())
 assert overlap(old[1],old[2])>.30,'fixture must reproduce old wing collision'
 assert new==originals and splits==[], 'retain checked original when proposed wing collides'
 # A clear split still gets wings and a site; the guard must not disable the feature.
 b.split_outline=lambda _: [box(0,0,2,4),box(2,0,4,4)]
 clear,splits=b.add_wings(originals,seeds,copy.deepcopy(audit),avoid_overlaps=True)
 assert len(clear)==3 and len(splits)==1 and clear[0]['site']==originals[0]
finally:b.split_outline=real_split
print('PASS old wing collision reproduced, guarded original retained, clear wings preserved')
