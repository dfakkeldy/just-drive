#!/usr/bin/env python3
"""Check shared height nodes between adjacent tiles of one baked area (read-only)."""
import argparse
import json
import sys
from pathlib import Path
import numpy as np
from PIL import Image
sys.path.insert(0, str(Path(__file__).absolute().parent.parent/'pipeline'))
from areas import AREAS


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('area', choices=AREAS)
    args=parser.parse_args()
    root=AREAS[args.area].output
    manifest=json.loads((root/'manifest.json').read_text())
    checked=0;bad=[];maximum=0
    for level,names in manifest['levels'].items():
        edges={}
        for name in names:
            with Image.open(root/level/f'{name}.png') as image:
                rgb=np.asarray(image).astype(np.int32)
            assert rgb.shape==(257,257,3), (level,name,rgb.shape)
            height=rgb[:,:,0]*256+rgb[:,:,1]
            edges[tuple(map(int,name.split('_')))]=(height[0].copy(),height[-1].copy(),height[:,0].copy(),height[:,-1].copy())
        for (i,j),(north,south,west,east) in edges.items():
            for neighbour,edge,index in [((i+1,j),east,2),((i,j+1),south,0)]:
                if neighbour not in edges:continue
                checked+=1
                difference=int(np.max(np.abs(edge-edges[neighbour][index])))
                maximum=max(maximum,difference)
                if difference:bad.append(dict(level=level,tile=[i,j],neighbour=neighbour,maxDifferenceMetres=difference/100))
    print(json.dumps(dict(area=args.area,checkedPairs=checked,badPairs=len(bad),maximumDifferenceMetres=maximum/100,examples=bad[:10]),indent=2))
    if not checked or bad:raise SystemExit(1)


if __name__=='__main__':main()
