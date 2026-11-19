# Port Hawkesbury land (the project brief): big buildings and three lots

Source: the public-safe Port Hawkesbury builder brief (17 Nov 2026), sections "The one big fix" and 5b. No
reference folder, footage or stills were opened. Positions are EPSG:2961. No names, signs, logos or civic numbers.

## What changes

| Item | Change |
| --- | --- |
| Big buildings | `big_buildings=True` for pointtupper in `pipeline/areas.py`. Step 27 keeps the large mapped outlines that its size gate dropped, as blocks and tanks with their own lidar heights (`pipeline/big_buildings.py`, PR #117): 34 buildings in 146 blocks and 31 tanks, 177 new records. All 2576 existing records and their ids are unchanged. |
| P1, the corner garage apron | New paved lot, 676 m²: the brief's polygon, without the unseen ground north of N 5052169 and north-east of the garage. |
| P4, the car dealer lots | Paved to the road edge (0.947 to 0.968 of the brief polygon). The rest is the road ribbons and the 1 m wall margins. |
| P8, the waterfront lot | Paved to the railroad (0.637 to 0.813). The track's ribbon and 1.1 m of worn edge stay open. |
| P7, P9, P10, P12, P13, P15, P16 | Unchanged, cell for cell. The three correction polygons leave these lots out. |
| Big lots (P2, P3, P5, P11) | Lose only the 1 m margin round the new roofs (for example, P2 drops from 0.977 to 0.969). |

The three lots are owner corrections in the `data/raw/paved-open/corrections.json` format (`corrections.json` here, appended to the live file).
They carry `meetsRoad: true`. Such a lot loses the same roofs (plus 1 m), water and whole hand-built sites as any lot,
but of the roads only the ribbons themselves. It does not lose the shoulder band, because the shader drops the gravel
shoulder under a paved lot. A railroad keeps its ribbon plus 1.1 m (`RAIL_EDGE_M` in `pipeline/paved.py`).

Measured on the rehearsed land (EPSG:2961 cells of 2 m):
- Every changed cell is accounted for: 332 cells added, all inside P1, P4 or P8, and 364 removed, all within the 1 m roof margin of a new block.
- The dropped-lot pin is the same: Point Tupper 13, 30, 46, 53, 63, 64, 75.
- No new block lies on a prop or across a public road line (kinds 1-3, the bake's own test); the one graze of railroad 191 (kind 3) is below.
- 30 cells of today's paving (120 m²) have their centres under new roofs: edge grazes of 1 to 5 cells (P2 8, P5 3, P11 4, 15 outside the brief lots).
- Seven blocks cover parts of kind-4 tracks. These are old map lines where the lidar now shows a roof. Area of track ribbon under each block:
  - road 897, industrial building in Point Tupper: 231 m²;
  - civic centre: road 688 174 m², road 719 45 m², road 698 18 m², road 883 4.5 m²;
  - road 805: 1 m²;
  - plaza: road 671, 0.6 m².

  PR #117's rule keeps a block off public roads (kinds 1-3) only. No AI, traffic or mail route uses kind 4, but a player who follows track 897 or 688 meets a wall. The owner decides whether to trim those track lines; this delta does not touch roads.
- The ribbon of railroad 191 grazes the industrial plant's main block: 6.3 m² along a 132 m wall.
- `tools/check-big.sh` passes: no block or tank in a hand-built site (pointtupper has none) and closed roofs.

Brief outlines against the blocks (lidar median height; eave of the blocks that cover it):

| Ref | What | Brief | Blocks | Cover |
| --- | --- | --- | --- | --- |
| L01 | big-box store (outline 91) | 5.3 | 5.1-6.5 | 0.90 |
| L03, L10, L16, L18 | Reeves St plaza (37) | 4.5, 7.3, 4.6, 6.6 | 4.4-5.2, 7.3, 4.8-5.0, 4.8 | 0.90-0.96 |
| L04 | building-supply store (127) | 7.9 | 6.8-8.0 | 0.97 |
| L05, L15 | school (65) | 8.5, 8.8 | 8.7-8.9 | 0.93, 0.89 |
| L06 | east-plaza grocery (121) | 7.5 | 7.5 | 0.98 |
| L07 | school (104) | 8.7 | 8.6-8.8 | 0.95 |
| L08, L17, L19, L20 | college (75) | 8.9, 5.3, 7.2, 7.2 | 8.8-8.9, 5.2-5.3, 7.1, 8.8 | 0.66-0.99 |
| L11, L12, L23 | civic centre and arena (206) | 8.0, 14.5, 11.3 | 7.6-8.0, 14.5, 11.3 | 0.85-1.00 |
| L21 | wall or rail cars | 3.2 | none | - |

L18 is covered by the plaza's 4.8 m block. Its own 6.6 m roof is narrower than a block (`STEP_SIDE`).

## Land delta for the main thread

Only the main thread installs land. The delta folder holds `hashes.json`, `paved-receipt.json`,
`raw-mirror/data/raw/paved-open/corrections.json` and 28 land files (1.9 MB):
- pointtupper `buildings.json`;
- pointtupper `props.json`: the installed mailboxes and poles byte for byte, plus 18 service drops to new blocks (1526 to 1544). See "Props" below;
- 20 changed Point Tupper paved tiles;
- all six `paved/index.json`. Outside Point Tupper only their `provenanceSha256` changes, because the recipe and the corrections file are inputs of every area. This includes Mabou and Judique, but nothing an 1884 input reads: the era fingerprints leave out `manifest.paved` and never read `paved/`, and those manifests do not change. Their packs rebuild for the one index file;
- the owned manifest keys (`buildings`, `props` and `paved` of pointtupper; the tile count stays 117);
- the composed corrections file;
- `paved-receipt.json`, which equals the committed `tools/paved-open/hashes.json`.

```sh
python3 tools/point-tupper-delta-check.py --land                                    # before or after; never mixed
python3 tools/point-tupper-delta/patch.py install /path/to/ph-1227-delta data/baked # main thread only
python3 tools/point-tupper-delta-check.py --land                                    # now "after"
```

`install` checks everything before it writes anything. It refuses, writing nothing:
- a delta that differs from the committed receipt;
- unknown live bytes;
- a stale paved input, such as a road, tree tile, manifest lattice or building file that changed since the bake (the land check warns about it before the install);
- a corrections file that is neither the before one nor the after one.

When it writes:
- it replaces files atomically;
- it writes only the owned manifest keys (other bakes own every other key);
- it keeps every replaced file in `<delta>/before/`, and the old corrections file as `corrections.json.before-1227`, so the install can be undone by hand.

An install that stopped half way (every entry before or after) is finished by running it again. A second full install does nothing. After the install no bake is needed: only packs and the site.

## Props

The delta's props come from step 29 with `power_only=True` (as the power network delta power delta used). That mode keeps the
installed mailboxes, community boxes and public poles, and lays only power poles on built named tracks and service
drops. On the after land it changes nothing but 18 new service drops, all to new blocks. The maker refuses work props
that differ in anything but `serviceDrops`. On the before land, `power_only` reproduces the installed `props.json` and
manifest byte for byte (`props.json` `1230c547…`).

A full step 29 is not used. On today's land it gives 1363 mailboxes and 2792 poles, against the installed 1361 and 2725;
the MacBook gives the same. Every commit back to #132 gives that output on today's land, so code is not the cause. The
cause is the land: #154 made Industrial Park Road (road 107) a public kind-2 road on 16 Nov as an isolated road delta,
with no props change.
- A full bake lays 67 public poles along it, plus four one-pole swaps on Henry Paint St, Port Malcolm Rd, road 104 and a railroad.
- It moves 5 mailboxes and adds 2 beside it.

That refresh follows from the current roads, but it is a separate change from Point Tupper delta and needs its own review.

`point-tupper-delta-land` pins this exact land and corrections file. The next paved receipt or owner correction retires the row
(or replaces it with that change's own check), as Point Tupper delta does with initial paving delta's. The install PR sets `EXPECT = 'after'` in `tools/point-tupper-delta-check.py` and `ACCEPT_PREVIOUS = False` in
`tools/paved-open-land-check.py`. Until then `paved-open-land` accepts the land of the receipt that this one replaces
(`tools/paved-open/hashes-initial.json`).

The switch is on in this branch before the data is installed. Until the install, a routine step-27 bake of
pointtupper would add the blocks outside this reviewed delta. So bake pointtupper only through this delta until it is installed.

Step 30 is not part of this change. When it was made no area but Mabou had baked styles (`buildingStyles.count` was 0
in the other five), and baking them repaints every building in the area. Point Tupper's colours came later as their own delta
(grok-bots #1288); they change only `building-styles.json` and the manifest's `buildingStyles` key, which this delta does not own.

To make the delta again (refuses stale or extra changes; compares with both committed receipts):

```sh
# A REAL checkout with its own data/: baked = an APFS clone of the live land, raw/paved-open with the live source and
# `python3 tools/point-tupper-delta/patch.py compose <live corrections.json>` as corrections.json.
AREA=pointtupper MMM_BIG_BUILDINGS=1 tools/bake.sh 27_bake_buildings.py --preserve-sites
AREA=pointtupper MMM_BIG_BUILDINGS=1 tools/bake.sh 27_check_buildings.py
MMM_AREA=pointtupper python3 -c 'import sys,importlib.util; sys.path.insert(0,"pipeline"); s=importlib.util.spec_from_file_location("p","pipeline/29_bake_props.py"); p=importlib.util.module_from_spec(s); s.loader.exec_module(p); p.main(power_only=True)'
(cd pipeline && python3 32_bake_paved.py --paved --root "$PWD/.." --output "$PWD/../data/work/bakes/paved-1227")
python3 tools/point-tupper-delta/patch.py make data/baked data/work/bakes/paved-1227 /live/data/baked /new/folder
```

`make` compares every file of the work land with the live land. Only pointtupper `buildings.json` and its manifest
`buildings` key may differ, so nothing else can ride along. The paved bake must have read the work land and the
composed corrections.

On the M4 the switch-off bake (`MMM_BIG_BUILDINGS=0 --preserve-sites`) gave today's `buildings.json` byte for byte
(`375c1b9c…`), from the four raw building files that the main thread copied there. The M4 has no bridges vector file,
so its runs took the village anchor from the installed manifest (the manifest pins the snapped anchor).
