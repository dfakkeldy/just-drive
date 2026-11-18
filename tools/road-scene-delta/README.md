# 16 Nov road, building and prop corrections (road scene delta)

Source: Dan's task text. No reference directory, footage or stills was opened.
Positions use EPSG:2961. All lengths, building shapes and placements below are
approximate. No civic numbers, occupant names, business names, marks or badges.

| Item | Result |
| --- | --- |
| Walkers Cove Road | First 128 m paved, ending at existing vertex 617781.44,5077670.49. The 1 m terrain rises from 31.2 m at Highway 19 to about 36 m at this first crest. The remainder stays gravel. |
| James MacDonald Road | First 96 m paved, ending at the first bend at 618108.28,5075426.05. Medium confidence. The remainder stays gravel. |
| Southwest Ridge at MacKillop | Pinned as gravel; no pavement change. Road 111's existing end at 624562.59,5099281.74 stays fixed. |
| Southwest Ridge asphalt appearance | Skipped as permitted: the terrain shader selects road appearance by numeric kind in raster fields. It has no per-road material variant. Kind 2 has dark asphalt and no paint; kind 1 adds both yellow and white lines. Neither can show this red asphalt/double-yellow/no-edge-line combination. No new road-look system added. |
| Gravel roads | Keep kind 3's packed wheel tracks and existing pothole shader/physics. MacKillop's two public gravel pieces narrow from 5.2 m to 4.5 m; its remote source-class track stays unchanged. Existing cut banks remain measured terrain. The existing pothole shader draws dark bottoms, with no standing-water variant; water fill is skipped under the no-new-system rule. |
| Whycocomagh Port Hood washboard | About 80 m, from about 16 m to 96 m east of the mapped bridge end. Reuses the existing washboard flag, fields, ridges and driving behaviour. Mabou Mines Road is byte-equal before/after. The supplied bridge coordinate is about 60 m east of the mapped bridge; no bridge is relocated. |
| Hybrid bridge rail | Skipped as permitted: current Roads draws ordinary flat decks; the historical timber kit has period timber rails. Neither supports squared wood posts plus timber top rail over modern W-beam. Bridge PR #156 owns the replacement bridge kit, which this change does not edit. |
| Southwest Ridge guardrail | Approximate 60 m west-side run centred near 624360,5100100. West is left in the northbound pass. Road input metadata feeds the existing guardrail planner, merged W-beam mesh, ground/access gates and colliders. Metal posts use the same mesh and material. End length is a conservative generic estimate, not a measured survey. |
| Missing buildings | Two one-storey gable houses and four simple outbuildings: cream house/yellow shed; dark red house/garage/two sheds. All west of the road, within the supplied position box. Input: `pipeline/dashcam_20261116.json`; source is `hand`, confidence 0.4, provenance exactly `dash cam 12/13/16 Nov, approximate position`. Source DTM supplies only ground. Shapes, positions and paint are generic estimates. Steps 27 and 30 retain these inputs on later bakes. |
| Mailbox variety | Existing rural metal arches on square wood posts and shared wooden frames stay common. A per-building random draw adds a miniature-house box with a curved pedestal (1.5%) or large moulded plastic box/pedestal (1.5%) to invented single-box sites. Grouped pairs retain existing styles. No actual mailbox position is an input. New types use the existing opening, impact, damage and reset paths. Step 29 emits them on the next prop bake. |

## Land delta for the main thread

The script writes **only a new folder outside `data/`**. It refuses existing
outputs and source/output overlap. No baked/site files are written by the builder.
The committed `hashes.json` lists every replacement file and its before/after
SHA-256. The receipt covers both areas as one transaction. Mixed, stale or unknown
land fails; an entirely before or entirely after state passes. Only the owned
`buildings.count` and `buildingStyles.count` keys participate for `manifest.json`;
step 29 and other stages may update their own manifest keys. The full manifest
hash remains in the receipt for generation review. As with industrial-surface, `EXPECT`
is None until install. The main thread's install PR must change it to `'after'`,
which rejects any return to all-before land. A later bake that changes target
roads/buildings/field bytes requires a reviewed new receipt; do not silently repin.

```sh
python3 tools/road-scene-delta-check.py --land
python3 tools/road-scene-delta/patch.py /path/to/data/baked /new/separate/delta-folder
python3 tools/road-scene-delta-check.py --land --land-root /new/separate/delta-folder
```

The script compares its generated receipt with the committed receipt and refuses
installation on any mismatch. `--record` prepares a changed receipt in a new folder
for review; it never edits the committed receipt or installs files. This is about 8.4 MB across 55 files: roads, affected L5–L8 road fields,
cemetery road hashes/references, split-road references in buildings/culverts/poles, six building records/styles, and the building manifest counts.
Existing geometry and non-target field pixels are unchanged. The delta keeps existing prop positions fixed and remaps their road IDs.

**Required install order:** install the validated delta first, then run step 29.
Do not run step 29, step 30, or any other manifest writer between generating the
delta and installing it: it contains a full manifest replacement. If any stage
ran first, the maker must pass its exact committed-receipt comparison again before
installation. A stale refusal requires a reviewed new receipt; never copy a stale
manifest over newer keys. Only the ongoing land check ignores unrelated manifest
keys after installation. Step 29 for mailbox variety is main's work. Rebuild packs/site in main's normal delivery path.

The delta does not rewrite step 27's local audit/candidate reports. A direct
`27_check_buildings.py` run needs a step-27 rebake to refresh those reports first;
do not mistake the old audit inventory for an invalid hand-building record.
Road splits can change race-route candidates (the 100 m minimum and saved road IDs)
and other road-ID pins after installation. Name-based road chaining still works;
main owns any affected installed-data expectations.

`road-scene-delta-rules` tests bounded splits, no moved vertices, stable unrelated IDs,
idempotence, input shapes/paint, collision/overlap refusals and the actual Python
random draw (10,000 invented IDs; old tilt and parcel draws unchanged).
`road-scene-delta-land` adds actual data pins, receipt rejection cases and the actual
step-27 ID-floor/wing assertion on all 19 existing wings with hand IDs present.
`road-scene-delta-runtime` mounts real Props and Guardrails, including mailbox openings,
impacts/reset, metal vertex attributes, LOW, colliders, access and missing ground.
`road-scene-delta-rail-land` plans 58.9 m of the actual Southwest Ridge run using
measured ground and existing prop/access gates. `road-scene-delta-browser` renders an explicitly invented fixture and compiles both
rail modes. It does not claim to show installed land; main owns that installation.

MacBook rows: main thread runs them. This includes `budget`, `budget-mutations`,
`traffic-budget`, and `traffic-budget-desktop`. These use MacBook-specific pins;
an m4 budget result is excluded from this PR's gates. No builder MacBook browser run.


## Installed-land repair (the project brief)

The first receipt updated cemetery road hashes but left references on the short
mouth pieces after splitting. The new receipt also moves 13 Judique building
references, cemetery `cemetery-2c430310b451` from 111 to 1011, one Judique culvert,
28 Judique poles and six Mabou poles onto the correct split descendants. Points,
shapes, distances and other fields stay fixed. All top-level baked JSON in both
areas was audited for road-ID fields: `buildings.nearRoad`, `streams.culverts.road`,
`props.poles.road`, and `cemeteries.road.id` are the four reference schemas.
The maker reads the installed manifest's village anchor rather than requiring
raw vector files merely to import the road-field writer.

`step29-hashes.json` pins what step 29 settles in the two prop files: the public
poles (road kinds 1–3, in file order) and the mailbox and community-box arrays,
each as a count and a canonical-JSON SHA-256 from `step29_properties()` in the check
(`python3 tools/road-scene-delta-check.py --step29-receipt <land root>` prints it). It was measured from the two final
prop files from the main thread's fresh MacBook copy rehearsal of the new delta
(their whole-file hashes are kept in `measuredFrom`). The land check accepts
all-before, all-after-delta, or all-after-step29. It rejects a mixture of the two
prop stages. This is necessary because step 29 replaces the poles whose IDs the
delta repairs. The maker still compares its entire 55-file receipt exactly.

Power (#183) reruns step 29 and adds poles on named kind-4 roads and service drops,
but keeps every public pole and both box arrays byte-identical. The step-29 state
therefore holds before and after power without a pin on power output bytes.
Poles off public roads are accepted only with the file's service drops and only on
named kind-4 roads that are no bridges, and both prop files must agree on power;
`power-network-land` recomputes every power pole and drop. A moved or missing public
pole, a changed mailbox or community box, a stray pole, or a pole on a road this
land lacks still fails. The check runs these as mutants on the installed props. It also puts one
record of each reference schema on its sibling split piece, and cemetery
`cemetery-2c430310b451` back on road 111; each must be found stale.
`EXPECT` remains unset; main sets it to `'after'` in the installation PR.

The M4 proof root is outside the checkout and `data/`. It started with an APFS
copy of all 29,189 before-state baked files. The 55 replacements were applied
there, then main's four baked post-step29 props/manifest files were overlaid.
No private before-bed inputs were fetched. Step 29 itself refuses to run on the
M4 without them. Main owns that bake and the live install.


Both regenerated 1884 runtime layouts are byte-identical: no farms, trades,
boards, counts, audit positions or deficits changed in either area. Only the
audit header fingerprints changed. Mabou records new buildings/manifest/roads;
Judique records new buildings/manifest/roads/streams. The `era` row's frozen
Mabou audit SHA is updated; its runtime-layout SHA remains unchanged. Comparing
main's final manifests to the exact before files changes only Mabou's buildings,
buildingStyles and props keys, and Judique's props key.
