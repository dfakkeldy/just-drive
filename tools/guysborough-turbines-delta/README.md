# Guysborough County wind turbines far-data delta

This delta updates `tall.json` and the `tall` counts in `manifest.json` across all six game areas. All `far-land*.bin` terrain meshes, `far-land.json` files, and all other `manifest.json` keys stay unchanged.

## What changes in the land data

1. **Adds `c02-24` (the 24th turbine of farm `c02` in Guysborough County).**
   - Position from Copernicus Sentinel-2 L2A `S2B_20TPR_20261026_0_L2A` (26 Oct 2026, pixel `[1143, 452]`): E `622465.0`, N `5046105.0` (EPSG:2961, 12 m from the EA filing position).
   - Clears the nearest road (`Savory Road`) by 10.71 m (above the 4.714 m base + 2 m clearance rule).
   - `pointtupper`, `westbay` and `cansocauseway` gain +1 near turbine (`turbines: 39 -> 40`). `mabou`, `judique` and `porthood` gain +1 far turbine (`far: 162 -> 163`).
   - Note: `c02-08` (`622595.0, 5047275.0`) remains omitted by `safe_turbines` because it is 3.41 m from unnamed mapped track 934; positions are never shifted.
2. **Adds explicit public build `status` to every turbine.**
   - NRCan CWTD turbines: `status: "operating"`.
   - `c02` (Guysborough County, 24 turbines): `status: "operating"` (in service Oct 2026).
   - `c01` (2026 build, 16 turbines): `status: "built"` (erected, not yet commissioned as of 25 Nov 2026).
   - Operating turbines spin and flash red in sync at night. Non-operating (`built` or `under-construction`) turbines stand still and stay dark.

## Build, install and rollback

Only the main thread installs into live `data/baked`.

```sh
# Stage a fresh delta outside data/baked and verify against committed hashes.json
python3 tools/guysborough-turbines-delta/patch.py make data/baked data/raw /path/to/new-stage
python3 tools/guysborough-turbines-delta/patch.py verify /path/to/new-stage data/baked

# Main thread install (atomic replace; saves before tall.json files into <stage>/before/)
python3 tools/guysborough-turbines-delta/patch.py install /path/to/new-stage data/baked

# Verify after install
python3 tools/guysborough-turbines-delta-check.py --land
node tools/far-delta-check.mjs
node tools/tall-check.mjs

# Rollback (restores backed-up before tall.json files and manifest tall counts atomically)
python3 tools/guysborough-turbines-delta/patch.py rollback /path/to/new-stage data/baked
```

`EXPECT` in `tools/guysborough-turbines-delta-check.py` is `None` (accepts all-before or all-after, never mixed) until the main thread installs the delta and flips it to `'after'`.
