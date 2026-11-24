# Point Tupper stockpiles (the project brief)

Two stockpiles at Point Tupper are drawn from open data: a coal pile (NSTDB pile polygon DAPI40/3718) and a log
yard (NSTDB storage polygon DASA42/1039). LABELS.md records how the two were chosen from 20 candidates. No aerial
picture is an input of the bake or of the game, and none is stored (the labels in LABELS.md came from looking at a
public basemap; nothing was saved). No business is named.

| File | What it is |
| --- | --- |
| `stockpiles.json` | The baked pack (about 66 kB), committed so that every host can draw and check it |
| `hashes.json` | SHA-256 and size of the pack, the manifest key, the two piles |
| `install.py` | Makes the install files in a NEW folder; it never writes into a land |
| `LABELS.md` | The look-only material labels of all 20 candidates |
| `../../pipeline/33_bake_stockpiles.py` | The bake (GDAL; raw polygons, baked roads, DSM and DTM) |
| `../stockpiles-delta-check.py` | Committed pack, land state (before or after) and the remake |

## The pack

`python3 pipeline/33_bake_stockpiles.py SOURCE_DATA NEW_OUTPUT_DIRECTORY` reads `raw/areas/pointtupper` and
`baked/areas/pointtupper/roads.json` under SOURCE_DATA and writes `stockpiles.json` and `report.json` into a new
folder. On 16 Nov 2026 it wrote the committed bytes again from the land with Industrial Park Road paved (the
industrial-surface delta changes a road's kind, not its line or width, and the bake reads only line and width).

- Coal: grid cells inside the polygon (3 m in from its edge) that stand 0.5 m or more above the pile's foot, with no
  tall return above them (conveyors and trees are left out, never painted black). The pile's shape is already in
  the land's height model; the pack holds a skin for it.
- Logs: cells whose surface return stands 1.2 to 8 m above the yard. Each connected group is one stack, with its
  measured height and the direction of its row (an angle from 0 to pi). A stack of a few cells takes the direction
  of the largest stack.
- Every face keeps 3 m from mapped roads and tracks (beyond their half width) and 4 m from mapped buildings.
- HIGH samples every 4 m, LOW every 8 m. A part smaller than a pile (80 m² coal, 120 m² logs) is dropped.

Measured clearance of the committed pack: the stacks are 32.6 m from the centre line of Industrial Park Road and
5.5 m from the nearest yard track; the coal is 169.5 m from Industrial Park Road and 15.4 m from the gravel line
beside it. The four signal junctions of PR #158 are 1.5 km or more away.

## Install (main thread)

The install is two things in `data/baked/areas/pointtupper`, and they go in together:

1. the file `stockpiles.json` (the committed pack, byte for byte);
2. the manifest key `"stockpiles": {"file": "stockpiles.json", "count": 2}`.

Steps on the MacBook:

1. On the pre-merge code (`EXPECT = None`), `python3 tools/stockpiles-delta-check.py` must pass and print
   `land state: before` (check-all shows only a failing line, so run the script itself to read the state).
2. `python3 tools/stockpiles-delta/install.py data/baked/areas/pointtupper NEW_FOLDER`. NEW_FOLDER must not exist
   and must be outside baked and site data. It refuses a land that already has the key or the file. It writes `stockpiles.json`, `manifest.json` (the manifest as it is now plus
   the one key, every other byte kept) and `install.json` (hashes; `before` is the manifest it was made from).
3. Check that `data/baked/areas/pointtupper/manifest.json` still hashes as `before` in `install.json` (no bake ran
   in between). Keep a copy of that manifest.
4. Copy `NEW_FOLDER/stockpiles.json` and `NEW_FOLDER/manifest.json` into `data/baked/areas/pointtupper`.
5. `python3 tools/stockpiles-delta-check.py` must pass and print `land state: after`. Then
   `tools/check-all.sh --only stockpiles` must pass.
6. Land a PR that sets `EXPECT = 'after'` in `tools/stockpiles-delta-check.py`. From then on a land without the pack
   fails the row: on a rented host that means "copy the land again".

The data is not in git, so the install is a step on each host that has `data/baked` (a rented mini gets the
MacBook's land with each remote check). The site build links whole area folders, so the published site gets the
file with the next publish; Point Tupper has no offline pack. No other area, manifest key or file changes.

To take it out: before changing either file, compare the SHA-256 of `data/baked/areas/pointtupper/manifest.json`
against the `manifest.json` entry's `sha256` in `install.json`. If it matches, restore the kept `before` manifest. If
it differs (a later install edited another key), inspect the drift and remove only the `"stockpiles"` key so later
edits are not overwritten. Then delete `data/baked/areas/pointtupper/stockpiles.json`. Old manifests load no
stockpiles, and the 1884 era never loads them.

## After a Point Tupper rebake

Stage 21 writes a new manifest, so a full rebake drops the key and leaves the file: the row fails with "mixed". Add
the key again (delete the file, then run the install steps). The bake stages do not run stage 33. If a rebake
changes roads, buildings or heights near the piles, the row's remake fails with "the bake made other bytes": look at
the new pack (the `stockpiles-pictures` row), then commit it with a new `hashes.json`.

## Check rows

| Row | Where | What |
| --- | --- | --- |
| `stockpiles` | any host, also the clean clone | Committed pack and hash, land state, remake (GDAL and data/raw only), bake mask fixture, geometry rules |
| `stockpiles-browser` | a Mac with a real GPU | The piles in the game, HIGH and LOW: drawn, seated, budgets, shaders, frame cost, culling |
| `stockpiles-pictures` | a Mac with a real GPU | 24 road-level pictures (pictures only) |

Before the install the two browser rows serve the committed pack to the page through the real manifest key
(`tools/stockpiles-pack.mjs` replaces two responses; the game code does not know). After the install they read
the land. Each run prints a `DATA` line that says which bytes it drew.

## What the game draws

- Coal: a dark, lumpy skin 0.14 to 0.5 m above the drawn land, faceted, with its outline under the ground.
- Logs: each stack is a solid block (top, and walls down into the ground). A procedural pattern, no texture, shows
  logs lying across the row: discs on the walls the ends face, logs side by side on top. Up to 1,536 short stub
  logs (384 on LOW) stand out of those walls. The bake's 4 m samples smear upright sides and step the outline, so
  the game straightens the outline (1.5 m at most) and lifts edge heights towards the heights just inside.
- Three draw calls at most, no textures. Piles are drawn within 1,000 m (550 m on LOW) and seated on the land that
  is drawn. On each pass (every 350 ms) 32 fixed probe points and the next 32 points in turn are read; the whole
  pile is read again only when one of them reads another height from the drawn mesh (the land under it changed
  detail). The land draws only the tiles in view: a pile first met out of view stands on the land's own samples
  and is seated on the mesh when it is drawn (at once where a probe sees it, within some passes elsewhere). After
  that a turn of the camera does not move it or read it again. A seated pile is hidden while the land under it is
  coarser than level 6.
- Trees, canopy and grass are left out inside the baked faces only (the straightened walls stand up to 1.5 m
  outside them, so grass can stand against a wall).

Known limits: the piles have no collision (the car drives on the land under them). From the paved road the land
hides most of both piles at the game's 1.5 relief; the yard tracks give the close views. Single logs are a
suggestion, not surveyed objects. Unclear candidates (see LABELS.md) stay out.
