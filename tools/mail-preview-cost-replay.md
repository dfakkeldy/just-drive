# Mail preview cost replay, 17 Nov 2026

The first failing main commit on the M4's installed Mabou land is
`0ff513c4d2f529346efdd32cd31dc4fb4ba5b2f5` (#119, opening contacts).
Its parent `f05b7d6c` passes with the same read-only baked input. The failure
predates #153, #158 and #179. Current main was `3889d796` during this replay;
`68bc9ebf` also contains the faulty pin.

#101 (`1f383c43`) installed the road-shaped land pin `b0acc9db`. #119 replaced
it with the older Linux mirror pin `e71af5f5`. On this M4, the actual input
is **b0acc9db** and main expects **e71af5f5**, the reverse of the issue's
reported expected/actual order. The hash covers mailbox positions, headings,
styles, tilts, groups, parcel boxes, community-box geometry and village origin.
This replay restores #101's input pin. It does not accept arbitrary inputs or
change any cost ceiling. A stale mirror needs the matching installed land.

The Stage 2 flight digest changes for a separate, intentional reason. #119
replaced solid-box contacts with opening contacts. Running its exact code on
the installed land produces digest
`16faa27502794a5d7fd5eab77a15495abd350cf4ca51f30b5d81aa67d809db03`.
Current main produces the identical digest **and every identical work counter**.
The frozen `5d678ed` engine was also replayed with the current invalidation
witness. Its work counters exactly match the stored old-engine counters;
its documentation digest is `71536fa3` because #119 changed that witness.

Per-frame means from the passing parent and #119/current main:

| Profile | Physics ticks, parent / current | Collision tests, parent / current |
| --- | --- | --- |
| Moving | 55.19921875 / 73.4375 | 59.640625 / 82.125 |
| Unchanged, warmed | 0 / 0 | 0 / 0 |
| Same-frame repeat | 55.19921875 / 73.4375 | 59.640625 / 82.125 |

Current moving collision tests remain 99.68% below the frozen engine's
25682.046875 mean. Maximum moving collision tests are 303, versus the frozen
58878. Repeated preparation adds no ticks or collision tests; the repeat
cache-hit mean is 0.9375. All three mutants are killed: full-route scanning,
recomputing unchanged inputs and removing scene invalidation.

## Reproduce

Use the installed land symlink and `npm ci --prefix web`. These are Node rows;
Edge and the renderer are not involved. Source the M4 runner environment:

```sh
while IFS== read -r k v; do export "$k=$v"; done < ~/mmm-runner/host.env
export PATH="$PATH_PREPEND:$PATH"
node tools/mail-preview-cost-check.mjs
node tools/mail-preview-cost-check.mjs --mutations
```

Both commands passed on apple-check-host. No baked or site data was written.
To repeat the historical bisect from a clean worktree on that same input:

```sh
git bisect start 3889d796 f05b7d6c
git bisect run node tools/mail-preview-cost-check.mjs
git bisect log
git bisect reset
```

All tested midpoints failed on the input assertion: `7a69be72`, `0afd04a3`,
`4adaa588`, `c6df6529`, `0ff513c4`. The parent was separately run and passed.
The search expanded beyond the last fifteen merges because the pin replacement
already predates that interval. For comparison reports at #119 and main, run
`node tools/mail-preview-cost-check.mjs --record-stage2`; to replay the frozen
engine, run `node tools/mail-preview-cost-check.mjs --baseline`. These commands
print JSON and do not write the baseline.

## #179 land pin, 17 Nov 2026 (the project brief)

After #192, this M4's installed land got #179's dash cam delta and the step-29
prop rebake that #179 asks main to run. The row then failed on main `fece5947`:
expected `b0acc9db`, actual `3502ef37`. Current code on the 14 Nov `b0acc9db`
land still passes with digest `16faa275`, so no code changed the result. Of the
hashed inputs, only the mailbox list changed; community boxes and the village
origin are equal. The installed mailbox list matches main's reviewed step-29
receipt in `tools/road-scene-delta/step29-hashes.json` (#199).

| Change | Boxes | Landed cause |
| --- | --- | --- |
| Style 1–5 → new style 6 or 7; tilt, group, parcel box equal | 14 | #179 step 29: 3% per-building draw for single-box sites |
| Added | 2 | #179's two hand-placed houses near 624080,5100430 |
| Moved about 0.35 m toward the road centre | 2 | #179: MacKillop Road gravel half-width 2.6 → 2.25 m |

The pin is now `3502ef37` (469 mailboxes); the opening-engine digest is
`837ed894`. Current per-frame means against the `b0acc9db` replay above:

| Profile | Physics ticks, b0acc9db / 3502ef37 | Collision tests, b0acc9db / 3502ef37 |
| --- | --- | --- |
| Moving | 73.4375 / 70.3125 | 82.125 / 77.73828125 |
| Unchanged, warmed | 0 / 0 | 0 / 0 |
| Same-frame repeat | 73.4375 / 70.3125 | 82.125 / 77.73828125 |

Fifteen boxes now use style 6 or 7: the 14 restyled ones and one added box.
Selection grows by two per frame. The repeat cache-hit mean stays 0.9375.

The frozen `5d678ed` engine rejects styles 6 and 7, so `--baseline` cannot
run on this land. The stored profiles stay that engine's unmodified run on
`b0acc9db` (`frozenInput` in the JSON). As a reference only, a scratch copy
with styles 6/7 mapped to legal styles (0/4 or 5/4, same result) gives moving
collision tests of 25792.078125, 0.43% above the stored 25682.046875, with
equal ticks. Keeping the stored value is the stricter limit. No cost limit changed.
