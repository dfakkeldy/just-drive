"""Open designated pavement only. EPSG:2961, 2 m cells, 256 m class tiles.

No inference from imagery, intensity, generic land use or OSM. Road, building
and water inputs only subtract from explicitly mapped pavement.
"""
import hashlib
import json
import math
from pathlib import Path
import numpy as np
from osgeo import gdal, ogr, osr
from shapely.geometry import GeometryCollection, LineString, box, mapping, shape
from shapely.ops import transform, unary_union
from shapely.strtree import STRtree
from paved_aprons import make_aprons
import hand_sites
from paved_heights import filter_lots
from paved_provenance import validate, resolve
RULES=json.loads(Path(__file__).with_name("paved-rules.json").read_text())

gdal.UseExceptions()
RES, TILE, SIDE = 2, 256, 128
CODES = ('DAPA41', 'DASA41')
DATASET = 'ty4r-gcnk'
LICENCE = 'https://support.novascotia.ca/services/open-data-portal-licence'
CREDIT = 'Contains information licensed under the Open Government Licence – Nova Scotia'
# Beside a railroad's ribbon a lot that meets the road keeps this much more open: the track's worn ballast edge.
RAIL_EDGE_M = 1.1


def input_path(path):
    path = Path(path).absolute()
    for candidate in (path, path.resolve()):
        text = str(candidate).lower()
        if 'intensity' in text or '/data/work/threads/paved/' in text or '/data/work/bakes/paved-layer' in text or candidate.name == 'osm.json':
            raise ValueError('Forbidden paved input: '+str(candidate))
    return path


def sha(path):
    h = hashlib.sha256()
    with input_path(path).open('rb') as f:
        for chunk in iter(lambda: f.read(1024*1024), b''): h.update(chunk)
    return h.hexdigest()


def projection(source=4326, target=2961):
    src, dst = osr.SpatialReference(), osr.SpatialReference()
    src.ImportFromEPSG(source); dst.ImportFromEPSG(target)
    for s in (src, dst): s.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    tr = osr.CoordinateTransformation(src, dst)
    def xy(x, y, z=None):
        if hasattr(x, '__iter__'):
            pts = tr.TransformPoints(list(zip(x, y)))
            return [p[0] for p in pts], [p[1] for p in pts]
        return tr.TransformPoint(x, y)[:2]
    return xy


class Shapes:
    def __init__(self, geometries):
        self.geoms = [g for g in geometries if not g.is_empty]
        self.tree = STRtree(self.geoms)

    def grid(self, bounds):
        w, h = round((bounds[2]-bounds[0])/RES), round((bounds[3]-bounds[1])/RES)
        mem = gdal.GetDriverByName('MEM').Create('', w, h, 1, gdal.GDT_Byte)
        mem.SetGeoTransform((bounds[0], RES, 0, bounds[3], 0, -RES))
        sr = osr.SpatialReference(); sr.ImportFromEPSG(2961); mem.SetProjection(sr.ExportToWkt())
        vec = ogr.GetDriverByName('Memory').CreateDataSource('')
        layer = vec.CreateLayer('mask', sr)
        for index in self.tree.query(box(*bounds)):
            f = ogr.Feature(layer.GetLayerDefn())
            f.SetGeometry(ogr.CreateGeometryFromJson(json.dumps(mapping(self.geoms[int(index)]))))
            layer.CreateFeature(f)
        if layer.GetFeatureCount(): gdal.RasterizeLayer(mem, [1], layer, burn_values=[1])
        return mem.ReadAsArray().astype(bool)


def tile_bounds(name, origin):
    i, j = map(int, Path(name).stem.split('_')); x, y = origin
    return x+i*TILE, y-(j+1)*TILE, x+(i+1)*TILE, y-j*TILE


CLASSES = {'0': 'unknown', '1': 'hard paved', '2': 'gravel lot'}


def tile_bytes(classes):
    a = np.asarray(classes)
    if a.shape != (SIDE, SIDE) or a.dtype != np.uint8 or not np.isin(a, [0, 1, 2]).all():
        raise ValueError('Paved tile must be exactly 128x128 uint8 classes 0/1/2')
    return a.tobytes(order='C')


def cut_lots(lots, buildings, water, roads, sites, edges=None, main_edges=None):
    # Withhold the entire intersecting lot, preserving authored surfaces and margins.
    # A lot marked meetsRoad (an owner correction) loses the same roofs, water and sites, but of the roads only
    # `edges`: the ribbons themselves, not their shoulders (railroads keep RAIL_EDGE_M more).
    # A lot that also covers its tracks (coversTracks, Judique lots delta) loses only `main_edges`, the ribbons of the main roads
    # (kinds 1-2) and the railroad: the tracks and gravel lanes inside it are painted over as the lot.
    hand = unary_union([shape(s['geometry']) for s in sites]).buffer(2)
    kept, meets, covers, omitted = [], [], [], []
    for lot in lots:
        g = shape(lot['geometry'])
        hits = [s['id'] for s in sites if g.intersects(shape(s['geometry']).buffer(2))]
        if g.intersects(hand):
            omitted.append(dict(id=lot['id'], sites=hits, m2=g.area))
        elif lot.get('coversTracks'): covers.append(g)
        elif lot.get('meetsRoad'): meets.append(g)
        else: kept.append(g)
    out = unary_union(kept)
    counts = {'after_hand_sites': out.area}
    out = out.difference(unary_union(buildings).buffer(1))
    counts['after_buildings'] = out.area
    out = out.difference(unary_union(water).buffer(1))
    counts['after_water'] = out.area
    out = out.difference(unary_union(roads))
    counts['after_roads'] = out.area
    if meets:
        if edges is None: raise ValueError('A lot that meets the road needs the road ribbons')
        edge = unary_union(meets).difference(unary_union(buildings).buffer(1)).difference(unary_union(water).buffer(1))
        out = out.union(edge.difference(unary_union(edges)))
        counts['after_meets_road'] = out.area
    if covers:
        if main_edges is None: raise ValueError('A lot that covers its tracks needs the main-road ribbons')
        own = unary_union(covers).difference(unary_union(buildings).buffer(1)).difference(unary_union(water).buffer(1))
        out = out.union(own.difference(unary_union(main_edges)))
        counts['after_covers_tracks'] = out.area
    return out, omitted, counts


class Corrections(tuple):
    """(lots, cuts, road_edits) as before, plus .gravel (owner gravel lot polygons) and .stalls (painted rows)."""
    def __new__(cls, lots, cuts, road_edits, gravel=(), stalls=()):
        self = super().__new__(cls, (lots, cuts, road_edits)); self.gravel, self.stalls = list(gravel), list(stalls); return self


def _stall_row(f):
    """A row of painted stalls: a two-point front (aisle) line; stalls reach `depth` m to its LEFT, a line every
    `spacing` m from the first point. The length must hold whole stalls (it is the last line's position)."""
    pts = f['geometry']['coordinates']
    depth, spacing = float(f['depth']), float(f['spacing'])
    if len(pts) != 2 or not 3 <= depth <= 7 or not 2.2 <= spacing <= 3.5: raise ValueError('Correction stalls')
    (e0, n0), (e1, n1) = pts
    length = math.hypot(e1-e0, n1-n0)
    count = round(length/spacing)
    if count < 1 or abs(count*spacing-length) > 0.05: raise ValueError('Correction stalls: length is not whole stalls')
    return [round(float(v), 2) for v in (e0, n0, e1, n1, depth, spacing)]


def stall_area(row):
    """The painted rectangle of a stall row, for the check that it lies on its asphalt lot."""
    e0, n0, e1, n1, depth, _ = row
    length = math.hypot(e1-e0, n1-n0); le, ln = -(n1-n0)/length*depth, (e1-e0)/length*depth
    from shapely.geometry import Polygon
    return Polygon([(e0, n0), (e1, n1), (e1+le, n1+ln), (e0+le, n0+ln)])


def lot_layers(lots, gravel, buildings, water, paved_cuts, ribbons, roads, edges, main_edges, sites):
    """Asphalt lots (mapped and owner) and owner gravel lots through the same cuts. Owner gravel cuts asphalt
    (`paved_cuts`); road-correction ribbons cut both. Returns (asphalt, gravel, omitted, counts)."""
    lot_out, omitted, counts = cut_lots(lots, buildings, water+paved_cuts, roads, sites, edges, main_edges)
    gravel_out = GeometryCollection()
    if gravel:
        gravel_out, gravel_omitted, _ = cut_lots(gravel, buildings, water+ribbons, roads, sites, edges, main_edges)
        omitted = omitted+gravel_omitted
    return lot_out, gravel_out, omitted, counts


def classes(asphalt, gravel=None):
    """One class tile from boolean grids: asphalt 1 wins; gravel 2 only where there is no asphalt."""
    a = np.asarray(asphalt).astype(np.uint8)
    if gravel is not None: a[(a == 0) & np.asarray(gravel, bool)] = 2
    return a


def check_stalls(stalls, asphalt):
    """Paint only on its own asphalt: a stall row with more than a tenth off the lot is an error in the owner's file."""
    for s in stalls:
        painted = stall_area(s['row'])
        if painted.difference(asphalt).area > 0.1*painted.area: raise ValueError('Correction stalls off their asphalt: '+s['id'])


def _corrections(path, area):
    if path is None or not path.exists(): return Corrections([], [], [])
    doc = json.loads(input_path(path).read_text())
    if doc.get('version') != 1 or doc.get('epsg') != 2961: raise ValueError('Correction version/EPSG')
    lots, cuts, road_edits, gravel, stalls, ids = [], [], [], [], [], set()
    for f in doc['features']:
        if f['id'] in ids: raise ValueError('Duplicate correction id')
        ids.add(f['id'])
        if f.get('enabled',True) is False: continue
        if f['area'] != area: continue
        if not f.get('source') or not f.get('date'): raise ValueError('Correction needs source/date')
        g = shape(f['geometry'])
        if not g.is_valid or g.is_empty: raise ValueError('Invalid correction geometry')
        if f['kind'] == 'lot' and g.geom_type in ('Polygon', 'MultiPolygon'):
            for flag in ('meetsRoad', 'coversTracks'):
                if type(f.get(flag, False)) is not bool: raise ValueError('Correction '+flag)
            if f.get('coversTracks') and not f.get('meetsRoad'): raise ValueError('Correction coversTracks: only a lot that meets the road')
            own = dict(id=f['id'], geometry=mapping(g), **{k: True for k in ('meetsRoad', 'coversTracks') if f.get(k)})
            if f['surface'] == 'paved': lots.append(dict(own, code='correction'))
            # A gravel lot is its own class (2): it cuts asphalt away and is painted as packed gravel.
            elif f['surface'] == 'gravel': cuts.append(g); gravel.append(dict(own, code='correction-gravel'))
            else: raise ValueError('Correction surface')
        elif f['kind'] == 'stalls' and g.geom_type == 'LineString':
            if 'meetsRoad' in f or 'coversTracks' in f: raise ValueError('Only a lot meets the road')
            if f['surface'] != 'paved': raise ValueError('Correction stalls: paint only on asphalt')
            stalls.append(dict(id=f['id'], row=_stall_row(f)))
        elif f['kind'] == 'road' and g.geom_type == 'LineString':
            if 'meetsRoad' in f or 'coversTracks' in f: raise ValueError('Only a lot meets the road')
            if f['surface'] not in ('paved', 'gravel') or not 0 < f['width'] <= 50: raise ValueError('Correction road')
            # Roads have their own paint. Export observations for the road bake and
            # keep their entire ribbon out of the lot layer for either material.
            road_edits.append(f); cuts.append(g.buffer(f['width']/2+2))
        else: raise ValueError('Correction kind/geometry')
    return Corrections(lots, cuts, road_edits, gravel, stalls)


def corrections(path,area):
    try:return _corrections(path,area)
    except (KeyError,TypeError) as e:raise ValueError('Malformed correction: '+str(e)) from e


def bake(root, source, output, area, correction=None):
    root, source, output = map(Path, (root, source, output))
    output = output.resolve()
    repo = Path(__file__).absolute().parents[1]
    if not any(output.is_relative_to((base/'data/work').resolve()) for base in (root,repo)): raise ValueError('Output must be under data/work')
    if output.exists() and any(output.iterdir()): raise RuntimeError('Output must be empty')
    baked = root/('data/baked/terrain' if area.id == 'mabou' else f'data/baked/areas/{area.id}')
    raw = root/('data/raw' if area.id == 'mabou' else f'data/raw/areas/{area.id}')
    repo = Path(__file__).absolute().parents[1]
    inputs = []
    seen_inputs=set()
    def record(path, role):
        path = input_path(path)
        base = root if path.is_relative_to(root.absolute()) else repo
        relative = path.relative_to(base).as_posix()
        validate(relative,role,'0'*64)
        resolve(relative,repo,root)
        key=(relative,role)
        if key not in seen_inputs:
            value=sha(path);validate(relative,role,value)
            entry=dict(path=relative,role=role,bytes=path.stat().st_size,sha256=value)
            if not relative.startswith('data/'):
                # Git's content-addressed blob ID, also for a not-yet-committed recipe.
                body=path.read_bytes();entry['gitBlobSha1']=hashlib.sha1(b'blob '+str(len(body)).encode()+b'\0'+body).hexdigest()
            inputs.append(entry);seen_inputs.add(key)
        return path
    def read(path, role): return json.loads(record(path, role).read_text())
    manifest = read(baked/'manifest.json', 'terrain-lattice')
    if tuple(manifest['mid']) != area.mid or tuple(manifest['origin']) != area.origin: raise ValueError('Manifest lattice differs')
    fetch = read(source/'fetch.json', 'open-source-receipt')
    docpath = source/f'{area.id}.json'
    receipt = next(f for f in fetch['files'] if f['name'] == docpath.name)
    if sha(docpath) != receipt['sha256']: raise ValueError('Source receipt hash mismatch')
    if fetch.get('dataset') != DATASET: raise ValueError('Unexpected dataset')
    if sha(source/'metadata.json') != fetch['metadataSha256']: raise ValueError('Metadata hash mismatch')
    rows = read(docpath, 'open-paved-polygons')
    xy, clip = projection(), box(*area.mid)
    lots = []
    for i, row in enumerate(rows):
        if row['feat_code'] not in CODES: raise ValueError('Unexpected designation')
        g = transform(xy, shape(row['the_geom'])).intersection(clip)
        if g.area: lots.append(dict(id=f'{area.id}-{i}', code=row['feat_code'], geometry=mapping(g)))
    research_m2 = sum(shape(f['geometry']).area for f in lots)
    source_count = len(lots)
    buildings_doc = read(baked/manifest['buildings']['file'], 'building-exclusion')
    buildings = [shape({'type':'Polygon', 'coordinates':[b['footprint']+[b['footprint'][0]]]}) for b in buildings_doc['buildings'] if b.get('footprint')]
    lots,lot_eligibility=filter_lots(lots,raw,record,Shapes,RULES,buildings)
    filtered_source_m2=sum(shape(f['geometry']).area for f in lots)
    if correction is not None and correction.exists(): record(correction, 'owner-corrections')
    fixes = corrections(correction, area.id)
    added, extra_cuts, road_edits = fixes
    for f in added+fixes.gravel: f['geometry'] = mapping(shape(f['geometry']).intersection(clip))
    lots.extend(added)
    water = []
    water_paths = sorted((raw/'vectors').glob('*Water*wet_features.geojson'))
    if not water_paths: raise ValueError('Missing water exclusions')
    for path in water_paths:
        for f in read(path, 'water-exclusion')['features']:
            if (f.get('geometry') or {}).get('type') in ('Polygon','MultiPolygon'):
                water.append(transform(xy, shape(f['geometry'])))
    roads_doc = read(baked/'roads.json', 'road-exclusion')
    roads = [LineString(r['pts']).buffer(r['halfWidth']+(6 if r.get('name') == 'Railroad' else 1.9 if r['kind'] <= 2 else 1.1))
             for r in roads_doc['roads'] if len(r['pts']) > 1]
    driveways = []
    for path in sorted((raw/'vectors').glob('*Roads*08_roads.geojson')):
        for f in read(path, 'driveway-source')['features']:
            if f['properties'].get('FEAT_CODE') != 'RRRDDR50': continue
            g = transform(xy,shape(f['geometry']))
            for line in ([g] if g.geom_type == 'LineString' else getattr(g,'geoms',[])):
                if line.geom_type == 'LineString' and line.length >= 3: driveways.append(dict(line=line,halfWidth=1.5))
    apron_features, apron_audit = make_aprons(roads_doc['roads'],driveways)
    record(Path(__file__).with_name('paved-rules.json'),'parameters')
    for name in ('manifest','roads','buildings'):record(root/f'data/baked/terrain/{name}.json','hand-site-catalog')
    # One shared reservation API for all independent ground-class builders.
    for p in hand_sites.source_files(root): record(p, 'hand-site-recipe')
    for p in hand_sites.catalog_inputs(root): record(p, 'hand-site-catalog')
    record(source/'metadata.json', 'open-source-metadata')
    sites = hand_sites.records(root)
    # A lot that meets the road (owner corrections with meetsRoad) keeps everything outside the ribbons. The shader
    # drops the road's gravel shoulder under a paved lot, so the lot runs to the road edge with no gravel strip.
    edges = [LineString(r['pts']).buffer(r['halfWidth']+(RAIL_EDGE_M if r.get('name') == 'Railroad' else 0))
             for r in roads_doc['roads'] if len(r['pts']) > 1]
    # A lot that also covers its tracks (Judique lots delta) loses only the main roads' and the railroad's ribbons.
    main_edges = [LineString(r['pts']).buffer(r['halfWidth']+(RAIL_EDGE_M if r.get('name') == 'Railroad' else 0))
                  for r in roads_doc['roads'] if (r['kind'] <= 2 or r.get('name') == 'Railroad') and len(r['pts']) > 1]
    ribbons = [LineString(f['geometry']['coordinates']).buffer(f['width']/2+2) for f in road_edits]
    lot_out, gravel_out, omitted, counts = lot_layers(lots, fixes.gravel, buildings, water, extra_cuts, ribbons, roads, edges, main_edges, sites)
    # Only a mouth may cover a gravel/driveway surface. Main-road paint stays authoritative.
    paved_cores = [LineString(r['pts']).buffer(r['halfWidth']) for r in roads_doc['roads'] if r['kind']<=2 and len(r['pts'])>1]
    apron_out, apron_omitted, apron_counts = cut_lots(apron_features,buildings,water+extra_cuts,paved_cores,sites)
    apron_out = apron_out.intersection(clip)
    out = unary_union([lot_out,apron_out])
    gravel_out = gravel_out.difference(out).intersection(clip)   # asphalt wins where both are mapped
    check_stalls(fixes.stalls, lot_out)
    everything = unary_union([out, gravel_out])
    raster = Shapes([out]); lot_raster = Shapes([lot_out]); gravel_raster = Shapes([gravel_out])
    junction_out = apron_out.intersection(unary_union([shape(f['geometry']) for f in apron_features if f['code']=='junction']))
    junction_raster = Shapes([junction_out])
    output.mkdir(parents=True)
    paved = output/'paved'; paved.mkdir()
    names, trees, cells, lot_cells, junction_cells, gravel_cells = [], [], 0, 0, 0, 0
    minx,miny,maxx,maxy = everything.bounds if not everything.is_empty else (0,0,0,0)
    x0,y0 = area.origin
    for j in range(math.floor((y0-maxy)/TILE), math.ceil((y0-miny)/TILE)):
        for i in range(math.floor((minx-x0)/TILE), math.ceil((maxx-x0)/TILE)):
            name = f'{i}_{j}.r8'; bounds = tile_bounds(name, area.origin)
            if not everything.intersects(box(*bounds)): continue
            a = classes(raster.grid(bounds), gravel_raster.grid(bounds) if gravel_raster.geoms else None)
            if not a.any(): continue
            (paved/name).write_bytes(tile_bytes(a)); names.append(name); cells += int((a == 1).sum()); gravel_cells += int((a == 2).sum())
            lot_mask = lot_raster.grid(bounds); lot_cells += int(lot_mask.sum())
            junction_cells += int((junction_raster.grid(bounds)&~lot_mask).sum())
            key = f'{i}_{j}'
            if key in manifest.get('trees', {}).get('tiles', []):
                p = record(baked/f'8/{key}.t.bin', 'baked-tree-audit')
                records = np.frombuffer(p.read_bytes(), dtype=np.dtype([('x','<u2'),('z','<u2'),('rest','u1',(4,))]))
                for k, t in enumerate(records):
                    col, row = int(t['x'])//512, int(t['z'])//512
                    if a[max(0,row-1):row+2,max(0,col-1):col+2].any():
                        trees.append(dict(tile=key, record=k, cell=[col,row], paved=bool(a[row,col])))
    for p in [Path(__file__), Path(__file__).with_name('paved_fetch.py'), Path(__file__).with_name('paved_aprons.py'), Path(__file__).with_name('paved_provenance.py'), Path(__file__).with_name('paved_heights.py'), Path(__file__).with_name('paved-denied-sha256.json'), Path(__file__).with_name('32_bake_paved.py'), Path(__file__).with_name('areas.py')]: record(p, 'recipe')
    index = dict(version=1, source='nstdb-designated-open-v1', area=area.id, epsg=2961, origin=list(area.origin),
                 tileMetres=TILE, resolution=RES, side=SIDE, classes=CLASSES, tiles=names,
                 dataset=DATASET, fetchedAt=fetch['fetchedAt'], rowsUpdatedAt=fetch['rowsUpdatedAt'], sourceSha256=receipt['sha256'],
                 licence=LICENCE, credit=CREDIT, provenanceSha256=hashlib.sha256(json.dumps(inputs,sort_keys=True).encode()).hexdigest())
    if fixes.stalls: index['stalls'] = [s['row'] for s in fixes.stalls]
    (paved/'index.json').write_text(json.dumps(index, indent=2)+'\n')
    promotion = [dict(source=str(p), destination=str(baked/'paved'/p.name), bytes=p.stat().st_size, sha256=sha(p)) for p in sorted(paved.iterdir())]
    (output/'promotion.json').write_text(json.dumps(promotion, indent=2)+'\n')
    (output/'aprons.geojson').write_text(json.dumps(dict(type='FeatureCollection',epsg=2961,features=[dict(type='Feature',properties={k:v for k,v in f.items() if k!='geometry'},geometry=f['geometry']) for f in apron_features]))+'\n')
    (output/'painted.geojson').write_text(json.dumps(dict(type='Feature',geometry=mapping(out),properties=dict(epsg=2961)))+'\n')
    (output/'lots.geojson').write_text(json.dumps(dict(type='FeatureCollection',epsg=2961,features=[dict(type='Feature',properties={k:v for k,v in f.items() if k!='geometry'},geometry=f['geometry']) for f in lots]))+'\n')
    (output/'gravel.geojson').write_text(json.dumps(dict(type='Feature',geometry=mapping(gravel_out),properties=dict(epsg=2961,ids=[f['id'] for f in fixes.gravel])))+'\n')
    (output/'surface-corrections.json').write_text(json.dumps(road_edits,indent=2)+'\n')
    (output/'driveway-road-handoff.json').write_text(json.dumps(dict(version=1,epsg=2961,apply=False,changes=[x['road_change'] for x in apron_audit if 'road_change' in x]),indent=2)+'\n')
    result = dict(area=area.id, dataset=DATASET, fetchedAt=fetch['fetchedAt'], rowsUpdatedAt=fetch['rowsUpdatedAt'], inputs=inputs,
                  source_count=source_count, source_m2=research_m2, filtered_source_m2=filtered_source_m2, lot_eligibility=lot_eligibility, counts_m2=counts, raster_m2=cells*RES*RES, lots_m2=lot_cells*RES*RES, apron_m2=(cells-lot_cells)*RES*RES, junction_m2=junction_cells*RES*RES, driveway_m2=(cells-lot_cells-junction_cells)*RES*RES,
                  apron_counts_m2=apron_counts, apron_omitted=apron_omitted, apron_features=len(apron_features), driveway_audit=apron_audit,
                  omitted_lots=omitted, sites=sites, tree_cuts=trees, tiles=len(names), tile_bytes=len(names)*SIDE*SIDE,
                  index_bytes=(paved/'index.json').stat().st_size, texture_bytes=640*640, cached_tile_bytes_max=25*SIDE*SIDE,
                  corrections_lots=len(added), correction_roads=len(road_edits), gravel_m2=gravel_cells*RES*RES,
                  correction_gravel=len(fixes.gravel), correction_stalls=[s['id'] for s in fixes.stalls])
    (output/'bake.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({k:result[k] for k in ('area','source_count','source_m2','raster_m2','tiles','tile_bytes')}), flush=True)
    return result
