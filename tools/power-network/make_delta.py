#!/usr/bin/env python3
"""Rehearse step 29 in a NEW folder. Installed land is checked by properties, never pinned output hashes."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import types

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'pipeline'))
# The church model's origin (web/src/church-site.ts); only for the "no pole near the church" property.
CHURCH = (630835.5, 5080641.6)
AREAS = [('mabou', 'terrain'), ('cansocauseway', 'areas/cansocauseway'), ('judique', 'areas/judique'),
         ('pointtupper', 'areas/pointtupper'), ('porthood', 'areas/porthood'), ('westbay', 'areas/westbay')]


def encoded(obj):
    return (json.dumps(obj, separators=(',', ':'), allow_nan=False) + '\n').encode()


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fresh(path):
    path = path.resolve()
    if path.exists() or path.is_relative_to((ROOT / 'data').resolve()):
        raise ValueError('Output must be NEW and outside data/')
    return path


def capture(source, output):
    """Small APFS clones, only when a before/after comparison needs a retained baseline."""
    source, output = source.resolve(), fresh(output)
    if source.is_relative_to(output) or output.is_relative_to(source):
        raise ValueError('Baseline must be separate from source')
    output.mkdir(parents=True)
    for _, relative in AREAS:
        target = output / relative / 'props.json'
        target.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(['cp', '-c', str(source / relative / 'props.json'), str(target)], check=True)
    print('Captured props baseline with APFS clones: ' + str(output))


def check_properties(source, overlay=None, baseline=None, require_after=False):
    try:
        import osgeo
    except ImportError:
        sys.modules.setdefault('osgeo', types.SimpleNamespace(gdal=types.SimpleNamespace(UseExceptions=lambda: None)))
    rows = []
    for area, relative in AREAS:
        os.environ['MMM_AREA'] = area
        sys.modules.pop('areas', None)
        sys.modules.pop('road_ground', None)
        p = load(ROOT / 'pipeline/29_bake_props.py', 'power_properties_' + area)
        folder = source / relative
        roads = p.props_view(json.loads((folder / 'roads.json').read_text())['roads'], p.AREA.props_driveways)
        net = p.Network(roads)
        buildings = json.loads((folder / 'buildings.json').read_text())['buildings']
        styles = json.loads((folder / 'building-styles.json').read_text())['styles']
        target = (overlay or source) / relative
        props = json.loads((target / 'props.json').read_text())
        manifest = json.loads((target / 'manifest.json').read_text())
        if overlay:
            original_manifest = json.loads((folder / 'manifest.json').read_text())
            assert {k:v for k,v in manifest.items() if k != 'props'} == {k:v for k,v in original_manifest.items() if k != 'props'}, area + ': unrelated manifest keys changed'
        assert manifest['props']['poles'] == len(props['poles'])
        assert manifest['props']['mailboxes'] == len(props['mailboxes'])
        public = lambda data: {(q['x'], q['y']) for q in data['poles'] if p.public(net.roads[q['road']])}
        before = json.loads(((baseline or source) / relative / 'props.json').read_text()) if baseline or overlay else None
        if before is not None:
            # The one exception: AREA.public_pole_corrections (README "The filmed exception"). Equal on every other road.
            corrected = dict(poles=p.correct_public_poles(net, before['poles'], p.AREA.public_pole_corrections))
            assert public(corrected) == public(props), area + ': public pole positions changed'
            for key in ('mailboxes', 'communityBoxes'):
                assert before[key] == props[key], area + ': ' + key + ' changed'
        row = dict(area=area, publicPoles=len(public(props)), poles=len(props['poles']), preservationCompared=before is not None)
        if 'serviceDrops' not in props:
            assert not require_after, area + ': step 29 power output not installed'
            row['state'] = 'before'
            rows.append(row)
            continue
        row.update(state='after', serviceDrops=len(props['serviceDrops']))
        assert manifest['props']['serviceDrops'] == len(props['serviceDrops'])
        expected = p.service_drops(net, props['poles'], buildings, area, styles)
        assert props['serviceDrops'] == expected, area + ': drops do not match current poles, buildings, roof styles or side/reach rules'
        assert not any(d['building'] == -1 for d in props['serviceDrops']), area + ': the church has no power'
        assert p.correct_public_poles(net, props['poles'], p.AREA.public_pole_corrections) == props['poles'], \
            area + ': a pole stands where public_pole_corrections removes it or on the wrong side'
        unpowered = p.unpowered_roads(net, p.AREA.unpowered_tracks)
        bounds = {}
        for pole in props['poles']:
            road = net.roads[pole['road']]
            if not p.public(road):
                assert road['kind'] == 4 and (road.get('name') or '').strip() and not road.get('propsDriveway') and not road['bridge'], area + ': pole on track/driveway'
                assert road['id'] not in unpowered, area + ': pole on unpowered track ' + road['name']
                if road['id'] not in bounds:
                    local = p.Network([road])
                    hits = [h['s'] for b in buildings if (h := local.nearest((b['x'], b['y']), 75))]
                    assert hits, area + ': unbuilt track has poles'
                    joined = [net.nearest(pt, 12, p.public) is not None for pt in (road['pts'][0], road['pts'][-1])]
                    bounds[road['id']] = (local, 0 if joined[0] else min(hits), road['cum'][-1] if joined[1] else max(hits))
                local, lo, hi = bounds[road['id']]
                at = local.nearest((pole['x'], pole['y']), 20)
                assert at and lo - .02 <= at['s'] <= hi + .02, area + ': pole beyond its built section'
        if area == 'judique':
            river = next(r for r in roads if r['name'] == 'River Denys Mountain Road' and r['kind'] == 4)
            local = p.Network([river])
            last = max(h['s'] for b in buildings if (h := local.nearest((b['x'], b['y']), 75)))
            run = [q for q in props['poles'] if q['road'] == river['id']]
            end = max(local.nearest((q['x'], q['y']), 20)['s'] for q in run)
            assert len(run) == 39 and abs(end - last) < .02, 'River Denys must end its 39-pole run at the last house'
            # The dash cam (21 Nov 2026) saw no line on River Denys Road's kind-4 piece and none at the church.
            assert len(unpowered) == 1 and net.roads[next(iter(unpowered))]['name'] == 'River Denys Road', \
                'Judique lists the kind-4 piece of River Denys Road to the church as unpowered'
            assert not any(q['road'] in unpowered for q in props['poles']), 'River Denys Road kind-4 piece has no poles'
            # The same drive saw the public piece's line end at a bend about 2.78 km along (README "The filmed exception").
            assert len(p.AREA.public_pole_corrections) == 1, 'Judique corrects River Denys Road only'
            road98, _ = p.corrected_road(net, p.AREA.public_pole_corrections[0])
            assert road98['name'] == 'River Denys Road' and road98['kind'] == 3
            along = p.Network([road98])
            filmed = sorted(along.nearest((q['x'], q['y']), 20)['s'] for q in props['poles'] if q['road'] == road98['id'])
            assert filmed and 2790 <= filmed[-1] < 2840, 'River Denys Road public poles end at the last house with power'
            nearest = min(p.distance((q['x'], q['y']), CHURCH) for q in props['poles'])
            assert nearest > 500, 'no pole stands near the church'
            row.update(riverDenysRoadPublicPoles=len(filmed), riverDenysRoadLastPoleS=round(filmed[-1], 1), riverDenysPoles=len(run), lastBuildingS=round(last, 3), lastPoleS=round(end, 3),
                       riverDenysRoadTrackPoles=0, nearestPoleToChurchMetres=round(nearest, 1))
        rows.append(row)
    print(json.dumps(rows, indent=2))
    print('PASS power properties' + ('; public positions and mailbox arrays compared' if baseline or overlay else '; supply --baseline for preservation comparison'))
    return rows


def make(source, output):
    source, output = source.resolve(), fresh(output)
    if output.is_relative_to(source) or source.is_relative_to(output):
        raise ValueError('Output must be separate from source')
    output.mkdir(parents=True)
    oracle = load(Path(__file__).with_name('poles-before.py'), 'poles_before')
    report = dict(proof=[])
    for area, relative in AREAS:
        os.environ['MMM_AREA'] = area
        for name in ('areas', 'road_ground'):
            sys.modules.pop(name, None)
        p = load(ROOT / 'pipeline/29_bake_props.py', 'props1210_' + area)
        p.OUT = source / relative
        initial = {name: (p.OUT / name).read_bytes() for name in
                   ('roads.json', 'buildings.json', 'building-styles.json', 'props.json', 'manifest.json')}
        original = p.place_poles
        def verified(roads, net, buildings, safe, village, public_poles=None):
            old = oracle.place_poles(roads, net, safe, village, p.SEED, p.public, p.shifted, p.heading, p.distance)
            regenerated = original(roads, net, buildings, safe, village)
            assert encoded(old) == encoded([q for q in regenerated if p.public(net.roads[q['road']])]), area + ': frozen public-pole bytes changed'
            result = original(roads, net, buildings, safe, village, public_poles)
            report['proof'].append(dict(area=area, frozenPublicByteEqual=True, preservedPublicPoles=len(public_poles)))
            return result
        p.place_poles = verified
        p.main(output / relative, output / 'reports' / area, power_only=True)
        assert all((p.OUT / name).read_bytes() == raw for name, raw in initial.items()), 'Source changed during generation'
    report['properties'] = check_properties(source, overlay=output, require_after=True)
    (output / 'power-proof.json').write_bytes(encoded(report))
    print('PASS step29-only delta: 12 replacement files; no committed output byte pins')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path, nargs='?')
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--after', action='store_true')
    parser.add_argument('--baseline', type=Path)
    parser.add_argument('--overlay', type=Path)
    parser.add_argument('--capture', action='store_true')
    args = parser.parse_args()
    if args.capture and args.output:
        capture(args.source, args.output)
    elif args.check:
        check_properties(args.source, args.overlay, args.baseline, args.after)
    elif args.output:
        make(args.source, args.output)
    else:
        parser.error('output or --check is required')
