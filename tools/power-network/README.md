# Building power — issue 1210

Named kind-4 roads receive poles through their last nearby building. The gate
is **75 m from the mapped centre**: River Denys Mountain Road's last house is
72.566 m away. That road gets 39 poles, ending at s=2,448.529 m along its 3,879 m
kind-4 piece. Unnamed tracks, bridges and `props_driveways` get no poles.
The connected public end feeds the run; reversed source points work too.

A named kind-4 piece listed in `AREA.unpowered_tracks` (pipeline/areas.py) gets no run.
Each entry is a point on the piece's line and its expected name. Step 29 stops unless the
point is within 5 m of a named kind-4 piece of that name that is no props driveway or bridge.
Other pieces with the same name keep the usual rule. Judique lists the kind-4 piece of
River Denys Road to the church. The dash cam drive of 21 Nov 2026 saw the line end at the
last house with power, about 2.8 km along the public piece of River Denys Road. It saw no
pole after that, on the public piece or on the kind-4 piece to the church. The public piece
itself is the filmed exception below.

### The filmed exception: River Denys Road's public piece (game road 98)

This is the one place where the game does not keep the frozen public poles. `AREA.public_pole_corrections`
(pipeline/areas.py) lists it. Step 29 applies it after the frozen pass, in full and power-only bakes alike.
Each entry names the road by a point on its line, its name and its kind, and step 29 stops if they do not match.
Its rules cover the road from its first point to its end, without gaps. In a `none` stretch every pole goes.
A pole on the wrong side moves straight across the road at the same distance along it, with the same setback
and marks. Every other pole keeps its frozen bytes. The rules are absolute, so a second run changes nothing.
A moved pole that is not safe, or that stands within 9 m of another pole, stops the bake.

The evidence is Dan's dash cam drive of 21 Nov 2026 (Garmin, about 11:51-11:56 AST in, 14:13-14:18 AST back).
Frames at two per second were read on both passes, and the last pole was checked at full size.
Distances are along the road from its end at the paved piece (road 97). The real line:

| Along road 98 | Real line | Game change |
|---|---|---|
| 0-612 m | south side | 10 poles move from the north side |
| 612-1,100 m | north side; for 612-870 m it runs back in the trees | none |
| 1,100-1,160 m | crosses to the south side for one pole | 1 pole moves |
| 1,160-1,530 m | north side | none |
| 1,530-1,975 m | south side | 7 poles move |
| 1,975-2,340 m | leaves the road through the woods; no pole by the road | 5 poles removed |
| 2,340-2,560 m | south side | 4 poles move |
| 2,560-2,745 m | through the woods again; no pole by the road | 2 poles removed |
| 2,745-2,840 m | the end, at a bend: a transformer pole on the north side, then the last pole on the south side by the last house with power | the north pole stays; the next pole moves south and keeps that house's drop |
| 2,840 m to the end (10,423 m) | no pole and no wire | 117 poles removed |

In all, 124 poles are removed and 23 move. Road 98 keeps 38 poles. No other road changes. Every house keeps its drop,
from the same pole. The game's pole for the real last pole stands 30-40 m past it, beside the game's twin of that last
house. A side changes only where both passes agree. Where a stretch's line runs in the trees, its poles stay on
the side where it runs. The game poles keep their frozen spacing; only their side and their end follow the footage.

Apart from that exception, the public-road pass runs first with its original seeds and order.
`poles-before.py` freezes that algorithm from main `868f823e`. Rules and delta
generation compare original/new public poles **byte for byte on the same inputs**.
A power-only delta also preserves installed public poles (apart from the filmed exception),
mailbox arrays and cabinet arrays. Ordinary full step 29 still uses the original rules on current
inputs, so unrelated input changes can legitimately change their own outputs.

Each eligible house or large building gets at most one sagging drop,
from a pole within 45 m of its roof seam. Selection prefers no highway crossing,
then the building's side of its nearest road, then distance, with stable ID ties.
Sheds, barns and tanks get none. Wings share one property drop. Highway vertices
count as centre-line crossings. The Judique church has no power (Dan, 21 Nov 2026):
neither its model nor its removed surveyed envelope gets a drop. Step 29 no longer reads
`web/src/church-site.ts`. Packs from before 21 Nov 2026 hold a church drop with no ground
datum; the renderer still draws it from the model origin's terrain until the new pack is
installed. No identity, civic number, occupant or business name is added.

Four span wires and all service drops share **one `LineSegments` draw per cell**.
LOW hides drops; desktop restores them. Roof heights match the building renderer.
A full bake derives step-30 styles in memory because step 29 runs before step 30.
No step-30 files are written. Old props packs without service drops still load.

## Land order — main owns installation

**No committed output byte pins.** Step 29 runs again after land changes.
The installed-land check uses current roads/buildings/styles and properties,
so the the project brief cemetery/road-ID correction does not require a new output receipt.

The code PR can land before or after the project brief. Main installs the project brief, then runs step
29 after both code changes are on main. Main alone installs land, rebuilds packs,
publishes and deploys. This builder has not installed or published land.

For a before/after preservation proof, capture the baseline **after the land
inputs settle and immediately before the power bake**. The capture makes small
APFS clones of the six props files; it does not copy terrain or source material.

```sh
python3 tools/power-network/make_delta.py /path/to/data/baked /new/baseline --capture
# Main runs the appropriate step-29 bakes, or installs a separately rehearsed delta.
python3 tools/power-network/make_delta.py /path/to/data/baked --check --after --baseline /new/baseline
```

The check compares public pole **position sets**, and compares mailbox/cabinet
arrays directly. It first applies the filmed exception to the baseline, so the exception's road is
compared too. It also checks that installed poles already follow every correction. It also recomputes drops from current geometry, checks schema
counts, named-road bounds and the River Denys 39-pole endpoint. It also checks that no
pole stands on an unpowered track, no pole stands within 500 m of the church and no
drop belongs to the church. Without `--after`, before-install packs are accepted.
Without `--baseline`, it states that preservation was not compared.
Changes caused by other land stages must be separated from the power change.

For a step-29-only rehearsal that preserves all installed public poles and boxes:

```sh
python3 tools/power-network/make_delta.py /path/to/data/baked /new/separate/power-delta
python3 tools/power-network/make_delta.py /path/to/data/baked --check --overlay /new/separate/power-delta --after
node tools/run-node-check.mjs tools/power-network-runtime-check.mjs --delta /new/separate/power-delta
```

The generator refuses existing outputs, paths inside `data/`, source overlap,
source changes during a bake, a changed frozen public-pole algorithm, changed
public positions/box arrays, or failed power properties. It writes only six
`props.json`/`manifest.json` pairs (about 2.51 MB) and step-29 reports. No road,
building, style, raster, pack or site file changes. `power-proof.json` records
properties from this rehearsal, not durable output hashes. Only main installs.
Validate again before install; full manifests must not overwrite newer unrelated
keys. If inputs change first, rerun step 29 instead of copying an old manifest.

## Checks

- `power-network-rules`: frozen public-pole bytes; terminal/reversed roads; unnamed
  and driveway exclusions; unpowered tracks; 45 m reach; side/crossing; roof/group/datum;
  no church drop; the filmed public-pole corrections (removed stretches, side moves, other roads' bytes,
  a second run changes nothing, and a wrong entry or an unsafe move stops the bake).
- `power-network-land`: properties on installed land. Passes on a legacy pack with no
  drops; main runs the explicit `--after --baseline` command for acceptance. The pack
  installed before 21 Nov 2026 (church drop, River Denys Road track poles) fails this row
  and `power-network-browser` until main installs the new Judique pack.
- `power-network-runtime`: actual Props geometry, sag/end heights, one draw per
  cell, stable updates/disposal, LOW restoration, quiet-site references.
- `power-network-browser` (**apple-check-host / Edge**): the installed Judique land. Before
  main's power bake it proves a legacy pack (no drops, no River Denys poles)
  still draws at most one merged wire line per cell. After it, two views: at the church,
  no pole within 500 m, no River Denys Road track pole and no drop; on River Denys
  Road by Highway 19, a real house drop renders. The River Denys Mountain run stays.
- Budget: the ordinary `budget`, `budget-mutations`, `traffic-budget` and
  `traffic-budget-desktop` rows. Their ceilings are pinned for this code on the
  current (pre-power) land. **Main's power bake adds poles and drops, so main
  re-pins them with a five-repeat `tools/check-budget.sh --raise` on apple-check-host
  after step 29, in the install change.** The first rehearsal's counts on the
  earlier #179 land are kept in `budget-first.json` for reference.

### Manual rehearsal (optional)

A separately generated delta can be served through a temporary overlay. Set
`POWER_DELTA_ROOT` to the delta folder and run, inside the checkout on the host:

```sh
POWER_DELTA_ROOT=/path/to/power-delta tools/check-power-network-browser.sh
POWER_DELTA_ROOT=/path/to/power-delta tools/check-power-network-browser.sh budget
```

The overlay substitutes only `props.json` and `manifest.json`. Extra road or
building files beside them are ignored. The check confirms all other manifest
keys match current land. Temporary public symlinks restore in `finally`.
No `data/baked` or `data/site` file is written.
