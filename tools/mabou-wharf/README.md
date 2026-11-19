# Mabou Harbour Wharf 403

The game draws the two survey buildings, small shed and wharf equipment in the modern Mabou area. The road correction uses the installed Mabou terrain.

From the Mac checkout, stage the road correction in a new folder outside live terrain.

```sh
python3 pipeline/36_stage_mabou_wharf.py --source data/baked/terrain --output /tmp/mabou-wharf-stage
python3 tools/mabou-wharf/receipt.py verify data/baked/terrain /tmp/mabou-wharf-stage
```

The stage retains the two roads' centrelines and the existing road-bed marker. It changes 11 road field tiles, the road list, and three files that reference roads. The road asset suffixes are unchanged. The sidewalk plan lies farther east and keeps its existing meshes. The stage also works in an isolated worktree with a read-only link to the installed terrain.

The main thread installs the verified stage before publishing and keeps the automatically created `mabou-wharf-stage.before` folder for rollback.

```sh
python3 tools/mabou-wharf/receipt.py install /tmp/mabou-wharf-stage data/baked
python3 tools/mabou-wharf/receipt.py land data/baked
```

To roll back the land, run the same `install` command with `uninstall` in its place.
