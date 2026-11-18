#!/usr/bin/env python3
"""Sunlit AREA MEANS (40th–90th luminance band), fixed native review boxes."""
import argparse,colorsys,json
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
p=argparse.ArgumentParser();p.add_argument('--pictures',type=Path,required=True);p.add_argument('--diagnostic',action='store_true');a=p.parse_args()
boxes={
 'm3-chase':((1150,330,1265,348),(60,330,420,350)),
 'm3-top':((800,158,900,196),(420,420,590,520)),
 'pt-chase':((560,325,625,350),(900,322,1180,350)),
 'pt-top':((615,280,745,318),(1100,60,1260,220))}
def stats(file,box,raw=False):
 x0,y0,x1,y1=box;rgb=np.array(Image.open(file))[y0:y1,x0:x1,:3].reshape(-1,3)/255
 linear=rgb if raw else np.where(rgb<=.04045,rgb/12.92,((rgb+.055)/1.055)**2.4)
 y=linear@np.array([.2126,.7152,.0722]);lo,hi=np.percentile(y,[40,90]);mask=(y>=lo)&(y<=hi);mean=rgb[mask].mean(0)
 return dict(rgb=(mean*255).tolist(),Y=float(y[mask].mean()),hue=colorsys.rgb_to_hsv(*mean)[0]*360,pixels=int(mask.sum()))
results=[]
for name,(road,lot) in boxes.items():
 modes=['nofinish','control','control-flat','control-lotflat','control-nopatch','control-noholes','control-unlit','control-light'] if a.diagnostic else ['after']
 for mode in modes:
  f=a.pictures/f'{name}-{mode}.png'
  if a.diagnostic and not f.exists():continue
  r=stats(f if a.diagnostic else a.pictures/f'{name}-off.png',road,mode in ['control-light','control-unlit']);l=stats(f,lot,mode in ['control-light','control-unlit'])
  hue=abs((l['hue']-r['hue']+180)%360-180);ratio=l['Y']/r['Y']
  if not a.diagnostic:
   assert hue<=15,(name,'area hue',hue)
   # Owner rule: a lot is never darker than the road beside it (1.00), and not glaring (1.20). The same lot
   # measures ~14% apart between the far chase boxes and the near top boxes, so a 1.05 floor left no margin.
   assert 1.00<=ratio<=1.20,(name,'area brightness',ratio)
  results.append(dict(pose=name,mode=mode,road_box=road,lot_box=lot,road=r,lot=l,hue_delta=hue,Y_ratio=ratio))
  image=Image.open(f);d=ImageDraw.Draw(image);d.rectangle(road,outline='#55bbff',width=2);d.rectangle(lot,outline='#ffb655',width=2);image.save(a.pictures/f'{name}-{mode}-samples.png')
(a.pictures/'colour-measurements.json').write_text(json.dumps(results,indent=2)+'\n')
for r in results:print(r['pose'],r['mode'],f"hue {r['hue_delta']:.2f}, area Y {r['Y_ratio']:.3f}")
if not a.diagnostic:print('PASS four area-mean colour cases')
