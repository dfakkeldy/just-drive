#!/usr/bin/env python3
"""Read the existing West Bay bake. Emit flat-water boundaries to stdout; never write game data."""
import json, math, sys
from functools import lru_cache
from collections import deque
from pathlib import Path
from PIL import Image
root = Path(__file__).resolve().parents[1] / 'data/baked/areas/westbay'
m = json.loads((root / 'manifest.json').read_text())
@lru_cache(128)
def tile(i, j):
    return Image.open(root / '8' / f'{i}_{j}.png')
def height(e, n):
    x, y = e-m['origin'][0], m['origin'][1]-n
    i,j=int(x//256),int(y//256)
    q=tile(i,j).getpixel((round(x-i*256),round(y-j*256)))
    return (q[0]*256+q[1])*.01-100

def simplify(p, tolerance):
    if len(p)<3:return p
    a,b=p[0],p[-1];dx,dy=b[0]-a[0],b[1]-a[1];den=dx*dx+dy*dy or 1
    def dist(q):
        t=max(0,min(1,((q[0]-a[0])*dx+(q[1]-a[1])*dy)/den))
        return math.hypot(q[0]-a[0]-dx*t,q[1]-a[1]-dy*t)
    d,i=max((dist(q),i) for i,q in enumerate(p))
    return simplify(p[:i+1],tolerance)[:-1]+simplify(p[i:],tolerance) if d>tolerance else [a,b]

def lake(e,n,level):
    step=2;todo=deque([(e,n)]);seen={(e,n)};wet=set()
    while todo:
        x,y=todo.popleft()
        if abs(height(x,y)-level)>(.5 if level==27 else .2):continue
        wet.add((x,y))
        for q in [(x-step,y),(x+step,y),(x,y-step),(x,y+step)]:
            if q not in seen and 630200<q[0]<633200 and 5062000<q[1]<5066500:seen.add(q);todo.append(q)
    edges={}
    for x,y in wet:
        for q,a,b in [((x,y-step),(x-1,y-1),(x+1,y-1)),((x+step,y),(x+1,y-1),(x+1,y+1)),((x,y+step),(x+1,y+1),(x-1,y+1)),((x-step,y),(x-1,y+1),(x-1,y-1))]:
            if q not in wet:edges[a]=b
    loops=[]
    while edges:
        start=next(iter(edges));p=[start];q=edges.pop(start)
        while q!=start and q in edges:p.append(q);q=edges.pop(q)
        loops.append(p)
    p=max(loops,key=len);mid=len(p)//2;p=simplify(p[:mid+1],2)+simplify(p[mid:]+p[:1],2)[1:-1]
    return dict(level=level,points=p)
print('/** Flat-water outlines from the existing 1 m LiDAR bake, sampled every 2 m, simplified within 2 m.\n * tools/quarry-survey.py is read-only. The heights are water returns, not lake-bed soundings. */')
print('export const QUARRY_LAKES = '+json.dumps([lake(631900,5064500,27),lake(630700,5063000,15.4)],separators=(',',':'))+' as const;')
