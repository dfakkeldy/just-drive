#!/usr/bin/env python3
"""No roadside box for the hand-built house site (web/src/home-site.ts), in the baked Judique land and in the rule.

pipeline/areas.py gives Judique two rules for the invented roadside props of step 29:
  props_driveways  the road to the site is public for driving, but for the props it stays the driveway that the
                   provincial file calls it: no box and no pole stands on it;
  no_box_sites     a property within the radius of the site gets no mailbox, and the bake stops if a box stands inside.

1. The baked land: every mailbox and community box is farther from the site than the radius, and no box near the
   site carries the record of a property inside the radius.
2. The rule itself, with the functions of step 29 on the real baked roads and buildings. No height data is read:
   every place counts as safe, so this proves the rule, not the exact baked positions.
3. Three mutants, each of which must be found: a box put inside the radius, the road rule removed, and the
   no-box rule removed (the property at the site gets its box back on the next public road).
No GDAL. It reads data/baked/areas/judique only.
"""
import copy
import json
import math
import os
import random
import re
import sys
import types

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'pipeline'))
# The module is loaded for its functions only, as the default area: Judique's own anchor point needs GDAL to be made.
os.environ.pop('MMM_AREA', None)
# The bake script loads GDAL for its height veto only; nothing here calls it.
sys.modules.setdefault('osgeo', types.SimpleNamespace(gdal=types.SimpleNamespace(UseExceptions=lambda: None)))
import areas  # noqa: E402

P = types.ModuleType('props')
P.__file__ = os.path.join(ROOT, 'pipeline', '29_bake_props.py')
exec(compile(open(P.__file__).read(), P.__file__, 'exec'), P.__dict__)

AREA = areas.AREAS['judique']
# Near the site: far enough to hold the next public road, where the property at the site had its box.
NEAR = 400
assert [a.id for a in areas.AREAS.values() if a.no_box_sites or a.props_driveways] == ['judique'], \
    'another area has a no-box site or a props driveway: teach this check that area'
assert len(AREA.no_box_sites) == 1 and len(AREA.props_driveways) == 1
SITE_X, SITE_Y, RADIUS = AREA.no_box_sites[0]

# The site point is the origin of the hand-built house site.
origin = re.search(r'const ORIGIN_E = ([\d.]+), ORIGIN_N = ([\d.]+)', open(os.path.join(ROOT, 'web/src/home-site.ts')).read())
assert origin and math.hypot(float(origin[1]) - SITE_X, float(origin[2]) - SITE_Y) < 1, \
    'no_box_sites in pipeline/areas.py is not the origin of web/src/home-site.ts'

OUT = os.path.join(ROOT, 'data', 'baked', 'areas', 'judique')
read = lambda name: json.load(open(os.path.join(OUT, name)))
roads, buildings = read('roads.json')['roads'], read('buildings.json')['buildings']
VILLAGE = read('manifest.json')['village']   # the anchor point of the bake
# One property for each building, as step 29 makes the list.
sites = [b.get('site', b) for b in buildings if b.get('buildingId', b['id']) == b['id']]
to_site = lambda m: math.hypot(m['x'] - SITE_X, m['y'] - SITE_Y)
inside = [b for b in sites if b['kind'] in ('house', 'barn') and to_site(b) < RADIUS]
assert inside, 'no property stands inside the no-box site: the rule has nothing to act on'


def record(building_id, grouped=False, character=True):
    """The look of the box of one property, as step 29 draws it from the property's id (same calls, same order)."""
    local = random.Random(P.SEED + building_id)
    style, tilt, parcel = local.randrange(6), round(local.uniform(-4, 4), 2), local.randrange(6) == 0
    draw = local.random()
    if character and not grouped and draw < .03:
        style = 6 if draw < .015 else 7
    return style, tilt, parcel


def data_faults(props):
    """What is wrong in one props file."""
    found = []
    boxes = props['mailboxes'] + props['communityBoxes']
    for m in boxes:
        if to_site(m) < RADIUS:
            found.append(f'a box stands {to_site(m):.1f} m from the site (the radius is {RADIUS} m)')
    for b in inside:
        for m in props['mailboxes']:
            # Existing land can precede the character-prop bake. Both inventories must keep the site clear.
            looks = {record(b['id'],m['group'] is not None,character) for character in (False,True)}
            if to_site(m) < NEAR and (m['style'], m['tilt'], m['parcelBox']) in looks:
                found.append(f'property {b["id"]} at the site has a box, {to_site(m):.1f} m from the site')
    return found


def rule(view=True, no_box=True):
    """Step 29's placement on the real roads and buildings: (the props it gives, its report)."""
    seen = P.props_view(roads, AREA.props_driveways if view else ())
    net = P.Network(seen)
    boxes, report = P.place_mailboxes(net, net, sites, [], [], lambda p, bridge=True, on=None: True, VILLAGE,
                                      AREA.mailbox_exclusion_radius, AREA.no_box_sites if no_box else ())
    return dict(mailboxes=boxes, communityBoxes=[]), report, seen


def rule_faults(view=True, no_box=True):
    props, report, seen = rule(view, no_box)
    found = data_faults(props)
    ids = {b['id'] for b in inside}
    found += [f'the rule gives property {row["building"]} at the site a box' for row in report if row['building'] in ids]
    found += [f'the bake guard finds a box at {m["x"]}, {m["y"]}' for m in P.boxes_in_sites(props['mailboxes'], AREA.no_box_sites)]
    by_point = P.Network(seen).nearest(AREA.props_driveways[0], 5)
    if by_point is None or by_point['road']['kind'] != 4:
        found.append('the road to the site is a public road for the props')
    return found, props, report


# The look of a box is what this check says it is: every box of the rule's own output carries its property's record.
props, report, _ = rule()
assert len(props['mailboxes']) == len(report) > 300
for m, row in zip(props['mailboxes'], report):
    assert (m['style'], m['tilt'], m['parcelBox']) == record(row['building'],m['group'] is not None), 'record() is not step 29\'s record any more'

# 1. The baked land.
baked = read('props.json')
faults = data_faults(baked)
nearest = min(to_site(m) for m in baked['mailboxes'] + baked['communityBoxes'])
assert not faults, 'the baked Judique land: ' + '; '.join(faults)

# 2. The rule.
faults, props, report = rule_faults()
assert not faults, 'the rule: ' + '; '.join(faults)
# In the game the road is still a public road: the view is for the props only.
by_point = P.Network(roads).nearest(AREA.props_driveways[0], 5)
assert by_point and by_point['road']['kind'] <= 3, 'the road to the site is not a public road in roads.json'

# 3. The mutants.
planted = copy.deepcopy(baked)
planted['mailboxes'].append(dict(planted['mailboxes'][0], x=SITE_X + 30, y=SITE_Y, group=None))
assert any('stands 30.0 m' in line for line in data_faults(planted)), 'a box put 30 m from the site is not found'
edge = copy.deepcopy(baked)
edge['mailboxes'].append(dict(edge['mailboxes'][0], x=SITE_X + RADIUS - .5, y=SITE_Y, group=None))
assert data_faults(edge), 'a box just inside the radius is not found'
road_rule_off = rule_faults(view=False)[0]
assert any('stands' in line for line in road_rule_off) and any('bake guard' in line for line in road_rule_off) \
    and any('public road for the props' in line for line in road_rule_off), 'the road rule removed is not found'
no_box_off = rule_faults(no_box=False)[0]
assert any('at the site has a box' in line for line in no_box_off) and any('the rule gives property' in line for line in no_box_off), \
    'the no-box rule removed is not found'
assert not any('stands' in line for line in no_box_off), 'with the road rule alone, no box stands inside the radius'

print(f'no-box site: {len(baked["mailboxes"])} baked mailboxes, the nearest box is {nearest:.1f} m from the site '
      f'(radius {RADIUS} m); {len(inside)} propert{"y" if len(inside) == 1 else "ies"} at the site without a box; '
      f'3 mutants found (box inside, road rule removed, no-box rule removed)')
