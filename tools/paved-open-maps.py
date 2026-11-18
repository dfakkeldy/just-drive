#!/usr/bin/env python3
"""Schematic lot maps from open vector geometry only. No background imagery."""
from pathlib import Path
import argparse,json,math,sys
sys.path.insert(0,str(Path(__file__).absolute().parents[1]/"pipeline"))
from paved_provenance import resolve
REPO=Path(__file__).absolute().parents[1]
DATA=(REPO/"data/baked").resolve().parent.parent
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
from shapely.geometry import shape,box
p=argparse.ArgumentParser();p.add_argument('--work',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
font='/System/Library/Fonts/Supplemental/Arial.ttf'
def f(n):
 try:return ImageFont.truetype(font,n)
 except OSError:return ImageFont.load_default()
for area in ['mabou','judique','porthood','westbay','pointtupper','cansocauseway']:
 root=a.work/area;doc=json.loads((root/'bake.json').read_text());lots=json.loads((root/'lots.geojson').read_text())['features'];painted=shape(json.loads((root/'painted.geojson').read_text())['geometry'])
 manifest=json.loads(resolve(next(x['path'] for x in doc['inputs'] if x['role']=='terrain-lattice'),REPO,DATA).read_text());bounds=manifest['mid']
 image=Image.new('RGB',(1600,1160),'#f4f1e9');d=ImageDraw.Draw(image)
 d.text((40,24),area.upper()+' / OPEN PAVEMENT',fill='#172b32',font=f(34))
 d.text((40,72),'Open lots + owner apron rules · EPSG:2961 · no aerial imagery',fill='#43545a',font=f(21))
 def panel(bounds,rect):
  l,t,r,b=rect;x0,y0,x1,y1=bounds;scale=min((r-l)/(x1-x0),(b-t)/(y1-y0));ox=l+(r-l-(x1-x0)*scale)/2;oy=t+(b-t-(y1-y0)*scale)/2
  point=lambda x,y:(ox+(x-x0)*scale,oy+(y1-y)*scale)
  d.rectangle(rect,fill='#e3e9dd',outline='#c3cdbf',width=1)
  def poly(g,fill,outline=None):
   clip=g.intersection(box(*bounds))
   for p in ([clip] if clip.geom_type=='Polygon' else getattr(clip,'geoms',[])):
    if p.geom_type!='Polygon' or p.is_empty:continue
    pts=[point(x,y) for x,y in p.exterior.coords];d.polygon(pts,fill=fill)
    if outline:d.line(pts,fill=outline,width=2)
    for ring in p.interiors:d.polygon([point(x,y) for x,y in ring.coords],fill='#e3e9dd')
  for lot in lots:poly(shape(lot['geometry']),'#89b8c6','#568a9a')
  poly(painted,'#303839')
  for lot in doc['omitted_lots']:
   feature=next(x for x in lots if x['properties']['id']==lot['id']);poly(shape(feature['geometry']),'#cb7b40')
  metres=10**math.floor(math.log10((r-l)/scale/5));px=metres*scale
  d.line((l+20,b-24,l+20+px,b-24),fill='#142e36',width=3);d.text((l+20,b-49),f'{metres:g} m',fill='#142e36',font=f(16));d.text((r-30,t+15),'N ↑',fill='#142e36',font=f(18))
 panel(bounds,(40,115,1000,1050))
 for i,lot in enumerate(sorted(lots,key=lambda x:shape(x['geometry']).area,reverse=True)[:3]):
  g=shape(lot['geometry']);x0,y0,x1,y1=g.bounds;pad=max(30,(x1-x0)*.25,(y1-y0)*.25)
  t=115+i*313;panel((x0-pad,y0-pad,x1+pad,y1+pad),(1030,t,1560,t+285));d.text((1042,t+10),f'LOT DETAIL {i+1}',font=f(17),fill='#142e36')
 d.text((40,1075),f"Mapped: {doc['source_count']} lots / {doc['source_m2']:,.0f} m²   |   Final 2 m cells: {doc['raster_m2']:,} m²   |   Aprons: {doc['apron_m2']:,} m²",fill='#172b32',font=f(22))
 d.text((40,1115),'Blue: source boundary   Charcoal: pavement after cuts   Orange: withheld hand-site lot',fill='#43545a',font=f(19))
 image.save(a.out/f'{area}-lots-map.png')
 print(a.out/f'{area}-lots-map.png')
