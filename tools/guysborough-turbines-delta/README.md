# Guysborough County wind turbines far-data delta

This delta updates `tall.json` and the `tall` counts in `manifest.json` across all six game areas. All `far-land*.bin` terrain meshes, `far-land.json` files, and all other `manifest.json` keys stay unchanged.

## What changes in the land data

1. **Updates `c01` and `c02` turbines to `status: "operating"` (with `statusSource: "observed operating, 26 Nov 2026"`).**
   - `c01` (16 turbines): `status: "operating"` (`statusSource: "observed operating, 26 Nov 2026"`).
   - `c02` (Guysborough County, all 24 turbines placed): `status: "operating"` (`statusSource: "observed operating, 26 Nov 2026"`).
   - NRCan CWTD turbines keep `status: "operating"`.
   - Operating turbines spin and flash red in sync at night. Non-operating (`built` or `under-construction`) turbines stand still and stay dark.
2. **Places `c02-08` at its measured position (`E 622595.0, N 5047275.0`, EPSG:2961).**
   - `c02-08` was previously omitted by `safe_turbines` because it is 3.41 m from unnamed mapped track 934 (`kind: 4`, `halfWidth: 1.5 m`), which is the turbine's own pad access road (owner confirmed 26 Nov 2026).
   - A narrow allow-list entry in `pipeline/34_bake_far_views.py` (`TURBINE_CLEARANCE_EXCEPTIONS`) and `tools/tall-check.mjs` exempts only `c02-08` at its exact coordinates in `pointtupper` against that unnamed track (`kind: 4`, `halfWidth <= 1.5 m`, pinned by exact endpoints, 71 vertices, and full ordered polyline SHA-256 `b1d2eaf87001...`, not positional road ID alone). The clearance rule stays unchanged for all other turbines, areas, coordinates, roads and buildings.
   - `pointtupper`, `westbay` and `cansocauseway` gain +1 near turbine (`turbines: 40 -> 41`). `mabou`, `judique` and `porthood` gain +1 far turbine (`far: 163 -> 164`). `omitted.turbines` drops from 1 (`c02-08`) to 0.

## Build, install and rollback

Only the main thread installs into live `data/baked`.

```sh
# Stage a fresh delta outside data/baked and verify against committed hashes.json
python3 tools/guysborough-turbines-delta/patch.py make data/baked data/raw /path/to/new-stage
python3 tools/guysborough-turbines-delta/patch.py verify /path/to/new-stage data/baked

# Main thread install (each file replacement is atomic via os.replace; saves before tall.json files into <stage>/before/.
# An interruption mid-run across the six areas can leave the land mixed; re-running install or rollback with the original stage recovers it.)
python3 tools/guysborough-turbines-delta/patch.py install /path/to/new-stage data/baked

# Verify after install
python3 tools/guysborough-turbines-delta-check.py --land
node tools/far-delta-check.mjs
node tools/tall-check.mjs

# Rollback (restores backed-up before tall.json files and manifest tall counts atomically)
python3 tools/guysborough-turbines-delta/patch.py rollback /path/to/new-stage data/baked
```

`EXPECT` in `tools/guysborough-turbines-delta-check.py` is `None` (accepts all-before or all-after, never mixed) until the main thread installs the delta and flips it to `'after'`. Because `manifest.json` `tall` counts change (+1 turbine per area), refresh both 1884 land fingerprints in the post-install follow-up PR (`tools/check-era-density.sh --write` for Mabou, `DENSITY_AREA=judique tools/check-era-density.sh --write` for Judique, plus `tools/era-judique-check.mjs` if its pinned Judique manifest hash updates).
