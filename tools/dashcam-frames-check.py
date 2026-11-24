#!/usr/bin/env python3
"""Unit tests for tools/dashcam_frames.py on invented data. No footage, no ffmpeg, no network."""
import importlib.util
import math
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('dashcam_frames', ROOT / 'tools' / 'dashcam_frames.py')
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)

FAILS = []


def check(name, ok, detail=''):
    print(('PASS ' if ok else 'FAIL ') + name + (f': {detail}' if detail and not ok else ''))
    if not ok:
        FAILS.append(name)


def near(a, b, tol):
    return a is not None and b is not None and abs(a - b) <= tol


# An invented straight drive due north at 10 m/s from 45.0 N, 61.0 W, with fixes every second from UTC 1000 s.
LAT0, LON0 = 45.0, -61.0
DEG_PER_M = 1 / (math.radians(1) * d.EARTH_R)
north = lambda m: LAT0 + m * DEG_PER_M


def exif_doc(rows):
    out = {}
    for i, r in enumerate(rows, 1):
        for k, v in r.items():
            out[f'Doc{i}:{k}'] = v
    return out


# ---- reading the embedded GPS ----
piqo = exif_doc([dict(SampleTime=t / 10, GPSDateTime=f'2026:01:02 03:04:{5 + t / 10:06.3f}Z', GPSLatitude=north(t), GPSLongitude=LON0)
                 for t in range(5)])
f = d.fixes_from_exif(piqo)
check('piqo: timed fixes kept with their own UTC', len(f) == 5 and near(f[1][1] - f[0][1], 0.1, 1e-6) and f[1][0] == 0.1)

# Garmin: real seconds in the untimed set, CreateDate + clip time in the timed set (here 2 s behind).
real = [dict(GPSDateTime=f'2026:01:02 03:04:{10 + t:02d}Z', GPSLatitude=north(10 * t), GPSLongitude=LON0) for t in range(6)]
synth = [dict(SampleTime=t, GPSDateTime=f'2026:01:02 03:04:{8 + t:02d}.000Z', GPSLatitude=north(10 * t), GPSLongitude=LON0) for t in range(6)]
f = d.fixes_from_exif(exif_doc(real + synth))
check('garmin: clip time from the timed set, UTC from the real set',
      len(f) == 6 and f[2][0] == 2 and near(f[2][1] - f[0][1], 2, 1e-6) and near(f[0][1] % 60, 10, 1e-6))
mixed = [dict(r, GPSLatitude=r['GPSLatitude'] + 0.01) for r in real]
f = d.fixes_from_exif(exif_doc(mixed + synth))
check('garmin: sets that do not pair up fall back to the timed set', len(f) == 6 and near(f[0][1] % 60, 8, 1e-6))
nofix = exif_doc([dict(SampleTime=0, GPSDateTime='2026:01:02 03:04:05Z', GPSLatitude=0.0, GPSLongitude=0.0)])
check('a (0, 0) fix is no fix', d.fixes_from_exif(nofix) == [])
placeholder = exif_doc([dict(SampleTime=0, GPSDateTime='0000:00:00 00:00:00Z', GPSLatitude=LAT0, GPSLongitude=LON0),
                        dict(SampleTime=1, GPSDateTime='2026:01:02 03:04:05Z', GPSLatitude='n/a', GPSLongitude=LON0),
                        dict(SampleTime=2, GPSDateTime='2026:01:02 03:04:06Z', GPSLatitude=LAT0, GPSLongitude=LON0)])
check('placeholder fixes are skipped, not fatal', len(d.fixes_from_exif(placeholder)) == 1)
f = d.fixes_from_exif(exif_doc(real[:2] + synth))
check('garmin: too few real fixes to pair with all timed ones falls back to the timed set', len(f) == 6 and near(f[0][1] % 60, 8, 1e-6))

# ---- clip start ----
check('sub-second clock: median of (UTC - clip time)', near(d.clip_start([(0, 100.4, 0, 0), (1, 101.4, 0, 0), (2, 107, 0, 0)]), 100.4, 1e-9))
check('sub-second clock that starts on a whole second is not read as whole-second',
      near(d.clip_start(d.fixes_from_exif(piqo)), d.parse_utc('2026:01:02 03:04:05Z').timestamp(), 1e-6))
check('whole-second clock with clip times off the second', near(d.clip_start([(0.3 + i, 1000 + i, 0, 0) for i in range(5)]), 1000.2, 1e-9))
check('whole-second clock, disagreeing fixes: median plus 0.5', near(d.clip_start([(0, 100, 0, 0), (1, 103, 0, 0), (2, 102, 0, 0)]), 100.5, 1e-9))
check('whole-second clock: middle of the one-second window', near(d.clip_start([(0, 100, 0, 0), (1, 101, 0, 0)]), 100.5, 1e-9))
check('whole-second clock: a drift across a second narrows the window',
      near(d.clip_start([(0, 100, 0, 0), (1, 102, 0, 0), (2, 102, 0, 0)]), 101, 1e-9))

# ---- track maths ----
track = d.Track([(1000 + t, north(10 * t), LON0) for t in range(21)] + [(1005, north(50), LON0)])
check('track keeps one fix per time', len(track) == 21)
at = d.interpolate(track, 1002.25)
check('position between fixes', at and near((at[0] - LAT0) / DEG_PER_M, 22.5, 1e-6) and near(at[2], 0.25, 1e-9))
check('outside the track: no position', d.interpolate(track, 999) is None and d.interpolate(track, 1021) is None)
check('heading north while moving', near(d.travel_heading(track, 1010), 0, 0.01) or near(d.travel_heading(track, 1010), 360, 0.01))
check('speed 36 km/h', near(d.speed_kmh(track, 1010), 36, 0.01))
check('side camera faces east when driving north', near(d.camera_heading(d.travel_heading(track, 1010), 90), 90, 0.01))
stopped = d.Track([(t, LAT0, LON0) for t in range(5)])
check('no heading while stopped', d.travel_heading(stopped, 2) is None and d.camera_heading(None, 90) is None)

marks = d.targets_by_distance(track, 25, 1.5)
check('one target per 25 m', [round(m - 1000, 3) for m in marks] == [0, 2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20])
stop_go = d.Track([(t, north(0), LON0) for t in range(10)] + [(9 + t, north(10 * t), LON0) for t in range(1, 4)])
check('a stop gives no targets; counting starts when the car moves',
      [round(m, 3) for m in d.targets_by_distance(stop_go, 25, 1.5)] == [9, 11.5])
gappy = d.Track([(1000, north(0), LON0), (1001, north(10), LON0), (1005, north(400), LON0), (1006, north(410), LON0)])
check('no target is invented inside a GPS gap', [round(m, 3) for m in d.targets_by_distance(gappy, 5, 1.5)] == [1000, 1000.5, 1001, 1005, 1005.5, 1006])
check('time targets', d.targets_by_time(track, 5, 1.5) == [1000, 1005, 1010, 1015])

# ---- frames ----
pts = [i / 30 for i in range(300)]
check('nearest frame', d.nearest_frame(pts, 2.51) == (75, 2.5) and d.nearest_frame(pts, -1) == (0, 0))
clip_fl = dict(name='C_FL', start_utc=1000, pts=pts, width=848)
clip_fh = dict(name='C_FH', start_utc=1000, pts=pts, width=2560)
frames, skipped = d.choose_frames([clip_fl, clip_fh], track, [1002.505, 1002.51, 1050], 0.1, 1.5)
check('full quality wins over low quality', frames and frames[0]['clip'] == 'C_FH')
check('position is taken at the frame time, not the target time',
      frames and frames[0]['pts'] == 2.5 and near((frames[0]['lat'] - LAT0) / DEG_PER_M, 25.0, 1e-6))
check('a second target on the same frame is skipped', skipped.get('same frame as the previous target') == 1)
check('a target no clip covers is skipped', skipped.get('no clip covers this time') == 1)
sparse = dict(name='S', start_utc=1000, pts=[0, 1, 2, 3], width=1)
_, skipped = d.choose_frames([sparse], track, [1001.5], 0.1, 1.5)
check('no frame within the tolerance is skipped', skipped.get('no frame within 100 ms') == 1)
_, skipped = d.choose_frames([clip_fh], gappy, [1003], 0.1, 1.5)
check('a frame inside a GPS gap is skipped', skipped == {'nearest GPS fix more than 1.5 s away': 1}, str(skipped))
check('no position inside a GPS gap', d.interpolate(gappy, 1001.4, 1.5) is None and d.interpolate(gappy, 1000.5, 1.5) is not None)
check('heading and speed at the edge of a gap stay inside the run',
      near(d.travel_heading(gappy, 1001), 0, 0.01) and near(d.speed_kmh(gappy, 1001), 36, 0.01))
check('no heading or speed inside a gap, outside the track or on no track',
      all(f(gappy, u) is None for f in (d.travel_heading, d.speed_kmh) for u in (1003, 1001.2, 999.5, 1006.5))
      and d.run_bounds(d.Track([]), 1, 1.5) is None)
c1 = dict(name='C001', start_utc=1000, pts=[i / 30 for i in range(1800)], width=100)
c2 = dict(name='C002', start_utc=1060.05, pts=[i / 30 for i in range(1800)], width=100)
long_track = d.Track([(1000 + t, north(10 * t), LON0) for t in range(130)])
fr, _ = d.choose_frames([c1, c2], long_track, [1059.96], 0.1, 1.5)
check('neighbouring clips: the nearer frame wins', fr and fr[0]['clip'] == 'C001', str(fr))
fh_drop = dict(name='D_FH', start_utc=1000, pts=[i / 30 for i in range(300) if not 70 <= i <= 80], width=2560)
fr, _ = d.choose_frames([fh_drop, clip_fl], track, [1002.5], 0.1, 1.5)
check('frames missing in FH: FL is used', fr and fr[0]['clip'] == 'C_FL', str(fr))

# ---- turns and runs ----
bend = [(t, 1000 + t, north(10 * t * math.cos(math.radians(a))), LON0 + 10 * t * math.sin(math.radians(a)) * DEG_PER_M / math.cos(math.radians(LAT0)))
        for t, a in enumerate([-20, -10, 0, 10, 20])]
rates = d.turn_rates(bend, 1000)
check('turn rate across north (350 to 10 deg) is small and positive', rates and all(0 < r[1] < 0.5 for r in rates), str(rates))
check('runs split at gaps', [len(x) for x in d.segments(d.Track([(0, 0, 0), (1, 0, 0), (9, 0, 0), (10, 0, 0)]))] == [2, 2])
names = d.clip_names([Path('/a/100/GRMN0001.MP4'), Path('/a/101/GRMN0001.MP4'), Path('/a/101/GRMN0002.MP4')])
check('same file name in two folders: unique clip names', sorted(names.values()) == ['100_GRMN0001', '101_GRMN0001', 'GRMN0002'])
names = d.clip_names([Path('/day1/DCIM/100/G1.MP4'), Path('/day2/DCIM/100/G1.MP4')])
check('same file and folder name on two days: still unique', len({n.casefold() for n in names.values()}) == 2, str(names))
names = d.clip_names([Path('/a/100/X.MP4'), Path('/b/101/X.MP4'), Path('/c/100_X.MP4')])
check('a prefixed name cannot meet another clip name', len({n.casefold() for n in names.values()}) == 3, str(names))

# ---- lag from turns ----
rates = [(t / 2, math.sin(t / 7) * 0.2 + math.sin(t / 3.1) * 0.05, 15.0) for t in range(130)]
vt = [i / 10 + 0.05 for i in range(600)]
lerp = lambda x: d._lerp([r[0] for r in rates], [r[1] for r in rates], x)
slide = [-40 * lerp(t + 0.6) if lerp(t + 0.6) is not None else 0.0 for t in vt]
lag = d.best_lag(vt, slide, rates)
check('turn test finds a 0.6 s lag', lag and near(lag[0], 0.6, 0.051) and lag[1] < -0.95, str(lag))
check('turn test needs movement', d.best_lag(vt, slide, [(r[0], r[1], 1.0) for r in rates]) is None)

# ---- privacy guard ----
try:
    d.main(['--camera', 'garmin', '--out', str(ROOT / 'tools' / 'tmp-out'), 'x.MP4'])
    check('refuses an output folder in the repository outside data/', False)
except SystemExit as e:
    check('refuses an output folder in the repository outside data/', e.code == 2 and not (ROOT / 'tools' / 'tmp-out').exists())

with tempfile.TemporaryDirectory() as tmp:
    fake = Path(tmp) / 'repo'
    (fake / 'tools').mkdir(parents=True)
    check('privacy guard accepts data/ before it exists',
          d.inside(fake / 'data' / 'work', fake / 'data') and not d.inside(fake / 'tools' / 'x', fake / 'data'))
    check('privacy guard sees through .. before data/ exists',
          d.inside(fake / 'data' / '..' / 'tools' / 'x', fake) and not d.inside(fake / 'data' / '..' / 'tools', fake / 'data'))
    (Path(tmp) / 'link').symlink_to(fake / 'tools')
    check('privacy guard follows symbolic links', d.inside(Path(tmp) / 'link' / 'out', fake))
    (fake / 'data').mkdir()
    check('privacy guard sees through ..',
          d.inside(fake / 'data' / '..' / 'tools' / 'x', fake) and not d.inside(fake / 'data' / '..' / 'tools', fake / 'data'))
    (fake / 'data' / 'sub').symlink_to(fake / 'tools')
    check('a link from data/ into the repo is not data/', not d.inside(fake / 'data' / 'sub' / 'out', fake / 'data'))
    wt = Path(tmp) / 'worktree'
    (wt / 'tools').mkdir(parents=True)
    (wt / 'data').symlink_to(fake / 'data')
    (fake / 'data' / 'wt-sub').symlink_to(wt / 'tools')
    check('worktree with linked data/ allows data/ and blocks repo paths',
          d.inside(wt / 'data' / 'work', wt / 'data')
          and not d.inside(wt / 'data' / 'work', wt)
          and d.inside(wt / 'tools' / '..' / 'tools' / 'x', wt)
          and not d.inside(wt / 'tools' / '..' / 'tools', wt / 'data')
          and d.inside(wt / 'data' / 'wt-sub' / 'out', wt)
          and not d.inside(wt / 'data' / 'wt-sub' / 'out', wt / 'data'))
other_case = Path(str(ROOT).swapcase())
check('privacy guard sees through letter case on a case-insensitive disk',
      not other_case.exists() or d.inside(other_case / 'tools', ROOT))
for bad in (['--every-m', '0'], ['--every-s', '-1'], ['--max-gap-s', '0'], ['--tolerance-ms', '-1']):
    try:
        d.main(['--camera', 'garmin', '--out', '/nonexistent-dir', *bad, 'x.MP4'])
        check('refuses ' + ' '.join(bad), False)
    except SystemExit as e:
        check('refuses ' + ' '.join(bad), e.code == 2)

print(f'{len(FAILS)} failed' if FAILS else 'all passed')
sys.exit(1 if FAILS else 0)
