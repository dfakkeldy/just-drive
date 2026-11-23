<img src="assets/icon.svg" width="64" height="64" alt="">

# Mabou Mail Madness

Source and issues for Mabou Mail Madness and Just Drive are on [GitHub](https://github.com/dfakkeldy/just-drive).

Created in [T3 Code](https://t3.codes).

## Licence

The source code in this repository, with its documentation, is under the
[MIT licence](LICENSE).

The MIT licence covers **only the code and its documentation**. The material below
keeps its own terms, and so does any land or geometry derived from it. Anything
else in the repository that is neither code nor documentation is not licensed
for reuse unless a row below says otherwise.
The game shows the land and music credits on its title card and About pages.

| Material | Where it is | Its terms |
| --- | --- | --- |
| Elevation, trees, building shapes and Point Tupper industrial height samples | Natural Resources Canada, High Resolution Digital Elevation Model. Fetched by `pipeline/`; Point Tupper industrial samples in `web/src/pt-industry-data.ts` | Open Government Licence – Canada |
| Roads, water, building locations, forest types, Town of Port Hawkesbury municipal boundary and Point Tupper industrial/marine coordinates | Province of Nova Scotia. Fetched by `pipeline/`; Point Tupper coordinates in `web/src/pt-industry-data.ts`; Town of Port Hawkesbury boundary in `web/src/port-hawkesbury-boundary.json` | Contains information licensed under the [Open Government Licence – Nova Scotia](https://support.novascotia.ca/services/open-data-portal-licence); the provincial intensity layer is under the Nova Scotia Unrestricted Data Use License |
| Property-line map images | Loaded at run time from the province's map service by `web/src/property-lines.ts`; not in git | Restricted Map Services License – NSPRD, with the attribution shown in the game |
| Some building outlines, road details, and Point Tupper marine pier outlines and switchyard transformer positions | OpenStreetMap. Fetched by `pipeline/`; Point Tupper coordinates in `web/src/pt-industry-data.ts` | © OpenStreetMap contributors, Open Database Licence |
| 1884 places and residence counts | Transcribed by hand from Geological Survey of Canada sheets 14 and 16 (Hugh Fletcher, 1884) and the A.F. Church and Co. map of Inverness County (1884), into `web/src/eras/mabou-1884-trades.ts` and `web/src/eras/mabou-1884-density.ts` | Facts from the 1884 maps. The map scans come from the David Rumsey Map Collection, are not in git and keep that collection's terms |
| The generated 1884 layout | `web/src/eras/mabou-1884-layout.ts` and `tools/era-density-layout.json`, made by `tools/era-density-generate.mjs` from those counts; the house positions are invented | MIT, with the code |
| Judique 1884 places, road names and residence counts | Printed labels and road names transcribed from Geological Survey of Canada sheet 19 (Hugh Fletcher, 1884), using the reviewed georeference of that sheet; residence symbols counted on the A.F. Church and Co. map of Inverness County (1884). Into `web/src/eras/judique-1884-trades.ts`, `web/src/eras/judique-1884-density.ts` and `web/src/eras/history-road-names.ts`. Printed person names are left out | Facts from the 1884 maps. The scans come from the David Rumsey Map Collection (CC BY-NC-SA 3.0), are not in git, and no scan pixels are used |
| The generated Judique 1884 layout | `web/src/eras/judique-1884-layout.ts` and `tools/era-density-judique-layout.json`, made by `tools/era-density-generate.mjs` from those counts; building and house positions are invented | MIT, with the code |
| Notes on what the real place looks like | `pipeline/observed_styles.json`, written from the author's own drive video | Not licensed for reuse |
| Radio music | `data/audio/`; not in git. Each song's credit is in `tools/radio_stations.json` | The `licence` field of that song's credit. The author's own songs are not licensed for reuse |
| Screenshots of the game | `assets/about/`, `assets/pt-industry/` and other feature folders under `assets/` | Not licensed for reuse |
| 3D models | `web/public/models/*.glb`, made by the scripts in `tools/blender/` (the scripts are code, under MIT) | Not licensed for reuse; the car and the dog are modelled on real ones |
| The names "Mabou Mail Madness" and "Just Drive", and the game icon | `assets/icon.svg` and the app icons made from it | Not licensed for reuse |

The engine is [three.js](https://threejs.org) (MIT licence), installed by `npm ci`.
The other packages in `web/package-lock.json` keep their own licences (MIT,
Apache-2.0, ISC and BSD-3-Clause).

## Airport drag races

In Point Tupper, open **Places** (L on a keyboard) and choose **Port Hawkesbury Airport**.
Select **Stage** in the left lane and wait for green. Enter or Y / Triangle also stages the car.
Race the pace car over 402 m in the car, pickup, side by side or dirt bike. The result shows reaction time,
elapsed time and trap speed. The game saves the best elapsed time for each vehicle on this device.

To start there from a link, use `?area=pointtupper&start=airport-drag`.

## Tools

The scripts run on Linux (the Linux server) and on macOS. The land (`data/`) is not in git: the bakes make it from
public survey data in `data/raw/`.

Before a PR, run `tools/check-all.sh --changed`; add `--quick` on a busy machine.
Then run the touched feature's browser rows with `--only`. Run
`tools/check-all.sh --full --browser` once before a risky merge.
`tools/check-budget.sh --phone` is the pre-PR budget check for a change that can
alter what is drawn.

The default mode runs **NO browser check** and includes every other CPU check.
The four costly stand-in start-up proofs run only with `--full`, or when
`--changed`/`--for` selects a starter or their own inputs. Browser rows run one
at a time through the existing starters and machine-wide slots.

`--list` shows the selection, last measured seconds and an estimated total.
`--for tools/phone-ground.mjs --list` shows helper coverage from static imports
and wrapper commands. Web source/config changes select the ordinary CPU rows.
Prose and housekeeping print `NO CHECK NEEDED`. Other uncovered paths print
`NO CHECK COVERS`; selected checks still run, then exit 2 unless a check failed.
Failed checks retain their output folder. One interrupt prints the partial
table and exits 130. See [the inventory notes](tools/checks-README.md).

GitHub CI (`.github/workflows/ci.yml`) runs `tools/check-all.sh --ci --full --jobs 4` on every PR
and on `main`, in a clean Ubuntu clone with no `data/`. It does not replace the
local runs: rows that need the land or the Mac SKIP there and still run here.
A CI pass with skipped rows proves only the rows it ran.

Use the Mac for pictures, pixel pins and rows marked `mac-only` in `tools/checks-hosts.tsv`.
Use Linux for portable browser rows and the default CPU suite.
The rented Mac can run any row while it exists.
Run `tools/remote-check.sh user@check-host --only tsc jump picture-first` from your checkout.
Put your SSH aliases in `tools/remote-hosts.local.tsv` using the columns in
`tools/remote-hosts.tsv`. See the inventory notes for host setup.

The single-check commands remain useful for focused work:

| Job | Command | Result |
|---|---|---|
| HUD text and writes | `node tools/hud-text-check.mjs` (add `--mutations`) | player readout, keys hide after a minute, diagnostic FPS in `#hud[data-fps]`, one write per changed string, no DOM text reads |
| Phone HUD and throw help | `node tools/mail-help-check.mjs --mutations`; `node tools/phone-mail-hud-check.mjs` | real Mail/Props hit rates, frozen help-off bytes, due-only bounded aim at actual openings, sloped frame-rate and ordered-contact regressions, eight mutants; settings and hint lifecycle |
| Phone HUD in a browser | `VITE_MP=1 HUD=1 RUN=phone-hud-browser.mjs VIEWS="phone\|x=1" tools/yard-shots.sh 844 390` (set `OUT`) | twelve phone cases in mail and both drive-around brands, multiplayer and bike; clear portrait/landscape bands, thumb reach, PULL, standalone safe-area clearance, PNGs and rectangle JSON |
| Short portrait controls | `node tools/phone-controls-layout-check.mjs --mutations` | production planner/writer, 20,928 portrait/landscape size/hint cases including the full browser inventory; shared geometry oracle, native safe-area lifecycle and six mutants |
| Preview work | `node tools/mail-preview-cost-check.mjs --mutations` | frozen 5d678ed counters and Stage 2 opening flight/cue digest on Mabou mailbox positions; corridor filtering, exact cache and three mutants |
| Settings toggles | `node tools/settings-toggle-check.mjs` (add `--mutations`) | frozen old/new row DOM, state, callbacks and storage parity across saved/URL choices, blocked storage, phone/host/era and missing targets; four in-memory mutants |
| Packed terrain store | `node tools/store-check.mjs` (add `--mutations`) after any change to `web/src/store.ts` or `tools/pack_terrain.py` | real packer bytes, shared requests, 14-pack LRU, retries, index bounds, a pack shorter than its index, and plain fallback |
| Vehicle nits | `node tools/vehicle-nits-check.mjs` (add `--mutations`) | washboard/mixed Float64 state and draw-count digests, full spec JSON, injected stream parity and deep freeze. For a deliberate change to driving: run `node tools/vehicle-nits-check.mjs --record` on the new code, paste the goldens with the commit SHA and one line that says what changed and why; a reviewer must see that line. Recording prints only and refuses dirty bundle inputs. |
| Fixed harbour lights | `node tools/run-node-check.mjs tools/lighthouses-check.mjs --mutations`; `RUN=lighthouses-browser.mjs tools/yard-shots.sh 1280 720` | source distance and dry baked land, actual instance bounds and clear beacon sight lines, nine mutants; Mabou and Port Hood at two sizes by day/night. Unresolved lights remain in `tools/lighthouses-sources.md`. |
| Type check | `cd web && npx tsc --noEmit` | exit code |
| Whole-frame budgets | `tools/check-budget.sh --phone` before a PR that can alter what is drawn; `tools/check-budget.sh` for all modes | exact draw, triangle, GPU-upload and player-asset ceilings; about 90 s phone / 220 s full |
| Terrain lifecycle | `node tools/terrain-lifecycle-check.mjs` (add `--mutations`) | one driving build after 6/20 simultaneous reads; 48 ms paused / 24 ms burst budgets; real 1884 `era-burst` audits both contact-source modes at 800 fixed stop points plus 400 distant LOD points after every update, with an independent finest-first oracle, selection-set and removal-box checks; three era mutants plus 31 lifecycle mutants each report their killing scenario; real lap/3 km reads, retention, disposal and delayed tree roots; main `883363c` goldens replace historical replays, driving probes and 2 ms arrivals run once per profile; `--record` reproduces main's arrivals/reads; measured 273.82 s plain / 419.84 s mutations on a loaded Mac |
| Terrain in WebGL | `RUN=terrain-browser-check.mjs VIEWS="desktop\|q=high phone\|q=low&touch=1" tools/yard-shots.sh 1280 720` | same-page reload pixels, GPU counts, delayed/failed reads and car continuity; part b separates return burst lengths, builds in the worst update and longest frames; ordinary updates and the part g drive reject more than one build; hardware proof pending |
| Tree culling | `tools/check-trees.sh` | exact same-page pixels at fixed and moving cameras; stale-bound runtime mutations |
| Pictures | `VIEWS="name\|query" tools/shots.sh [width height]` | `data/work/shots/<name>.png`; ports derive from the checkout path (or set `WEB_PORT` and `CDP_PORT`); an occupied port exits 2; `MMM_BROWSER_SLOTS=2` and `MMM_BROWSER_WAIT=900` limit concurrent browsers; at the wait cap the start fails (exit 2) unless `MMM_BROWSER_OVERFLOW=run` |
| Building wings | `tools/check-wings.sh` | mapped shape, property identity and roof coverage checks |
| The page itself | `tools/check-page.sh` | which link keys show the title card; the readiness signal for tools; the line a player sees when the game cannot start or stops |
| A start link | `node tools/start-key-check.mjs` (add `--mutations`); in the page: `RUN=start-key-browser.mjs VIEWS="start\|q=low" tools/yard-shots.sh 1280 720` | `?start=<road>` is a player's link (the title card stays): the car starts about 150 m before the end of the named road, pointed at the end; `?start=<road>:<share>` picks a share (0 to 1) of the way. The road is typed in small letters with hyphens (`mabou-harbour-road`). An unknown road gives the normal start. Rules: `web/src/start-key.ts` |
| Night look (light study) | `node tools/run-node-check.mjs tools/night-check.mjs --mutations`; pictures: `OUT="$PWD/data/work/night" RUN=night-shots.mjs tools/yard-shots.sh 1400 900` | palette gate (no night by day or outside the study), invented yard lamps at least 250 m from every property and mailbox in all six areas, land-shader anchors, eight mutants; dusk, village, Highway 19 and bull pictures in chase and seat view, desktop and phone |
| Road queries | `node tools/roads-key-check.mjs` (add `--mutations`); `tools/check-trailer.sh` counts road lookups per step | new grid bit-equal to the frozen old code on real roads; no key strings per physics step |
| Stage 2 mail and boxes | `node tools/mail-stage2-check.mjs --mutations` | real opening crossings, rotated/dented/fallen instances, graded lasting damage, fixed sites, reset and scored misses; thirteen mutants |
| Game rules | `tools/check-shift.sh`, `tools/check-mine.sh`, `tools/check-church-interior.sh` (the church room against the building outside, and its walk), `tools/check-picture.sh` (the first-visit Picture measurement) | exit code |
| Checks in a browser | `RUN=<check>.mjs VIEWS="x\|x=1" tools/yard-shots.sh 1280 720` with `ui-check`, `radio-check`, `relief-check`, `picture-check` (the Picture setting and its one measurement at a first visit), `detail-check` (the Low detail switch and the graphics line), and `layout-check` (use `900 900`) | exit code |
| Frame rate | `FREE_RUN=1 RUN=fps-check.mjs VIEWS="village\|demo=60" tools/yard-shots.sh 1600 1000` | a table, shadows on and off, at full sharpness; exit code. Add `&res=1.5` to a view to time another pixel ratio (1.5 is the Picture setting's "Balanced"). With `HUD=1` and nothing saved the first-visit measurement would change the ratio during the run: pin it with `&res=` |
| Bakes | `tools/bake.sh roads` (roads, corridor, road fields, check, trees), or `tools/bake.sh <script> [args]` | `data/baked/` |
| Radio | `python3 tools/build_radio.py` | `data/audio/out/`, `data/audio/site/` and `data/audio/page/` |
| Public site folder | `tools/build_site.sh` | `data/site/` |
| Packs for the private test page | `python3 tools/pack_terrain.py` | `data/pack/` |

A check's exit code is its verdict. Do not count PASS lines.

The terrain WebGL check prints raw GPU counts and accounts for live tile buffers and pre-existing landmark/tree/coast caches.
Scene geometries outside the tiles may grow by at most 12 (desktop) or 22 (phone) and must not grow from trip to trip; no extra textures and no unowned GPU resources are allowed. The slow-tree-file part visits a third place first, so that the files arrive over missing fine ground, and it requires that witness.
`TERRAIN_BROWSER_MUTATION=dispose-wanted` runs the normal parts first, then injects the fault: exit 1 proves rejection; exit 2 means the baseline failed or the mutation survived.

`tools/browser.sh` starts the headless browser for every picture and check script. On Linux it is the Chromium flatpak
with software WebGL. On macOS it is Microsoft Edge or Brave with the real GPU. The Google builds are the last choice
there: on Dan's Mac a headless Google Chrome is stopped about 30 seconds after it starts, and Chrome for Testing draws
nothing. `CHROMIUM_BIN=<path>` picks another browser, and `SOFTWARE_GL=1` draws in software on any system.

`tools/bake.sh` uses this machine's `python3` when it has GDAL and numpy, and the GDAL container (podman or docker)
when it does not. Rebuild the site folder and the packs after every bake.
Ground steps 21 and 24 save `height.min` and `height.max` in each area's manifest: metres decoded from every listed
ground PNG, including sea samples and shared edges. Old manifests can omit them. `node tools/terrain-height-check.mjs`
scans all six areas without writing land and rejects bounds that miss their ground. It also requires the
legacy `BAKED_HEIGHT_MAX` table in `web/src/terrain.ts` to be at least each `height.max`, so a rebake with
higher ground must raise that table too (it is the fallback for manifests without the fields).

For a wing-only upgrade of an existing building bake, run
`tools/bake.sh 27_bake_buildings.py --preserve-sites`, then
`tools/bake.sh 27_check_buildings.py` and `tools/bake.sh 30_bake_building_styles.py`.
The preserve option keeps every original property record and fails if the ID inventory changes.
Without it, stage 27 remeasures the full inventory from the current raw inputs.
`MMM_BUILDING_WORK` can put stage 27 audit files and check pictures in a separate work folder.

A land whose roads were baked with the road bed switch (`MMM_ROAD_BED=1`) has a mark `bed` in its `roads.json`.
Stage 29 then needs `roads-before-bed.json` from that same road bake. It lies beside the bake's reports
(`data/work/overview`, or `data/work/overview/<area>`), not in the land folder: the game does not ship it.
When you copy or clone such a land to another root, bring that file with it, or bake the roads again there.
Without it stage 29 stops and says so. Mailboxes are decided on those lines and then carried to the same piece
of the moved line, so a box follows its road. Only a box whose carried place is not safe on the moved lines is
placed again by the rule, and that box can move farther.

For the 18 Nov Mabou road correction, pass the pre-step-35 pack's report folder explicitly when staging from a saved copy.
Use a new stage folder.

```sh
tools/bake.sh 35_bake_mabou_dashcam.py --source "$PRE35_TERRAIN" --overview "$PRE35_OVERVIEW" --output "$STAGE"
python3 tools/mabou-dashcam-18nov/receipt.py verify "$PRE35_TERRAIN" "$STAGE"
```

To repair the original step-35 install, the main thread runs the receipt upgrade before rebaking props.
Set `BAKED` to the target's `data/baked` folder. Rehearse on a clone with its own
`data/work/overview/roads-before-bed.json`, from the same land as the cloned terrain.

```sh
python3 tools/mabou-dashcam-18nov/receipt.py upgrade "$STAGE" "$BAKED"
python3 tools/mabou-dashcam-18nov/receipt.py land "$BAKED"
```

The upgrade checks the installed pins and backs up the three replaced files in `$STAGE.pre-upgrade`.
With the same stage and backup, repeat `upgrade` to finish an interrupted upgrade or `rollback-upgrade` to restore
the original bytes. The `land` command warns if the original install still needs the repair.
Use `install` for a verified stage on the pre-step-35 land.
To undo all of step 35 after an upgrade, run `rollback-upgrade "$STAGE" "$BAKED"`, then
`uninstall "$OLDSTAGE" "$BAKED"` with the stage of the original install.

Mapped outlines below 82% rectangle fill can use two to four wings on their own axes.
Each wing is at least 3 m wide and 20 m² (also 8% of the mapped building).
The cover must retain 90% of the outline with 88% intersection over union.
Small bumps are omitted; complicated outlines stay unchanged if they cannot meet these limits.
The largest wing keeps the ID and an unchanged `site` record. All wings carry `buildingId`.
Styles and property uses refer to that ID; only the wing rectangles change the visible shape.
The old vegetation and prop exclusion also stays in place, so opening a corner adds no scenery.

## Edit the radio

Change station names, dials, playlists and credits in `tools/radio_stations.json`, then run `tools/radio.sh`. See [the radio how-to](tools/RADIO.md) for adding, moving and removing songs or stations. Run this before `tools/build_site.sh`; publishing is separate.

### Far horizons (work bake)

Wind points and the far terrain ring are optional versioned pack data. Fetch inputs
and bake them into a work folder before any separate promotion:

```sh
python3 tools/far-views-fetch.py --data-root "$PWD/data"
python3 pipeline/34_bake_far_views.py --data-root "$PWD/data" --output-root "$PWD/data/work/bakes/far-views"
```

In a worktree, pass the original data directory by absolute path. The optional
bake writes no `data/baked` or `data/site` files. Step 33 is excluded from routine
bakes; its explicit CLI delegates to the guarded version-2 work bake. Routine
terrain bakes preserve `tall` and `farLand` manifest keys when their root and
origin stay unchanged, and refuse to keep a pack on a different root.

A rerun compares the previous candidate inventory (or the promoted inventory on
a first run). An omitted or moved item stops the bake before tall packs change.
Inspect the separate `data/work/threads/<task>/bake-audit/removal-review.json`.
Both the live and prior work inventory are checked. Intentional removals need
the exact hash and item list for each baseline via `--allow-removals <ledger>`. Road,
track and building clearance uses the physical turbine base plus 2 m, for both
sources. A conflict in any area omits the point from every pack; positions never
move. Full Sentinel provenance stays in `pipeline/far-views-points.json`, while
runtime points carry source/date/confidence and compact source references.

A legacy `tall.json` without version 2 is ignored by the game and adds no turbine
Places entry. Promotion needs a separate go: provide the four asset hashes per
area and the two manifest-key patches, preserving every other manifest key.
Optional scenery loads after the first frame and Start. Distant material bends
also cover later buildings, trees, props and multiplayer ghosts. Existing draws
provide conservative occlusion probes; hidden daytime far meshes retry at 2 Hz.
Night lights retain depth testing without relying on a subpixel body query.

The game uses derived geometry and points only, with no aerial image textures or
wind-farm/owner names. Earth curvature and normal refraction share one constant.
The distant terrain and sea bend begins beyond 3 km. The selected Hill scale also
applies to far ground; the physical visibility receipt uses Hill x1.

The work asset tree contains four runtime files and `manifest-patch.json` per
area. It never contains a full manifest snapshot or review ledgers. The preview
overlay reads the current live manifest on every request, then merges only the
two patch keys. New road-ground keys therefore survive both preview and promotion.

After code landing and a separate data go, main can use the merge tool:

```sh
nice -n 15 node tools/far-promote.mjs prepare --data-root REAL_DATA --pack-root REAL_DATA/work/bakes/far-views --out REAL_DATA/work/threads/far-views/promotion-review.json
nice -n 15 node tools/far-promote.mjs verify --plan REVIEW_JSON --plan-sha256 PRINTED_SHA
# Main copies only the 24 approved asset files, then:
nice -n 15 node tools/far-promote.mjs apply --plan REVIEW_JSON --plan-sha256 PRINTED_SHA
```

Prepare re-screens all current roads/tracks/buildings with the producer's actual
clearance rules and discloses removals against live tall data. It verifies crs,
origin, size and village. Verify/apply stop on changed source, road, building,
patch, asset or manifest hashes. Apply writes exact planned bytes to manifests
only. If a screen finds a conflict, rerun the guarded work bake first. Both far
terrain detail files enter Mabou's offline PWA inventory: about 4 MB raw growth.

Occlusion skipping mainly helps while stationary: 1 cm camera motion restores
visibility. Stationary scene changes can take up to the 0.5 s probe interval.
The square turbine solid can extend about 1.1 m beyond a circular base at its
corners; the 2 m road clearance accounts for it. These are disclosed limits.

Mail throws use M or E and the phone mail button. The throw follows the right window and inherits the car's speed.
An upright rural delivery must enter the road-facing opening. Throw help can lower or raise launch speed by at most 3 m/s to reach it from the lane centre. A missed throw stays on the ground and counts in the shift report. A box marked as down before the shift accepts a ground drop within 1 m of its post, as the stop hint requests. Player-knocked boxes do not accept that drop.
Car impacts at 2, 8 and 20 km/h leave a lean, dent or fall. A slower touch only rocks the box.
All damage lasts until the next shift and uses the existing instance batches. Mailbox sites stay fixed.

The mail preview cost fixture retains the old `5d678ed` work counters as its comparison.
Those counters come from the old engine's run on #101's land (`b0acc9db`), recorded as `frozenInput`.
The separate `stage2Digest` pins the deliberate opening-only behavior. The old engine digest remains in the JSON as documentation, not an asserted golden. These cost rows now pin the installed land after #179's step-29 rebake (`3502ef37`); see `tools/mail-preview-cost-replay.md`. Other baked inputs need an explicit baseline replay.
`node tools/mail-preview-cost-check.mjs --baseline` reproduces the old engine on the current input, without writing land data; it cannot read #179's mailbox styles 6/7, so it fails on the current land.

## Changelog and What's new

Run `python3 tools/changelog.py` to rebuild `CHANGELOG.md` from the first commit
on `origin/main`, following only first parents. Fetch `origin main` first when
you want the latest changes. A shallow clone is refused; use a complete clone
or fetch its full history. `python3 tools/changelog.py --check` fails if the
committed snapshot differs from that history and the current notes.

Dates use `America/Halifax` including daylight saving time, newest day first.
PR titles supply the wording. In `tools/changelog-notes.json`, a PR number can
map to a plain-language replacement or `null` to hide an internal change.
Numbers absent from that file keep their title. Non-PR commits, including the
initial commit, keep their subject. Neither output includes authors or emails.
Unsafe lines containing an email, a civic address pattern or a private path
stop generation before either output is written. Rewrite or hide the note
rather than weakening the filter.

`tools/build_site.sh` regenerates the static `/changes/` page from real Git
history on every site build. It validates the history before clearing the
previous site and uses the same notes and dates as the Markdown file. The
page is linked from the title card's About/Help links and the About footer.
Only the main thread builds the public site and publishes it. The committed
Markdown is a snapshot; later merges appear at the next rebuild.

`tools/check-all.sh --only changelog` runs the small history-free fixture check,
including stale output, Atlantic date boundaries, escaping and privacy refusals.
It needs neither the repository's Git history nor land data.
