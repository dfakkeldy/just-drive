# Changelog

Changes on main, by Atlantic day. Rebuild with `python3 tools/changelog.py`.

## 2026-11-17

- Power buildings with service drops and poles on built-up named roads

## 2026-11-16

- 107\.3 SECOND DELIVERY: eight new songs for Judique, Port Hood, Port Hawkesbury and Point Tupper
- Talk station round 2: 50 new pieces on 94\.9 THE PARTY LINE, and Judique and Mabou said right
- Add sourced junction signals with night lamps and traffic hook
- Just Listen: a radio-only page at /listen/
- Player Atlantic date/time and uniform weather moods
- Road, building and mailbox corrections
- Give West Bay borrowed rural building style rates
- Move phone Room race controls into Settings
- Talk station: 94\.9 THE PARTY LINE \(call-in show, developer interview, ads and tips\)
- Raise strong-help phone mail speed caps
- Add light ambient traffic on mapped highways
- Surface audit: Industrial Park Road \(Point Tupper\) becomes paved, as an isolated delta
- Bake terrain height bounds and check them against all ground PNGs
- Repair terrain browser cache and geometry witnesses
- Fix unread phone terrain bounds for highlands and skirts
- Phone lazy land: do not draw a whole coarse tile for out-of-view quarters \(main's budget \+1\)
- Race wording: 'course', not 'route', so Just Drive passes its word check

## 2026-11-15

- Cemeteries: anonymous walled grounds in all six areas
- Phone cold start: far land out of view waits for the first pedal \(39\.6 → 24\.5 MB\)
- First room races: road checkpoints, synced starts and shared times
- Add observed building palette counts for four Strait areas
- Judique 1884: the 1884 era for a second area
- Browser slots: reaching the wait cap fails by default
- Fleet: unload, load and switch between the truck, the side by side and the dirt bike
- Checks: the wings and big-buildings rows know the yard dog's driveway
- Era door: go back to Mabou in 1884, and back
- Props: no roadside box for the hand-built house site \(Judique\), with a check and pinned Judique counts
- Add the MIT licence for the code and say what it does not cover

## 2026-11-14

- Night and twilight look for the light study
- Make the Blender mail car the default car
- Add a morning school bus loop and stop-arm score rule
- Add an unnamed yard dog at an invented route driveway
- feat: deliver mail through openings and retain mailbox damage
- Large buildings as blocks and tanks, measured from open heights \(switch off in every area\)
- Help pages for Just Drive and Mabou Mail Madness
- About pages for Just Drive and Mabou Mail Madness
- Mail car: an optional Blender-made car \(off by default, ?car=blender\) with a safe fallback to the code car
- Guard rails in every area, by rule from the land, with real collision \(Mabou Mines cliff rail and the Highland bull\)
- Mail car: tail lamps seated in body sockets \(no paint notch over the lens\)
- Radio: one file to rename stations and change their playlists, checked before any write
- Roadside story starts again for motor rides \(the \#103 play flag, with a real frame-loop check\)
- Porch dog at the end of Beaton Road, and a start link \(?start=\<road\>\) behind the title card
- Light study: a dated Halifax sun for drive-around mode, with shareable places \(and safe placement\)
- Mabou road-shaped ground: checks and land-made files for the new land \(the copy is done\)
- Radio: every station in every area, both brands and 1884 \(the horse stays silent\)
- Point Tupper: an opt-in hard-paved ground layer \(off by default, no data shipped\)
- Mailboxes: decide on the road lines before the bed move, place on the moved lines; keep box for porch-site

## 2026-11-13

- Horse checks: green again on main \(fixed-commit comparisons, hud-text anchor, audio polling\)
- 1884 era: a rideable horse for Mabou 1884 \(gaits, tack, sound, timber bridge banks\); today's game unchanged
- bake\.sh: check the area name before any file is touched
- Property lines: a live map layer from the Province, off by default
- Road-shaped ground: keep boxes round hand-built places, one move per junction \(off by default\)
- main\.ts G19a: the slow-computer shadow guard counts only play frames
- main\.ts slice 4 \(G18\): demo and test switches leave the frame
- main\.ts slice 3 \(G17\): named play flags for the drive frame
- Checks: move two text pins to PR \#90's reviewed lines, so main is green again
- main\.ts slice 2 \(G14\): one world-update registry for the drive frame and the endings
- sxs-browser: wait for quiet land \(3 updates, no failed tile\) and fail with a setup timeout, not a CDP timeout
- main\.ts slice 1 \(G13\): one expose\(\) for the dev API and an ordered resets list
- West Bay: off-road driving and a quarry trip
- check-all: print each row's verdict as it ends, so a killed run keeps its results
- Radio check: test the chip's state class as a token, so the phone HUD's 'expanded' class no longer hides OFF
- Host classes: 50 of 61 browser rows run on Linux, with evidence
- Phone speed cap: off in Just Drive, shown in the mail game, paved streets 70
- Title card: a contact line for corrections and removals
- Phone HUD that leaves the road clear, and a throw-now cue that makes mail land
- Start where I am: begin the drive at a safe road near your location
- Multiplayer: show each player's real vehicle, fade nearby players

## 2026-11-12

- Remote checks over SSH: send the allow-listed tree, run on Linux, keep exit codes
- 1884 era: period house density for Mabou, trades kept on safe ground and at water, period road names and tab title
- Four checks that were red on main repaired: area, church, side-by-side and the mutation watcher \(the game was right\)
- Browser start-up: NVIDIA GPU mode for Linux, and a GPU proof on every start
- Road-shaped ground: an optional bake step that puts roads on their real bed \(off by default\)
- One helper builds the Shadows, Grass and Water reflections settings rows
- Grass and water browser checks green again through the runner
- Terrain check: a test for the 1884 era during a loading burst, and a faster run
- Tiles are built one per frame while you drive; a jump or a start builds within a time budget
- Mabou, 1884: a history era for the driving game \(cart roads, timber bridges, 48 trades, no modern layer\)
- Coast check: the stand-in terrain gets the method that the tile cache added
- One check runner; mutation runs no longer rewrite source files
- Tiles: a bounded cache, trees only on fine ground, and an honest ready signal for tools
- Vehicle clean-ups: a seedable shake, frozen specs, one unread field removed
- A check for the packed land files, and two faults it found in the reader
- The HUD text is written only when it changes
- Browser checks own their ports and their processes; a page that throws fails the run; at most two check browsers at once
- Just Drive address: justdrive\.fakkeldy\.ca/\<place\> opens the drive-around game with no mail content
- Road queries make no key strings; a small bridge grid answers deck lookups
- Full detail switch and Picture choice for phones and tablets \(waits for Dan: one question\)
- Add Canso Causeway and Troy land with a bounded coastal trail estimate
- Radio: a second list for the drive-around game, with nothing about the mail
- Trees outside the view are not drawn: a phone's worst scene goes from 836 to 264 draw calls, with the same picture
- Judique: the old church on River Denys Mountain, from the owner's hand-built model
- Areas: West Bay, one area round the whole bay
- The tab keeps the game's name, a stopped game says so, and extra link keys no longer skip the title card
- Home: neutral wording on what a player reads \(the place name, its note and the HUD word no longer say who lives there\)
- Frame budget: a check that counts one whole frame at fixed places and fails when a count grows
- A trailer for the pickup: towing, sway, a jackknife limit and reversing help behind ?trailer=1
- Home-screen app and offline play: add the site to a home screen, and save Mabou for play with no network
- Keyboard baseline: frozen in the repository, with a progress floor and three frame rates
- Shader pin: take in the lawn surface of the Judique house \(PR 47\)
- Phone pedals: a pedal stays down while any finger still holds it
- Driving mode: a dirt bike with its own two-wheel physics
- Judique: the Red Roof by the Brook house on Old Chisholm Mill Road

## 2026-11-11

- Require explicit vehicle specs for scenery APIs
- Shader pin: always on, from a baseline file in the repository
- A side by side: a sport buggy with long-travel suspension behind ?vehicle=sxs
- The site rehearsal runs on a site of any size
- The coast at Mabou Coal Mines: gypsum cliffs, tilted rock, a beach, and the dark recesses on Finlay Point
- Areas: full Judique box with the River Denys Mountain road, Port Hood, named extra 1 m roads, and a hairpin fix for new areas
- Add Point Tupper land and correct utility trees and movable bridges
- Driving Mabou: a drive-around mode with no mail, and 15 places to visit
- Multiplayer check: it can run against the live address \(MP\_ORIGIN\), and waits for real joins
- Multiplayer for players: the Drive with others switch, room codes, and the live Cloudflare configuration \(no deploy\)
- Truck looks, second pass: a modern dually body, LED lamps and gloss paint
- Vehicle seam: a spec and a rig for every vehicle, and a heavy pickup behind ?vehicle=truck
- Area packs: the bake and the engine take an area; first piece of Judique
- Radio: a new player starts on 107\.3 SECOND DELIVERY
- The fishing ending: a wharf at Mabou Harbour, a deckhand job, a boat out to sea
- Multiplayer, first version, switched off: other players' cars behind ?mp=1 \(local room server only\)
- Radio: 107\.3 SECOND DELIVERY, the story of the mines and three place songs in other kinds of music
- More songs about places on the map
- Radio: a classical station, a credit for every song, and a list for the private page
- The road scene on Mabou Mines Road: a visitor, a cow and a fish truck
- Phone driving help: steering help that works under a thumb, and a soft top speed
- The jump job: a clean jump off the slipway gets a job offer, and an ending
- Gentle car damage: a repair bill, a stuck window, a steering pull
- The yard's slipway as a ramp you can drive up and jump off
- Low detail on desktops, and a line that says what the browser draws with
- The mail car: a rounder, prettier body
- Phones: two quick taps no longer zoom the page
- The Picture setting is measured once at a first visit
- Buildings from wings where the mapped outline is not a rectangle
- Water that mirrors the shore, with a shore band and sun glitter \(desktop\)
- Phone HUD in one grid, so controls cannot overlap
- A Picture setting on desktops: Sharp, Balanced or Fast
- Grass on fields, lawns and verges \(desktop\)
- Fuller trees near the camera
- Brooks, traced on the LiDAR channel, and culvert mouths
- A frame rate check that counts the frames the game really draws
- Tools run on macOS as well as Linux
- Phone layout: no overlapping controls, END SHIFT in settings, and a layout check
- More radio stations and songs
- Radio: "Red Flag Down", a public song list, and songs played from memory

## 2026-11-10

- Desktop quality: real shadows from the low sun
- A car radio: stations on a wall clock, key T, songs as data
- Stage 2: the shift, complaints, animals, the mine, the rail trail and the works yard
- Stage 1: real Mabou terrain, roads, trees, buildings and a drivable mail car

## 2026-11-09

- Initial commit
