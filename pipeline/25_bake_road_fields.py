#!/usr/bin/env python3
"""Rebuild road fields for all road-adjacent L5..L8 height tiles.

Exact world-coordinate point/segment distances. A spatial hash and conservative
patch bounds reduce work without approximating the field. R is signed lateral
distance, positive on the right. Outside 12.7 m, RGB is (255, 0, 0).
Ties use the earlier segment in roads.json, independent of tile or query order.
Run in the GDAL container after 23 and 24. No existing field is silently skipped.
"""
import collections
import importlib.util
import json
import math
import os

import numpy as np
from osgeo import gdal

spec = importlib.util.spec_from_file_location('corridor', os.path.join(os.path.dirname(os.path.abspath(__file__)), '24_bake_corridor.py'))
corridor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(corridor)
b = corridor.b


# The low nibble stays the physical surface kind. The two high bits are
# presentation only, with bridge and washboard bits left in place.
PAVEMENT_FLAGS = {'double-yellow': 64, 'worn': 128}


class Field:
    def __init__(self, network):
        entries = []
        for road in network:
            flags = road['kind'] | (16 if road['bridge'] else 0) | (32 if road.get('washboard') else 0)
            if 'pavement' in road:
                flags |= PAVEMENT_FLAGS[road['pavement']]
            for a,c in zip(road['pts'][:-1],road['pts'][1:]):
                if a!=c:
                    entries.append([*a,*c,road['halfWidth'],flags])
        self.a = np.array(entries,dtype=np.float64)
        self.lo = np.minimum(self.a[:,:2],self.a[:,2:4])
        self.hi = np.maximum(self.a[:,:2],self.a[:,2:4])
        self.bins = collections.defaultdict(list)
        self.bin_size = 128
        for n,(lo,hi) in enumerate(zip(self.lo,self.hi)):
            for j in range(math.floor(lo[1]/128),math.floor(hi[1]/128)+1):
                for i in range(math.floor(lo[0]/128),math.floor(hi[0]/128)+1):
                    self.bins[(i,j)].append(n)

    def query(self,x0,y0,x1,y1):
        ids = set()
        for j in range(math.floor(y0/128),math.floor(y1/128)+1):
            for i in range(math.floor(x0/128),math.floor(x1/128)+1):
                ids.update(self.bins.get((i,j),()))
        ids = np.array(sorted(ids),dtype=np.int64)
        if ids.size:
            ids = ids[(self.hi[ids,0]>=x0)&(self.lo[ids,0]<=x1)&
                      (self.hi[ids,1]>=y0)&(self.lo[ids,1]<=y1)]
        return ids

    def d2(self,x,y,ids):
        a = self.a[ids]
        dx,dy = a[...,2]-a[...,0],a[...,3]-a[...,1]
        t = np.clip(((x-a[...,0])*dx+(y-a[...,1])*dy)/(dx*dx+dy*dy),0,1)
        return (x-a[...,0]-t*dx)**2+(y-a[...,1]-t*dy)**2

    def near(self,bb,radius=12.7):
        x0,y0,x1,y1=bb
        ids=self.query(x0-radius,y0-radius,x1+radius,y1+radius)
        if not len(ids):
            return False
        # Exact segment/rectangle distance, including corners and edge crossings.
        rect=corridor.roads.rectangle(bb)
        for n in ids:
            g=corridor.roads.ogr.Geometry(corridor.roads.ogr.wkbLineString)
            g.AddPoint_2D(*self.a[n,:2]); g.AddPoint_2D(*self.a[n,2:4])
            if g.Distance(rect)<=radius:
                return True
        return False

    def raster(self,xs,ys):
        out=np.zeros((3,len(ys),len(xs)),dtype=np.uint8)
        out[0]=255
        for row in range(0,len(ys),64):
            yy=ys[row:row+64,None]
            for col in range(0,len(xs),64):
                xx=xs[None,col:col+64]
                ids=self.query(float(xx.min()-12.7),float(yy.min()-12.7),
                               float(xx.max()+12.7),float(yy.max()+12.7))
                best=np.full((len(yy),xx.shape[1]),12.7**2)
                winner=np.full(best.shape,len(self.a),dtype=np.int64)
                for n in ids:
                    dx=np.maximum(np.maximum(self.lo[n,0]-xx,xx-self.hi[n,0]),0)
                    dy=np.maximum(np.maximum(self.lo[n,1]-yy,yy-self.hi[n,1]),0)
                    rr,cc=np.where(dx*dx+dy*dy<=best)
                    if not len(rr):
                        continue
                    d=self.d2(xx[0,cc],yy[rr,0],n)
                    old=best[rr,cc]
                    take=(d<old)|((d==old)&(n<winner[rr,cc]))
                    r,c=rr[take],cc[take]
                    best[r,c]=d[take]
                    winner[r,c]=n
                valid=winner<len(self.a)
                rr,cc=np.where(valid)
                seg=self.a[winner[valid]]
                # Negative 2-D cross product means right in east/north space.
                cross=(seg[:,2]-seg[:,0])*(yy[rr,0]-seg[:,1])-(seg[:,3]-seg[:,1])*(xx[0,cc]-seg[:,0])
                signed=np.sqrt(best[valid])*np.where(cross>0,-1,1)
                out[0,row+rr,col+cc]=np.clip(np.rint(signed*10)+128,1,255).astype(np.uint8)
                out[1,row+rr,col+cc]=np.clip(np.rint(seg[:,4]*20),0,255).astype(np.uint8)
                out[2,row+rr,col+cc]=seg[:,5].astype(np.uint8)
        return out



def main():
    manifest=json.load(open(f'{b.OUT}/manifest.json'))
    network=json.load(open(f'{b.OUT}/roads.json'))['roads']
    field=Field(network)
    print(f'{len(field.a)} road segments',flush=True)
    levels={}
    total=0
    for level in (5,6,7,8):
        names=[]
        for name in manifest['levels'][str(level)]:
            i,j=map(int,name.split('_'))
            bb=corridor.bounds(level,i,j)
            if not field.near(bb):
                continue
            xs=bb[0]+np.arange(257,dtype=np.float64)*b.res(level)
            ys=bb[3]-np.arange(257,dtype=np.float64)*b.res(level)
            rgb=field.raster(xs,ys)
            path=f'{b.OUT}/{level}/{name}.r.png'
            b.write_png(path,rgb)
            total+=os.path.getsize(path)
            names.append(name)
            if len(names)%25==0:
                print(f'L{level}: {len(names)} fields written',flush=True)
        stale=[]
        wanted=set(names)
        for filename in os.listdir(f'{b.OUT}/{level}'):
            if filename.endswith('.r.png') and filename[:-6] not in wanted:
                os.remove(f'{b.OUT}/{level}/{filename}')
                stale.append(filename)
        levels[str(level)]=names
        print(f'L{level}: {len(names)} road tiles; removed {len(stale)} stale fields',flush=True)
    # Re-read immediately before updating our key; other bakes own other keys.
    manifest=json.load(open(f'{b.OUT}/manifest.json'))
    manifest['roads']=dict(file='roads.json',levels=levels,encoding=dict(distance=0.1,halfWidth=0.05,signed=True,zero=128))
    with open(f'{b.OUT}/manifest.json','w') as f:
        json.dump(manifest,f)
    print(f'Road field total: {total:,} bytes',flush=True)


if __name__=='__main__':
    main()
