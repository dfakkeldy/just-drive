#!/usr/bin/env python3
"""Shared reservation API, real catalogs, actual web constructors."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).absolute().parents[1]/'pipeline'))
import hand_sites
from paved_work import key_files
root=(Path(__file__).absolute().parents[1]/'data/baked').resolve().parent.parent
polygons=hand_sites.polygons(root)
assert set(polygons)=={'yard','home','church','porch','fishing','coast','quarry','mine'}
assert all(g.is_valid and not g.is_empty for g in polygons.values())
assert polygons['quarry'].bounds==(630200,5061600,633200,5066500),'full quarry contains reservation'
assert polygons['coast'].bounds==(618230,5108340,619080,5110540)
assert len(polygons['mine'].geoms)==2,'both possible mine footprints'
assert len(hand_sites.records(root))==8
assert all(p.exists() for p in hand_sites.source_files(root)+hand_sites.catalog_inputs(root))
for name,g in polygons.items():assert getattr(hand_sites,name)(root).equals(g)
hand_sites.clear_cache();assert hand_sites.quarry(root).equals(polygons['quarry'])
# The paved check bake is keyed on every source the exporter reads, so an edit to one rebuilds it.
recipe=hand_sites.RECIPE_ROOT
missing=sorted({p.relative_to(recipe).as_posix() for p in hand_sites.source_files(root)}-{p.relative_to(recipe).as_posix() for p in key_files(recipe)})
assert not missing,f'Site exporter sources missing from the paved cache key: {missing}'
print('PASS shared hand sites: 8 actual constructor reservations, all per-site APIs, both mine portals, quarry extension, provenance paths and every exporter source in the paved cache key')
