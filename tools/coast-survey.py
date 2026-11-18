#!/usr/bin/env python3
"""Read-only LiDAR shore survey. All artifacts stay in data/work/coast/build."""
import os
import json
import math
import struct
import sys
import subprocess
import tempfile
from functools import lru_cache
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
BAKE = ROOT / 'data/baked/terrain'
OUT = Path(os.environ.get('MMM_COAST_OUT', ROOT / 'data/work/coast/build'))
M = json.loads((BAKE / 'manifest.json').read_text())
LEVELS = {int(k): set(v) for k, v in M['levels'].items()}

@lru_cache(None)
def tile(level, i, j):
    return np.asarray(Image.open(BAKE / f'{level}/{i}_{j}.png').convert('RGBA'))

def height(e, n):
    for level in sorted(LEVELS, reverse=True):
        size = M['size'] / 2**level
        a, b = (e-M['origin'][0])/size, (M['origin'][1]-n)/size
        i, j = math.floor(a), math.floor(b)
        if f'{i}_{j}' not in LEVELS[level]: continue
        x, y = (a-i)*256, (b-j)*256
        ix, iy = min(255, math.floor(x)), min(255, math.floor(y))
        u, v = x-ix, y-iy
        px = tile(level, i, j)
        def raw(a, b):
            return (int(px[b,a,0])*256+int(px[b,a,1]))*M['height']['scale']+M['height']['offset']
        return (raw(ix,iy)*(1-u)+raw(ix+1,iy)*u)*(1-v)+(raw(ix,iy+1)*(1-u)+raw(ix+1,iy+1)*u)*v
    raise ValueError((e,n))

def facts(e,n):
    h=height(e,n)
    de=(height(e+2,n)-height(e-2,n))/4
    dn=(height(e,n+2)-height(e,n-2))/4
    return dict(e=e,n=n,h=round(h,3),slope=round(math.hypot(de,dn),3),aspect=round(math.degrees(math.atan2(-de,-dn))%360,1))

if __name__ == '__main__':
    OUT.mkdir(parents=True,exist_ok=True)
    if '--trees' in sys.argv:
        rows=[]
        for key in M['trees']['tiles']:
            i,j=map(int,key.split('_'));e0=M['origin'][0]+i*256;n0=M['origin'][1]-j*256
            if e0+256<618230 or e0>619080 or n0<5108340 or n0-256>5110540:continue
            data=(BAKE/f'8/{key}.t.bin').read_bytes()
            for k in range(0,len(data),8):
                u,v,h,r,kind,seed=struct.unpack_from('<HHBBBB',data,k)
                e=e0+u/256;n=n0-v/256
                if 618230<=e<=619080 and 5108340<=n<=5110540:
                    rows.append(dict(tile=key,record=k//8,kind=kind,**facts(e,n)))
        (OUT/'tree-survey.json').write_text(json.dumps(rows,separators=(',',':')))
        print('Surveyed tree/bush instances:',len(rows))
        sys.exit(0)
    # Two metres per pixel. Detect the west-facing shore from water to land, not a guessed straight line.
    west,east,south,north=617900,619400,5108250,5110600
    res=2
    hs=np.array([[height(e,n) for e in range(west,east,res)] for n in range(north,south,-res)])
    dz,dx=np.gradient(hs,res)
    slope=np.hypot(dx,dz)
    shade=np.clip(.75-dx*.19-dz*.16,.3,1)
    rgb=np.zeros((*hs.shape,3));rgb[:]=[29,63,73]
    land=hs>-.18
    rgb[land]=np.stack([100+hs*.38,128+hs*.25,76+hs*.2],axis=2)[land]*shade[land,None]
    steep=(slope>.6)&land
    rgb[steep]=np.array([174,135,105])*shade[steep,None]
    im=Image.fromarray(np.uint8(np.clip(rgb,0,255))).resize((900,1410))
    d=ImageDraw.Draw(im)
    def xy(e,n):return ((e-west)/(east-west)*900,(north-n)/(north-south)*1410)
    d.text((12,12),'LIDAR: brown = slope > 0.6; contours 10 m; EPSG:2961',fill='white')
    # Shore and face intervals for inspection. Full 2 m samples retained in JSON.
    rows=[]
    for n in range(5108400,5110501,25):
        coast=[]
        for e in range(617950,619251,2):
            if height(e,n)>-.1 and height(e-2,n)<=-.1:coast.append(e)
        if not coast:continue
        shore=coast[0]
        line=[facts(e,n) for e in range(shore,min(shore+240,619300),2)]
        faces=[p for p in line if p['slope']>.55 and p['h']>1.5]
        row=dict(n=n,shore=shore,faces=faces)
        rows.append(row)
        x,y=xy(shore,n);d.ellipse((x-2,y-2,x+2,y+2),fill='cyan')
        if n%100==0:
            d.text((x-72,y),str(n),fill='white')
            for p in faces[::4]:
                x,y=xy(p['e'],n);d.ellipse((x-1,y-1,x+1,y+1),fill='#f9cc68')
    for e,n,label in [(618976,5109274,'ROAD LOOK-OFF'),(618725,5110083,'BREAKWATER'),(618850,5110120,'HARBOUR')]:
        x,y=xy(e,n);d.ellipse((x-4,y-4,x+4,y+4),fill='white');d.text((x+8,y),label,fill='white')
    for y in range(1,hs.shape[0]):
        for x in range(1,hs.shape[1]):
            if hs[y,x]>5 and int(hs[y,x]/10)!=int(hs[y,x-1]/10):
                xx,yy=xy(west+x*res,north-y*res);d.point((xx,yy),fill='#c2cca0')
    im.save(OUT/'survey-heights.png')
    # Evaluate the actual authored zone weights on the surveyed grid; no parallel Python geology model.
    with tempfile.TemporaryDirectory(prefix='mmm-coast-survey-') as scratch:
        module=Path(scratch)/'coast.mjs'
        subprocess.run([str(ROOT/'web/node_modules/.bin/esbuild'),str(ROOT/'web/src/coast-site.ts'),'--bundle','--format=esm',f'--outfile={module}'],check=True,capture_output=True)
        heights=hs[::2,::2];slopes=slope[::2,::2]
        payload=json.dumps(dict(w=heights.shape[1],west=west,north=north,res=res*2,h=heights.ravel().round(3).tolist(),s=slopes.ravel().round(3).tolist()))
        script="import {coastWeights} from '"+module.as_uri()+"';let chunks=[];for await(const c of process.stdin)chunks.push(c);const d=JSON.parse(Buffer.concat(chunks)),b=Buffer.alloc(d.h.length*4);for(let k=0;k<d.h.length;k++){const w=coastWeights(d.west+(k%d.w)*d.res,d.north-Math.floor(k/d.w)*d.res,d.h[k],d.s[k]);for(let j=0;j<4;j++)b[k*4+j]=Math.round(w[j]*255);}process.stdout.write(b);"
        weights=subprocess.run(['node','--input-type=module','-e',script],input=payload.encode(),capture_output=True,check=True).stdout
        masks=np.frombuffer(weights,dtype=np.uint8).reshape((*heights.shape,4))/255
        overlay=np.uint8(np.clip(rgb[::2,::2],0,255)).astype(float)
        for j,color in enumerate([[245,239,215],[166,155,148],[190,132,107],[222,200,145]]):
            alpha=masks[:,:,j,None]*.8*(heights[:,: ,None]>-.18)
            overlay=overlay*(1-alpha)+np.array(color)*alpha
        im=Image.fromarray(np.uint8(overlay)).resize((900,1410));d=ImageDraw.Draw(im)
    d.text((12,12),'VISIBLE MASKS ON LIDAR: white gypsum / grey beds / brown broken / tan beach',fill='white')
    # Modelling zones, not a geological map.
    from re import findall, search
    source=(ROOT/'web/src/coast-site.ts').read_text()
    for name in ['COVE_SHORE','POINT_SHORE']:
        section=source.split('export const '+name)[1].split('];')[0]
        pts=[tuple(map(int,p)) for p in findall(r'\[(\d+),(\d+)\]',section)]
        for a,b in zip(pts,pts[1:]):
            n=(a[1]+b[1])/2
            color='#eee9d8' if 5109000<n<5109320 else '#c7a87d' if n<5109000 or n>5110120 else '#bb8673'
            d.line([xy(*a),xy(*b)],fill='#88bcc8',width=1)
    for e,n,label,col in [(618870,5110330,'A  FINLAY: tilted beds + recesses','#e6c79f'),
                         (618800,5110180,'A  local gypsum','#eee9d8'),
                         (619010,5109710,'B  broken slopes','#e4a28a'),
                         (618870,5109150,'C  gypsum + fallen blocks','#eee9d8'),
                         (618410,5108580,'D  coal measures','#e6c79f')]:
        x,y=xy(e,n);d.text((x,y),label,fill=col)
    d.text((12,1375),'Zones follow slope, height and shore distance. Contacts are inferred; beaches below 4.7 m.',fill='white')
    im.save(OUT/'survey-zones.png')
    (OUT/'survey.json').write_text(json.dumps(rows,indent=2))
    for r in rows:
        if r['n']%100==0:
            fs=r['faces'];print(r['n'],'shore',r['shore'],'face',[(p['e'],p['h'],p['slope'],p['aspect']) for p in fs[::max(1,len(fs)//5)]])
