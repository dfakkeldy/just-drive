# Point Tupper infrastructure proof

These are rendered game screenshots. They contain no photo or video reference pixels.

**Superseded figures (18 Nov 2026).** The table and pictures below are the 15 Nov pre-merge run with six batches. The landed code draws three batches (one draw each) and builds nothing at LOW quality, so the phone view now adds nothing. The current paired figures come from apple-check-host (Apple M4, Edge 157) against clean main 0e412bfa. pointtupper-start desktop-explore-truck adds 6 calls, 254,036 triangles, 3 geometries and 2 programs; they are in the commit message that sets the pin.

Code: 46f3b72. Main control: cda5d9c. Date: 15 Nov 2026. Chrome 157, Apple M6 Metal. One serial paired invocation used the same runner, baked data, GPU, cameras and viewports. Desktop is 1400×757. Phone is 390×844. The phone view is browser emulation.

| View | Draw calls, main → branch | Triangles, main → branch | Programs, main → branch |
|---|---:|---:|---:|
| conveyor-desktop | 429 → 435 | 2,838,797 → 2,965,827 | 29 → 32 |
| dam-desktop | 398 → 403 | 3,474,028 → 3,600,638 | 21 → 24 |
| conveyor-phone | 154 → 160 | 1,246,307 → 1,373,337 | 15 → 17 |

New geometry has 9,785 instances, 126,768 instance triangles and 262 cap triangles, in six batches. The instance batches span the area. Counts are from settled frames; they do not measure FPS.

| Check | Result |
|---|---|
| TypeScript and production build | PASS |
| Source/placement check | PASS, 14 mutants rejected |
| Consecutive source spans | Complete against the independent source-pair contract |
| Road clearance | Complete parts match the independent full-road filter; cap interiors and instance envelopes checked |
| Ground and dimensions | Baked samples; midspan clearance, upright axes, true-metre dimensions at stretch 1, 1.5, 3 with sea -0.2 |
| Play flags | PASS, 2,073 states, 25 frames, four transitions |
| Point Tupper desktop/phone area row | PASS, zero console errors |
| Paired cost receipt comparison | PASS, matching GPU, camera and viewport; zero batches on main, six on branch |
| Phone frame budget | FAIL, Mabou start textures 82 > 81; clean main reproduces the same result |
| Changed quick run during development | 109 PASS, 11 FAIL, 3 CANNOT RUN, 1 SKIP, exit 1; not a final-head all-green claim |

Scene construction fell from 11,413 ms to 57.1 ms in the direct before/after check. All parts and cap vertices are identical. The normal Node check measured 73.9 ms, with a 500 ms ceiling. Browser construction measured 27.4–28.4 ms. Raw receipts and the cap hash are in measurements.json.

Known main failures in the broad run: explore, wings, big-buildings and mail-preview-cost. Other rows lacked church/radio inputs, historical git objects, Wrangler, Shapely, Blender or a remote host. One port was occupied. Two build rows ran during a constructor-order error; final TypeScript and the production build pass after the fix. Full site rehearsal was not rerun under the 1 GB scratch limit.

Three fresh Claude Opus 5.5 reviews requested changes. All listed blockers are fixed. The final spatial-grid fix passed the independent oracle and an exact geometry comparison. No fourth review or independent approval is claimed. No merge or deployment.

The source ids, mapped sizes and source decisions are in ../../tools/pt-infrastructure-inventory.md. Extract again with tools/pt-infrastructure-extract.py and tools/pt-infrastructure-ground.mjs. Run the node check through tools/run-node-check.mjs. Browser checks must use tools/yard-shots.sh, which uses tools/browser.sh.
