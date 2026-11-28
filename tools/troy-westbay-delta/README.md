# Troy to West Bay land delta

Extends the `cansocauseway` ("Canso Causeway and Troy") baked land east by one 2048 m column (`L5` tiles `17_15` through `17_23`, `E = 626316` to `E = 628364`) so it meets `westbay` with no gap.

## What changes

- 9 new 8 m terrain tiles (`5/17_15..23`), 36 new 4 m tiles, 123 new 2 m corridor tiles, and 250 new 1 m corridor tiles, with matching road fields and tree tiles.
- Real provincial roads linking Troy to the West Bay boundary (`Highway 105`, `Long Stretch Road`, `MacGregor Lane`, `MacIntyre Mountain Road`, `MacIntyre Road`, `MacMaster Road`, `General Line Road`, `Rhodena Road`, `Kings Road`, `MacDonald Road`, and connecting tracks/driveways). All existing road IDs (`1..660`) and building IDs (`842` buildings) stay unchanged.
- 248 new buildings, updated building styles, foundations, props, streams, 2 new cemeteries, 12 new open-pavement tiles (44 total), updated `bridge-decks.bin` (26 spans), updated `cover.png`, and updated `tall.json` `mid` box.
- Only the 12 owned keys in `areas/cansocauseway/manifest.json` change. Unrelated manifest keys survive install and rollback.

## Main-thread install and rollback

Verify the staged delta and live land:

```bash
python3 tools/troy-westbay-delta/patch.py verify data/work/bakes/troy-westbay-1475 data/baked
```

Install into live `data/baked` (backs up replaced files into `data/work/bakes/troy-westbay-1475/before/`):

```bash
python3 tools/troy-westbay-delta/patch.py install data/work/bakes/troy-westbay-1475 data/baked
```

Roll back to the exact prior state:

```bash
python3 tools/troy-westbay-delta/patch.py rollback data/work/bakes/troy-westbay-1475 data/baked
```
