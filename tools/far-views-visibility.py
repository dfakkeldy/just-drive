#!/usr/bin/env python3
"""Build the five-view geometry receipt from MRDEM and the existing local DTM.

This samples bare ground and ocean, not weather, vegetation or super-refraction.
It also checks the authorised distant-only rendered bend against the physical view.
"""
import argparse
import importlib.util
import json
import math
from pathlib import Path
import re
import sys
from osgeo import gdal
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'pipeline'))
import areas
spec=importlib.util.spec_from_file_location('far_bake',ROOT/'pipeline/34_bake_far_views.py');bake=importlib.util.module_from_spec(spec);spec.loader.exec_module(bake)


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--data-root',type=Path,required=True);ap.add_argument('--output',type=Path,required=True);args=ap.parse_args()
    data=args.data_root.resolve();out=args.output.resolve()
    if not out.is_relative_to(data/'work'):ap.error('Output must be inside data/work')
    text=(ROOT/'web/src/far-rules.ts').read_text()
    radius=float(re.search(r'EARTH_RADIUS = ([\d_]+)',text)[1].replace('_',''));k=float(re.search(r'REFRACTION_K = ([\d.]+)',text)[1]);c=(1-k)/(2*radius)
    gdal.UseExceptions();dem=bake.DEM(data/'raw/far-views/regional-240m.tif')
    areas.ROOT=data.parent
    spec=importlib.util.spec_from_file_location('tall_bake',ROOT/'pipeline/33_bake_landmarks_tall.py');tall=importlib.util.module_from_spec(spec);spec.loader.exec_module(tall)
    views=[('Mabou highlands',622560,5112920,False),('Mabou harbour mouth',617080,5104110,True),('Marble Hill',612761.94,5099561.98,False),('Port Hood shore',613348.1,5095755,True),('Judique shore',616180,5080371,True)]
    regions={'PEI east end':[561000,5132000,581000,5152000],'Cape George highlands':[575000,5069000,589000,5085000]}
    targets={name:[(e,n,dem.at(e,n)) for e in range(box[0],box[2],480) for n in range(box[1],box[3],480) if dem.at(e,n)>5] for name,box in regions.items()}
    start=float(re.search(r'CURVE_START = ([\d_]+)',text)[1].replace('_',''));full=float(re.search(r'CURVE_FULL = ([\d_]+)',text)[1].replace('_',''))
    def rendered_drop(d):
        t=max(0,min(1,(d-start)/(full-start)))
        return max(0,c*(d*d-start*start))*t*t*(3-2*t)
    rows=[]
    for label,e,n,shore in views:
        area='porthood' if label.startswith(('Marble','Port Hood')) else 'judique' if label.startswith('Judique') else 'mabou'
        ground=tall.Ground(areas.AREAS[area])
        rel=Path('terrain') if area=='mabou' else Path('areas')/area
        root=bake.root_box(json.loads((data/'baked'/rel/'manifest.json').read_text()))
        raw=ground.at(e,n);raw=dem.at(e,n) if raw is None else raw
        eye=2 if shore else raw+1.7
        for name,points in targets.items():
            choices=sorted(points,key=lambda p:(p[2]-c*((p[0]-e)**2+(p[1]-n)**2)-eye)/math.hypot(p[0]-e,p[1]-n),reverse=True)
            winner=None
            for te,tn,th in choices[:120]:
                distance=math.hypot(te-e,tn-n);slope=(th-c*distance*distance-eye)/distance;profile=[];hybrid=[]
                # Fine local sampling resolves narrow islands that a 240 m
                # profile can miss at a sea-level observer's grazing sightline.
                stations=list(range(20,min(6000,math.floor(distance)),20))+list(range(6000,math.floor(distance),120))
                for d in stations:
                    x=e+(te-e)*d/distance;y=n+(tn-n)*d/distance;h=dem.at(x,y)
                    local=ground.at(x,y) if bake.inside(x,y,root) else None
                    if local is not None:h=max(0,local)
                    profile.append([d,round(h,3)])
                    hybrid.append([d,round(h+c*d*d-rendered_drop(d),3)])
                visible=all((h-c*d*d-eye)/d<slope for d,h in profile)
                rendered_target=th+c*distance*distance-rendered_drop(distance)
                actual_slope=(rendered_target-c*distance*distance-eye)/distance
                actual=all((h-c*d*d-eye)/d<actual_slope for d,h in hybrid)
                row=dict(view=label,observer=[e,n,round(eye,3)],target=name,point=[te,tn,round(th,3)],distance=round(distance,3),drop=round(c*distance*distance,3),visible=visible,renderedVisible=actual,renderedTarget=round(rendered_target,3),profile=profile,renderedProfile=hybrid)
                if winner is None:winner=row
                if visible and actual:winner=row;break
                if visible:winner=row
            rows.append(winner);print(label,name,winner['observer'][2],winner['point'],round(winner['distance']/1000,2),'visible',winner['visible'],'rendered',winner['renderedVisible'],flush=True)
    result=dict(source='NRCan MRDEM-30 DTM 2026-06-22, 240 m resample; each area local HRDEM/wide DTM throughout its root',earthRadius=radius,k=k,eye='2 m above sea for sea-level shore views; local DTM + 1.7 m for heights',sample='20 m to 6 km, then 120 m',rows=rows)
    bake.write_json(out,result)


if __name__=='__main__':main()
