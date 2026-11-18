#!/usr/bin/env python3
"""Exercise role paths and renamed payload copies without opening historical data."""
import hashlib,sys,tempfile,types
from pathlib import Path
sys.path.insert(0,str(Path(__file__).absolute().parents[1]/'pipeline'))
import paved_provenance as p
source=Path(p.__file__).read_text()
if '--pattern-mutant' in sys.argv:source=source.replace("'road-exclusion':CAT+r'roads\\.json'","'road-exclusion':CAT+r'[^/]+\\.json'")
if '--mutant' in sys.argv:
 source=source.replace("if sha256 in DENIED:raise ValueError('Historical payload hash is forbidden')",'if False:pass')
if '--mutant' in sys.argv or '--pattern-mutant' in sys.argv:
 module=types.ModuleType('mutant');module.__file__=p.__file__;exec(compile(source,p.__file__,'exec'),module.__dict__);p=module
payload=b'synthetic historical raster payload\x00\x01';value=hashlib.sha256(payload).hexdigest();p.DENIED=frozenset([*p.DENIED,value])
assert len(p.DENIED)>1
valid={
 'terrain-lattice':'data/baked/terrain/manifest.json','building-exclusion':'data/baked/terrain/buildings.json','road-exclusion':'data/baked/terrain/roads.json',
 'baked-tree-audit':'data/baked/terrain/8/1_2.t.bin','hand-site-catalog':'data/baked/terrain/manifest.json',
 'water-exclusion':'data/raw/vectors/BASE_NSTDB_10k_Water_WM84__04_wet_features.geojson','driveway-source':'data/raw/vectors/BASE_NSTDB_10k_Roads_WM84__08_roads.geojson',
 'open-source-receipt':'data/raw/paved-open/ty4r-gcnk/fetch.json','open-source-metadata':'data/raw/paved-open/ty4r-gcnk/metadata.json','open-paved-polygons':'data/raw/paved-open/ty4r-gcnk/mabou.json',
 'owner-corrections':'data/raw/paved-open/corrections.json','parameters':'pipeline/paved-rules.json','height-source':'data/raw/elevation/north-loop-dtm-1m-epsg3979.tif',
 'recipe':'pipeline/paved.py','hand-site-recipe':'web/src/yard-site.ts'}
assert set(valid)==set(p.PATTERNS)
for role,path in valid.items():
 p.validate(path,role,'0'*64)
 # Same directory and plausible suffix; every role must reject an unrelated file.
 wrong=str(Path(path).with_name('innocent'+('.json' if role=='hand-site-recipe' else ''.join(Path(path).suffixes))))
 try:p.validate(wrong,role,'0'*64);raise AssertionError('narrow role path bypass: '+role)
 except ValueError:pass
for path,role in [('anything.json','road-exclusion'),('data/baked/terrain/roads.json','recipe'),('/tmp/roads.json','road-exclusion'),('data/raw/../baked/terrain/roads.json','road-exclusion')]:
 try:p.validate(path,role,'0'*64);raise AssertionError('Role pattern bypass')
 except ValueError:pass
with tempfile.TemporaryDirectory(prefix='paved-renamed-copy-') as tmp:
 target=Path(tmp)/'data/baked/terrain/roads.json';target.parent.mkdir(parents=True);target.write_bytes(payload)
 try:p.validate('data/baked/terrain/roads.json','road-exclusion',p.digest(target));raise AssertionError('renamed byte copy survived')
 except ValueError as e:assert 'payload hash' in str(e)
print('PASS provenance: role-scoped relative paths and renamed payload copy rejected')
if '--mutations' in sys.argv:
 import subprocess
 r=subprocess.run([sys.executable,__file__,'--mutant'],capture_output=True,text=True)
 assert r.returncode==1 and 'renamed byte copy survived' in r.stderr,r.stderr
 print('KILLED renamed-copy hash-guard removal, exit 1')

if '--mutations' in sys.argv:
 r=subprocess.run([sys.executable,__file__,'--pattern-mutant'],capture_output=True,text=True)
 assert r.returncode==1 and 'narrow role path bypass: road-exclusion' in r.stderr,r.stderr
 print('KILLED broadened road-exclusion pattern, exit 1')
