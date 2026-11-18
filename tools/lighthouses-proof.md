# Lighthouse verification

Native Apple M6 / ANGLE Metal, Chrome for Testing 157.0.8103.78. Main baseline 4adaa588392dfa5f951f35de2ff621617dec9315. Same browser run, identical cameras and settings. The dev-only mutation replays the exact baseline main.ts. Other pre-existing render modules are unchanged. credits.ts changes text only. All eight cases pass. These are counts, not timings.

| Case | Calls main → branch | Triangles main → branch | Programs main → branch | Near / far night pixel difference |
|---|---:|---:|---:|---:|
| mabou-desktop-day | 232 → 235 | 1523310 → 1523466 | 27 → 30 | day: no beacon mesh |
| mabou-desktop-night | 233 → 237 | 1523310 → 1523546 | 23 → 25 | 9683 / 2825 |
| porthood-desktop-day | 128 → 129 | 1030826 → 1030890 | 22 → 25 | day: no beacon mesh |
| porthood-desktop-night | 129 → 131 | 1030826 → 1031130 | 18 → 20 | 9180 / 3458 |
| mabou-phone-day | 186 → 189 | 1224896 → 1225052 | 13 → 14 | day: no beacon mesh |
| mabou-phone-night | 187 → 191 | 1224896 → 1225132 | 14 → 16 | 3488 / 3470 |
| porthood-phone-day | 77 → 78 | 747166 → 747230 | 9 → 10 | day: no beacon mesh |
| porthood-phone-night | 78 → 80 | 747166 → 747470 | 10 → 12 | 3134 / 3455 |

The far probe is about 1 km away, with an elevated clear line of sight. Night probes draw with and without the actual beacon and read a 7 × 7 pixel patch. Day builds no beacon geometry or shader.

TypeScript, light placement against baked PNG heights, nine mutants, night rules, and play-flags plus its mutants pass. The placement check uses actual instance matrices and bounding boxes, source distance under 3 m, clear beacon sight lines, and two exaggeration/sea-level pairs.

Independent Claude Opus 5.5 reviews: three fresh rounds. Final round at 4279c30 found no new blocker for an explicitly incomplete draft. It did not approve completion or merge. Final runtime pass followed that review. Minor remaining model detail: open lanterns and skeleton lamps have no central mounting column.

The full request remains incomplete: ten fixed lights are withheld, including Port Hood Island and Judique South; 26 buoys are inventoried but absent; full OSM coverage is unresolved. See lighthouses-sources.md and the PR.

## Phone budget

`tools/check-budget.sh --phone` exits 1. The intended tower cost exceeds both Mines lookoff phone pins by 3 calls, 156 triangles, 3 geometries and 1 program. An exact-main control of new-player-start and Mines confirms the new-player phone-mail texture failure is shared: 82 textures against 81 on both. Main passes the two Mines pins; the branch alone adds the stated tower cost. Budget pins are unchanged while the full feature is incomplete.

The broad `--changed --quick` suite was listed but not run. Broad fixture verification under the 1 GB scratch cap is still outstanding. The focused registered rows above and the play-flags fixture ran. No broad green claim is made.

All eight final game pictures were opened and inspected. The two Murphy Pond night pictures are captured at the on phase for a readable flashing-light record; the live shader resumes its listed period in normal use.
