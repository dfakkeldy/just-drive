#!/usr/bin/env python3
"""Compare bare-ground heights across the actual root boundary. No images read."""
import argparse,importlib.util,json,math,re,sys
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parent.parent;sys.path.insert(0,str(ROOT/'pipeline'));import areas

def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--data-root',type=Path,required=True);args=ap.parse_args();areas.ROOT=args.data_root.parent;b=load('far',ROOT/'pipeline/34_bake_far_views.py');t=load('tall',ROOT/'pipeline/33_bake_landmarks_tall.py');g=t.Ground(areas.AREAS['mabou']);g.sources=[s for s in g.sources if s[0].GetDescription()==str(areas.AREAS['mabou'].bake_wide('dtm'))];dem=b.DEM(args.data_root/'raw/far-views/regional-240m.tif')
 root=[591500,5070564,657036,5136100];samples=[]
 for side in range(4):
  for f in np.linspace(0,1,2049):
   e=root[0]+(root[2]-root[0])*(f if side<2 else side-2);n=root[1]+(root[3]-root[1])*(side if side<2 else f);near=g.at(e,n);far=dem.at(e,n)
   if near is not None and far>.5:samples.append((e,n,near,far))
 rows=[]
 pack=args.data_root/'work/bakes/far-views/terrain';meta=json.loads((pack/'far-land.json').read_text())
 edges={}
 for level,info in meta['levels'].items():
  a=np.fromfile(pack/info['file'],dtype='<f4',count=info['vertices']*3).reshape(-1,3);e=a[:,0]+meta['origin'][0];n=meta['origin'][1]-a[:,2];h=a[:,1];edges[level]=[]
  for side in range(4):
   mask=abs(n-root[1+2*(side==1)])<.1 if side<2 else abs(e-root[0+2*(side==3)])<.1
   q=e[mask] if side<2 else n[mask];z=h[mask];order=np.argsort(q);edges[level].append((q[order],z[order]))
 for name,e,n in [('Marble Hill',612761.94,5099561.98),('Mabou heights',622560,5112920),('Cape Mabou high point',619881.19,5112017.41)]:
  candidates=[]
  for x,y,near,far in samples:
   distance=math.hypot(x-e,y-n);difference=abs(near-far);candidates.append(dict(e=round(x,2),n=round(y,2),distance=round(distance,2),near=near,far=round(far,3),stepMetres=round(difference,3),pixels1080=round(difference/distance*1080/(2*math.tan(math.pi/6)),3),pixels720=round(difference/distance*720/(2*math.tan(math.pi/6)),3)))
  corrected={}
  for level,edge in edges.items():
   gaps=[]
   for x,y,near,far in samples:
    side=0 if abs(y-root[1])<.1 else 1 if abs(y-root[3])<.1 else 2 if abs(x-root[0])<.1 else 3
    values,heights=edge[side];at=x if side<2 else y;i=int(np.searchsorted(values,at))
    if i==0 or i>=len(values) or values[i]-values[i-1]>1920:continue
    height=float(np.interp(at,values,heights));distance=math.hypot(x-e,y-n);difference=abs(near-height)
    gaps.append(dict(e=round(x,2),n=round(y,2),distance=round(distance,2),near=near,far=round(height,3),stepMetres=round(difference,3),pixels1080=round(difference/distance*1080/(2*math.tan(math.pi/6)),3),pixels720=round(difference/distance*720/(2*math.tan(math.pi/6)),3)))
   corrected[level]=max(gaps,key=lambda p:p['pixels1080'])
  rows.append(dict(view=name,unmatchedDEM=max(candidates,key=lambda x:x['pixels1080']),matchedActualMesh=corrected,samples=len(candidates)))
 out=dict(method='Local HRDEM/wide DTM versus 240 m MRDEM bilinear height at independent 32 m root-edge stations; both receive the same rendered curvature. Pixel values are vertical-FOV60 radial projections, not a weather visibility claim. Canopy is excluded.',rows=rows)
 (args.data_root/'work/threads/far-views/root-seam-curved.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out,indent=2))
if __name__=='__main__':main()
