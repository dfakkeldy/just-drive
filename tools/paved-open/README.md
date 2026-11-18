# Open designated pavement (paved lots)

The layer is on by default in every modern area whose baked manifest lists
`paved` (the land delta below adds that key). `?paved=0` turns it off; `?paved=1`
forces a load, for previews of a work bake. An area without the key makes no
paved request at all, so the game is unchanged until the main thread installs
the delta. The 1884 era never loads it.
The source is NSTDB Designated Areas, Socrata dataset `ty4r-gcnk`, codes `DAPA41`
(paved parking) and `DASA41` (paved storage). The source sheet photography dates
from 2003–2005. It is a mapped-lot layer, not a current survey of all asphalt.

The title card adds this linked credit whenever the layer loads (so by default once installed):
“Contains information licensed under the Open Government Licence – Nova Scotia”.
The link is <https://support.novascotia.ca/services/open-data-portal-licence>.

## Fetch and bake

With GDAL, Shapely 2, numpy, Node and the web dependencies installed:

```sh
python3 pipeline/32_bake_paved.py --paved --fetch --root /absolute/project
```

Raw geometry goes to `data/raw/paved-open/ty4r-gcnk/`. The fetch has a 200 MB total
cap and records each query, dataset, download date, row update date and SHA-256.
Repeat without `--fetch` to use those exact bytes. `--area` can select an area.
`--source`, `--output` and `--corrections` can select separate work inputs.
The output must be empty and must resolve under the real project's `data/work/`.
Nothing is promoted by this command. For a review worktree, set `--output` under
that worktree’s `data/work/` and set `PAVED_WORK` to the resulting bake directory
when running checks. Inputs remain in the real data root.

Each `data/work/bakes/paved-open/<area>/` contains:

- `paved/index.json` and sparse 128 × 128 class tiles (`.r8`, values 0 unknown, 1 asphalt, 2 owner gravel lot).
  The index lists owner stall rows under `stalls` when there are any.
- `promotion.json`, the exact tile/index source and destination paths, sizes and hashes.
- `bake.json`, every input hash, cut areas, omitted lots and tree conflicts.
- `lots.geojson` and `painted.geojson`, the clipped source and final vector geometry.
- `surface-corrections.json`, road observations for the separate road-surface pipeline.
- `driveway-road-handoff.json`, selected 8 m kind-2 mouths, with `apply: false`.

Lot eligibility uses the open NRCan HRDEM DTM/DSM: median slope above 8% or
more than 20% of cells above 2.5 m nDSM withholds a lot. The bake records every
lot’s measurements and reasons. Incomplete height coverage also withholds it.
The tracked `pipeline/paved-rules.json` contains all footage and filter numbers;
the mutable thread brief is not an input. Provenance paths are repo-relative,
recipe records include Git blob IDs, and each role has a path allow-list. A
hash-only historical payload deny-list also catches renamed byte copies.

The lattice matches the area's real manifest. Polygons lose building footprints
plus 1 m, water polygons plus 1 m, and existing road shoulders. Roads retain their
existing paint. The owner's 12–13 November footage supplies apron rules. At a gravel/paved
junction, a 20 m ribbon follows the gravel arm beyond the paved edge and flares
to 12 m at the mouth. A mapped provincial `DRIVEWAY` mouth emits an unapplied 8 m road-kind handoff
with probability 0.16 on asphalt, 0.21 on explicitly tagged patched asphalt, and
0 on gravel. Driveway mouths are not rasterized. The road bake owns kind-2
paved segments; this branch never reclassifies every driveway or paints two-tracks. The hash uses the driveway geometry and endpoint, independent of
feature order, IDs or households. Existing catalogs have no patched-asphalt tag,
so their paved mouths use 0.16; the 0.21 path is tested for later tagged input.
The joins use actual baked road half-widths so they meet the existing paint.
Only selected short gravel junction mouths receive the asphalt overlay. Main
paved lane paint remains unchanged; no whole road is resurfaced or widened.

A lot that touches a hand-built site's box plus 2 m is withheld in full and listed.
The shared `pipeline/hand_sites.py` API executes the current site classes for
their exact `Site.box` / `contains` reservations through `tools/paved-sites.mjs`. This includes
yard, church, home, porch, mine, fishing, coast and quarry reservations. The mine
uses both possible portal footprints. The same reservations apply in overlapping areas. The shared API has no implicit
buffer: `yard(root)`, `home(root)`, `church(root)`, `porch(root)`, `fishing(root)`,
`coast(root)`, `quarry(root)` and `mine(root)` return Shapely geometries in absolute
EPSG:2961 metres. `polygons(root)` returns the eight named geometries;
`records(root)`, `source_files(root)` and `catalog_inputs(root)` support provenance.
`clear_cache()` refreshes constructors/catalogs in a long-lived Python process.
The quarry reservation includes its southern apron to northing 5061600. The mine
unions both possible portal reservations. These reserve full site ownership,
including transitions, rather than the smaller visible paint contours.

The renderer uses its existing ground and grass materials. A 640 × 640 RG8 atlas
(red asphalt, green gravel) uses 819,200 bytes without mipmaps. No mesh or draw call is added. Class bytes are
expanded to 0/255 for the GPU so Metal can filter a continuous edge; the painted edge is about 1 m
wide, wobbled by noise, with a narrow crumbled-stone rim outside asphalt. Grass is
suppressed on lots, and tufts within about 3 m of a lot are cut short (a mown verge), so a lot
shows from the road. Trees wait for the matching class tile and reject
roots in a paved cell or its one-cell margin, before allocating instances. Those
CPU mask bytes are released after planting. Failed class reads use the existing
tree loader's retry path. No far tree is planted before its pavement class is known.

## Owner corrections

Optional default: `data/raw/paved-open/corrections.json`. Coordinates are EPSG:2961
metres. No lot or person names are required. Supply a stable ID, area, source and date.

```json
{
  "version": 1,
  "epsg": 2961,
  "features": [
    {
      "id": "survey-lot-001", "area": "mabou", "kind": "lot",
      "surface": "paved", "source": "owner GPS survey", "date": "2026-11-14",
      "geometry": {"type": "Polygon", "coordinates": [[[0,0],[20,0],[20,20],[0,20],[0,0]]]}
    },
    {
      "id": "video-road-001", "area": "mabou", "kind": "road",
      "surface": "gravel", "width": 5, "source": "owner road observation", "date": "2026-11-14",
      "geometry": {"type": "LineString", "coordinates": [[0,0],[100,0]]}
    }
  ]
}
```

The example coordinates are synthetic. `enabled: false` disables an example
before its geometry is read. `tools/paved-open/corrections.example.json` has four
disabled road-bake examples from the public-safe brief. They apply nowhere. A paved lot adds a polygon. A gravel lot
cuts asphalt away and is baked as its own class (2), painted as packed grey-brown gravel. Both pass through the same
site, roof, water and road cuts.
A lot with `"meetsRoad": true` (Point Tupper delta) runs to the road edge: it loses the same sites, roofs and water, but of
the roads only the ribbons themselves (a railroad keeps 1.1 m more); the shader drops the gravel shoulder under it.
A lot with `"coversTracks": true` as well (Judique lots delta; it needs `meetsRoad`) loses only the ribbons of the main roads
(kinds 1–2) and the railroad: the tracks and gravel lanes inside it are painted as the lot. Both flags work for
paved and gravel lots.

A stall row (`"kind": "stalls"`, `"surface": "paved"`) is a two-point LineString along the aisle side of a row, with
`depth` (3–7 m) and `spacing` (2.2–3.5 m). The stalls lie to the LEFT of the line's direction, a painted line every
`spacing` from the first point; the length must hold whole stalls. A row must lie on its asphalt (90 % of its area),
or the bake fails. The game paints the eight rows nearest the car as faded white lines; there is no extra draw, mesh
or request.
A road accepts `paved` or `gravel` and a full width in metres. Its ribbon plus 2 m
is excluded from lots. The observation is exported verbatim for the road bake;
this lot layer does not change the existing road's material or width. No new
code is needed to ingest later lot traces or road observations in this format.

## Review without promotion

```sh
node tools/paved-preview.mjs /absolute/project/data/work/bakes/paved-open 54781
```

This dev-only server serves pavement from the work root. Other assets use the
normal Vite paths. It never reads the old pavement bake for these requests.
`tools/check-paved-open-browser.sh` runs the serial native capture and GPU fixture.
Set `PAVED_WORK`, `OUT`, `WEB_PORT` and `CDP_PORT` to isolate a run.

```sh
MP_PORT=48761 tools/check-all.sh --changed --quick
node tools/play-flags-fixture.mjs
python3 tools/paved-open-maps.py --work /absolute/work/bakes/paved-open --out /absolute/pictures
```

The `paved-pipeline` and `paved-web` rows kill geometry, edge, credit and tree
mutants. `paved-open-inputs` requires all six real work bakes, checks every recorded
input hash and rejects prohibited paths, including symlink aliases. None of the
new bake, audit, map or capture steps uses intensity, an old mask, OSM pavement or
satellite land cover. The older research helper scripts are not this bake's inputs
or verification steps.

## Round-2 checks and finish

The seeded driveway choices are synthetic game choices. The footage supplies
aggregate rates; it does not label the material of any particular driveway.
A handoff carries the driveway halfWidth (currently 1.5 m), starts beyond the
receiving pavement edge, and extends for 8 m. The consumer must use that width,
not the 3 m kind-2 default. Match the __08 source to the road bake's __05 lines
within the recorded 7 m snap tolerance. Nothing in the handoff is applied here.

The input and loader rows have no private worktree default. With the standard
links, pipeline/paved_work.py builds a missing cache below the real project's
data/work/bakes/paved-open-checks/<recipe-and-baked-content hash>. A completed but incomplete cache
fails. An explicit missing PAVED_WORK fails. Inputs are still validated against
the running checkout, so a cache cannot hide stale recipe or data hashes.

The lot filter excludes the same building footprint plus 1 m used by the paint
cut before it measures slope and tall cover. The browser colour row calls the
area-mean check (40th–90th linear luminance band), not single pixels. The material
edge test executes the real GLSL noise over 64 m fields at four places, desktop
and LOW, sampling pairs 1 cm apart. It rejects the hard-patch and overbright
mutants. Canopy checks include 12, 20 and 25 m.

The cache key hashes the six baked manifests, roads and building catalogs, plus
all tree audit tiles named by those manifests. Including prospective tree tiles
covers pavement geometry that moves after a catalog or recipe change. A small
fixture edits each baked input role and requires a different key. The full input
audit separately hashes the HRDEM sources. Recipe/site edits or baked promotions
trigger a fresh six-area work bake, which normally fits the 600-second row budget.
The exact reviewed drop sets are pinned: PT 13, 30, 46, 53, 63, 64, 75; none elsewhere.

## Land delta and default-on (initial paving delta)

Only the main thread installs land. The builder delivers a delta made from a
six-area work bake, a committed receipt and a check that accepts before or after:

```sh
python3 pipeline/32_bake_paved.py --paved --root /absolute/project --output /absolute/project/data/work/bakes/paved-open-1212
python3 tools/paved-open/patch.py make /absolute/project/data/work/bakes/paved-open-1212 /absolute/project/data/baked /new/folder/outside/data
python3 tools/paved-open-land-check.py --land                      # before or after; never mixed
python3 tools/paved-open/patch.py install /new/folder/outside/data /absolute/project/data/baked   # main thread only
python3 tools/paved-open-land-check.py --land                      # now "after"
```

`make` refuses a work bake whose baked inputs (manifest, roads, buildings, tree
tiles) changed since it ran, any forbidden input path, and any result that differs
from `tools/paved-open/hashes.json` (`--record` writes a changed receipt into the
new folder for review; it never edits the committed one). `install` copies only
new `paved/` files, refuses to replace a different file, and adds the single
`paved` manifest key to each current manifest by a temporary file and a rename,
like the cemetery bake: other bakes own every other key. A later terrain bake that
rewrites a manifest drops the key; re-run `install` (it is idempotent) or re-bake.
The receipt also pins every baked input the bake read (roads, buildings, tree
tiles, and the manifest lattice fields origin/mid/size/tile/village/buildings/trees, so
other bakes' keys never count). `install` refuses stale land, and the land check
fails installed tiles that sit over changed roads, roofs or trees (before the
install it only warns). After such a change: re-bake the pavement, review, and
record a new receipt. `install` also writes the receipt's corrections file into
`data/raw/paved-open/` (keeping the old one as `corrections.json.before-1212`). Rebuild packs/site in the normal
delivery path. The install PR sets `EXPECT = 'after'` in the land check.

The default-on gate is pinned by `paved-web` (`OPTIN`, `NOOFF` and `NODATA`
mutants), the credit by `site-title`, and the receipt by `paved-open-land`.

## Judique lots delta (Judique lots delta)

The owner (17 Nov): the store lot is gravel, the other village lots asphalt; parking lots must read as lots.
`tools/paved-open/judique-lots-corrections.json` holds only the Judique entries that change or are new: the store lot
(`judique-brief-lot-2`) becomes gravel, meets the road and reaches the mailbox bank; the music centre lot (`-lot-4`) is
enabled and meets Keltic Drive; the church lot and driveway (`-lot-5`) is added, meets the road and covers its own
tracks; five stall rows (`judique-brief-stalls-1` to `-5`) mark the community centre and music centre lots. Shapes come
from the baked roads and footprints, the village model and the open HRDEM surface (the church lot is the flat, open
ground between the driveway loop and the church); none is traced from imagery.

It installs after Point Tupper delta (Port Hawkesbury). `judique_lots.py compose` puts these entries into the live (post-Point Tupper delta)
corrections file: an entry with the same id is replaced in place, new ones are appended, and every other entry keeps
its bytes (compose refuses a file that does not re-serialise to itself). `judique_lots.py` replaces only Judique's
`paved/` and its manifest key (the initial paving delta maker also accepts class 2 tiles). The other five areas bake tile for tile
as the Point Tupper delta land; only their index metadata would differ, so they are not reinstalled.

The checked-in receipt authenticates the prepared Judique delta. For a fresh bake,
compose the corrections on the Point Tupper land, bake Judique, and record the new
receipt. Changes to provenance affect the corrections mirror and bake hashes.
Review and commit the generated receipt before verifying or installing that delta.

```sh
python3 tools/paved-open/judique_lots.py make <bake-root>/data/work/judique-lots/judique /abs/project/data/baked /new/folder --record
```

For a prepared delta with a committed receipt:

```sh
python3 tools/judique-lots-check.py --land --delta /prepared/folder
python3 tools/paved-open/judique_lots.py install /prepared/folder /abs/project/data/baked
python3 tools/judique-lots-check.py --land
```

The install refuses before its first write: a linked `data/baked`, a backup folder already in the way, land before
Point Tupper delta, stale or unknown land, and a corrections file that is neither the post-Point Tupper delta one (that composes to the delta's)
nor the delta's own. A run cut short at either rename is finished by running it again. It keeps the old folder in
`data/work/paved-before-1219/` and the old corrections file as `corrections.json.before-1219`. To revert, move that
folder back to `data/baked/areas/judique/paved`, restore the Point Tupper delta manifest key (`tiles: 32`) and the old corrections
file. `tools/point-tupper-delta-check.py` and `tools/paved-open-land-check.py` read Judique's index file and the corrections file
from this receipt once it is installed. The install PR sets `EXPECT = 'after'` in `tools/judique-lots-check.py` and
`EXPECT_1219 = 'after'` in `tools/paved-open-land-check.py`.
