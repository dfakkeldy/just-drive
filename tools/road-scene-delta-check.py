#!/usr/bin/env python3
"""Input rules and all-before/all-after land receipt. No land writes."""
import ast
import collections
import copy
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import random
import sys

from land_receipt_pins import previous_digest

ROOT = Path(__file__).resolve().parents[1]
# Installed on the MacBook by the main thread on 17 Nov 2026 (55 delta files + the step-29 pins): only 'after' land passes.
EXPECT = 'after'
sys.path.insert(0,str(ROOT/'pipeline'))
from dashcam_corrections import INPUT, correct_roads, hand_buildings, hand_styles, project, attach_guardrails, measured_root_id_limit, nearest


def november18_rules():
    from dashcam_corrections import NOV18, correct_nov18_roads
    harbour = NOV18['harbour']
    mouth, cut = harbour['mouth'], harbour['cut']
    west = [cut[0]-100, cut[1]]
    old = [
        dict(id=51, name=harbour['name'], pts=[mouth, cut, west], kind=3, halfWidth=2.6, bridge=False),
        dict(id=116, name=NOV18['lane'], pts=[[625653,5103495],[626051,5103687]], kind=4, halfWidth=1.5, bridge=False),
    ]
    unchanged = copy.deepcopy(old)
    extended, gravel, lane = after = correct_nov18_roads(old, 'mabou')
    assert old == unchanged and correct_nov18_roads(after, 'mabou') == after
    assert correct_nov18_roads(old, 'judique') == old
    assert extended['pts'] == [mouth, cut] and extended['id'] == 117
    assert (extended['kind'], extended['halfWidth'], extended['pavement']) == (2, 3, 'double-yellow')
    assert gravel['pts'] == [cut, west] and gravel['id'] == 51 and gravel['kind'] == 3
    assert lane == dict(old[1], kind=2, pavement='worn')
    stale = [dict(old[0], pts=[mouth, west]), old[1]]
    try:
        correct_nov18_roads(stale, 'mabou')
    except ValueError:
        pass
    else:
        raise AssertionError('Faraway pavement limit accepted')

    ground = lambda x,y: 53
    buildings = hand_buildings([], 'mabou', ground, old, observations=NOV18)
    assert len(buildings) == 6 and all(b['ground'] == 53 and b['nearRoad'] is None for b in buildings)
    assert buildings == hand_buildings(buildings, 'mabou', ground, old, observations=NOV18)
    styles = hand_styles(dict(styles={}), buildings, observations=NOV18)['styles']
    home, garage, shed = buildings[:3]
    assert home['roof'] == garage['roof'] == 'shed' and shed['x'] < home['x']
    assert home['axisDeg'] == 135 and styles['900007']['front'] == dict(end=False, side=1)
    assert styles['900007']['entrance'] == 'deck' and styles['900007']['steppedShed'] and styles['900007']['windowWall']
    assert styles['900008']['rollUpDoor'] and styles['900008']['doorWindows']
    assert styles['900009']['door'] == '#9d2923'
    assert styles['900010']['solarSide'] == 1 and styles['900010']['roofMaterial'] == 'metal'
    assert styles['900011']['rollUpDoor'] and styles['900011']['door'] == '#eeede6'
    assert styles['900010']['boardAndBatten'] and styles['900011']['boardAndBatten']
    house = buildings[0]
    track = dict(id=33, name=None, kind=4, halfWidth=1.5, bridge=False,
                 pts=[[house['x']-30, house['y']], [house['x']+30, house['y']]])
    try:
        hand_buildings([], 'mabou', ground, [track], observations=NOV18)
    except ValueError:
        pass
    else:
        raise AssertionError('New house on unnamed track accepted')
    november18_driveways()


def november18_driveways():
    from dashcam_corrections import NOV18, DRIVEWAY, nov18_driveways
    assert [d['road'] for d in NOV18['driveways']] == ['Mabou Mines Road', 'Meadow Road']
    road = dict(id=40, name='Public Road', kind=3, halfWidth=2.6, bridge=False, pts=[[0, 0], [0, 400]])
    other = dict(id=41, name=None, kind=4, halfWidth=1.5, bridge=False, pts=[[200, 0], [200, 400]])
    drive = dict(road='Public Road', pieces=[dict(halfWidth=1.5, pts=[[0, 100], [60, 100], [90, 110]]),
                                             dict(halfWidth=3.0, pts=[[90, 110], [100, 110]])])
    seen = dict(driveways=[drive])
    roads = [road, other]
    frozen = copy.deepcopy(roads)
    after = nov18_driveways(roads, 'mabou', seen)
    assert roads == frozen and after[:2] == roads and nov18_driveways(after, 'mabou', seen) == after
    assert nov18_driveways(roads, 'judique', seen) == roads and nov18_driveways(roads, 'mabou', dict()) == roads
    assert [(r['id'], r['name'], r['kind'], r['halfWidth'], r['pavement'], r['driveway']) for r in after[2:]] == [
        (42, None, 4, 1.5, 'gravel', DRIVEWAY), (43, None, 4, 3.0, 'gravel', DRIVEWAY)]
    assert after[2]['pts'] == drive['pieces'][0]['pts'] and not after[2]['bridge'] and not after[2]['washboard']
    # A house beside its own driveway is fine; a track still is not (november18_rules above).
    ground = lambda x, y: 53
    near_drive = dict(NOV18, buildings=[dict(NOV18['buildings'][0], x=80, y=120)])
    assert len(hand_buildings([], 'mabou', ground, after, observations=near_drive)) == 1
    refused = {
        'a mouth off its road': dict(road='Public Road', pieces=[dict(halfWidth=1.5, pts=[[5, 100], [60, 100]])]),
        'a mouth on another road': dict(road='Other Road', pieces=drive['pieces']),
        'pieces that do not join': dict(road='Public Road', pieces=[drive['pieces'][0], dict(halfWidth=3.0, pts=[[91, 110], [100, 110]])]),
        'a line over another road': dict(road='Public Road', pieces=[dict(halfWidth=1.5, pts=[[0, 100], [220, 100]])]),
        'a line along its own road': dict(road='Public Road', pieces=[dict(halfWidth=1.5, pts=[[0, 100], [3, 140]])]),
        'a half width wider than a pad': dict(road='Public Road', pieces=[dict(halfWidth=4.0, pts=[[0, 100], [60, 100]])]),
        'a single point': dict(road='Public Road', pieces=[dict(halfWidth=1.5, pts=[[0, 100]])]),
    }
    for label, bad in refused.items():
        try:
            nov18_driveways(roads, 'mabou', dict(driveways=[bad]))
        except (ValueError, StopIteration):
            continue
        raise AssertionError(label + ' accepted')


def rules():
    november18_rules()
    for area, rules in INPUT['roads'].items():
        roads = []
        for i, rule in enumerate(rules):
            points = [rule['mouth']]
            if 'start' in rule:
                points.append(rule['start'])
            points += [rule['cut'], [rule['cut'][0]-90,rule['cut'][1]-20]]
            roads.append(dict(id=i+1,name=rule['name'],pts=points,kind=3,halfWidth=2.6,bridge=False,washboard=False))
        # Mabou's rail and lower MacKillop input.
        if area == 'mabou':
            roads += [dict(id=10,name='Southwest Ridge Road',pts=[[624360,5100200],[624360,5100000]],kind=2,halfWidth=3,bridge=False),
                      dict(id=11,name='MacKillop Road',pts=[[624300,5097900],[624500,5097900]],kind=3,halfWidth=2.6,bridge=False)]
        frozen = copy.deepcopy(roads)
        after = correct_roads(roads,area)
        assert roads == frozen, 'caller data mutated'
        assert after == correct_roads(after,area), 'not idempotent'
        assert len({r['id'] for r in after}) == len(after)
        for rule in rules:
            source = next(r for r in roads if r['name']==rule['name'])
            pieces = [r for r in after if r['name']==rule['name']]
            assert pieces[0]['pts'][0] == source['pts'][0]
            assert pieces[-1]['pts'][-1] == source['pts'][-1]
            joined = pieces[0]['pts']+sum((p['pts'][1:] for p in pieces[1:]),[])
            assert joined == source['pts'], 'split moved or dropped a vertex'
            selected = next(p for p in pieces if p['pts'][0] == rule.get('start',rule['mouth']))
            assert selected['pts'][-1] == rule['cut']
            for key in ['kind','washboard']:
                if key in rule:
                    assert selected[key] == rule[key]
            assert pieces[-1]['kind'] == 3 and not pieces[-1]['washboard']
            if 'start' in rule:
                saved = rule['start']
                try:
                    rule['start'] = [saved[0],saved[1]+1000]
                    try:correct_roads(frozen,area)
                    except ValueError:pass
                    else:raise AssertionError('distant washboard start accepted')
                finally:rule['start'] = saved
    # A point on the far piece must follow the new ID, including cemetery-2c430310b451.
    from dashcam_corrections import remap_road_references
    original = [dict(id=111,name='Walkers Cove Road',bridge=False,pts=[[0,0],[128,0],[1200,0]])]
    split = [dict(original[0],pts=[[0,0],[128,0]],correction='16nov:Walkers Cove Road'),
             dict(original[0],id=200,pts=[[128,0],[1200,0]],correction='16nov:Walkers Cove Road')]
    fixtures = {
        'cemeteries': {'cemeteries':[dict(id='cemetery-2c430310b451',road=dict(id=111,name='Walkers Cove Road',point=[1143,0],distance=7))]},
        'buildings': {'buildings':[dict(x=1143,y=7,nearRoad=111,roadDist=7)]},
        'streams': {'culverts':[dict(road=111,a=[1143,-4],b=[1143,4])]},
        'props': {'poles':[dict(road=111,x=1143,y=7,n=0)]},
    }
    for kind, value in fixtures.items():
        frozen_value = copy.deepcopy(value)
        revised = remap_road_references(value,kind,split)
        record = next(iter(revised.values()))[0]
        rid = record['road']['id'] if kind=='cemeteries' else record['nearRoad'] if kind=='buildings' else record['road']
        assert rid == 200, (kind,revised)
        expected = copy.deepcopy(next(iter(frozen_value.values()))[0])
        if kind == 'cemeteries': expected['road']['id'] = 200
        else: expected['nearRoad' if kind == 'buildings' else 'road'] = 200
        assert record == expected, 'only road ID may change'
        assert value == frozen_value, 'reference caller mutated'
        assert revised == remap_road_references(revised,kind,split), 'reference remap not idempotent'
    kept = {'buildings':[dict(x=20,y=7,nearRoad=111),dict(x=1143,y=7,nearRoad=999),dict(x=0,y=0,nearRoad=None)]}
    assert remap_road_references(kept,'buildings',split) == kept, 'kept piece, unrelated IDs and absent references stay fixed'
    manifest = dict(buildings={'count':10},buildingStyles={'count':10},props={'count':20})
    changed = copy.deepcopy(manifest);changed['props']['count'] = 40
    assert owned_counts(manifest) == owned_counts(changed), 'unrelated prop bake must remain valid'
    changed['buildings']['count'] += 1
    assert owned_counts(manifest) != owned_counts(changed), 'owned count change must fail'
    source = (ROOT/'pipeline/23_bake_roads.py').read_text()
    assert source.index('roads = correct_roads') < source.index('before = {road') < source.index('road_ground.keep_lines_before')
    assert source.index("road['washboard'] =") < source.index('roads = correct_roads')
    assert source.index('roads = attach_guardrails') > source.index('road_ground.keep_lines_before')
    # Exercise the actual bed-record contract after the split, including a moved washboard road.
    # road_ground needs numpy, so this integration proof is run separately where it is installed.
    assert measured_root_id_limit([dict(id=1,source='polygon'),dict(id=19,buildingId=1,source='polygon'),dict(id=900001,source='hand')]) == 1
    # A final line's station lengths can differ after moving onto the road bed.
    shifted = correct_roads(frozen,area,guardrails=False)
    if area == 'mabou':
        for r in shifted:
            if r['name']=='Southwest Ridge Road':r['pts'][0][1] += 20
        attach_guardrails(shifted,area)
        rail = next(r for r in shifted if r['name']=='Southwest Ridge Road')
        _,s = nearest(shifted,INPUT['guardrail']['point'],INPUT['guardrail']['name'])
        assert abs(rail['guardrailRuns'][0]['start']-(s-30)) < .01
    houses = hand_buildings([], 'mabou', lambda x,y:100)
    assert len(houses)==6 and sum(b['kind']=='house' for b in houses)==2
    assert houses == hand_buildings(houses,'mabou',lambda x,y:100)
    for b in houses:
        assert 624040 <= b['x'] <= 624150 and 5100350 <= b['y'] <= 5100510
        assert b['roof']=='gable' and b['provenance']=='dash cam 12/13/16 Nov, approximate position'
        assert b['ground']==100 and b['eave']<3.1
    # Per-road orientation points both generic house fronts toward the road.
    road = dict(id=111,name='Southwest Ridge Road',bridge=False,pts=[[624200,5100600],[624200,5100300]])
    styles = hand_styles(dict(styles={}),houses,[road])['styles']
    assert all('front' in styles[str(b['id'])] for b in houses if b['kind']=='house')
    assert styles['900001']['wallName']=='cream' and styles['900002']['wallName']=='pale yellow'
    assert styles['900003']['wallName']=='dark red'
    assert hand_buildings([], 'judique',lambda x,y:100)==[]
    spec = importlib.util.spec_from_file_location('styles1199', ROOT/'pipeline/30_bake_building_styles.py')
    stage30 = importlib.util.module_from_spec(spec);spec.loader.exec_module(stage30)
    ordinary = dict(houses[0],id=1,source='polygon',x=624090,y=5100480,nearRoad=111)
    observed = json.loads((ROOT/'pipeline/observed_styles.json').read_text())
    base = stage30.bake([ordinary],[road],observed)
    expanded = stage30.bake([ordinary,*houses],[road],observed)
    assert expanded == hand_styles(copy.deepcopy(base),houses,[road]), 'hand records changed generic styles/neighbour counts'
    assert expanded['neighbours'] == base['neighbours']
    for old in [dict(houses[0],source='polygon'),dict(houses[0],id=7),
                dict(houses[0],id=7,x=houses[0]['x']+24,length=29,width=17,kind='barn',source='polygon')]:
        try:
            hand_buildings([old],'mabou',lambda x,y:100)
        except ValueError:
            pass
        else:
            raise AssertionError('ID collision or overlap accepted')
    # Execute the actual production draw block: unchanged old draws, 3% character props, none on shared frames.
    code = (ROOT/'pipeline/29_bake_props.py').read_text()
    block = code[code.index('                    local = random.Random(SEED + m[\'id\'])'):code.index('                    report.append(dict(building=')]
    block = '\n'.join(line[20:] for line in block.splitlines())
    from collections import Counter
    counts = Counter()
    for grouped in [False,True]:
        for bid in range(10000):
            ns = dict(random=random,SEED=29017,m={'id':bid},mailboxes=[],obj={'x':0,'y':0,'heading':0},grouped=grouped,group_id=1)
            exec(block,ns)
            box = ns['mailboxes'][0]
            rng = random.Random(29017+bid)
            old_style, old_tilt, old_parcel = rng.randrange(6),round(rng.uniform(-4,4),2),rng.randrange(6)==0
            assert (box['tilt'],box['parcelBox']) == (old_tilt,old_parcel)
            if grouped:
                assert box['style']==old_style
            else:
                counts[box['style']]+=1
    assert 90 < counts[6] < 210 and 90 < counts[7] < 210, counts
    print('PASS rule bounds, stable geometry/IDs, idempotence, generic house input, overlap refusals, random mailbox draw',dict(counts))


STEP29 = 'step29 properties'
# The four per-road reference schemas: list key and road-ID field.
REFERENCES = dict(cemeteries=('cemeteries','road.id'), buildings=('buildings','nearRoad'), streams=('culverts','road'), props=('poles','road'))


def canonical_digest(records):
    return dict(count=len(records), sha256=hashlib.sha256(json.dumps(records, separators=(',', ':'), sort_keys=True).encode()).hexdigest())


def step29_properties(props, roads):
    """What step 29 settles for this receipt: public poles (kinds 1-3) and both box arrays. Power poles and
    service drops (#183) are other step-29 output; power-network-land checks them by rule, so no output byte pin."""
    kinds = {r['id']: r['kind'] for r in roads}
    assert all(q['road'] in kinds for q in props['poles']), 'pole on an unknown road'
    return dict(publicPoles=canonical_digest([q for q in props['poles'] if kinds[q['road']] <= 3]),
                mailboxes=canonical_digest(props['mailboxes']), communityBoxes=canonical_digest(props['communityBoxes']))


def power_faults(props, roads):
    """Poles off public roads come only from power (#183): each on a named kind-4 road that is no bridge, and only
    with the file's service drops. power-network-land recomputes each pole and drop; this keeps the receipt honest."""
    by = {r['id']: r for r in roads}
    extra = [q for q in props['poles'] if by[q['road']]['kind'] > 3]
    if 'serviceDrops' not in props:
        return [f'{len(extra)} poles off public roads without service drops'] if extra else []
    found = [f'pole on road {q["road"]} is not on a named kind-4 road' for q in extra
             if by[q['road']]['kind'] != 4 or not (by[q['road']].get('name') or '').strip() or by[q['road']]['bridge']]
    return found + (['power poles with no service drops'] if extra and not props['serviceDrops'] else [])


def step29_state(props, roads, expected):
    """'powered' or 'unpowered' when this props file is step-29 output at the receipt, else None."""
    try:
        if step29_properties(props, roads) != expected or power_faults(props, roads): return None
    except AssertionError:  # a pole on a road this land lacks: mixed or stale
        return None
    return 'powered' if 'serviceDrops' in props else 'unpowered'


def one_power_state(powers):
    # Step 29 bakes every area; one prop file powered and the other not is a mixed install.
    assert len(set(powers.values())) <= 1, f'step-29 prop files differ in power state: {powers}'


def state(actual, entries, step29=()):
    """One complete state: all before, all after the delta, or all after with every step-29 prop file at the receipt."""
    assert entries, 'Empty receipt'
    if all(actual[f['file']]==f['before'] for f in entries): return 'before'
    if all(actual[f['file']]==f['sha256'] for f in entries): return 'after'
    if step29 and all(actual[f['file']]==(STEP29 if f['file'] in step29 else f['sha256']) for f in entries): return 'after'
    raise AssertionError('Land is mixed, stale or unknown; do not install this receipt')


def expectation(mode, expected):
    assert expected in (None,'before','after')
    assert expected is None or mode == expected, f'Expected {expected} land, found {mode}'


def owned_counts(manifest):
    return {key:manifest[key]['count'] for key in ('buildings','buildingStyles')}


# Later land deltas that replace files of this receipt, in install order. A file holding exactly a later delta's pinned
# after bytes counts as the bytes that delta replaced; a manifest whose owned counts are the later delta's after counts
# counts as its before counts. The latest delta is undone first, so a file replaced twice walks back through both. So
# this receipt stays one complete state across the later installs. Each file is mapped on its own: a half-done later
# install is caught by that delta's own row (mabou-village-delta-land, or tools/mabou-dashcam-18nov/receipt.py verify
# before the 18 Nov promotion), not here.
VILLAGE = ROOT/'tools/mabou-village-delta/hashes.json'
NOV18 = ROOT/'tools/mabou-dashcam-18nov/hashes.json'
COMM1347 = ROOT/'tools/community-mailboxes/hashes.json'
NOV19 = ROOT/'tools/mabou-wharf/roads.json'
LATER = (VILLAGE, NOV18, COMM1347, NOV19)


def superseded(root, entries, hashes, later=LATER):
    """Rewrite `hashes` in place for files of later deltas; returns {name: the deltas that replaced it}."""
    names = collections.defaultdict(list)
    ours = {f['file']: f for f in entries}
    now = {name: hashlib.sha256((root/name).read_bytes()).hexdigest() for name, f in ours.items() if 'ownedCounts' not in f}
    owned = {name: owned_counts(json.loads((root/name).read_bytes())) for name, f in ours.items() if 'ownedCounts' in f}
    for path in reversed(later):
        report = json.loads(path.read_text())
        for name, digest in now.items():
            before = previous_digest(report, name, digest)
            if before is not None:
                now[name] = before
                names[name].append(path)
        for m in report['manifests']:
            name = m['folder']+'/manifest.json'
            if name in owned and any(k in m['after'] for k in owned[name]) and owned[name] == {k: m['after'][k]['count'] for k in owned[name] if k in m['after']} | {k: v for k, v in owned[name].items() if k not in m['after']}:
                owned[name] = {k: (m['before'][k]['count'] if k in m['before'] else v) for k, v in owned[name].items()}
                names[name].append(path)
    for name in names:
        if name in now: hashes[name] = now[name]
        else:
            match = next((s for s in ('before', 'after') if owned[name] == ours[name]['ownedCounts'][s]), None)
            if match: hashes[name] = ours[name]['before' if match == 'before' else 'sha256']
    return dict(names)


def step29_view(root, name, later):
    """A props file and its roads as step 29 left them: later Mabou deltas (wharf, community mailboxes, 18 Nov)
    each have an exact undo that rebuilds their before props byte for byte."""
    props = json.loads((root/name).read_bytes())
    roads = json.loads((root/Path(name).with_name('roads.json')).read_bytes())['roads']
    applied = later.get(name, ())
    if any(p in applied for p in (NOV19, COMM1347, NOV18)):
        spec = importlib.util.spec_from_file_location('nov18_receipt', ROOT/'tools/mabou-dashcam-18nov/receipt.py')
        receipt = importlib.util.module_from_spec(spec); spec.loader.exec_module(receipt)
        comm_receipt = None
        if COMM1347 in applied:
            cspec = importlib.util.spec_from_file_location('comm_receipt', ROOT/'tools/community-mailboxes/receipt.py')
            comm_receipt = importlib.util.module_from_spec(cspec); cspec.loader.exec_module(comm_receipt)
        for path in (NOV19, COMM1347, NOV18):
            if path not in applied:
                continue
            report = json.loads(path.read_text())
            current_sha = hashlib.sha256(receipt.compact(props)).hexdigest()
            before = previous_digest(report, name, current_sha)
            assert before is not None, f'{name}: {path.parent.name} undo did not match a pinned after digest'
            if path == COMM1347:
                props = comm_receipt.undo(props, report['undo'])
            else:
                props, roads = receipt.undo(props, roads, report['undo'])
            assert hashlib.sha256(receipt.compact(props)).hexdigest() == before, f'{name}: {path.parent.name} undo did not rebuild before props'
    return props, roads


def land(root=None):
    report = json.loads((ROOT/'tools/road-scene-delta/hashes.json').read_text())
    entries = report['files']
    assert len({f['file'] for f in entries}) == len(entries)
    for f in entries:
        assert f['before'] != f['sha256'] and len(f['before'])==len(f['sha256'])==64
        assert '..' not in Path(f['file']).parts and not Path(f['file']).is_absolute()
    root = Path(root) if root else ROOT/'data/baked'
    hashes = {f['file']:hashlib.sha256((root/f['file']).read_bytes()).hexdigest() for f in entries}
    for f in entries:
        if 'ownedCounts' in f:
            counts = owned_counts(json.loads((root/f['file']).read_bytes()))
            # Other bake stages own all other manifest keys. Their edits must not invalidate this delta.
            match = next((s for s in ('before','after') if counts == f['ownedCounts'][s]),None)
            hashes[f['file']] = f['before' if match == 'before' else 'sha256'] if match else 'unknown'
    receipt = json.loads((ROOT/'tools/road-scene-delta/step29-hashes.json').read_text())
    step29 = receipt['files']
    assert set(step29) == {'terrain/props.json','areas/judique/props.json'}
    assert all(set(v) == {'publicPoles','mailboxes','communityBoxes'} for v in step29.values())
    read_json = lambda path: json.loads((root/path).read_bytes())
    later = superseded(root, entries, hashes)
    powers, expect29 = {}, dict(step29)
    for name in step29:
        if hashes[name] not in {f[k] for f in entries if f['file']==name for k in ('before','sha256')}:
            props, roads = step29_view(root, name, later)
            expected = step29[name]
            if VILLAGE in later.get(name, ()):
                # Mabou village delta changes two community sites (and drops), never a mailbox or public pole (its maker checks
                # that); the file is its exact pinned after bytes, so its own community digest is the receipt's.
                expected = dict(expected, communityBoxes=canonical_digest(props['communityBoxes']))
            candidates = [expected]
            if name == 'areas/judique/props.json':
                candidates.append(dict(expected, publicPoles=receipt['judiqueRoad98']['publicPoles']))
            for expected in candidates:
                power = step29_state(props, roads, expected)
                if power:
                    expect29[name] = expected
                    powers[name] = power
                    hashes[name] = STEP29
                    break
    mode = state(hashes,entries,step29)
    if STEP29 in hashes.values(): one_power_state(powers)
    expectation(mode,EXPECT)
    # Post-step29 outputs form one complete known state, never a per-file wildcard.
    final = {f['file']:STEP29 if f['file'] in step29 else f['sha256'] for f in entries}
    assert state(final,entries,step29) == 'after'
    for name in step29:
        mixed_stage = dict(final)
        mixed_stage[name] = next(f['sha256'] for f in entries if f['file']==name)
        try: state(mixed_stage,entries,step29)
        except AssertionError: pass
        else: raise AssertionError('mixed pre/post-step29 props accepted')
    other = next(f for f in entries if f['file'] not in step29)
    for label, mutated in [('a delta file before', {**final, other['file']:other['before']}),
                           ('step-29 props on before land', {**{f['file']:f['before'] for f in entries}, 'terrain/props.json':STEP29})]:
        try: state(mutated,entries,step29)
        except AssertionError: pass
        else: raise AssertionError('mixed receipt accepted: '+label)
    proved = []
    try: one_power_state({'terrain/props.json':'powered','areas/judique/props.json':'unpowered'})
    except AssertionError: pass
    else: raise AssertionError('mixed power state accepted')
    if STEP29 in hashes.values():
        # Mutants on the installed props: a moved or missing public pole, a changed box, a pole off public roads
        # without drops, or a power pole off a named kind-4 road must leave the receipt. Controls: the same props
        # with power taken out, and with one power pole added on a named kind-4 road, stay at the receipt.
        for name in step29:
            props, roads = step29_view(root, name, later)
            by_id = {r['id']: r for r in roads}
            named = lambda r: bool((r.get('name') or '').strip())
            public_at = next(i for i, q in enumerate(props['poles']) if by_id[q['road']]['kind'] <= 3)
            pole = lambda road: dict(x=road['pts'][0][0], y=road['pts'][0][1], heading=0, road=road['id'], transformer=False, light=False, n=0)
            unpowered = copy.deepcopy(props); unpowered.pop('serviceDrops', None)
            unpowered['poles'] = [q for q in unpowered['poles'] if by_id[q['road']]['kind'] <= 3]
            track = next(r for r in roads if r['kind'] == 4 and named(r) and not r['bridge'])
            powered = copy.deepcopy(props)
            if 'serviceDrops' not in powered:
                powered['poles'].append(pole(track)); powered['serviceDrops'] = [dict(building=0, road=track['id'], n=0)]
            assert step29_state(unpowered, roads, expect29[name]) == 'unpowered', f'{name}: unpowered control left the receipt'
            assert step29_state(powered, roads, expect29[name]) == 'powered', f'{name}: powered control left the receipt'
            moved = copy.deepcopy(props); moved['poles'][public_at]['x'] = round(moved['poles'][public_at]['x']+.01, 3)
            gone = copy.deepcopy(props); del gone['poles'][public_at]
            box = copy.deepcopy(props); box['mailboxes'][0]['style'] = (box['mailboxes'][0]['style']+1) % 8
            dropless = copy.deepcopy(powered); del dropless['serviceDrops']
            empty = copy.deepcopy(powered); empty['serviceDrops'] = []
            cases = [('public pole moved', moved), ('public pole gone', gone), ('mailbox changed', box),
                     ('power poles without service drops', dropless), ('power poles with empty service drops', empty)]
            for bad in [r for r in roads if r['kind'] > 3 and not named(r)][:1] + [r for r in roads if r['kind'] == 4 and named(r) and r['bridge']][:1]:
                stray = copy.deepcopy(unpowered); stray['poles'].append(pole(bad))
                cases.append((f'pole on kind-{bad["kind"]} road {bad["id"]} without drops', stray))
                wired = copy.deepcopy(powered); wired['poles'].append(pole(bad))
                cases.append((f'power pole on {"bridge" if bad["bridge"] else "unnamed"} road {bad["id"]}', wired))
            if props['communityBoxes']:
                community = copy.deepcopy(props); community['communityBoxes'][0]['x'] += 1
                cases.append(('community box changed', community))
            assert sum(label.startswith(('pole on kind-', 'power pole on ')) for label, _ in cases) == 4, f'{name}: unnamed/bridge road mutants not built'
            for label, mutated in cases:
                assert step29_state(mutated, roads, expect29[name]) is None, f'{name}: {label} accepted'
            proved.append(f'{name} {powers[name]}: {len(cases)} prop mutants, 2 controls')
    for invalid in [('before','after'),('after','before')]:
        try: expectation(*invalid)
        except AssertionError: pass
        else: raise AssertionError('wrong install expectation accepted')
    for allowed in [('before',None),('after',None),('after','after')]:expectation(*allowed)
    try:state({},[])
    except AssertionError:pass
    else:raise AssertionError('empty receipt accepted')
    for label, mutated in [('mixed',{**{f['file']:f['before'] for f in entries},entries[0]['file']:entries[0]['sha256']}),('unknown',{**hashes,entries[0]['file']:'0'*64})]:
        try: state(mutated,entries)
        except AssertionError: pass
        else: raise AssertionError(label+' receipt accepted')
    from dashcam_corrections import remap_road_references
    stale_mutants = collections.Counter()
    for area, relative in [('mabou','terrain'),('judique','areas/judique')]:
        folder = root/relative
        roads = json.loads((folder/'roads.json').read_bytes())['roads']
        pieces = collections.defaultdict(list)
        for r in roads:
            if r.get('correction'): pieces[r['correction']].append(r['id'])
        sibling = {rid: next(o for o in ids if o != rid) for ids in pieces.values() if len(ids) > 1 for rid in ids}
        for kind in ('cemeteries','buildings','streams','props'):
            data = json.loads((folder/f'{kind}.json').read_bytes())
            assert remap_road_references(data,kind,roads) == data, f'{area}/{kind}: stale split-road reference'
            # Mutant: put the first record on a split road back on its sibling piece; the check must name it stale.
            key, field = REFERENCES[kind]
            get = (lambda r: (r.get('road') or {}).get('id')) if kind == 'cemeteries' else (lambda r: r.get(field))
            at = next((i for i, r in enumerate(data[key]) if get(r) in sibling), None)
            if at is None: continue
            stale = copy.deepcopy(data)
            target = stale[key][at]
            if kind == 'cemeteries': target['road']['id'] = sibling[get(target)]
            else: target[field] = sibling[target[field]]
            assert remap_road_references(stale,kind,roads) != stale, f'{area}/{kind}: stale {field} mutant accepted'
            stale_mutants[kind] += 1
        if area == 'judique' and 1011 in sibling:
            cemeteries = json.loads((folder/'cemeteries.json').read_bytes())
            walkers = next(c for c in cemeteries['cemeteries'] if c['id']=='cemetery-2c430310b451')
            assert walkers['road']['id'] == 1011, 'cemetery-2c430310b451 must follow Walkers Cove Road to 1011'
            walkers['road']['id'] = 111
            assert remap_road_references(cemeteries,'cemeteries',roads) != cemeteries, 'cemetery road 111 mutant accepted'
            stale_mutants['cemetery road 111'] += 1
    if mode == 'after':
        assert set(stale_mutants) == {'cemeteries','buildings','streams','props','cemetery road 111'}, f'stale-reference mutants not all built: {dict(stale_mutants)}'
        proved.append('stale road mutants '+json.dumps(dict(stale_mutants), sort_keys=True))
    network = json.loads((root/'terrain/roads.json').read_text())['roads']
    by = {r['id']:r for r in network}
    rail = next(r for r in correct_roads(network,'mabou') if r['id']==111)['guardrailRuns'][0]
    assert rail['side']==1 and by[111]['pts'][0][1]>by[111]['pts'][-1][1], 'southbound source direction; actual west-side offset is proved by rail-land'
    assert by[112]['kind']==3, 'Southwest Ridge at MacKillop MUST stay gravel'
    assert by[111]['kind']==2 and by[111]['pts'][-1]==[624562.59,5099281.74], 'crest must not move'
    buildings = json.loads((root/'terrain/buildings.json').read_bytes())['buildings']
    combined = [b for b in buildings if b.get('source')!='hand'] + hand_buildings([], 'mabou',lambda x,y:100)
    floor = measured_root_id_limit(combined)
    wings = [b for b in buildings if b.get('buildingId',b['id']) != b['id']]
    assert wings, 'real wing regression requires an existing wing inventory'
    # Evaluate the checker's actual assignment and assertion, without importing its GDAL bake entry point.
    tree = ast.parse((ROOT/'pipeline/27_check_buildings.py').read_text())
    assign = next(n for n in ast.walk(tree) if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='wing_id_floor' for t in n.targets))
    ctx = dict(roots=[b for b in combined if b.get('buildingId',b['id'])==b['id']],measured_root_id_limit=measured_root_id_limit)
    ctx['root_ids'] = [b['id'] for b in ctx['roots']]
    ctx['wing_id_floor'] = eval(compile(ast.Expression(assign.value),'<actual checker ID floor>','eval'),ctx)
    condition = next(n.test for n in ast.walk(tree) if isinstance(n,ast.Assert) and isinstance(n.test,ast.BoolOp) and isinstance(n.test.op,ast.Or) and {'wing','bid'} <= {x.id for x in ast.walk(n.test) if isinstance(x,ast.Name)})
    code = compile(ast.Expression(condition),'<actual checker wing rule>','eval')
    assert all(eval(code,{**ctx,'wing':w,'bid':w['buildingId']}) for w in wings), 'hand IDs must not invalidate existing generated wings'
    assert all(w['id'] <= max(ctx['root_ids']) for w in wings), 'prior maximum-root rule must fail all existing wings'
    # Independent whole-footprint clearance for every supplied approximate building.
    hands = hand_buildings([], 'mabou', lambda x,y:100)
    for b in hands:
        for point in b['footprint']:
            gap, rid, _ = project(network, point, 'Southwest Ridge Road')
            assert gap > by[rid]['halfWidth']+2, (b['id'],'building footprint on road',gap)
    # Pin real land before and after through the production correction helper.
    after = correct_roads(network,'mabou')
    assert [r for r in network if r['name']=='Mabou Mines Road'] == [r for r in after if r['name']=='Mabou Mines Road']
    assert all(r.get('washboard') for r in after if r['name']=='Mabou Mines Road')
    assert all(r['halfWidth']==2.25 for r in after if r['name']=='MacKillop Road' and r['kind']==3)
    wash = [r for r in after if r['name']=='Whycocomagh Port Hood Road' and r.get('washboard')]
    assert len(wash)==1 and not wash[0]['bridge']
    length = sum(math.dist(a,b) for a,b in zip(wash[0]['pts'],wash[0]['pts'][1:]))
    assert 65 < length < 100, length
    for name,limit in [('Walkers Cove Road',128),('James MacDonald Road',96)]:
        original = json.loads((root/'areas/judique/roads.json').read_text())['roads']
        fixed = correct_roads(original,'judique')
        pieces = [r for r in fixed if r['name']==name]
        paved = [r for r in pieces if r['kind']==2]
        assert len(paved)==1 and len(pieces)==2
        assert abs(sum(math.dist(a,b) for a,b in zip(paved[0]['pts'],paved[0]['pts'][1:]))-limit)<2
    stage = ' (step-29 props at the public-pole/box receipt)' if STEP29 in hashes.values() else ''
    print(f'PASS {len(entries)} delta hashes all {mode}{stage}; ' + ''.join(p + '; ' for p in proved)
          + f'{len(wings)} real wings valid with hand IDs; real crest/MacKillop gravel, narrow gravel, bounded washboard and unchanged Mines')


if __name__ == '__main__':
    if '--step29-receipt' in sys.argv:
        # Print the step-29 receipt of a land root for review; it never writes the committed file.
        base = Path(sys.argv[sys.argv.index('--step29-receipt')+1])
        print(json.dumps({name: step29_properties(json.loads((base/name).read_bytes()), json.loads((base/name).with_name('roads.json').read_bytes())['roads'])
                          for name in ('terrain/props.json', 'areas/judique/props.json')}, indent=2))
        sys.exit()
    rules()
    if '--land' in sys.argv:
        land(sys.argv[sys.argv.index('--land-root')+1] if '--land-root' in sys.argv else None)
