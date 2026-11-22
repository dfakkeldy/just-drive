#!/usr/bin/env python3
"""Bake invented roadside props from buildings and road geometry, never addresses.

Run from the repository root in the GDAL image; no external downloads are used.
Only props.json and the manifest's props key are written, and a short report beside the other bake reports.

Where the road lines were moved onto their beds (MMM_ROAD_BED in 23_bake_roads.py), every choice about a mailbox is
made on the lines as they were before the move, and only its position is taken from the moved line: place_mailboxes.
"""
import bisect
import collections
import json
import os
import math
from pathlib import Path
import random
import importlib.util

from osgeo import gdal

from areas import current
import road_ground

AREA = current()

gdal.UseExceptions()
ROOT = Path(os.path.abspath(__file__)).parents[1]
OUT = AREA.output
SEED = 29017


def distance(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


class Network:
    def __init__(self, roads):
        self.roads = {r['id']: r for r in roads}
        self.cells = collections.defaultdict(set)
        for r in roads:
            r['cum'] = [0.0]
            for i, (a, b) in enumerate(zip(r['pts'], r['pts'][1:])):
                r['cum'].append(r['cum'][-1] + distance(a, b))
                for x in range(math.floor(min(a[0], b[0]) / 128), math.floor(max(a[0], b[0]) / 128) + 1):
                    for y in range(math.floor(min(a[1], b[1]) / 128), math.floor(max(a[1], b[1]) / 128) + 1):
                        self.cells[x, y].add((r['id'], i))

    def nearest(self, p, reach=250, select=lambda r: True):
        span = math.ceil(reach / 128)
        ids = set()
        cx, cy = (math.floor(v / 128) for v in p)
        for x in range(cx - span, cx + span + 1):
            for y in range(cy - span, cy + span + 1):
                ids.update(self.cells[x, y])
        best = None
        for rid, i in sorted(ids):
            r = self.roads[rid]
            if not select(r):
                continue
            a, b = r['pts'][i:i + 2]
            dx, dy = b[0] - a[0], b[1] - a[1]
            length = r['cum'][i + 1] - r['cum'][i]
            if length == 0:
                continue
            t = max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length ** 2))
            q = (a[0] + dx * t, a[1] + dy * t)
            d = distance(p, q)
            if d <= reach and (best is None or d < best['dist']):
                best = dict(road=r, s=r['cum'][i] + t * length, dist=d, p=q,
                            u=(dx / length, dy / length))
        return best

    @staticmethod
    def at(r, s):
        s = max(0, min(r['cum'][-1], s))
        i = min(len(r['pts']) - 2, bisect.bisect_right(r['cum'], s) - 1)
        a, b = r['pts'][i:i + 2]
        length = distance(a, b) or 1
        u = ((b[0] - a[0]) / length, (b[1] - a[1]) / length)
        return (a[0] + u[0] * (s - r['cum'][i]), a[1] + u[1] * (s - r['cum'][i])), u


def shifted(r, s, side, extra):
    p, u = Network.at(r, s)
    w = r['halfWidth'] + extra
    return (p[0] - side * u[1] * w, p[1] + side * u[0] * w), u


def heading(u):
    """Compass degrees, clockwise from north in EPSG:2961."""
    return round(math.degrees(math.atan2(u[0], u[1])) % 360, 2)


def site_position(r, s, side=1, extra=1.6):
    p, u = shifted(r, s, side, extra)
    return dict(x=round(p[0], 3), y=round(p[1], 3), heading=heading((side * u[1], -side * u[0])))


def public(r):
    return r['kind'] <= 3


def props_view(roads, driveways):
    """The road list as the props see it. A road named in `driveways` (AREA.props_driveways, one point on its line)
    is public for driving, but here it is the driveway that the provincial file calls it: kind 4, with a driveway's
    half width. So no box and no pole stands on it, and a house beside it gets its box on the next public road."""
    if not driveways:
        return roads
    seen, net = list(roads), Network(roads)
    for point in driveways:
        hit = net.nearest(point, 5)
        if hit is None:
            raise RuntimeError(f'No road within 5 m of {point} for props_driveways')
        index = next(n for n, r in enumerate(seen) if r['id'] == hit['road']['id'])
        seen[index] = dict(seen[index], kind=4, halfWidth=1.5, propsDriveway=True)
    return seen


def boxes_in_sites(boxes, no_box):
    """The boxes that stand inside a no-box site (AREA.no_box_sites): there must be none."""
    return [m for m in boxes if any(distance((m['x'], m['y']), (x, y)) < radius for x, y, radius in no_box)]


def carry(before, now, s):
    """`s` metres along a road line before the bed move, as metres along the same road now: the same piece of line and
    the same fraction of it. The move changes points only; ids, order and point counts stay (road_ground.move_to_bed)."""
    if before is now:
        return s
    cum = before['cum']
    if s <= 0:
        return s
    if s >= cum[-1]:
        return now['cum'][-1] + (s - cum[-1])
    i = min(len(cum) - 2, bisect.bisect_right(cum, s) - 1)
    t = (s - cum[i]) / (cum[i + 1] - cum[i])         # cum[i] <= s < cum[i + 1]: never a piece without length
    return now['cum'][i] + t * (now['cum'][i + 1] - now['cum'][i])


def mouths(net):
    """Driveway mouths must join the public road and actually lead toward the property."""
    found = []
    for r in net.roads.values():
        if r['kind'] != 4:
            continue
        for k in (0, -1):
            p = r['pts'][k]
            hit = net.nearest(p, 12, lambda q: public(q) and not q['bridge'])
            if hit:
                found.append((r, k, hit))
    return found


def candidate(b, net, driveways, cabinets, village, exclusion):
    """Where the rule puts the mailbox of one property on a road network, or None: on the nearest public road within
    250 m, at the mouth of the property's own driveway when it has one there."""
    home = (b['x'], b['y'])
    if distance(home, village) < exclusion or any(distance(home, (c['x'], c['y'])) < 120 for c in cabinets):
        return None
    hit = net.nearest(home, 250, public)
    if hit is None or hit['road']['bridge']:
        return None
    r, s = hit['road'], hit['s']
    junctions = []
    for drive, k, mouth in driveways:
        if mouth['road']['id'] != r['id'] or abs(mouth['s'] - s) > 40:
            continue
        points = drive['pts'] if k == 0 else drive['pts'][::-1]
        lead = points[min(4, len(points) - 1)]
        v = (lead[0] - points[0][0], lead[1] - points[0][1])
        toward = (home[0] - points[0][0], home[1] - points[0][1])
        if v[0] * toward[0] + v[1] * toward[1] > 0 and min(distance(home, p) for p in points) < max(25, hit['dist'] * .65):
            junctions.append((abs(mouth['s'] - s), mouth['s']))
    if junctions:
        s = min(junctions)[1]
    p, u = net.at(r, s)
    side = 1 if u[0] * (home[1] - p[1]) - u[1] * (home[0] - p[0]) >= 0 else -1
    return dict(road=r['id'], s=s + 2.5, side=side, dist=hit['dist'], id=b['id'])


def frame_at(net, r, centre_s, count, side):
    """The boxes of one straight frame for `count` neighbours, its middle `centre_s` metres along road r. Curved
    offsets and clamped road ends must never collapse two boxes onto the same location."""
    half_span = (count - 1) * .3
    centre = site_position(r, centre_s, side)
    _, u = net.at(r, centre_s)
    return [dict(x=round(centre['x'] + u[0] * (i * .6 - half_span), 3),
                 y=round(centre['y'] + u[1] * (i * .6 - half_span), 3),
                 heading=centre['heading']) for i in range(count)]


def frame(net, r, start, cluster, side, safe):
    """The rule's search for a frame near `start` metres along road r: (its boxes, where its middle is), or
    (None, None) when no place it may try is safe. The middle stays 1 m clear of the ends of the road."""
    half_span = (len(cluster) - 1) * .3
    for delta in (0, 5, -5, 10, -10, 20, -20):
        centre_s = max(half_span + 1, min(r['cum'][-1] - half_span - 1, start + delta))
        trial = frame_at(net, r, centre_s, len(cluster), side)
        if all(safe((obj['x'], obj['y']), on=net) for obj in trial):
            return trial, centre_s
    return None, None


def place_mailboxes(net, ref, sites, cabinets, cabinets_before, safe, village, exclusion, no_box=()):
    """One mailbox candidate per original property, and frames for neighbours: the list for props.json, and one
    report row per box (building, road, 'kept' or 'again').

    `ref` holds the road lines before the road bed move; it is `net` itself where nothing moved. Every choice is made
    on `ref`: in or out at the 250 m reach, the road, the driveway mouth, the side, who shares a frame, at whose place
    the frame stands, how far it was pushed along the road to stand safely, and whether the place was safe at all
    (a house that had no box gets none). Only the position comes from `net`: the same piece of line and the same
    fraction of it (`carry`), also for the middle of a frame, without a new look at the ends of the road.

    Why: each of those choices has a threshold. On lines that moved by a metre or two, one house in fifty crosses one
    (Mabou, 13 Nov 2026: nine boxes jumped 10 to 135 m, five of them farther from their house, and one house at
    249.8 m lost its box at 250.9 m), although every road is where it was to the eye.

    The one case that is placed again ('again'): a place that was safe before the move and is not safe on the moved
    lines. A box on its own gets the rule's place on the moved lines, if that place is safe. A frame stays a frame:
    the rule's search runs along the moved line from the same house; when that finds no place, each of its boxes is
    placed again on its own.
    """
    houses = [b for b in sites if b['kind'] == 'house']
    driveways = mouths(ref)
    pending, homes = collections.defaultdict(list), {}
    for b in sites:
        home = (b['x'], b['y'])
        if b['kind'] != 'house' and (b['kind'] != 'barn' or any(distance(home, (h['x'], h['y'])) < 60 for h in houses)):
            continue
        if any(distance(home, (x, y)) < radius for x, y, radius in no_box):
            continue                                        # no roadside box for the hand-built house site
        found = candidate(b, ref, driveways, cabinets_before, village, exclusion)
        if found:
            pending[found['road']].append(found)
            homes[b['id']] = b
    moved_mouths = []

    def placed_again(m):
        if not moved_mouths:
            moved_mouths.append(mouths(net))
        found = candidate(homes[m['id']], net, moved_mouths[0], cabinets, village, exclusion)
        if found is None:
            return None, None
        obj = site_position(net.roads[found['road']], found['s'], found['side'])
        return (obj, found['road']) if safe((obj['x'], obj['y']), on=net) else (None, None)

    mailboxes, report, group_id = [], [], 0
    for rid, entries in sorted(pending.items()):
        r, now = ref.roads[rid], net.roads[rid]
        entries.sort(key=lambda m: (m['s'], m['id']))
        while entries:
            nearby = [m for m in entries[:6] if m['s'] - entries[0]['s'] <= 60]
            mixed = len({m['side'] for m in nearby}) > 1
            cluster = nearby if mixed else [m for m in nearby if m['s'] - entries[0]['s'] < 3]
            anchor = min(cluster, key=lambda m: (m['dist'], m['id']))
            # Decided on the lines before the move: whether these neighbours get a frame, and where along the road.
            centre_s = frame(ref, r, anchor['s'], cluster, anchor['side'], safe)[1] if len(cluster) > 1 else None
            grouped, rows = False, []                       # rows: (neighbour, box, road, 'kept' or 'again')
            if centre_s is not None:
                positions, how = frame_at(net, now, carry(r, now, centre_s), len(cluster), anchor['side']), 'kept'
                if not all(safe((obj['x'], obj['y']), on=net) for obj in positions):
                    # That place is gone on the moved line. Look along it as the rule does, from the same house.
                    positions, how = frame(net, now, carry(r, now, anchor['s']), cluster, anchor['side'], safe)[0], 'again'
                grouped = positions is not None
                if grouped:
                    group_id += 1
                    rows = [(m, obj, rid, how) for m, obj in zip(cluster, positions)]
                else:
                    rows = [(m, *placed_again(m), 'again') for m in cluster]
            else:
                for m in cluster:
                    # Keep invented objects out of junction lanes, buildings and water.
                    was = site_position(r, m['s'], m['side'])
                    if not safe((was['x'], was['y']), on=ref):
                        continue                            # no box before the move: none now
                    obj = site_position(now, carry(r, now, m['s']), m['side'])
                    if safe((obj['x'], obj['y']), on=net):
                        rows.append((m, obj, rid, 'kept'))
                    else:
                        rows.append((m, *placed_again(m), 'again'))
            for m, obj, road, how in rows:
                if obj:
                    local = random.Random(SEED + m['id'])
                    mailboxes.append(dict(**obj, style=local.randrange(6), tilt=round(local.uniform(-4, 4), 2),
                                          group=group_id if grouped else None, parcelBox=local.randrange(6) == 0))
                    # Same existing per-building random draw; no recorded mailbox position is an input.
                    # Keep the old tilt/parcel draws and shared wooden frames unchanged.
                    character = local.random()
                    if not grouped and character < .03:
                        mailboxes[-1]['style'] = 6 if character < .015 else 7
                    report.append(dict(building=m['id'], road=road, how=how))
            for m in cluster:
                entries.remove(m)
    return mailboxes, report


def junction(net, name, other):
    choices = []
    for r in net.roads.values():
        if r['name'] not in (name, other):
            continue
        for p in (r['pts'][0], r['pts'][-1]):
            target = name if r['name'] == other else other
            hit = net.nearest(p, 80, lambda q: q['name'] == target)
            if hit:
                if target == name:
                    choices.append(hit)
                else:
                    choices.append(dict(road=r, s=0 if p == r['pts'][0] else r['cum'][-1],
                                        dist=hit['dist'], p=p))
    if not choices:
        raise ValueError(f'No junction for {name} and {other}')
    return min(choices, key=lambda h: (h['dist'], h['road']['id']))


def travel_named(net, start, metres, east):
    """Walk connected pieces of one named road, including its bridge pieces."""
    name = start['road']['name']
    found = []

    def walk(r, s, direction, remaining, visited):
        available = r['cum'][-1] - s if direction > 0 else s
        if remaining <= available:
            target = s + direction * remaining
            p, _ = net.at(r, target)
            found.append((p[0] * (1 if east else -1), r, target))
            return
        end = r['pts'][-1 if direction > 0 else 0]
        for q in net.roads.values():
            if q['name'] != name or q['id'] in visited:
                continue
            for k, pt in enumerate((q['pts'][0], q['pts'][-1])):
                gap = distance(end, pt)
                if gap < 25:
                    walk(q, 0 if k == 0 else q['cum'][-1], 1 if k == 0 else -1,
                         remaining - available - gap, visited | {q['id']})
    for direction in (-1, 1):
        walk(start['road'], start['s'], direction, metres, {start['road']['id']})
    if not found:
        return None
    _, r, s = max(found, key=lambda v: v[0])
    return dict(road=r, s=s)


def building_exclusions(exclusions):
    """Where no invented prop may stand: (boxes, in_large).

    A building keeps its square box, half a metre wider. A large block or a tank (27_bake_buildings.py, `shape`)
    is tested by its true shape instead: a hall of 300 m that is turned has a square box of several hectares,
    and that would take the poles and mailboxes of the roads beside it.
    """
    boxes, large = [], []
    for b in exclusions:
        pts = b['footprint']
        box = (min(p[0] for p in pts) - .5, min(p[1] for p in pts) - .5,
               max(p[0] for p in pts) + .5, max(p[1] for p in pts) + .5)
        if 'shape' in b:
            turn = math.radians(b['axisDeg'])
            large.append((box, b['x'], b['y'], math.sin(turn), math.cos(turn), b['length'] / 2 + .5, b['width'] / 2 + .5,
                          b['shape'] == 'tank'))
        else:
            boxes.append(box)

    def in_large(x, y):
        for (x0, y0, x1, y1), cx, cy, sin, cos, half_length, half_width, is_round in large:
            if x0 <= x <= x1 and y0 <= y <= y1:
                dx, dy = x - cx, y - cy
                if math.hypot(dx, dy) <= half_length if is_round else \
                        abs(dx * sin + dy * cos) <= half_length and abs(dx * cos - dy * sin) <= half_width:
                    return True
        return False
    return boxes, in_large



def pole_track(r):
    """A kind-4 road that may carry a pole run: named, not a props driveway, not a bridge."""
    return r['kind'] == 4 and bool((r.get('name') or '').strip()) and not r.get('propsDriveway') and not r['bridge']


def unpowered_roads(net, entries):
    """Road ids of AREA.unpowered_tracks entries, ((east, north) on the line, expected name). Any entry that does not
    resolve within 5 m to a pole track of exactly that name stops the bake."""
    ids = set()
    for entry in entries:
        if not (isinstance(entry, tuple) and len(entry) == 2 and isinstance(entry[1], str) and entry[1].strip()):
            raise RuntimeError(f'unpowered_tracks entry is not ((east, north), name): {entry!r}')
        point, name = entry
        hit = net.nearest(point, 5)
        if hit is None or not pole_track(hit['road']) or hit['road']['name'] != name:
            raise RuntimeError(f'unpowered_tracks entry {entry!r} is not on a named kind-4 pole track called {name!r}')
        ids.add(hit['road']['id'])
    return ids


def corrected_road(net, entry):
    """The public road of one AREA.public_pole_corrections entry and its checked rules. A wrong entry stops the bake."""
    if not (isinstance(entry, tuple) and len(entry) == 4 and isinstance(entry[1], str) and entry[1].strip()
            and isinstance(entry[3], tuple) and entry[3]):
        raise RuntimeError(f'public_pole_corrections entry is not ((east, north), name, kind, rules): {entry!r}')
    point, name, kind, rules = entry
    hit = net.nearest(point, 5)
    road = hit and hit['road']
    if not road or not public(road) or road['bridge'] or road['name'] != name or road['kind'] != kind:
        raise RuntimeError(f'public_pole_corrections entry {entry[:3]!r} is not on a public kind-{kind} road called {name!r}')
    end = 0
    for rule in rules:
        number = lambda v: isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
        if not (end is not None and isinstance(rule, tuple) and len(rule) == 3 and rule[2] in ('left', 'right', 'none')
                and number(rule[0]) and rule[0] == end and (rule[1] is None or number(rule[1]) and rule[1] > rule[0])):
            raise RuntimeError(f'public_pole_corrections rules must run from s=0 to the end (s1 None) without gaps or '
                               f'overlaps: {rule!r}')
        end = rule[1]
    if end is not None:
        raise RuntimeError('public_pole_corrections rules must reach the end of the road (last s1 None)')
    return road, rules


def pole_side(local, r, p):
    """(s, side, rule-free foot) of a pole beside road r: side +1 left, -1 right, looking along the road. A pole whose
    side is not clear (at a bend vertex, or more than 20 m from the line) stops the bake."""
    at = local.nearest((p['x'], p['y']), 20)
    if at is None:
        raise RuntimeError(f'pole {p!r} is not within 20 m of its road {r["name"]!r}')
    u = at['u']
    cross = u[0] * (p['y'] - at['p'][1]) - u[1] * (p['x'] - at['p'][0])
    if abs(cross) < .5 * at['dist']:
        raise RuntimeError(f'pole {p!r} stands off a bend of {r["name"]!r}; its side is not clear')
    return at['s'], 1 if cross > 0 else -1


def wanted(rules, s):
    return next(rule[2] for rule in rules if rule[0] <= s and (rule[1] is None or s < rule[1]))


def correct_public_poles(net, poles, corrections, safe=None):
    """Apply AREA.public_pole_corrections to the public poles (place_poles calls it between the public pass and the
    kind-4 runs). It is absolute, so a second run changes nothing: a pole in a 'none' stretch goes, a pole on the
    wrong side moves straight across at the same s, and every other pole keeps its bytes. A moved pole that does not
    then stand where its rule wants it, that stands within 9 m of another pole, or that is not `safe` stops the bake."""
    poles = list(poles)
    roads = [corrected_road(net, entry) for entry in corrections]
    if len({r['id'] for r, _ in roads}) != len(roads):
        raise RuntimeError('public_pole_corrections lists one road twice')
    moved = []
    for r, rules in roads:
        local = Network([r])
        kept = []
        for p in poles:
            if p['road'] != r['id']:
                kept.append(p)
                continue
            s, side = pole_side(local, r, p)
            want = wanted(rules, s)
            if want == 'none':
                continue
            if side == (1 if want == 'left' else -1):
                kept.append(p)
                continue
            # The frozen pass's setback: 3.2 m beyond the road edge.
            q, u = shifted(r, s, -side, 3.2)
            p = dict(p, x=round(q[0], 3), y=round(q[1], 3), heading=heading(u))
            s2, side2 = pole_side(local, r, p)
            if wanted(rules, s2) != want or side2 != -side:
                raise RuntimeError(f'corrected pole {p!r} on {r["name"]!r} does not stay where its rule wants it')
            kept.append(p)
            moved.append(p)
        poles = kept
    for p in moved:
        close = [q for q in poles if q is not p and distance((p['x'], p['y']), (q['x'], q['y'])) < 9]
        if close or (safe is not None and not safe((p['x'], p['y']))):
            raise RuntimeError(f'corrected pole {p!r} is not safe or is within 9 m of {close!r}')
    return poles


def place_poles(roads, net, buildings, safe, VILLAGE, public_poles=None, unpowered=None, corrections=()):
    """`unpowered`: unpowered_tracks entries (AREA.unpowered_tracks when None). Public roads are unaffected.
    `corrections`: AREA.public_pole_corrections, applied after the public pass and before the kind-4 runs, so a full
    bake and a power-only bake on corrected land place the same kind-4 poles. The default keeps the frozen pass."""
    unpowered = unpowered_roads(net, AREA.unpowered_tracks if unpowered is None else unpowered)
    # Public endpoint-to-segment joins also cover T junctions and split road pieces.
    corners = collections.defaultdict(list)
    for r in roads:
        if not public(r) or r['bridge']:
            continue
        for k in (0, -1):
            p = r['pts'][k]
            hit = net.nearest(p, 3, lambda q: public(q) and q['id'] != r['id'])
            if hit:
                corners[r['id']].append(12 if k == 0 else r['cum'][-1] - 12)
                if not hit['road']['bridge']:
                    corners[hit['road']['id']].extend([hit['s'] - 12, hit['s'] + 12])
    poles = [] if public_poles is None else list(public_poles)
    occupied = collections.defaultdict(list)
    for p in poles:
        occupied[math.floor(p['x'] / 16), math.floor(p['y'] / 16)].append((p['x'], p['y']))
    # Finish the unchanged public pass first: kind-4 candidates cannot displace its poles.
    extensions = []
    for r in roads:
        if not pole_track(r) or r['id'] in unpowered:
            continue
        local_net = Network([r])
        # About 60 m, with 15 m allowance for mapped setbacks (River Denys's last house is 72.6 m).
        hits = [h['s'] for b in buildings if (h := local_net.nearest((b['x'], b['y']), 75))]
        if not hits:
            continue
        # Provincial pieces may run in either direction. Feed from their connected public end.
        joined = [net.nearest(p, 12, public) is not None for p in (r['pts'][0], r['pts'][-1])]
        lo = 0 if joined[0] else min(hits)
        hi = r['cum'][-1] if joined[1] else max(hits)
        extensions.append((r, lo, hi))
    runs = ([] if public_poles is not None else [(r, 0, r['cum'][-1]) for r in roads if public(r) and not r['bridge']]) + extensions
    for k, (r, lo, hi) in enumerate(runs):
        if corrections and k == len(runs) - len(extensions):
            # The public pass is done: correct it, then let the kind-4 runs see only the corrected poles.
            poles = correct_public_poles(net, poles, corrections, safe)
            occupied = collections.defaultdict(list)
            for p in poles:
                occupied[math.floor(p['x'] / 16), math.floor(p['y'] / 16)].append((p['x'], p['y']))
        spacing = 55 if r['kind'] == 1 else 65
        local = random.Random(SEED + r['id'] * 101)
        side = local.choice((-1, 1))
        ss = sorted({max(3, min(r['cum'][-1] - 3, s)) for s in corners[r['id']]})
        ss += [float(s) for s in range(20, math.floor(r['cum'][-1]), spacing)
               if all(abs(s - c) >= 22 for c in ss)]
        if r['kind'] == 4:
            lo, hi = max(3, lo), min(r['cum'][-1] - 3, hi)
            if hi < lo:
                continue
            ss = [s for s in ss if lo <= s <= hi]
            # An end pole reaches the last building without continuing into empty land.
            ss = [s for s in ss if hi - s >= 15] + [hi]
        placed = []
        for s in sorted(ss):
            if placed and s - placed[-1][0] < 15:
                continue
            for candidate_side in (side, -side):
                p, u = shifted(r, s, candidate_side, 3.2)
                key = (math.floor(p[0] / 16), math.floor(p[1] / 16))
                close = [q for dx in (-1, 0, 1) for dy in (-1, 0, 1) for q in occupied[key[0] + dx, key[1] + dy]]
                if safe(p) and all(distance(p, q) >= 9 for q in close):
                    placed.append((s, dict(x=round(p[0], 3), y=round(p[1], 3), heading=heading(u),
                                          road=r['id'], transformer=local.randrange(6) == 0,
                                          light=distance(p, VILLAGE) < 700 and local.randrange(10) == 0)))
                    occupied[key].append(p)
                    break
        for n, (_, pole) in enumerate(placed):
            poles.append(dict(**pole, n=n))
    if corrections and not extensions:
        poles = correct_public_poles(net, poles, corrections, safe)
    return poles

def powered_buildings(buildings, area):
    """One property, possibly several real roof blocks; sheds, barns, tanks and the church get no drop."""
    groups = collections.defaultdict(list)
    for b in buildings:
        groups[b.get('buildingId', b['id'])].append(b)
    if area == 'judique':
        # The game replaces this surveyed envelope by its owner-measured church model. The church has no power
        # (Dan, 21 Nov 2026), so neither the envelope nor the model gets a drop, whatever kind the survey gives it.
        groups = {k: bs for k, bs in groups.items() if not any(
            distance((b.get('site', b)['x'], b.get('site', b)['y']), (630844.2, 5080637.2)) <= 8 for b in bs)}
    return {k: bs for k, bs in groups.items() if any(
        b['kind'] in ('house', 'large') and b.get('shape') != 'tank' for b in bs)}


def roof_edge(b, pole, styles):
    """A long-wall roof seam in the renderer's axis frame, at its actual roof height."""
    a = math.radians(b['axisDeg'])
    sin, cos = math.sin(a), math.cos(a)
    dx, dy = pole['x'] - b['x'], pole['y'] - b['y']
    u = max(-b['length'] / 2, min(b['length'] / 2, dx * sin + dy * cos))
    side = 1 if dx * cos - dy * sin >= 0 else -1
    v = side * b['width'] / 2
    paint = styles.get(str(b.get('buildingId', b['id'])), {})
    roof = paint.get('roofShape', b['roof'])
    if 'buildingId' in b:
        roof = 'flat' if roof == 'flat' or b['roof'] == 'flat' else 'gable'
    height = b['ridge'] if roof == 'flat' or roof == 'shed' and side == 1 else b['eave']
    return dict(x=round(b['x'] + u * sin + v * cos, 3), y=round(b['y'] + u * cos - v * sin, 3),
                height=round(height, 3), ground=b['ground'],
                groundX=b.get('groundX', b['x']), groundY=b.get('groundY', b['y']))


def crosses_highway(net, a, b):
    """Strict centre-line crossing, including a bend or a highway other than the nearest road."""
    segments = set()
    for x in range(math.floor(min(a[0], b[0]) / 128), math.floor(max(a[0], b[0]) / 128) + 1):
        for y in range(math.floor(min(a[1], b[1]) / 128), math.floor(max(a[1], b[1]) / 128) + 1):
            segments.update(net.cells[x, y])
    def cross(p, q, r):
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
    for rid, i in segments:
        r = net.roads[rid]
        if r['kind'] != 1:
            continue
        c, d = r['pts'][i:i + 2]
        if (max(min(a[0], b[0]), min(c[0], d[0])) <= min(max(a[0], b[0]), max(c[0], d[0]))
                and max(min(a[1], b[1]), min(c[1], d[1])) <= min(max(a[1], b[1]), max(c[1], d[1]))
                and cross(a, b, c) * cross(a, b, d) <= 0 and cross(c, d, a) * cross(c, d, b) <= 0):
            return True
    return False


def service_drops(net, poles, buildings, area, styles):
    cells = collections.defaultdict(list)
    for p in poles:
        cells[math.floor(p['x'] / 64), math.floor(p['y'] / 64)].append(p)
    drops = []
    for bid, blocks in sorted(powered_buildings(buildings, area).items()):
        choices = []
        for b in blocks:
            if b.get('shape') == 'tank':
                continue
            reach = 45 + math.hypot(b['length'], b['width']) / 2
            cx, cy = math.floor(b['x'] / 64), math.floor(b['y'] / 64)
            span = math.ceil(reach / 64)
            near = net.nearest((b['x'], b['y']), reach, lambda r: r['kind'] <= 4)
            for x in range(cx - span, cx + span + 1):
                for y in range(cy - span, cy + span + 1):
                    for p in cells[x, y]:
                        end = roof_edge(b, p, styles)
                        d = distance((p['x'], p['y']), (end['x'], end['y']))
                        if d > 45 or d < .5:
                            continue
                        same = True
                        if near:
                            q, u = near['p'], near['u']
                            side = lambda x, y: u[0] * (y - q[1]) - u[1] * (x - q[0])
                            same = side(b['x'], b['y']) * side(p['x'], p['y']) >= 0
                        crossing = crosses_highway(net, (p['x'], p['y']), (end['x'], end['y']))
                        choices.append((crossing, not same, d, p['road'], p['n'], b['id'], end))
        if choices:
            _, _, _, road, n, _, end = min(choices, key=lambda c: c[:6])
            drops.append(dict(building=bid, road=road, n=n, **end))
    return drops


def main(output=None, report_dir=None, power_only=False):
    VILLAGE = AREA.bake_anchor
    manifest_path = OUT / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    bounds = manifest['mid']
    road_file = json.loads((OUT / 'roads.json').read_text())
    roads = props_view(road_file['roads'], AREA.props_driveways)
    buildings = json.loads((OUT / 'buildings.json').read_text())['buildings']
    if power_only:
        styles = json.loads((OUT / 'building-styles.json').read_text())['styles']
    elif AREA.observed_styles:
        # Full bakes run step 29 before step 30. Derive the same styles in memory, without writing step-30 output.
        spec = importlib.util.spec_from_file_location('props_building_styles', ROOT / 'pipeline/30_bake_building_styles.py')
        style_bake = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(style_bake)
        observed = json.loads((ROOT / AREA.observed_styles).read_text())
        styles = style_bake.bake(buildings, road_file['roads'], observed)['styles']
    else:
        styles = {}
    output = OUT if output is None else Path(output)
    report_dir = AREA.overview if report_dir is None else Path(report_dir)
    output.mkdir(parents=True, exist_ok=True)
    net = Network(roads)
    # The lines before the road bed move, for every choice about a mailbox (place_mailboxes). No move: the same lines.
    before = road_ground.lines_before(road_file, AREA.overview)
    ref = Network([dict(r, pts=before[r['id']]) if r['id'] in before else r for r in roads]) if before else net
    # A 4 m DTM is enough for a conservative water veto, and uses about 64 MB.
    dtm = gdal.Warp('', str(AREA.elevation("dtm")),
                    format='MEM', dstSRS='EPSG:2961', outputBounds=bounds, xRes=4, yRes=4,
                    resampleAlg='bilinear', dstNodata=-32767, warpMemoryLimit=64 * 1024 * 1024)
    heights = dtm.ReadAsArray()
    gt = dtm.GetGeoTransform()
    # Keep the former roof envelope excluded too: opening an inner corner must
    # not invite invented props into it. New wings also exclude their real walls.
    exclusions = buildings + [b['site'] for b in buildings if 'site' in b]
    building_boxes, in_large = building_exclusions(exclusions)
    bridges = [p for r in roads if r['bridge'] for p in (r['pts'][0], r['pts'][-1])]

    def safe(p, bridge=True, on=net):
        x, y = p
        c, row = int((x - gt[0]) / gt[1]), int((y - gt[3]) / gt[5])
        if not (bounds[0] <= x <= bounds[2] and bounds[1] <= y <= bounds[3]):
            return False
        if not (0 <= row < heights.shape[0] and 0 <= c < heights.shape[1]) or heights[row, c] <= -.2:
            return False
        if any(a <= x <= c and b <= y <= d for a, b, c, d in building_boxes) or in_large(x, y):
            return False
        if bridge and any(distance(p, q) < 12 for q in bridges):
            return False
        # At junctions the shoulder of one road can be the middle of another.
        h = on.nearest(p, 14, public)
        return h is None or h['dist'] >= h['road']['halfWidth'] + 1.0

    def cabinets(net):
        rng = random.Random(SEED)
        # Six sites, placed from the driver's notes and photos (10 Nov 2026) and checked against the provincial aerial
        # photo by eye. Each entry: a landmark point (EPSG:2961), the road, and whether the cabinets stand on the
        # landmark's side of the road ('same') or across from it ('across'). Positions only; no addresses.
        def near(point, name, toward):
            hit = net.nearest(point, 300, lambda r: r['name'] == name and not r['bridge'])
            if hit is None:
                raise ValueError(f'No {name} near {point}')
            r, at = hit['road'], hit['s']
            here, ahead = net.at(r, at)[0], net.at(r, min(r['cum'][-1], at + 2))[0]
            if distance(here, ahead) < 0.5:
                ahead, here = here, net.at(r, max(0, at - 2))[0]
            # Which side of the road is the landmark on?  Cross product of the road direction and the way to it.
            cross = (ahead[0] - here[0]) * (point[1] - here[1]) - (ahead[1] - here[1]) * (point[0] - here[0])
            hit['sides'] = (1, -1) if (cross > 0) == (toward == 'same') else (-1, 1)   # side 1 is the left of the road's direction
            return hit

        targets = [dict(site) if 'exact' in site else near(site['point'], site['road'], site['toward'])
                   for site in AREA.community_sites]
        community = []
        for site, hit in zip(AREA.community_sites, targets):
            if hit is None:
                continue
            if 'exact' in hit:
                # Not on a shoulder: the cabinets stand where the driver says they stand.
                # The game's buildings are rectangles fitted to roofs, a little larger or smaller than the real walls.
                # Step out along the facing direction until the cabinets stand clear of every rectangle.
                x, y = hit['exact']
                ux, uy = math.sin(math.radians(hit['heading'])), math.cos(math.radians(hit['heading']))

                def in_building(px, py, pool=exclusions):
                    for b in pool:
                        if abs(b['x'] - px) > 80 or abs(b['y'] - py) > 80:
                            continue
                        f, odd = b['footprint'], False
                        for i in range(len(f)):
                            (x1, y1), (x2, y2) = f[i], f[(i + 1) % len(f)]
                            if (y1 > py) != (y2 > py) and px < (x2 - x1) * (py - y1) / (y2 - y1) + x1:
                                odd = not odd
                        if odd:
                            return True
                    return False

                moved = 0.0
                if hit.get('flush'):
                    # Measured flat against a real wall: the point behind the cabinets is inside that building, and
                    # the cabinets stand inside its former roof envelope, by design; so no step-out. Their pad (web/src/
                    # props.ts: modules x 0.86 + 0.35 m wide, 1.10 m deep, centred on the site) must still stand
                    # outside every building's walls, at its centre and all four corners.
                    half_w, half_d = (hit['modules'] * 0.86 + 0.35) / 2, 0.55
                    pad = [(x, y)] + [(x + a * half_w * uy + b * half_d * ux, y - a * half_w * ux + b * half_d * uy)
                                      for a in (-1, 1) for b in (-1, 1)]
                    if any(in_building(px, py, buildings) for px, py in pad):
                        raise ValueError(f'Flush community site {hit["exact"]} has its pad inside a building')
                while not hit.get('flush') and moved < 30 and (in_building(x, y) or in_building(x - ux * 0.9, y - uy * 0.9)):
                    x, y, moved = x + ux * 0.5, y + uy * 0.5, moved + 0.5
                community.append(dict(x=round(x, 2), y=round(y, 2), heading=hit['heading'], modules=hit['modules']))
                continue
            r, s = hit['road'], hit['s']
            # Set cabinets back from corners and bridges, still on the named shoulder.
            chosen = None
            for delta in (0, 15, -15, 30, -30, 45, -45, 65, -65):
                for side in hit.get('sides', (1, -1))[:1] if delta in (0, 15, -15, 30, -30) else hit.get('sides', (1, -1)):
                    at = max(0, min(r['cum'][-1], s + delta))
                    obj = site_position(r, at, side, 2.3)
                    if not r['bridge'] and safe((obj['x'], obj['y']), on=net):
                        chosen = dict(**obj, modules=rng.randint(2, 4))
                        break
                if chosen:
                    break
            if chosen is None:
                # A named junction can lie on a short bridge segment. Use its bank.
                h = net.nearest(hit.get('p', net.at(r, s)[0]), 150,
                                lambda q: q['name'] == r['name'] and not q['bridge'])
                if h:
                    for delta in (20, -20, 40, -40):
                        for side in (1, -1):
                            obj = site_position(h['road'], h['s'] + delta, side, 2.3)
                            if safe((obj['x'], obj['y']), on=net):
                                chosen = dict(**obj, modules=rng.randint(2, 4))
                                break
                        if chosen:
                            break
            if chosen is None:
                raise ValueError(f'No safe community shoulder at {r["name"]}')
            if 'modules' in site:
                # Counted on site. The draw above still happens, so every later site keeps its count.
                chosen['modules'] = site['modules']
            community.append(chosen)
        return community

    community = cabinets(net)

    # One mailbox candidate per original property; wing geometry only excludes props.
    sites = [b.get('site', b) for b in buildings if b.get('buildingId', b['id']) == b['id']]
    if power_only:
        previous = json.loads((OUT / 'props.json').read_text())
        mailboxes, community = previous['mailboxes'], previous['communityBoxes']
        mail_report = []
    else:
        mailboxes, mail_report = place_mailboxes(net, ref, sites, community, community if ref is net else cabinets(ref), safe,
                                            VILLAGE, AREA.mailbox_exclusion_radius, AREA.no_box_sites)
    inside = boxes_in_sites(mailboxes + community, AREA.no_box_sites)
    if inside:
        raise RuntimeError(f'{len(inside)} box(es) stand inside a no-box site (AREA.no_box_sites): '
                           f'{[(m["x"], m["y"]) for m in inside]}')

    # A power-only delta keeps the installed public poles even if another stage has since changed its inputs.
    public_poles = [p for p in previous['poles'] if public(net.roads[p['road']])] if power_only else None
    # AREA.public_pole_corrections: the documented exception to the frozen public pass, where a drive filmed the line.
    poles = place_poles(roads, net, buildings, safe, VILLAGE, public_poles, corrections=AREA.public_pole_corrections)
    drops = service_drops(net, poles, buildings, AREA.id, styles)

    result = dict(crs='EPSG:2961', mailboxes=mailboxes, communityBoxes=community, poles=poles, serviceDrops=drops)
    # Explicit schema prevents an upstream identity field from leaking through.
    assert all(set(m) == {'x', 'y', 'heading', 'style', 'tilt', 'group', 'parcelBox'} for m in mailboxes)
    frames = collections.defaultdict(list)
    for mailbox in mailboxes:
        if mailbox['group'] is not None:
            frames[mailbox['group']].append(mailbox)
    for members in frames.values():
        assert 2 <= len(members) <= 6
        for a, b in zip(members, members[1:]):
            assert abs(distance((a['x'], a['y']), (b['x'], b['y'])) - .6) < .002
    assert len(community) == len(AREA.community_sites)
    assert all(safe((p['x'], p['y'])) for p in poles if not power_only or not public(net.roads[p['road']]))
    (output / 'props.json').write_text(json.dumps(result, separators=(',', ':'), allow_nan=False) + '\n')
    # Other bake stages own other keys. Re-read immediately before this one-key update.
    manifest = json.loads(manifest_path.read_text())
    manifest['props'] = dict(file='props.json', mailboxes=len(mailboxes), poles=len(poles), serviceDrops=len(drops))
    (output / 'manifest.json').write_text(json.dumps(manifest, separators=(',', ':')) + '\n')
    report_dir.mkdir(parents=True, exist_ok=True)
    (report_dir / 'props-report.json').write_text(
        json.dumps(dict(roadsMovedByBed=len(before), mailboxes=mail_report, mailboxesPreserved=power_only), separators=(',', ':')) + '\n')
    print(f"Props: {len(mailboxes)} rural mailboxes, {len(community)} community sites, {len(poles)} poles, {len(drops)} service drops; "
          f"{len({m['group'] for m in mailboxes if m['group'] is not None})} shared frames", flush=True)
    print(f"Mailboxes: decided on the road lines before the bed move ({len(before)} roads moved); "
          f"{sum(m['how'] == 'again' for m in mail_report)} placed again because the kept place is not safe now", flush=True)


if __name__ == '__main__':
    main()
