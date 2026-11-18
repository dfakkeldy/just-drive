"""Bounded Socrata polygon fetch. Only two open designated codes."""
import datetime
import json
import urllib.parse
import urllib.request
from pathlib import Path
from shapely.geometry import box
from shapely.ops import transform
from paved import CODES, DATASET, projection, sha, input_path

CAP = 200_000_000


def fetch(directory, areas):
    directory = input_path(directory)
    if directory.exists() and any(directory.iterdir()): raise RuntimeError('Fetch directory must be empty; reuse without --fetch')
    directory.mkdir(parents=True, exist_ok=True)
    used = 0
    def get(url, target):
        nonlocal used
        with urllib.request.urlopen(url, timeout=90) as response, target.open('wb') as out:
            while chunk := response.read(65536):
                used += len(chunk)
                if used > CAP: raise RuntimeError('Open fetch exceeds 200 MB cap')
                out.write(chunk)
    meta = directory/'metadata.json'
    get(f'https://data.novascotia.ca/api/views/{DATASET}.json', meta)
    metadata = json.loads(meta.read_text())
    if metadata.get('licenseId') != 'OGL_NOVA_SCOTIA': raise ValueError('Unexpected dataset licence')
    files = []
    for area in areas:
        envelope = transform(projection(2961,4326), box(*area.mid).segmentize(256)).envelope.wkt
        where = f"feat_code in ('{CODES[0]}','{CODES[1]}') AND intersects(the_geom, '{envelope}')"
        query = urllib.parse.urlencode({'$where':where,'$limit':15000,'$order':':id','$select':'the_geom,feat_code'})
        url = f'https://data.novascotia.ca/resource/{DATASET}.json?{query}'
        path = directory/f'{area.id}.json'
        get(url, path)
        rows = json.loads(path.read_text())
        if len(rows) >= 15000: raise RuntimeError('Query may be truncated')
        files.append(dict(name=path.name,sha256=sha(path),bytes=path.stat().st_size,url=url,bounds=list(area.mid),rows=len(rows)))
    receipt = dict(dataset=DATASET, fetchedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                   rowsUpdatedAt=datetime.datetime.fromtimestamp(metadata['rowsUpdatedAt'],datetime.timezone.utc).isoformat(),
                   metadataSha256=sha(meta), files=files, bytes=used)
    (directory/'fetch.json').write_text(json.dumps(receipt,indent=2)+'\n')
    return receipt
