# West Bay track 263 trough land delta

This delta hand-fixes the sharp trough on track 263 near E 631608 / N 5064399 (EPSG:2961) in West Bay.
The West Bay quarry keep box (`630200-633200 E, 5061400-5066500 N`) and `road-ground-check.py` stay unchanged.

## 1 m DTM check

The 1 m bare-earth DTM (`data/raw/areas/westbay/elevation/land-dtm-1m-epsg3979.vrt`) confirms the dip is real ground, with zero nodata pixels.
A continuous SW-to-NE drainage gully (~2.1 m deep, 57.5 m SW sloping down to 56.7 m NE) cuts across track 263 at `s = 831-840 m` (floor 57.62 m at `s = 835 m`, slopes up to 68%).
An excavated spoil berm sits on the SE bank of the gully at `s = 841-850 m` (crest 59.92 m, dropping -21.7% down to the natural track grade of 58.92 m at `s = 851 m`).

Because the gully is real ground, this fix grades only the track crossing:

- Along track 263 (`kind = 4`, `halfWidth = 1.5 m`): cubic Hermite profile from `s = 828 m` (59.74 m) to `s = 852 m` (58.91 m), matching the undisturbed slopes outside both ends and fading over 2 m at each end.
- Across track 263: level bed across `|d| <= 3.0 m` (the 1.5 m track half-width plus a 1.5 m mesh-vertex shoulder so the 2 m L8 terrain triangles spanning the wheels stay level), tapering smoothly back into the real gully by `|d| = 6.0 m`.
- Outside `|d| > 6.0 m` and outside `s = 826-854 m`, the survey ground stays untouched at both L8 and L7 (`halve()` bleed past 6 m is clamped back to unmodified raw values before L7 encoding, and both tiles are verified against the footprint limit).
- Low ditch scrub (`0.2-0.6 m` canopy) on the graded bed is cleared; no trees stand within 20 m.

## Changed files

Only two corridor height tiles change. Every tile edge matches its neighbour with zero difference (`check-terrain-edges.py westbay`: 6,504 pairs, 0 bad). `manifest.json`, `roads.json`, `bridge-decks.bin`, `buildings.json`, `props.json`, `paved/` and all other areas stay byte-identical.

| File | Before SHA-256 | After SHA-256 | Bytes | Changed pixels | Max edge diff |
| --- | --- | --- | ---: | ---: | ---: |
| `areas/westbay/7/78_76.png` | `46cb50bff5c94a307f7ec8d78fae703d7e46489dd57e845b003c6b1c72db7035` | `fb7ac5a9ce73a11ef17d5ffd97ccb76b6ed7ee59fc140c0106e51ac11ff7d93c` | 77,338 | 72 | 0 |
| `areas/westbay/8/156_152.png` | `f8ac66e57859b0e5065ba59aae0f5ab5c2498551526d9430a4f6bccbb629b478` | `7d13d20d14ef1f893a461efddf5c9253d5d6bbccd829349458631ba04ca27ff8` | 69,936 | 286 | 0 |

## Same-path drive results

Measured along the exact `tools/fleet-main-contact-check.mjs` crossing on track 263 (`pts[204..214]`, 39.81 m) with `tools/westbay-track263-drive-check.mjs`.
Each tyre vertex is projected onto track 263 to gate raw visible sink (`drawn - y`) and physics sink (`physics - y`) inside the patched trough (`s = 826-854 m`), with no mesh-discrepancy subtraction.
With potholes off, every tyre (all 4 car tyres and all 6 pickup tyres) is gated on pure raw sink (`0` pothole allowance).
With potholes on, each of the 4 physics wheel stations (`fl`, `fr`, `rl`, `rr`) subtracts only the pothole sampled at its own world hub (no outer-to-inner borrowing); pickup inner dually tyres (`extraWheels`) are gated in the potholes-off runs and logged transparently because `web/src/vehicle.ts` samples potholes only at the 4 outer stations (a 70.7 mm undrawn pothole under outer `rr` drops rigid-axle twin `innerR` by 54.0 mm even on a mathematically flat plane).
Full-path arrival, `float`, and `body` are gated across the entire crossing.
Outside the patched trough, untouched ground at `s = 810.4 m` (15.6 m before the trough) shows a natural 2 m L8 mesh discrepancy on Hill 2.5 pickup (71.3 mm forward, 65.8 mm reverse, logged as `fullDrawnMm` and left untouched to keep the patch local to the trough).

| Case | Before trough (`arrived`, `drawn` / `own` / `float` / `body`) | After trough, potholes on (`arrived`, `drawn` / `own` / `float` / `body`) | After trough, potholes off, all tyres (`drawn` / `own` / `float` / `body`) |
| --- | --- | --- | --- |
| Hill 1 car | true, 295.1 / 279.0 / 170.7 / 747.2 mm | true, 20.9 / 27.8 / 34.7 / 0.0 mm | 8.6 / 8.2 / 18.0 / 0.0 mm |
| Hill 1 pickup | true, 347.0 / 346.7 / 205.9 / 851.2 mm | true, 33.4 / 35.9 / 31.7 / 0.0 mm | 13.0 / 13.0 / 15.7 / 0.0 mm |
| Hill 2.5 car | **false** (24.67 m), 970.0 / 876.7 / 780.9 / 2142.6 mm | **true** (39.81 m), 22.6 / 39.1 / 43.1 / 0.0 mm | 22.3 / 20.5 / 42.8 / 0.0 mm |
| Hill 2.5 pickup | true, 1047.2 / 1112.4 / 1066.9 / 2176.2 mm | true, 37.4 / 43.6 / 41.5 / 0.0 mm | 32.9 / 33.1 / 38.5 / 0.0 mm |

Reverse crossings (SE to NW) also arrive across all cases with every gated trough raw sink, `float`, and `body` metric under 50 mm: potholes on (`drawn` / `own`): Hill 1 car 26.4 / 28.8 mm, Hill 1 pickup 33.7 / 33.8 mm, Hill 2.5 car 33.2 / 39.2 mm, Hill 2.5 pickup 36.1 / 36.2 mm; potholes off, all tyres (`drawn` / `own`): Hill 1 car 8.5 / 7.8 mm, Hill 1 pickup 12.2 / 12.6 mm, Hill 2.5 car 20.9 / 19.8 mm, Hill 2.5 pickup 30.6 / 31.8 mm (`body` 0.0 mm in all 16 cases).

## Build, install and rollback

Only the main thread installs into live `data/baked`.

```sh
# Stage a fresh delta outside data/baked and verify against committed hashes.json
python3 tools/westbay-track263-delta/patch.py make data/baked data/raw /path/to/new-stage
python3 tools/westbay-track263-delta/patch.py verify /path/to/new-stage data/baked

# Main thread install (atomic replace; saves before-files into <stage>/before/)
python3 tools/westbay-track263-delta/patch.py install /path/to/new-stage data/baked

# Verify after install
python3 tools/westbay-track263-delta-check.py --land
node tools/westbay-track263-drive-check.mjs --require-after
python3 tools/check-terrain-edges.py westbay

# Rollback (restores backed-up before-files atomically)
python3 tools/westbay-track263-delta/patch.py rollback /path/to/new-stage data/baked
```

`EXPECT` in `tools/westbay-track263-delta-check.py` is `None` (accepts all-before or all-after, never mixed) until the main thread installs the delta and flips it to `'after'`.
