# Surface delta for issue 1173

Evidence was posted on the project brief before changing data. See EVIDENCE.md.
This is a bounded cached-source audit. It does not establish present-day
completeness or independently verify other roads or junction aprons.

## The delta: Industrial Park Road (Point Tupper road 107)

Run `python3 tools/industrial-surface/patch.py --industrial SOURCE_POINTTUPPER NEW_OUTPUT_DIRECTORY`.
The source is read-only and the output folder must be new. Road 107, 4,276 m,
changes from kind 4 (track) to kind 2 (paved). Its width (1.5 m half width),
line, flags and every other road stay as they are. In the 41 road-field tiles
that the road touches, only the kind byte changes, and only in the 120,299
pixels where road 107 wins the existing nearest-segment rule. The pieces
104 to 106 of Industrial Park Road were already paved and stay as they are.

The output has 43 files plus hashes.json: roads.json, cemeteries.json and the
41 road fields. Stage 32_bake_cemeteries pins the SHA-256 of roads.json in
cemeteries.json; a re-bake on the patched roads (16 Nov 2026) changed only that
field, and patch.py writes the same bytes. industrial-hashes.json lists every
file with its SHA-256 before and after.

The reason is Dan's private 15 Nov dash-cam report (paved, double yellow lines
throughout), supported by provincial Paved records and cached OSM paved/asphalt
tags. No footage or stills are included.

Main integration owns installation. Check every input hash against
industrial-hashes.json before installing any file; reject the whole delta if
any differs. Back up the 43 originals, install exactly those relative paths in
data/baked/areas/pointtupper, and keep the hash report. Do not install the
folder as a complete bake. No manifest, height, cover, props or site file
changes. The data is not in git, so the install is a step on each host that has
data/baked (the rented minis copy the MacBook's land when a check runs). Order:
install the 43 files on the MacBook, run this row (all after, pass), then land a
PR that sets `EXPECT = 'after'` in tools/industrial-surface-check.py. Done: the 43 files were installed on
the MacBook on 16 Nov 2026 (all before, then all after, both PASS) and `EXPECT`
is now `'after'`. From then on an
all-before land fails; on a host whose land is older than the install, that
failure means "copy the land again", not a rebake.

A complete stage-23 rebake will not keep this one-off correction. After one:
- If the rebake wrote the same bytes as before the delta, the row fails with
  "all before, but the delta is recorded as installed". Install the same 43
  files again.
- If the rebake's bytes differ, the row fails with "mixed". Run patch.py on
  the new land, review the new delta, commit the new industrial-hashes.json
  from its hashes.json, and install it.
- If a later bake fixes the `OWNER=P` precedence itself, so road 107 comes out
  as kind 2, patch.py refuses ("Unexpected road classification"). Then the
  correction is no longer needed: delete this row, the check and this folder.

## Check row `industrial-surface`

`python3 tools/industrial-surface-check.py` reads the baked Point Tupper land
against `width-hashes.json` (chained onto the 16 Nov `industrial-hashes.json`
surface delta). The delta must be all before or all after; a mix, or a file that
is neither, fails. With `EXPECT = 'after'`, the default checker enforces the
installed width+paint delta (road 107 is `kind 2`, `halfWidth 3.6`, and
`pavement = "double-yellow"`) and exits with an error on an all-before pack
before calling `remake()` — that is the expected failure on pre-install land,
and after install it catches any later Point Tupper rebake or stale host copy
that drops the delta. To test before installing on live land, remake the delta
with `python3 tools/industrial-surface/patch.py --width data/baked/areas/pointtupper <NEW_OUTPUT_DIRECTORY>`
(which writes `hashes.json`), lay it onto an APFS rehearsal clone
(`tools/checks-README.md`), and run `python3 tools/industrial-surface-check.py`
inside a rehearsal worktree pointing at that clone (which compares every file
against `width-hashes.json`).

## What the delta does not change

A full rebake of a paved road would also change these; this delta does not:
stage 24 road bed shaping (kinds 1, 2, 3, 5 are shaped), stage 29 mailboxes,
poles and driveway mouths (mailboxes need kind 1 to 3; driveways join kind 4),
stage 31 culverts (a track gets one only where the map shows a pipe), and the
stage 32 paved shoulder band. Measured on 16 Nov with the delta laid on a clone:
the Point Tupper start point and all 92 Point Tupper guardrail spans are
unchanged. In the game the car gets paved grip on road 107, the phone speed help
allows 70 km/h (10 m/s on a track), the demo driver may follow it, and it can
supply a "start here" point (kinds 1 to 3 only).

Known limits, not changed here: the road stays 3 m wide, so the surface steps
from 3 m to the 6 m of piece 104 at E628480.9 N5051737.82 (EPSG:2961); the game
paints the double yellow centre line on kind 1 (highways) only, so road 107 has
no centre line.

## Withdrawn: road 634 at Mabou (not installed)

The audit's first finding was road 634, an unnamed 158 m service loop at
Highway 19 (E623086.92 N5102219.13 to E623040.40 N5102163.38): kind 4, while
cached OSM way 720386058 says surface=asphalt. The province classes it as a
DRIVEWAY. Kind 2 would make it a public road everywhere in the game, not only
paved. On a clone with it installed, the `trailer` row failed: the demo driver
on Highway 19 turns toward the loop at its junction (s = 5593 m on road 25), and
the loaded rig leaves the 3.6 m lane by 0.16 m. Installing it would also need:
cemeteries.json with the new roads hash, the era-density roads fingerprint, the
`era` row's frozen Mabou 1884 pin, and a demo driver that keeps to its road at a
junction. A paved driveway needs a surface that is not a road class (for example
a paved flag beside the kind), which this delta does not add. patch.py refuses
the Mabou mode. Mabou Mines Road stays washboard.

## Next

Map the closed ends, with lamp boards and barriers, on Granville St near
E627233 N5053179 and Reeves St near E627443 N5053518 (EPSG:2961). These are
follow-up work, not changed by this surface delta.

## Width and centre paint for issue 1406

Run `python3 tools/industrial-surface/patch.py --width SOURCE_POINTTUPPER NEW_OUTPUT_DIRECTORY`
on the installed 16 Nov surface-corrected land. It widens road 107 from 1.5 m to
3.6 m half width (7.2 m travel width) and sets `pavement: "double-yellow"`.
The 7.2 m travel width comes from the two 3.6 m lanes in
[Bear Head LNG assessment table 6.38](https://www.novascotia.ca/nse/ea/bearHeadLNGTerminal/Section_6_Pg_33-110.pdf).
Provincial road segments (`BASE_NSTDB_10k_Roads_WM84__05_bridges.geojson`) confirm
`ROAD - Local - 2 Lanes - Paved`. Cached OSM way 181364590 lists two lanes and
`surface=paved` with no width tag.

`width-hashes.json` records all 43 files written by `patch.py --width`
(`roads.json`, `cemeteries.json`, and 41 road-field PNGs at levels 5 to 8),
chained directly onto `industrial-hashes.json`. `web/src/bridge-crossings.json`
also updates road 107's overpass over Railroad 216 (`osm/way/169338040`, span
`-100084`) from `kind: 4, halfWidth: 1.5` to `kind: 2, halfWidth: 3.6` so it
renders as a concrete/asphalt highway overpass with continuous double-yellow
centre lines across its deck and approaches, instead of a 3 m timber bridge.
Point Tupper's `bridge-decks.bin` is rebaked to match
(`web/src/bridge-decks-assets.ts`, 44th file of the Point Tupper install:
before `5f07980cf217405aa2191f75d81a0fb0eb6eb48b999e9c8c1303526c419faa3c`,
126,000 bytes; after
`0bf94594f7f348555e65973da062823db1de9eda518590ad46fe61ec024f83fb`,
128,624 bytes).

Re-baking all 117 Point Tupper paved lot tiles and both stockpiles on the
widened `roads.json` produces byte-for-byte identical `.r8` tiles and
`stockpiles.json`; Port Hawkesbury's sidewalk runs lie away from road 107.
`tools/paved-open/patch.py` and `tools/sidewalks_bake.py` chain
`width-hashes.json` so those land checks stay green without rewriting unchanged
packs.

### Active railway status near road 107

Provincial NSTDB (`__06_railways.geojson`, `__05_bridges.geojson`) classifies
the Point Tupper rail segments crossing and paralleling Industrial Park Road as
`Active Rail Road` (`ROADCLASS=RR`, `STREET='Railroad'`). Cached OSM maps them
as `railway=rail`, Cape Breton & Central Nova Scotia Railway (CBNS) Sydney
Subdivision (`gauge=1435`). Public operating records confirm the Truro–Point
Tupper line is an active freight railway serving Point Tupper industries (the
section east of Point Tupper toward Sydney has been dormant since 2015, not
converted to a rail trail). The Ceilidh Coastal Trail (`kind=5`) is 5.5 km
northwest near Port Hastings. In the game, Point Tupper's railway keeps its
`Railroad` road name and `gravel` (ballast) surface on the HUD (including on
timber railway bridges), never `rail trail`.

### Order with #1341 delta 2 and single-directory cutover

This finisher task (`grok-bots#1410`) installs road 107's 7.2 m width,
double-yellow centre paint and overpass update (44 files: the 43 files of
`width-hashes.json` plus `bridge-decks.bin`) on the current Point Tupper ground
ahead of `#1341` delta 2, superseding the builder's earlier combined-bake
proposal on `#1036` comment `7147815846` because `#1341` delta 2 is not yet
underway.

To avoid leaving a mixed or missing pack if interrupted mid-copy, install all
44 files via a single atomic APFS `renamex_np(..., RENAME_SWAP)` directory swap
on the same filesystem:

1. Verify all 44 live files in `data/baked/areas/pointtupper` match their
   recorded before-hashes (43 in `width-hashes.json` plus live
   `bridge-decks.bin`). Abort if any file differs.
2. Clone live `data/baked/areas/pointtupper` with `cp -cR` into a sibling
   staging folder `data/baked/areas/pointtupper.stage-1406`.
3. Copy the 44 staged files into `pointtupper.stage-1406` and verify all 44
   after-hashes (and unchanged file count) inside the staging folder before
   touching live land.
4. Cut over in one atomic kernel syscall (`RENAME_SWAP = 2`):
   `libc.renamex_np(b".../pointtupper", b".../pointtupper.stage-1406", 2)`.
   Readers never see a missing `pointtupper` path, and if the syscall fails
   nothing moves. After the swap, `pointtupper.stage-1406` holds the intact
   pre-cutover tree; move it to the retained rollback backup under
   `data/work/bakes/backup-1406-pointtupper-20261124/pointtupper`.
5. Rollback (if ever needed) uses the same atomic syscall: clone the backup to
   `data/baked/areas/pointtupper.restore-1406`, verify all 44 before-hashes,
   run `renamex_np(b".../pointtupper", b".../pointtupper.restore-1406", 2)`,
   and remove `pointtupper.restore-1406` once verified.

When `#1341` delta 2 shapes Point Tupper's road and railway ground (embankments,
steep rail notches and road-side utility poles), it should keep road 107 at
`kind=2`, `halfWidth=3.6`, `pavement='double-yellow'` and refresh the Point
Tupper land receipts once.
