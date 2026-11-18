# Public wharf kit: receipts

Measured on apple-check-host (Apple M4, Edge 157; the page reports the masked renderer "WebKit WebGL") with `tools/check-all.sh --browser --only wharves-browser`.
That run used head `c5af1ffa` against an exact archive of `origin/main` `8866b76b`. Both used the same baked land, browser, viewport and camera.
`wharves.json` holds the raw numbers. These receipts replace the 15 Nov receipts, which predate the building exclusion and the per-wharf refresh.

## Matched cost, every render pass

Each area has one representative view, the same for main and branch. "Plan ms" is one forced re-plan of every wharf near the camera. A tile load or LOD switch under a wharf pays this cost once.

| Area | Mode | Calls main → kit | Triangles main → kit | Programs main → kit | Plan ms |
|---|---|---:|---:|---:|---:|
| mabou | desktop | 780 → 780 | 3,375,190 → 3,375,190 | 39 → 39 | — |
| judique | desktop | 363 → 371 | 1,825,926 → 1,838,750 | 31 → 32 | 7.9 |
| porthood | desktop | 524 → 534 | 2,514,396 → 2,527,784 | 32 → 33 | 11.3 |
| pointtupper | desktop | 600 → 610 | 3,568,428 → 3,572,448 | 37 → 38 | 8.2 |
| cansocauseway | desktop | 464 → 466 | 2,300,714 → 2,300,834 | 28 → 29 | 1.7 |
| westbay | desktop | 894 → 894 | 5,000,312 → 5,000,312 | 34 → 34 | — |
| mabou | phone | 185 → 185 | 905,299 → 905,299 | 17 → 17 | — |
| judique | phone | 67 → 71 | 461,489 → 467,901 | 15 → 16 | 8.9 |
| porthood | phone | 75 → 77 | 653,937 → 659,913 | 14 → 15 | 11.0 |
| pointtupper | phone | 96 → 98 | 1,179,373 → 1,180,665 | 18 → 19 | 5.8 |
| cansocauseway | phone | 93 → 94 | 753,821 → 753,881 | 13 → 14 | 1.0 |
| westbay | phone | 183 → 183 | 1,356,717 → 1,356,717 | 14 → 14 | — |

The row now asserts these figures. Areas with no wharves must show zero change. Dressed areas may add at most 14 calls, 20,000 triangles and one program.
The kit and its `wharves` dev key exist only in areas that have wharves.

## Gallery

The row checked all ten area-source records at desktop 1280×720 and phone 390×844. Each picture has at least one rendered part and more than 20 changed pixels in its close view. This folder keeps one desktop picture per dressed area. The full set of 20 stays in the runner's evidence folder.

- `judique-row-r6gi_w22v_zyq8-desktop.png`: Baxters Cove
- `porthood-row-ntv9_cwgp_jddg-desktop.png`: Little Judique Harbour
- `pointtupper-row-m54w-hjqu_3s76-desktop.png`: Port Hawkesbury waterfront
- `cansocauseway-row-k8yh-suyv_izrt-desktop.png`: Aulds Cove

## Known limit

The baked land has no wharf deck surface. Where a source outline runs over grass, the curb follows the outline across the grass (see the Port Hood pictures). A deck surface would be a land delta for the main thread; this PR makes no land change.
