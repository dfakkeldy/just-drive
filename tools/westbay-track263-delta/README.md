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
- Outside `|d| > 6.0 m` and outside `s = 826-854 m`, the survey ground stays untouched.
- Low ditch scrub (`0.2-0.6 m` canopy) on the graded bed is cleared; no trees stand within 20 m.

## Changed files

Only two corridor height tiles change. Every tile edge matches its neighbour with zero difference (`check-terrain-edges.py westbay`: 6,504 pairs, 0 bad). `manifest.json`, `roads.json`, `bridge-decks.bin`, `buildings.json`, `props.json`, `paved/` and all other areas stay byte-identical.

| File | Before SHA-256 | After SHA-256 | Bytes | Changed pixels | Max edge diff |
| --- | --- | --- | ---: | ---: | ---: |
| `areas/westbay/7/78_76.png` | `46cb50bff5c94a307f7ec8d78fae703d7e46489dd57e845b003c6b1c72db7035` | `1ae53ceaa3ef3d55b3a62b7b8414f9b113ec2fe69f78603867c4dcac6094f1a8` | 77,343 | 80 | 0 |
| `areas/westbay/8/156_152.png` | `f8ac66e57859b0e5065ba59aae0f5ab5c2498551526d9430a4f6bccbb629b478` | `7d13d20d14ef1f893a461efddf5c9253d5d6bbccd829349458631ba04ca27ff8` | 69,936 | 286 | 0 |

## Same-path drive results

Measured along the exact `tools/fleet-main-contact-check.mjs` crossing on track 263 (`pts[204..214]`, 39.81 m) with `tools/westbay-track263-drive-check.mjs`.
Raw `drawnTyre` with potholes enabled includes a 101.3 mm procedural track pothole at untouched `s = 816-820 m` before the trough; `ownTyre` and `drawnAdj` subtract the pothole depth.

| Case | Before (arrived, `ownTyre` / `drawnAdj` / `float` / `body`) | After (arrived, `ownTyre` / `drawnAdj` / `float` / `body`) | After, potholes off (`drawnTyre` / `ownTyre` / `float` / `body`) |
| --- | --- | --- | --- |
| Hill 1 car | true, 279.0 / 279.0 / 170.7 / 747.2 mm | true, 40.0 / 40.0 / 34.7 / 0.0 mm | 13.4 / 8.2 / 18.0 / 0.0 mm |
| Hill 1 pickup | true, 346.7 / 342.4 / 205.9 / 851.2 mm | true, 39.4 / 39.4 / 31.7 / 0.0 mm | 28.3 / 13.0 / 15.7 / 0.0 mm |
| Hill 2.5 car | **false** (24.67 m), 876.7 / 876.7 / 780.9 / 2142.6 mm | **true** (39.81 m), 47.4 / 47.4 / 43.1 / 0.0 mm | 33.6 / 20.5 / 42.8 / 0.0 mm |
| Hill 2.5 pickup | true, 1112.4 / 985.9 / 1066.9 / 2176.2 mm | true, 43.8 / 43.8 / 41.5 / 0.0 mm | 71.3 / 33.1 / 38.5 / 0.0 mm |

Reverse crossings (SE to NW, potholes off) also arrive with all contact metrics under 50 mm: Hill 1 car 8.1 mm, Hill 1 pickup 12.6 mm, Hill 2.5 car 19.8 mm, Hill 2.5 pickup 31.8 mm (`body` 0.0 mm in all cases).

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
