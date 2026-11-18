#!/usr/bin/env python3
"""Numerical seam receipt, plus literal 2x screenshot crops (game pixels only)."""
import argparse,importlib.util,json,math,sys,re
from pathlib import Path
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parent.parent;sys.path.insert(0,str(ROOT/'pipeline'))
spec=importlib.util.spec_from_file_location('bake',ROOT/'pipeline/34_bake_far_views.py');b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--data-root',type=Path,required=True);args=ap.parse_args();data=args.data_root;out=data/'work/threads/far-views';dem=b.DEM(data/'raw/far-views/regional-240m.tif')
 text=(ROOT/'web/src/far-rules.ts').read_text();radius=float(re.search(r'EARTH_RADIUS = ([\d_]+)',text)[1].replace('_',''));k=float(re.search(r'REFRACTION_K = ([\d.]+)',text)[1]);c=(1-k)/(2*radius);focal=720/(2*math.tan(math.radians(30)));root=[591500,5070564,657036,5136100]
 views=[('marble-se',612761.94,5099561.98,150),('shore-mabou',622560,5112920,215),('shore-cape',619881.19,5112017.41,210)]
 rows=[]
 for name,e,n,yaw in views:
  coast=[];seam=[]
  for x in range(math.floor(e-30000),math.ceil(e+30000),240):
   for y in range(math.floor(n-30000),math.ceil(n+30000),240):
    d=math.hypot(x-e,y-n)
    if not 10000<d<30000 or not b.inside(x,y,root):continue
    bearing=math.degrees(math.atan2(x-e,y-n))%360;delta=abs((bearing-yaw+180)%360-180)
    if delta>45:continue
    z=dem.at(x,y)
    if z>.5 and min(dem.at(x+240,y),dem.at(x-240,y),dem.at(x,y+240),dem.at(x,y-240))<.5:
     coast.append(dict(e=x,n=y,distance=round(d,2),drop=round(c*d*d,3),pixels=round(focal*c*d/max(.1,math.cos(math.radians(delta))),3)))
  # Root-edge land crossings, both requested 1080 and 720 pixel projections.
  for side in range(4):
   for t in np.linspace(0,1,1025):
    x=root[0]+(root[2]-root[0])*(t if side<2 else side-2);y=root[1]+(root[3]-root[1])*(side if side<2 else t)
    if dem.at(x,y)<.5:continue
    d=math.hypot(x-e,y-n);seam.append(dict(e=round(x,2),n=round(y,2),distance=round(d,2),drop=round(c*d*d,3),pixels1080=round(1080/(2*math.tan(math.radians(30)))*c*d,3)))
  worst=max(coast,key=lambda p:p['pixels']) if coast else None;edge=max(seam,key=lambda p:p['pixels1080'])
  rows.append(dict(view=name,shore10to30km=worst,rootLandWorstAllBearings=edge))
  for mode in ['before','after']:
   path=out/f'{name}-{mode}-wide.png'
   if path.exists():
    im=Image.open(path);w,h=im.size
    # The vertical centre is the sea/sky horizon for these level +/-1-degree views.
    for suffix,box in [('shore',(w//4,h//2-60,3*w//4,h//2+100)),('ring',(w//4,h//2+15,3*w//4,h//2+175))]:
     im.crop(box).resize(((box[2]-box[0])*2,(box[3]-box[1])*2),Image.Resampling.NEAREST).save(out/f'{name}-{mode}-{suffix}-2x.png')
 print(json.dumps(rows,indent=2));(out/'seams-flat-root.json').write_text(json.dumps(dict(width=1280,height=720,fov=60,method='Projected geometry step at coast cells; conservative horizontal perspective factor. No haze threshold is assumed.',rows=rows),indent=2)+'\n')
if __name__=='__main__':main()
