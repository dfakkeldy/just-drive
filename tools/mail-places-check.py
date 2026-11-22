#!/usr/bin/env python3
"""Where mailboxes go when the road lines move (pipeline/29_bake_props.py, pipeline/road_ground.py), on made-up land.
No GDAL, no baked data.

The rule: every choice about a mailbox is made on the road lines before the road bed move, and only its position is
taken from the moved line. Each case below is a threshold of the old rule that a real house crossed in the Mabou
rehearsal of 13 Nov 2026. A case first proves that deciding on the moved lines does flip it, then that the rule keeps
it. Each rule is then broken on purpose (the mutations) to prove that its case can fail.

"The old rule" here is not today's code: it is tools/baseline/mailboxes-old.py, the rule as it was on main before
this one, frozen. Without a move, today's rule must give that rule's whole output, in order, on every land below.
"""
import copy
import hashlib
import json
import math
import os
import sys
import tempfile
import types

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'pipeline'))
PROPS, GROUND = os.path.join(ROOT, 'pipeline', '29_bake_props.py'), os.path.join(ROOT, 'pipeline', 'road_ground.py')
# The bake script loads GDAL for its height veto only; nothing here calls it.
sys.modules.setdefault('osgeo', types.SimpleNamespace(gdal=types.SimpleNamespace(UseExceptions=lambda: None)))


def load(path, name, text=None):
    module = types.ModuleType(name)
    module.__file__ = path
    exec(compile(open(path).read() if text is None else text, path, 'exec'), module.__dict__)
    return module


RG = load(GROUND, 'road_ground')
sys.modules['road_ground'] = RG
P = load(PROPS, 'props')
FROZEN = os.path.join(ROOT, 'tools', 'baseline', 'mailboxes-old.py')
assert hashlib.sha256(open(FROZEN, 'rb').read()).hexdigest() == json.load(open(os.path.join(ROOT, 'tools', 'baseline', 'frozen.json')))['mailboxes-old.py'], \
    'mailboxes-old.py was edited; frozen files are never edited (tools/baseline/README.md)'
OLD = load(FROZEN, 'mailboxes_old')
FAR = (-90000.0, -90000.0)          # the village centre and its 550 m circle, well away from every case


def road(rid, pts, kind=3, bridge=False):
    return dict(id=rid, name=f'Road {rid}', kind=kind, halfWidth={1: 3.6, 2: 3.0, 3: 2.6, 4: 1.5}[kind], bridge=bridge,
                pts=[[float(x), float(y)] for x, y in pts])


def house(bid, x, y):
    return dict(id=bid, x=float(x), y=float(y), kind='house')


def line(y, x0=0, x1=400, step=50):
    return [(x, y) for x in range(x0, x1 + 1, step)]


def safe_with(blocks=(), public=None):
    """The bake's own test without its water and bridges: not in a building's box, not in the lane of a public road."""
    def safe(p, bridge=True, on=None):
        if any(x0 <= p[0] <= x1 and y0 <= p[1] <= y1 for x0, y0, x1, y1 in blocks):
            return False
        hit = on.nearest(p, 14, public or P.public)
        return hit is None or hit['dist'] >= hit['road']['halfWidth'] + 1.0
    return safe


def old_rule(roads, houses, blocks, cabinets):
    """The frozen rule on one land: the whole list for props.json. It has its own network and its own helpers."""
    net = OLD.Network(copy.deepcopy(roads))
    test = safe_with(blocks, public=lambda r: r['kind'] <= 3)         # its own "public road", not today's P.public
    return OLD.old_rule(net, list(net.roads.values()), copy.deepcopy(houses), cabinets, lambda p, bridge=True: test(p, bridge, net),
                        FAR, types.SimpleNamespace(mailbox_exclusion_radius=550))


def run(net, ref, houses, blocks, cabinets, cabinets_before):
    boxes, report = P.place_mailboxes(net, ref, houses, cabinets, cabinets_before, safe_with(blocks), FAR, 550)
    assert len(boxes) == len(report) and all(set(b) == {'x', 'y', 'heading', 'style', 'tilt', 'group', 'parcelBox'} for b in boxes)
    assert len({row['building'] for row in report}) == len(report), 'no house gets two mailboxes'
    assert len({(b['x'], b['y']) for b in boxes}) == len(boxes), 'no two mailboxes stand at one place'
    return boxes, report


def keyed(boxes, report):
    return {row['building']: (box['x'], box['y'], box['group'], row['road'], row['how']) for box, row in zip(boxes, report)}


def bake(before, now, houses, blocks=(), cabinets=(), cabinets_before=None):
    """Three bakes of one place: 'old' is the land before the move, 'naive' decides on the moved lines (the old rule on
    the new land), 'kept' is the rule. Each is {building: (x, y, group, road, how)} in the order of props.json."""
    def same(roads, there):
        # No move: today's rule is the frozen rule. The whole output, in its order, with styles and tilts.
        net = P.Network(copy.deepcopy(roads))
        boxes, report = run(net, net, houses, blocks, there, there)
        assert boxes == old_rule(roads, houses, blocks, there), 'without a move the rule must give what the old rule gave, box for box'
        assert all(row['how'] == 'kept' for row in report), 'without a move nothing is placed again'
        return keyed(boxes, report)
    then = cabinets if cabinets_before is None else cabinets_before
    net = P.Network(copy.deepcopy(now))
    lines = {r['id']: r['pts'] for r in before}
    # As the bake builds it: a road that did not move is the same object in both networks.
    ref = P.Network([dict(r, pts=lines[r['id']]) if lines[r['id']] != r['pts'] else r for r in net.roads.values()])
    return dict(old=same(before, then), naive=same(now, cabinets), kept=keyed(*run(net, ref, houses, blocks, cabinets, then)))


def moved(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def shape(boxes):
    return [(building, box[2], box[3]) for building, box in boxes.items()]


def check_reach():
    # A house 249.8 m from its road. The line moves 1.2 m away: 251.0 m, past the 250 m reach.
    out = bake([road(1, line(0), 2)], [road(1, line(-1.2), 2)], [house(10, 200, 249.8)])
    assert len(out['old']) == 1 and len(out['naive']) == 0, 'the case: on the moved line the house is out of reach'
    assert len(out['kept']) == 1 and out['kept'][10][3:] == (1, 'kept'), 'a house in reach before the move keeps its mailbox'
    assert abs(moved(out['kept'][10], out['old'][10]) - 1.2) < 0.01, 'and the box moves as the line moved, 1.2 m'


def check_road():
    # Two roads, 87.4 and 89.8 m from the house. The nearer one moves 3.3 m away: 90.7 m.
    before = [road(1, line(0), 2), road(2, line(177.2), 3)]
    now = [road(1, line(-3.3), 2), road(2, line(177.2), 3)]
    out = bake(before, now, [house(10, 200, 87.4)])
    assert out['old'][10][3] == 1 and out['naive'][10][3] == 2, 'the case: on the moved lines the other road is nearer'
    assert out['kept'][10][3:] == (1, 'kept') and abs(moved(out['kept'][10], out['old'][10]) - 3.3) < 0.01, 'the box stays on its road'


def check_window():
    # Frames take the neighbours within 60 m along the road. A kink that the move takes out shortens the road by 3.3 m:
    # the gap between two frames goes from 61.3 to 58.0 m.
    kink = lambda y: [(0, 0), (100, 0), (110, y), (120, 0), (300, 0)]
    # The houses stand far enough from the kink that their nearest point of the road is on a straight part.
    houses = [house(10, 88, -30), house(11, 88, 30), house(12, 146, 30), house(13, 163, -30)]
    out = bake([road(1, kink(6))], [road(1, kink(0))], houses)
    assert [box[2] for box in out['old'].values()] == [1, 1, 2, 2], 'before the move: two frames of two'
    assert [box[2] for box in out['naive'].values()] == [1, 1, 1, None], 'the case: on the moved line the third house joins the first frame'
    assert shape(out['kept']) == shape(out['old']), 'the frames keep their members'
    # The road is 3.3 m shorter, but a place on it is the same piece of line and the same fraction of it.
    for building in (10, 11, 12, 13):
        assert moved(out['kept'][building], out['old'][building]) < 0.01, f'box {building} stands where it stood: that part of the line did not move'


def check_anchor():
    # A frame stands at the house nearest to the road. Three houses at 16.78, 16.69 and 16.61 m: a tie that a 3.2 m
    # move breaks the other way.
    houses = [house(10, 5, 16.78), house(11, 13, -16.69), house(12, 35, -16.61)]
    out = bake([road(1, line(0, -100, 300))], [road(1, line(3.2, -100, 300))], houses)
    assert shape(out['naive']) == shape(out['old']) and min(moved(out['naive'][b], out['old'][b]) for b in (10, 11, 12)) > 25, 'the case: the frame goes to the other end, 30 m along'
    assert shape(out['kept']) == shape(out['old'])
    assert max(abs(moved(out['kept'][b], out['old'][b]) - 3.2) for b in (10, 11, 12)) < 0.01, 'the frame stays at its house and moves 3.2 m with the line'


def check_mouth():
    # A box stands at the mouth of the house's own driveway when the house is within 0.65 of its road distance of the
    # track. Track to house 116.4 m; the limit goes from 118.1 to 116.0 m when the road comes 3.3 m nearer.
    track = road(2, [(164.1, 0), (164.1, 20), (164.1, 40), (164.1, 60), (164.1, 71)], 4)
    out = bake([road(1, line(0), 1), track], [road(1, line(3.3), 1), track], [house(10, 200, 181.7)])
    assert abs(out['old'][10][0] - 166.6) < 0.01 and out['naive'][10][0] - out['old'][10][0] > 30, 'the case: on the moved line the box leaves the driveway mouth'
    # The line came 3.3 m nearer to the old place, which is now in its lane. The place before the move is judged on the lines before the move.
    assert 10 in out['kept'], 'the house keeps its box: its old place was safe on the old lines'
    assert abs(out['kept'][10][0] - 166.6) < 0.01 and abs(moved(out['kept'][10], out['old'][10]) - 3.3) < 0.01, 'the box stays at the driveway mouth'


def check_cabinets():
    # A house within 120 m of community cabinets has no box of its own. The cabinets follow their road; the test is
    # made with the place they had before the move.
    houses = [house(10, 200, 119)]
    out = bake([road(1, line(0))], [road(1, line(-2))], houses, cabinets=[dict(x=200.0, y=-2.5)], cabinets_before=[dict(x=200.0, y=-0.5)])
    assert len(out['old']) == 0 and len(out['naive']) == 1, 'the case: on the moved line the cabinets are 121.5 m away'
    assert len(out['kept']) == 0, 'a house that uses the cabinets gets no box of its own'


def check_side():
    # A box stands on the house's side of the road. A house 3 m north of the line; the line moves 5 m north, past it.
    out = bake([road(1, line(0))], [road(1, line(5))], [house(10, 100, 3)])
    assert abs(out['old'][10][1] - 4.2) < 0.01 and abs(out['naive'][10][1] - 0.8) < 0.01, 'the case: on the moved line the house is on the south side'
    assert abs(out['kept'][10][1] - 9.2) < 0.01 and out['kept'][10][3:] == (1, 'kept'), 'the box stays on the side it had and moves 5 m with the line'


def check_offset():
    # A frame that the old rule pushed 5 m along the road, clear of a building, keeps that push.
    wall = (101, 3.5, 104, 5.0)
    out = bake([road(1, line(0))], [road(1, line(2))], [house(10, 100, 30), house(11, 100, -30)], blocks=[wall])
    assert [box[2] for box in out['old'].values()] == [1, 1] and all(107 < box[0] < 108 for box in out['old'].values()), 'before the move: one frame, 5 m along'
    assert all(102 < box[0] < 103 for box in out['naive'].values()), 'the case: on the moved line the first place is clear, and the frame comes back 5 m'
    assert shape(out['kept']) == shape(out['old']) and all(box[4] == 'kept' for box in out['kept'].values())
    assert max(abs(moved(out['kept'][b], out['old'][b]) - 2.0) for b in (10, 11)) < 0.01, 'the frame stays 5 m along and moves 2 m with the line'


def check_end():
    # A frame at the end of a road. Its middle is carried like every place: the same piece of line, the same fraction.
    # The old rule keeps a frame's middle 1 m clear of the end; that is not looked at again on the moved line.
    out = bake([road(1, [(0, 0), (100, 0), (110, 6)])], [road(1, [(0, 0), (100, 0), (110, 0)])], [house(10, 125, 20), house(11, 130, 20)])
    assert [box[2] for box in out['old'].values()] == [1, 1]
    middle, naive_middle = (sum(box[0] for box in out[k].values()) / 2 for k in ('kept', 'naive'))
    assert abs(naive_middle - 108.7) < 0.01, 'the case: the old rule on the moved line stands 1.3 m before the new end'
    # 88.85 % of the last piece, before and after. The piece now runs east, so the boxes stand beside x = 108.885.
    assert shape(out['kept']) == shape(out['old']) and abs(middle - 108.885) < 0.01, ('the middle keeps its fraction of the last piece', middle)


def check_gone():
    # The one case that is placed again: the kept place is safe before the move and not after it.
    before = [road(1, line(0)), road(2, line(81))]
    now = [road(1, line(-3)), road(2, line(81))]
    shed = (100, 0.5, 105, 2.0)                    # a building's box: the old place (102.5, 4.2) is clear, the kept one (102.5, 1.2) is in it
    out = bake(before, now, [house(10, 100, 40)], blocks=[shed])
    assert out['old'][10][3] == 1 and 10 in out['kept'], 'a house whose place is gone still has a mailbox'
    x, y, group, on_road, how = out['kept'][10]
    assert not (shed[0] <= x <= shed[2] and shed[1] <= y <= shed[3]), 'no box stands in a building, whatever was decided before the move'
    assert (on_road, how) == (2, 'again') and abs(y - 76.8) < 0.01, 'it is placed again by the rule on the moved lines: the other road is nearer now'
    # A place that was not safe before the move had no box, and gets none: not where it was, not where it would be now.
    both = (100, 0.5, 105, 5.0)
    out = bake(before, now, [house(10, 100, 40)], blocks=[both])
    assert len(out['old']) == 0 and len(out['kept']) == 0, 'a house without a box before the move gets none after it'
    shed = (100, 3.5, 105, 5.0)                    # the old place (102.5, 4.2) is in it; the line moves 2 m and the place with it, out of it
    out = bake([road(1, line(0))], [road(1, line(2))], [house(10, 100, 30)], blocks=[shed])
    assert len(out['old']) == 0 and len(out['naive']) == 1, 'the case: on the moved line the place is clear'
    assert len(out['kept']) == 0, 'a house without a box before the move does not gain one because the line moved'
    # A frame whose place is gone stays a frame: the rule looks along the moved line, from the same house.
    wall = (101, 5.5, 104, 7.0)
    pair = [house(10, 100, 30), house(11, 100, -30)]
    out = bake([road(1, line(0))], [road(1, line(2))], pair, blocks=[wall])
    assert [box[2] for box in out['old'].values()] == [1, 1] and [box[2:] for box in out['kept'].values()] == [(1, 1, 'again'), (1, 1, 'again')], \
        'the two stay one frame, and the report says that it was placed again'
    for x, y, *_ in out['kept'].values():
        assert not (wall[0] <= x <= wall[2] and wall[1] <= y <= wall[3]) and 107 < x < 108, 'the frame stands 5 m along, clear of the building'
    # No place for the frame within the rule's 20 m: each box is placed again on its own, where the rule finds a place.
    long_wall = (80, 5.5, 125, 7.0)
    out = bake([road(1, line(0))], [road(1, line(2))], pair, blocks=[long_wall])
    assert [box[2] for box in out['old'].values()] == [1, 1]
    assert list(out['kept']) == [11] and out['kept'][11][2:] == (None, 1, 'again') and abs(out['kept'][11][1] + 2.2) < 0.01, \
        'the house across the road gets a box on its own side; the house behind the wall has no safe place'


def check_no_move():
    # Without a move the two networks are one, and the rule is the old rule: place_mailboxes(net, net). `bake` holds
    # every land of every case to that (its `same`); this land has a driveway, a kink, two frames and a house on its own.
    roads = [road(1, [(0, 0), (100, 0), (110, 6), (120, 0), (300, 0)]), road(2, [(164.1, 0), (164.1, 40), (164.1, 71)], 4)]
    houses = [house(10, 88, -30), house(11, 88, 30), house(12, 146, 30), house(13, 163, -30), house(14, 250, 200)]
    out = bake(roads, roads, houses)
    assert out['kept'] == out['old'] == out['naive'] and len(out['old']) == 5
    net = P.Network(copy.deepcopy(roads))
    r = net.roads[1]
    assert all(P.carry(r, r, s) == s for s in (-3.0, 0.0, 57.25, 400.0)), 'a road that did not move: the same metres, exactly'
    # A place is carried by its piece of line and its fraction of it, and past an end by its overshoot.
    then, now = P.Network([road(1, [(0, 0), (100, 0), (200, 0)])]).roads[1], P.Network([road(1, [(0, 0), (0, 50), (200, 50)])]).roads[1]
    for s, want in ((25.0, 12.5), (100.0, 50.0), (150.0, 150.0), (202.5, 252.5), (-1.0, -1.0)):
        assert abs(P.carry(then, now, s) - want) < 1e-9, (s, P.carry(then, now, s), want)
    # A point that is in the line twice (a piece without length), before the move or after it.
    then, now = P.Network([road(1, [(0, 0), (100, 0), (100, 0), (200, 0)])]).roads[1], P.Network([road(1, [(0, 0), (100, 2), (100, 5), (200, 5)])]).roads[1]
    for s, want in ((50.0, now['cum'][1] / 2), (100.0, now['cum'][2]), (150.0, now['cum'][2] + 50.0)):
        assert abs(P.carry(then, now, s) - want) < 1e-9, (s, P.carry(then, now, s), want)
    assert abs(P.carry(now, then, now['cum'][1] + 1.5) - 100.0) < 1e-9, 'a piece that the move took the length from: every place on it is its one point'


def check_lines_file():
    # 23_bake_roads.py keeps the lines before the move beside its reports and marks roads.json with the file's sha256.
    before = {1: [[0.0, 0.0], [100.0, 0.0]], 2: [[0.0, 50.0], [100.0, 50.0]]}
    roads = [road(1, [(0, 2), (100, 2)]), road(2, [(0, 50), (100, 50)])]
    with tempfile.TemporaryDirectory() as top, tempfile.TemporaryDirectory() as empty:
        folder = os.path.join(top, 'overview', 'area')      # a new area or a new work root: no report folder yet
        try:
            mark = RG.keep_lines_before(folder, before, roads)
        except OSError:
            raise AssertionError('the bake must make the report folder for the lines before the move')
        path = os.path.join(folder, RG.BEFORE_BED)
        assert os.listdir(folder) == [RG.BEFORE_BED] and len(mark['before']) == 64
        marked = dict(crs='EPSG:2961', roads=roads, bed=mark)
        assert RG.lines_before(marked, folder) == {1: before[1]}, 'the lines of the roads that moved, and only those'
        assert RG.lines_before(dict(crs='EPSG:2961', roads=roads), folder) == {}, 'roads without a mark never moved: the file is not read'

        def refused(what, road_file, where):
            try:
                RG.lines_before(road_file, where)
            except RuntimeError:
                return
            except Exception as other:
                raise AssertionError(f'{what} (it stopped, but by accident: {other!r})')
            raise AssertionError(what)
        refused('moved roads without their lines before the move must stop the bake', marked, empty)
        refused('a lines file that the mark does not name must stop the bake', dict(marked, bed=dict(before='0' * 64)), folder)
        # A mark that names no file is a damaged roads.json, not roads that never moved: with the file there or not.
        for damaged in ({}, None, '', dict(before=None), dict(before=mark['before'][:20]), mark['before']):
            for where in (folder, empty):
                refused(f'the mark {damaged!r} names no lines file: that must stop the bake', dict(marked, bed=damaged), where)
        open(path, 'ab').write(b' ')
        refused('a lines file that was changed must stop the bake', marked, folder)
        mark = RG.keep_lines_before(folder, before, roads)
        refused('a line that does not fit its road must stop the bake', dict(crs='EPSG:2961', roads=[road(1, [(0, 2), (50, 2), (100, 2)]), roads[1]], bed=mark), folder)
        try:
            RG.keep_lines_before(folder, before, [road(1, [(0, 2), (50, 2), (100, 2)]), roads[1]])
        except RuntimeError:
            pass
        else:
            raise AssertionError('a move that changes the number of points of a road must not be written')


CHECKS = [check_reach, check_road, check_window, check_anchor, check_mouth, check_cabinets, check_side, check_offset, check_end, check_gone,
          check_no_move, check_lines_file]

# name, file, the text to change, what it becomes, the check that must then fail
MUTATIONS = [
    ('the choices are made on the moved lines', PROPS, "found = candidate(b, ref, driveways, cabinets_before, village, exclusion)",
     "found = candidate(b, net, mouths(net), cabinets, village, exclusion)", check_reach),
    ('the nearest road is chosen on the moved lines', PROPS, "found = candidate(b, ref, driveways, cabinets_before, village, exclusion)",
     "found = candidate(b, net, mouths(net), cabinets, village, exclusion)", check_road),
    ('the driveway mouth is chosen on the moved lines', PROPS, "found = candidate(b, ref, driveways, cabinets_before, village, exclusion)",
     "found = candidate(b, net, mouths(net), cabinets, village, exclusion)", check_mouth),
    ('the frames are made from places on the moved lines', PROPS, "found = candidate(b, ref, driveways, cabinets_before, village, exclusion)",
     "found = candidate(b, net, mouths(net), cabinets, village, exclusion)", check_window),
    ('the frame stands at the house that is nearest on the moved lines', PROPS, "found = candidate(b, ref, driveways, cabinets_before, village, exclusion)",
     "found = candidate(b, net, mouths(net), cabinets, village, exclusion)", check_anchor),
    ('the 120 m test uses the cabinets where they stand now', PROPS, "found = candidate(b, ref, driveways, cabinets_before, village, exclusion)",
     "found = candidate(b, ref, driveways, cabinets, village, exclusion)", check_cabinets),
    ('the side of the road is chosen on the moved lines', PROPS, "found = candidate(b, ref, driveways, cabinets_before, village, exclusion)",
     "found = candidate(b, net, mouths(net), cabinets, village, exclusion)", check_side),
    ('safe() on the moved line is skipped for a box', PROPS, "m['side'])\n                    if safe((obj['x'], obj['y']), on=net):", "m['side'])\n                    if True:", check_gone),
    ('safe() on the moved line is skipped for a frame', PROPS, "                if not all(safe((obj['x'], obj['y']), on=net) for obj in positions):", "                if False:", check_gone),
    ('a box whose place is gone is dropped, not placed again', PROPS, "                        rows.append((m, *placed_again(m), 'again'))", "                        pass", check_gone),
    ('a house that had no box gains one when the line moves', PROPS, "                    if not safe((was['x'], was['y']), on=ref):", "                    if False:", check_gone),
    ('the place before the move is tested on the moved lines', PROPS, "                    if not safe((was['x'], was['y']), on=ref):", "                    if not safe((was['x'], was['y']), on=net):", check_mouth),
    ('a frame whose place is gone falls apart', PROPS, "positions, how = frame(net, now, carry(r, now, anchor['s']), cluster, anchor['side'], safe)[0], 'again'", "positions, how = None, 'again'", check_gone),
    ('a frame that was placed again is reported as kept', PROPS, "cluster, anchor['side'], safe)[0], 'again'", "cluster, anchor['side'], safe)[0], 'kept'", check_gone),
    ('the boxes of a frame that finds no place are lost', PROPS, "                    rows = [(m, *placed_again(m), 'again') for m in cluster]", "                    rows = []", check_gone),
    ('the push of a frame along the road is decided on the moved line', PROPS, "positions, how = frame_at(net, now, carry(r, now, centre_s), len(cluster), anchor['side']), 'kept'",
     "positions, how = frame(net, now, carry(r, now, anchor['s']), cluster, anchor['side'], safe)[0], 'kept'", check_offset),
    ('the middle of a carried frame is held 1 m from the end of the moved road again', PROPS, "frame_at(net, now, carry(r, now, centre_s), len(cluster), anchor['side']), 'kept'",
     "frame_at(net, now, min(now['cum'][-1] - (len(cluster) - 1) * .3 - 1, carry(r, now, centre_s)), len(cluster), anchor['side']), 'kept'", check_end),
    ('a place keeps its metres along the road, not its piece of line', PROPS, "    if before is now:\n        return s\n", "    return s\n", check_window),
    ('the overshoot past the end of a road is lost', PROPS, "        return now['cum'][-1] + (s - cum[-1])\n", "        return now['cum'][-1]\n", check_no_move),
    ('a street of kind 3 is no longer a public road', PROPS, "def public(r):\n    return r['kind'] <= 3\n", "def public(r):\n    return r['kind'] <= 2\n", check_window),
    ('the styles of the boxes come from another seed', PROPS, "SEED = 29017\n", "SEED = 29018\n", check_no_move),
    ('a house gets its mailbox twice', PROPS, "                    report.append(dict(building=m['id'], road=road, how=how))\n",
     "                    report.append(dict(building=m['id'], road=road, how=how))\n                    mailboxes.append(mailboxes[-1]); report.append(report[-1])\n", check_reach),
    ('the lines file is not checked against the mark', GROUND, "    if hashlib.sha256(raw).hexdigest() != mark['before']:", "    if False:", check_lines_file),
    ('moved roads without their lines file bake as if nothing moved', GROUND, "    if not os.path.isfile(path):\n        raise RuntimeError(", "    if not os.path.isfile(path):\n        return {}\n        raise RuntimeError(", check_lines_file),
    ('a line that does not fit its road is used', GROUND, "        if rid not in now or len(pts) != len(now[rid]):", "        if False:", check_lines_file),
    ('every road is written to the lines file, moved or not', GROUND, "             if [list(map(float, p)) for p in pts] != [list(map(float, p)) for p in now[rid]]}", "             }", check_lines_file),
    ('a mark that names no file counts as no mark', GROUND, "    if 'bed' not in road_file:", "    if not road_file.get('bed'):", check_lines_file),
    ('the form of the mark is not looked at', GROUND, "    if not isinstance(mark, dict) or not isinstance(mark.get('before'), str) or len(mark['before']) != 64:", "    if False:", check_lines_file),
    ('the report folder is not made', GROUND, "    os.makedirs(folder, exist_ok=True)", "    pass", check_lines_file),
    ('a move that changes a point count is written all the same', GROUND, "    if set(before) != set(now) or any(len(before[rid]) != len(now[rid]) for rid in now):", "    if False:", check_lines_file),
]


def check_bake_reads_the_lines():
    # The bake itself: the lines come from road_ground.lines_before with the area's report folder, both networks are
    # built from them, and the cabinets for the 120 m test stand on the lines before the move.
    text = open(PROPS).read()
    main = text[text.index('def main('):]
    for needle, what in (("before = road_ground.lines_before(road_file, AREA.overview)", 'the lines before the move are read, with their check'),
                         ("ref = Network([dict(r, pts=before[r['id']]) if r['id'] in before else r for r in roads]) if before else net", 'the network before the move'),
                         ("place_mailboxes(net, ref, sites, community, community if ref is net else cabinets(ref), safe,", 'the rule gets both networks and the cabinets before the move'),
                         ("    report_dir.mkdir(parents=True, exist_ok=True)\n    (report_dir / 'props-report.json').write_text(", 'the report folder is made before the report is written')):
        assert main.count(needle) == 1, f'29_bake_props.py main(): {what}'
    roads = open(os.path.join(ROOT, 'pipeline', '23_bake_roads.py')).read()
    for needle, what in (("            before = {road['id']: road['pts'] for road in roads}\n            moved = road_ground.move_to_bed(", 'the lines are taken before the move'),
                         ("            marks['bed'] = road_ground.keep_lines_before(terrain.OVERVIEW, before, roads)\n", 'the lines are kept and roads.json is marked'),
                         ("json.dump(dict(crs='EPSG:2961', roads=roads, **marks), f, separators=(',',':'))", 'the mark is written into roads.json')):
        assert roads.count(needle) == 1, f'23_bake_roads.py: {what}'


def check_community_sites():
    # 20 Nov dash-cam community mailbox groups (grok-bots#1347): Mabou hall (4 units), Port Hood junction (uncounted),
    # and Judique's existing 10-cabinet bank in web/src/judique-village-site.ts (no duplicate in community_sites).
    import areas, math, re
    mabou = areas.AREAS['mabou'].community_sites
    assert len(mabou) == 7 and mabou[0]['modules'] == 2
    assert mabou[3] == dict(exact=(624896.85, 5103595.12), heading=70.0, modules=4, flush=True)
    hall = mabou[6]
    assert hall['road'] == 'Little Mabou Road' and hall['toward'] == 'same' and hall['modules'] == 4
    assert math.hypot(hall['point'][0] - 620347, hall['point'][1] - 5102381) < 10
    porthood = areas.AREAS['porthood'].community_sites
    assert len(porthood) == 1
    jct = porthood[0]
    assert jct['road'] == 'Little Mabou Road' and jct['toward'] == 'same' and 'modules' not in jct
    assert math.hypot(jct['point'][0] - 613341, jct['point'][1] - 5098861) < 1
    assert areas.AREAS['judique'].community_sites == (), 'Judique keeps its hand-built mailbox bank in judique-village-site.ts'
    jv = open(os.path.join(ROOT, 'web', 'src', 'judique-village-site.ts')).read()
    m_pos = re.search(r'mailboxes:\s*\[\s*([\d.]+)\s*,\s*([\d.]+)\s*\]', jv)
    m_cnt = re.search(r'export const MAILBOX_CABINETS\s*=\s*(\d+)', jv)
    assert m_pos and m_cnt and int(m_cnt[1]) == 10 and math.hypot(float(m_pos[1]) - 617120, float(m_pos[2]) - 5081510) < 40


def main():
    global P, RG
    for check in CHECKS + [check_bake_reads_the_lines, check_community_sites]:
        check()
        print(f'PASS {check.__name__}')
    real = P, RG
    for name, path, was, becomes, check in MUTATIONS:
        text = open(path).read()
        assert text.count(was) == 1, f'mutation "{name}": its place in {os.path.basename(path)} is no longer unique'
        try:
            if path == GROUND:
                RG = load(GROUND, 'road_ground', text.replace(was, becomes))
            else:
                P = load(PROPS, 'props', text.replace(was, becomes))
            try:
                check()
            except AssertionError:
                print(f'PASS mutation caught: {name}')
            else:
                print(f'FAIL mutation not caught: {name}')
                sys.exit(1)
        finally:
            P, RG = real
    print(f'mail-places: {len(CHECKS) + 2} rules and {len(MUTATIONS)} mutations')


if __name__ == '__main__':
    main()
