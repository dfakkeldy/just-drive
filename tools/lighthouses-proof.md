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

The kit's own cost in the frame-budget scenes is limited to `pointtupper-start`, where five Point Tupper and Causeway lights are in view (694.4, 694.5, 698, 701, 702). Measured against main 2ff427c7 in one session:

| Mode | Calls | Triangles | Geometries | Programs | Textures |
|---|---|---|---|---|---|
| phone-explore-truck | 211 → 212 | 1,249,852 → 1,252,624 | 122 → 123 | 16 → 17 | 60 → 60 |
| desktop-explore-truck | 947 → 949 | 4,682,923 → 4,688,467 | 282 → 283 | 36 → 37 | 140 → 140 |

Only phone geometries (pin 122) and desktop programs (pin 36) crossed a pin, and each is raised by exactly one. The reason is recorded in `tools/frame-budget-policy.mjs`. Every other budget failure on this host is shared with unchanged main.

## What is not built

Ten fixed lights are withheld: missing published heights, structure support that could not be checked, or the Cape Porcupine front light inside the baked rail corridor. Port Hood Island and Judique South are among them. The 26 lighted buoys are inventoried but not modelled. All of these stay in `lighthouses-sources.md` for follow-up work. Open lanterns and skeleton lamps have no central mounting column.
