# Places in four more areas

Game captures only. No photographs, aerial pixels, intensity data or private reference files.
Pictures: Microsoft Edge 157 on the rented Mac mini apple-check-host (ANGLE Metal), through `tools/yard-shots.sh` and
`tools/browser.sh`, on b3743622, the head merged with main f8ae847b of 18 Nov (after #214, #235, #230 and the cemetery places).

| Area | Places | Pictured place |
| --- | --- | --- |
| Port Hood | 6 | Port Hood Station Provincial Park |
| Point Tupper and Port Hawkesbury | 5 | Granville Green |
| Canso Causeway and Troy | 5 | Troy Station trailhead |
| Judique | 4, plus the two hand-built places | Baxters Cove |

Each area has four pictures: `<area>-panel-desktop.png` (1280 × 720), `<area>-panel-phone.png` (390 × 844, touch),
`<area>-place-desktop.png` and `<area>-place-phone.png`. `places-areas-browser.json` records each jump: the road,
distance 0 m, speed 0, heading along the road, and the arrival note.

| Check | Result |
| --- | --- |
| `cd web && npx tsc --noEmit` | PASS |
| `node tools/run-node-check.mjs tools/places-areas-check.mjs --mutations` | PASS: 20 places, 539 site boxes; 20 mutants killed, each by the rule it names |
| `places-areas-browser`, all four areas | PASS: 20 of 20 jumps rest on the road with their own note; each list is the area's places then its cemetery places; phone panels fit and scroll |
| `page-access-browser`, `judique-village-browser` | PASS |
| `just-drive-check` | FAIL, the same on clean main f8ae847b: every catalogue track stays in its station (this host's radio lists) |
| `tools/check-all.sh --changed` (18 Nov, apple-check-host) | 209 PASS, 13 FAIL, 1 CANNOT RUN; see below |

## 18 Nov: merged with main

Main added hand-built sites and place lists after 15 Nov. Three places were then too near them, so each moved
along its own road until it was 150 m clear:

| Place | Before | Now |
| --- | --- | --- |
| Judique village | 45 m from the village buildings of #235 (the store and its neighbours) | Highway 19 south of the village, about 220 m clear |
| Port Hawkesbury | 108 m from the stores and lots of #214 | Reeves Street further west: 205 m from the store and garage boxes, at least 190 m from the lot edges and pylons |
| Creignish | 141 m from a cemetery place | 22 m south on Highway 19, about 160 m clear |

The check now also knows the airport, the Judique village and Port Hawkesbury sites with their small items,
the Mabou main street of #230, the canal line and the deckhand from their modules, and every area's cemetery places. Notes say nothing about
access, parking, opening or events (the rule of `web/src/places.ts`); three notes were reworded for it.

Of the `--changed` run, 12 failed rows fail the same way on a clean origin/main worktree with the same data links:
church (data/work is Mac-only), the five era-density rows and mail-preview-cost-mutations (pinned input hashes
differ from this host's land), radio-edit (the host's radio lists are stale), and paved-open-land, point-tupper-delta-land,
mabou-village-delta-land and judique-lots (this host's baked land is not the land those rows pin). fleet-main-contact failed only because main moved during the run (#85); after merging main it
passes, as does mp-mutations (its first run met a port already in use).
