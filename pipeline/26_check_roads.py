#!/usr/bin/env python3
"""Check terrain/road manifests and seams; regenerate village road-bed overlay.

Run in the GDAL container after 23,24,25. Checks every neighbouring edge (stronger
than 20 random pairs), also reports reproducible random sets of 20 L8 pairs.
Produces roads-check-village.png and machine-readable roads-checks.json.
"""
import collections
import hashlib
import importlib.util
import json
import math
import os
import random

import numpy as np
from osgeo import gdal

spec=importlib.util.spec_from_file_location('fields', os.path.join(os.path.dirname(os.path.abspath(__file__)), '25_bake_road_fields.py'))
f=importlib.util.module_from_spec(spec)
spec.loader.exec_module(f)
b=f.b


def read(path):
    ds=gdal.Open(path)
    assert ds is not None,path
    a=ds.ReadAsArray()
    assert a.shape==(3,257,257),(path,a.shape)
    assert a.dtype==np.uint8,(path,a.dtype)
    return a


def edges(level,names,suffix):
    tiles={tuple(map(int,name.split('_'))):name for name in names}
    pairs=[]
    failed=[]
    # Store only edge strips, not the whole level.
    ee={}
    for p,name in tiles.items():
        a=read(f'{b.OUT}/{level}/{name}{suffix}.png')
        ee[p]=(a[:,:,0].copy(),a[:,:,-1].copy(),a[:,0,:].copy(),a[:,-1,:].copy())
    for (i,j),name in tiles.items():
        for step,one,two in [((1,0),1,0),((0,1),3,2)]:
            p=(i+step[0],j+step[1])
            if p in tiles:
                pair=(name,tiles[p])
                pairs.append(pair)
                if not np.array_equal(ee[(i,j)][one],ee[p][two]):
                    failed.append(pair)
    assert not failed,f'{level}{suffix} mismatched edges: {failed[:20]} ({len(failed)} total)'
    rng=random.Random(2961)
    sample=rng.sample(pairs,min(20,len(pairs)))
    print(f'L{level}{suffix}: {len(pairs)} shared edges byte-identical',flush=True)
    return dict(pairsChecked=len(pairs),random20=sample)


def check_field_math(field,manifest):
    rng=random.Random(2961)
    # Compare hash/patch results with all segments at random points and junctions.
    points=[]
    names=manifest['roads']['levels']['8']
    for name in rng.sample(names,min(30,len(names))):
        i,j=map(int,name.split('_'))
        bb=f.corridor.bounds(8,i,j)
        points.append((bb[0]+rng.randrange(257),bb[1]+rng.randrange(257)))
    for road in json.load(open(f'{b.OUT}/roads.json'))['roads'][::40]:
        points.extend([tuple(road['pts'][0]),tuple(road['pts'][-1])])
    ids=np.arange(len(field.a))
    for x,y in points:
        got=field.raster(np.array([x]),np.array([y]))[:,0,0]
        ds=field.d2(x,y,ids)
        winner=int(np.argmin(ds))
        seg=field.a[winner]
        d=math.sqrt(float(ds[winner]))
        cross=(seg[2]-seg[0])*(y-seg[1])-(seg[3]-seg[1])*(x-seg[0])
        r=int(np.clip(np.rint(d*10*(-1 if cross>0 else 1))+128,1,255))
        want=np.array([255,0,0] if d>12.7 else [r,round(seg[4]*20),int(seg[5])])
        assert np.array_equal(got,want),(x,y,got,want)
    return len(points)


def picture(manifest):
    x0,y1=b.AREA.bake_anchor[0]-700,b.AREA.bake_anchor[1]+550
    w,h=1401,1101
    bb=(x0,y1-h+1,x0+w-1,y1)
    rgb=f.corridor.roads.hillshade(bb)
    mask=np.zeros((h,w),dtype=bool)
    bridge=np.zeros_like(mask)
    sides=np.zeros((h,w),dtype=np.int8)
    for name in manifest['roads']['levels']['8']:
        i,j=map(int,name.split('_'))
        tb=f.corridor.bounds(8,i,j)
        left,top=max(x0,tb[0]),min(y1,tb[3])
        right,bottom=min(x0+w-1,tb[2]),max(y1-h+1,tb[1])
        if right<left or top<bottom:
            continue
        a=read(f'{b.OUT}/8/{name}.r.png')
        c,r=int(left-tb[0]),int(tb[3]-top)
        ww,hh=int(right-left)+1,int(top-bottom)+1
        a=a[:,r:r+hh,c:c+ww]
        dest=(slice(int(y1-top),int(y1-top)+hh),slice(int(left-x0),int(left-x0)+ww))
        distance=(a[0].astype(float)-128)*.1
        road=(np.abs(distance)<=a[1].astype(float)*.05)&(a[2]!=0)
        sides[dest]=np.where(a[2]!=0,np.where(distance<0,-1,1),0)
        mask[dest]=road
        bridge[dest]=road&((a[2]&16)>0)
    sign_rgb=rgb.copy()
    for side,colour in [(-1,[55,145,255]),(1,[255,95,60])]:
        take=sides==side
        sign_rgb[:,take]=(sign_rgb[:,take]*.3+np.array(colour)[:,None]*.7).astype(np.uint8)
    b.write_png(f'{b.OVERVIEW}/roads-check-sign.png',sign_rgb)
    rgb[:,mask]=(rgb[:,mask].astype(float)*.45+np.array([255,105,40])[:,None]*.55).astype(np.uint8)
    rgb[:,bridge]=(rgb[:,bridge].astype(float)*.3+np.array([25,185,255])[:,None]*.7).astype(np.uint8)
    path=f'{b.OVERVIEW}/roads-check-village.png'
    b.write_png(path,rgb)
    print(f'{path}: {w} x {h}; orange=road surface, cyan=bridge',flush=True)
    return dict(file='roads-check-village.png',bounds=list(bb),resolution=1)


def main():
    # Direction, end caps and a vertex are checked independently of real roads.
    for pts in [[[0,0],[10,0]], [[10,0],[0,0]], [[0,0],[10,0],[10,10]]]:
        test=f.Field([dict(pts=pts,halfWidth=2,kind=1,bridge=False)])
        for x,y in [(5,2),(5,-2),(-2,2),(12,-2),(10,1),(5,0),(5,20)]:
            ids=np.arange(len(test.a)); ds=test.d2(x,y,ids); n=int(np.argmin(ds))
            seg=test.a[n]; d=math.sqrt(float(ds[n]))
            cross=(seg[2]-seg[0])*(y-seg[1])-(seg[3]-seg[1])*(x-seg[0])
            want=[255,0,0] if d>12.7 else [int(np.clip(np.rint(d*10*(-1 if cross>0 else 1))+128,1,255)),40,1]
            assert test.raster(np.array([x]),np.array([y]))[:,0,0].tolist()==want
    manifest=json.load(open(f'{b.OUT}/manifest.json'))
    assert manifest['roads']['encoding']==dict(distance=.1,halfWidth=.05,signed=True,zero=128)
    expected=set()
    for level,names in manifest['levels'].items():
        assert len(names)==len(set(names)),f'duplicate height names L{level}'
        expected.update(f'{level}/{name}.png' for name in names)
    for level,names in manifest['roads']['levels'].items():
        assert len(names)==len(set(names)),f'duplicate field names L{level}'
        assert set(names)<=set(manifest['levels'][level])
        expected.update(f'{level}/{name}.r.png' for name in names)
        for name in names:
            a=read(f'{b.OUT}/{level}/{name}.r.png')
            absent=a[2]==0
            assert (a[0,absent]==255).all() and (a[1,absent]==0).all()
            assert (a[0,~absent]>=1).all()
            flags = a[2,~absent]
            kind = flags & 15
            assert np.isin(kind, (1,2,3,4,5)).all()
            assert np.isin(flags & 192, (0, *f.PAVEMENT_FLAGS.values())).all()
            assert ((flags & 192 == 0) | (kind == 2)).all()
    actual={os.path.relpath(os.path.join(root,p),b.OUT) for root,_,files in os.walk(b.OUT)
            for p in files if p.endswith('.png') and os.path.basename(root).isdigit()}
    assert expected==actual,dict(missing=sorted(expected-actual),unlisted=sorted(actual-expected))
    assert os.path.exists(f"{b.OUT}/{manifest['roads']['file']}")
    assert os.path.exists(f"{b.OUT}/{manifest['cover']['file']}")
    report=dict(filesChecked=len(expected),edges={})
    for level in (7,8):
        report['edges'][f'{level}height']=edges(level,manifest['levels'][str(level)],'')
    for level in (5,6,7,8):
        report['edges'][f'{level}road']=edges(level,manifest['roads']['levels'][str(level)],'.r')
    common={tuple(map(int,n.split('_'))) for n in manifest['roads']['levels']['8']}
    common_pairs=[(f'{i}_{j}',f'{i+di}_{j+dj}') for i,j in sorted(common)
                  for di,dj in [(1,0),(0,1)] if (i+di,j+dj) in common]
    assert len(common_pairs)>=20
    report['random20L8BothHeightAndRoad']=random.Random(2961).sample(common_pairs,20)
    network=json.load(open(f'{b.OUT}/roads.json'))['roads']
    selected=f.corridor.select(manifest,network)
    for level,tiles in selected.items():
        # The corridor tiles were chosen before the centrelines were smoothed, so a few tiles at the 160 m and
        # 450 m limits may differ. Allow a small difference; a large one means the corridor bake (24) must run again.
        want,have={f'{i}_{j}' for i,j in tiles},set(manifest['levels'][str(level)])
        drift=len(want^have)
        print(f'L{level} corridor tiles: {len(have)} baked, {drift} differ from the current road lines',flush=True)
        assert drift<=0.03*len(have),(level,'corridor selection',drift)
    report['corridorCoverage']='route buffers plus village, fully inside mid (small drift allowed after smoothing)'
    mid=manifest['mid']
    lengths=[]
    for road in network:
        a=np.array(road['pts'])
        assert ((a[:,0]>=mid[0])&(a[:,0]<=mid[2])&(a[:,1]>=mid[1])&(a[:,1]<=mid[3])).all()
        d=np.linalg.norm(np.diff(a,axis=0),axis=1)
        lengths.extend(d.tolist())
        assert (d>0).all()
        assert d.max()<=15
    report['vertexSpacing']=dict(min=min(lengths),max=max(lengths),under3=sum(d<3 for d in lengths))
    # Smoothing pulls points together inside tight bends, so pieces under 3 m are allowed; none may be under 1 m.
    assert report['vertexSpacing']['min']>=1.0,report['vertexSpacing']
    field=f.Field(network)
    report['bruteForceSamples']=check_field_math(field,manifest)
    # Check the exact road-adjacent selection too, including tiles with roads
    # passing through a corner but no grid samples within 12.7 m.
    for level in (5,6,7,8):
        wanted=set(manifest['roads']['levels'][str(level)])
        for name in manifest['levels'][str(level)]:
            i,j=map(int,name.split('_'))
            assert (name in wanted)==field.near(f.corridor.bounds(level,i,j)),(level,name)
    hashes=f'{b.OVERVIEW}/terrain-base-sha256.json'
    if os.path.exists(hashes):
        baseline=json.load(open(hashes))
        for path,expected_hash in baseline.items():
            assert hashlib.sha256(open(f'{b.P}/'+path,'rb').read()).hexdigest()==expected_hash,path
        report['baseFilesByteUnchanged']=len(baseline)
    else:
        print('No pre-bake SHA256 snapshot; base-file comparison unavailable',flush=True)
    report['picture']=picture(manifest)
    report['heightTiles']={str(l):dict(count=len(manifest['levels'][str(l)]),
          bytes=sum(os.path.getsize(f'{b.OUT}/{l}/{n}.png') for n in manifest['levels'][str(l)])) for l in (7,8)}
    report['roadTiles']={str(l):dict(count=len(manifest['roads']['levels'][str(l)]),
          bytes=sum(os.path.getsize(f'{b.OUT}/{l}/{n}.r.png') for n in manifest['roads']['levels'][str(l)])) for l in (5,6,7,8)}
    json.dump(report,open(f'{b.OVERVIEW}/roads-checks.json','w'),indent=2)
    print(json.dumps({k:v for k,v in report.items() if k not in ('edges','random20L8BothHeightAndRoad')},indent=2),flush=True)


if __name__=='__main__':
    main()
