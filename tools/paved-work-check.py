#!/usr/bin/env python3
"""Tiny cache dependency and reviewed drop-set regressions; no real heights read."""
import json,sys,tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).absolute().parents[1]/'pipeline'))
from paved_work import cache_key,key_files,AREAS
import hand_sites
from paved_audit import reviewed_drops
with tempfile.TemporaryDirectory(prefix='paved-key-') as tmp:
    root=Path(tmp)
    paths=[]
    for area in AREAS:
        folder=root/('data/baked/terrain' if area=='mabou' else f'data/baked/areas/{area}')
        (folder/'8').mkdir(parents=True)
        (folder/'manifest.json').write_text(json.dumps(dict(buildings=dict(file='buildings.json'),trees=dict(level=8,tiles=['0_0']))))
        for name in ('roads.json','buildings.json','8/0_0.t.bin'):(folder/name).write_bytes(b'original');paths.append(folder/name)
    original=cache_key(root,root)
    for path in paths:
        before=path.read_bytes();path.write_bytes(b'promoted')
        assert cache_key(root,root)!=original, f'Baked promotion must change cache key: {path}'
        path.write_bytes(before)
    assert cache_key(root,root)==original
# Every source the site exporter reads (and the bake records) is in the key, so an edit to one rebuilds the check bake.
repo=Path(__file__).absolute().parents[1]
missing=sorted({p.relative_to(hand_sites.RECIPE_ROOT).as_posix() for p in hand_sites.source_files(repo)}-{p.relative_to(repo).as_posix() for p in key_files(repo)})
assert not missing, f'Site exporter sources missing from the cache key: {missing}'
for area in AREAS:
    expected=[dict(id=f'pointtupper-{n}',drop=True) for n in (13,30,46,53,63,64,75)] if area=='pointtupper' else []
    reviewed_drops(area,expected)
    mutants=[expected+[dict(id=area+'-999',drop=True)]]
    if expected:mutants.append(expected[:-1])
    for audit in mutants:
        try:reviewed_drops(area,audit)
        except AssertionError as e:assert 'Reviewed drop list changed' in str(e)
        else:raise AssertionError('Changed drop-set mutant survived')
print('PASS cache key: all 18 baked content changes and every site exporter source; exact drops in all six areas and seven drop-set mutants')
