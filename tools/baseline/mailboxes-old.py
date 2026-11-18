"""Frozen: the mailbox rule of pipeline/29_bake_props.py as it was on main at 3cdc83f, before a road bed move was
kept apart from the choices. Never edit (README.md here). tools/mail-places-check.py compares today's rule with it.

Every line below the imports is that file's own text: its helpers, and in `old_rule` the driveway and mailbox part of
its main(), unchanged. Only the `def old_rule` line, the `public` line (moved from higher up in main()) and the
`return` are added.
"""
import bisect
import collections
import math
import random

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


def old_rule(net, roads, buildings, community, safe, VILLAGE, AREA):
    public = lambda r: r['kind'] <= 3
    # Driveway mouths must join the public road and actually lead toward the property.
    driveways = []
    for r in roads:
        if r['kind'] != 4:
            continue
        for k in (0, -1):
            p = r['pts'][k]
            hit = net.nearest(p, 12, lambda q: public(q) and not q['bridge'])
            if hit:
                driveways.append((r, k, hit))

    # One mailbox candidate per original property; wing geometry only excludes props.
    sites = [b.get('site', b) for b in buildings if b.get('buildingId', b['id']) == b['id']]
    houses = [b for b in sites if b['kind'] == 'house']
    pending = collections.defaultdict(list)
    for b in sites:
        home = (b['x'], b['y'])
        if b['kind'] != 'house' and (b['kind'] != 'barn' or any(distance(home, (h['x'], h['y'])) < 60 for h in houses)):
            continue
        if distance(home, VILLAGE) < AREA.mailbox_exclusion_radius or any(distance(home, (c['x'], c['y'])) < 120 for c in community):
            continue
        hit = net.nearest(home, 250, public)
        if hit is None or hit['road']['bridge']:
            continue
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
        pending[r['id']].append(dict(s=s + 2.5, side=side, dist=hit['dist'], id=b['id']))

    mailboxes, group_id = [], 0
    for rid, entries in sorted(pending.items()):
        r = net.roads[rid]
        entries.sort(key=lambda m: (m['s'], m['id']))
        while entries:
            nearby = [m for m in entries[:6] if m['s'] - entries[0]['s'] <= 60]
            mixed = len({m['side'] for m in nearby}) > 1
            cluster = nearby if mixed else [m for m in nearby if m['s'] - entries[0]['s'] < 3]
            anchor = min(cluster, key=lambda m: (m['dist'], m['id']))
            grouped = len(cluster) > 1
            positions = []
            if grouped:
                # One straight frame: curved offsets and clamped road ends must
                # never collapse two boxes onto the same location.
                half_span = (len(cluster) - 1) * .3
                for delta in (0, 5, -5, 10, -10, 20, -20):
                    centre_s = max(half_span + 1, min(r['cum'][-1] - half_span - 1, anchor['s'] + delta))
                    centre = site_position(r, centre_s, anchor['side'])
                    _, u = net.at(r, centre_s)
                    trial = [dict(x=round(centre['x'] + u[0] * (i * .6 - half_span), 3),
                                  y=round(centre['y'] + u[1] * (i * .6 - half_span), 3),
                                  heading=centre['heading']) for i in range(len(cluster))]
                    if all(safe((obj['x'], obj['y'])) for obj in trial):
                        positions = trial
                        break
                if not positions:
                    grouped = False
            if grouped:
                group_id += 1
            else:
                positions = [site_position(r, m['s'], m['side']) for m in cluster]
            for m, obj in zip(cluster, positions):
                # Keep invented objects out of junction lanes, buildings and water.
                if safe((obj['x'], obj['y'])):
                    local = random.Random(SEED + m['id'])
                    mailboxes.append(dict(**obj, style=local.randrange(6), tilt=round(local.uniform(-4, 4), 2),
                                          group=group_id if grouped else None, parcelBox=local.randrange(6) == 0))
                entries.remove(m)
    return mailboxes
