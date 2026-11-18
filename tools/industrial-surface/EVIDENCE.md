Gary (GPT-6.1-Sol, surface audit): initial evidence list, before any bake changes.

| Baked road | Current | Open-data evidence | Proposed correction |
| --- | --- | --- | --- |
| 634, unnamed service loop at Highway 19, EPSG:2961 E623086.92 N5102219.13 to E623040.40 N5102163.38 | kind 4 (track surface), 158 m | Cached OSM way 720386058: highway=service, oneway=yes, surface=asphalt; 100% of baked line lies within 10 m. NS ROADSEGID 825846 identifies DRIVEWAY and does not specify paved/unpaved. | kind 2 (paved), retain width, geometry and all other fields |

Evidence: https://www.openstreetmap.org/way/720386058 . This is a cached-source finding; live OSM fetch through the web tool failed. The provincial record does not contradict asphalt, but does not independently confirm it.

The first spatial pass found no >80%-coverage OSM surface mismatch among kind 2/3 public roads. Minor-road pass found the single asphalt candidate above. No separate junction-apron object exists in roads.json: stage 25 raster fields inherit the nearest road segment's kind. The plan was to change only pixels owned by road 634 (withdrawn later; see the status line below), including its junction approach where it wins; no inferred apron extension. Mabou Mines Road remains unchanged and washboard. This is bounded cached-source coverage, not a claim that all present-day surfaces are correct.

Gary (GPT-6.1-Sol): additional evidence BEFORE the Industrial Park bake edit.

Point Tupper road107: Industrial Park Road, 4276.03m, kind4. Provincial Industrial Park Rd records identify paved two-lane local roads, including privately owned segments (e.g. ROADSEGID67647,931058,1450999,1451000). The bake's OWNER=P precedence currently assigns track even when FEAT_DESC says Paved. Cached OSM way181364590 says surface=paved; way480621055 says asphalt. Dan's 15Nov dash-cam report is the reason for revisiting this road: paved with double yellow lines throughout. Footage and stills remain private.

Proposed delta: Point Tupper road107 kind4->2, preserving width, geometry, flags and all other roads. Existing paved roads104–106 stay unchanged. This surface-only task does not add centreline paint or widen the road.

Next steps, from the private report: map the closed end on Granville St near E627233 N5053179 and on Reeves St near E627443 N5053518 (EPSG:2961). Both have lamp boards and barriers. Keep closures out of this surface-only patch.

Status, 16 Nov 2026 (Opus finisher): road 634 is withdrawn and not installed. Kind 2 would make the driveway a public road in the game; on a clone the trailer demo check failed at its junction. See README.md. Industrial Park Road (road 107) is the only delta to install.
