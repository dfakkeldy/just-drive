# Mabou main street land (the project brief)

Source: the public-safe Mabou main street brief (17 Nov 2026) and its `lots.geojson`. No reference folder, footage,
stills or aerial imagery was opened. The hall's heights come from the open elevation model (DSM minus DTM, 1 m), which
the building bake already reads. Positions are EPSG:2961. No names, signs, logos or civic numbers.

## What changes

| Item | Change |
| --- | --- |
| Paved lots | `mabou-main-lot-1` to `-4` are on and `-5`, `-6` are off. They are owner corrections in the `data/raw/paved-open/corrections.json` format: the features of `corrections.json` here are appended to the live file. Measured on 2 m cells, the grocery lot goes from 0.647 to 0.955 paved, the gas station apron from 0.444 to 0.933, the post office lane and lot from 0 to 0.916 and the hall lot from 0 to 0.924. The rest of each lot is the 1 m margin round roofs and the road shoulders. 507 cells are added, all inside these four lots; none is removed. The other five areas keep every tile. |
| Grocery mailbox bank | It moves from (624905.26, 5103596.84) at 76.0° to (624896.85, 5103595.12) at 70.0°, 4 modules: flat on the east end wall at its south corner, doors facing east. The entry in `pipeline/areas.py` carries `flush=True`, so step 29 does not step it out of the store's walls or its former roof envelope. It still refuses a flush site inside a building's walls. |
| Post office mailbox site | 2 modules (was 3), same place. The random draw still happens, so every other site keeps its count. |
| Hall across from the post office (game 3) | The low-confidence outline (26.8 × 21.5 m, default heights 3.0/5.0) becomes three blocks of one building: a main block of 20 × 12.5 m with its gable end to the road (eave 4.0 m, ridge 7.2 m); a lower east wing of 12.5 × 4.5 m (2.8/3.9 m); and a rear wing of 20.5 × 11.3 m across the back (3.9/6.6 m). The main block keeps id 3 and gets the old record as its `site`; the wings are new ids 1733 and 1734. See "The hall" below. |
| Post office building (game 150) | Kind `shed` becomes `large`. Its paint was already right. As a `large` building it gets a service drop. |
| Gas station (game 169) | Kind `house` becomes `large`. It loses its chimney, steps and house trim, and it is no longer a house for the mail. |
| Paint (step 30 landmarks) | The grocery (51) gets olive green walls, maroon trim and a charcoal roof. The gas station (169) gets dark grey-brown walls and roof, metal, with dark blue trim. The hall (3) is white with a dark grey shingle roof. The museum (140) is blue-grey; the café (71) turquoise; the pub (973) and its rear part (180) white with red trim. The dark red shop (130) is dark red; the bank branch (198) greige with a grey shingle roof; the Victorian (92) grey-green with a front porch. The sheds behind the gas station (196) are olive green and the mobile home west of it (162) is white. Six new paint families back them (`olive green`, `turquoise`, `greige`, `maroon`, `charcoal`, `dark grey-brown`). They are used only by these landmarks. |

Nothing else changes. `check()` in `patch.py` proves it on every make:
- `buildings.json` is the live file with the corrections of `pipeline/mabou_main.py` applied, byte for byte.
- Only the twelve buildings that the Mabou village delta landmarks match change paint. Every older landmark keeps its match.
- No mailbox or pole moves. Only community sites 0 and 3 change. Only the drops of buildings 3 and 150 change.

### The hall

The brief expects about 12 × 20 m plus a side wing, with the gable end to the road. The elevation model, sampled
across the old outline in its own frame (u away from the road, v along it from the west corner), shows:
- a gable ridge running away from the road at v ≈ 12, 6.8–7.3 m high, with eaves at v ≈ 5.5 and 18 (4.0–4.4 m);
- the road-facing wall about 2.5 m nearer the road than the map outline;
- a lower roof on the east side at v 18–22.5 (2.6–4.3 m);
- a roof across the whole back from u ≈ 15.5 (7.5 m), falling to 3.9 m at u 26. That is the rear wing the brief saw only in part.

Wings in the game always get a gable roof, so the rear wing is a cross gable (ridge 6.6 m) and not a lean-to. The main
block's gable end shows above it. The `site` record keeps the old outline as the property: mailboxes, the 1884 era and
the mail read that record, and none of them changes.

## Land delta for the main thread

Only the main thread installs land. The delta folder holds `hashes.json`, `paved-receipt.json`,
`raw-mirror/data/raw/paved-open/corrections.json` and 14 land files (1.08 MB):
- Mabou `terrain/buildings.json`, `terrain/building-styles.json`, `terrain/props.json`;
- `terrain/paved/index.json`, three changed and two new Mabou paved tiles (41 → 43);
- the other five `paved/index.json`, where only `provenanceSha256` changes (the corrections file is an input of every area);
- the owned keys of `terrain/manifest.json`: `buildings` (count 1065 → 1067), `buildingStyles` (count unchanged),
  `props` (469 mailboxes, 2789 poles, 282 → 283 service drops) and `paved` (tiles 41 → 43).

```sh
python3 tools/mabou-village-delta-check.py --land                                    # before or after; never mixed
python3 tools/mabou-village-delta/patch.py install /path/to/mabou-village-delta-delta data/baked   # main thread only
python3 tools/mabou-village-delta-check.py --land                                    # now "after"
```

Then:
- Run step 29 for Mabou on the MacBook, which has the road lines from before the bed move:
  `tools/bake.sh 29_bake_props.py`. Expect `terrain/props.json` to stay byte for byte as installed (see "Step 29"
  below). If it differs, keep the MacBook's file and tell Mabou village delta.
- Run `tools/bake.sh 27_check_buildings.py` (it needs the step-27 work files, which only the MacBook has).
- Packs and site.

`install` checks everything before it writes anything. It refuses, writing nothing:
- a delta that differs from the committed receipt;
- unknown live bytes;
- a stale paved input, such as a road, tree tile, manifest lattice or building file that changed since the bake;
- a corrections file that is neither the one the delta was made on nor that file with the Mabou village delta lots merged in.

When it writes:
- it replaces files atomically;
- it writes only the owned manifest keys (other bakes own every other key);
- it merges the six Mabou village delta lots into the corrections file and never replaces it: every byte of the live file stays, and the
  lots are appended to its list (it checks that the receipt's file is exactly that);
- it keeps every replaced file in `<delta>/before/`, and the old corrections file as `corrections.json.before-1229`,
  so the install can be undone by hand.

An install that stopped half way is finished by running it again. A second full install does nothing.

The 1884 layout (`tools/era-density-layout.json`) fingerprints Mabou's `buildings.json`. This branch carries the
layout made on the after land (`tools/check-era-density.sh --write`): its content is the same as today's; only the
fingerprints of `buildings.json` and of the manifest (its buildings count) change. So `era-density-inputs` passes on the after land only, as after every land
change to Mabou's buildings.

The same holds for two more pins, so this branch is merged only after the install (its builder lands it then):
- `tools/baseline/mail-preview-cost.json`: only the input hash moves (the community sites); the flight digest and every
  work counter are the same on both lands.
- `tools/baseline/frame-budget*.json`, Mabou scenes: +2 paved tile requests (the two new lot tiles) and slightly fewer
  triangles, measured five times on the after land. Point Tupper's triangle rise is Point Tupper delta's and is not re-pinned here.

The install PR sets `EXPECT = 'after'` in `tools/mabou-village-delta-check.py` and `ACCEPT_PREVIOUS = False` in
`tools/paved-open-land-check.py`. Until then `paved-open-land` accepts the land of the receipt that this one replaces
(`tools/paved-open/hashes-point-tupper.json`, with Judique lots delta's Judique entry).

This delta is made on the canonical land: Point Tupper delta's Port Hawkesbury delta, then Judique lots delta's Judique lots delta, each
installed by its own installer. Its before state is that land: the corrections file is Judique lots delta's mirror (Point Tupper delta's lots and
Judique lots delta's merged in), the paved receipt is Point Tupper delta's (kept as `tools/paved-open/hashes-point-tupper.json`) with Judique lots delta's Judique entry.
Its paved bake reproduces every Judique and Point Tupper tile byte for byte; only their `index.json` provenance changes.
`point-tupper-delta-land`, `judique-lots` and `road-scene-delta-land` read a file at Mabou village delta's exact after bytes as the bytes it replaced,
so they pass before and after this install. A land delta installed before this one makes `install` refuse (stale land
or an unexpected corrections file): re-make it on that land (the steps below) and review the new receipt.

## Step 29

Step 29 decides mailboxes on the road lines from before the bed move. The rented mini does not have them, so
`patch.py props` runs step 29 with the current lines in their place, then puts LIVE's mailboxes back. That is exact
for this change. Two stand-in runs, today's code on today's land and this branch on the new land, gave:
- identical mailboxes;
- identical poles, equal to the live poles;
- the live community sites and drops in the first run.

The lines decide only the mailboxes. No mailbox changes, because no property enters or leaves the 120 m cabinet circle
when the grocery bank moves 8.6 m, and the corrected buildings keep their property records. The difference is the two
community sites, the hall's drop (it now lands on the rear wing, height 3.9 m) and a new drop for the post office
building.

## Making the delta again

```sh
# A REAL checkout of this branch with its own data/: baked/terrain = an APFS clone of the live terrain, baked/areas a
# link, raw/paved-open a copy of the live folder with `python3 tools/mabou-village-delta/patch.py compose <live corrections.json>`
# (the live file with the Mabou village delta lots merged in) as corrections.json, other raw folders linked.
python3 pipeline/mabou_main.py data/baked/terrain                 # buildings.json and the manifest count
AREA=mabou tools/bake.sh 30_bake_building_styles.py
python3 tools/mabou-village-delta/patch.py props "$PWD" /live/data/baked
python3 pipeline/32_bake_paved.py --paved --root "$PWD" --output "$PWD/data/work/bakes/paved-1229"   # last: it pins the manifest
python3 tools/mabou-village-delta/patch.py make data/baked data/work/bakes/paved-1229 /live/data/baked /new/folder
```
