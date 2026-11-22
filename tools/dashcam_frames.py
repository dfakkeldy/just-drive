#!/usr/bin/env python3
"""Place dash cam frames on the map: one still every N metres, each with its position and heading.

The idea comes from survey tools such as StreetView 2.0: the camera stores its GPS fixes, and each frame has its own
presentation time. This tool matches the two by the frame's real time, never by a seek time or an assumed keyframe
spacing. (Seeking by keyframe put some 12 Nov stills up to 800 m from where they were taken.)

Supported cameras: the Garmin Dash Cam (GPS 1/s) and the Nextbase Piqo (GPS 10/s), both of which store GPS inside
the MP4. Give one camera per run. The camera's mount direction sets the photo heading:
garmin = forward (0 deg), piqo-side = out of the driver's window of a right-hand-drive car (+90 deg).

Time calibration. Each camera also burns the coordinates of its latest whole-second fix into the picture. On 12 Nov
2026 the Piqo's picture and its embedded GPS agreed to 0.03 s (61 frames). The Garmin's did not: per clip, its
pictures were taken 0 to 2 s before the time its embedded GPS gives them, the same within a clip but different
between clips (41 clips; a pull-away test on 37 stops agreed). Matching by the embedded clock alone would put a
Garmin still up to about 55 m down the road at highway speed. So for the Garmin the tool reads the burned-in
coordinates of up to 16 moving frames per clip (tesseract) and finds the fix each shows. The overlay shows a fix only
after its second has begun, and sometimes up to about 1.4 s late, never early; so the largest (fix time - frame
time) over frames spread across 16 phases of a second gives the clip's shift to about 1/16 s. A clip that stands
still or cannot be read takes the median shift of the calibrated clips in the run and is marked uncalibrated.

    python3 tools/dashcam_frames.py --camera piqo-side --out OUT [--every-m 10] [--stills] CLIP.MP4 ...

Writes into OUT (keep OUT under data/ or outside the repository; footage and stills are private):
  frames.geojson  one point per chosen frame (clip, frame time, UTC and Halifax time, position, headings, speed)
  track.geojson   the driven line, split where the GPS stops for more than 5 s
  report.json     counts, the reasons for every frame that was skipped, and each clip's time shift
  stills/         full-size JPEGs, only with --stills
  gps-cache/      the GPS read from each clip, so a second run is fast

Needs exiftool, ffprobe, ffmpeg, and tesseract for calibration. East/north on the game grid (EPSG:2961) need GDAL's Python
bindings; without them the points carry only longitude and latitude. The clips are only read.
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

# mount: photo direction, deg clockwise from the car's nose.
# shift: seconds added to the embedded GPS clock to get the time a frame was really taken, used when a clip is not
#   calibrated (see the module text). calibrate: whether --calibrate auto reads the burned-in coordinates.
# overlay: (ffmpeg crop of the burned-in text, tesseract page mode).
BOTTOM_STRIP = ('crop=iw:ih*0.13:0:ih*0.87', '6')
CAMERAS = {'garmin': dict(mount=0.0, shift=-1.0, calibrate=True, overlay=('crop=iw*0.6:ih*0.06:0:ih*0.94', '7')),
           'piqo-side': dict(mount=90.0, shift=0.0, calibrate=False, overlay=BOTTOM_STRIP),
           'piqo-forward': dict(mount=0.0, shift=0.0, calibrate=False, overlay=BOTTOM_STRIP)}
OVERLAY_READS = 16
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
    Only samples with a clip time count: the Garmin also stores each fix a second time without one."""
    docs = {}
    for key, value in doc.items():
        if key.startswith('Doc') and ':' in key:
            n, name = key[3:].split(':', 1)
            if n.isdigit():
                docs.setdefault(int(n), {})[name] = value
    out = []
    for n in sorted(docs):
        d = docs[n]
        t, utc, lat, lon = d.get('SampleTime'), d.get('GPSDateTime'), d.get('GPSLatitude'), d.get('GPSLongitude')
        if t in (None, '') or not utc or lat in (None, '') or lon in (None, ''):
            continue
        lat, lon = float(lat), float(lon)
        if (lat, lon) == (0.0, 0.0) or not (-90 <= lat <= 90 and -180 <= lon <= 180):
            continue
        out.append((float(t), parse_utc(str(utc)).timestamp(), lat, lon))
    return out


def clip_start(fixes):
    """UTC of clip time 0: the median of (fix UTC - fix clip time), robust to one bad sample."""
    starts = sorted(u - t for t, u, _, _ in fixes)
    return starts[len(starts) // 2]


def metres(lat0, lon0, lat1, lon1):
    """(east, north) metres from point 0 to point 1; exact enough over a few hundred metres."""
    k = math.radians(1) * EARTH_R
    return (lon1 - lon0) * k * math.cos(math.radians((lat0 + lat1) / 2)), (lat1 - lat0) * k


class Track(list):
    """A time-sorted list of fixes (u, lat, lon) that keeps its times for a fast search."""
    def __init__(self, fixes):
        super().__init__(sorted(fixes))
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


def parse_overlay(text, lat_hint, lon_hint):
    """Coordinates burned into a frame, from OCR text such as 'N46.08410 W61.42643' or '45.75545 -61.46612'.
    Only the five decimals are trusted; whole degrees come from the hint (OCR often misreads the first digits)."""
    import re
    m = re.search(r'\.(\d{5})\D{1,8}?\d{0,3}\.(\d{5})', text)
    if not m:
        return None
    lat = math.trunc(lat_hint) + math.copysign(float('0.' + m.group(1)), lat_hint)
    lon = math.trunc(lon_hint) + math.copysign(float('0.' + m.group(2)), lon_hint)
    return lat, lon


def match_fix(lat, lon, whole_fixes, tol=1.2e-5):
    """UTC of the one whole-second fix whose coordinates, rounded to five decimals, are the read ones.
    None when no fix or more than one fix fits (for example while the car stands still)."""
    hits = {round(u) for u, a, o in whole_fixes if abs(a - lat) <= tol and abs(o - lon) <= tol}
    return hits.pop() if len(hits) == 1 else None


def shift_from_bounds(bounds, min_reads=3):
    """Each read says the overlay showed the fix of second U on a frame placed at F by the embedded clock. The overlay
    is never early, so the true shift is at least U - F; a late overlay only lowers that bound. The shift is the
    largest bound, after dropping a top value that stands more than 0.3 s above the next (a fix matched by an OCR
    slip). Returns (shift, near) with near = reads within 0.25 s of it, or None with fewer than min_reads reads."""
    b = sorted(bounds, reverse=True)
    while len(b) >= 2 and b[0] - b[1] > 0.3:
        b.pop(0)
    if len(b) < min_reads:
        return None
    return round(b[0], 3), sum(1 for x in b if b[0] - x <= 0.25)


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
            if c.get('size') == st.st_size and c.get('mtime') == int(st.st_mtime):
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
            (cache / f'{p.stem}.json').write_text(json.dumps(dict(size=st.st_size, mtime=int(st.st_mtime), fixes=fixes)))
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


def read_overlay_text(path, pts, fps, width, overlay):
    """OCR of the burned-in text of one exact frame: yields the plain read, then a thresholded one."""
    crop, psm = overlay
    for look in ('format=gray,negate', "format=gray,lutyuv=y='if(gt(val,165),0,255)'"):
        img = subprocess.run(['ffmpeg', '-v', 'error', '-ss', f'{max(0.0, pts - 0.5 / fps):.6f}', '-i', str(path), '-frames:v', '1',
                              '-vf', f'{crop},scale=iw*{4 if width < 1200 else 3}:-1,{look}',
                              '-f', 'image2pipe', '-vcodec', 'png', '-'], capture_output=True).stdout
        yield subprocess.run(['tesseract', '-', '-', '--psm', psm], input=img, capture_output=True).stdout.decode('utf-8', 'replace')


def calibration_picks(pts, track, start_utc, n=OVERLAY_READS, min_kmh=15.0):
    """Frame times to read: spread over the clip and over 16 phases of a second, only while the car moves
    (a standing car shows the same coordinates for many seconds, which fits any shift)."""
    span = pts[-1] - pts[0]
    out = []
    for k in range(4 * n):
        t = pts[0] + (k + 0.5) * span / (4 * n) + (k * 7 % 16) / 16 - 0.5
        v = speed_kmh(track, start_utc + t) if pts[0] <= t <= pts[-1] else None
        if v and v >= min_kmh:
            out.append(nearest_frame(pts, t)[1])
    return out[::max(1, len(out) // n)][:n]


def calibrate_clip(clip, fixes, overlay):
    """Shift for one clip from its burned-in coordinates: (dict(shift, width, reads), None) or (None, reason)."""
    whole = [(u, a, o) for _, u, a, o in fixes if abs(u - round(u)) < 0.05]
    track = Track((u, a, o) for _, u, a, o in fixes)
    picks = calibration_picks(clip['pts'], track, clip['start_utc'])
    if len(picks) < 3:
        return None, 'standing still'
    bounds = []
    for t in picks:
        f_u = clip['start_utc'] + t
        at = interpolate(track, f_u)
        if at is None:
            continue
        for text in read_overlay_text(clip['path'], t, clip['fps'], clip['width'], overlay):
            read = parse_overlay(text, at[0], at[1])
            u = read and match_fix(read[0], read[1], whole)
            if u is not None:
                bounds.append(u - f_u)
                break
    w = shift_from_bounds(bounds)
    if w is None:
        return None, f'overlay read on {len(bounds)} of {len(picks)} frames'
    return dict(shift=w[0], reads=len(bounds), near_top=w[1]), None


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


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('clips', nargs='+', type=Path)
    ap.add_argument('--camera', required=True, choices=sorted(CAMERAS), help='sets the mount direction')
    ap.add_argument('--mount-deg', type=float, help='override the mount direction (deg clockwise from forward)')
    ap.add_argument('--shift-s', type=float, help="fixed video-to-GPS time shift for every clip (seconds); no calibration")
    ap.add_argument('--calibrate', choices=('auto', 'overlay', 'off'), default='auto',
                    help='read burned-in coordinates to time each clip (auto: only for cameras that need it)')
    ap.add_argument('--out', required=True, type=Path)
    g = ap.add_mutually_exclusive_group()
    g.add_argument('--every-m', type=float, default=10.0, help='one frame per this many metres driven (default 10)')
    g.add_argument('--every-s', type=float, help='one frame per this many seconds instead')
    ap.add_argument('--tolerance-ms', type=float, default=100.0, help='largest gap between target and frame time')
    ap.add_argument('--max-gap-s', type=float, default=1.5, help='largest gap to the nearest GPS fix')
    ap.add_argument('--stills', action='store_true', help='also write the chosen frames as JPEGs')
    a = ap.parse_args(argv)
    mount = CAMERAS[a.camera]['mount'] if a.mount_deg is None else a.mount_deg
    cam = CAMERAS[a.camera]
    default_shift = cam['shift'] if a.shift_s is None else a.shift_s
    calibrate = a.shift_s is None and (a.calibrate == 'overlay' or (a.calibrate == 'auto' and cam['calibrate']))
    if calibrate and subprocess.run(['which', 'tesseract'], capture_output=True).returncode:
        ap.error('calibration needs tesseract (brew install tesseract), or pass --shift-s or --calibrate off')
    tol = a.tolerance_ms / 1000
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
        clip = dict(name=p.stem, path=p, start_utc=clip_start(f), pts=pts, width=width, fps=fps)
        cal, why = calibrate_clip(clip, f, cam['overlay']) if calibrate else (None, 'not used')
        clip['calibration'] = cal or why
        clips.append(clip)
        if calibrate:
            print(f'{p.name}:', f'shift {cal["shift"]:+.2f} s' if cal else why, file=sys.stderr, flush=True)
        fixes += [(u, lat, lon) for _, u, lat, lon in f]
    measured = sorted(c['calibration']['shift'] for c in clips if isinstance(c['calibration'], dict))
    if len(measured) >= 3:
        default_shift = measured[len(measured) // 2]
    for clip in clips:
        clip['shift'] = clip['calibration']['shift'] if isinstance(clip['calibration'], dict) else default_shift
        clip['start_utc'] += clip['shift']
    if not clips:
        sys.exit('no clip with GPS')
    by_time = {}
    for u, lat, lon in fixes:                        # FH and FL of one camera carry the same fixes: keep one
        by_time.setdefault(round(u, 2), (u, lat, lon))
    track = Track(by_time.values())
    targets = (targets_by_time(track, a.every_s, a.max_gap_s) if a.every_s
               else targets_by_distance(track, a.every_m, a.max_gap_s))
    frames, skipped = choose_frames(clips, track, targets, tol, a.max_gap_s)

    to_grid = grid_transform()
    paths = {c['name']: c for c in clips}
    if a.stills:
        (a.out / 'stills').mkdir(exist_ok=True)
    feats = []
    for i, fr in enumerate(frames, 1):
        travel = travel_heading(track, fr['utc'])
        when = dt.datetime.fromtimestamp(fr['utc'], dt.timezone.utc)
        props = dict(clip=fr['clip'], frame=fr['frame'], pts=fr['pts'],
                     utc=when.isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
                     halifax=when.astimezone(HALIFAX).strftime('%Y-%m-%d %H:%M:%S.%f')[:-3],
                     speed_kmh=None if (s := speed_kmh(track, fr['utc'])) is None else round(s, 1),
                     travel_heading=None if travel is None else round(travel, 1),
                     camera_heading=None if travel is None else round(camera_heading(travel, mount), 1),
                     mount_deg=mount, shift_s=paths[fr['clip']]['shift'],
                     calibrated=isinstance(paths[fr['clip']]['calibration'], dict), fix_gap_s=fr['fix_gap_s'], still=None)
        if to_grid:
            e, n = to_grid(fr['lat'], fr['lon'])
            props.update(east=round(e, 2), north=round(n, 2))
        if a.stills:
            name = f"{fr['clip']}-f{fr['frame']:05d}.jpg"
            c = paths[fr['clip']]
            save_still(c['path'], fr['pts'], c['fps'], a.out / 'stills' / name)
            props['still'] = f'stills/{name}'
            if i % 50 == 0:
                print(f'stills: {i}/{len(frames)}', file=sys.stderr, flush=True)
        feats.append(dict(type='Feature', geometry=dict(type='Point', coordinates=[round(fr['lon'], 7), round(fr['lat'], 7)]),
                          properties=props))
    def write(name, obj):
        tmp = a.out / f'{name}.tmp'
        tmp.write_text(json.dumps(obj, indent=1))
        os.replace(tmp, a.out / name)
    write('frames.geojson', dict(type='FeatureCollection', features=feats))
    write('track.geojson', dict(type='FeatureCollection', features=[
        dict(type='Feature', properties=dict(start=s[0][0], end=s[-1][0]),
             geometry=dict(type='LineString', coordinates=[[round(o, 7), round(la, 7)] for _, la, o in s]))
        for s in segments(track)]))
    report = dict(camera=a.camera, mount_deg=mount, default_shift_s=default_shift,
                  clip_shifts={c['name']: dict(shift_s=c['shift'], calibration=c['calibration']) for c in clips},
                  uncalibrated_clips={why: sum(1 for c in clips if c['calibration'] == why)
                                      for why in sorted({c['calibration'] for c in clips if isinstance(c['calibration'], str)})}, clips=len(clips_in), clips_with_gps=len(clips), clips_without_gps=no_gps,
                  gps_fixes=len(track), rule=f'every {a.every_s:g} s' if a.every_s else f'every {a.every_m:g} m',
                  tolerance_ms=a.tolerance_ms, max_gap_s=a.max_gap_s, targets=len(targets), frames=len(frames),
                  skipped=skipped, grid='EPSG:2961' if to_grid else None)
    write('report.json', report)
    print(json.dumps(report, indent=1))


if __name__ == '__main__':
    main()
