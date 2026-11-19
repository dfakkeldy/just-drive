# Sidewalk recipe and proof

The run table is `web/src/sidewalks-data.json`. Its positions and observations are
public-safe road stretches. The recipe reads the existing baked road, building
and prop catalogues and executes the current hand-site reservations. It never
writes `data/baked` or `data/site`.

`python3 tools/sidewalks_bake.py --work-root /isolated/output` rebuilds the three
town plans, distance rasters, sparse terrain masks, static mesh buffers and
reference tables in that work root. It never installs data. The
Python build tools need Shapely, NumPy and Pillow; the browser needs none of them.
`python3 tools/sidewalks_bake.py --check` checks the input/source fingerprints.
A road or reservation change requires a new bake. The six generated companions
go beside the area files only with the coordinator's separate data-install go.
`--check` accepts the land before that install (all six absent) or after it (all six
present with their pinned hashes) and refuses a partial install or a changed
companion; `--check-cases` proves the four cases in scratch roots.
Existing manifests stay unchanged. The generated source table
`web/src/sidewalks-assets.ts` pins each filename, byte length and SHA256.
The desktop companion keeps the old bytes; LOW carries exactly its frozen
selected graph. The tracked desktop masters are bake inputs, never runtime imports.

`node tools/sidewalks-check.mjs --mutations` uses an independent obstacle list
from the source files. It checks every road kind, through streets, graph-derived
joining sides, metre-wide narrowing, pole relocations and continuous sections,
and furniture clearance. It runs actual Three.js geometry and grass population,
sweeps the submitted slab triangles against non-planar land, checks raster-only
queries and event-only height reads, and proves safe budget handling. Use `--review-replays` to replay the historical reviewed implementation in memory
while those branch-only commits are available. The normal mutation gate does not
require unmerged history after a squash landing.

`OUT=/path/to/task-output tools/sidewalks-fix-browser.sh` measures settlement with
no injected script, response interceptor, query timer, or game hook. The external
CDP client reads the page's own `data-mmm-ready` signal every 250 ms and checks the
new document's loader identity. Each desktop and LOW case uses seven adjacent
main/main controls and seven main/current pairs, reversing block order on alternate
rounds. Two warm-ups are recorded separately. Reports keep all paired deltas,
their median and min/max spread, absolute load times, and process names/birthtimes.
A current median within the same row's control spread (or faster) passes. Use
`SIDEWALK_MEASURE_AREA=mabou` and `SIDEWALK_MEASURE_QUALITY=high` (or `low`) for one
case. Without filters the runner checks all six town/quality cases.

The earlier per-query profiler is retained as a diagnostic only: its clock calls
consume part of Grass.populate's 1.5 ms budget and can delay patch completion,
then the fixed grow-in period. The valid Port Hood experiment measured +466 ms
with query clocks but -104 ms with counts only. The independent probe-free
confirmation measured +8 ms, inside main/main's -537 to +118 ms spread. Therefore
clocked settle values are never the load-time gate.

`SIDEWALK_RUNTIME_PHASE=frames` separately records CPU and startup on the MacBook.
The 2 ms gate applies to three measured reloads; the warm-up maximum remains in
the report. The historical fresh-profile cold control against c6df652 (three alternating loads
per side, through ready plus five seconds) found median peak shared updateWorld
CPU 127.0 ms on main and 123.7 ms on current. Main's own cold spread accounts for
the isolated 4.10 ms warm-up update; measured sidewalk updates were 0.40 ms each.
Constructor startup stays within 20 ms. LOW median and measured maximum may rise
at most 1 ms over the accepted ebb0f5c reference in `tools/baseline/sidewalks-startup.json`.

The separate `SIDEWALK_RUNTIME_PHASE=proof` row sweeps the real flush walks,
inspects actual grass roots, drives the current main's car/bike into
the curb with the layer on/off, and rejects a live registered curb collision.
Set `SIDEWALK_REVIEWED_BASELINE=1` for the review-only before/fixed sweep and
pictures against `2cd5725`. Normal future live checks sweep current slabs and
capture layer-off/on pictures without that branch-only history. The check keeps
its requested raw proof and pictures outside the auto-deleted PASS scratch.
It also checks live era absence and a bad budget without stopping the game.
The default row measures loads only; the registry also includes separate frame
and live-proof rows. `SIDEWALK_SMOKE=1` is a diagnostic subset, not the gate.

`SIDEWALK_COUNT_EXPECT_PROVEN=1 bash tools/sidewalks-counts.sh` compares this tree with
itself at `?sidewalks=0` (main's page: no companion request, slab, clearing or pole
move) on the same hardware, so the row keeps its meaning after a squash merge and
never counts main's own changes as sidewalk cost. `SIDEWALK_COUNT_BASE_REF=<commit>`
compares against a separate checkout instead (cross-checkout program caches can
then differ by one depth program; the same-tree baseline has none).
Twenty-two view/mode combinations (the five original views and main's
`pointtupper-start`, explore modes only; `SIDEWALK_COUNT_VIEWS` picks a subset)
receive five fresh paired loads each, with radio
and songs off on BOTH sides. It gates render-count deltas, requires draw increases
to be attributed to the merged sidewalk meshes, and rejects added programs or
textures. Against the same tree every program delta is 0. For a cross-checkout
comparison, one approved exception permits exactly +1 standard MeshDepthMaterial
program in `highway19-far-land/desktop-mail`: instancing without instance colour,
BackSide, with the full exact cache key in `sidewalks-counts-policy.mjs`. Tree
clearing removes three shadow draws. Three.js's shared depth program cache does
not compare side, so the changed traversal compiles a BackSide variant where
main reuses its DoubleSide variant for the existing mail meshes. Wrong view,
mode, key, an additional key, a hidden removal, LOW or +2 all fail the fixture.
`SIDEWALK_COUNTS_DIAGNOSTIC=1` records one paired shader/object inventory for that
view. The raw receipt is named in the review report. No shared shadow or mail
material code changes.

It never updates `tools/baseline/frame-budget.json`. Every sidewalk functional,
count and timing row runs on Apple silicon (the MacBook or mmm-m4), labelled
`apple` in `checks-hosts.tsv` with the 18 Nov mmm-m4 evidence. Start timing rows
only on a quiet host (load1 < 20 for settle, < 15 for frames on mmm-m4): a run
whose load climbs well past that measures the neighbours, not the layer. The M4 is
faster per core than the M1 Pro that set the frame and startup references, so an M4
frames pass is a weaker bound than a MacBook pass. `sidewalks-hosts` refuses
software GL, Linux timing and MacBook-only functional routing.

The page chooses town and quality once and fetches exactly one companion.
Other areas and 1884 fetch none. The request starts early, in parallel with
`initStore`: the hash-verified companion uses the direct `readFile(base,file,true)`,
which never consults the pack index; ordinary reads retain the strict pack-index path.
Missing or corrupt optional data warns once per companion and skips the layer,
without trying another quality. So does a layer that throws while it starts or
refuses its geometry budget: the page then draws the town as main does, with no
vegetation clearing and no pole moves; any bridge parapet widening it reserved is
undone. The height worker opens last: a page that refuses it synchronously keeps
the layer and computes heights on the main thread. A refusal that arrives later as
a worker error disables the layer (one warning): it stops clearing vegetation on
tiles built from then on, Props receives no pole moves if the error came first, and
tiles already built keep their clearing until the next load.

The data must be installed before or together with the merge: the budget pins
include the sidewalk render deltas, so `budget` and `sidewalks-counts` fail on land
without the six files. Installing them first is harmless, since main never requests
them. The timing tools check a nonempty working layer
only after each measured interval, so skipping cannot create a false PASS.
Terrain pixels use a sparse
mask decoded once per tile; blades and trees use constant-time distance-raster
lookups. Height work starts only on relevant tile-load events. Cached heights
are copied when terrain selection changes. Work queues yield within the frame
budget. Slab heights include all intersections of the slab and land triangles,
plus an interior grid: the plane difference cannot peak between those probes.
The small terrain rasters are decoded before the first game frame. Tile callbacks
only look them up; a runtime allocation probe rejects the previous lazy decoder.
Main's Mabou main street (`mabou-main.ts`) has its own north sidewalk ribbon on
Highway 19, 3.75-5.35 m from the centre line; the `mabou-village` slab lies inside
that band (1032 of its 1128 m2). While the sidewalk layer is live in Mabou, the
street halves omit only that ribbon (lamps, festoons and the plaza stay), so the
street has one sidewalk; with `?sidewalks=0` or missing data main's ribbon returns.
`sidewalks-check` proves the ribbon goes and the street furniture stays.

Pole moves affect their drawing, wires and the fleet-body pole test; rail
collision openings retain the original source positions. A move applies only when
its baked `from` position still matches the source pole (1 cm); otherwise it is
skipped with one warning, so a land change without a sidewalk rebake leaves poles
in place. No sidewalk registers a physical terrain site.
Visual canopy clearing retains a separate contact canopy, so it cannot turn
brush into a different driving surface. The road and wheel-height fields stay
unchanged.

Desktop concrete joints are 24 mm dark faces at 1.5 m intervals, merged into the
concrete mesh. Clipping each parent triangle preserves its exact plane; the
joint vertices interpolate its cached top heights with a 1 mm drawing offset.
There are no extra terrain probes, meshes or private shader programs. LOW omits
the joint faces and retains its previous compiled buffers. The per-area limits
are two meshes, 14,000 desktop triangles and 6,000 LOW triangles.

The browser calculates envelopes in a self-contained worker held in the app
bundle. It copies only relevant loaded mesh grids. Small result batches feed the
bounded main-thread copy queue. There is no separate worker download. The check
executes the exact Blob program in real Node workers, including its minified
form, before the real-page gate. Profiling hooks use fixed argument lists: they
do not allocate an argument array for every blade/tree query.

At landing, merge main and generate count pins by script
(`python3 tools/sidewalks_pins.py "$(git merge-base HEAD origin/main)"`) as main's current pin
plus the proven per-row delta, for both `frame-budget.json` and the zero-margin
traffic-on `frame-budget-traffic.json`. Read main's pins from the merged commit,
not from `origin/main`: the shared clone's `origin/main` moves when another
checkout fetches. Do not use `--raise`, hand edits or absolute values from another
host. B′ adds exactly one request on the 28 modern Mabou rows and the two Point Tupper
rows, and zero on the
four West Bay quarry rows; it adds no render cost to the previously proven
sidewalk mesh deltas. Frame-ms pins stay unchanged. Each native timing start
requires healthy capacity and at least 900 idle seconds. Stop the owned browser
and server immediately if input returns. The paused/interior branch performs one bounded sidewalk update after
paused terrain work; the mock queue regression rejects removal of that call.

Height dependency membership includes the complete slab and grass strip at every
terrain level. It is separate from the original drawing membership. On a dependency
selection change, the bounded queue queries the indexed current primary terrain
coverage at each occupied half-tile cell. The worker resolves each corner/probe
against that active level; a coarse neighbour cannot choose a fine point's height.
The shared-top cache replaces old owner contributions so genuine coarsening also
lowers the section. Draw ownership, mesh topology, indices and materials remain
unchanged. Baked one-sided probes bound both sides of mixed-LOD seams, using the
same Float32 footprints that are actually drawn. `sidewalks-selection-check.mjs`
checks shipped jobs196/407, dense interiors, coarsening, shuffled arrivals in all
three areas/qualities, all sampled dependencies and three fault mutants.

The historical review-r2 proof compared e701b06 against 69964fc: all 20 rows
matched on all seven counts and program keys. B′ now intentionally adds the
selected-companion request, so that old zero-request command is not its gate.
The previous timing is archived;
new settle, frames and cold control are required after this outdoor-path change.

Height coverage has its own primary-terrain notifications, including off-screen
partial parents and empty sea quarters. They never enter the draw-owner list.
Cells with no active land use the usual loaded-land fallback; unseen coverage
still waits. An owned section can use complete mixed heights without waiting for
a uniform-level cache. Count runs keep a named raw output even on a clean PASS.

The 18 Nov checkpoint merges main `41c0e6ff` (Port Hawkesbury #213, Judique
#215/#221 and Mabou main street #217 land included). Budget pins (whole-frame and
traffic-on) are exactly that main's pins plus `tools/baseline/sidewalks-count-deltas.json`
for each of the seven counts, written by script. The 22 measured rows come from five
exact same-tree paired loads each on mmm-m4 at d74d0b50: the Mabou views add the
rebaked slabs (desktop 9412, LOW 4816 triangles, +2 calls/geometries where drawn);
`pointtupper-start` desktop -8 calls, -23807 triangles, -7 geometries (roadside trees
cleared beside the slabs) and phone -1 call, +1290 triangles, +1 geometry; every
modern Mabou/Point Tupper row adds one request. Since #12 made the finish pass the desktop
default, `new-player-start/desktop-explore-truck` is -2 calls, +7806 triangles (was -5,
+5680), re-measured on the M4 at 261dd03c (PR #25). The twelve unmeasured rows
(animal-home, works-yard, the two West Bay quarry views) keep their request-only or
zero deltas. The proven-delta gate checks every pair against that table. Lost-SSH measurements
remain incomplete evidence; only a clean remote-check completion releases timing.
The merged timing tools use the landing defaults, including the Blender car,
without the earlier `car=code` override. Main's bus, night look and era door remain.


B′ removes every packed JSON module import from the flat app. The diagnostic `sidewalks-flat-audit` row builds the working tree;
`SIDEWALK_REVIEW_REPLAYS=1` adds the old-history builds `0e798a9` and `b7a7129`, which a
fresh-history clone does not hold. Likewise `sidewalks-probe-fixture` replays older
`main.ts` sources only with `--review-replays`. The permanent
`sidewalks-flat-site` row executes the real public Vite command and boots all
three towns at desktop and LOW, checking exact HTTP app bytes, page errors and
sidewalk failure warnings. `sidewalks-app-size` limits gzip growth against clean
main to 32768 B and rejects inlined payload sentinels. The original inline design
failed all six public boots with a TDZ; dev-server timings never proved that
published path worked.

Work-root request/flat checks use explicitly labelled data fixtures. The
`sidewalks-installed-browser` and `sidewalks-installed-flat` rows use actual
installed files with no data interception. `sidewalks-inventory` builds the real
site and checks its READY/area-identity guard and complete source file lists.
It verifies all six companion hashes, exactly both Mabou companions in each
mail/just offline inventory, exact totalBytes, and five omission/corruption
mutants. Existing `site-offline`, `pwa-build`, `pwa-build-mutations` and `site-http`
rows cover the worker, shell and HTTP paths. No publish, PWA, Vite configuration
or packer change is part of B′.

The site adds six data files (7967722B). The Mabou offline inventory adds two
files (1935894B) for both qualities; unopened towns stay online-only. The current
published private artifact is Mabou-only, verified from the owner's version 21
file list. Its existing terrain packer picks up only the two Mabou companions.
The owner uploads artifact files at publish time.

The bake guard derives the primary checkout from Git's common directory. It
protects that checkout's web/, data/baked and data/site even when the current
worktree uses a private baked overlay. Python calls the pure guard before
bake or any output directory/file creation. `sidewalks-work-root` runs path
checks and a sandboxed production Python entrypoint with all writers stubbed;
removing primary protection or the pre-write call makes those checks fail.
