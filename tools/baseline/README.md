# Frozen keyboard oracle

Never edit these snapshots. A deliberate gameplay change requires an explicit
baseline review, separate from repairing this check.

| File | Source commit |
| --- | --- |
| `vehicle.ts` | `7138b170ef360a7eb5d4b2efebdf629fcc6a5f13` |
| `damage-rules.ts` | `e29bd43bad121928a4fc4e5640092c0f37c6ec6f` |
| `defects.ts` | `e29bd43bad121928a4fc4e5640092c0f37c6ec6f` |
| `roads-old.ts` | `005850d6997189260bc216fcfd8e25a2a002a2f5` |
| `mailboxes-old.py` | `3cdc83f9b548c7daaa647c9cf5eb1699b7869885` |

The two dependencies also existed, byte-identically, at `7138b17`. The first three
files are every game module that the frozen car IMPORTS (`roads-old.ts` belongs to
the road key check, below); `frozen.json` records
their hashes and the check refuses to run if one was edited. The vehicle's
`Car`, `Roads`, `Surface`, and `Terrain` imports are types, erased by esbuild.
The snapshots retain those original imports; they do not load current modules.
Three.js comes from the installed, lockfile-pinned web dependency, as for the
current vehicle. The harness supplies the same sampled terrain, roads and input
to both cars, and gives each its own `Damage` implementation.

Run `tools/check-phone.sh`. No Git history is required. Each of four real routes
must finish within five metres of its end before its binary path, damage events,
bill and progress can match. Both Strong settings are checked at 1/30, 1/60,
1/120 seconds and a seeded uneven sequence. Each sequence has its own frozen
comparison: original driving varies with frame time. For example, the Gravel
replay incurs $55 alignment damage only at 1/120 seconds.

The keyboard and phone suites run in separate Node workers to limit wall time.
Every normal run requires these in-memory mutants to fail their intended
assertions: steering pull without damage, changed pothole density, frame-sensitive
keyboard heading, a ten-frame replay, and heading-help gain 3. The frame mutant
also must pass at 1/60, showing why that rate alone was insufficient.
`PHONE_MUTATE_GAIN` selects the gain mutant (default 3); the command succeeds only
when that mutant is rejected, as well as the normal code passing.

`tools/check-phone.sh --prove-legacy` also rebuilds the former shared-dependency
oracle using these committed snapshots and today's dependencies. It proves that
the damage and defects mutations passed the old comparison. The short-replay
mutation proves that matching truncated paths passed without the progress floor.
All temporary bundles are removed by the shell wrapper.

## What this check does not prove

Both cars drive on today's ground. A change in any of these moves both cars
together, so the comparison still passes:

- `web/src/terrain.ts` (`heightAt`, `surfaceAt`, the contact height) and what it
  reads (`streams.ts`, `coast-site.ts`, `store.ts`)
- `web/src/roads.ts` (`nearest`, `deckHeight`)
- the baked land in `data/baked/terrain` (a re-bake)
- three.js itself (one file, bundled for both)
- the driver in `tools/phone-check.mjs` and the ground in `tools/phone-ground.mjs`

So the pin says: with the same land and the same inputs, today's car, its spec,
its driving help, its damage rules and its road defects give the old car's path
bit for bit. It does not say that the land or the road lookup are as they were.

The visual body shake and the washboard physics draw from one random stream.
A change in how many random numbers the shake draws shows up as a mismatch on
the Mines route (a false alarm for physics, a true one for "same stream").

## Frozen road query oracle

`roads-old.ts` is the byte-identical `web/src/roads.ts` from the source commit
above. Never edit it. `node tools/roads-key-check.mjs` checks its `frozen.json`
hash, bundles it with the installed web esbuild/three.js, and rejects imports
from current game modules. The Terrain import is type-only and erased.

The check compares old/current nearest hits (all numeric fields with Object.is and the
same source road/segment identity) on 2,400 seeded points per real area, every bridge
segment, boundaries and synthetic crossings. The frozen key and source-identity
oracle stays unchanged. Bridge height parity was retired by bridges-fix: connected
abutments, exact top triangles and smooth approaches intentionally replace the old
per-record planes. `bridges-check.mjs` and `bridges-real-check.mjs` verify that new
contract, including a channel-height mutant and real driving/raycast probes.

Grid Map.get and deckHeight wrappers count numeric keys, calls and empty returns
only in the Node harness. Road-only paired Vehicle states retain exact parity;
bridge cases check finite state and bounded calls under the new support contract.
`--mutations` changes only esbuild's in-memory input. Timing is not a gate.

## Frozen mailbox rule

`mailboxes-old.py` holds the mailbox rule of `pipeline/29_bake_props.py` from the
source commit above: that file's helpers, and the driveway and mailbox part of
its `main()` as the function `old_rule`. Three lines are added (the `def`, the
`public` line that stood higher up in `main()`, and the `return`); every other
line below the imports is the file's own text. Never edit it.

`python3 tools/mail-places-check.py` checks its `frozen.json` hash and loads it
with its own network and helpers, so it does not follow a change in today's
code. On every made-up land of that check, today's rule without a road bed move
must give this rule's whole output: the same boxes, in the same order, with the
same styles and tilts. The bake itself gives the stronger proof on real land: a
bake with the bed switch off must leave `props.json` byte-identical.

## Frozen source controls

`source/<check>/<original path>.txt` contains the sources used by historical
comparisons and mutation checks. The added extension keeps the fixtures out
of application builds. Each comparison still loads the same historical code,
with private location and ownership references removed where present.
