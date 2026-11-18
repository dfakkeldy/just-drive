"""Portable role-scoped paved input validation. Historical payloads are hash-denied."""
import hashlib
import json
import re
from pathlib import Path

CAT = r'data/baked/(?:terrain|areas/(?:mabou|judique|porthood|westbay|pointtupper|cansocauseway))/'
RAW = r'data/raw/(?:areas/[a-z]+/)?'
PATTERNS = {
 'terrain-lattice':CAT+r'manifest\.json', 'building-exclusion':CAT+r'buildings\.json',
 'road-exclusion':CAT+r'roads\.json', 'baked-tree-audit':CAT+r'8/\d+_\d+\.t\.bin',
 'hand-site-catalog':CAT+r'(?:manifest|buildings|roads)\.json',
 'water-exclusion':RAW+r'vectors/BASE_NSTDB_10k_Water_[^/]+wet_features\.geojson',
 'driveway-source':RAW+r'vectors/BASE_NSTDB_10k_Roads_[^/]+08_roads\.geojson',
 'open-source-receipt':r'data/raw/paved-open/ty4r-gcnk/fetch\.json',
 'open-source-metadata':r'data/raw/paved-open/ty4r-gcnk/metadata\.json',
 'open-paved-polygons':r'data/raw/paved-open/ty4r-gcnk/(?:mabou|judique|porthood|westbay|pointtupper|cansocauseway)\.json',
 'owner-corrections':r'data/raw/paved-open/corrections\.json',
 'parameters':r'pipeline/paved-rules\.json',
 'height-source':RAW+r'elevation/(?:north-loop-(?:dtm|dsm)-1m-epsg3979\.tif|land-(?:dtm|dsm)-1m-epsg3979(?:-federal)?\.vrt|(?:dtm|dsm)-[^/]+\.tif)',
 'recipe':r'pipeline/(?:paved(?:_fetch|_aprons|_provenance|_heights)?\.py|paved-denied-sha256\.json|32_bake_paved\.py|areas\.py)',
 'hand-site-recipe':r'(?:pipeline/hand_sites\.py|tools/paved-sites\.mjs|web/src/[A-Za-z0-9_./-]+\.ts)',
}
DENIED = frozenset(json.loads(Path(__file__).with_name('paved-denied-sha256.json').read_text())['sha256'])


def digest(path):
 h=hashlib.sha256()
 with Path(path).open('rb') as f:
  for chunk in iter(lambda:f.read(4*1024*1024),b''):h.update(chunk)
 return h.hexdigest()


def validate(relative,role,sha256):
 p=Path(relative)
 if p.is_absolute() or '..' in p.parts or not re.fullmatch(PATTERNS.get(role,r'(?!)'),relative):
  raise ValueError('Input path is not allowed for role '+role+': '+relative)
 if sha256 in DENIED:raise ValueError('Historical payload hash is forbidden')


def resolve(relative,repo,data_root):
 # Data input roots can move independently of the recipe checkout.
 p=Path(relative)
 if p.is_absolute() or '..' in p.parts:raise ValueError('Expected repo-relative input')
 base=Path(data_root) if relative.startswith('data/') else Path(repo)
 result=base/p
 # Reject an alias escaping its declared data or recipe root.
 anchor=base
 if relative.startswith('data/'):
  anchor=base/p.parent
 if not result.resolve().is_relative_to(anchor.resolve()):raise ValueError('Input alias escapes root')
 return result
