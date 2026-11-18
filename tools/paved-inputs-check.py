#!/usr/bin/env python3
"""Verify every actual bake input hash and reject the prohibited source paths."""
import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).absolute().parents[1]/'pipeline'))
from areas import AREAS
from paved_work import ensure
from paved_audit import reviewed_drops
from paved import input_path, sha, tile_bytes
from paved_provenance import validate, resolve
import numpy as np
root=Path(__file__).absolute().parents[1]
real=(root/'data/baked').resolve().parent.parent
work=ensure(root)
# Reject lexical aliases and real symlink targets before any bytes can be read.
with tempfile.TemporaryDirectory(prefix='paved-input-guard-') as tmp:
    p=Path(tmp)/'intensity';p.mkdir();link=Path(tmp)/'safe-name';link.symlink_to(p,target_is_directory=True)
    for bad in [p/'missing.tif',link/'missing.tif',Path(tmp)/'data/work/threads/paved/anything.json',Path(tmp)/'osm.json']:
        try:input_path(bad);raise AssertionError('Forbidden source accepted')
        except ValueError:pass
checked=0;tiles=0
for area in AREAS:
    output=work/area;doc=json.loads((output/'bake.json').read_text());index=json.loads((output/'paved/index.json').read_text())
    assert index['source']=='nstdb-designated-open-v1' and index['dataset']=='ty4r-gcnk'
    assert index['area']==area and doc['area']==area
    retained={f['properties']['id'] for f in json.loads((output/'lots.geojson').read_text())['features']}
    for lot in doc['lot_eligibility']:
        expected=lot['valid_fraction']<.95 or (lot['median_slope'] is not None and lot['median_slope']>.08) or (lot['tall_fraction'] is not None and lot['tall_fraction']>.2)
        assert lot['drop']==expected and ((lot['id'] in retained)==(not expected)),'Lot eligibility rule and retained geometry'
    reviewed_drops(area,doc['lot_eligibility'])
    assert doc['inputs']
    for entry in doc['inputs']:
        validate(entry['path'],entry['role'],entry['sha256'])
        path=input_path(resolve(entry['path'],root,real))
        assert path.stat().st_size==entry['bytes'] and sha(path)==entry['sha256'],f'Input hash changed: {path}'
        if not entry['path'].startswith('data/'):
            body=path.read_bytes();assert entry['gitBlobSha1']==hashlib.sha1(b'blob '+str(len(body)).encode()+b'\0'+body).hexdigest(),'Recipe git blob hash'
        checked+=1
    digest=hashlib.sha256(json.dumps(doc['inputs'],sort_keys=True).encode()).hexdigest()
    assert index['provenanceSha256']==digest,'Provenance digest'
    polygon=next(x for x in doc['inputs'] if x['role']=='open-paved-polygons')
    assert index['sourceSha256']==polygon['sha256']
    assert {r['feat_code'] for r in json.loads(resolve(polygon['path'],root,real).read_text())} <= {'DAPA41','DASA41'}
    receipt=json.loads(resolve(next(x for x in doc['inputs'] if x['role']=='open-source-receipt')['path'],root,real).read_text())
    assert receipt['dataset']=='ty4r-gcnk' and receipt['bytes']<200_000_000
    for f in receipt['files']:
        assert 'ty4r-gcnk.json?' in f['url'] and 'DAPA41' in f['url'] and 'DASA41' in f['url']
    promotion=json.loads((output/'promotion.json').read_text())
    assert {Path(p['source']).name for p in promotion}==set(index['tiles'])|{'index.json'}
    assert {p.name for p in (output/'paved').iterdir()}==set(index['tiles'])|{'index.json'}
    for p in promotion:
        assert Path(p['source']).stat().st_size==p['bytes'] and sha(p['source'])==p['sha256']
    for name in index['tiles']:
        data=(output/'paved'/name).read_bytes();assert tile_bytes(np.frombuffer(data,np.uint8).reshape(128,128))==data;tiles+=1
    assert doc['tile_bytes']==len(index['tiles'])*16384 and doc['texture_bytes']==409600
print(f'PASS paved open inputs: {len(AREAS)} areas, {checked} input hashes, {tiles} class tiles; prohibited paths and symlink aliases rejected')
