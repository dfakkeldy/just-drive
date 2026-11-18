# The Blender mail car

The whole car is made by `mail-car.py`, headless, from this folder alone. It uses no photo, download, badge or real
postal mark. The owner's photos were looked at while the outlines were drawn by hand; no photo pixel is in any file.

**This is the game's mail car** (the default since 14 Nov 2026). The code car (`web/src/car.ts`) stays in the game as
the fallback and as `?car=code`.

- An address that names no car gets this car. `?car=code` asks for the code car (`web/src/car-switch.ts`).
- The model file's download starts at the top of `main.ts`, as soon as the game knows the vehicle
  (`GarageEntry.preload`). The game waits for it once, just before it builds the car (`GarageEntry.ready`), so it
  loads beside the land.
- If the file is missing, damaged or too slow, the game builds the code car instead: no blank frame, no page
  error, one line in the console. The limit is 8 s of waiting, counted from the moment the game needs the car
  (not from the page's start: a slow first visit that needs longer for its land does not lose the car for it). `tools/blender-car-switch-check.mjs` proves each way to fail without a browser (about 2 s), and
  its `--mutations` mode proves that eighteen known mistakes each fail a check. `tools/blender-car-drive.mjs` with
  `BLOCK=1` proves the fallback in the real game.
- Phones (LOW quality) load `mail-car-low.glb`.
- `BLENDER_CAR_DEFAULT` in `car-switch.ts` is the switch. To go back to the code car, revert the pull request that
  made this car the default; do not only set the switch to false. With false alone, the car's files leave the
  offline download (`tools/offline-models.mjs`), and the offline worker no longer passes them to the network: a
  player with offline play on who opens `?car=blender` would get an update notice on every start.

## Method: a smooth body with the details drawn on it

1. `car_form.py` — one closed control cage (13 stations, 8 rows a side, 4 columns to the centre line), subdivided
   into a single smooth body. It has no glass, lamps or doors yet. Change a number here to change the stance.
2. `car_cut.py` + `car_body.py` — each feature is a flat outline seen from one direction. The outline is cut into
   the body, so glass, lamps, grilles, cladding and wheel openings are real regions of the same skin. Relief (the
   wheel-arch flare, the proud tail lamp lens) is a profile by distance from an outline, on rings cut for it.
   After the cuts, edges that separate nothing are taken out again, region by region.
3. Shading normals come from the uncut body (`Master`), so a cut leaves no mark in the paint and flat stretches use
   few faces. The LOW variant uses the same outlines on a coarser body and still shades like the smooth one.
4. `car_parts.py` — the fitted parts: cabin lining, right-hand dash and wheel, seats, mail tubs and parcels, lamp
   units, a wheel (stored once, used four times), mirrors, handles, visors, wipers, shut lines, roof sign, lamp, aerial.
5. `car_kit.py` — one bucket per draw, and soft shade baked into vertex colours by fixed-direction ray casting.
6. `car_art.py` — the car's own pictures, drawn with arithmetic: one atlas (roof sign with and without words, both
   plates, two lit patches for the head lamps) and a tile of thrown mud that repeats along the body.

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/blender/mail-car.py
node tools/blender-car-check.mjs
```

One run writes `web/public/models/mail-car.glb` and `mail-car-low.glb`. An output path after `--` moves both.
`-- --preview DIR front,rear,side` also renders Blender-side working pictures into DIR (see `car_preview.py`; keep
DIR outside the repository). `--only desktop|low` builds one variant; `--no-export` skips the files.

## Contract

- Game axes: +X right, +Y up, -Z forward, 1 unit = 1 m. Wheelbase 2.62 m, track 1.57 m, wheel radius 0.35 m.
- Same visual envelope as the code car, to 0.02 mm. `mail-car-contract.json` pins triangles and bounds.
- Nodes the game drives: `car_root`, `body`, `steer_fl/fr`, `axle_rl/rr`, `wheel_*`, `driver_eye`, `driver_window`,
  `beacon`, `sign_light`, `roof_kit`, `brake_left_brake`, `brake_left_upper`, `brake_right_brake`, `brake_right_upper`.
- `driver_eye` is the seat camera. Desktop: (0.43, 1.36, -0.08), the code car's own value. Phone file:
  (0.43, 1.31, +0.06), 14 cm further back and 5 cm lower, because a phone's camera draws nothing nearer than 0.45 m
  (`main.ts`). From the desktop eye the steering wheel, the roof edge and the top of the front pillar are nearer
  than that and vanish. From the phone eye they are all there, and the lining closes the top of the picture.
- Three parts differ from the code car, on purpose:
  - `sign_light` is the whole sign box with both faces (hiding it hides the sign, not only the box).
  - The red high-mounted lamp is split between the two `upper` brake meshes, so it lights with them.
  - The amber lamp stands on a magnet foot on the roof, as on the owner's car, not on a cross bar. The foot and the
    sign's feet are the `roof_kit` mesh; with the mail trim off it is hidden with the sign and the lamp.
- `create(mailTrim, cleanText)` has the code car's meaning: no trim = no sign, lamp or mail plate (the plate says
  MABOU); clean text = no words on the sign. The model's UVs never change: the game slides the atlas.
- Materials: `Body paint` and `Matte` carry vertex colours. `Front glass`, `Rear tint`, `Lamp lens` and
  `Mud overlay` are see-through. `Sign atlas`, `Head lamp` and `Mud overlay` carry the car's own pictures (PNG,
  inside the file; the sign and the head lamps share one atlas). All materials are single-sided; the cabin has its
  own lining. There is no `Metal` material any more: the game has no sky to mirror, so metal only looked darker.
  Bare metal (wheels, exhaust, fog lamps) is the paint material at a darker colour, which saves a draw.
- The roof sign's band is **blue**. The code car's is green. The owner's photos show a blue face on a white box,
  so the Blender car follows the photos. The words and the winged envelope are the game's own invented art.

## Lamps, as the game is today

The game flashes the amber lamp (`main.ts`) and lights the brake lamps only while towing (`towing.ts`). It has no
headlight beam and no dusk switch. On this car the tail lamps, the sign and the plates glow a little at all hours,
as on the code car. For night pictures the drive script holds the brake and amber lamps on.

The head lamps have their own material, `Head lamp`. The whole swept housing behind the clear lens is lit (a warm,
yellowed reflector), and the two round units are whiter. `car-model.ts` sets how bright they burn (`HEAD_LAMPS`,
1.5; the sign is 0.24). They are always on, like a Canadian car's daytime lamps, because the game has no switch.
The dial needles and marks are in the sign's material, so the instruments glow softly at dusk and at night.

## The cabin, and why its colours are pale

From the seat the game lights a face that looks down or sideways with little more than its ground colour, and the
picture's tone curve is dark at the low end. A mid-grey lining comes out black. So the lining colours in
`car_parts.py` (`HEADLINING`, `DOOR_CARD`) are far paler than they look: in the game they read as mid grey, close
to the code car's cabin. Up-facing parts (dash top, seats) take the sky's light and keep natural dark colours.
The lining sits 16 mm inside the skin; each window opening is as large as its glass, with a 6 mm dark seal.

The phone car has the same lining with fewer faces and no seal (`build_liner(lite=True)`), an inner mirror, and
one more piece, `phone_header`: the front 8 cm of the roof lining, 3 mm under the true roof. On a phone that is
all of the roof the camera can draw, and it must reach the top of the picture.

## Baked shade on big faces

`car_kit.bake_shade` shades each corner by what is near it. A corner under a small part (a rail foot, a line
laid on the skin) came out almost black, and a big face carried that shade across a whole door. Now, on a
triangle larger than 40 cm2, no corner may be much darker than the lightest one (`SMEAR_AREA`).

## Shared model plumbing

The car uses the game's shared model plumbing (it came with the porch dog) and has none of its own:

- `web/src/glb-model.ts` — the shared loader. The dog uses `loadGlbModel` (one material, baked geometry). The car
  uses `loadGlbScene`, the one function added for it: fetch with a time limit that cancels the request, then
  three's `GLTFLoader.parseAsync`, keeping the file's own tree, materials and pictures.
- `glb_quantize.py` — the shared quantizer. The car asks for three options: `colour_bits=8`, `drop_slivers=True`
  and `textures=`. With no options a file comes out as before: the porch dog's two files were rebuilt with it and
  are the same byte for byte (`porch_dog.py -- <folder>`, then `cmp` with `web/public/models`). The car's two files
  are also the same byte for byte as with its former quantizer.
- `web/models-build.ts`, `tools/build_site.sh` — every `web/public/models/*.glb` goes into the published site. So
  the car's two files are published from the moment this branch lands, also while the car is off.
- `tools/build-pwa.mjs` — the offline download. The car's files are in it, like every other model
  (`tools/offline-models.mjs` holds the rule: they follow `BLENDER_CAR_DEFAULT`). The offline worker
  (`web/pwa/sw.js`) has no special case for them. A page saved before the car was the default has no car in its
  own download; if it asks for one (`?car=blender`), it is told to update, and that update has the car.

The car's own parts sit on top: `web/src/car-model.ts` (the rig), `web/src/car-switch.ts` (the switch and the
fallback to the code car), two lines in `garage.ts`, two lines in `main.ts`.

## If the model file is missing

The game goes on. `car-switch.ts` builds the code car (`car.ts`), whole and from the first frame, with the mail
trim that the mode asks for, and writes one line to the console. This happens when the file is not there, is an
HTML page, is cut short or damaged, lacks a node the game drives or a picture, or when the whole load takes more
than 8 s. `loadGlbScene` checks the file's own header (its length, and that its parts end where the file ends)
before three.js reads it: a file cut near its end would otherwise give a car without its last picture. The private page (a claude.ai artifact) cannot
serve `.glb` files, so it always shows the code car, unless that build one day carries the model inside its script.

## What follows from being the default

- **Checks say which car they test.** A browser check that reads the car asks for the body it expects
  (`tools/mail-car-body.mjs`: the Blender car by default, the code car with `?car=code`). A page that silently
  fell back to the code car fails such a check.
- **The words on the car.** The sign and plate words are in the atlas picture. The game shows other cells of it
  for a car without mail words (Just Drive, off duty). `blender-car-check.mjs` reads those cells: the wordless
  sign has no letters, the off-duty plate is not the mail plate, and all four cells are pinned in
  `mail-car-contract.json`.
- **Offline download.** Both car files are in it (about 637 KB), on phones too: the rule does not split by quality.
- **Known limit.** A page saved for offline play before the car was the default, opened offline with
  `?car=blender`, shows the "update" notice on every start until it is online again. It still gets a car (the
  code car), and nothing reloads by itself.

- **The private page** (a claude.ai artifact) cannot serve `.glb` files, so it shows the code car. To show this
  car there, the private build would have to carry the model bytes inside `app.js` (sizes below).
- **Other players' cars.** Multiplayer draws other cars from `web/src/mp/ride-models.json`, a 696-triangle
  snapshot of each ride. `tools/mp-model-source.ts` now takes the car from this car's phone file, through the
  game's own rig (`car-model.ts`), off duty as before. `node tools/mp-models-build.mjs --write` after the model
  changes; the `mp-models` row fails until then.
- **Same factory elsewhere.** Just Drive builds the car through the same garage entry. Mabou 1884 gives the horse;
  `?vehicle=car` there gives this car.
- **The frame budget.** `/models/` downloads are a counted class. Every mail view fetches one more file (the
  car); its draws, triangles, geometries, pictures and programs go down. The pins in
  `tools/baseline/frame-budget.json` were moved by exactly that (the table under "Measured costs").

## Pictures

```sh
# the preview page: both rigs, both qualities, fixed poses
CAR_PREVIEW_ONLY=1 OUT="$PWD/data/work/threads/blender-car/pass5/preview" \
RUN=blender-car-browser.mjs VIEWS=front tools/car-shots.sh 1440 1000
# the real game: both cars on the same roads at noon, dusk and night; BLOCK=1 adds the fallback test
BLOCK=1 OUT="$PWD/data/work/threads/blender-car/pass5" RUN=blender-car-drive.mjs VIEWS="x|x=1" tools/yard-shots.sh 1440 1000
python3 tools/blender/drive-sheet.py data/work/threads/blender-car/pass5
# the seat views and the face: code car, the pass before, this pass
python3 tools/blender/before-after-sheet.py data/work/threads/blender-car/pass4 data/work/threads/blender-car/pass5
```

`blender-car-drive.mjs` keeps a place for one more view, `night-bull` (the car at night facing the Highland bull on
the Mabou Mines Road). It is switched off until the bull and the guard rails are in the game.
`car.html?model=blender` shows the car alone; add `detail=low`, `trim=off`, `clean=1`, or `eye=x,y,z&look=x,y,z`.

## Measured costs

| Rig | Desktop triangles / draws | LOW triangles / draws | File bytes |
| --- | ---: | ---: | ---: |
| Code car (today) | 39,308 / 40 | 39,308 / 40 | none (code) |
| Pass 3 | 27,879 / 23 | 7,666 / 22 | 573,776; LOW 181,572 |
| Pass 4 | 23,052 / 24 | 5,640 / 23 | 435,488; LOW 164,260 |
| Pass 5 | 23,731 / 24 | 5,816 / 23 | 449,592; LOW 168,180 |
| Review r2 fixes | 23,731 / 24 | 6,157 / 23 | 457,960; LOW 178,880 |

`tools/blender-models-check.mjs` (row `blender-models`) rebuilds the four model files with Blender and compares
them with the committed files, byte for byte. Without Blender 5.2 it reports SKIP; it never passes unbuilt.

Budgets in the checks: desktop 40,000 triangles and 30 draws, LOW 8,000 triangles, 600 KB per file.
The files include the pictures (atlas about 11 KB, mud tile about 19 KB).

What this branch adds to a published build (flat build, 14 Nov 2026, against main e41cf09):

| | Bytes | Brotli |
| --- | ---: | ---: |
| `app.js`: the switch and the rig (the loader was already there) | +4,327 (2,156,739 to 2,161,066) | +1,315 |
| `models/mail-car.glb` | 457,960 | 187,989 |
| `models/mail-car-low.glb` | 178,880 | 81,123 |

If a build had to carry the model inside `app.js` (the private page), base64 would add 610,616 characters for the
desktop file and 238,508 for the phone file (267,893 and 106,871 bytes after brotli).

Whole-frame pins (`tools/baseline/frame-budget.json`), moved on 14 Nov 2026 when the car became the default.
Before = the code car, after = this car. Only the 14 mail rows changed; the 18 other rows did not.

| Scene / mode | Draws | Triangles | Geometries | Pictures | Programs | Requests |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| animal-home/desktop-mail | 816 to 785 | 3,301,582 to 3,267,572 | 312 to 293 | 77 to 76 | 42 to 37 | 369 to 370 |
| animal-home/phone-mail | 207 to 190 | 767,305 to 730,987 | 170 to 150 | 27 to 26 | 26 to 21 | 269 to 270 |
| harbour-water/desktop-mail | 397 | 2,763,320 | 176 | 141 | 28 | 430 to 431 |
| harbour-water/phone-mail | 58 | 884,948 | 55 | 50 | 13 | 294 to 295 |
| highway19-far-land/desktop-mail | 681 | 3,562,355 | 192 | 144 | 24 | 660 to 661 |
| highway19-far-land/phone-mail | 206 | 1,294,996 | 87 | 71 | 13 | 505 to 506 |
| mines-lookoff-south/desktop-mail | 592 to 576 | 3,315,630 to 3,296,886 | 280 to 261 | 146 to 145 | 46 to 41 | 369 to 370 |
| mines-lookoff-south/phone-mail | 192 to 175 | 1,234,391 to 1,198,073 | 116 to 96 | 71 to 70 | 25 to 20 | 262 to 263 |
| new-player-start/desktop-mail | 639 to 608 | 3,072,232 to 3,038,222 | 261 to 242 | 144 to 143 | 35 to 31 | 274 to 275 |
| new-player-start/phone-mail | 261 to 244 | 1,467,739 to 1,431,421 | 140 to 120 | 82 to 81 | 22 to 17 | 221 to 222 |
| village-start/desktop-mail | 875 | 4,263,636 | 231 | 152 | 35 | 683 to 684 |
| village-start/phone-mail | 201 | 1,154,668 | 87 | 70 | 14 | 524 to 525 |
| works-yard/desktop-mail | 555 | 3,472,538 | 131 | 112 | 27 | 537 to 538 |
| works-yard/phone-mail | 177 | 1,474,836 | 74 | 65 | 16 | 397 to 398 |

Every mail view asks for one more file (the car). Where the car is in the picture, every other count goes down.
Where it is not, nothing else changes. These counts do not prove frame rate or loading time on a phone.

A phone's first start, measured on this Mac's dev server with an empty cache (three starts each, the middle one):
the code car asks for 220 game files (20,433,846 bytes) and settles in 3.9 s; this car asks for 221 (20,613,021
bytes: the phone file, 179 KB more) and settles in 3.8 s. The difference in time is inside the noise (3.5 to 4.5 s).
