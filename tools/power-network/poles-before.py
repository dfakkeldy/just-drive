"""Frozen pole rule from 868f823e, before issue 1210. Never edit this oracle."""
import collections
import math
import random

def place_poles(roads, net, safe, VILLAGE, SEED, public, shifted, heading, distance):
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
    poles = []
    occupied = collections.defaultdict(list)
    for r in roads:
        if not public(r) or r['bridge']:
            continue
        spacing = 55 if r['kind'] == 1 else 65
        local = random.Random(SEED + r['id'] * 101)
        side = local.choice((-1, 1))
        ss = sorted({max(3, min(r['cum'][-1] - 3, s)) for s in corners[r['id']]})
        ss += [float(s) for s in range(20, math.floor(r['cum'][-1]), spacing)
               if all(abs(s - c) >= 22 for c in ss)]
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

    return poles
