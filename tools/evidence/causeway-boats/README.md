# Causeway boats

Game captures only. No photographs, aerial pixels, intensity data or private reference files.
Head bdcbfe51 (origin/main 76bee8db merged), rented Mac mini apple-check-host, Apple M4 Metal, Edge 157.0.4341.60, 17 Nov 2026.

| Check | Result |
| --- | --- |
| `tsc`, `canal` (Node) | PASS; 23 source mutants and the bridge-perpendicular route rejected; real `Canal` and `AmbientTraffic` coupled at every stop-line distance, with a player at the far gate, two cars behind them, and a parked player |
| `ambient-traffic`, `ambient-traffic-mutations` | PASS; 45 mutants killed (6 new: queue pass rule, spawn keep-out) |
| `fleet-main-contact`, `pause-map`, `dev-hooks(-mutations)`, `horse-pass2`, `point-tupper-driver`, `traffic-signals`, `pause`, `weather`, `engine-sound` | PASS |
| `canal-browser` | PASS; game frames advance the canal (11 s to 13.55 s in 2.5 s), a hidden tab and fly mode freeze it, it runs again after; real player stopped at -85.728 m behind six queue cars, then released at 133.36 m; one boat |
| `canal-browser` with `canal?.advance` removed from main.ts | FAIL as required (clock stays at 11 s) |
| `canal-traffic-browser` (new) | PASS; real traffic pool on the baked Canso roads for 300 s plus a picture run: 4 transits, 8 cars waited at the barrier, 23 spawns, none over the hidden deck, through a closed gate or in a queue car |
| `causeway-browser` (Point Tupper crossing), `ambient-traffic-browser`, `point-tupper-driver-browser` | PASS |
| `budget`, `traffic-budget` | PASS; no limit changed (the canal draws only in `cansocauseway`, which no budget scene covers) |
| Water route | Full cargo envelope plus side margin; maximum baked ground -0.677974 m, below water -0.2 m |

Files: `canal-desktop.png`, `canal-phone.png` (transit, queues, closed arms), `canal-traffic.json` (player stop and
release, frame checks), `canal-traffic-desktop.png` and `canal-traffic-run.json` (traffic waiting behind the queues).

Boats: at most nine draw nodes, fewer than 2,000 triangles including all six queue cars, no image textures, no names or
marks. Highway traffic gets stopped stand-ins (no draws).

Known limits: the deck is hidden during a passage (a swing model awaits drawings); road paint, rail and wires stay.
The arms span both lanes, so a car leaving the span passes through a closed arm. Queue cars stop a car driving into
the queue, not one reversing or turning into them. Parked fleet bodies and a trailer are not counted as on the span.
In a multiplayer room the road stays open (no boats).

No bakes, site writes or deployment. Read-only baked/audio links were used.
