#!/usr/bin/env python3
"""Stage 0, step 1: fetch vector data for the north loop into data/raw/vectors/.

Sources
- Nova Scotia map services (nsgiwa.novascotia.ca): topographic database (roads,
  water, buildings, utilities, land cover), forest inventory, civic address points.
- OpenStreetMap through the Overpass API (ODbL).

Every feature layer that intersects the box is saved as GeoJSON in WGS84.
Requests are sequential and paged, with a pause, to keep load on the services low.
Civic address points keep only the street name and position: no civic numbers.
"""
import argparse
import json
import os
import pathlib
import sys
import time
import urllib.parse
import urllib.request

from areas import current

AREA = current()

BOX = AREA.fetch_box  # lon min, lat min, lon max, lat max
ROOT = pathlib.Path(os.path.abspath(__file__)).parent.parent
OUT = AREA.raw / "vectors"
NS = "https://nsgiwa.novascotia.ca/arcgis/rest/services"
UA = "mabou-terrain-bake/0.1"

# service -> None (all feature layers) or a dict with options
NS_SERVICES = {
    "BASE/BASE_NSTDB_10k_Roads_WM84": {},
    "BASE/BASE_NSTDB_10k_Water_WM84": {},
    "BASE/BASE_NSTDB_10k_Buildings_WM84": {},
    "BASE/BASE_NSTDB_10k_Utilities_WM84": {},
    "BASE/BASE_NSTDB_10k_Land_Cover_WM84": {},
    "BASE/BASE_NSTDB_10k_Structures_WM84": {},
    "BASE/BASE_NSTDB_10k_Designated_Areas_WM84": {"layers": [1]},
    "FOR/FOR_Forest_WM84": {"layers": [1]},  # leading species
    "BASE/BASE_NS_CivicAddress_File_WM84": {"fields": "STRNAME,STRSUFFIX"},
}

OVERPASS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]


def get(url, data=None, timeout=120):
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001 - retry any network error
            print(f"   retry {attempt + 1}: {e}", file=sys.stderr)
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"failed: {url[:120]}")


def fetch_layer(service, layer_id, fields="*"):
    feats, offset = [], 0
    while True:
        q = urllib.parse.urlencode({
            "geometry": ",".join(map(str, BOX)), "geometryType": "esriGeometryEnvelope",
            "inSR": 4326, "outSR": 4326, "spatialRel": "esriSpatialRelIntersects",
            "outFields": fields, "f": "geojson", "resultOffset": offset,
            "resultRecordCount": 1000, "orderByFields": "OBJECTID",
        })
        d = json.loads(get(f"{NS}/{service}/MapServer/{layer_id}/query?{q}"))
        if "error" in d:
            raise RuntimeError(d["error"])
        page = d.get("features", [])
        feats += page
        if len(page) < 1000 and not d.get("exceededTransferLimit"):
            break
        offset += len(page)
        time.sleep(1)
    return {"type": "FeatureCollection", "features": feats}


def fetch_ns():
    for service, opt in NS_SERVICES.items():
        meta = json.loads(get(f"{NS}/{service}/MapServer?f=json"))
        name = service.split("/")[1]
        for lyr in meta["layers"]:
            if lyr.get("subLayerIds") or (opt.get("layers") and lyr["id"] not in opt["layers"]):
                continue
            if "allout" in lyr["name"].lower():  # "Callouts" are label layers
                continue
            slug = "".join(c if c.isalnum() else "_" for c in lyr["name"]).strip("_").lower()
            path = OUT / f"{name}__{lyr['id']:02d}_{slug}.geojson"
            if path.exists():
                continue
            try:
                fc = fetch_layer(service, lyr["id"], opt.get("fields", "*"))
            except Exception as e:  # noqa: BLE001 - one bad layer must not stop the run
                print(f"SKIP {path.name}: {e}")
                continue
            if 'CivicAddress' in service:
                for feature in fc['features']:
                    feature.pop('id', None)  # ArcGIS record ids are unnecessary too.
                    feature['properties'] = {k: v for k, v in feature['properties'].items()
                                             if k in ('STRNAME', 'STRSUFFIX')}
            path.write_text(json.dumps(fc))
            print(f"{len(fc['features']):6d}  {path.name}")
            time.sleep(1)


def fetch_osm():
    path = OUT / "osm.json"
    if path.exists():
        return
    s, w, n, e = BOX[1], BOX[0], BOX[3], BOX[2]
    bbox = f"({s},{w},{n},{e})"
    query = (
        "[out:json][timeout:170];("
        f'way["highway"]{bbox};way["building"]{bbox};way["natural"]{bbox};'
        f'way["waterway"]{bbox};way["landuse"]{bbox};way["power"]{bbox};'
        f'way["barrier"]{bbox};way["man_made"]{bbox};way["bridge"]{bbox};'
        f'node["power"]{bbox};node["amenity"]{bbox};node["man_made"]{bbox};'
        f'relation["natural"]{bbox};relation["waterway"]{bbox};'
        ");out tags geom;"
    )
    body = urllib.parse.urlencode({"data": query}).encode()
    for host in OVERPASS:
        try:
            raw = get(host, body, timeout=200)
            d = json.loads(raw)
            path.write_bytes(raw)
            print(f"{len(d['elements']):6d}  osm.json")
            return
        except Exception as e:  # noqa: BLE001
            print(f"overpass {host}: {e}", file=sys.stderr)
    print("SKIP osm.json: no Overpass host answered")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    if args.dry_run:
        print(json.dumps(dict(area=AREA.id, lonLatWindow=BOX, pixels=0,
            estimatedDownloadBytes=50_000_000, note='Conservative vector reserve; exact size depends on service features',
            output=str(OUT))))
        sys.exit(0)
    OUT.mkdir(parents=True, exist_ok=True)
    fetch_ns()
    fetch_osm()
