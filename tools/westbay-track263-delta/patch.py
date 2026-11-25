#!/usr/bin/env python3
"""Build, verify, install or roll back the West Bay track 263 trough land delta.

The 1 m DTM (data/raw/areas/westbay/elevation/land-dtm-1m-epsg3979.vrt) shows a real
SW-to-NE drainage gully (~2.1 m deep) crossing track 263 near E 631608 / N 5064399
(EPSG:2961), with an excavated spoil berm on its SE bank (s = 841..850 m).
This hand fix grades only the track crossing (s = 828..852 m) across the 3 m track
bed plus a 1.5 m mesh-vertex shoulder (so 2 m L8 terrain triangles stay level across
the wheels) and tapers smoothly back into the real gully by 6 m from the centre line.
Only two corridor height tiles change: areas/westbay/8/156_152.png and 7/78_76.png.
No tile edge changes, and the West Bay quarry keep box stays untouched.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
RECEIPT = HERE / 'hashes.json'

AREA_ID = 'westbay'
AREA_REL = Path('areas/westbay')
ROAD_ID = 263
ANCHOR_E, ANCHOR_N = 631607.29, 5064400.23
ANCHOR_TOL_M = 2.0

ORIGIN = (591500, 5103332)
SIZE = 65536
TILE = 256
NODATA = -32767.0
SEA_FLOOR = -4.0

BLOCK_I, BLOCK_J = 19, 19
TILES = ((8, 156, 152), (7, 78, 76))

# Track-bed crossing parameters (EPSG:2961 metres along and across track 263).
S0, S1 = 828.0, 852.0
END_TAPER = 2.0
SLOPE_SPAN = 4.0
HALF_BED = 3.0
OUTER = 6.0
# Local pixel window inside L5 block (19, 19) covering s in [826, 854] +/- 6 m.
PATCH_BOX = (631592.0, 5064378.0, 631632.0, 5064418.0)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def encoded_json(value) -> bytes:
    return (json.dumps(value, indent=2) + '\n').encode('utf-8')


def bounds(level: int, i: int, j: int) -> tuple[float, float, float, float]:
    size = SIZE / (2 ** level)
    return (ORIGIN[0] + i * size, ORIGIN[1] - (j + 1) * size,
            ORIGIN[0] + (i + 1) * size, ORIGIN[1] - j * size)


def res(level: int) -> float:
    return SIZE / (TILE * (2 ** level))


def smoothstep(a: float, b: float, x):
    import numpy as np
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def halve(a):
    """Exact copy of pipeline/21_bake_terrain.py halve()."""
    import numpy as np
    valid = (a != NODATA).astype(np.float32)
    v = np.where(valid > 0, a, 0).astype(np.float32)

    def blur(x):
        p = np.pad(x, 1, mode='edge')
        k = (p[:-2] + 2 * p[1:-1] + p[2:]) / 4
        return (k[:, :-2] + 2 * k[:, 1:-1] + k[:, 2:]) / 4

    num, den = blur(v), blur(valid)
    return np.where(den > 0.5, num / np.maximum(den, 1e-6), NODATA)[::2, ::2].astype(np.float32)


def encode(dtm, dsm):
    """Exact copy of pipeline/21_bake_terrain.py encode()."""
    import numpy as np
    sea = dtm == NODATA
    h = np.where(sea, SEA_FLOOR, dtm)
    v = np.clip(np.rint((h + 100.0) * 100.0), 0, 65535).astype(np.uint16)
    canopy = np.where(sea | (dsm == NODATA), 0, dsm - dtm)
    c = np.clip(np.rint(canopy * 5.0), 0, 255).astype(np.uint8)
    return np.stack([(v >> 8).astype(np.uint8), (v & 255).astype(np.uint8), c])


def find_track_263(roads_data: dict):
    """Return track 263 points as a float64 array after checking its id, kind, width and anchor."""
    import numpy as np
    matches = [r for r in roads_data.get('roads', []) if r.get('id') == ROAD_ID]
    if len(matches) != 1:
        raise ValueError(f'Expected one road {ROAD_ID} in West Bay roads.json, found {len(matches)}')
    road = matches[0]
    if road.get('kind') != 4 or abs(float(road.get('halfWidth', 0)) - 1.5) > 1e-6:
        raise ValueError(f'Road {ROAD_ID} metadata changed: kind={road.get("kind")} halfWidth={road.get("halfWidth")}')
    pts = np.asarray(road['pts'], dtype=np.float64)
    if pts.ndim != 2 or pts.shape[1] != 2 or len(pts) < 2:
        raise ValueError(f'Road {ROAD_ID} has invalid polyline')
    anchor_dist = float(np.hypot(pts[:, 0] - ANCHOR_E, pts[:, 1] - ANCHOR_N).min())
    if anchor_dist > ANCHOR_TOL_M:
        raise ValueError(f'Road {ROAD_ID} moved away from anchor ({ANCHOR_E}, {ANCHOR_N}): {anchor_dist:.2f} m')
    return pts


def _track_cum(pts):
    import numpy as np
    seg = np.diff(pts, axis=0)
    seg_len = np.hypot(seg[:, 0], seg[:, 1])
    return np.concatenate([[0.0], np.cumsum(seg_len)])


def project_to_track(ee, nn, pts, *, lo_s: float | None = None, hi_s: float | None = None):
    """Return (dist_m, arc_s_m) for arrays of EPSG:2961 coordinates projected onto polyline `pts`."""
    import numpy as np
    cum = _track_cum(pts)
    ee_arr = np.asarray(ee, dtype=np.float64)
    nn_arr = np.asarray(nn, dtype=np.float64)
    best_d2 = np.full(ee_arr.shape, np.inf, dtype=np.float64)
    best_s = np.zeros(ee_arr.shape, dtype=np.float64)
    for k in range(len(pts) - 1):
        if lo_s is not None and cum[k + 1] < lo_s:
            continue
        if hi_s is not None and cum[k] > hi_s:
            continue
        ax, ay = pts[k]
        bx, by = pts[k + 1]
        dx, dy = bx - ax, by - ay
        l2 = dx * dx + dy * dy
        if l2 <= 0.0:
            continue
        t = np.clip(((ee_arr - ax) * dx + (nn_arr - ay) * dy) / l2, 0.0, 1.0)
        px, py = ax + t * dx, ay + t * dy
        d2 = (ee_arr - px) ** 2 + (nn_arr - py) ** 2
        mask = d2 < best_d2
        best_d2[mask] = d2[mask]
        best_s[mask] = cum[k] + t[mask] * math.sqrt(l2)
    return np.sqrt(best_d2), best_s


def shape_trough(dtm, dsm, halo: tuple[float, float, float, float], pts,
                 *, s0: float = S0, s1: float = S1, end_taper: float = END_TAPER,
                 slope_span: float = SLOPE_SPAN, half_bed: float = HALF_BED,
                 outer: float = OUTER, patch_box: tuple[float, float, float, float] = PATCH_BOX):
    """Apply the narrow track-bed crossing across the trough on track 263.

    Returns (new_dtm, new_dsm, stats). Does not mutate inputs.
    """
    import numpy as np
    if not (0.0 < half_bed < outer) or not (s0 + end_taper < s1 - end_taper):
        raise ValueError('Invalid trough shaping geometry')
    dtm_out = dtm.astype(np.float32, copy=True)
    dsm_out = dsm.astype(np.float32, copy=True)

    cum = _track_cum(pts)
    if s0 - slope_span < 0.0 or s1 + slope_span > cum[-1]:
        raise ValueError(f'Track {ROAD_ID} length {cum[-1]:.2f} m does not span [{s0 - slope_span}, {s1 + slope_span}]')

    def sample_bilinear(grid, e: float, n: float) -> float:
        c = e - halo[0]
        r = halo[3] - n
        c0, r0 = int(math.floor(c)), int(math.floor(r))
        fc, fr = c - c0, r - r0
        return float(
            (1 - fc) * (1 - fr) * grid[r0, c0]
            + fc * (1 - fr) * grid[r0, c0 + 1]
            + (1 - fc) * fr * grid[r0 + 1, c0]
            + fc * fr * grid[r0 + 1, c0 + 1]
        )

    def centre_h(s: float) -> float:
        h = sample_bilinear(dtm, float(np.interp(s, cum, pts[:, 0])), float(np.interp(s, cum, pts[:, 1])))
        if not math.isfinite(h) or h <= -1000.0:
            raise ValueError(f'Invalid or nodata DTM sample along track {ROAD_ID} at s={s:.2f}: {h}')
        return h

    z0, z1 = centre_h(s0), centre_h(s1)
    m0 = (z0 - centre_h(s0 - slope_span)) / slope_span
    m1 = (centre_h(s1 + slope_span) - z1) / slope_span

    def hermite(s):
        span = s1 - s0
        t = np.clip((s - s0) / span, 0.0, 1.0)
        h00 = 2 * t ** 3 - 3 * t ** 2 + 1
        h10 = t ** 3 - 2 * t ** 2 + t
        h01 = -2 * t ** 3 + 3 * t ** 2
        h11 = t ** 3 - t ** 2
        return h00 * z0 + h10 * (span * m0) + h01 * z1 + h11 * (span * m1)

    c_min = max(0, int(math.floor(patch_box[0] - halo[0])))
    c_max = min(dtm.shape[1] - 1, int(math.ceil(patch_box[2] - halo[0])))
    r_min = max(0, int(math.floor(halo[3] - patch_box[3])))
    r_max = min(dtm.shape[0] - 1, int(math.ceil(halo[3] - patch_box[1])))

    yy, xx = np.mgrid[r_min:r_max + 1, c_min:c_max + 1]
    ee = halo[0] + xx
    nn = halo[3] - yy

    dist, best_s = project_to_track(ee, nn, pts, lo_s=s0 - end_taper - 20.0, hi_s=s1 + end_taper + 20.0)
    w_along = (smoothstep(s0 - end_taper, s0 + end_taper, best_s)
               * (1.0 - smoothstep(s1 - end_taper, s1 + end_taper, best_s)))
    w_cross = 1.0 - smoothstep(half_bed, outer, dist)
    w = w_along * w_cross

    sub_dtm = dtm[r_min:r_max + 1, c_min:c_max + 1].astype(np.float64)
    sub_dsm = dsm[r_min:r_max + 1, c_min:c_max + 1].astype(np.float64)
    valid = sub_dtm != NODATA
    delta = np.where(valid, (hermite(best_s) - sub_dtm) * w, 0.0)
    new_sub_dtm = np.where(valid, sub_dtm + delta, NODATA).astype(np.float32)

    # Clear low scrub on the graded track bed; outside the bed keep any canopy that still stands above fill.
    canopy_orig = np.where(valid & (sub_dsm != NODATA), np.maximum(0.0, sub_dsm - sub_dtm), 0.0)
    new_canopy = np.where(w > 0.5, 0.0, np.where(delta > 0.0, np.maximum(0.0, canopy_orig - delta), canopy_orig))
    new_sub_dsm = np.where((w > 0.0) & valid & (sub_dsm != NODATA),
                           new_sub_dtm.astype(np.float64) + new_canopy, sub_dsm).astype(np.float32)

    dtm_out[r_min:r_max + 1, c_min:c_max + 1] = new_sub_dtm
    dsm_out[r_min:r_max + 1, c_min:c_max + 1] = new_sub_dsm
    stats = dict(
        z0=round(z0, 4), z1=round(z1, 4), m0=round(m0, 6), m1=round(m1, 6),
        minDeltaM=round(float(delta.min()), 4), maxDeltaM=round(float(delta.max()), 4),
    )
    return dtm_out, dsm_out, stats


def clamp_level_footprint(raw_dtm, raw_dsm, new_dtm, new_dsm,
                          halo: tuple[float, float, float, float], step: float, pts,
                          *, s0: float = S0, s1: float = S1, end_taper: float = END_TAPER,
                          outer: float = OUTER):
    """Revert any downsampled pixel outside the track footprint back to its unmodified value."""
    import numpy as np
    changed = (new_dtm != raw_dtm) | (new_dsm != raw_dsm)
    rows, cols = np.nonzero(changed)
    if len(rows) == 0:
        return new_dtm.copy(), new_dsm.copy()
    ee = halo[0] + cols * step
    nn = halo[3] - rows * step
    dist, best_s = project_to_track(ee, nn, pts)
    outside = (dist > outer) | (best_s < s0 - end_taper) | (best_s > s1 + end_taper)
    dtm_out = new_dtm.copy()
    dsm_out = new_dsm.copy()
    if np.any(outside):
        orows, ocols = rows[outside], cols[outside]
        dtm_out[orows, ocols] = raw_dtm[orows, ocols]
        dsm_out[orows, ocols] = raw_dsm[orows, ocols]
    return dtm_out, dsm_out


def _git_primary_root(start: Path) -> Path | None:
    try:
        out = subprocess.check_output(
            ['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'],
            cwd=str(start), text=True, stderr=subprocess.DEVNULL,
        ).strip()
        return Path(out).resolve().parent
    except Exception:
        return None


def assert_safe_stage_output(output: Path, source: Path):
    """Refuse existing folders, source overlap, or any data/baked or data/site destination."""
    if output.exists() or output.is_symlink():
        raise ValueError(f'Output must be NEW (already exists): {output}')
    resolved = output.resolve()
    src_resolved = source.resolve()
    if resolved == src_resolved or resolved.is_relative_to(src_resolved) or src_resolved.is_relative_to(resolved):
        raise ValueError('Output must be separate from source land')
    for candidate in (resolved, *resolved.parents):
        if candidate.name in ('baked', 'site') and candidate.parent.name == 'data':
            raise ValueError(f'Output must be outside data/baked and data/site: {output}')
    protected = []
    for base in filter(None, (ROOT, _git_primary_root(ROOT))):
        protected.append((base / 'data/baked').resolve())
        protected.append((base / 'data/site').resolve())
    for root in protected:
        if resolved == root or resolved.is_relative_to(root):
            raise ValueError(f'Output must be outside protected land/site root: {output}')


def _check_tile_edges_unchanged(before_rgb, after_rgb, label: str):
    import numpy as np
    diffs = [
        int(np.abs(after_rgb[:, 0, :].astype(int) - before_rgb[:, 0, :].astype(int)).max()),
        int(np.abs(after_rgb[:, -1, :].astype(int) - before_rgb[:, -1, :].astype(int)).max()),
        int(np.abs(after_rgb[:, :, 0].astype(int) - before_rgb[:, :, 0].astype(int)).max()),
        int(np.abs(after_rgb[:, :, -1].astype(int) - before_rgb[:, :, -1].astype(int)).max()),
    ]
    if max(diffs) != 0:
        raise ValueError(f'{label}: tile edge changed ({diffs}); shared edges must stay untouched')


def _check_tile_footprint(before_rgb, after_rgb, tb: tuple[float, float, float, float],
                          step: float, pts, label: str,
                          *, s0: float = S0, s1: float = S1, end_taper: float = END_TAPER,
                          outer: float = OUTER):
    import numpy as np
    changed = np.any(after_rgb != before_rgb, axis=0)
    rows, cols = np.nonzero(changed)
    if len(rows) == 0:
        raise ValueError(f'{label}: tile has zero changed pixels')
    ee = tb[0] + cols * step
    nn = tb[3] - rows * step
    dist, best_s = project_to_track(ee, nn, pts)
    max_dist = float(dist.max())
    min_s, max_s = float(best_s.min()), float(best_s.max())
    if max_dist > outer + 1e-9:
        raise ValueError(f'{label}: changed pixel beyond {outer:.1f} m limit (max {max_dist:.3f} m)')
    if min_s < s0 - end_taper - 1e-9 or max_s > s1 + end_taper + 1e-9:
        raise ValueError(f'{label}: changed pixel outside [{s0 - end_taper:.1f}, {s1 + end_taper:.1f}] m '
                         f'(got [{min_s:.3f}, {max_s:.3f}] m)')


def _warp_exact(path: str, bb: tuple[float, float, float, float]):
    import numpy as np
    from osgeo import gdal
    gdal.UseExceptions()
    x0, y0, x1, y1 = bb
    ds = gdal.Warp(
        '', path, format='MEM', dstSRS='EPSG:2961', xRes=1, yRes=1,
        outputBounds=(x0 - 0.5, y0 - 0.5, x1 + 0.5, y1 + 0.5),
        resampleAlg='bilinear', dstNodata=NODATA, errorThreshold=0,
        warpMemoryLimit=128 * 1024 * 1024, multithread=False,
    )
    a = ds.GetRasterBand(1).ReadAsArray().astype(np.float32)
    a[~np.isfinite(a)] = NODATA
    return a


def _write_png_gdal(path: Path, rgb):
    from osgeo import gdal
    gdal.UseExceptions()
    mem = gdal.GetDriverByName('MEM').Create('', rgb.shape[2], rgb.shape[1], 3, gdal.GDT_Byte)
    for b in range(3):
        mem.GetRasterBand(b + 1).WriteArray(rgb[b])
    gdal.GetDriverByName('PNG').CreateCopy(str(path), mem, options=['ZLEVEL=9'])
    aux = Path(str(path) + '.aux.xml')
    if aux.exists():
        aux.unlink()


def _read_png_rgb(path: Path):
    import numpy as np
    from osgeo import gdal
    gdal.UseExceptions()
    arr = gdal.Open(str(path)).ReadAsArray()
    if arr.shape != (3, TILE + 1, TILE + 1):
        raise ValueError(f'{path}: expected (3, 257, 257), got {arr.shape}')
    return arr


def _validate_manifest(manifest: dict):
    if manifest.get('area', {}).get('id') != AREA_ID:
        raise ValueError(f'Expected area {AREA_ID}, got {manifest.get("area")}')
    if tuple(manifest.get('origin', ())) != ORIGIN or manifest.get('size') != SIZE or manifest.get('tile') != TILE:
        raise ValueError('West Bay manifest lattice changed')
    h = manifest.get('height', {})
    if abs(float(h.get('scale', 0)) - 0.01) > 1e-12 or abs(float(h.get('offset', 0)) + 100.0) > 1e-12:
        raise ValueError(f'West Bay height encoding changed: {h}')


def build_tiles(raw: Path, manifest: dict, pts):
    """Build unmodified and patched RGB arrays for both target tiles directly from the 1 m DTM/DSM."""
    _validate_manifest(manifest)
    dtm_vrt = raw / 'areas/westbay/elevation/land-dtm-1m-epsg3979.vrt'
    dsm_vrt = raw / 'areas/westbay/elevation/land-dsm-1m-epsg3979.vrt'
    for vrt in (dtm_vrt, dsm_vrt):
        if not vrt.is_file():
            raise ValueError(f'Missing raw elevation VRT: {vrt}')

    bb = bounds(5, BLOCK_I, BLOCK_J)
    halo = (bb[0] - 2, bb[1] - 2, bb[2] + 2, bb[3] + 2)
    dtm_raw = _warp_exact(str(dtm_vrt), halo)
    dsm_raw = _warp_exact(str(dsm_vrt), halo)
    hdtm_raw, hdsm_raw = halve(dtm_raw), halve(dsm_raw)

    dtm_new, dsm_new, stats = shape_trough(dtm_raw, dsm_raw, halo, pts)
    hdtm_new, hdsm_new = halve(dtm_new), halve(dsm_new)
    hdtm_new, hdsm_new = clamp_level_footprint(hdtm_raw, hdsm_raw, hdtm_new, hdsm_new, halo, res(7), pts)

    built = []
    for level, i, j in TILES:
        rel = AREA_REL / f'{level}/{i}_{j}.png'
        tb = bounds(level, i, j)
        step = res(level)
        col, row = round((tb[0] - halo[0]) / step), round((halo[3] - tb[3]) / step)
        a0, c0 = (dtm_raw, dsm_raw) if level == 8 else (hdtm_raw, hdsm_raw)
        repro_rgb = encode(a0[row:row + TILE + 1, col:col + TILE + 1],
                           c0[row:row + TILE + 1, col:col + TILE + 1])
        a1, c1 = (dtm_new, dsm_new) if level == 8 else (hdtm_new, hdsm_new)
        after_rgb = encode(a1[row:row + TILE + 1, col:col + TILE + 1],
                           c1[row:row + TILE + 1, col:col + TILE + 1])
        _check_tile_edges_unchanged(repro_rgb, after_rgb, str(rel))
        _check_tile_footprint(repro_rgb, after_rgb, tb, step, pts, str(rel))
        built.append((rel, repro_rgb, after_rgb))
    return built, stats


def make(source: Path, raw: Path, output: Path, *, verify: bool = True, receipt_path: Path = RECEIPT) -> dict:
    """Build the two West Bay tile replacements into a NEW folder outside data/baked."""
    import numpy as np
    source, raw = source.resolve(), raw.resolve()
    assert_safe_stage_output(output, source)

    wb = source / AREA_REL
    manifest = json.loads((wb / 'manifest.json').read_bytes())
    pts = find_track_263(json.loads((wb / 'roads.json').read_bytes()))
    built, stats = build_tiles(raw, manifest, pts)

    output.mkdir(parents=True)
    files = []
    for rel, repro_rgb, after_rgb in built:
        src_tile = source / rel
        if not src_tile.is_file():
            raise ValueError(f'Missing source tile: {src_tile}')
        before_bytes = src_tile.read_bytes()
        before_rgb = _read_png_rgb(src_tile)
        if not np.array_equal(repro_rgb, before_rgb):
            raise ValueError(f'Source tile {rel} does not match unmodified 1 m DTM/DSM bake; refusing stale base')

        target = output / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        _write_png_gdal(target, after_rgb)
        if not np.array_equal(_read_png_rgb(target), after_rgb):
            raise ValueError(f'Written tile {target} failed pixel readback')

        after_bytes = target.read_bytes()
        changed_px = int((np.abs(after_rgb.astype(int) - before_rgb.astype(int)).max(axis=0) > 0).sum())
        files.append(dict(
            file=str(rel),
            before=sha(before_bytes),
            sha256=sha(after_bytes),
            bytes=len(after_bytes),
            changedPixels=changed_px,
            maxEdgeDiff=0,
        ))

    report = dict(
        version=1,
        area=AREA_ID,
        roadId=ROAD_ID,
        parameters=dict(
            s0=S0, s1=S1, endTaper=END_TAPER, slopeSpan=SLOPE_SPAN,
            halfBed=HALF_BED, outer=OUTER,
        ),
        shapeStats=stats,
        files=sorted(files, key=lambda f: f['file']),
    )
    (output / 'hashes.json').write_bytes(encoded_json(report))

    if verify:
        committed = json.loads(receipt_path.read_text())
        if report != committed:
            raise ValueError('STALE RECEIPT: generated delta differs from committed hashes.json; do not install')

    total_bytes = sum(f['bytes'] for f in report['files'])
    print(f'{len(report["files"])} files, {total_bytes:,} bytes in {output}')
    return report


def land_state(baked: Path, receipt: dict) -> tuple[str, list[str]]:
    """Return ('before' | 'after' | 'mixed', details) for the listed files in `baked`."""
    states = {}
    details = []
    for entry in receipt['files']:
        p = baked / entry['file']
        if not p.is_file():
            states[entry['file']] = 'missing'
            details.append(f'{entry["file"]}: missing')
            continue
        digest = sha(p.read_bytes())
        if digest == entry['before']:
            states[entry['file']] = 'before'
        elif digest == entry['sha256']:
            states[entry['file']] = 'after'
        else:
            states[entry['file']] = 'unknown'
            details.append(f'{entry["file"]}: unknown sha256 {digest}')
    unique = set(states.values())
    if unique == {'before'}:
        return 'before', []
    if unique == {'after'}:
        return 'after', []
    if not details:
        details = [f'{k}: {v}' for k, v in sorted(states.items())]
    return 'mixed', details


_DARWIN_SYSTEM_SYMLINKS = {Path('/tmp'), Path('/var'), Path('/etc')}


def _is_system_symlink(path: Path) -> bool:
    return sys.platform == 'darwin' and path in _DARWIN_SYSTEM_SYMLINKS


def _assert_no_symlink_path(path: Path):
    """Refuse if `path` or any ancestor directory (including parents above a land root) is a symlink."""
    base = Path(os.path.abspath(os.getcwd())) if not path.is_absolute() else Path(path.anchor)
    parts = list(base.parts[1:]) + [p for p in path.parts if p not in ('', path.anchor, '.')]
    cur = Path(base.anchor)
    for part in parts:
        cur = cur / part
        if cur.is_symlink() and not _is_system_symlink(cur):
            raise ValueError(f'Refusing to traverse or replace symlink: {cur}')


def verify_delta(delta: Path, receipt: dict) -> dict[str, bytes]:
    """Verify every staged file and hashes.json in `delta` matches `receipt`."""
    _assert_no_symlink_path(delta)
    staged_receipt_path = delta / 'hashes.json'
    _assert_no_symlink_path(staged_receipt_path)
    if not staged_receipt_path.is_file():
        raise ValueError(f'Missing hashes.json in delta folder: {delta}')
    staged_receipt = json.loads(staged_receipt_path.read_text())
    if staged_receipt != receipt:
        raise ValueError('Delta hashes.json does not match committed receipt')
    delta_bytes = {}
    for entry in receipt['files']:
        _assert_no_symlink_in_rel(delta, entry['file'])
        p = delta / entry['file']
        if not p.is_file():
            raise ValueError(f'Missing delta file: {p}')
        raw = p.read_bytes()
        if sha(raw) != entry['sha256'] or len(raw) != entry['bytes']:
            raise ValueError(f'Tampered delta file {entry["file"]}: sha256 {sha(raw)} bytes {len(raw)}')
        delta_bytes[entry['file']] = raw
    return delta_bytes


def _atomic_write(target: Path, data: bytes):
    _assert_no_symlink_path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f'.{target.name}.tmp-', dir=str(target.parent))
    tmp = Path(tmp_name)
    try:
        with os.fdopen(fd, 'wb') as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, target)
    except Exception:
        if tmp.exists():
            tmp.unlink()
        raise


def _assert_no_symlink_in_rel(root: Path, rel: str):
    _assert_no_symlink_path(root / rel)


def install(delta: Path, baked: Path, *, receipt_path: Path = RECEIPT) -> str:
    """Install a verified delta into `baked`, backing up before-files into `<delta>/before/`."""
    receipt = json.loads(receipt_path.read_text())
    delta_bytes = verify_delta(delta, receipt)
    backup_root = delta / 'before'

    # Phase 1: validate every live file, symlink path, and existing backup before writing anything.
    live_states = {}
    live_before_bytes = {}
    backup_present = {}
    for entry in receipt['files']:
        rel = entry['file']
        _assert_no_symlink_in_rel(baked, rel)
        _assert_no_symlink_in_rel(backup_root, rel)
        target = baked / rel
        if not target.is_file():
            raise ValueError(f'Missing live file: {target}')
        raw = target.read_bytes()
        digest = sha(raw)
        if digest == entry['before']:
            live_states[rel] = 'before'
            live_before_bytes[rel] = raw
        elif digest == entry['sha256']:
            live_states[rel] = 'after'
        else:
            raise ValueError(f'Unknown live bytes in {rel}: {digest}')

        backup = backup_root / rel
        if backup.exists():
            if not backup.is_file() or sha(backup.read_bytes()) != entry['before']:
                raise ValueError(f'Existing backup has wrong hash: {backup}')
            backup_present[rel] = True
        else:
            backup_present[rel] = False

    if set(live_states.values()) == {'after'}:
        print(f'already installed ({len(receipt["files"])} files match after receipt) in {baked}')
        return 'already-installed'

    # Resuming a mixed pair requires a verified backup for every already-installed tile so rollback stays complete.
    for entry in receipt['files']:
        rel = entry['file']
        if live_states[rel] == 'after' and not backup_present[rel]:
            raise ValueError(f'Missing backup for already-installed file {rel}: {backup_root / rel}')

    # Phase 2: write all missing backups before touching any live tile.
    for entry in receipt['files']:
        rel = entry['file']
        if live_states[rel] == 'before' and not backup_present[rel]:
            _atomic_write(backup_root / rel, live_before_bytes[rel])

    # Phase 3: atomically replace every before live tile.
    for entry in receipt['files']:
        rel = entry['file']
        if live_states[rel] == 'before':
            _atomic_write(baked / rel, delta_bytes[rel])

    state, details = land_state(baked, receipt)
    if state != 'after':
        raise ValueError(f'Post-install verification failed ({state}): {details}')
    print(f'installed {len(receipt["files"])} files into {baked}; backup in {backup_root}')
    return 'installed'


def rollback(delta: Path, baked: Path, *, receipt_path: Path = RECEIPT) -> str:
    """Restore before-files from `<delta>/before/` into `baked`."""
    _assert_no_symlink_path(delta)
    receipt = json.loads(receipt_path.read_text())
    backup_root = delta / 'before'

    live_states = {}
    backup_bytes = {}
    for entry in receipt['files']:
        rel = entry['file']
        _assert_no_symlink_in_rel(baked, rel)
        _assert_no_symlink_in_rel(backup_root, rel)
        target = baked / rel
        if not target.is_file():
            raise ValueError(f'Missing live file: {target}')
        digest = sha(target.read_bytes())
        if digest not in (entry['before'], entry['sha256']):
            raise ValueError(f'Refusing rollback over unknown live bytes in {rel}: {digest}')
        live_states[rel] = 'before' if digest == entry['before'] else 'after'
        backup = backup_root / rel
        if live_states[rel] == 'after':
            if not backup.is_file():
                raise ValueError(f'Missing or mismatched backup for {rel}: {backup}')
            raw = backup.read_bytes()
            if sha(raw) != entry['before']:
                raise ValueError(f'Missing or mismatched backup for {rel}: {backup}')
            backup_bytes[rel] = raw

    if set(live_states.values()) == {'before'}:
        print(f'already at before state in {baked}')
        return 'already-before'

    for entry in receipt['files']:
        rel = entry['file']
        if live_states[rel] == 'after':
            _atomic_write(baked / rel, backup_bytes[rel])

    state, details = land_state(baked, receipt)
    if state != 'before':
        raise ValueError(f'Post-rollback verification failed ({state}): {details}')
    print(f'rolled back {len(receipt["files"])} files in {baked}')
    return 'rolled-back'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='cmd', required=True)

    p_make = sub.add_parser('make', help='Stage the two patched tiles into a NEW folder outside data/baked')
    p_make.add_argument('source', type=Path, help='Baked land root containing areas/westbay/')
    p_make.add_argument('raw', type=Path, help='Raw data root containing areas/westbay/elevation/*.vrt')
    p_make.add_argument('output', type=Path, help='NEW output folder outside data/baked and data/site')
    p_make.add_argument('--record', action='store_true', help='Skip committed hashes.json comparison when recording')

    p_verify = sub.add_parser('verify', help='Verify a staged delta folder and optional baked land root')
    p_verify.add_argument('delta', type=Path)
    p_verify.add_argument('baked', type=Path, nargs='?')

    p_install = sub.add_parser('install', help='Install verified delta into a baked land root (main thread only)')
    p_install.add_argument('delta', type=Path)
    p_install.add_argument('baked', type=Path)

    p_rollback = sub.add_parser('rollback', help='Restore backed-up before tiles into a baked land root')
    p_rollback.add_argument('delta', type=Path)
    p_rollback.add_argument('baked', type=Path)

    args = parser.parse_args()
    if args.cmd == 'make':
        make(args.source, args.raw, args.output, verify=not args.record)
    elif args.cmd == 'verify':
        receipt = json.loads(RECEIPT.read_text())
        verify_delta(args.delta, receipt)
        print(f'PASS delta verified: {args.delta}')
        if args.baked is not None:
            state, details = land_state(args.baked, receipt)
            print(f'land state: {state}')
            if state == 'mixed':
                raise SystemExit(f'FAIL mixed/unknown land: {details}')
    elif args.cmd == 'install':
        install(args.delta, args.baked)
    elif args.cmd == 'rollback':
        rollback(args.delta, args.baked)


if __name__ == '__main__':
    main()
