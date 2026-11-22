#!/usr/bin/env python3
"""Place dash cam frames on the map: one still every N metres, each with its position and heading.

The idea comes from survey tools such as StreetView 2.0: the camera stores its GPS fixes, and each frame has its own
presentation time. This tool matches the two by the frame's real time, read from the video packets. It never trusts a
seek time or an assumed keyframe spacing. (On 12 Nov, stills labelled by an assumed keyframe spacing were placed up to
800 m from where they were taken.)

Supported cameras: the Garmin Dash Cam (GPS 1/s) and the Nextbase Piqo (GPS 10/s). Both store GPS inside the MP4.
Give one camera per run. The camera's mount direction sets the photo heading:
garmin = forward (0 deg), piqo-side = out of the driver's window of a right-hand-drive car (+90 deg).

    python3 tools/dashcam_frames.py --camera piqo-side --out OUT [--every-m 10] [--stills] CLIP.MP4 ...
    python3 tools/dashcam_frames.py --camera garmin --out OUT --measure-lag CLIP.MP4 ...

Writes into OUT (keep OUT under data/ or outside the repository; footage and stills are private):
  frames.geojson  one point per chosen frame (clip, frame, UTC and Halifax time, position, headings, speed, accuracy)
  track.geojson   the driven line, split where the GPS stops for more than 5 s
  report.json     counts, and the reason for every target that has no frame
  stills/         full-size JPEGs, only with --stills (about 0.8 MB each: a day at 10 m is about 14,000 stills and
                  11 GB, so choose a larger step or fewer clips)
  gps-cache/      the GPS read from each clip, so a second run is fast

A day of one camera (about 220 one-minute clips) takes about 3 minutes without stills.

How exact is it? Measured on 12 Nov 2026 footage (tools/dashcam-frames-check.py has the unit tests):
  * Each still is the frame it names: pixel-identical to a decode of that frame number.
  * Piqo: the coordinates the camera burns into its own picture belong to the frame's second within about 0.13 s
    (61 frames). That is about 4 m at 100 km/h.
  * Garmin: see CAMERAS below. Its embedded clock is synthetic, and its video lags its GPS by about 1.2 s. After the
    correction about +/-0.6 s remains per clip (about +/-15 m at 100 km/h). Use the Piqo for exact positions.
  * --measure-lag re-measures a forward camera's lag from turns (the scene slides sideways in the video when the GPS
    heading changes). It needs numpy and does not change the output.

Needs exiftool, ffprobe and ffmpeg. East/north on the game grid (EPSG:2961) need GDAL's Python bindings; without
them the points carry only longitude and latitude. The clips are only read.
"""
import argparse
import bisect
import datetime as dt
import json
import math
import os
import subprocess
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

# mount: photo direction, degrees clockwise from the car's nose.
# shift: seconds added to the clip start from the GPS to get the time each frame was really taken.
# accuracy: the remaining timing error of a frame, in seconds, as measured.
# Garmin, 12 Nov 2026: the turn test (--measure-lag) on 18 curving clips gave a median lag of -1.18 s and a spread of
# about +/-0.6 s between clips. Its GPS track itself agrees with the Piqo's to 3.8 m (median) once the real GPS
# seconds are used (see fixes_from_exif).
CAMERAS = {'garmin': dict(mount=0.0, shift=-1.2, accuracy=0.6),
           'piqo-side': dict(mount=90.0, shift=0.0, accuracy=0.15),
           'piqo-forward': dict(mount=0.0, shift=0.0, accuracy=0.15)}
CACHE_VERSION = 2
HALIFAX = ZoneInfo('America/Halifax')
EARTH_R = 6371008.8


# ---------- pure parts (unit tested in tools/dashcam-frames-check.py) ----------

def parse_utc(text):
    """exiftool GPSDateTime, e.g. '2026:11:12 18:00:51.600Z', as an aware UTC datetime."""
    s = text.rstrip('Z')
    fmt = '%Y:%m:%d %H:%M:%S.%f' if '.' in s else '%Y:%m:%d %H:%M:%S'
    return dt.datetime.strptime(s, fmt).replace(tzinfo=dt.timezone.utc)


def fixes_from_exif(doc):
    """GPS fixes (clip_t, utc_seconds, lat, lon) from one exiftool -ee -j -G3 record.

    The Piqo stores each fix once, with its clip time and its real GPS time. The Garmin stores each fix twice: first
    with the real GPS second and no clip time, then with a clip time whose UTC is only the file's CreateDate plus that
    clip time. That second clock is not GPS time: it put the 12 Nov Garmin track 0-2 s off (8.5 m median from the Piqo
    track instead of 3.8 m). When a clip has both sets in the same order with the same coordinates, each fix takes its
    clip time from the second set and its UTC from the first."""
    docs = {}
    for key, value in doc.items():
        if key.startswith('Doc') and ':' in key:
            n, name = key[3:].split(':', 1)
            if n.isdigit():
                docs.setdefault(int(n), {})[name] = value
    timed, untimed = [], []
    for n in sorted(docs):
        d = docs[n]
        t, utc, lat, lon = d.get('SampleTime'), d.get('GPSDateTime'), d.get('GPSLatitude'), d.get('GPSLongitude')
        if not utc or lat in (None, '') or lon in (None, ''):
            continue
        lat, lon = float(lat), float(lon)
        if (lat, lon) == (0.0, 0.0) or not (-90 <= lat <= 90 and -180 <= lon <= 180):
            continue
        fix = (None if t in (None, '') else float(t), parse_utc(str(utc)).timestamp(), lat, lon)
        (untimed if fix[0] is None else timed).append(fix)
    if untimed and timed:
        pairs = [(a, b) for a, b in zip(untimed, timed) if (a[2], a[3]) == (b[2], b[3])]
        if len(pairs) >= 0.9 * min(len(untimed), len(timed)):
            return [(b[0], a[1], b[2], b[3]) for a, b in pairs]
    return timed


def clip_start(fixes):
    """UTC of clip time 0, before the camera's shift.
    Sub-second GPS times (Piqo): the median of (fix UTC - clip time), robust to one bad sample.
    Whole-second GPS times (Garmin): the fix written at clip second t is the latest one then, so clip second t falls
    in [u, u + 1) and the start in [u - t, u - t + 1). Returns the middle of the window all fixes allow; when the
    camera's second drifts across a GPS second the window is narrow. If the fixes disagree, the median plus 0.5."""
    starts = sorted(u - t for t, u, _, _ in fixes)
    if any(abs(x - round(x)) > 0.01 for x in starts):
        return starts[len(starts) // 2]
    lo, hi = starts[-1], starts[0] + 1
    return (lo + hi) / 2 if lo <= hi else starts[len(starts) // 2] + 0.5


def metres(lat0, lon0, lat1, lon1):
    """(east, north) metres from point 0 to point 1; exact enough over a few hundred metres."""
    k = math.radians(1) * EARTH_R
    return (lon1 - lon0) * k * math.cos(math.radians((lat0 + lat1) / 2)), (lat1 - lat0) * k


class Track(list):
    """A time-sorted list of fixes (u, lat, lon), one per time, that keeps its times for a fast search."""
    def __init__(self, fixes):
        by_time = {}
        for u, lat, lon in fixes:
            by_time.setdefault(round(u, 2), (u, lat, lon))
        super().__init__(sorted(by_time.values()))
        self.times = [p[0] for p in self]


def interpolate(track, u):
    """(lat, lon, gap_s) at UTC seconds u on a Track, gap_s = time to the nearest fix. None outside the track."""
    times = track.times
    i = bisect.bisect_left(times, u)
    if i < len(times) and times[i] == u:
        return track[i][1], track[i][2], 0.0
    if i == 0 or i == len(times):
        return None
    (u0, a0, o0), (u1, a1, o1) = track[i - 1], track[i]
    f = (u - u0) / (u1 - u0)
    return a0 + f * (a1 - a0), o0 + f * (o1 - o0), min(u - u0, u1 - u)


def travel_heading(track, u, window=1.0, min_move=1.5):
    """Direction of travel in degrees (0 = north, clockwise) from the positions window seconds either side of u.
    None when the car moved less than min_move metres (stopped: no honest heading)."""
    a, b = interpolate(track, max(u - window, track[0][0])), interpolate(track, min(u + window, track[-1][0]))
    if a is None or b is None:
        return None
    e, n = metres(a[0], a[1], b[0], b[1])
    if math.hypot(e, n) < min_move:
        return None
    return math.degrees(math.atan2(e, n)) % 360


def speed_kmh(track, u, window=1.0):
    t0, t1 = max(u - window, track[0][0]), min(u + window, track[-1][0])
    a, b = interpolate(track, t0), interpolate(track, t1)
    if a is None or b is None or t1 <= t0:
        return None
    return math.hypot(*metres(a[0], a[1], b[0], b[1])) / (t1 - t0) * 3.6


def targets_by_distance(track, every_m, max_gap):
    """UTC seconds at every every_m metres driven. Distance does not grow while stopped, so stops give no targets.
    A GPS gap longer than max_gap restarts the count (no target is invented inside a gap)."""
    out, run, next_mark = [], 0.0, 0.0
    for (u0, a0, o0), (u1, a1, o1) in zip(track, track[1:]):
        if u1 - u0 > max_gap:
            run, next_mark = 0.0, 0.0
            continue
        step = math.hypot(*metres(a0, o0, a1, o1))
        while step > 0 and run + step >= next_mark:
            out.append(u0 + (next_mark - run) / step * (u1 - u0))
            next_mark += every_m
        run += step
    return out


def targets_by_time(track, every_s, max_gap):
    out = []
    for (u0, _, _), (u1, _, _) in zip(track, track[1:]):
        if u1 - u0 > max_gap:
            continue
        k = math.ceil(u0 / every_s)
        while k * every_s < u1:
            out.append(k * every_s)
            k += 1
    return sorted(set(out))


def nearest_frame(pts, t):
    """(index, pts) of the frame whose presentation time is closest to clip time t; pts must be sorted."""
    i = bisect.bisect_left(pts, t)
    best = min((j for j in (i - 1, i) if 0 <= j < len(pts)), key=lambda j: abs(pts[j] - t))
    return best, pts[best]


def choose_frames(clips, track, targets, tolerance, max_gap):
    """Map each target UTC to a real frame and place it at that frame's own time.
    clips: [{'name', 'start_utc', 'pts' (sorted, from 0), 'width'}]. Returns (frames, skipped)."""
    frames, skipped, seen = [], {}, set()
    def skip(why):
        skipped[why] = skipped.get(why, 0) + 1
    for u in targets:
        hits = [c for c in clips if c['pts'] and c['start_utc'] + c['pts'][0] - tolerance <= u <= c['start_utc'] + c['pts'][-1] + tolerance]
        if not hits:
            skip('no clip covers this time')
            continue
        clip = max(hits, key=lambda c: (c['width'], c['name']))      # FH over FL when both are given
        idx, pts = nearest_frame(clip['pts'], u - clip['start_utc'])
        frame_u = clip['start_utc'] + pts
        if abs(frame_u - u) > tolerance:
            skip(f'no frame within {tolerance * 1000:.0f} ms')
            continue
        if (clip['name'], idx) in seen:
            skip('same frame as the previous target')
            continue
        at = interpolate(track, frame_u)
        if at is None or at[2] > max_gap:
            skip(f'nearest GPS fix more than {max_gap:g} s away')
            continue
        seen.add((clip['name'], idx))
        frames.append(dict(clip=clip['name'], frame=idx, pts=round(pts, 6), utc=frame_u, lat=at[0], lon=at[1],
                           fix_gap_s=round(at[2], 3)))
    return frames, skipped


def camera_heading(travel, mount):
    return None if travel is None else (travel + mount) % 360


def segments(track, max_gap=5.0):
    out, cur = [], []
    for p in track:
        if cur and p[0] - cur[-1][0] > max_gap:
            out.append(cur)
            cur = []
        cur.append(p)
    if cur:
        out.append(cur)
    return [s for s in out if len(s) > 1]


def turn_rates(fixes, start):
    """GPS turn rate (rad/s) and speed (m/s) at mid-times on the clip's timeline, from fixes (clip_t, u, lat, lon)."""
    pts = sorted({u: (u - start, a, o) for _, u, a, o in fixes}.values())
    head = []
    for (ta, aa, oa), (tb, ab, ob) in zip(pts, pts[1:]):
        e, n = metres(aa, oa, ab, ob)
        head.append(((ta + tb) / 2, math.atan2(e, n), math.hypot(e, n) / (tb - ta)))
    return [((h0[0] + h1[0]) / 2, ((h1[1] - h0[1] + math.pi) % (2 * math.pi) - math.pi) / (h1[0] - h0[0]), min(h0[2], h1[2]))
            for h0, h1 in zip(head, head[1:])]


def _lerp(xs, ys, x):
    i = bisect.bisect_left(xs, x)
    if i == 0 or i == len(xs):
        return None
    f = (x - xs[i - 1]) / (xs[i] - xs[i - 1])
    return ys[i - 1] + f * (ys[i] - ys[i - 1])


def best_lag(video_t, video_slide, rates, min_speed=6.0, span=3.0, step=0.05, min_points=150):
    """The lag tau that best lines up the video's sideways slide at clip time t with the GPS turn rate at t + tau.
    A right turn slides the scene left, so a good match has a strongly negative Pearson r. Returns (tau, r) or None."""
    gt, gr, gs = [r[0] for r in rates], [r[1] for r in rates], [r[2] for r in rates]
    best = None
    for k in range(int(-span / step), int(span / step) + 1):
        tau = k * step
        xs, ys = [], []
        for t, v in zip(video_t, video_slide):
            g, s = _lerp(gt, gr, t + tau), _lerp(gt, gs, t + tau)
            if g is not None and s is not None and s > min_speed:
                xs.append(v)
                ys.append(g)
        if len(xs) < min_points:
            continue
        mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
        sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
        sxx, syy = sum((x - mx) ** 2 for x in xs), sum((y - my) ** 2 for y in ys)
        if sxx and syy:
            r = sxy / math.sqrt(sxx * syy)
            if best is None or r < best[1]:
                best = (tau, r)
    return best and (round(best[0], 3), round(best[1], 3))


# ---------- footage I/O ----------

def read_gps(paths, cache):
    """{path: fixes} with exiftool, run in batches; cached per clip by size and modification time."""
    cache.mkdir(parents=True, exist_ok=True)
    out, todo = {}, []
    for p in paths:
        st = p.stat()
        cf = cache / f'{p.stem}.json'
        if cf.exists():
            c = json.loads(cf.read_text())
            if c.get('v') == CACHE_VERSION and c.get('size') == st.st_size and c.get('mtime') == int(st.st_mtime):
                out[p] = [tuple(f) for f in c['fixes']]
                continue
        todo.append(p)
    for i in range(0, len(todo), 20):
        batch = todo[i:i + 20]
        r = subprocess.run(['exiftool', '-ee', '-n', '-j', '-G3', '-api', 'LargeFileSupport=1', '-SampleTime',
                            '-GPSDateTime', '-GPSLatitude', '-GPSLongitude', *map(str, batch)],
                           capture_output=True, text=True)
        docs = {Path(d['SourceFile']).resolve(): d for d in json.loads(r.stdout or '[]')}
        for p in batch:
            fixes = fixes_from_exif(docs.get(p.resolve(), {}))
            st = p.stat()
            (cache / f'{p.stem}.json').write_text(json.dumps(dict(v=CACHE_VERSION, size=st.st_size,
                                                                  mtime=int(st.st_mtime), fixes=fixes)))
            out[p] = fixes
        print(f'GPS read: {min(i + 20, len(todo))}/{len(todo)} clips', file=sys.stderr, flush=True)
    return out


def read_frames(path):
    """Sorted presentation times of the video frames, from the start of the stream (packets only: no decoding)."""
    probe = ['ffprobe', '-v', 'error', '-select_streams', 'v:0']
    info = json.loads(subprocess.run(probe + ['-show_entries', 'stream=width,start_time,r_frame_rate', '-of', 'json', str(path)],
                                     capture_output=True, text=True, check=True).stdout)['streams'][0]
    raw = subprocess.run(probe + ['-show_entries', 'packet=pts_time', '-of', 'csv=p=0', str(path)],
                         capture_output=True, text=True, check=True).stdout.split()
    pts = sorted(float(x.strip(',')) for x in raw if x.strip(',') not in ('', 'N/A'))
    start = float(info.get('start_time') or 0)
    num, den = (info.get('r_frame_rate') or '30/1').split('/')
    return [round(p - start, 6) for p in pts], int(info.get('width') or 0), float(num) / float(den)


def save_still(path, pts, fps, dst):
    """Decode exactly the frame at pts: an accurate seek returns the first frame at or after its time."""
    if dst.exists():
        return
    tmp = dst.with_suffix('.tmp.jpg')
    subprocess.run(['nice', '-n', '15', 'ffmpeg', '-v', 'error', '-y', '-ss', f'{max(0.0, pts - 0.5 / fps):.6f}', '-i',
                    str(path), '-frames:v', '1', '-q:v', '2', str(tmp)], check=True)
    os.replace(tmp, dst)


def video_slide(path, fps=10):
    """Sideways slide of the scene between frames (pixels at 320 px wide), from phase correlation of the band just
    above the horizon, with the clip times of the slides. Needs numpy."""
    import numpy as np
    raw = subprocess.run(['nice', '-n', '15', 'ffmpeg', '-v', 'error', '-i', str(path), '-vf',
                          f'fps={fps},scale=320:180,format=gray', '-f', 'rawvideo', '-'], capture_output=True).stdout
    fr = np.frombuffer(raw, np.uint8).reshape(-1, 180, 320)[:, 45:90, :].astype(np.float32) * np.hanning(320)
    out = []
    for a, b in zip(fr[1:], fr[:-1]):
        c = np.fft.fft2(a) * np.conj(np.fft.fft2(b))
        r = np.fft.ifft2(c / (np.abs(c) + 1e-9)).real
        x = int(np.unravel_index(np.argmax(r), r.shape)[1])
        out.append(float(x if x < 160 else x - 320))
    return [(i + 0.5) / fps for i in range(len(out))], out


def grid_transform():
    try:
        from osgeo import osr
    except ImportError:
        return None
    osr.UseExceptions()
    src, dst = osr.SpatialReference(), osr.SpatialReference()
    src.ImportFromEPSG(4617)
    src.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    dst.ImportFromEPSG(2961)
    dst.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    tr = osr.CoordinateTransformation(src, dst)
    return lambda lat, lon: tr.TransformPoint(lon, lat)[:2]


def write_json(path, obj):
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(obj, indent=1))
    os.replace(tmp, path)


def measure_lag(clips, gps, out):
    """--measure-lag: per clip, the extra shift the turn test finds after the current camera shift."""
    rows = []
    for c in clips:
        rates = turn_rates(gps[c['path']], c['start_utc'])
        if sum(1 for r in rates if r[2] > 6) < 20:
            rows.append(dict(clip=c['name'], result='too slow'))
            continue
        t, slide = video_slide(c['path'])
        lag = best_lag(t, slide, rates)
        rows.append(dict(clip=c['name'], result='no fit') if lag is None else dict(clip=c['name'], lag_s=lag[0], r=lag[1]))
        print(c['name'], rows[-1], file=sys.stderr, flush=True)
    good = sorted(r['lag_s'] for r in rows if r.get('r', 0) <= -0.7)
    summary = dict(clips=len(rows), good_fits=len(good), rule='r <= -0.7',
                   median_lag_s=good[len(good) // 2] if good else None,
                   spread_s=[good[len(good) // 10], good[len(good) * 9 // 10]] if len(good) >= 5 else None,
                   note='add median_lag_s to the camera shift in CAMERAS if it is not about 0')
    write_json(out / 'lag.json', dict(summary=summary, clips=rows))
    print(json.dumps(summary, indent=1))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('clips', nargs='+', type=Path)
    ap.add_argument('--camera', required=True, choices=sorted(CAMERAS), help='sets the mount direction and time shift')
    ap.add_argument('--mount-deg', type=float, help='override the mount direction (deg clockwise from forward)')
    ap.add_argument('--shift-s', type=float, help="override the camera's time shift (seconds)")
    ap.add_argument('--out', required=True, type=Path)
    g = ap.add_mutually_exclusive_group()
    g.add_argument('--every-m', type=float, default=10.0, help='one frame per this many metres driven (default 10)')
    g.add_argument('--every-s', type=float, help='one frame per this many seconds instead')
    ap.add_argument('--tolerance-ms', type=float, default=100.0, help='largest gap between target and frame time')
    ap.add_argument('--max-gap-s', type=float, default=1.5, help='largest gap to the nearest GPS fix')
    ap.add_argument('--stills', action='store_true', help='also write the chosen frames as JPEGs')
    ap.add_argument('--measure-lag', action='store_true', help='only measure the video-to-GPS lag from turns')
    a = ap.parse_args(argv)
    cam = CAMERAS[a.camera]
    mount = cam['mount'] if a.mount_deg is None else a.mount_deg
    shift = cam['shift'] if a.shift_s is None else a.shift_s
    repo = Path(__file__).resolve().parent.parent
    if a.out.resolve().is_relative_to(repo) and not a.out.resolve().is_relative_to(repo / 'data'):
        ap.error('--out inside the repository must be under data/ (footage results are private)')
    a.out.mkdir(parents=True, exist_ok=True)

    clips_in = sorted({p.resolve() for p in a.clips if p.suffix.lower() == '.mp4'})
    gps = read_gps(clips_in, a.out / 'gps-cache')
    clips, no_gps, fixes = [], [], []
    for p in clips_in:
        f = gps.get(p) or []
        if len(f) < 2:
            no_gps.append(p.name)
            continue
        pts, width, fps = read_frames(p)
        clips.append(dict(name=p.stem, path=p, start_utc=clip_start(f) + shift, pts=pts, width=width, fps=fps))
        fixes += [(u, lat, lon) for _, u, lat, lon in f]
    if not clips:
        sys.exit('no clip with GPS')
    if a.measure_lag:
        measure_lag(clips, gps, a.out)
        return
    track = Track(fixes)                             # FH and FL of one camera carry the same fixes: Track keeps one
    targets = (targets_by_time(track, a.every_s, a.max_gap_s) if a.every_s
               else targets_by_distance(track, a.every_m, a.max_gap_s))
    frames, skipped = choose_frames(clips, track, targets, a.tolerance_ms / 1000, a.max_gap_s)

    to_grid = grid_transform()
    by_name = {c['name']: c for c in clips}
    if a.stills:
        (a.out / 'stills').mkdir(exist_ok=True)
    feats = []
    for i, fr in enumerate(frames, 1):
        travel = travel_heading(track, fr['utc'])
        speed = speed_kmh(track, fr['utc'])
        when = dt.datetime.fromtimestamp(fr['utc'], dt.timezone.utc)
        props = dict(clip=fr['clip'], frame=fr['frame'], pts=fr['pts'],
                     utc=when.isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
                     halifax=when.astimezone(HALIFAX).strftime('%Y-%m-%d %H:%M:%S.%f')[:-3],
                     speed_kmh=None if speed is None else round(speed, 1),
                     travel_heading=None if travel is None else round(travel, 1),
                     camera_heading=None if travel is None else round(camera_heading(travel, mount), 1),
                     mount_deg=mount, shift_s=shift, fix_gap_s=fr['fix_gap_s'],
                     along_road_error_m=None if speed is None else round(speed / 3.6 * cam['accuracy'], 1), still=None)
        if to_grid:
            e, n = to_grid(fr['lat'], fr['lon'])
            props.update(east=round(e, 2), north=round(n, 2))
        if a.stills:
            name = f"{fr['clip']}-f{fr['frame']:05d}.jpg"
            c = by_name[fr['clip']]
            save_still(c['path'], fr['pts'], c['fps'], a.out / 'stills' / name)
            props['still'] = f'stills/{name}'
            if i % 50 == 0:
                print(f'stills: {i}/{len(frames)}', file=sys.stderr, flush=True)
        feats.append(dict(type='Feature', geometry=dict(type='Point', coordinates=[round(fr['lon'], 7), round(fr['lat'], 7)]),
                          properties=props))
    write_json(a.out / 'frames.geojson', dict(type='FeatureCollection', features=feats))
    write_json(a.out / 'track.geojson', dict(type='FeatureCollection', features=[
        dict(type='Feature', properties=dict(start=s[0][0], end=s[-1][0]),
             geometry=dict(type='LineString', coordinates=[[round(o, 7), round(la, 7)] for _, la, o in s]))
        for s in segments(track)]))
    report = dict(camera=a.camera, mount_deg=mount, shift_s=shift, timing_accuracy_s=cam['accuracy'],
                  clips=len(clips_in), clips_with_gps=len(clips), clips_without_gps=no_gps, gps_fixes=len(track),
                  rule=f'every {a.every_s:g} s' if a.every_s else f'every {a.every_m:g} m',
                  tolerance_ms=a.tolerance_ms, max_gap_s=a.max_gap_s, targets=len(targets), frames=len(frames),
                  skipped=skipped, grid='EPSG:2961' if to_grid else None)
    write_json(a.out / 'report.json', report)
    print(json.dumps(report, indent=1))


if __name__ == '__main__':
    main()
