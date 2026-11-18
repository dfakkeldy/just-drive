"""Do the checks of the large buildings catch a wrong bake? Each mutant is one changed line in a copy of this folder,
and the check must fail on it. First the unchanged copy runs: it must pass, or "caught" would mean nothing.
Row big-buildings-mutations of tools/checks.tsv (about 2 minutes):

    python3 pipeline/27_check_big_mutants.py

It writes only to a temporary folder. A mutant runs 27_check_big.py; the one of step 30 runs its own check.
"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).parent
BIG, BAKE, AREA_CHECK, STYLES = 'big_buildings.py', '27_bake_buildings.py', '27_check_buildings.py', '30_bake_building_styles.py'
FIT = 'if not abs(again["edge"] - radius) <= EDGE_FIT or again["beyond"] >= BEYOND_FIT:'
MUTANTS = [
    # The size of a tank.
    ('a tank 7 % too small', BIG, 'diameter = 2 * math.sqrt(float(body.sum()) / math.pi)', 'diameter = .93 * 2 * math.sqrt(float(body.sum()) / math.pi)'),
    ('a tank 2 % too small', BIG, 'diameter = 2 * math.sqrt(float(body.sum()) / math.pi)', 'diameter = .98 * 2 * math.sqrt(float(body.sum()) / math.pi)'),
    ('the diameter from the trimmed spans again', BIG, 'diameter = 2 * math.sqrt(float(body.sum()) / math.pi)', 'diameter = float(np.mean([s[0] for s in spans])) + 1'),
    ('the body is not closed', BIG, 'body = closed(cells & (h > max(ABOVE_GROUND, .5 * top)))', 'body = cells & (h > max(ABOVE_GROUND, .5 * top))'),
    ('the body is closed along rows only', BIG, '    return rows & columns', '    return rows'),
    # The wall of a tank.
    ('the rim ring from 2 to 0 m inside', BIG, 'ring = (distance < radius - .5) & (distance > radius - 3)\n    rim', 'ring = (distance < radius) & (distance > radius - 2)\n    rim'),
    ('a thin wall is called a rim that does not stand', BIG, "reason='thin_wall' if thin else 'rim_does_not_stand'", "reason='rim_does_not_stand'"),
    ('a heap is called a thin wall', BIG, "reason='thin_wall' if thin else 'rim_does_not_stand'", "reason='thin_wall'"),
    ('the edge search stops in the low inside of a tank', BIG, '        elif before is not None:\n            # Between the middle of the ring before and the middle of this one.\n            edge = float(inner - .25 +',
     '        else:\n            edge = float(inner + .25 if before is None else inner - .25 +'),
    ('the wall edge is read at half of the shell, not half of the top', BIG, 'share = float((h[ring] > .5 * ridge).mean())', 'share = float((h[ring] > .5 * eave).mean())'),
    ('the edge is not placed between two rings', BIG, 'edge = float(inner - .25 + .5 * (before - .5) / max(1e-9, before - share))', 'edge = float(inner)'),
    ("the confidence of a tank without its rim", BAKE, 'confidence = round(min(.95, .5 + .25 * found["rim"] + .2 * found["roundness"]), 2)',
     'confidence = round(min(.95, .75 + .2 * found["roundness"]), 2)'),
    # What the bake leaves out.
    ('a tank wider than its measured cells is written', BIG, FIT, 'if False:'),
    ('only the wall edge is tested', BIG, FIT, 'if not abs(again["edge"] - radius) <= EDGE_FIT:'),
    ('only the ring outside is tested', BIG, FIT, 'if again["beyond"] >= BEYOND_FIT:'),
    ('the two reasons swapped', BIG, "reason='wider_than_mapped' if again[\"edge\"] > radius + EDGE_FIT", "reason='edge_does_not_fit' if again[\"edge\"] > radius + EDGE_FIT"),
    ('the bake as wide as the check on the edge', BIG, 'EDGE_FIT, CHECK_EDGE_FIT = .75, 1.0', 'EDGE_FIT, CHECK_EDGE_FIT = 1.4, 1.5'),
    ('the bake does not test the shell height', BIG, "    if not abs(again[\"shell\"] - eave) <= SHELL_FIT:\n        return dict(result, reason='shell_height_not_clear')\n", ''),
    # The area's check (27_check_buildings.check_big).
    ("the area's check accepts a tank 3 m short", BIG, 'EDGE_FIT, CHECK_EDGE_FIT = .75, 1.0', 'EDGE_FIT, CHECK_EDGE_FIT = .75, 3.0'),
    ("the area's check accepts anything round a tank", BIG, 'BEYOND_FIT, CHECK_BEYOND_FIT = .4, .5', 'BEYOND_FIT, CHECK_BEYOND_FIT = .4, 1.0'),
    ("the area's check accepts any shell height", BIG, 'SHELL_FIT, CHECK_SHELL_FIT = 1.0, 1.5', 'SHELL_FIT, CHECK_SHELL_FIT = 1.0, 9.0'),
    ("the area's check does not test the size", AREA_CHECK, 'assert abs(again["edge"] - radius) <= big.CHECK_EDGE_FIT', 'assert True or abs(again["edge"] - radius) <= big.CHECK_EDGE_FIT'),
    ("the area's check does not test the ring outside", AREA_CHECK, 'assert again["beyond"] < big.CHECK_BEYOND_FIT', 'assert True or again["beyond"] < big.CHECK_BEYOND_FIT'),
    ("the area's check does not test the shell height", AREA_CHECK, 'assert abs(again["shell"] - item["eave"]) < big.CHECK_SHELL_FIT', 'assert True or abs(again["shell"] - item["eave"]) < big.CHECK_SHELL_FIT'),
    ("the area's check does not test the rim", AREA_CHECK, 'assert rim >= big.MIN_STANDING, (bid, "tank rim", rim)', 'assert True or rim >= big.MIN_STANDING'),
    # The bake of step 27.
    ('new ids count from the kept ids only', BAKE, 'next_id = max([b["id"] for b in kept] + list(seed_by_id)) + 1', 'next_id = max([b["id"] for b in kept], default=0) + 1'),
    ('--preserve-sites keeps blocks and tanks', BAKE, 'if b.get("buildingId", b["id"]) == b["id"] and "shape" not in b]', 'if b.get("buildingId", b["id"]) == b["id"]]'),
    ('a broken height is a height', BAKE, '    h[h > big.MAX_HEIGHT] = np.nan\n', ''),
    ('the bake does not stop for a land with large buildings', BAKE, '    guard_big(OUT / "buildings.json", BIG_SET, BIG)  # before anything is read or written\n', ''),
    # Step 30: its own check.
    ('a block or a tank takes the paint of a landmark', STYLES, "near = [b for b in buildings if 'shape' not in b and", 'near = [b for b in buildings if', '30_check_building_styles.py'),
]


def run(folder, mutant=None):
    """A copy of this folder with one line changed (or none): did its check fail on an assertion?"""
    work = Path(folder) / 'pipeline'
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir()
    for path in HERE.glob('*'):
        if path.suffix in ('.py', '.json'):
            shutil.copy(path, work / path.name)
    check = '27_check_big.py'
    if mutant:
        name, file, old, new, check = (*mutant, check)[:5]
        text = (work / file).read_text()
        assert text.count(old) == 1, f'{name}: the line to change is not in {file} once'
        (work / file).write_text(text.replace(old, new))
    done = subprocess.run([sys.executable, str(work / check)], capture_output=True, text=True)
    return done.returncode != 0 and 'AssertionError' in done.stderr, done


missed = []
with tempfile.TemporaryDirectory() as folder:
    for check in ('27_check_big.py', '30_check_building_styles.py'):
        failed, done = run(folder, ('the unchanged copy', BIG, 'TANK_POINTS = 32', 'TANK_POINTS = 32', check))
        assert done.returncode == 0, f'the unchanged copy must pass {check}:\n{done.stderr[-2000:]}'
        print(f'passes  the unchanged copy ({check})', flush=True)
    for mutant in MUTANTS:
        caught, _ = run(folder, mutant)
        print(('caught  ' if caught else 'MISSED  ') + mutant[0], flush=True)
        if not caught:
            missed.append(mutant[0])
assert not missed, missed
print(f'PASS: the unchanged copy passes, and the checks catch all {len(MUTANTS)} mutants.')
