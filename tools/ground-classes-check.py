#!/usr/bin/env python3
"""Ground contract and source mutants. Synthetic cases exercise production functions.

--work-root additionally verifies all six real bakes against their pinned sources.
"""
import argparse
import json
from pathlib import Path
import sys
import tempfile
import types

import numpy as np
from PIL import Image
sys.path.insert(0,str(Path(__file__).absolute().parent.parent/'pipeline'))
import ground_classes as ground


def rejects(call):
    try: call()
    except ValueError: return
    raise AssertionError('invalid input was accepted')


def cases(g):
    old=np.zeros((2,4,3),dtype=np.uint8);old[:,:,2]=[[1,4,3,5],[1,5,5,1]]
    hand=np.zeros((2,4),bool);hand[0,0]=True
    paved=np.zeros_like(hand);paved[0,2]=True
    mineral=np.ones_like(hand);proposed=np.full((2,4),9,np.uint8)
    out=g.compose(old[:,:,2],proposed,mineral,hand,paved)
    assert out.tolist()==[[1,4,3,6],[6,6,6,6]],'overlay priority'
    after=old.copy();after[:,:,2]=out;g.validate_result(old,after,mineral,hand,paved)
    for field,xy in [('hand',(0,0)),('water',(0,1)),('paved',(0,2))]:
        bad=after.copy();bad[xy[0],xy[1],2]=6
        rejects(lambda:g.validate_result(old,bad,mineral,hand,paved))
    bad=after.copy();bad[1,0,2]=14
    no=mineral.copy();no[1,0]=False
    rejects(lambda:g.validate_result(old,bad,no,hand,paved))
    bad=after.copy();no=mineral.copy();no[1,0]=False
    rejects(lambda:g.validate_result(old,bad,no,hand,paved))
    # A single summer with a tall/unknown canopy never qualifies, even surrounded by qualifying cells.
    one=np.ones((5,5),bool);none=np.zeros_like(one);canopy=np.zeros((5,5));canopy[2,2]=3
    confirmed=g.confirmed_bare(one,none,canopy,one)
    assert not confirmed[2,2] and confirmed[1,1]
    canopy[2,2]=np.inf;assert not g.confirmed_bare(one,none,canopy,one)[2,2]
    canopy[2,2]=2;assert g.confirmed_bare(one,none,canopy,one)[2,2]
    assert g.confirmed_bare(one,one,np.full((5,5),np.inf),one)[2,2]
    env=one.copy();env[2,2]=False
    assert not g.confirmed_bare(one,one,canopy,env)[2,2]
    isolated=none.copy();isolated[2,2]=True
    assert not g.confirmed_bare(isolated,isolated,canopy,one).any()
    # Truncated displayed extent: a 5m-ish pixel crossing an unsupported 10m neighbour stays old.
    support=np.array([[True,False,True],[True,False,True],[True,False,True]])
    refined=g.refine_support(support,(0,0,27,20),5,4)
    assert refined.tolist()==[[True,False,False,False,True]]*4,'resample must only subtract support'
    from shapely.geometry import box
    clipped=g.clip_mineral_cells(np.ones((2,4),bool),(0,0,20,10),box(1,0,19,10))
    assert clipped.tolist()==[[False,True,True,False]]*2,'whole clearing cell stays inside envelope'
    with tempfile.TemporaryDirectory(prefix='mmm-ground-contract-') as td:
        p=Path(td);(p/'cover.png').write_bytes(b'fixture')
        g.validate_output_files(p)
        (p/'Sentinel-B04.tif').write_bytes(b'not an image')
        rejects(lambda:g.validate_output_files(p))
    assert set(g.LEGEND)==set(range(14)) and 'paved' not in ' '.join(g.LEGEND.values())
    assert g.forest_class({'FORNON':99})==13
    assert g.forest_class({'FORNON':0}) is None and g.forest_class({'FORNON':60}) is None,'stale forest is not approved clearing'
    assert g.wet_class({'CNWI_CLASS_EN':'Swamp'})==9
    assert g.wet_class({'CNWI_CLASS_EN':'Peatland'}) is None
    # Finding 1: a treed stand inside a CNWI bog keeps its trees (9); only measured open cells become 8.
    wet=np.array([[8,8,8,9],[8,8,0,9]],np.uint8);canopy10=np.array([[0.,6.]])
    assert g.open_wetland(wet,canopy10,(0,0,20,10)).tolist()==[[8,8,9,9],[8,8,0,9]],'treed bog keeps trees'
    assert g.open_wetland(wet,np.array([[np.inf,0.]]),(0,0,20,10)).tolist()==[[9,9,8,9],[9,9,0,9]],'unknown canopy is not open'
    picked=g.coarse_cells(np.array([[False,False,True,False],[False]*4]),(0,0,27,10),4,2)
    assert picked.shape==(1,3) and picked.tolist()==[[False,True,True]],'every overlapped 10m cell is measured'
    # Finding 6: never bake over a promoted cover.
    g.baseline_cover({'file':'cover.png'})
    rejects(lambda:g.baseline_cover({'file':'cover.png','ground':{'file':'cover-ground.bin'}}))
    rejects(lambda:g.baseline_cover({'file':'cover.png','classes':{'6':'confirmed mineral'}}))
    from shapely.geometry import LineString,box
    bed=g.bed_geometry(LineString([(-5,10),(105,10)]),box(0,0,100,20))
    assert bed.area==500 and bed.bounds==(0,7.5,100,12.5),'rail bed is five metres, not the whole corridor'
    with tempfile.TemporaryDirectory(prefix='mmm-canopy-nodata-') as td:
        root=Path(td);path=root/'data/baked/terrain/8/0_0.png';path.parent.mkdir(parents=True);path.write_bytes(b'not an image')
        pixels=np.zeros((257,257,3),np.uint8);pixels[:,:,0]=37;pixels[:,:,1]=128 # encoded -4m NoData
        original=g.tile;g.tile=lambda p:pixels
        try:
            area=g.AREAS['mabou'];e=np.array([area.origin[0]+128]);n=np.array([area.origin[1]-128])
            assert np.isinf(g.canopy_at(root,area,e,n)[0]),'NoData is not bare-canopy evidence'
            pixels[:,:,0]=39;pixels[:,:,1]=16 # measured 0m, no canopy
            assert g.canopy_at(root,area,e,n)[0]==0
        finally:g.tile=original
    print('PASS ground contracts: domain, priorities, evidence, canopy, shrink-only smoothing, treed wetland, promoted baseline, output allowlist')


def site_list(exporter_text):
    """Finding 3: the ground bake reserves every hand-built site in web/src, not a fixed older list."""
    import re
    repo=Path(__file__).absolute().parents[1]
    found={p.name[:-len('-site.ts')] for p in (repo/'web/src').glob('*-site.ts')}
    paved=re.search(r"const PAVED_SITES=\[([^\]]*)\]",exporter_text).group(1)
    extra=re.search(r"const GROUND_SITES=\[\.\.\.PAVED_SITES,([^\]]*)\]",exporter_text).group(1)
    listed={x.strip().strip("'") for x in (paved+','+extra).split(',') if x.strip()}
    assert listed==found,'ground site list differs from web/src/*-site.ts: missing '+str(sorted(found-listed))+', extra '+str(sorted(listed-found))
    import hand_sites
    assert set(hand_sites.GROUND_SITES)==found,'hand_sites.GROUND_SITES differs from web/src/*-site.ts'


def mutants():
    source=Path(ground.__file__).read_text()
    edits={
      'domain':("if not np.isin(cls,list(LEGEND)).all():","if False:"),
      'hand validation':("if not np.array_equal(before[protected],after[protected]):","if False:"),
      'paved validation':("if not np.array_equal(before[paved],after[paved]):","if False:"),
      'water validation':("if not np.array_equal(old==4,cls==4) or not np.array_equal(before[old==4],after[old==4]):","if False:"),
      'confirmed-only clearing':("if np.any((cls==6)&~mineral):","if False:"),
      'hand precedence':("result[protected]=today[protected]","pass"),
      'paved precedence':("result[paved]=today[paved]","pass"),
      'water precedence':("result[today==4]=4","pass"),
      'one-year high canopy':("(canopy_max <= 2)","(canopy_max <= 200)"),
      'envelope':("supported = envelope &", "supported = np.ones_like(envelope) &"),
      'smoothing expansion':("return supported & (neighbours >= 3)","return neighbours >= 3"),
      'display-grid repeat':("return (support[np.ix_(r0,c0)] & support[np.ix_(r0,c1)] &\n            support[np.ix_(r1,c0)] & support[np.ix_(r1,c1)])","return np.repeat(np.repeat(support,2,axis=0),2,axis=1)[:height,:width]"),
      'source image output':("if any(p.name not in allowed or not p.is_file() for p in Path(output).iterdir()):","if False:"),
      'wide rail corridor':("return line.buffer(2.5,cap_style=2).intersection(corridor)","return line.buffer(10,cap_style=2).intersection(corridor)"),
      'nodata confirms bare':("known=(pixels[:,0].astype(np.uint16)*256+pixels[:,1])!=9600","known=np.ones(len(pixels),dtype=bool)"),
      'envelope edge overreach':("result[r[~contained],c[~contained]]=False","pass"),
      'treed bog clears':("result=wet.copy(); result[(wet==8)&~open5]=9","result=wet.copy()"),
      'unknown canopy is open':("open5=refine_support(canopy10<=2,","open5=refine_support(np.where(np.isinf(canopy10),0,canopy10)<=2,"),
      'one coarse corner':("        for c in (c0[cc],c1[cc]): out[r,c]=True","        out[r,c0[cc]]=True"),
      'promoted baseline':("    if 'ground' in meta or 'classes' in meta:","    if False:"),
    }
    for name,(old,new) in edits.items():
        assert source.count(old)==1,(name,'anchor')
        mod=types.ModuleType('ground_mutant');mod.__file__=ground.__file__
        exec(compile(source.replace(old,new),ground.__file__,'exec'),mod.__dict__)
        try: cases(mod)
        except AssertionError: print('KILLED',name);continue
        raise AssertionError('SURVIVED '+name)
    exporter=(Path(__file__).absolute().parents[1]/'tools/paved-sites.mjs').read_text()
    anchor="PAVED_SITES,'yard-dog',"
    assert exporter.count(anchor)==1,'yard-dog anchor'
    try: site_list(exporter.replace(anchor,'PAVED_SITES,'))
    except AssertionError: print('KILLED','missing yard-dog reservation')
    else: raise AssertionError('SURVIVED missing yard-dog reservation')


def real(work_root,data_root):
    for ar in ground.AREAS:
        out=Path(work_root)/ar;p=json.loads((out/'promotion.json').read_text())
        ground.validate_output_files(out);ground.sources(Path(data_root),ar)
        for file,digest in p['outputs'].items():assert ground.sha(out/file)==digest
        for item in p['input_hashes']:
            source=(Path(data_root) if item['path'].startswith('data/') else ground.REPO)/item['path']
            assert ground.sha(source)==item['sha256'],ar+' input changed: '+item['path']
        oldroot=Path(data_root)/('data/baked/terrain' if ar=='mabou' else 'data/baked/areas/'+ar)
        before=np.array(Image.open(oldroot/'cover.png'));after=np.array(Image.open(out/'cover.png'))
        protected=ground.site_mask(data_root,ar,p['bounds'],after.shape[1],after.shape[0])
        assert np.array_equal(before[protected],after[protected]),ar+' hand sites'
        assert np.array_equal(before[:,:,2]==4,after[:,:,2]==4),ar+' water'
        assert np.array_equal(before[before[:,:,2]==4],after[before[:,:,2]==4]),ar+' water RGB'
        # CPU run bytes must name exactly the same clearing cells as the GPU B channel.
        import struct
        payload=(out/'cover-ground.bin').read_bytes();width,height,count=struct.unpack_from('<III',payload,4)
        assert payload[:4]==b'GC01' and (width,height)==(after.shape[1],after.shape[0])
        decoded=np.zeros(width*height,dtype=np.uint8)
        for i in range(count):
            start,length,cls,reserved=struct.unpack_from('<IHBB',payload,16+i*8)
            assert cls in [6,8] and reserved==0 and start//width==(start+length-1)//width
            decoded[start:start+length]=cls
        expected=np.where(np.isin(after[:,:,2],[6,8]),after[:,:,2],0)
        assert np.array_equal(decoded.reshape(height,width),expected),ar+' CPU/GPU clearing agreement'
        assert all(0<=int(c)<=13 for c in np.unique(after[:,:,2]))
        assert p['class_bytes_per_pixel']==1 and p['new_draw_calls']==0
        for receipt in p['source_snapshot']:assert ground.sha(Path(data_root)/receipt['path'])==receipt['sha256']
        print('PASS real cover',ar,'hand/water unchanged; pinned inputs; class-only output hashes')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--mutations',action='store_true')
    parser.add_argument('--work-root',type=Path);parser.add_argument('--data-root',type=Path)
    args=parser.parse_args();cases(ground)
    site_list((Path(__file__).absolute().parents[1]/'tools/paved-sites.mjs').read_text())
    print('PASS ground site list: every web/src/*-site.ts is reserved')
    if args.mutations:mutants()
    if args.work_root:real(args.work_root,args.data_root)
