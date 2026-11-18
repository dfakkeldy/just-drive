#!/usr/bin/env python3
"""Read baked heights only. Write survey pictures and logs in data/work/fishing; never change the bake."""
import json
import math
from functools import lru_cache
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
BAKE = ROOT / 'data/baked/terrain'
OUT = ROOT / 'data/work/fishing'
OUT.mkdir(parents=True, exist_ok=True)
M = json.loads((BAKE / 'manifest.json').read_text())
LEVELS = {int(k): set(v) for k, v in M['levels'].items()}

@lru_cache(None)
def tile(level, i, j):
    return Image.open(BAKE / f'{level}/{i}_{j}.png').convert('RGBA')

def height(e, n):
    for level in sorted(LEVELS, reverse=True):
        size = M['size'] / 2 ** level
        a, b = (e-M['origin'][0])/size, (M['origin'][1]-n)/size
        i, j = math.floor(a), math.floor(b)
        if f'{i}_{j}' not in LEVELS[level]:
            continue
        x, y = (a-i)*256, (b-j)*256
        ix, iy = min(255, math.floor(x)), min(255, math.floor(y))
        u, v = x-ix, y-iy
        im = tile(level, i, j)
        def raw(a, b):
            r, g, *_ = im.getpixel((a, b))
            return (r*256+g)*M['height']['scale']+M['height']['offset']
        return ((raw(ix,iy)*(1-u)+raw(ix+1,iy)*u)*(1-v)
                +(raw(ix,iy+1)*(1-u)+raw(ix+1,iy+1)*u)*v), level
    raise ValueError('No height at point')

def course():
    import re
    text=(ROOT/'web/src/fishing-course.ts').read_text()
    points=[(float(e),float(n)) for e,n in re.findall(r'\[([0-9.]+),([0-9.]+)\]',text)]
    rows=[];distance=0
    for i in range(len(points)-1):
        a,b,c,d=points[max(0,i-1)],points[i],points[i+1],points[min(len(points)-1,i+2)]
        steps=math.ceil(math.dist(b,c))
        for j in range(0 if i==0 else 1,steps+1):
            t=j/steps
            p=tuple(.5*(2*b[k]+(-a[k]+c[k])*t+(2*a[k]-5*b[k]+4*c[k]-d[k])*t*t+(-a[k]+3*b[k]-3*c[k]+d[k])*t*t*t) for k in range(2))
            if rows:distance+=math.dist(p,(rows[-1]['e'],rows[-1]['n']))
            rows.append({'distance':distance,'e':p[0],'n':p[1]})
    for i,p in enumerate(rows):
        a,b=rows[max(0,i-1)],rows[min(len(rows)-1,i+1)]
        length=math.hypot(b['e']-a['e'],b['n']-a['n'])
        de,dn=(b['e']-a['e'])/length,(b['n']-a['n'])/length
        # A rectangle around the hull, rotated with the actual course, including the bow and stern.
        wet=[height(p['e']+de*along-dn*across,p['n']+dn*along+de*across)[0]
             for along in [-6.5,0,6.5] for across in [-2.5,0,2.5]]
        p['ground']=height(p['e'],p['n'])[0];p['hullMaxGround']=max(wet)
        p['waterDepth']= -.2-p['ground']
    return points,rows

def picture(name,box,step,rows,roads,buildings):
    e0,n0,e1,n1=box
    im=Image.new('RGB',(round((e1-e0)/step),round((n1-n0)/step)))
    for y in range(im.height):
        for x in range(im.width):
            h,_=height(e0+x*step,n1-y*step)
            t=min(1,max(0,(-h-.2)/3.8))
            im.putpixel((x,y),(int(45-25*t),int(105-55*t),int(135-40*t)) if h<-.2 else (int(110+min(h,35)*3),int(120+min(h,35)*2),90))
    d=ImageDraw.Draw(im)
    def pt(e,n):return ((e-e0)/step,(n1-n)/step)
    for road in roads:
        if any(e0<e<e1 and n0<n<n1 for e,n in road['pts']):
            d.line([pt(*p) for p in road['pts']],fill=(230,210,130),width=2)
    for b in buildings:
        if e0<b['x']<e1 and n0<b['y']<n1:d.polygon([pt(*p) for p in b['footprint']],outline='red',width=1)
    if rows:d.line([pt(p['e'],p['n']) for p in rows],fill='white',width=2)
    spacing=100 if step<=1 else 250
    for e in range(math.ceil(e0/spacing)*spacing,int(e1),spacing):
        x,y=pt(e,n1);d.line([(x,0),(x,im.height)],fill=(90,100,95));d.text((x+2,5),str(e),fill='white')
    for n in range(math.ceil(n0/spacing)*spacing,int(n1),spacing):
        x,y=pt(e0,n);d.line([(0,y),(im.width,y)],fill=(90,100,95));d.text((3,y+2),str(n),fill='white')
    im.save(OUT/f'{name}.png')

if __name__=='__main__':
    roads=json.loads((BAKE/'roads.json').read_text())['roads']
    buildings=json.loads((BAKE/'buildings.json').read_text())['buildings']
    rows={str(id):[{'e':e,'n':n,'height':round(height(e,n)[0],3),'level':height(e,n)[1]}
                  for e,n in next(x['pts'] for x in roads if x['id']==id)] for id in [922,506,864]}
    waypoints,path=course();rows['departure']=path
    rows['waypoints']=[{'e':e,'n':n,'ground':height(e,n)[0],'waterDepth':-.2-height(e,n)[0]} for e,n in waypoints]
    (OUT/'survey-heights.json').write_text(json.dumps(rows,indent=2)+'\n')
    print('Road 922:',rows['922'][0],rows['922'][-1])
    print('Course metres:',round(path[-1]['distance'],2),'hull max ground:',round(max(p['hullMaxGround'] for p in path),4))
    print('Mouth cross-sections (water surface raster, not bathymetry):')
    for e in [618100,618050,618030,618000,617950,617900,617850,617800]:
        water=[n for n in range(5104880,5105101) if height(e,n)[0]<-.45]
        print(e,min(water),max(water),'deepest',min((height(e,n)[0],n) for n in water))
    for p in rows['waypoints']:print(p)
    picture('survey',(618570,5104600,618960,5105130),.5,[],roads,buildings)
    picture('survey-exit',(616200,5104400,619000,5105900),2,path,roads,buildings)
    picture('survey-mouth-close',(617600,5104850,618250,5105200),1,path,roads,buildings)
    assert max(p['hullMaxGround'] for p in path)<-.45,'Course crosses shore or shallow bar'
