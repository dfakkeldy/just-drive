#!/usr/bin/env python3
"""Rules of the optional road-shaped ground (pipeline/road_ground.py), on made-up land. No GDAL, no baked data.

Each rule is tested, and then broken on purpose (--mutations, also run by default) to prove the test can fail.
"""
import copy
from functools import cache
import json
import os
import re
import subprocess
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'pipeline'))
import road_ground as rg  # noqa: E402

BED_X, GRADE, SIDE = 104.0, 0.05, 0.30


def sidehill(x, y):
    """A hill falling east at 30 %, a level 9 m bed centred on x = 104, and a 5 % climb to the north."""
    x, y = np.asarray(x, dtype=float), np.asarray(y, dtype=float)
    w = rg.smoothstep(4.5, 7.5, np.abs(x - BED_X))
    return 50 * (1 - w) + (50 - SIDE * (x - BED_X)) * w + GRADE * y


def field(x, y):
    return 20 + 0.01 * np.asarray(x, dtype=float) + GRADE * np.asarray(y, dtype=float)


class Land:
    def __init__(self, f):
        self.f = f

    def at(self, x, y):
        return self.f(x, y) + 0.0 * (np.asarray(x) + np.asarray(y))


def road(rid, pts, kind=3, bridge=False):
    return dict(id=rid, name=f'Road {rid}', kind=kind, halfWidth={1: 3.6, 2: 3.0, 3: 2.6, 4: 1.5, 5: 1.6}[kind], bridge=bridge,
                washboard=False, pts=[[float(x), float(y)] for x, y in pts])


def grid(f, x0=0.0, ytop=450.0, shape=(500, 300)):
    yy, xx = np.mgrid[0:shape[0], 0:shape[1]]
    return f(x0 + xx, ytop - yy).astype(np.float32), x0, ytop


def network():
    return [road(1, [(100, y) for y in range(0, 401, 4)]),
            road(2, [(100 - x, 200) for x in range(0, 81, 4)]),
            road(3, [(100 - x, 300) for x in range(0, 61, 4)], kind=4)]


def check_bed():
    roads = network()
    report = rg.move_to_bed(roads, Land(sidehill))
    main = np.array(roads[0]['pts'])
    assert 3.0 <= main[len(main) // 2, 0] - 100 <= 4.6, f'the line must move onto the bed (moved {main[len(main) // 2, 0] - 100:.2f} m)'
    assert np.abs(np.diff(main[:, 0], 2)).max() < 0.05, 'the moved line must stay smooth'
    side_end, far_end = roads[1]['pts'][0], roads[1]['pts'][-1]
    assert abs(side_end[0] - main[50, 0]) < 0.05, 'a side road must still end on the road it joins'
    assert far_end == [20.0, 200.0], 'the far end of the side road must stay'
    assert abs(roads[2]['pts'][0][0] - main[75, 0]) < 0.05 and roads[2]['pts'][-1] == [40.0, 300.0], 'a track keeps its line but follows the road at its mouth'
    assert report['roadsMoved'] == 3
    for now, was in zip(roads, network()):
        assert {k: v for k, v in now.items() if k != 'pts'} == {k: v for k, v in was.items() if k != 'pts'} and len(now['pts']) == len(was['pts']), \
            'only the positions of the points change: ids, names, kinds, widths, flags and point counts stay'
    flat = network()
    assert rg.move_to_bed(flat, Land(field))['roadsMoved'] == 0 and flat == network(), 'level land has no clear bed: nothing moves'
    cut = network()
    rg.move_to_bed(cut, Land(sidehill), box=(0.0, 0.0, 300.0, 400.0))
    ends = np.array(cut[0]['pts'])[[0, -1]]
    assert ends.tolist() == [[100.0, 0.0], [100.0, 400.0]] and np.array(cut[0]['pts'])[50, 0] > 103, 'an end on the edge of the area stays; the middle still moves'
    # A 10 m road between the moved main road and a bridge: one end goes with the road, the other stays at the bridge.
    short = [network()[0], road(2, [(100, 200), (95, 200), (90, 200)]), road(3, [(90, 200), (60, 200)], bridge=True)]
    rg.move_to_bed(short, Land(sidehill))
    assert abs(short[1]['pts'][0][0] - np.array(short[0]['pts'])[50, 0]) < 0.05, 'a short road still ends on the road it joins'
    assert short[1]['pts'][-1] == [90.0, 200.0] and short[2]['pts'] == [[90.0, 200.0], [60.0, 200.0]], 'and its other end stays at the bridge'
    # Two roads that meet on the edge of the area: the cut stays, joined or not.
    corner = [network()[0], road(2, [(100 - x, 0) for x in range(0, 81, 4)])]
    rg.move_to_bed(corner, Land(sidehill), box=(0.0, 0.0, 300.0, 400.0))
    assert corner[0]['pts'][0] == [100.0, 0.0] and corner[1]['pts'][0] == [100.0, 0.0], 'ends that meet on the edge of the area stay'
    # A keep box round a hand-built place: no point inside it moves, and the move comes back smoothly outside.
    box = (60.0, 150.0, 140.0, 250.0)
    place = network()
    rg.move_to_bed(place, Land(sidehill), keep=[box])
    for now, was in zip(place, network()):
        a, b = np.array(now['pts']), np.array(was['pts'])
        inside = (b[:, 0] >= box[0]) & (b[:, 0] <= box[2]) & (b[:, 1] >= box[1]) & (b[:, 1] <= box[3])
        assert np.array_equal(a[inside], b[inside]), 'no road point inside a keep box moves'
    main = np.array(place[0]['pts'])
    assert main[10, 0] > 103 and np.abs(np.diff(main[:, 0])).max() < 0.8, 'outside the box the road moves, and it eases back to the box'
    # A box that holds a junction but none of the through road's points: the whole piece of line through the box
    # stays, and the side road still ends on it.
    sparse = [road(1, [(100, 0), (100, 60), (100, 120), (100, 180), (100, 220), (100, 280), (100, 340), (100, 400)]),
              road(2, [(100 - x, 200) for x in range(0, 81, 4)])]
    rg.move_to_bed(sparse, Land(sidehill), keep=[(90.0, 195.0, 110.0, 205.0)])
    assert sparse[0]['pts'][3] == [100.0, 180.0] and sparse[0]['pts'][4] == [100.0, 220.0] and sparse[1]['pts'][0] == [100.0, 200.0], \
        'a piece of line that passes through a keep box stays, and the junction in the box stays whole'
    assert sparse[0]['pts'][1][0] > 102, 'while the same road moves away from the box'
    # Everywhere, with a box or without: the end of a side road lies on the moved through road.
    for boxes in ((), [box], [(90.0, 195.0, 110.0, 205.0)], [(60.0, 205.0, 140.0, 260.0)]):
        joined = network()
        rg.move_to_bed(joined, Land(sidehill), keep=boxes)
        through = rg.Line(joined[0]['pts'])
        for side in joined[1:]:
            gap = through.nearest(*side['pts'][0])[0]
            assert gap < 0.02, f'a side road ends on the through road ({gap:.3f} m off with keep boxes {boxes})'
    # Chains of junctions settle, however long: every side road's end lies on its through road's final line.
    def side_gaps(before, after):
        lines = [rg.Line(r['pts']) for r in before]
        final = [rg.Line(r['pts']) for r in after]
        return [final[m].nearest(*after[n]['pts'][0 if end == 0 else -1])[0]
                for (n, end), others in rg.joins(before, lines).items() for m, _, at_end in others if at_end is None]
    chain = [road(1, [(60, 160), (0, 160)]), road(2, [(60, 200), (60, 120)]), road(3, [(100, 200), (20, 200)]), road(4, [(100, y) for y in range(0, 401, 4)])]
    moved = copy.deepcopy(chain)
    rg.move_to_bed(moved, Land(sidehill))
    gaps = side_gaps(chain, moved)
    assert len(gaps) == 3 and max(gaps) < 0.02 and moved[1]['pts'][0][0] > 61, f'a chain of three junctions stays joined ({max(gaps):.3f} m)'
    # A held place at the far end of a chain of six roads: nothing that must stay with it moves.
    six = [road(1, [(100, 0), (100, 80)]), road(2, [(100, 40), (180, 40)]), road(3, [(140, 40), (140, 120)]),
           road(4, [(140, 80), (220, 80)]), road(5, [(180, 80), (180, 160)]), road(6, [(180, 120), (260, 200)])]
    held = copy.deepcopy(six)
    rg.move_to_bed(held, Land(sidehill), keep=[(219.0, 159.0, 221.0, 161.0)])
    assert held[5]['pts'] == six[5]['pts'] and max(side_gaps(six, held)) < 0.02, 'a piece of line in a keep box stays, at the end of any chain'
    # A line that repeats its end point is held like any other.
    twice = [road(1, [(100, y) for y in range(0, 401, 4)]), road(2, [(100, 200), (100, 200), (20, 120)])]
    stay = copy.deepcopy(twice)
    rg.move_to_bed(stay, Land(sidehill), keep=[(49.0, 149.0, 51.0, 151.0)])
    assert stay[1]['pts'] == twice[1]['pts'] and max(side_gaps(twice, stay)) < 0.02, 'a repeated end point does not slip past a keep box'
    # A box thinner than the distance between two test points still holds the piece of line that crosses it.
    thin = [road(1, [(100, 0), (100, 180.1), (100, 220.1), (100, 400)])]
    rg.move_to_bed(thin, Land(lambda x, y: sidehill(np.asarray(x, dtype=float) - 3, y)), keep=[(90.0, 200.59, 110.0, 200.61)])
    assert thin[0]['pts'][1] == [100.0, 180.1] and thin[0]['pts'][2] == [100.0, 220.1], 'a piece of line that crosses a thin box does not move at all'
    bridged = network()
    bridged[0]['bridge'] = True
    rg.move_to_bed(bridged, Land(sidehill))
    assert bridged[0]['pts'] == network()[0]['pts'], 'a bridge never moves'
    assert bridged[1]['pts'] == network()[1]['pts'], 'a road that ends at a bridge stays there'


def check_nodes():
    # A junction is decided once for all the ends that meet there. (Each end used to decide for itself.)
    # A ring: a street that ends where it starts, with another street's end at that point. The three ends stay one point.
    ring = [road(1, [(100, y) for y in range(200, 301, 4)] + [(x, 300) for x in range(96, 39, -4)] +
                 [(40, y) for y in range(296, 199, -4)] + [(x, 200) for x in range(44, 101, 4)], kind=2),
            road(2, [(100, 200), (140, 200), (180, 200)], kind=2)]
    closed = copy.deepcopy(ring)
    report = rg.move_to_bed(closed, Land(sidehill))
    assert closed[0]['pts'][0] == closed[0]['pts'][-1] == closed[1]['pts'][0], \
        f"a ring still ends where it starts, and so does the street that meets it there ({closed[0]['pts'][0]}, {closed[0]['pts'][-1]}, {closed[1]['pts'][0]})"
    assert closed[0]['pts'][12][0] > 102 and closed[0]['pts'][0] != ring[0]['pts'][0], 'while the ring moves onto its bed'
    assert report['junctions']['whole'] and report['junctions']['endsApart'] == 0
    alone = [copy.deepcopy(ring[0])]
    rg.move_to_bed(alone, Land(sidehill))
    assert alone[0]['pts'][0] == alone[0]['pts'][-1] != ring[0]['pts'][0], 'a ring with nothing else at its closing point stays closed too'
    # ... and one height: the ground of a ring has no step where it closes, and does not fade out there.
    slope = lambda x, y: 30 + 0.08 * np.asarray(x, dtype=float) + 0.06 * np.asarray(y, dtype=float)
    for roads in (ring, [ring[0]]):
        heights, _ = rg.profiles(Land(slope), copy.deepcopy(roads))
        around = heights[1]
        assert around['open'] == [False, False] and abs(around['nodes'][0] - around['nodes'][1]) < 1e-9 and abs(around['z'][0] - around['z'][-1]) < 1e-9, \
            f"a ring has one height where it closes ({around['nodes']}, open {around['open']})"
        assert abs(around['z'][0] - slope(100, 200)) < 0.15 and all(abs(p['nodes'][0] - around['nodes'][0]) < 1e-9 for p in heights.values() if p['id'] == 2), \
            'near the ground there, and the street that meets it takes the same height'
    # A ring whose ends lie 2 m apart, with a street that meets the first of them only: still one height.
    wide = [road(1, [(0, 0), (0, 100), (100, 100), (100, 0), (2, 0)]), road(2, [(-2, 0), (-100, 0)])]
    heights, _ = rg.profiles(Land(lambda x, y: 50 + 0.1 * np.asarray(x, dtype=float) + 0.07 * np.asarray(y, dtype=float)), copy.deepcopy(wide))
    ends = heights[1]['nodes'] + [heights[2]['nodes'][0]]
    assert max(ends) - min(ends) < 1e-9 and heights[1]['open'] == [False, False], \
        f'the two ends of a ring take one height also when they lie apart, and so does the street that meets one of them ({ends})'
    # ... and on the side of a through road that only one of its ends reaches, both ends take that road's surface.
    tee = [road(1, [(0, 0), (0, 100), (100, 100), (100, 0), (2.4, 0)]), road(2, [(-2.4, -100), (-2.4, 100)], kind=2)]
    heights, _ = rg.profiles(Land(lambda x, y: 50 + 0.1 * np.asarray(x, dtype=float) + 0.07 * np.asarray(y, dtype=float)), copy.deepcopy(tee))
    assert heights[1]['tees'] == [True, True] and abs(heights[1]['nodes'][0] - heights[1]['nodes'][1]) < 0.3, \
        f"both ends of a ring run out on the through road that one of them reaches ({heights[1]['tees']}, {heights[1]['nodes']})"
    # ... and when one end meets a road at that road's end while the other lies on the same road's side, both ends
    # are judged alike (as ends that meet), not one as a meeting and one as a side road.
    mixed = [road(1, [(0, 0), (0, -100), (100, -100), (100, 0), (2, 0)]), road(2, [(-1, 1), (3, 1), (3, 100)], kind=2)]
    heights, _ = rg.profiles(Land(lambda x, y: 50 + 0.1 * np.asarray(x, dtype=float) + 0.07 * np.asarray(y, dtype=float)), copy.deepcopy(mixed))
    assert heights[1]['tees'] == [False, False] and abs(heights[1]['nodes'][0] - heights[1]['nodes'][1]) < 1e-9, \
        f"the two ends of a ring are judged alike ({heights[1]['tees']}, {heights[1]['nodes']})"
    # Ends that meet within the joining distance without lying on one point: one of them lies beside the through
    # road and the other does not. They are one node all the same, and move as one.
    loose = [road(1, [(100, y) for y in range(0, 401, 4)]), road(2, [(98.5, 200), (60, 200), (20, 200)], kind=4),
             road(3, [(96.2, 200.5), (60, 240)], kind=4)]
    one = copy.deepcopy(loose)
    rg.move_to_bed(one, Land(sidehill))
    step = [np.subtract(one[n]['pts'][0], loose[n]['pts'][0]) for n in (1, 2)]
    assert step[0][0] > 3 and np.abs(step[0] - step[1]).max() <= 0.011, f'ends that meet move as one ({step[0]}, {step[1]})'
    # A road that moves by less than 5 cm is written all the same: the road it ends on was moved to match it.
    faint = network()[:2] + [road(3, [(100, 300), (98, 297), (96, 294), (60, 260)], kind=4)]
    start = copy.deepcopy(faint)
    report = rg.move_to_bed(faint, Land(sidehill), keep=[(60.0, 190.0, 140.0, 295.0)])
    shift = np.abs(np.subtract(faint[2]['pts'], start[2]['pts'])).max(axis=1)
    assert 0.005 < shift[0] < 0.05 and shift[1:].max() == 0, f'the fixture: the track moves by a centimetre or two at its mouth only ({shift})'
    assert rg.Line(faint[0]['pts']).nearest(*faint[2]['pts'][0])[0] < 0.02, 'a road that moves by centimetres still ends on its through road'
    assert report['roadsMoved'] == 1, 'and so small a move is not listed'
    # A bridge that ends on the SIDE of a road: the road stays under the bridge's end and eases away from it.
    span = [road(1, [(100, y) for y in range(0, 401, 4)]), road(2, [(100, 200), (130, 200)], bridge=True)]
    pinned = copy.deepcopy(span)
    rg.move_to_bed(pinned, Land(sidehill))
    main = np.array(pinned[0]['pts'])
    assert pinned[1]['pts'] == span[1]['pts'] and main[50].tolist() == [100.0, 200.0] and main[51].tolist() == [100.0, 204.0], \
        'a road stays where a bridge ends on its side'
    assert main[20, 0] > 103 and np.abs(np.diff(main[:, 0])).max() < 0.8 and np.abs(np.diff(main[:, 0], 2)).max() < 0.3, \
        'and it eases away from there as gently as beside a keep box, with no kink'
    # A junction that one move cannot keep whole stays where it is, and the roads under it stay with it.
    # (1) A side road that ends where two through roads cross: it must not leave either of them.
    cross = [road(1, [(100, y) for y in range(0, 401, 4)], kind=1), road(2, [(60, 160), (140, 240)]), road(3, [(100, 200), (20, 200)])]
    both = copy.deepcopy(cross)
    report = rg.move_to_bed(both, Land(sidehill))
    off = [rg.Line(both[n]['pts']).nearest(*both[2]['pts'][0])[0] for n in (0, 1)]
    assert max(off) < 0.02, f'an end on two through roads stays on both ({off[0]:.3f} m and {off[1]:.3f} m off)'
    assert [h['why'] for h in report['junctionsHeld']] == ['on two through roads'] and both[0]['pts'][10][0] > 103, \
        'that junction is listed as held, and the road moves away from it'
    assert np.abs(np.diff(np.array(both[0]['pts'])[:, 0], 2)).max() < 0.3, 'easing away from it with no kink'
    # (2) Two side roads that end a little apart on one through road, where that road moves differently.
    for north in (12.4, 10.1):
        pair = [road(1, [(100, y) for y in range(0, 401, 4)], kind=1), road(2, [(100, 10), (40, 10)]), road(3, [(100, north), (40, 60)])]
        near = copy.deepcopy(pair)
        report = rg.move_to_bed(near, Land(sidehill), box=(0.0, 0.0, 300.0, 400.0))
        off = [rg.Line(near[0]['pts']).nearest(*near[n]['pts'][0])[0] for n in (1, 2)]
        assert max(off) < 0.015 and near[1]['pts'][0] == pair[1]['pts'][0] and near[2]['pts'][0] == pair[2]['pts'][0], \
            f'ends {north - 10:.1f} m apart on one through road stay on it ({off})'
        assert [h['why'] for h in report['junctionsHeld']] == ['on one through road at two places'] and near[0]['pts'][50][0] > 103
    # (2b) A road that comes back past its own start, with a side road that ends on it there. The side road's end and
    # the road's start are one node, and the side road lies on the side of a road of its own node: it goes with it.
    for dense in (False, True):
        back = ([road(1, [(100, y) for y in range(200, 301, 4)] + [(98, y) for y in range(300, -1, -4)]), road(2, [(98, 200), (20, 200)], kind=4)] if dense else
                [road(1, [(100, 200), (100, 300), (102, 300), (102, 0)]), road(2, [(102, 200), (20, 200)], kind=4)])
        home = copy.deepcopy(back)
        report = rg.move_to_bed(home, Land(sidehill))
        off = rg.Line(home[0]['pts']).nearest(*home[1]['pts'][0])[0]
        assert home[1]['pts'][0] != back[1]['pts'][0] and off < 0.015 and report['junctions']['sideEnds'] == 1, \
            f"a side road stays on a road that also has an end in its node ({off:.3f} m off; {report['junctions']})"
        assert not dense or home[1]['pts'][0][0] > 103.5, f"and it goes onto the bed with that road ({home[1]['pts'][0]})"
        left = copy.deepcopy(back)
        left[1]['pts'][0] = [back[1]['pts'][0][0] + 3.5, 200.0]
        assert not rg.junctions(back, left)['whole'], 'and the measure sees it when it does not'
    # (2c) A road that ends on its own side (the letter P): its end goes with its own line there.
    letter = [road(1, [(100, y) for y in range(0, 301, 4)] + [(x, 300) for x in range(96, 59, -4)] +
                   [(60, y) for y in range(296, 199, -4)] + [(x, 200) for x in range(64, 101, 4)])]
    stem = copy.deepcopy(letter)
    report = rg.move_to_bed(stem, Land(sidehill))
    tip = stem[0]['pts'][-1]
    off = rg.Line(stem[0]['pts'][:60]).nearest(*tip)[0]
    assert tip[0] > 103 and off < 0.015 and report['junctions']['sideEnds'] == 1, f'the end of a road that ends on its own side stays on it ({tip}, {off:.3f} m off)'
    torn = copy.deepcopy(stem)
    torn[0]['pts'][-1] = [100.0, 200.0]
    assert not rg.junctions(letter, torn)['whole'], 'and the measure sees it when it does not'
    # (3) The hold of a keep box is taken once: a side road whose first points lie close together keeps its line.
    bend = [road(1, [(100, y) for y in range(0, 401, 4)]),
            road(2, [(100, 200), (99.9, 199.9), (99, 199), (96, 196), (80, 180), (20, 120)], kind=4)]
    eased = copy.deepcopy(bend)
    rg.move_to_bed(eased, Land(sidehill), keep=[(90.0, 215.0, 110.0, 250.0)])
    step = np.subtract(eased[1]['pts'], bend[1]['pts'])
    length = np.hypot(*np.diff(np.array(bend[1]['pts']), axis=0).T)
    jump = np.hypot(*np.diff(step, axis=0).T) / length            # metres of move gained or lost per metre of road
    assert 0.3 < step[0][0] < 1.0 and np.abs(step[1] - step[0]).max() <= 0.03, f'a point 14 cm from a held end moves like that end ({step[0]}, {step[1]})'
    assert jump.max() < 0.4, f'and the move changes gently all along the side road (at most {jump.max():.2f} m per metre)'
    assert rg.Line(eased[0]['pts']).nearest(*eased[1]['pts'][0])[0] < 0.015
    # (4) Roads that end on each other's sides, in a circle: the moves are solved in one step, however long the roads.
    circle = [road(1, [(100, 0), (100, 2000)]), road(2, [(100, 3), (99, -2000)], kind=4)]
    round_ = copy.deepcopy(circle)
    report = rg.move_to_bed(round_, Land(sidehill))
    off = [rg.Line(round_[1 - n]['pts']).nearest(*round_[n]['pts'][0])[0] for n in (0, 1)]
    assert round_[0]['pts'][0][0] > 100.5 and max(off) < 0.015 and report['junctions']['whole'], \
        f"two roads that each start on the other's side move together ({round_[0]['pts'][0]}, {off})"
    # ... and a closed circle of short roads, which have no wish of their own to settle on, stays where it is.
    short = [road(1, [(100, 100), (110, 100)]), road(2, [(103, 101.5), (100, 101.5), (100, 98.5), (110, 98.5), (110, 101.5), (107, 101.5)])]
    still = copy.deepcopy(short)
    report = rg.move_to_bed(still, Land(sidehill))
    assert still == short and [h['why'] for h in report['junctionsHeld']] == ['in a closed circle of short roads'] * 4, \
        f"a closed circle of short roads stays ({report['junctionsHeld']})"
    # Heights: ends that meet take the mean of the ends they meet themselves. Three roads whose ends lie in a row,
    # 2 m apart, on a slope: the outer two do not meet, and each end keeps the height the rule gave before rings.
    slope3 = lambda x, y: 50 + 0.1 * np.asarray(x, dtype=float) + 0.07 * np.asarray(y, dtype=float)
    row = [road(1, [(0, 0), (0, -100)]), road(2, [(2, 0), (2, 100)]), road(3, [(4, 0), (100, 100)])]
    alone = [rg.profiles(Land(slope3), [copy.deepcopy(r)])[0][r['id']]['z'][0] for r in row]
    together, _ = rg.profiles(Land(slope3), copy.deepcopy(row))
    want = [np.mean([alone[0], alone[1]]), np.mean([alone[1], alone[0], alone[2]]), np.mean([alone[2], alone[1]])]
    got = [together[i]['nodes'][0] for i in (1, 2, 3)]
    assert np.abs(np.subtract(got, want)).max() < 1e-9 and got[0] < got[1] < got[2], f'ends in a row keep their own means ({got}, wanted {want})'
    # The measure that guards a real bake: it passes a whole network and fails a torn one.
    before = network()
    after = copy.deepcopy(before)
    rg.move_to_bed(after, Land(sidehill))
    assert rg.junctions(before, after)['whole'] and rg.junctions(before, after)['sideEnds'] == 2
    for name, tear in (('a side road that left its through road', lambda r: r[1]['pts'].__setitem__(0, [r[1]['pts'][0][0] - 0.5, 200.0])),
                       ('a road that gained a point', lambda r: r[2]['pts'].append([30.0, 300.0])),
                       ('a road with a new name', lambda r: r[2].__setitem__('name', 'Other'))):
        torn = copy.deepcopy(after)
        tear(torn)
        assert not rg.junctions(before, torn)['whole'], f'the measure must see {name}'
    slid = copy.deepcopy(cross)
    for point in slid[0]['pts'] + slid[2]['pts'][:1]:
        point[0] += 3.75
    assert rg.Line(slid[0]['pts']).nearest(*slid[2]['pts'][0])[0] == 0 and not rg.junctions(cross, slid)['whole'], \
        'the measure must see an end that stayed on one of its two through roads and left the other'
    skew = [road(1, [(0, 50), (40, 50)]), road(2, [(40, 50), (80, 50)]), road(3, [(40, 50), (40, 90)])]
    askew = copy.deepcopy(skew)
    askew[0]['pts'][-1], askew[1]['pts'][0], askew[2]['pts'][0] = [40.0, 50.0], [40.011, 50.0], [40.0, 50.011]
    assert not rg.junctions(skew, askew)['whole'], 'the measure must see two ends that parted, whichever end it reads first'
    meet = [road(1, [(0, 50), (40, 50)]), road(2, [(40, 50), (80, 50)])]
    apart = copy.deepcopy(meet)
    apart[1]['pts'][0] = [40.0, 50.3]
    assert rg.junctions(meet, meet)['whole'] and not rg.junctions(meet, apart)['whole'], 'the measure must see two ends that no longer meet'
    stayed = copy.deepcopy(network())
    stayed[0]['bridge'] = True
    walked = copy.deepcopy(stayed)
    walked[0]['pts'][10] = [100.5, 40.0]
    assert not rg.junctions(stayed, walked)['whole'], 'the measure must see a bridge that moved'
    boxed = network()
    slid = copy.deepcopy(boxed)
    slid[0]['pts'][10] = [100.2, 40.0]
    assert rg.junctions(boxed, slid)['whole'] and not rg.junctions(boxed, slid, keep=[(90.0, 41.0, 110.0, 43.0)])['whole'], \
        'the measure must see a moved piece of line that touches a keep box'


def plain_joins(roads):
    """Which lines lie within the joining distance of each end, found the plain way: every end against every piece."""
    out = {}
    for n, r in enumerate(roads):
        for end in (0, 1):
            p = np.array(r['pts'][0 if end == 0 else -1])
            found = []
            for m, other in enumerate(roads):
                if m == n:
                    continue
                q = np.array(other['pts'])
                a, d = q[:-1], np.diff(q, axis=0)
                size = np.hypot(d[:, 0], d[:, 1])
                t = np.clip(((p - a) * d).sum(axis=1) / np.maximum(size * size, 1e-18), 0.0, 1.0)
                gap = np.hypot(*(a + d * t[:, None] - p).T)
                k = int(np.argmin(gap))
                if gap[k] <= rg.JOIN:
                    arc = float(size[:k].sum() + t[k] * size[k])
                    found.append((m, round(arc, 6), 0 if arc <= rg.JOIN else 1 if arc >= size.sum() - rg.JOIN else None))
            out[(n, end)] = found
    return out


def check_joins():
    # The guard of the bake reads the junctions with the same search as the move. So the search itself is proved
    # here against a plain one, on made-up networks: long pieces, ends just inside and just outside the distance.
    for seed in (1, 2, 3):
        rng = np.random.default_rng(seed)
        roads = []
        for rid in range(1, 61):
            count = int(rng.integers(2, 8))
            start = rng.uniform(0, 900, 2)
            pts = np.round(start + np.cumsum(rng.normal(0, [5, 40, 150][rid % 3], (count, 2)), axis=0), 2)
            if roads and rid % 2:
                # Start near a place on another line: on it, beside it, or a little too far from it.
                other = np.array(roads[int(rng.integers(len(roads)))]['pts'])
                k = int(rng.integers(len(other) - 1))
                on = other[k] + (other[k + 1] - other[k]) * rng.uniform()
                pts = np.round(pts - pts[0] + on + rng.normal(0, 1, 2) * [0.0, 1.2, 2.6][rid % 3], 2)
            if np.hypot(*np.diff(pts, axis=0).T).min() > 0.05:
                roads.append(road(rid, pts))
        lines = [rg.Line(r['pts']) for r in roads]
        found = {k: [(m, round(float(arc), 6), at) for m, arc, at in v] for k, v in rg.joins(roads, lines).items()}
        plain = plain_joins(roads)
        assert sum(map(len, plain.values())) > 30, 'the fixture: the made-up networks have junctions'
        for key in plain:
            assert [(m, at) for m, _, at in found[key]] == [(m, at) for m, _, at in plain[key]] and \
                all(abs(a[1] - b[1]) < 1e-4 for a, b in zip(found[key], plain[key])), \
                f'seed {seed}, end {key}: the search finds {found[key]}, a plain search {plain[key]}'


def shaped(roads=None, land=sidehill, streams=None, moved=True):
    roads = network() if roads is None else roads
    if moved:
        rg.move_to_bed(roads, Land(land))
    profiles, flagged = rg.profiles(Land(land), roads)
    dtm, x0, ytop = grid(land)
    out, stats = rg.shape_block(dtm, x0, ytop, profiles, streams)
    return roads, profiles, flagged, dtm, out, x0, ytop


def check_shape():
    roads, profiles, flagged, dtm, out, x0, ytop = shaped()
    assert not flagged
    centre = np.array(roads[0]['pts'])[25:75]
    half = roads[0]['halfWidth']
    rows = np.rint(ytop - centre[:, 1]).astype(int)
    cols = centre[:, 0] - x0
    at = lambda dx: np.array([np.interp(c + dx, np.arange(out.shape[1]), out[r]) for r, c in zip(rows, cols)])
    cross = (at(-half) - at(half)) / (2 * half)
    assert np.abs(cross).max() < 0.005, f'across the driving surface the ground is level but for the crown ({np.abs(cross).max():.4f})'
    crown = at(0) - (at(-half) + at(half)) / 2
    assert np.all((crown > 0.5 * rg.CROWN * half) & (crown < 1.5 * rg.CROWN * half)), 'the crown is about 2 % each way'
    d0 = half + rg.SHOULDER[3]
    fall = (at(half) - at(d0 - 0.1)) / (d0 - 0.1 - half)
    assert np.all(np.abs(fall - rg.CROWN) < 0.006), 'the shoulder carries the crown on to its edge'
    grade = np.diff(at(0)) / np.diff(centre[:, 1])
    assert np.abs(grade - GRADE).max() < 0.004, f'the real grade stays ({grade.min():.4f} to {grade.max():.4f})'
    far = np.abs(np.arange(out.shape[1])[None, :] + x0 - 100) > 3.6 + half + 2 + rg.BLEND_MAX + 1
    lone = far & (np.abs(ytop - np.arange(out.shape[0])[:, None] - 200) > 20) & (np.abs(ytop - np.arange(out.shape[0])[:, None] - 300) > 20)
    assert np.array_equal(out[lone], dtm[lone]), 'ground far from every road is not touched'
    # The track (kind 4) gets no bed of its own.
    track_row = int(ytop - 300)
    assert np.array_equal(out[track_row, 30:60], dtm[track_row, 30:60]), 'tracks and driveways are not shaped'
    # The side road runs out on the main road: no step where they meet.
    j = int(ytop - 200)
    step, was = np.abs(np.diff(out[j, 60:108].astype(float))).max(), np.abs(np.diff(dtm[j, 60:108].astype(float))).max()
    assert step < 0.7 < was, f'the side road climbs the bank more gently than the bare ground ({step:.2f} m per metre; it was {was:.2f})'


def check_smooth():
    # Stony ground: the shaped road is much smoother along its line, and no rougher beside it.
    rng = np.random.default_rng(7)
    noise = rng.normal(0, 0.06, (600, 400))

    def stony(x, y):
        x, y = np.asarray(x, dtype=float), np.asarray(y, dtype=float)
        a, b = np.clip(np.rint(y).astype(int) + 50, 0, 599), np.clip(np.rint(x).astype(int) + 50, 0, 399)
        return sidehill(x, y) + noise[a, b]
    roads = [road(1, [(BED_X, y) for y in range(0, 401, 4)])]
    profiles, _ = rg.profiles(Land(stony), roads)
    dtm, x0, ytop = grid(stony)
    out, _ = rg.shape_block(dtm, x0, ytop, profiles)
    col = int(BED_X - x0)
    rough = lambda a: np.abs(np.diff(a[100:400, col].astype(float), 2)).mean()
    assert rough(out) < 0.2 * rough(dtm), f'the road is smoother along its line ({rough(out):.3f} m against {rough(dtm):.3f} m)'
    assert np.array_equal(out[:, col + 30], dtm[:, col + 30])


def check_place():
    # Inside a keep box the ground is the LiDAR's own, cell for cell; outside it the road is shaped as usual.
    box = (60.0, 150.0, 140.0, 250.0)
    roads = network()
    rg.move_to_bed(roads, Land(sidehill), keep=[box])
    profiles, _ = rg.profiles(Land(sidehill), roads)
    dtm, x0, ytop = grid(sidehill)
    out, _ = rg.shape_block(dtm, x0, ytop, profiles, keep=[box])
    r0, r1, c0, c1 = int(ytop - box[3]), int(ytop - box[1]) + 1, int(box[0] - x0), int(box[2] - x0) + 1
    assert np.array_equal(out[r0:r1, c0:c1], dtm[r0:r1, c0:c1]), 'no ground inside a keep box changes'
    far = int(ytop - 60)
    assert np.abs(out[far, 96:112].astype(float) - dtm[far, 96:112]).max() > 0.05, 'while the road well outside it is shaped'
    # A box that runs beside a road: each cell takes its own distance from the box, so there is no step at its edge.
    tilted = lambda x, y: 50.0 + (np.asarray(x, dtype=float) - 100) + 0.0 * np.asarray(y, dtype=float)
    beside = (105.0, 100.0, 140.0, 300.0)
    lane = [road(1, [(100, y) for y in range(0, 401, 4)])]
    profiles, _ = rg.profiles(Land(tilted), lane)
    dtm, x0, ytop = grid(tilted)
    out, _ = rg.shape_block(dtm, x0, ytop, profiles, keep=[beside])
    change = out[int(ytop - 200)].astype(float) - dtm[int(ytop - 200)]
    assert change[105] == 0 and abs(change[104]) < 0.02 and abs(change[103]) < 0.08, f'no step beside a keep box ({change[103]:.3f}, {change[104]:.3f}, {change[105]:.3f} m)'
    beyond = out[int(ytop - 360)].astype(float) - dtm[int(ytop - 360)]
    assert abs(beyond[97]) > 0.5 and abs(change[97]) < abs(beyond[97]), 'the shaping is whole 60 m past the box and damped beside it'
    # Two blocks that share an edge inside and beside a keep box still agree.
    whole, _ = rg.shape_block(dtm, x0, ytop, profiles, keep=[beside])
    cut = 250
    north, _ = rg.shape_block(dtm[:cut + rg.HALO], x0, ytop, profiles, keep=[beside])
    south, _ = rg.shape_block(dtm[cut - rg.HALO:], x0, ytop - (cut - rg.HALO), profiles, keep=[beside])
    assert np.array_equal(north[:cut], whole[:cut]) and np.array_equal(south[rg.HALO:], whole[cut:]), 'blocks agree at a keep box too'


@cache
def site_reservations():
    return json.loads(subprocess.check_output(
        ['node', 'tools/run-node-check.mjs', 'tools/road-ground-sites.mjs'], cwd=ROOT))


def check_keep_boxes(web=lambda name: open(os.path.join(ROOT, 'web', 'src', name)).read()):
    # Every hand-built place that is fixed to map coordinates lies inside a keep box of its area, with room to spare.
    # The anchors are read from the game's own source, so a place that moves must take its box with it.
    import areas

    def pair(text, pattern, what):
        found = re.search(pattern, text)
        assert found, f'{what}: its anchor is no longer where this check reads it; point the check and the keep box at the new one'
        return float(found.group(1)), float(found.group(2))
    places = [
        ('mabou', 'the works yard', pair(web('yard-site.ts'), r'ORIGIN_E\s*=\s*([\d.]+)\s*,\s*ORIGIN_N\s*=\s*([\d.]+)', 'yard-site.ts')),
        ('mabou', 'the Mabou Mines Road scene', pair(web('road-scene.ts'), r'roads\.nearest\(\s*([\d.]+)\s*-\s*village\[0\]\s*,\s*village\[1\]\s*-\s*([\d.]+)', 'road-scene.ts')),
        ('mabou', 'the Mabou Harbour wharf', pair(web('fishing-site.ts'), r'WHARF\s*=\s*\{\s*e\s*:\s*([\d.]+)\s*,\s*n\s*:\s*([\d.]+)', 'fishing-site.ts')),
        ('judique', 'the house', pair(web('home-site.ts'), r'ORIGIN_E\s*=\s*([\d.]+)\s*,\s*ORIGIN_N\s*=\s*([\d.]+)', 'home-site.ts')),
        ('judique', 'the church', pair(web('church-site.ts'), r'CHURCH_ORIGIN\s*=\s*\[\s*([\d.]+)\s*,\s*([\d.]+)\s*\]', 'church-site.ts')),
        ('judique', 'the church start', pair(web('church-site.ts'), r'CHURCH_START\s*=\s*\{\s*e\s*:\s*([\d.]+)\s*,\s*n\s*:\s*([\d.]+)', 'church-site.ts')),
        # This house has no anchor in the game's source: its place is the middle of its surveyed building record.
        ('mabou', 'the porch-site house at the end of Beaton Road', (625919.92, 5100856.27)),
    ]
    # The coast's recesses have heights fixed in the shader. Read every entry of the list, whatever its spacing.
    block = re.search(r'RECESSES\s*=\s*\[(.*?)\]\s*as const', web('coast-site.ts'), re.S)
    assert block, 'coast-site.ts: the RECESSES list is no longer where this check reads it'
    entries = re.findall(r'\{[^{}]*\}', block.group(1))
    assert len(entries) >= 5, 'coast-site.ts: the RECESSES list has lost entries, or this check can no longer read it'
    for i, entry in enumerate(entries):
        e, n = re.search(r'\be\s*:\s*([\d.]+)', entry), re.search(r'\bn\s*:\s*([\d.]+)', entry)
        assert e and n, f'coast-site.ts: recess {i + 1} has no readable position: {entry}'
        places.append(('mabou', f'coast recess {i + 1} (its height is fixed in the shader)', (float(e.group(1)), float(n.group(1)))))
    for area, name, (e, n) in places:
        boxes = areas.AREAS[area].keep_roads
        assert any(x0 + 20 <= e <= x1 - 20 and y0 + 20 <= n <= y1 - 20 for x0, y0, x1, y1 in boxes), f'{name} ({e}, {n}) is not inside a keep box of {area}'
    quarry = areas.AREAS['westbay']
    assert quarry.extra_fine[0] in quarry.keep_roads, 'the West Bay quarry keeps its roads and ground'
    # Cover the complete reservation, including the outer edges, at each new site.
    # The source geometry has its own tolerances. Leave another 10 m in the keep box.
    def covers(box, site):
        (x0, y0, x1, y1), (e0, n0, e1, n1) = box, site['box']
        return x0 + 10 <= e0 and y0 + 10 <= n0 and e1 <= x1 - 10 and n1 <= y1 - 10
    sites = site_reservations()
    for site in sites:
        area, name = site['area'], site['name']
        assert any(covers(box, site) for box in areas.AREAS[area].keep_roads), f'{area}: {name} reservation is not covered with a 10 m margin'
    # The other way round: the site reader still finds sites in each area, and every box still holds one. A reader that
    # finds fewer sites would otherwise pass with nothing to test, and a box left after its site is gone would hold road.
    for area in ('pointtupper', 'porthood', 'cansocauseway'):
        mine = [site for site in sites if site['area'] == area]
        assert mine, f'{area}: the site reader found no hand-built site'
        for box in areas.AREAS[area].keep_roads:
            assert any(covers(box, site) for site in mine), f'{area}: keep box {box} holds no hand-built site'


def check_keeps():
    # The sea is never changed, a bridge gets no shaping, and a brook beside the road keeps its ground.
    roads = network()
    roads[0]['bridge'] = True
    _, profiles, _, dtm, out, x0, ytop = shaped(roads, moved=False)
    assert 1 not in profiles, 'a bridge has no height line'
    strip = (slice(int(ytop - 390), int(ytop - 10)), slice(int(98 - x0), int(111 - x0)))
    rows = np.abs(ytop - np.arange(dtm.shape[0])[:, None] - 200) > 25
    keep = np.zeros(dtm.shape, bool)
    keep[strip] = True
    assert np.array_equal(out[keep & rows], dtm[keep & rows]), 'the ground under a bridge is not shaped'

    def with_sea(x, y):
        return np.where(np.asarray(x) > 108, rg.NODATA, sidehill(x, y))
    dtm, x0, ytop = grid(with_sea)
    profiles, _ = rg.profiles(Land(sidehill), network())
    out, _ = rg.shape_block(dtm, x0, ytop, profiles)
    assert np.array_equal(out[dtm == rg.NODATA], dtm[dtm == rg.NODATA]) and (out[dtm != rg.NODATA] != rg.NODATA).all(), 'the sea stays the sea'

    brook = [dict(pts=[[60.0, 150.0], [140.0, 150.0]])]
    roads, profiles, _, dtm, out, x0, ytop = shaped(streams=brook, moved=False)
    r = int(ytop - 150)
    half = roads[0]['halfWidth']
    beside = np.r_[np.arange(int(100 - half - 9), int(100 - half - 1)), np.arange(int(100 + half + 2), int(100 + half + 9))]
    assert np.array_equal(out[r, beside], dtm[r, beside]), 'a brook beside the road keeps its ground'
    assert abs(float(out[r - 6, 100]) - float(out[r, 100]) - GRADE * 6) < 0.05, 'under the road the brook is in a pipe: the surface carries on'
    try:
        rg.baked_brooks(os.path.join(ROOT, 'tools', 'no-such-brooks.json'))
    except RuntimeError:
        pass
    else:
        raise AssertionError('without the baked brooks nothing may be shaped')


def check_limit():
    def ravine(x, y):
        return sidehill(x, y) - 6.0 * np.exp(-0.5 * ((np.asarray(y, dtype=float) - 120) / 1.2) ** 2)
    roads = [road(1, [(BED_X, y) for y in range(0, 401, 4)])]
    profiles, flagged = rg.profiles(Land(ravine), roads)
    p = profiles[1]
    assert flagged and flagged[0]['id'] == 1 and 110 <= flagged[0]['fromM'] <= 125, 'a stretch that would move more than the limit is listed'
    ground = ravine(np.full(len(p['s']), BED_X), p['s'])          # the ground itself on the centre line, not a smoothed copy
    assert np.abs(p['z'] - ground).max() <= rg.LIMIT + 0.001, f"the height line stays within the limit of the ground itself ({np.abs(p['z'] - ground).max():.2f} m)"
    dtm, x0, ytop = grid(ravine)
    out, _ = rg.shape_block(dtm, x0, ytop, profiles)
    col = int(BED_X - x0)
    assert np.abs(out[:, col].astype(float) - dtm[:, col]).max() <= rg.LIMIT + 0.02, 'and so does the baked ground on the centre line'
    # A slot one metre wide that falls between the places where the height line is worked out: the grid still holds.

    def slot(x, y):
        return 50.0 - 6.0 * np.maximum(0.0, 1.0 - np.abs(np.asarray(y, dtype=float) - 120)) + 0.0 * np.asarray(x, dtype=float)
    for first, last in ((0.5, 400.5), (0.0, 400.5)):
        roads = [road(1, [(BED_X, first), *[(BED_X, y) for y in range(4, 400, 4)], (BED_X, last)])]
        profiles, _ = rg.profiles(Land(slot), roads)
        dtm, x0, ytop = grid(slot)
        out, stats = rg.shape_block(dtm, x0, ytop, profiles)
        worst = np.abs(out[:, col].astype(float) - dtm[:, col]).max()
        assert worst <= rg.LIMIT + 0.001 and stats['heldAtLimit'] > 0, f'no cell on the centre line leaves the LiDAR by more than the limit ({worst:.2f} m)'
        assert stats['held'] and stats['held'][0]['id'] == 1 and 118 <= stats['held'][0]['fromM'] <= stats['held'][0]['toM'] <= 122, 'a place that only the grid held is listed with its road and position'
    # A shallow slot: every place where the height line is worked out is inside the limit, the grid cell is not.
    shallow = lambda x, y: 50.0 - 2.0 * np.maximum(0.0, 1.0 - np.abs(np.asarray(y, dtype=float) - 120)) + 0.0 * np.asarray(x, dtype=float)
    roads = [road(1, [(BED_X, 0.5), *[(BED_X, y) for y in range(4, 400, 4)], (BED_X, 400.5)])]
    profiles, flagged = rg.profiles(Land(shallow), roads)
    out, stats = rg.shape_block(*grid(shallow), profiles)
    assert not flagged and stats['heldAtLimit'] >= 1 and stats['held'] and 118 <= stats['held'][0]['fromM'] <= 122, 'what only the grid holds is listed too'
    # A held place far along the road leaves the height line here alone.

    def bump(x, y, pit=0.0):
        y = np.asarray(y, dtype=float)
        return 50.0 + 0.8 * np.maximum(0.0, 1.0 - np.abs(y - 100) / 4) - pit * np.maximum(0.0, 1.0 - np.abs(y - 400)) + 0.0 * np.asarray(x, dtype=float)
    long_road = [road(1, [(BED_X, y) for y in range(0, 501, 4)])]
    calm, _ = rg.profiles(Land(bump), long_road)
    pitted, listed = rg.profiles(Land(lambda x, y: bump(x, y, 6.0)), long_road)
    assert listed and np.array_equal(calm[1]['z'][:300], pitted[1]['z'][:300]), 'a held place 300 m along the road does not change the height line here'
    # Every stretch that was held is listed, also one that only the easing pushed to the limit.
    bumps = 50 + np.random.default_rng(0).normal(0, 1.5, 401)
    roads = [road(1, [(BED_X, y) for y in range(0, 401, 4)])]
    profiles, flagged = rg.profiles(Land(lambda x, y: np.interp(np.asarray(y, dtype=float), np.arange(401.0), bumps) + 0.0 * np.asarray(x, dtype=float)), roads)
    p = profiles[1]
    at_limit = np.flatnonzero(np.abs(p['z'] - p['centre']) >= rg.LIMIT - 1e-9)
    listed = np.zeros(len(p['s']), dtype=bool)
    for f in flagged:
        listed |= (np.rint(p['s']) >= f['fromM']) & (np.rint(p['s']) <= f['toM'])
    assert len(at_limit) > 20 and listed[at_limit].all(), 'every stretch held at the limit is in the list'


def check_blocks():
    # The same ground comes out whether a place is shaped as one block or as two that overlap by the halo.
    roads = network()
    rg.move_to_bed(roads, Land(sidehill))
    profiles, _ = rg.profiles(Land(sidehill), roads)
    dtm, x0, ytop = grid(sidehill)
    whole, _ = rg.shape_block(dtm, x0, ytop, profiles)
    cut = 250
    north, _ = rg.shape_block(dtm[:cut + rg.HALO], x0, ytop, profiles)
    south, _ = rg.shape_block(dtm[cut - rg.HALO:], x0, ytop - (cut - rg.HALO), profiles)
    assert np.array_equal(north[:cut], whole[:cut]) and np.array_equal(south[rg.HALO:], whole[cut:]), 'two blocks agree where they meet'
    # A road that leaves a block and comes back into it is shaped once, as in the block that holds it whole.
    loop = [road(1, [(-5, 40), (-5, 100), (120, 100), (120, 200), (5, 200), (5, 40)])]
    flat = lambda x, y: 50.0 + 0.0 * (np.asarray(x, dtype=float) + np.asarray(y, dtype=float))
    profiles, _ = rg.profiles(Land(flat), loop)
    east, _ = rg.shape_block(*grid(flat, x0=-rg.HALO, ytop=300.0, shape=(320, 300)), profiles)
    west, _ = rg.shape_block(*grid(flat, x0=-300.0, ytop=300.0, shape=(320, 300 + rg.HALO)), profiles)
    assert np.array_equal(east[:, rg.HALO - 2:rg.HALO + 3], west[:, 298:303]), 'a road that leaves a block and returns gives the same ground in both blocks'
    # Many roads side by side, 7 m apart, from far outside the halo up to the shared edge: a change must not travel
    # from road to road into the next block.
    rows_of = [road(n + 1, [(float(x), y) for y in range(-100, 401, 4)]) for n, x in enumerate(range(-(rg.HALO + 62), -6, 7))]
    slope = lambda x, y: 100.0 + np.asarray(x, dtype=float) + 0.0 * np.asarray(y, dtype=float)
    profiles, _ = rg.profiles(Land(slope), rows_of)
    east, _ = rg.shape_block(*grid(slope, x0=-rg.HALO, ytop=300.0, shape=(320, 300)), profiles)
    west, _ = rg.shape_block(*grid(slope, x0=-300.0 - rg.HALO, ytop=300.0, shape=(320, 301 + 2 * rg.HALO)), profiles)
    assert np.array_equal(east[:, rg.HALO - 2:rg.HALO + 3], west[:, 298 + rg.HALO:303 + rg.HALO]), 'roads side by side do not carry a change past the halo'


def check_measure():
    # The measuring tool sees the fault on made-up land, and sees it gone after the line has moved.
    import road_ground_measure as measure
    roads = [road(1, [(100, y) for y in range(0, 401, 4)])]
    before = measure.measure_road(Land(sidehill), roads[0])
    rg.move_to_bed(roads, Land(sidehill))
    after = measure.measure_road(Land(sidehill), roads[0])
    mid = slice(10, -10)
    assert np.abs(before['cross'][mid]).mean() > 0.10 and np.abs(before['offset'][mid]).min() >= 3.0, 'the tool reports a line that lies on the bank'
    assert np.abs(after['cross'][mid]).max() < 0.01 and np.abs(after['offset'][mid]).max() == 0.0, 'and a line that lies on its bed'
    rows = [dict(id=1, name='Road 1', kind=3, bridge=False, washboard=False, **before)]
    table = measure.summarise(rows)['gravel']
    assert table['benchOffShare'] > 90 and table['crossMedianPct'] > 10 and measure.worst(rows)[0]['name'] == 'Road 1'


TRIAL_BLOCK = re.compile(r'\n[ \t]*# >>> road-ground trial.*?# <<< road-ground trial[^\n]*', re.S)


def default_path(text):
    """A bake script with its marked trial blocks taken out: what runs when the switches are off."""
    return TRIAL_BLOCK.sub('', text)


def check_default_off(read=lambda name: open(os.path.join(ROOT, 'pipeline', name)).read()):
    # The trial is marked insertions and nothing else. With the marked blocks taken out, a script must not know the
    # trial at all; so with the switches off its arithmetic is the script's own. (At the time of the change the two
    # scripts without their blocks were byte-equal to main, and a full Mabou bake with the switches off was
    # byte-equal to the bake before the change.)
    for name, flag, blocks in (('23_bake_roads.py', 'MMM_ROAD_BED', 1), ('24_bake_corridor.py', 'MMM_ROAD_GROUND', 3)):
        text = read(name)
        assert len(TRIAL_BLOCK.findall(text)) == blocks and text.count('# >>> road-ground trial') == text.count('# <<< road-ground trial') == blocks, f'{name}: {blocks} marked trial blocks'
        rest = default_path(text)
        for word in ('road_ground', 'MMM_ROAD', 'shaping', 'shaped', 'keep_roads'):
            assert word not in rest, f'{name}: "{word}" outside the marked trial blocks'
        compile(rest, name, 'exec')
        assert len(re.findall(r"if os\.environ\.get\('" + flag + r"'\) == '1':", text)) == 1, f'{name}: one switch, off unless it is exactly 1'
        for block in TRIAL_BLOCK.findall(text):
            body = [line for line in block.split('\n') if line.strip() and not line.strip().startswith('#')]
            first = body[0].strip()
            assert first in ('shaping = None', 'if shaping:') or first.startswith("if os.environ.get('" + flag), f'{name}: a trial block must begin behind its switch ({first})'
    for name in ('21_bake_terrain.py', '25_bake_road_fields.py'):
        assert 'road_ground' not in read(name), f'{name} must not know the trial'


CHECKS = [check_bed, check_nodes, check_joins, check_shape, check_smooth, check_place, check_keep_boxes, check_keeps, check_limit, check_blocks, check_measure, check_default_off]

# name, what to break, the check that must then fail
MUTATIONS = [
    ('a crown of 20 %', lambda: setattr(rg, 'CROWN', 0.20), check_shape),
    ('heights smoothed over 80 m, not a car length', lambda: setattr(rg, 'ALONG_SIGMA', 80.0), check_limit),
    ('no limit on the height change', lambda: setattr(rg, 'LIMIT', 99.0), check_limit),
    ('brooks not protected', lambda: setattr(rg, 'BROOK_CLEAR', (-9.0, -8.0)), check_keeps),
    ('tracks shaped too', lambda: setattr(rg, 'SHAPED_KINDS', (1, 2, 3, 4, 5)), check_shape),
    ('the line stops at the edge of the bed', lambda: setattr(rg, 'BED_SPARE', 0.0), check_bed),
    ('a halo of 4 m', lambda: setattr(rg, 'HALO', 4), check_blocks),
    ('a keep box lets a road point move', lambda: setattr(rg, '_hold', lambda roads, lines, order, keep, ties, pins: {n: np.ones(len(roads[n]['pts'])) for n in order}), check_bed),
    ('a keep box lets the ground change', lambda: setattr(rg, 'kept', lambda x, y, boxes, ramp=None: np.ones(np.broadcast(np.asarray(x), np.asarray(y)).shape)), check_place),
    ('a new coast recess outside every keep box', lambda: None, lambda: check_keep_boxes(lambda name: (lambda text: text.replace(
        'RECESSES = [', 'RECESSES = [\n  { e: 620000, h: 6.46, n: 5111000, width: 1.8, rise: .85 },', 1) if name == 'coast-site.ts' else text)(open(os.path.join(ROOT, 'web', 'src', name)).read()))),
    ('a thin keep box between two test points is missed', lambda: setattr(rg, '_touches', lambda a, b, box: False), check_bed),
    ('a keep box looks at points only, not at the line between them', lambda: setattr(rg, '_piece_away', lambda a, b, boxes: float(min(rg._away(a[0], a[1], boxes), rg._away(b[0], b[1], boxes)))), check_bed),
    ('what is held is not carried through the junctions', lambda: (lambda real: setattr(rg, '_hold', lambda roads, lines, order, keep, ties, pins: real(roads, lines, order, keep, [], pins)))(rg._hold), check_bed),
    ('a road moves freely under the end of a bridge on its side', lambda: (lambda real: setattr(rg, '_hold', lambda roads, lines, order, keep, ties, pins: real(roads, lines, order, keep, ties, [])))(rg._hold), check_nodes),
    ('each end of a junction decides for itself', lambda: setattr(rg, '_nodes', lambda lines, joined: (
        {(n, end): (n, end) for n, line in enumerate(lines) if line is not None for end in (0, 1)},
        {(n, end): [(n, end)] for n, line in enumerate(lines) if line is not None for end in (0, 1)})), check_nodes),
    ('the two ends of a ring are not one junction', lambda: setattr(rg, '_ring', lambda line: False), check_nodes),
    ('the moves of joined roads are worked out in one pass, not solved', lambda: setattr(rg, '_settle', lambda weight, constant: constant), check_bed),
    ('a junction on two through roads moves like any other', lambda: setattr(rg, '_one_place', lambda through: True), check_nodes),
    ('the measure lets an end leave one of its two through roads', lambda: setattr(rg, '_side_growth', lambda gaps: min(gaps.values())), check_nodes),
    ('the hold of a keep box is taken twice inside a road', lambda: (lambda real: setattr(rg, '_hold', lambda *a: {
        n: np.r_[w[:1], w[1:-1] ** 2, w[-1:]] for n, w in real(*a).items()}))(rg._hold), check_nodes),
    ('a side road on a road of its own node is not counted', lambda: (lambda real: setattr(rg, '_sides', lambda ends_here, joined: [
        side for side in real(ends_here, joined) if side[1] not in {n for n, _ in ends_here}]))(rg._sides), check_nodes),
    ('an end on the side of its own road is not counted', lambda: setattr(rg, '_own_side', lambda line, end: None), check_nodes),
    ('each end of a ring sees only what it meets itself', lambda: setattr(rg, '_seen', lambda joined, lines, n, end: list(joined.get((n, end), []))), check_nodes),
    ('every line is taken for a ring', lambda: setattr(rg, '_ring', lambda line: True), check_nodes),
    ('the search for near lines looks at the cell of a piece\'s first point only', lambda: setattr(rg, '_segments_grid', lambda lines, cell=64.0: (
        lambda grid: [grid.setdefault(tuple(np.floor(point / cell).astype(np.int64)), set()).add(n) for n, line in enumerate(lines) if line is not None for point in line.p[:-1]] and grid)({})), check_joins),
    ('the measure of the junctions passes everything', lambda: (lambda real: setattr(rg, 'junctions', lambda *a, **k: {**real(*a, **k), 'whole': True}))(rg.junctions), check_nodes),
    ('the works yard has no keep box', lambda: None, lambda: (lambda a: (setattr(a, 'AREAS', {**a.AREAS, 'mabou': __import__('dataclasses').replace(a.AREAS['mabou'], keep_roads=a.AREAS['mabou'].keep_roads[1:])}), check_keep_boxes()))(__import__('areas'))),
    ('a Point Tupper site has no keep box', lambda: None, lambda: (lambda a: (setattr(a, 'AREAS', {**a.AREAS, 'pointtupper': __import__('dataclasses').replace(a.AREAS['pointtupper'], keep_roads=a.AREAS['pointtupper'].keep_roads[1:])}), check_keep_boxes()))(__import__('areas'))),
    ('a Port Hood keep box holds no site', lambda: None, lambda: (lambda a: (setattr(a, 'AREAS', {**a.AREAS, 'porthood': __import__('dataclasses').replace(a.AREAS['porthood'], keep_roads=a.AREAS['porthood'].keep_roads + ((600000, 5000000, 600100, 5000100),))}), check_keep_boxes()))(__import__('areas'))),
    ('a short road keeps part of its far end\'s move', lambda: setattr(rg, '_end_weights', lambda arc, length, taper: (0.5 + 0 * arc, 0.5 + 0 * arc)), check_bed),
    ('the shoulder is level, not crowned', lambda: setattr(rg, 'SHOULDER', {k: 0.0 for k in rg.SHOULDER}), check_shape),
    ('no smoothing along the road', lambda: setattr(rg, 'ALONG_SIGMA', 0.01), check_smooth),
    ('trial code outside its marked block', lambda: None, lambda: check_default_off(lambda name: open(os.path.join(ROOT, 'pipeline', name)).read().replace(
        '        dtm = warp_exact(str(AREA.elevation("dtm")), halo)\n', '        dtm = warp_exact(str(AREA.elevation("dtm")), halo)\n        dtm = road_ground.HALO * dtm\n'))),
]


def main():
    for check in CHECKS:
        check()
        print(f'PASS {check.__name__}')
    saved = {k: copy.deepcopy(v) for k, v in vars(rg).items() if k.isupper()}
    for name in ('_end_weights', 'kept', '_hold', '_piece_away', '_touches', '_nodes', '_ring', 'junctions', '_settle', '_one_place', '_side_growth', '_segments_grid', '_sides', '_seen', '_own_side'):
        saved[name] = getattr(rg, name)
    for name, breakit, check in MUTATIONS:
        breakit()
        try:
            check()
        except AssertionError:
            print(f'PASS mutation caught: {name}')
        except RuntimeError as stopped:                   # the bake's own guards refused the result (rg.junctions, or the check of the solve)
            assert 'would tear a junction' in str(stopped) or 'could not be worked out' in str(stopped), stopped
            print(f'PASS mutation caught by the guard of the bake: {name}')
        else:
            print(f'FAIL mutation not caught: {name}')
            sys.exit(1)
        finally:
            for k, v in saved.items():
                setattr(rg, k, v)
            sys.modules.pop('areas', None)
    print(f'road-ground: {len(CHECKS)} rules and {len(MUTATIONS)} mutations')


if __name__ == '__main__':
    main()
