# Traffic signals: source inventory, 15 November 2026

Only the four confirmed road junctions below are enabled. No imagery is included.
The positions describe junction centres, not surveyed pole positions. Pole offsets,
head count and the 54-second cycle are simple game approximations. No claim is
made that they reproduce the controller timings or current lane markings.

| Area / junction | Latitude, longitude | EPSG:2961 east, north | OSM ways sharing the intersection |
| --- | --- | --- | --- |
| Point Tupper / Reeves–Pitt | 45.6164885, -61.3563601 | 628146.721, 5052750.914 | [172082133](https://www.openstreetmap.org/way/172082133), [295033946](https://www.openstreetmap.org/way/295033946), [969579513](https://www.openstreetmap.org/way/969579513) |
| Point Tupper / Reeves–Reynolds | 45.6148562, -61.3518213 | 628504.317, 5052576.835 | [172082125](https://www.openstreetmap.org/way/172082125), [181364635](https://www.openstreetmap.org/way/181364635), [626394722](https://www.openstreetmap.org/way/626394722), [969579513](https://www.openstreetmap.org/way/969579513) |
| Point Tupper / Reeves–Trunk 4–Industrial Park Road | 45.6119137, -61.3450488 | 629039.100, 5052260.809 | [480621055](https://www.openstreetmap.org/way/480621055), [480621056](https://www.openstreetmap.org/way/480621056), [480621057](https://www.openstreetmap.org/way/480621057) |
| Point Tupper / Paint–Highway 4–Tamarac | 45.6182954, -61.3351622 | 629795.243, 5052985.769 | [172083222](https://www.openstreetmap.org/way/172083222), [403403156](https://www.openstreetmap.org/way/403403156), [868834906](https://www.openstreetmap.org/way/868834906), [868834907](https://www.openstreetmap.org/way/868834907) |

## Evidence and coverage

- The town-hosted [Active Transportation Plan](https://townofporthawkesbury.ca/wp-content/uploads/2023/11/transportation-plan.pdf), printed page 38, Trunk 4/4A, explicitly identifies traffic lights at Paint Street/Tamarac Drive and Reeves Street. Paint/Tamarac is added from this public source; no dash-cam images or stills are copied, committed or uploaded. The OSM Tamarac incoming leg is included; its separate outgoing slip leg is not given an opposing head.
- The town-hosted [Reeves Street traffic study, October 2014](https://townofporthawkesbury.ca/wp-content/uploads/2023/11/1438272316Reeves-St.-Report.pdf), section 2.1.3, printed page 4 (PDF page 7), identifies traffic signals at Pitt, Reynolds and Trunk 4. This is the signal-status evidence; road geometry alone does not establish signals.
- The [3 December 2019 council minutes](https://townofporthawkesbury.ca/wp-content/uploads/2023/11/1579893999Minutes_PublicMtg_Dec3_2019_FINAL.pdf) discuss pedestrian/traffic sequencing at Reeves–Reynolds.
- Provincial corroboration for Pitt/Reynolds: [Nova Scotia Legislature, 25 October 2019 Hansard](https://nslegislature.ca/sites/default/files/pdfs/proceedings/hansard/63-2/h63oct25.pdf), “TIR: REEVES STREET PLAN – RESTORE TURN SIGNAL”. Printed page 4718 (PDF page 41) names flashing green left-turn signals for Reynolds and Pitt Streets; read directly on 16 November 2026. Not a geospatial inventory.
- Junction coordinates and outward approach directions come from the bake's existing `raw/areas/pointtupper/vectors/osm.json` road geometry (OpenStreetMap contributors, ODbL). Projection uses EPSG:4326 → EPSG:2961. The nearest baked provincial road segments are approximately 0.3–3.5 m from those centres. Every rendered approach is further matched to its named baked road within 12 m; an unmatched approach is omitted.
- The existing OSM extracts for Mabou, Judique, Port Hood, Point Tupper, West Bay and Canso Causeway contain **no signal nodes**. Their fetch query in `pipeline/01_fetch_vectors.py` selects ways and selected non-highway nodes; it does not request `node[highway=traffic_signals]`. This is a coverage gap, not evidence of absence.
- Live Overpass retries: `overpass-api.de` HTTP 406; Kumi and private.coffee timed out. No new live signal-node inventory was obtained. A later inventory can extend this small source list without a terrain bake.
- No signalised road junction was established in the reviewed sources for the other five areas. That is not a claim that none exists. Pedestrian-only crossings are outside this junction cycle.
- [Provincial Port Hastings design](https://novascotia.ca/tran/highways/highway-104-port-hastings-roundabout.pdf) describes conditional Highway 105/Trunk 4 signals during swing-bridge operations. The [22 October 2024 provincial update](https://news.novascotia.ca/en/2024/10/22/port-hastings-intersection-upgrades) describes a changed intersection. Excluded from an ordinary fixed-cycle implementation pending a current geometry/operation inventory.

## Traffic hook

`TrafficSignals.stopDistance(x, z, forwardX, forwardZ)` returns metres from the
car centre to the nearest red/amber stop line, or `Infinity`. The forward vector
must be unit length in world x/z. Subtract the car's front reach and brake before
zero; do not teleport or clamp a moving car at the line. Vehicles past the line
are released to clear the junction. The method shares the exact clock used by
the lamps and freezes with `worldRuns`. In `main.ts` the handle is null where no signal
stands (every other area, and 1884), so a caller writes
`trafficSignals?.stopDistance(x, z, fx, fz) ?? Infinity`; the update runs as a
`after-activities` world-registry entry right after `roads`. PR #155 was OPEN during implementation;
its integration is deliberately left to that change/main-thread reconciliation.

Fourteen approaches use five instanced draws, 336 pole triangles + 168 housing triangles
+ 420 lamp triangles (924 total), zero point lights and zero shadow casters.
Ground sampling is bounded to fourteen queries per half-second within 800 m. Matrices
upload only when ground height changes; lamp colours upload only at phase changes.
Other areas and 1884 have no visible signal draws, and in Point Tupper the group
is hidden when the camera is more than 1 km from every head (the meshes are not frustum culled).

## Next steps from the 15 November drive

- Locate and source the crosswalk with flashing amber beacons; implement a pedestrian warning pattern, not an ordinary junction cycle. The plan also mentions a signalized Queen Street crossing, but that does not establish that it is the amber crossing in the drive.
- Locate and source the flashing light suspended over Reeves Street; confirm its colour, approach coverage and operation before placing it.
- Locate and source the rail crossing and its warning hardware; use a separate train-triggered crossing state rather than a junction timer.

These are follow-ups, not claimed implementations. The private drive is an observation lead; public geometry and operating evidence are still required.
