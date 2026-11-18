"""Shared hand-built site reservation polygons, in absolute EPSG:2961 metres.

One function per site: yard(root), home(root), church(root), porch(root),
fishing(root), coast(root), quarry(root), mine(root). Missing optional sites
return an empty geometry. polygons(root) returns all eight by name.

These are the actual Site.box / contains reservations, including transition
space, not guesses at the visible paint outline. The TS constructors and the
mine endpoint predicate execute through one exporter; coordinates are never
re-entered here. No buffer is implicit: each consumer chooses its own margin.
Call clear_cache() after changing source or catalogs in the same Python process.
"""
import json
import subprocess
from functools import lru_cache
from pathlib import Path
from shapely.geometry import shape, mapping
from shapely.ops import unary_union

RECIPE_ROOT = Path(__file__).absolute().parents[1]


@lru_cache(maxsize=4)
def _export(root, scope='paved'):
    return json.loads(subprocess.check_output(
        ['node',str(RECIPE_ROOT/'tools/paved-sites.mjs'),str(Path(root).absolute()),'mabou']+(['ground'] if scope=='ground' else []),cwd=RECIPE_ROOT))


def _site(root, name):
    return unary_union([shape(s['geometry']) for s in _export(str(Path(root).absolute()))['sites']
                        if s['id']==name or name=='mine' and s['id'].startswith('mine-')])


def yard(root): return _site(root,'yard')
def home(root): return _site(root,'home')
def church(root): return _site(root,'church')
def porch(root): return _site(root,'porch')
def fishing(root): return _site(root,'fishing')
def coast(root): return _site(root,'coast')
def quarry(root): return _site(root,'quarry')
def mine(root): return _site(root,'mine')


def polygons(root):
    return {fn.__name__:fn(root) for fn in (yard,home,church,porch,fishing,coast,quarry,mine)}


def records(root):
    return [dict(id=name,geometry=mapping(g)) for name,g in polygons(root).items() if not g.is_empty]


# The ground-class bake keeps the old ground under every hand-built site, including those
# added after the paved layer (its list above is unchanged). Many-box sites are one union.
GROUND_SITES = ('yard','home','church','porch','fishing','coast','quarry','mine',
                'yard-dog','judique-village','port-hawkesbury','airport','mabou-main')


def ground_records(root):
    sites=_export(str(Path(root).absolute()),'ground')['sites']
    out=[]
    for name in GROUND_SITES:
        g=unary_union([shape(s['geometry']) for s in sites if s['id']==name or name=='mine' and s['id'].startswith('mine-')])
        if not g.is_empty: out.append(dict(id=name,geometry=mapping(g)))
    return out


def ground_source_files(root):
    return [RECIPE_ROOT/'pipeline/hand_sites.py']+[RECIPE_ROOT/p for p in _export(str(Path(root).absolute()),'ground')['sources']]


def source_files(root):
    """Recipe paths for provenance; all from the same exporter revision."""
    return [RECIPE_ROOT/'pipeline/hand_sites.py']+[RECIPE_ROOT/p for p in _export(str(Path(root).absolute()))['sources']]


def catalog_inputs(root):
    return [Path(p) for p in _export(str(Path(root).absolute()))['inputs']]


def clear_cache(): _export.cache_clear()
