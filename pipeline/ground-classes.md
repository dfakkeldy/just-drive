# Open ground classes

`pipeline/21_bake_terrain.py` makes the baseline cover. The explicit follow-up
stage reads that baseline and pinned source snapshots, then writes a separate
work-root package. It does not bake heights or modify the source area.

```sh
python3 pipeline/ground_classes.py --data-root "$MMM_SOURCE_ROOT" \
  --work-root "$MMM_SOURCE_ROOT/data/work/bakes/ground-classes" --area all
```

The source root contains the existing `data/raw`, `data/baked` and retained
phase-1 derived-index snapshots. Paths in `pipeline/ground_sources.json` are
relative to that root. GDAL, NumPy, Pillow and Shapely are pipeline dependencies;
the web client receives none of them. The script refuses a baked/site output
path. A changed pinned source or canopy tile fails the bake.

Each area's package has three runtime files and one review receipt:

- `cover.png`: the existing RGB layout; B is still one class byte.
- `cover-ground.bin`: compact class-6/8 row runs for CPU readers.
- `manifest.json`: original terrain metadata plus the class legend and run file.
- `promotion.json`: output/input hashes, areas, clearing per site and file bytes.
  This receipt stays in the work root; it is not a runtime asset.

Parent integration reviews the receipt before promoting the three runtime files.
This stage does not perform promotion. Rebuild the baseline cover with the normal
terrain pipeline before a new full ground bake. The bake refuses a manifest whose
cover already has `ground` or `classes`: a promoted cover would carry old class
6/8 cells into the new result after a source drops them.

## Rules

Classes 0–5 retain their original meaning. New classes are 6 confirmed mineral,
7 natural rock/cliff, 8 open wetland, 9 wooded wetland, 10 beach/dune, 11 utility
cut, 12 narrow rail/trail bed and 13 low brush/heath. There is no paved class.

Mineral boundaries are envelopes. A 10 m cell must be bare in both summers, or
bare in one summer with no finest-available baked canopy sample above 2 m.
Every integer node and shared boundary of the source cell is sampled. Missing
canopy does not confirm a single-summer cell. Neighbour filtering only removes
support. A displayed 5 m cover cell must have support in every 10 m source cell
it overlaps; the resample cannot grow evidence to cover a truncated image edge.
The complete clearing-cell footprint must also fit inside the mapped envelope,
so a root near its edge cannot be removed by a centre-only raster decision.
Unconfirmed parts of the envelope retain the old class.

Priority is authored sites, paved reservations, existing open water, new classes,
then old classes. DAPA41/DASA41 belong to the separate paved layer. They retain
the original RGB bytes here. Existing water membership and RGB bytes also remain
unchanged. The 51 stale-forest candidates are not clearing inputs.

Class 8 follows the approved open-wetland policy: no trees and low plants. A CNWI
bog, fen or marsh becomes class 8 only where every overlapped 10 m cell has a
known baked canopy of 2 m or less (the same 1 m sampling as the pits). Treed or
unmeasured cells in the polygon, such as black spruce on a bog, become class 9.
`promotion.json` reports them as `cnwi_wooded_m2`. Class
9 keeps tree roots, shapes and colours. Its floor darkens; nonforest cells retain
the old shader's effective tree-colour shares in R/G. A rail corridor is low brush
except for a five-metre bed along an actual mapped line. No rail models or road
geometry are generated. The Canso bed respects the existing aligned trail.

## Shared sites

Use the canonical `pipeline/hand_sites.py` and `tools/paved-sites.mjs` shared with
`paved-open`. Do not create another coordinate recipe. The paved layer keeps its
eight sites (`records`, `source_files`). The ground bake uses the `ground` scope:
`ground_records(root)` and `ground_source_files(root)` reserve every
`web/src/*-site.ts` module, which adds the yard dog, Judique village, Port
Hawkesbury, the airport and Mabou main street. `tools/ground-classes-check.py` fails when a new
`*-site.ts` file is not on that list. The yard dog is reserved wherever its road
placement holds; the game's mail and house guards can only drop it.

Geometry is absolute EPSG:2961. It comes from the actual TS site constructors and
mine endpoint predicate. Consumers choose their raster edge policy. The ground
consumer protects every displayed cover cell touched by a reservation.

## Client and phone cost

The title/setup awaits the small CPU run file before terrain or individual trees
can build. Both tree representations use the same class lookup. Cleared canopy
nodes cannot grow back through the terrain's averaging window. Wooded wetland is
not a clearing class. Ground class 6 adds a `Surface.mineral` hint; the vehicle
reuses gravel feel off-road, while mapped roads and decks keep their priority.

`GROUND_CLASSES` is enabled by manifest metadata for land, mirrors and desktop
grass. Legacy programs remain byte-identical after preprocessing. New ground
programs are separately pinned. The implementation adds no GPU texture, geometry
layer or render pass. Phones do not read cover.png back into an RGBA CPU image.
The CPU file is fetched beside packs.json because root files are not terrain-pack
entries. Existing site/offline inventory builders already retain root files.

GC01 starts with four magic bytes and little-endian u32 width, height and record
count. Each eight-byte record is u32 flat start, u16 run length, u8 class and u8
zero padding. Runs are sorted, non-overlapping and contained in one row. Only
6/8 appear. A row index bounds each lookup's binary search. Other classes need no
CPU copy; their paint remains in the original cover texture.

When merging the paved and ground tree filters, combine both predicates in the
existing root loop. Do not add a second tree pass.

## Checks and rehearsal

```sh
python3 tools/ground-classes-check.py --mutations \
  --data-root "$MMM_SOURCE_ROOT" \
  --work-root "$MMM_SOURCE_ROOT/data/work/bakes/ground-classes"
node tools/run-node-check.mjs tools/ground-cover-check.mjs --mutations
node tools/ground-canopy-mutations.mjs
node tools/site-title-check.mjs --mutations
```

The per-area check compares every decoded CPU clearing cell to cover B. It also
checks the class domain, site/paved/water priority, hashes and output allowlist.
Production Terrain, Trees and Vehicle fixtures cover canopy, retained trees and
gravel selection. Mutants remove each important guard. The check inventory has
separate baseline and mutation rows.

`tools/check-ground-browser.sh` is an optional serial native-GPU rehearsal. It
uses `GROUND_VIEWS`, `GROUND_WORK_ROOT` and `OUT`, or their local work-folder
defaults. The server overlays only the three runtime files and reads all other
game data from the normal area. `groundBefore=1` selects the unchanged baseline
inside this rehearsal server only. It is not a product feature flag.

No source Sentinel bands or aerial images are used by this stage. Only the
derived class bytes and metadata enter its runtime package. CNWI and modified
Copernicus attribution appear in `LAND_CREDITS`; the original OGL-NS credit stays.
