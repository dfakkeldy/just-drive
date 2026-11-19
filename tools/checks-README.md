# Check inventory and mutation safety

The pre-PR command is `tools/check-all.sh --changed` (`--quick` on a busy
machine), followed by the touched feature's browser rows with `--only`.
Use `tools/check-all.sh --full --browser` once before a risky merge.
The default runs NO real browser and runs every other CPU check, except the four
costly stand-in proofs described below. Publish builds keep their own type check.

`--quick` leaves out the separate mutation rows. The mutation suites inside the wrapper rows `coast`, `fishing-rules` and `visit` still run. A mutations row marked `includes-base` runs its plain cases first, so the plain row is not run a second time. `--only <row>` always runs the named rows, also a start-up proof and a mutations row; a name that is not a row gives exit 2.

- `--browser` includes serial browser rows through existing starters.
- `--list` prints last measured seconds and an estimated total, with a count of
  unmeasured rows. Bare `--list` shows the default CPU selection; a path coverage
  listing also shows browser rows. `--full --browser --list` shows everything.
- `--only name ...` selects explicit rows; for example, `--only visit` executes
  `check-page.sh`, including both visit and page-state mutation suites.
- `--for path ...` selects checks whose scripts read those files. Each tool's
  static imports, literal subprocess inputs, shell sources and simple literal
  shell loops are scanned once and cached in memory. Narrow globs are additions.
- `--changed` includes committed/staged/working differences and untracked files
  from Git's NUL-delimited status. Prose and housekeeping (`*.md`, `docs/`,
  `.gitignore`, `LICENSE`) print `NO CHECK NEEDED` and do not affect the result.
- Other uncovered paths print `NO CHECK COVERS`. Selected rows still execute;
  the final exit is 2 unless a row failed, in which case it is 1.

The costly `browser-runtime`, `browser-ownership`, `browser-listeners` and
`browser-kill-everything` rows use stand-ins and read no game source. A normal
run or web source change excludes them. `--full` includes them, as does a changed
starter or one of their own inputs. The default prints:
`start-up proofs not run (no starter changed); use --full`.
A starter change also prints `browser start-up changed: run --browser`.

## Clean-clone CI (`--ci`)

`.github/workflows/ci.yml` runs `tools/check-all.sh --ci --full` on Ubuntu with no
`data/` (`--full` adds the four stand-in start-up proofs, which need neither).
It runs on pushes to `main` and on PRs that are ready for review. On a draft PR
(opened, reopened or pushed) the job reports as skipped, because hosted minutes
are billed; run rows on the Mac or the rented mini while a PR is a draft. A
re-run of a skipped run skips again: only `gh pr ready`, or a push to a ready PR,
starts the run. Wait until the job shows pending before `land_pr.py`. Started
earlier, it reads the skipped check as red, and on a branch behind `main` it
pushes an update commit that cancels the new run. "Every check was skipped" on a
draft is expected; it is not a reason to make the job run.
The `--ci` flag changes two things. A row marked `mac-only` or `apple` in
`checks-hosts.tsv` prints `SKIP` without running. A row whose missing `needs`
all lie inside `data/` prints `SKIP` as usual. Neither kind fails the run; the
table ends with `CI: <n> SKIP rows ...`. Any other missing need (for example
`web/node_modules/.bin/vite` when `npm ci` did not run) still exits 2, and
`CANNOT RUN` and `FAIL` keep their meaning. A tracked link into `data/`, such as
`web/public/areas`, dangles in a clean clone, so the runner judges where the
path leads, not the link itself.

So a row that reads the land must say so in `needs`. Without it, the row runs in
CI and fails with `ENOENT` instead of skipping. The 14 Nov dry run found three such
rows (`fishing-rules`, `road-scene-mutations`, `guardrail-fix-mutations`). A
fourth, `era-density-allocation`, only looked like one: its Vite probe build
copied all of `web/public` (links into the land, about 1.2 GB) for nothing, so it
now builds with `publicDir: false` and runs in CI.

Historical controls read frozen source files under `tools/baseline/source/`.
They need no previous commits or fixture branches. Checks that compare the
current branch against main still read `origin/main` from the local checkout.

## The multiplayer check on a busy machine (`mp`, `mp-mutations`)

`tools/mp-check.mjs` drives simulated players against a local room server in real time, so a machine that
stalls this process or the room's runtime can make a car look late. The check measures both stalls itself: a
10 ms timer in the process, a "ping" every 50 ms on each player's socket, which the runtime answers without
the room's code, and a race-sync every 500 ms, which the room's code answers without touching a relay (on a
shared runner that code can wait longer than the runtime). A room that holds back its relays answers both at
once. A frame with a stall over 100 ms in the second before it is judged by the bad-connection
limits (on the simulated bad connection its lag may count stalls 2.3 s further back, twice the link's longest delay), and its lag may include that stall, plus (on the clean connection, except a drive-off) any rise in the game's own delay since the stall, but no more
than twice the stalls of the last 20 s, less 50 ms for each second since (the most a stall can add in `net.ts`);
300 frames for each pair, and a tenth of all, must have neither. A room whose own code hogs the runtime delays the pings too,
so it is excused while it lasts; only a constant one fails. Steps that must happen promptly (a newcomer sees a
parked car, a reset arrives, a lost car is dropped) keep their old limits, plus the stalls measured meanwhile. The
bots advance their cars by at most 0.1 s a frame, as the game does, so a stalled bot does not jump
15 m and get sent as a reset. Other steps wait for the event they need (a race-sync round trip orders a socket's
messages and reads the room's clock) instead of sleeping for a fixed time.

`tools/check-mp.sh --mutations` (row `mp-mutations`, about three minutes) proves the motion part still fails a
real fault: it passes with three stalls of this process and three SIGSTOPs of the local runtime (and must report frames
judged after them), and fails a room
that holds each relay back 0.6 s, a game that draws the others 0.5 s later (also when a stall comes while its
delay settles), and a process that stalls all the time. `--motion-only` runs only the rules, the door and the clean-connection players.

## Checks on a land that is not live yet

To check a bake before it goes into `data/baked`, use a REAL checkout:
`git worktree add <folder> <commit>`, then give that folder its own `data/`
(the new land as an APFS clone made with `cp -cR`; links to the live `raw`,
`audio` and `baked/areas` folders are fine).

Do NOT use a folder whose `tools` is a link to another checkout. `check-all.py`
takes its root from its real path (`Path(__file__).resolve()`), so through a
linked `tools` folder it runs every row in that other checkout, on the live
land. The line `Evidence folder <path>` near the start of each run shows which
checkout the run reads (with the default scratch folder; `MMM_CHECK_SCRATCH`
moves it): look at it before you trust the result. `bake.sh` and
`yard-shots.sh` take the root from the path they are called by, so a link root
works for them; do not mix the two up.

`--for <land file>` selects rows by their scanned inputs. It does not find every
row that reads the land: `era-density-inputs` and `mail-preview-cost` are not in
that selection. For a new land, run the whole suite, with the mutation rows.

`checks.tsv` remains the sole command registry. Discovery includes Python/Node
checks, browser modules, suites, regressions, physics/integration/review drivers,
and every `*-shots.sh`. Picture-only starters have explicit ignore reasons.
Each row records its timeout and last measured seconds. Missing measurements
are labelled, rather than estimated as zero-cost checks.

Exit 0 means every selected row passed. Exit 1 means a row failed. Exit 2 means
uncovered input or a check could not run. Missing inputs get a SKIP row and a
reason. One INT/TERM stops the loop, prints the partial table and exits 130.
Timeout sends TERM then KILL to the owned process group. macOS zombie-only
process groups may refuse signals; both missing-group and permission errors
are handled. The many-process test repeats timeout, INT and TERM 40 times each.

Output, temporary bundles and full logs share an isolated folder. When a row
fails or cannot run, the runner keeps it and prints `Evidence kept at ...`
below the table. An all-pass execution removes it, except for one case. A
measurement row can write a small named folder, `$MMM_CHECK_OUT/evidence/<row>/`
(numbers and pictures). After a pass, the runner keeps only `evidence/`,
removes the rest (logs, browser profiles, builds) and prints
`Evidence kept at ...`. The scratch folder keeps the newest three passing
folders of each row and removes older ones. Failed runs are never removed
automatically; delete them by hand when you are done with them.
Set `MMM_CHECK_SCRATCH` to choose the parent of that isolated folder; the
default is `data/work/checks`. Site/artifact fixtures inherit this work location.

Progress goes to stderr. The first line is `Evidence folder <path>`. Each row
prints `Checking <row>` when it starts and `RESULT <table row>` when it ends.
The RESULT text is the same as the row's line in the final table. So a run that
is killed outright (SIGKILL, a dropped session, an outer timeout) still shows
the verdicts of its finished rows, and their logs stay in that folder.

## Previously invisible suites

- `mail`: `tools/mail-shots.sh --check`, CPU delivery assertions.
- `art-stats`: `tools/art-shots.sh --stats`, CPU geometry assertions.
- `touch-quality-ui-suite`: served-module mutants and 23 Explore cases.
  `touch-controls-ui-suite` runs the seven other UI jobs. The eight `touch-layout-mp{0,1}-dpr{1,2}-{low,high}` rows
  each run the full 28-size layout check for one matrix variant.
  The narrower `touch-quality-browser` row omits those mutants; `layout-check`
  covers one layout variant. Their table notes state those limits.
- `animals`: `DETAILS=1 CHECKS=1 tools/animals-shots.sh`. Source inspection shows
  behavior failures throw in the page; the inline CDP reader throws on
  `exceptionDetails`; Node and `run_check` propagate a failing exit. No behavior
  or exit-code change to this script was needed. This pass did not run it.
- `mine-shots`: `tools/mine-shots.sh`, seven mine views; `mine-shot.mjs` fails on 14 behaviour conditions.
- `shift-shots`: `tools/shift-shots.sh`, pictures that fail on a page exception, no settle, overflow and phone HUD fit.
- Every remaining `*-shots.sh` is either a registered check mode or explicitly
  labelled pictures only. `sxs-game-pictures.mjs` and `fishing-survey.py` remain
  excluded picture/survey helpers, with their two/one assertions noted.

## Default-suite deduplication

| Before | After: each suite remains present |
|---|---|
| `fishing-rules` wrapper plus `fishing-contact`, `fishing-mutations`, `fishing-contact-mutations`, `fishing-shader-mutations` | `fishing-rules` runs `check-fishing.sh` once: rules plus the four inner suites |
| `coast` wrapper plus `coast-mutations` and its separate `coast-rules` baseline | `coast` runs `check-coast.sh` once: source/pin, mutations, unmodified rules baseline, survey and tree checks |
| `visit`, `visit-mutations`, `page-state` wrapper, `page-state-mutations` | `visit` runs `check-page.sh` once: visit and page-state, both with mutations |

The `sxs` wrapper prints the related rows and command explicitly:
`tools/check-all.sh --only sxs-review sxs-round2 phone truck`.

## Served source mutations

Run `node tools/explore-mutations.mjs` or `node tools/bike-browser-mutations.mjs`.
Each command validates **every** source anchor before starting Vite or a browser,
including cases excluded by `MUTATION_ONLY` or `BIKE_MUTATION`. `--validate`
performs only that preflight. A missing anchor names the case, file and anchor.
The launcher creates one private directory below `data/work/mutations`, starts the
existing yard starter, and honours a caller's `OUT` for evidence. Without `OUT`, successful runs remove the temporary folder;
failed runs keep it and print its path.

`MMM_MUTATION` names a JSON document, for example:

```json
{"name":"example","edits":[{"file":"web/src/visit.ts","from":"old text","to":"new text"}]}
```

The plugin in `web/vite.config.ts` exists only for `vite serve` when this variable
is set. It validates paths (including real symlink targets) and anchors, then
returns edited module text from its `transform` hook. It never writes source.
An edit requires exactly one match unless `all: true` is explicit. No-op edits
are rejected. Replacement text is literal, including dollar characters. An optional
`marker` records bike/Explore mutation identity in the served modules.

The plugin watches the JSON file, invalidates Vite's module graph and sends a
full reload on changes. The runner waits for the exact JSON SHA-256 receipt at
`/__mmm_mutation` before starting each probe. Invalid JSON, paths or anchors fail
closed. File paths outside `web/src` are refused. A standard Vite build refuses `MMM_MUTATION` with a clear error. With it unset,
production builds never create the plugin.

## Write audit

The three tools that created or rewrote files inside `web/src` are converted:

| Tool | Change |
|---|---|
| `explore-mutations.mjs` | JSON documents and served transforms replace save/write/restore |
| `bike-browser-mutations.mjs` | JSON documents, transforms and served identity markers replace source writes |
| `trailer-review-browser.mjs` | optional frozen towing baseline is a served transform; no temporary source module |

Two tools can intentionally update tracked baselines, outside ordinary checks:
`coast-programs.mjs` writes the shader pin only with the source check's explicit
`--update`; `frame-budget-check.mjs` writes ceilings only with `--update` or
`--raise`. The inventory passes none of these flags. `frame-budget-mutations.mjs`
passes them only with a scratch baseline path; its source variant is a scratch
copy of its own check, not game source. No check writes `web/pwa` or `server`.

The newer source mutation suites already use in-memory esbuild inputs:
`bike-mutations`, `explore-rules-mutations`, `fishing-mutations`,
`road-scene-mutations`, `road-scene-world-mutations`, `roads-key-check`,
`phone-build`, `check-touch-quality`, `fishing-contact-check`, and the SXS and
trailer Node review wrappers. Shader/coast suites use scratch shader/pin files
or in-memory text. Standalone source suites now preflight anchors before their
first probe. The PWA, visit, page-state, site, title and world rule checks mutate
strings, fake file readers or VM inputs. PWA browser checks write generated
site variants under their output directory, with shared land linked read-only.

The site rehearsal retains its original `shutil.copyfile` staging behavior.
Its shared Wrangler selector prefers the highest cache version; PATH is a last
resort and explicit `WRANGLER` wins. Only the rehearsal requires the origin flag.
The version comes from the first output line, so an update banner cannot rank
a cached candidate by a different version.

All remaining `writeFileSync`, aliased `write`, `writeFile`, `copyFileSync` and
shell-redirection matches are generated build files, fixtures, check bundles,
profile/lease state, screenshots or reports under temporary/output directories.
They do not overwrite tracked files. The inventory directs temporary output
under its own `data/work/checks` directory when data is available. Coast surveys,
fishing contact reports and migration timing reports accept that output path;
standalone defaults stay unchanged. No baseline is refreshed automatically.


## Browser command audit

The command column in `checks.tsv` is authoritative. The following audit names
its documented header or wrapper. Bare yard commands retain that starter's
documented defaults when the check provides no dimensions or views. Example
port and output assignments are left to the caller and shared startup. The area
header's former `fixture` placeholder is now the registered Judique area.

| Row | Command source | Correction |
|---|---|---|
| `pwa-browser` | `tools/check-pwa.sh` | Header/wrapper command; existing defaults retained |
| `car-check` | `tools/car-check.mjs` | Header/wrapper command; existing defaults retained |
| `church-browser-check` | `tools/church-browser-check.mjs` | Both documented area branches; no invented camera |
| `desktop-layout-check` | `tools/desktop-layout-check.mjs` | desktop demo=2 and relief=0.5 view |
| `detail-check` | `tools/detail-check.mjs` | Header demo=8 view |
| `fishing-check` | `tools/fishing-check.mjs` | Removed invented size/view; check navigates its own fixtures |
| `fishing-course-browser-check` | `tools/fishing-course-browser-check.mjs` | Removed invented size/view; check navigates its own fixtures |
| `fishing-hills-check` | `tools/fishing-hills-check.mjs` | Removed invented size/view; check navigates its own fixtures |
| `fps-check` | `tools/fps-check.mjs` | Restored both documented village and harbour views |
| `grass-check` | `tools/grass-check.mjs` | Needs its own views: a desktop hay-field view with `grass=1` and a phone view (the starter's default views cannot pass its override cases) |
| `jump-check` | `tools/jump-check.mjs` | Removed invented size/view; check navigates its own fixtures |
| `just-drive-check` | `tools/just-drive-check.mjs` | Removed invented size/view; kept documented VITE_MP=1 |
| `layout-check` (one of eight variants) | `tools/layout-check.mjs` | Header/wrapper command; existing defaults retained |
| `mp-ghosts-check` | `tools/mp-ghosts-check.mjs` | Header/wrapper command; existing defaults retained |
| `picture-check` | `tools/picture-check.mjs` | Header demo=8 view |
| `pwa-isolation-check` | `tools/pwa-regressions.sh` | Used isolation command from pwa-regressions.sh |
| `radio-check` | `tools/radio-check.mjs` | Header/wrapper command; existing defaults retained |
| `ramp-check` | `tools/ramp-check.mjs` | 1400 by 950 and ramp view |
| `relief-check` | `tools/relief-check.mjs` | Header relief view |
| `touch-path-check` | `tools/touch-path-check.mjs` | 900 by 900 and touch view |
| `truck-check` | `tools/truck-check.mjs` | Header/wrapper command; existing defaults retained |
| `ui-check` | `tools/ui-check.mjs` | Header title=1 view |
| `water-check` | `tools/water-check.mjs` | Size 1280 x 720 (needed: at the starter's default 1600 x 1200 the look-down mirror case fails); the check navigates its own fixtures |
| `budget` | `tools/check-budget.sh` | Header/wrapper command; existing defaults retained |
| `budget-mutations` | `tools/frame-budget-mutations.mjs` | Header/wrapper command; existing defaults retained |
| `trees` | `tools/check-trees.sh` | Header/wrapper command; existing defaults retained |
| `mp-game` | `tools/check-mp-game.sh` | Header/wrapper command; existing defaults retained |
| `bike-browser` | `tools/check-bike.sh` | Added HUD=1 from wrapper |
| `explore-browser` | `tools/explore-check.mjs` | Header/wrapper command; existing defaults retained |
| `explore-browser-mutations` | `tools/explore-mutations.mjs` | Header/wrapper command; existing defaults retained |
| `bike-browser-mutations` | `tools/bike-browser-mutations.mjs` | Header/wrapper command; existing defaults retained |
| `browser-real` | `tools/check-browser-real.mjs` | Header/wrapper command; existing defaults retained |
| `pwa-regressions` | `tools/pwa-regressions.sh` | Header/wrapper command; existing defaults retained |
| `area-browser` | `tools/area-browser.mjs` | Concrete registered area replaces placeholder; starter default size |
| `causeway-browser` | `tools/causeway-browser.mjs` | Header/wrapper command; existing defaults retained |
| `coast-browser` | `tools/coast-browser.mjs` | Header/wrapper command; existing defaults retained |
| `damage-browser` | `tools/damage-browser.mjs` | Header/wrapper command; existing defaults retained |
| `page-state-browser` | `tools/check-page-browser.sh` | New wrapper supplies documented public and dev origins |
| `phone-help-browser` | `tools/phone-help-browser.mjs` | Header/wrapper command; existing defaults retained |
| `road-scene-browser` | `tools/road-scene-browser.mjs` | Header/wrapper command; existing defaults retained |
| `road-scene-regression-browser` | `tools/road-scene-regression-browser.mjs` | Header/wrapper command; existing defaults retained |
| `touch-quality-browser` (no served mutants; use full suite) | `tools/touch-quality-browser.mjs` | Header/wrapper command; existing defaults retained |
| `sxs-browser` | `tools/sxs-browser.mjs` | Header/wrapper command; existing defaults retained |
| `truck-browser` | `tools/truck-browser.mjs` | Header/wrapper command; existing defaults retained |
| `trailer-browser` | `tools/trailer-browser.mjs` | Header/wrapper command; existing defaults retained |
| `trailer-review-browser` | `tools/trailer-review-browser.mjs` | Header/wrapper command; existing defaults retained |

`coast-recess-browser`, `coast-scene-browser`, `fishing-browser` and
`damage-timing-browser` are imported libraries, with explicit ignore reasons
and executable callers in the registry. `run-node-check` is a bundling helper,
not a browser check.

The added `touch-quality-ui-suite` row uses its documented single-yard-job
entry point. The added `animals` row uses the script's documented check flags.

## Checks on another machine

Run `tools/remote-check.sh user@check-host --only tsc jump picture-first`.
All check-all selection flags work; `--list` stays local. `--changed` resolves
local paths before transfer. The rows sent are `check-all.py --plan` with your
flags: exactly what a local run would execute (`--list` shows more). Only index-listed working files travel; untracked
files, private reference/notes and raw data do not. Stage new tools first.
A tracked path under a symlinked folder stops the run. Git history goes too
(checks read old commits), so the run refuses before any push when history
ever held a private path (`docs/`, `reference/`, `data/` and the like), with
replacement refs ignored and grafts refused. Each host checkout is its own
repository, so another session cannot move its `origin/main`.
The table streams back with the runner exit code. Failed-row evidence and a
pass's `evidence/` folder return to `data/work/remote-checks/`, one folder per
run. The runner removes the host's copy after it copies it back; the Mac
copies are not pruned.
Delete a folder there when you are done with it. A passing copy holds only
`evidence/` (about 1 MB for the traffic rows); a failed copy holds everything
and can be large. INT/TERM, a dropped connection or a broken pipe
stops the host process group (TERM, then KILL after 20 s), and the checkout lock
is held until it has stopped.

Run rows marked `apple` on apple-check-host (or any Apple silicon Mac); do not hold a
branch for the MacBook because of that label. Since the 17 Nov follow-up below,
two rows stay `mac-only`: `church` reads private `data/work`, which never leaves
the MacBook, and `damage-browser` has its fix but no passing m4 run yet (it
measures time, so it waits for load below 20). Use Linux for portable browser rows and the default CPU suite. A remote Mac
still needs each row's inputs (baked land, public audio, tools); Darwin alone does
not supply `data/work`.

The runner also sends `data/raw/paved-open` (the open-data paved inputs, about
200 KB) as a fingerprinted snapshot, read-only on the host like `baked` and
`audio`. No other `data/raw` folder travels. `paved-open-land`, `point-tupper-delta-land` and `mabou-village-delta-land` read its
corrections file beside `data/baked`. The paved browser rows also need the large
`data/raw/elevation`, `vectors` and `areas` inputs, which stay on the MacBook;
their `needs` make a runner host SKIP them with the missing path. A check run
directly on apple-check-host reads that host's own `data/`, which can lag the MacBook land.

Host gate on apple-check-host (main thread rule, 17 Nov 2026): start a browser row only
while the 1-minute load is below 40 and at least 70% of memory is free
(`memory_pressure`). A row that measures time (frame gaps, wall-clock or
navigation timings, a timing oracle such as `damage-browser` or `pwa-browser`)
starts only below 20. The gate was 20 for every browser row before. `checks-hosts.tsv` records
portability and software-renderer permission. Every browser row needs a line; a Node row without one counts as
`portable`. Non-Darwin hosts refuse `mac-only` rows always. `apple` requires
Darwin on arm64; `--allow-unproven` bypasses neither restriction. Non-Darwin
hosts also refuse `unproven` rows unless you pass `--allow-unproven`.
`MMM_SOFTWARE_OK=1` is set only for rows recorded as `software=ok`.

The initial classes were measured on 13 Nov 2026 (main at df9507d to e335cca)
on Linux (GTX 980M, NVIDIA EGL) and on the Mac. The apple-check-host audit below adds
the `apple` class with a separate source revision and measured results:

- `portable`: the row passed on Linux, or gave the same verdict on both
  machines (a failure on both is a bug, not a host difference).
- `apple`: measured on apple-check-host and supported by the existing MacBook proof or
  unchanged MacBook pins. The branch must still run the row: this label admits
  Apple silicon macOS as a proof host; it does not guarantee a pass. Required
  tools and baked/audio inputs still apply. Linux and Intel Macs are not
  admitted by this label.
- `mac-only`: no accepted apple-check-host proof in this audit. The evidence records
  private commits, local `data/work`, MacBook timing, or a failed/incomplete
  m4 result. The original Linux findings remain in each row's evidence;
  a Linux failure alone does not establish a MacBook hardware requirement.
  In particular, raw floating-point digests can differ between arm64 macOS
  and x86-64 Linux even when two Apple silicon Macs agree.
- `unproven`: not measured, or needs a tool the host lacks (Wrangler).

Re-measure a row after you change what it pins. Run it on both machines, then
edit its line with the result, the commit and both times.

The parent creates `~/mmm-runner/host.env` on each host. It accepts plain
`KEY=VALUE` lines for `CHROMIUM_BIN`, `MMM_BROWSER_GL`, `MMM_BROWSER_SLOTS`,
`MMM_BROWSER_WAIT`, `MMM_BROWSER_OVERFLOW`, `MMM_NVIDIA_EGL_VENDOR` and `PATH_PREPEND` only. Values are
literal; no shell code runs. Set `MMM_REMOTE_ROOT` locally to override the root.
`MMM_REMOTE_SSH` selects an SSH executable (also used by Git and rsync).
The host needs Python 3.11+, Git, Node/npm and rsync. Baked data and npm installs
are shared snapshots. `data/baked` and `data/audio/out` must resolve to folders
of that name outside `data/work`, `reference` and `docs` (a symlinked `data`
folder in a worktree is fine). Snapshots are named by a content hash (cached in
`data/work/remote-checks/`), sent with checksums, and published read-only; each
checkout gets its own folders of hard links, so a check cannot change shared
bytes and pruning never removes files from a running check. Audio travels only to `own` destinations.
Record aliases and trust in the untracked `tools/remote-hosts.local.tsv`;
unknown destinations count as rented. Missing prerequisites
remain SKIP rows. Per-checkout locks serialize sessions; shared locks protect
snapshot creation, pruning and npm setup. No agent or credential is installed.

## Offline 1884 dwelling sites

`tools/check-era-density.sh --write` regenerates `web/src/eras/mabou-1884-layout.ts`
from the committed cell counts and the finest available baked ground. The rows are
invented game positions. The generator does not read historical dwelling marks.
House and barn footprints must fit inside their original cell and the driving
wall, clear of bridge approaches. Unfilled counts stay as explicit deficits in
the generated header; they never move to another cell.

The registered `era-density-generated` row regenerates in memory and requires a
byte-identical file. `era-density-fine` independently loads the production terrain
and checks raw ground, drawn triangles, water, roads, approaches, spacing and
counts. `era-density-review` covers the review regressions and restores the old
barn-door clamp as a negative control. Runtime siting is absent; only narrow
bridge cut/approach sampling remains before construction.

When `data/work/history-1884/density/mabou-1884-dwellings.json` is present, the
private audit requires 345 finite county positions and 67 unlocated inset records.
It checks both house and barn centres and prints their counts, without emitting
mark positions. Empty or malformed inventories fail. An absent file gives an
explicit SKIP line. No tracks are generated by this change.

## 1884 land binding and trade compatibility

Regeneration supports **Node 26.13.1**. Position/score inputs use millimetres,
heights use 0.1 mm, angles use 1e-8 radians, and string tie-breaks use code-unit
order. `era-density-generated` also injects sub-quantum math noise and requires
unchanged bytes. `era-density-allocation` boots both normal and artifact-inline
bundles: today evaluates no layout structures; the era parses its compact string
once. The actual browser boot row checks the same decoder states.

`era-density-inputs` hashes the manifest, cover, roads, streams, buildings and the
recorded terrain/road-field file set. A mismatch names its input and gives the
regenerate and validate commands. `era-density-trades` executes PR 70's actual
siting and level-6 reader from Git revision `883363c`, preserves valid sites within
0.5 m / 1 degree, and checks every intentional relocation against its real-rule
reason. Steep trade ground uses the existing 65%-of-eave foundation-rise envelope
on unexaggerated fine ground. Boards reserve their real posts and panel with a
1 m horizontal margin; independent validation reads the live geometry/matrices.
Footprints require raw sample spacing of at most 4 m. The playable square also
contains 8 m data, so coarser areas cannot be accepted as building footprints.

Publisher: run `tools/check-era-density.sh --fingerprints` before publishing after
any re-bake; on mismatch run `tools/check-era-density.sh --write`, then
`tools/check-era-density.sh --validate`.
The `manifest.json` fingerprint leaves out the `props`, `paved` and `buildingStyles`
keys (`MANIFEST_UNREAD` in `tools/era-density-inputs.mjs`). Step 29, the paved install
and step 30 write them, and no 1884 input reads them, so a prop, power, paved or
building-colour bake does not stale the layout. Every other manifest key is still
fingerprinted.


Density final trade rules: `--trades` regenerates exact committed poses, rechecks the shipped rows against source-label distance (building centre <=250 m), original road side, no road/stream centreline crossing, water-bank attachment, approaches, playable wall and board geometry. All seven PR70 water trades keep water. One production `Terrain.heightAt` surface at true scale is sampled every 0.5 m; both old and replacement pass at rise <=65% of eave height. The best legal replacement must also improve rise by at least 0.25 m. With no such candidate, the original is retained and listed; a water trade may never fall back to a label-only site. Retained mill-bank stone bases have a 6 m visible cap. `--round4` covers schema rejection before cache, all seven water-loss faults, exact poses, side/crossing fixtures and period names. The actual browser row covers both highway readouts, list/arrival/minimap agreement, normal `Mabou, 1884` title and legacy tool `settled` handling, all seven wheel objects and the Weaving Mills wheel/axle/sluice.

Runtime `mabou-1884-layout.ts` holds only the fields used by the scene. The committed tools-only `tools/era-density-layout.json` holds fingerprints, cell audit, trade policy, old/new rises and explicit exceptions. Regeneration byte-compares both files. The normal era title uses the hidden ready signal; explicit tool URLs retain the legacy `loading`/`settled` title protocol. Today's title handling is unchanged.
## Phone HUD and delivery help

`node tools/mail-help-check.mjs --mutations` uses the real `Mail` and `Props`
classes on flat stand-in ground. It sweeps 20, 40 and 60 km/h, six mailbox
road offsets from 2.5 to 5 m, and all 13 positions in the throw cycle. Each
speed gets 2,028 uniformly spaced throws per setting (20 m ahead to 5 m past).
Cue rows throw at the first cue sampled at 120 Hz. Assisted flight uses accumulated fixed 1/60 s ticks; the preview uses that same complete physics/contact step. The off comparison throws
at those same instants. Oversized parcels have no cue inside their existing
12 m knockdown range; absence counts are printed, not scored as hits.

The SHA-256 golden freezes raw Float64 piece state, rotation, resting pose and
counters from 1,300 frames of main `2ae94cc`, including mixed 60/120 Hz steps
and all throw variants. Off also keeps that main's uniform hit counts:
86, 126 and 153 out of 2,028. `--legacy` rebuilds the two original classes
in memory from that Git commit to reproduce the bytes and those counts.
The normal check uses the frozen digest/counts and needs no Git subprocess.
Seven mutants must exit 1: bypass actual throw planning, attract non-due mail,
change the off flight, restore variable assisted steps, cut the preview before late contact, ignore collision ordering,
and restore the old catch radius. No game source is
modified. The 0.6 m opening adds 15 cm; the 1.3 m landing circle adds 30 cm.
Boundary tests accept 0.59/1.29 m, reject 0.61/1.31 m, and retain 0.45/1 m off.

`node tools/phone-mail-hud-check.mjs` checks settings storage and the dashboard
adapter only. It does not prove CSS geometry. The browser row is:

```sh
OUT="$PWD/data/work/phone-hud-delivery" WEB_PORT=5368 CDP_PORT=9568 VITE_MP=1 HUD=1 RUN=phone-hud-browser.mjs VIEWS="phone|x=1" tools/yard-shots.sh 844 390
```

It saves PNGs and `rectangles.json` at 844x390, 932x430, 1000x462,
390x844, 430x932, 375x553, 375x667 and 390x664 in the mail game and both drive-around brands, with
multiplayer and the bike. A local socket stand-in shows a full room without
connecting to a room server. It measures the landscape clear band and the
portrait band (30-72% high, middle 50% wide), MAIL/CAMERA thumb position, viewport fit,
all control overlaps and touch reach, including PULL. It exercises pedal release, map
open/fold, photo feedback, the four-second song chip and the saved toggle.
`layout-check` retains the broader safe-area/size sweep with the compact
status and single-line landscape hint. Browser rows must still be run by the
parent before landing; a Node pass does not verify them.

The phone probe also emulates `display-mode: standalone` in portrait, with
47 px top and 34 px bottom safe areas. It checks safe-top + 16 px for the
whole top row, tests the `navigator.standalone` fallback and `pageshow`, then
returns to the browser's unchanged safe-top + 6 px. It saves standalone PNGs.
This tests geometry, not the actual iOS blur effect. The public shell already
gets `apple-mobile-web-app-capable=yes`, status-bar style `black-translucent`
and manifest `display=standalone` from `tools/build-pwa.mjs`, called by
`tools/build_site.sh`. Those metadata settings are retained.

`hud-text-check` keeps its frozen main text oracle. An explicit single-site
exception adds FPS before desktop free-drive key help; other text stays equal.
The existing state/frame sweep and a removed-FPS mutant enforce that change.

### Review-r1 regressions

The real Mail/Props suite also runs 1,404 sloped launches at 30, 60, 120 and
144 Hz. It compares exact terminal kinematics at identical launch poses,
checks cue/outcome equality, and includes ground `y=0.25*x`, box
`(5,0)`, vehicle `(0,10.05)` at 60 km/h. Ordered contact uses production
`Props.mailHit` and the same side-effect-free reception decision as live mail.
A non-due/stuffed box at `(3.3,0)` intercepts the due box at `(4,0)`; the
preview cannot skip that first hit. The ordering mutant must fail. The preview is capped at two seconds and stops
at first contact; a one-second-cutoff mutant must fail on a late flyer landing.

`node tools/phone-controls-layout-check.mjs --mutations` runs the production
portrait position writer without a browser. An independent rectangle oracle
checks the protected band, viewport, top-row clearance, all control pairs,
touch minimums, PULL and orientation reset in 20,928 cases. It includes short
Safari viewport heights and safe-bottom/standalone variants. Portrait pedals
use available height; when two complete rows cannot fit, MAIL/CAMERA and
utilities stack at the right edge outside the middle band. Fixed pedal height,
ignored bottom inset and disabled absolute placement mutants must fail.
The browser probe includes the same three short sizes and accepts CAMERA
immediately above MAIL in that constrained edge layout.

### Review-r2 landscape fit and preview cost

The same production planner now owns both orientations. The Node rectangle
oracle sweeps widths 320-1100 and heights 265-1000 over orientation-appropriate
grids, with zero/phone safe areas, standalone clearance and mail/PULL variants
(20,928 cases). It includes 553x375, 667x375 with 47 px sides and 21 px bottom,
568x320 and 640x360. A removed-landscape-stack mutant must fail. The planner
stacks actions when 142 px cannot fit outside the middle band. Very short
safe-area views put drive controls at the edges. Narrow/short readouts move
as the same live nodes into the scrolling gear panel; the browser rows check
those functions remain reachable and restore on resize. Their touch bindings
and saved map/radio state remain attached.

The browser probe adds those four cases. To run only the new cases after a
parent's earlier pass, prefix its command with:
`SIZES="553x375 667x375-safe 568x320 640x360"`.
The default still runs every case. This worker does not start a browser.

`node tools/mail-preview-cost-check.mjs --mutations` compares actual current
Mail/Props preview outputs and work with a frozen 5d678ed baseline. It uses
all 469 Mabou mailboxes and six cabinet sites, flat stand-in ground, sixteen
sample stops/headings and 256 simulated frames per profile. Counters are
injected only into the test bundles; production has no timing instrumentation.
The stored baseline records its source and semantic input hash.
The [17 Nov M4 replay](mail-preview-cost-replay.md) restores #101's installed-land
fingerprint after #119 replaced it with an older mirror pin. It records the
intentional opening-contact cost change and the first failing main commit.
Its second section pins the land after #179's step-29 rebake (`3502ef37`).
The frozen engine cannot read #179's styles 6/7, so its stored counters stay
from `b0acc9db`.
`--baseline` prints a fresh baseline from that Git revision without changing
files (it fails on land with styles 6/7); the normal check needs no Git history and reads the committed JSON.

A conservative two-second corridor covers every permitted 35% aim change and
catch radius. It filters once, retaining original target order, then calls
the same Props.mailHit with the subset. Exact input caching checks all launch
values, the next due target, mailbox/site geometry and down flags, plus terrain
revisions. Moving inputs get fresh predictions; unchanged inputs and repeated
same-frame preparation reuse the exact result, including a lit cue.
The case digest also covers moved blockers, down-state changes, terrain changes
and due-state changes. Full-route-per-tick, recomputed-unchanged-preview and
missing-scene-invalidation mutants must fail.

Measured means per simulated frame (preview work, not wall-clock FPS):

| Profile | Ticks before / after | Collision target tests before / after | All target visits before / after |
|---|---|---|---|
| Moving | 55.20 / 55.20 | 25682.05 / 59.64 | 26149.05 / 976.08 |
| Unchanged, warmed | 53.13 / 0 | 24694.81 / 0 | 25161.81 / 473 |
| Same-frame repeat | 110.40 / 55.20 | 51364.09 / 59.64 | 52298.09 / 1449.08 |

All-target visits include due/scene selection (473 per current call) and
corridor filtering (moving mean 443.44). The moving maximum collision count
falls from 58,878 to 239. Live paper collision handling is unchanged. Exact
preview flight/cue digests, the 1,404 sloped cases, ordered interceptions and
all hit-rate counts remain equal to pass 2.

### Additional parent browser evidence on 5d678ed

The parent browser run found native safe-area changes that had no window
resize or DOM-style mutation. The controller now observes the HUD content
box and hint with ResizeObserver. A Node installer test changes only computed
safe-area padding, fires the native content-box notification, and applies the
same safe-area oracle as layout-check. Removing root observation must fail.

Both Node and layout-check now import `hud-layout-geometry.mjs`. The Node
sweep also reads layout-check's complete default size inventory. It covers
long hints, folded/open maps and photo feedback bounds; overflow moves the
same readouts to the gear panel. Portrait hints stay in their corner, and
landscape full hints/arrival notes remain in that panel when space is tight.
Minimum targets stay 56 px (MAIL/CAMERA at least 64 px). These are Node bounds
and lifecycle proofs; the parent must rerun the actual browser rows.

The Just Drive harness now waits on `dataset.mmmReady`, matching the existing
Just Drive checks. Named pages retain their real title; this was a test wait
fault, not a stopped game in the supplied PNG. The radio uses two complete
14 px single lines with ellipses in a fixed 56 px chip; it keeps the four-second
song interval. A source guard checks the wrapping/ellipsis and height budget.

The extended 20,928-case Node sweep includes every legacy layout-check size,
including 280x653 and the plain 320x460 floor, and four portrait hint heights.
Fold-width portrait screens use a lower action row and left-edge utilities
where a 64 px camera cannot fit entirely in the right quarter. The native
safe-area test exercises the actual installer and same browser oracle, then
checks readout/hint reparenting and restoration. Its six geometry/lifecycle
mutants include removing native padding observation and ignoring readout
height. The supplied parent PNG/log evidence is read-only; no images are
copied or edited and no browser is started by this worker.

### Standalone touch-control mount

The geometry check also imports and mounts the real `createTouchControls`
entry point in an empty HTML/event stand-in, matching touch-path-check's
body.replaceChildren fixture. It supplies no settings, gear or game HUD.
Pedal precedence/multiple fingers, utility callbacks, hide/show and blur still
work. A partial shell with startOver outside settings, and a root-only planner
installation without hint/readout/drive slots, also run in both orientations.
`node tools/phone-controls-layout-check.mjs --prior-empty-document` bundles
7c29525's three touch/layout modules and exits 1 with the original missing
settings insertBefore TypeError. Normal checks need no Git history.
The browser touch-path fixture is unchanged. A source guard also requires
the landscape hint to own overflow:hidden so its ellipsis paints inside its
existing single-line rectangle.
## Tall landmarks

`tall` reads all six tall bakes, their manifests, roads and building footprints.
It runs the real instanced renderer in Node and the shared rotation and wire maths.
Road/building conflicts print their original source positions and fail the check;
no base is silently moved. `tall-mutations` includes the base cases and fourteen
negative controls. `tall-browser` proves rotor movement across real drawn frames
and saves the paired pictures through the shared browser starter.

## Far views

`tools/far-views-fetch.py --data-root <real-data>` reads the federal NS and PEI
wind-turbine layers and a windowed MRDEM-30 DTM subset. Its `--sentinel-audit`
reads the recorded 10 m L2A review windows into RAM and retains numerical metadata
only. Measured pad centres, dates, source scenes and uncertainty live in
`pipeline/far-views-points.json`. EA positions are search hints, never bake inputs.

`pipeline/34_bake_far_views.py --data-root <real-data> --output-root
<real-data>/work/bakes/far-views` builds all six work packs. It refuses output
outside `data/work/bakes`; it never writes promoted terrain or site data. It
retains neutral provincial masts/lines from the earlier tall bake, omits whole
conflicting line sections and conflicting masts, and reports those omissions.
The far mesh uses MRDEM, with local NRCan DTM edge matching. Fine coastline cells
are 240 m on desktop and 480 m on LOW; simple inland cells can be 1.92 km.

The five `far-*` Node families cover turbine provenance, curvature, sightlines,
mesh/instance budgets and credits. Each has mutation controls. The ten-row
`far-views-visibility.json` receipt samples at 20 m to 6 km, then 120 m,
using each area's local DTM throughout its terrain root and MRDEM beyond it.
This resolves narrow blocking islands at sea-level viewpoints. It is a clear-air, normal-refraction
geometry calculation at Hill x1, not a weather or vegetation claim.

`far-views-browser` uses a read-only work overlay for before/after game pictures.
`far-near-browser` freezes chase/top views in every area, compares A/B/A/B pixels,
and uses a separate physical-depth pass for opaque interiors within 3 km. Its
mask excludes two-pixel mixed-coverage edges. Both a displaced camera and an
actual shader fault that bends the near world must change those pixels; the
restored shader must return to zero changes. No physical phone FPS is measured.

`far-join-browser` probes the actual sea geometry and shader masks at low Canso,
low Mabou harbour and a high camera, on desktop and LOW. Independent ray coverage,
repeat frames, tiny camera jitter and blend state check for cracks and unstable
overlap. A missing-patch mutant must expose holes. Both sea patches share one
draw and material; the original near plane remains exact inside 3 km.
`far-final-browser` serialises these proofs and pictures within one browser lease.
Its target-removal probe checks physical bare-earth visibility against actual
depth-tested game meshes, including a narrow FOV for subpixel horizon clearances.
Pictures also measure actual terrain/sea triangle interpolation gaps at distant shores.

The shared curvature constant is in `far-rules.ts`. The geometric drop is
`d*d*(1-k)/(2*R)`. Rendering subtracts the 3 km drop and starts smoothly over
3–5 km. All vertices within 3 km retain their coordinates. Only terrain, sea
and these new landmarks receive the distant bend. Physics/contact are unchanged.
The intentional terrain and mirror-terrain vertex programs are fully pinned;
historical water/era/quarry comparisons remove only the exact approved additions.
Global fragment pins are unchanged. The six generated far-sea colour/query
program variants, including their masks and overlap depth, have separate complete pins.


### Far views review r1

`far-bake` exercises real road/track/building clearance for both source types,
immutable positions, exact inventory-removal permissions, and routine manifest
preservation across a same-root terrain bake. Step 33 delegates to guarded v2
work output and is excluded from the routine bake. The Python fixture needs GDAL
and Shapely, like the producer; it creates only tiny temporary synthetic files.

`far-runtime` executes actual late material hooks, inverse-clip reconstruction,
occlusion-query state, conditional late Places, and promoted/work pack selection.
The GLSL blend is evaluated at 3/3.5/4/5/30 km against JS, with blend-removal and
hard-step mutants. The triangle-budget mutant changes only the limit, leaving
metadata, data and hashes consistent. Budget rows prefer a promoted v2 pack;
without one they use an explicit/rehearsal pack. On verified before land (no far
pack anywhere, see `far-delta` below) the pack budgets print NOT MEASURED; the
data-free far-sea program pins and rewrite checks still run. A missing pack
anywhere else, or a missing `FAR_VIEWS_BAKE` override, reports CANNOT RUN, exit 2. Pure source rows need
no bake. Generated far-sea program pins include outer rings and LOW vertex depth.

The widened near proof has standard and lighting variants. Lighting forces
reflections to redraw for every A/B image, enables desktop shadows, uses Hill
x1.7 and the Blender car, in every area and chase/top view. LOW keeps its normal
no-reflection/no-shadow engine path and still tests x1.7. These GPU proofs,
updated join coverage and high-camera edge pictures require an owner's heavy
work window; authoring a proof does not mean it passed.


### Far views data delta (17 Nov)

The code lands before the main thread installs the far pack. `far-delta`
accepts land that is all before (no far file and no `farLand` manifest key in
any area) or all after (the 24 files hashed in `tools/far-views-delta.json` and
the manifest far keys), never a mix; `FAR_EXPECT=before|after` pins one.
`far-delta-mutations` runs seven synthetic mutants. The delta folder itself
(files laid out under `data/baked` paths plus `hashes.json` with before/after
hashes) is made by `pipeline/34_bake_far_views.py` and `tools/far-promote.mjs`
outside `data/`; `node tools/far-delta-check.mjs --delta <folder>` checks it.

`tall` lists conflicts in a `tall.json` that is not version 2 as NOT DRAWN: the
game draws only version 2 (the check asserts the loader line), so the old live
file's 62 line/mast conflicts cannot reach a player. Version 2 conflicts fail.

Budget pins (`frame-budget.json`, `frame-budget-traffic.json`) always mean the
land without the far pack. `tools/baseline/frame-budget-far.json` holds each
row's measured far cost; on verified after land the budget rows compare against
pin + delta, and `--update`/`--raise` store measured - delta. So before install
no row has unflagged headroom, and after install no re-pin folds the far cost
into the pins while the far cost stays as measured. `frame-budget-far` checks
coverage and the round trip. A new budget scene needs a far row too: measure it
on a promoted copy (`--raise --scene <id>` there, minus the pin), or write zeros
before install, in which case that row fails loudly after install until measured.
On after land the budget waits for all far parts, then holds every far query mesh
visible (worst case, not a 5 Hz probe phase).

Phone cost after install, an open choice for the owner. Every phone row gets
the far scenery: +7 draws and +74,198 triangles (+78,030 at the quarry; +10
draws and +75,278 at the Point Tupper start), +7 geometries, +5 programs and
+3 requests (frame-budget-far.json; apple-check-host, 17 Nov, installed land). So after
install the far-aware ceilings themselves pass the frozen `PHONE_CAP` (227
draws, 1,475,392 triangles): new-player-start phone rows 234 draws, works-yard
phone rows 1,529,678 and 1,549,590 triangles. `point-tupper-driver-budget-low`
gates on that cap. On apple-check-host's installed land (18 Nov) main itself draws 222 at
the Point Tupper LOW start with no AI and 227/229/224 with the side by side/
truck/bike shown (truck already 2 over, without this PR); this branch draws the
same before install. After install it draws 232 and 237/239/234. Like the
budget, that check now waits for the far scenery and holds it visible on after
land, so these numbers do not depend on probe timing. This PR does not raise the cap or change
the phone far scenery: the owner decides at install (raise `PHONE_CAP`, or
coarser/no far scenery on phones first).

Traffic pins share the same deltas. The deltas were measured without traffic;
`traffic-budget` and `traffic-budget-desktop` on the promoted copy check the
eight traffic rows against pin + delta.


### Far views review r2

The material hook installs after initial scene construction, before the first
frame, with the uniform off. The actual loader fixture proves existing model
versions/cache keys stay unchanged on activation; only the two sea materials
change. Necessary first-use programs for newly loaded far content are separate
from existing-material recompiles. Actual program totals and freeze size still
need the controlled q=low window. Independent file, binary, constructor and sea
rewrite failures are executed against the actual loader function.

`far-promotion` uses only synthetic temporary packs. It checks the live-key
retention mutant, a stale snapshot ignored by the overlay, exact merge bytes,
all four root invariants, road-change re-screening, no writes on failed hashes,
and before-hash removal sensitivity. Apply in this fixture touches no real data.
The producer checks both live and work inventories and keeps audits outside the
asset tree. Full snapshots are refused, not served. The shared FAR_CREDITS is
required on title and About pages. No native performance or pixel pass is implied.


## Touch UI suite budgets

Quality/Explore, the seven other UI jobs, and each of the eight layout
variants have separate 1800 s budgets. Their host eligibility is recorded per
row in `checks-hosts.tsv`; see the apple-check-host audit below. The new
layout rows have exactly the
quality suite's former globs, so they do not select on additional paths.
The controls and layout rows require `data/audio/out/radio.json` (the dev
page's `audio/radio.json` through `web/public/audio`). The controls row also
visits Just Drive and requires `data/audio/out/radio-just.json`. Quality/Explore
uses `radio=0` and needs neither catalogue. A host without required catalogues
must report a
missing prerequisite, rather than fail the layout's required RADIO control.
The initial radio-less apple-check-host probe demonstrated this missing-input gate.
The split changed no host transfer policy and created no fixture. Public audio
now follows `remote-hosts.tsv` as described above; the initial missing-input
probe is historical evidence, not a current host restriction.

The 28-size layout inventory arrived in #15 (`26e820b2`), and #55
(`005850d6`) added the eight multiplayer/detail/DPR variants to one suite.
The aggregate row was registered with a single 1800 s limit. On main's
16 Nov MacBook control, quality and all 23 Explore cases passed, then the
first layout variant passed all 28 sizes. The second variant was still
passing sizes when the aggregate timeout stopped it. It was not an Explore
hang. Splitting preserves every job, size, assertion and per-row limit. Quality and
Explore are separate from the seven remaining UI jobs too, so each group
retains margin under its own limit. Measured row times are in `checks.tsv`.

Run the complete former suite with:

```sh
tools/check-all.sh --only touch-quality-ui-suite touch-controls-ui-suite \
  touch-layout-mp0-dpr1-low touch-layout-mp0-dpr1-high \
  touch-layout-mp0-dpr2-low touch-layout-mp0-dpr2-high \
  touch-layout-mp1-dpr1-low touch-layout-mp1-dpr1-high \
  touch-layout-mp1-dpr2-low touch-layout-mp1-dpr2-high
```

The controls and layout rows select their original named jobs through
`QUALITY_JOBS`. Without that selector, the suite runs only quality and Explore.
Child output streams to the runner as well as its named log. Start and finish
lines include the job name; finish lines include elapsed seconds and exit code.


## apple-check-host audit (the project brief)

This section is the 16-17 Nov record. Its "MacBook" verdicts for the private-commit
rows, `remote-runner` and the rows the follow-up proves are superseded by the
next section; `checks-hosts.tsv` holds the current labels.

This audit covers the 36 rows labelled `mac-only` on main at the audit start
`68bc9ebfe4070a00b6232fb2dac4ad41804765ed`. The initial series records **27 passing rows,
3 failed rows and six deliberate MacBook-only exemptions**. One explicitly
authorized recheck below adds an intermittent runnable row: current admission
is **28 `apple` rows and eight retained MacBook-only rows**.
The full results and original MacBook/Linux evidence remain in
[`checks-hosts.tsv`](checks-hosts.tsv).

The host was apple-check-host: Apple M4, macOS 27.2.1 arm64, Node 26.13.1 and hardware
Edge 157.0.4341.60 (Apple M4 Metal). Each target row had its own remote-check
invocation, admitted while load1 was below 20. Browser runs also checked load
after setup, before remote execution. Row times below include browser-slot
waits, but exclude transfer/setup. No browser ran on the MacBook for this audit.

Initial-series inputs stayed fixed at baked `f1579e216562e1f7` and public audio
`30a2fcead9904d96`. Verified APFS clones held those inputs while the shared
inputs remained under the main thread's control. Private `data/work` and the
four Mac-only commit references were not sent. Each branch still needs its
own row results; these measurements establish host eligibility for this source.

`budget` passed three times: 529.58, 346.89 and 536.51 seconds. All 32 rows
matched every committed metric in every run: 96 exact rows. `budget-mutations`
passed in 156.05, 57.50 and 61.69 seconds. Its clean fixture had 201 calls,
the expected extra mesh had 202, and its scratch-only raise restored 200 to
201 each time. The traffic rows matched all eight and four selected rows.
Both committed budget JSON files retained their original SHA-256; no pin,
ceiling, measurement case, timeout or game code changed.

The two Blender rows use the task branch's authorized metadata fix:
`needs=-` replaces the hardcoded application path. The checker itself is
unchanged. On m4, `BLENDER=/nonexistent` gave `CANNOT RUN`, exit 2, with the
checker message `SKIP blender-models: Blender is not installed here`.
It did not pass. Normal rows then used the owner's user-local Blender 5.2.2
LTS wrapper. GDAL 3.13.3 was already in the runner's Python environment.
No system symlink or system Python change was needed.

MacBook results in the TSV are historical controls, with their own revisions.
The initial series stopped at each failed m4 row. The single follow-up below
was explicitly authorized; this agent did not rerun other failed rows on m4. A retained
MacBook requirement does not assert that current main passes there.

| Row | apple-check-host result | Proposed proof host |
|---|---|---|
| `pwa-browser` | NOT RUN: Mac-only commit 54c2e80 | MacBook clone |
| `mp-ghosts-check` | PASS 13.06 s | Apple silicon Mac (apple-check-host eligible) |
| `budget` | PASS 529.58 / 346.89 / 536.51 s; 3/3 runs; all 32 rows, every pinned metric exactly matches the unchanged MacBook pins (96 rows) | Apple silicon Mac (apple-check-host eligible) |
| `budget-mutations` | PASS 156.05 / 57.50 / 61.69 s; 3/3 runs; clean 201 calls, expected extra mesh 202 (delta 1), scratch-only raise 200 to 201 each run | Apple silicon Mac (apple-check-host eligible) |
| `trees` | PASS 365.78 s; 132 fixed pictures, 380 moving steps, zero pixel differences | Apple silicon Mac (apple-check-host eligible) |
| `explore-browser-mutations` | PASS 671.51 s; all 52 real-page source mutations caught | Apple silicon Mac (apple-check-host eligible) |
| `damage-browser` | NOT RUN: MacBook timing/HUD oracle; owner documented m4 Edge failure, not rerun | MacBook window / existing proof path |
| `road-scene-browser` | PASS 140.41 s | Apple silicon Mac (apple-check-host eligible) |
| `touch-quality-ui-suite` | PASS 1130.29 s; full registered quality/Explore suite | Apple silicon Mac (apple-check-host eligible) |
| `touch-controls-ui-suite` | PASS 669.31 s; all seven registered UI jobs; both public radio catalogues present | Apple silicon Mac (apple-check-host eligible) |
| `church` | NOT RUN: private data/work never transfers | MacBook clone |
| `wings` | PASS 0.85 s; GDAL Python bindings available (owner setup: 3.13.3) | Apple silicon Mac (apple-check-host eligible) |
| `bridge-source-check` | PASS 0.11 s; GDAL Python bindings available (owner setup: 3.13.3) | Apple silicon Mac (apple-check-host eligible) |
| `building-wing-check` | PASS 0.23 s; GDAL Python bindings available (owner setup: 3.13.3) | Apple silicon Mac (apple-check-host eligible) |
| `utility-mask-check` | PASS 0.43 s; GDAL Python bindings available (owner setup: 3.13.3) | Apple silicon Mac (apple-check-host eligible) |
| `canso-trail-check` | PASS 0.32 s; GDAL Python bindings available (owner setup: 3.13.3) | Apple silicon Mac (apple-check-host eligible) |
| `vehicle-nits` | PASS 22.87 s; unchanged raw state/draw digests | Apple silicon Mac (apple-check-host eligible) |
| `vehicle-nits-mutations` | PASS 16.97 s; unchanged digests and mutation assertions | Apple silicon Mac (apple-check-host eligible) |
| `fishing-rules` | NOT RUN: Mac-only commit 51ed2ec | MacBook clone |
| `road-scene-prior` | NOT RUN: Mac-only commit 2d9ab43 | MacBook clone |
| `touch-quality` | NOT RUN: Mac-only commit ba39f7b | MacBook clone |
| `remote-runner` | FAIL 18.06 s; AssertionError: link-dest did not reuse unchanged data (unchanged-file inode equality failed; the earlier cannot-reach-host text is an expected negative fixture) | MacBook CPU fixture |
| `blender-models` | PASS 9.42 s; Blender 5.2.2 LTS; four committed model files rebuilt and byte-equal; needs-only branch change | Apple silicon Mac (apple-check-host eligible) |
| `blender-models-mutations` | PASS 11.10 s; Blender 5.2.2 LTS; four files byte-equal and quantizer mutant caught; needs-only branch change | Apple silicon Mac (apple-check-host eligible) |
| `paved-pipeline` | PASS 3.71 s; GDAL Python bindings available (owner setup: 3.13.3) | Apple silicon Mac (apple-check-host eligible) |
| `big-buildings-mutations` | PASS 26.15 s; GDAL Python bindings available (owner setup: 3.13.3) | Apple silicon Mac (apple-check-host eligible) |
| `touch-layout-mp0-dpr1-low` | PASS 426.71 s; full 28-size variant; public radio catalogue present | Apple silicon Mac (apple-check-host eligible) |
| `touch-layout-mp0-dpr1-high` | PASS 559.05 s; full 28-size variant; public radio catalogue present | Apple silicon Mac (apple-check-host eligible) |
| `touch-layout-mp0-dpr2-low` | PASS 437.43 s; full 28-size variant; public radio catalogue present | Apple silicon Mac (apple-check-host eligible) |
| `touch-layout-mp0-dpr2-high` | Initial FAIL 595.17 s: 320x640 narrow safe initial: MISSING miniMap radio relief; one authorized recheck PASS 646.35 s, all 28 sizes; intermittent on m4, cause not established | Apple silicon Mac (apple-check-host eligible; intermittent check) |
| `touch-layout-mp1-dpr1-low` | PASS 423.69 s; full 28-size variant; public radio catalogue present | Apple silicon Mac (apple-check-host eligible) |
| `touch-layout-mp1-dpr1-high` | PASS 601.30 s; full 28-size variant; public radio catalogue present | Apple silicon Mac (apple-check-host eligible) |
| `touch-layout-mp1-dpr2-low` | PASS 439.53 s; full 28-size variant; public radio catalogue present | Apple silicon Mac (apple-check-host eligible) |
| `touch-layout-mp1-dpr2-high` | FAIL 595.23 s; FAIL: 1 of 28 sizes have a layout fault; 390x664 wide safe initial: MISSING miniMap radio relief | MacBook window / existing proof path |
| `traffic-budget` | PASS 73.62 s; all 8 selected rows exactly match every traffic-baseline metric | Apple silicon Mac (apple-check-host eligible) |
| `traffic-budget-desktop` | PASS 64.98 s; all 4 selected rows exactly match every traffic-baseline metric | Apple silicon Mac (apple-check-host eligible) |

### Authorized safe-area recheck (17 Nov 2026)

The main thread authorized exactly one further `touch-layout-mp0-dpr2-high`
run for classification. It passed all 28 sizes in 646.35 seconds, exit 0.
The original 320x640 case was clear. The first failure remains in the TSV and
table; it has not been replaced by the passing result.

The recheck used current-main `ff1d4ee3`, Node 26.13.1, hardware Apple M4 Metal
and Edge 157.0.4341.60. Inputs were baked `85965470fead36cd` and audio
`b4e0ba60b6ead8a6`. Admission load1 was 18.08 locally and 17.90 before remote
execution. These source/input revisions differ from the initial audit.
No local checker, case or limit change was made. Main's intervening checker
delta concerned closed-details reach/visibility handling; the safe-initial
measurement remained present.

Classification: **intermittent on m4; cause not established**. Every
sighting of this failure so far was on apple-check-host, so one failure and one pass on
the same host do not show whether the check or the host is at fault. The
main thread withdrew its earlier "not the host" claim on 16 Nov. A pass still
proves the layout, because the row only passes when all 28 sizes are clear.

The row is now `apple` and runnable on m4. A failed branch run still supplies
no passing proof. No automatic retry or relaxed assertion was added. The
multiplayer-on DPR2/HIGH row, `remote-runner`, the private-input rows and the
MacBook timing row retain their existing restrictions.

Proposed branch rule (for the Mabou main thread to adopt): run the rows marked
`apple` through `tools/remote-check.sh apple-check-host --only <row>`, one target row per
invocation. Start a browser row only under the host gate in "Checks on another machine" (17 Nov: load
below 40, or below 20 for a row that measures time), and keep the owner's
browser-slot limit. For browser rows, use the hardware Apple M4 renderer and Edge 157. Supply
the row's required baked data, public audio and tools. Record the source
revision, data/audio hashes, row result and retained diagnostics. The compiler
row that the runner adds is part of normal startup.

The three repetitions of `budget` and `budget-mutations` establish host
compatibility in this audit. They do not replace the branch's own checks.
Keep the existing pins, ceilings, assertions and per-row limits. A failed,
skipped or incomplete m4 row supplies no passing branch proof; record its
exact reason and leave it for the main thread.

At the time of this audit, `pwa-browser`, `fishing-rules`, `road-scene-prior` and
`touch-quality` needed the MacBook clone's private commits, `church` its local
`data/work/areas/church/church.json`, and `damage-browser` was kept on the
MacBook. See the follow-up below for what changed.

## apple-check-host follow-up: the last MacBook rows (17 Nov 2026)

Six of the eight rows the audit kept on the MacBook now run on apple-check-host and are
labelled `apple`. `church` stays `mac-only`: it reads private `data/work`.
`damage-browser` stays `mac-only` until its first m4 pass: its cause is found
and the check is fixed, but no fixed run cleared the load-20 gate on 17 Nov.
Each row's line in `checks-hosts.tsv` holds its result, the commit and the
earlier evidence. Rows ran on apple-check-host itself (`tools/check-all.sh --only <row>`,
hardware Apple M4 Metal, Edge 157.0.4341.60, Node 26.13.1) under the host gate
above. Load was often 20 to 80 from other agents' runs.

| Row | Cause found | Change | apple-check-host result |
|---|---|---|---|
| `remote-runner` | GNU rsync (3.2.4 and later) backslash-escapes option values at `RSYNC_OLD_ARGS=1`: the pre-quoted `--link-dest` reached the host with literal quotes when its path needs quoting, named no folder, and every file was copied. openrsync (the MacBook's) passes values raw. Real host paths have no such characters, so real snapshots linked; the fixture host is `host with spaces` | `RSYNC_OLD_ARGS=2`; the runner also sends local `origin/fixture/<7 hex>` refs, after the same history check (two new test cases, one new mutant) | PASS with GNU rsync 3.5.2 (170.91 s) and with openrsync (192.34 s); 45 mutants caught |
| `touch-layout-mp1-dpr2-high` (and the intermittent `-mp0-dpr2-high`) | likely a check race: boxes and the `phoneReadoutsMenu` class were read in two evaluations 150 ms after a safe-area change, while the phone layout's observers can move the map and radio into the closed Settings menu between them (`phoneReadoutsInSettings` depends on the hint height). Not reproduced on demand | `layout-check.mjs` judges one settled reading: boxes and menu state from one evaluation after two frames, the same menu state and elements twice in a row; a layout that never settles is a fault | mp1: PASS 1186.38 s, then PASS 948.57 s at load 36 after the final change; mp0: PASS 1053.99 s; merged with main: mp1 PASS 720.30 s, mp0 PASS 942.76 s, `layout-check` PASS 719.12 s (764.35 s before); all 28 sizes. Under load these rows take longer than the MacBook's ~600 s, inside the 1800 s limit |
| `damage-browser` | not the frame gap, Settings or pause (all measured): the check set the hint and read the text at once, but `Shift` repaints its hint line only every 0.2 s of game time, and `update(0)` repaints only when that tick is already due | the check waits up to 2 s for the game's own paint; the hint must still be gone 5.5 s after it was set | two FAIL runs before the fix (their diagnostics named the cause); the fixed check has not run yet: relabel `apple` after an m4 PASS |

Two branch rules follow. A failed m4 run is still no passing proof. A `fixture/*`
branch on origin is test input: keep it while a check reads its commit.
