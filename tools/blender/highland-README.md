# Highland bull, built in Blender

`highland.py` is the source of the bull. It uses no photos, textures or downloaded assets.
The live roadside bull starts with the code-built rig, then swaps to this model after a successful load.
A failed load leaves the old bull in place. Placement, tracking, honking and contact use the existing Animals rules.

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/blender/highland.py
node tools/highland-model-check.mjs --update-snapshot   # only after an intended change to the generator
node tools/highland-model-check.mjs --mutations
```

One run writes `web/public/models/highland-bull.glb` and `highland-bull-low.glb` (about 4 seconds).
A folder after `--` sends both files somewhere else. Two runs give the same bytes (Blender 5.2.2, macOS).

## The animal

One compact adult bull. All sizes come from the real animal, scaled from a W-beam guard rail (top 0.70 m).

| Measure | Value |
| --- | --- |
| Withers (`shoulder`) | 1.12 m |
| Back line, with hair | 1.10 m: about 0.4 m above the rail top |
| Nose to rump, with hair | 2.08 m |
| Horn span, tip to tip | 0.91 m: out level, then up and a little forward |
| Horn tips | 1.33 m high |
| Muzzle | about 0.70 m high: at the rail top |
| Top of the forelock | 1.26 m |
| Lowest hair of the belly fringe | 0.36 m |

## How the coat is made

1. A dark under-body from lofted rings: torso, four legs, tail, skull and a mound for the forelock.
2. Roots are scattered on those skins with blue-noise spacing (a fixed seed).
3. Each root grows one strand. It starts along the body (down, and swept to the rear), then turns to hang with
   gravity, and it stays outside the skin. Wet strands lie close; the belly fringe, dewlap, beard and tail hang free.
4. A strand is a ridged ribbon with a forked end: 6 triangles, or 10 where it hangs free and both sides can be seen.
5. Colour is per vertex. Roots are dark, ridges light, one edge of each strand is its shadow side, the tips on the
   back are bleached, and the coat goes brown-black toward the head.
6. Sky occlusion is baked into the colours: 20 fixed rays per vertex against the whole animal and the ground.
7. Strands are shaded with the normal of the body under them, not with their own facets. The coat is lit as one
   soft mass; the strands show through colour, occlusion and outline. The horns are smooth swept tubes.

The forelock hides the eyes from the front. The eyes are there: small dark shapes that show from the side and below.
LOW uses one straight piece per strand, has no strands on its back (its skin stands at the hair's height),
and merges legs and tail into the body.

## Contract (`highland-contract.json`)

Axes are the game's animal axes: +X right, +Y up, forward is -Z. Units are metres. The origin is on the ground.

```
highland_bull            root, at the origin
└─ body                  at the origin
   ├─ torso              mesh
   ├─ head               pivot at the neck joint (0, 1.06, -0.68)
   │  └─ head_mesh       skull, forelock, horns, ears, beard and the ruff that covers the neck joint
   ├─ tail               pivot at the tail head (0, 1.00, 0.845)
   │  └─ tail_mesh       desktop only
   └─ leg_fl leg_fr leg_rl leg_rr     pivots, 0.7056 m high (0.63 × shoulder, as animals.ts groundRig expects)
      ├─ leg_xx_mesh     desktop only
      └─ hoof_xx         empty node on the ground, straight below the pivot: the hoof contact point
```

- Every pivot is unrotated and unscaled. Each mesh node is a leaf; it carries the quantization decode (scale and offset).
- Leg pivots: front (±0.17, 0.7056, -0.48), rear (±0.18, 0.7056, 0.585). The hoof is at leg-local (0, -0.7056, 0).
- The head turns about its pivot's Y axis. Pictures show ±1.2 rad (the game's limit): the horns pass over the shoulder.
- Data: indexed triangles, POSITION u16 and NORMAL i8 (`KHR_mesh_quantization`), COLOR_0 u16 linear RGB.
  No textures, no skeleton, no Draco or meshopt. three.js's GLTFLoader reads it alone.

## Costs

| Model | Triangles | Draws | GLB bytes |
| --- | ---: | ---: | ---: |
| Today's code-built Highland (`stockGeometry('highland')`) | 650 | 1 merged (the live rig: more) | none |
| Desktop | 7,600 | 3 (body with legs, head, tail) | 203,180 |
| Desktop, `legs: true` | 7,600 | 7 | the same file |
| LOW | 1,478 | 2 (body, head) | 48,100 |

Budgets in the contract: desktop 7,600 triangles, 3 draws, 300,000 bytes; LOW 1,500 triangles, 2 draws, 80,000 bytes.

## The loader and the preview

`web/src/highland-model.ts`: `loadHighlandBull({ low, legs })` returns an object with the shape of the animal `Rig`
in `animals.ts` (`root`, `body`, `head`, `tail`, `legs`, `torso`, `shoulder`, `neck: null`, `jaw: null`, empty `ears` and
`eyes`), plus `hooves`. It decodes the meshes to plain float geometry in their pivot's space and uses one Lambert
material with vertex colours. By default it merges the four legs into the body (3 draws); the leg groups stay as
empty pivots. `legs: true` keeps them as meshes for a walk.

`web/highland.html` (dev server, or the build that `tools/highland-shots.sh` makes; it is not in the site build):

- `?view=side|front|head|rear|far|rail|rail-close`
- `?animal=both|code|blender|walk` (`walk` keeps the leg meshes and swings them)
- `?low=1`, `?dir=<head turn in degrees>`, `?day=overcast`, `?still=1`

It uses the game's tone mapping and exposure and the game's sun and sky formulas (`main.ts`) at a 28 degree sun.
`rail` is a mock-up of the place from plain geometry: a crumpled W-beam, timber posts, grass, sea and a headland.

```sh
OUT="$PWD/data/work/threads/highland" tools/highland-shots.sh 1440 1000
python3 tools/blender/highland-contact-sheet.py data/work/threads/highland
```

The browser job checks the loaded rig against the contract (pivots, hoof points, parents, bounds, draws), opens the
moving page once (the head, the tail and all four legs must move), and writes the pictures.
Pictures stay in `data/`, which is not in git.

## Live integration

`Animals` keeps the approved main-branch home behind the rail. It requests the matching desktop or LOW file once
when the resident is built. A failed download or decode keeps the code-built bull. A successful load replaces only
the rig, preserving the root pose and the resident's behaviour and contact state. Desktop keeps separate leg meshes
(7 draws, still 7,600 triangles) so the existing ground support can place each hoof on the drawn cliff terrain.
LOW keeps its 2-draw model. The existing site model copy and offline model walk include both files.

The preview remains available for isolated rig and render checks. Run `highland-browser` for it and
`highland-live-browser` for live cliff chase/seat pictures, forced-load-failure fallback, tracking and contacts.
The live pictures compare the code-built fallback (before) with the loaded model (after), on the same branch.

`blender-models` and `blender-models-mutations` must run in the main thread's MacBook Blender window.

`highland-budget` runs all four animal-home modes, requires the loaded Blender bull (including LOW), and keeps
HEAD, the exact command, per-mode costs and the loaded rig counts in `data/work/threads/highland-budget/measurements.log`.
`tools/check-highland-budget.sh --refresh-desktop` uses the normal five-repeat raise procedure for the two desktop
records. It keeps the raw repeats in `desktop-five-repeats.log`; the 7,600-triangle asset cap does not change.
The live check also rejects a missing head node and missing vertex colours, retaining the fallback with one warning.
