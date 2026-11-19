# Rule mutation audit

Base: `f965706`, current `origin/main` when this branch started on 15 November 2026.

| Module in web/src | Original check row | Mutant row | Gap at start / action |
|---|---|---|---|
| damage-rules.ts | shift, damage-check.mjs | damage-rules-mutations | Added four mutants |
| fishing-rules.ts | fishing-rules | fishing-rules, embedded fishing-mutations.mjs | Covered |
| guardrail-rules.ts | guardrails | guardrail-mutations | Covered |
| jump-rules.ts | jump | jump-rules-mutations | Added four mutants |
| mailbox-rules.ts | mail-stage2 | mail-stage2, embedded --mutations | Covered, four mailbox-rule mutants |
| mine-rules.ts | mine | mine-rules-mutations | Added four mutants |
| property-lines-rules.ts | property-lines | property-lines-mutations | Covered |
| road-scene-rules.ts | road-scene | road-scene-mutations | Covered |
| school-bus-rules.ts | school-bus | school-bus, embedded --mutations | Covered |
| shift-rules.ts | shift | shift-rules-mutations | Added four mutants |
| yard-dog-rules.ts | yard-dog, yard-dog-rules | yard-dog-rules-mutations | Existing yard-dog row mutates placement only. Added a pure-rule check and four rule mutants |
| lot-props-rules.ts | lot-props-rules | lot-props-rules-mutations | New module (lot props at houses, 19 Nov 2026): pure check on a made-up street and every Mabou house, four rule mutants |

Open PR audit used `gh pr diff --name-only` for each open PR: #11, #85,
#99, #118, #122, #123, #124, #125, #126 and #127. None changes the eleven
rule modules on this base. No current module is skipped. These rule modules
exist only in open PRs and are outside this branch:

| Module proposed by open PR | Check | Mutant row | Gap |
|---|---|---|---|
| cemetery-rules.ts, PR #99 | Not audited | Not audited | skipped: open PR |
| road-animal-rules.ts, PR #118 | Not audited | Not audited | skipped: open PR |
| far-rules.ts, tall-rules.ts, PR #122 | Not audited | Not audited | skipped: open PR |
| stunt-rules.ts, PR #85 | Not audited | Not audited | skipped: open PR |

## Plan and check contract

1. Read the registry and existing school-bus and phone-speed-cap mutants.
2. Compare every current rule module with the files changed by each open PR.
3. Add missing rows. Use four single-rule edits per module. Reuse permanent
   checks; add a pure yard-dog check because its existing runner builds its own
   bundle and only injects a placement mutant.
4. Run `tsc`, every new row, and all eleven modules' original check rows.
5. Obtain an independent Claude Opus 5.5 review and open a draft PR.

`node tools/rule-mutants.mjs <name>` runs the original check without edits,
then with each mutant separately. Names: `damage`, `jump`, `mine`, `shift`,
`yard-dog`, `yard-props`, `lot-props`. `--base` runs only the unmodified check. Mutation anchors must occur
exactly once. Build failures, timeouts, signals and non-assertion errors do not
count as kills. Every mutant must exit 1 with an assertion failure.

| Suite | Single-rule changes |
|---|---|
| damage | Landing speed, alignment speed, washboard speed, ditch depth |
| jump | Launch speed, placement continuity, landing roll, settling slide |
| mine | Bend speed, recovery time, fork direction, signature branch |
| shift | Suspension count, skipped day, vehicle allowance, double-day union, property damage suspension |
| yard-props | Protected place, driveway, shoulder, mailbox and overlap clearances; garbage day; break speed; pieces at rest; bale on a slope; bale in woods; props in water; props at the shore |
| yard-dog | Pause gate, trigger range, follow limit, bark event |
| lot-props | Vehicle share, public road clearance, own lot, driveway mouth, clear of yard props |

The runner uses the existing `mutationSources` helper and an esbuild load
plugin. Each child check runs in a separate Node process. One temporary bundle
is reused, then removed in `finally`. No game source or land data is written.
All twenty mutants were rejected on the first run; no mutant was dropped.
The four reused permanent checks needed no stronger assertions.

## Validation on the rented Mac

| Check | Result |
|---|---|
| tsc | PASS |
| damage-rules-mutations | PASS, 4/4 killed |
| jump-rules-mutations | PASS, 4/4 killed |
| mine-rules-mutations | PASS, 4/4 killed |
| shift-rules-mutations | PASS, 4/4 killed |
| yard-dog-rules-mutations | PASS, 4/4 killed |
| shift, jump, mine | PASS, including damage and integration checks |
| fishing-rules | PASS, including contact and shader mutations |
| road-scene, property-lines, guardrails | PASS |
| school-bus, mail-stage2, yard-dog | PASS, including embedded mutants |

The first fishing wrapper run could not find historical object `51ed2ec`.
GitHub resolved it to `51ed2eca01ab879561e8561e60b502f9c04cced5`.
After fetching that object, the unchanged wrapper passed. No baseline changed.
The full CPU or browser suites were not run. This change affects checks only.
Scratch stayed below 10 MB and was removed after the runs.

## Independent review

Claude Opus 5.5 approved in round 1. The reviewer ran all five suites and
confirmed all twenty kills came from behavior assertions. One low-severity
finding was fixed: a plain `yard-dog-rules` row now runs the pure check under
`--quick`. Full runs use the mutation row's baseline pass instead of running
the plain check twice. No runner or production logic changed after review.
