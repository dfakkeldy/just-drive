# Lighthouse verification

Run 18 Nov 2026 on the Mac M4 check host: Microsoft Edge 157 (ANGLE Metal, Apple M4), hardware GL. These are counts, not timings.

## Browser row

`lighthouses-browser` passes all eight cases (Mabou and Port Hood, desktop and phone, day and night). Each case measures the frame with the kit drawn and then hidden in the same page. Night cases also draw the beacon on and off and read a 7 × 7 pixel patch, once from the street camera and once from about 1 km away on a clear sight line. Day builds no beacon geometry or shader.

| Case | Calls kit off → on | Triangles kit off → on | Near / far night pixel difference |
|---|---:|---:|---:|
| mabou-desktop-day | 228 → 231 | 1414007 → 1414163 | day: no beacon mesh |
| mabou-desktop-night | 229 → 233 | 1414007 → 1414243 | 9683 / 2825 |
| porthood-desktop-day | 132 → 133 | 984142 → 984206 | day: no beacon mesh |
| porthood-desktop-night | 133 → 135 | 984142 → 984446 | 9180 / 3458 |
| mabou-phone-day | 164 → 167 | 1114917 → 1115073 | day: no beacon mesh |
| mabou-phone-night | 165 → 169 | 1114917 → 1115153 | 3488 / 3470 |
| porthood-phone-day | 81 → 82 | 700482 → 700546 | day: no beacon mesh |
| porthood-phone-night | 82 → 84 | 700482 → 700786 | 3134 / 3455 |

Counts are from the run at b09dea4c on main af34c758. The row passed again at 877b690b and at 5918439b, after the pause-time change.

## Node rows

`lighthouses` and `lighthouses-mutations` check the placement against baked PNG heights using the actual instance matrices and bounding boxes. They require a source distance under 3 m and clear beacon sight lines, at two exaggeration/sea-level pairs. Nine mutants are rejected.

## Budget

The kit crosses a budget pin only at `pointtupper-start`, where five Point Tupper and Causeway lights are in view (694.4, 694.5, 698, 701, 702). Measured against main 97100198 in one session:

| Mode | Calls | Triangles | Geometries | Programs | Textures |
|---|---|---|---|---|---|
| phone-explore-truck | 211 → 212 | 1,249,852 → 1,252,624 | 122 → 123 | 16 → 17 | 60 → 60 |
| desktop-explore-truck | 997 → 999 | 4,745,271 → 4,750,815 | 283 → 284 | 46 → 47 | 150 → 150 |

The pins are raised by exactly this share: phone calls 211 → 212 and geometries 122 → 123; desktop calls 988 → 990, geometries 279 → 280 and programs 45 → 46. The reason is recorded in `tools/frame-budget-policy.mjs`. On this host unchanged main is already above its own desktop pins here (997 calls, 283 geometries, 150 textures, 46 programs against 988 / 279 / 148 / 45). That excess belongs to main and is not pinned here, so this desktop row still fails on this host on main and on the branch alike.

Elsewhere the kit has a small cost that stays under every pin. Mabou light 876 is in view from `mines-lookoff-south`, which takes up to +5 calls, +5 geometries and +1 program on desktop, and +3 calls, +3 geometries and +1 program on phone. `harbour-water` and other Mabou scenes take about +2 calls and +2 geometries. The full `tools/check-budget.sh` passed on this branch at c0a07e5a, before main's 97100198 desktop re-pin: 34 scene/mode rows, 312 s, load1 under 20. The PR records the result on the current base.

## What is not built

Ten fixed lights are withheld: missing published heights, structure support that could not be checked, or the Cape Porcupine front light inside the baked rail corridor. Port Hood Island and Judique South are among them. The 26 lighted buoys are inventoried but not modelled. All of these stay in `lighthouses-sources.md` for follow-up work. Open lanterns and skeleton lamps have no central mounting column.
