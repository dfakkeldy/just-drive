#!/usr/bin/env bash
# Run bake scripts from pipeline/ where GDAL is: this machine's python3 when it has GDAL and numpy (Dan's Mac),
# else the GDAL container with podman or docker (the Linux server). The scripts find the project folder themselves.
# Usage:
#   AREA=judique tools/bake.sh all           complete bake from fetched raw inputs (no downloads)
#   tools/bake.sh roads                      the road chain in order: 23 roads, 24 corridor, 25 road fields, 26 check, 28 trees
#   tools/bake.sh 29_bake_props.py [args]    one script, with its arguments
#   BAKE_IN=container tools/bake.sh ...      force the container;  BAKE_IN=local forces this machine's python3
# Ground steps 21 and 24 scan all manifest-listed PNGs before saving height.min/max
# (encoded ground in metres). Both the all and roads chains refresh these bounds.
# After any bake: tools/build_site.sh and python3 tools/pack_terrain.py (the site folder hard-links the baked files,
# and a bake writes manifest.json in place).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="ghcr.io/osgeo/gdal:ubuntu-small-latest"
export MMM_AREA="${AREA:-${MMM_AREA:-mabou}}"
# The area name becomes part of a path below (the READY marker). Refuse anything that is not a plain name,
# before any file is touched. pipeline/areas.py then refuses a plain name that is not a known area.
# Every allowed character is written out and the test runs in the C locale: in some locales the range [a-z]
# also matches '.' and '/', which let AREA=../../x through.
plain_name() ( LC_ALL=C; case "$1" in '' | [!abcdefghijklmnopqrstuvwxyz]* | *[!abcdefghijklmnopqrstuvwxyz0123456789]*) exit 1 ;; esac )
plain_name "$MMM_AREA" || { echo "bake.sh: AREA must be a plain area name, not '$MMM_AREA'" >&2; exit 1; }
export GDAL_CACHEMAX="${GDAL_CACHEMAX:-768}" OPENBLAS_NUM_THREADS="${OPENBLAS_NUM_THREADS:-1}"

where="${BAKE_IN:-}"
if [[ -z "$where" ]]; then
  if python3 -c 'from osgeo import gdal, ogr, osr; import numpy' >/dev/null 2>&1; then where=local; else where=container; fi
fi
if [[ "$where" == container ]]; then
  if command -v podman >/dev/null 2>&1; then engine=(podman run --rm --security-opt label=disable)
  elif command -v docker >/dev/null 2>&1; then engine=(docker run --rm)
  else echo "bake.sh: no local GDAL for python3, and no podman or docker" >&2; exit 1
  fi
fi

# Insert the logical pipeline path explicitly: Python otherwise resolves a symlink
# directory in sys.path[0], which can send imported registry paths to the live checkout.
LAUNCH='import pathlib,runpy,sys; pipeline=pathlib.Path(sys.argv.pop(1)); sys.path.insert(0,str(pipeline)); from areas import ROOT; assert ROOT == pipeline.parent, (ROOT,pipeline.parent); sys.argv=sys.argv[1:]; runpy.run_path(sys.argv[0],run_name="__main__")'

run() {   # run <script in pipeline/> [args]
  local script="$1"; shift
  [[ -f "$ROOT/pipeline/$script" ]] || { echo "bake.sh: no pipeline/$script" >&2; exit 1; }
  local started=$SECONDS
  # Any step can stop half way: an area pack is not ready to publish again until someone has looked at it.
  # (Mabou has no marker: the site is built from its folder as it is.)
  if [[ "$MMM_AREA" != mabou ]]; then rm -f "$ROOT/data/baked/areas/$MMM_AREA/READY"; fi
  echo "== $script ($where, $MMM_AREA)"
  if [[ "$where" == local ]]; then
    (cd "$ROOT" && python3 -c "$LAUNCH" "$ROOT/pipeline" "$ROOT/pipeline/$script" "$@")
  else
    "${engine[@]}" -v "$ROOT:/p" --workdir /p -e MMM_AREA -e GDAL_CACHEMAX -e OPENBLAS_NUM_THREADS -e MMM_ROAD_BED -e MMM_ROAD_GROUND -e MMM_BIG_BUILDINGS "$IMAGE" python3 -c "$LAUNCH" /p/pipeline "/p/pipeline/$script" "$@"
  fi
  echo "== $script wall: $((SECONDS - started)) s"
}

case "${1:-}" in
  all)
    if [[ "$MMM_AREA" == cansocauseway ]]; then run 03_prepare_canso_trail.py; fi
    # Property envelopes predate smoothing and wings. Preserve them on existing bakes.
    run 21_bake_terrain.py
    run 22_bake_landmarks.py
    run 23_bake_roads.py
    run 24_bake_corridor.py
    run 25_bake_road_fields.py
    run 26_check_roads.py
    if [[ "$where" == local ]]; then
      has_sites=$(cd "$ROOT" && python3 -c 'import sys; sys.path.insert(0,"pipeline"); from areas import current; print(int((current().output/"buildings.json").is_file()))')
    else
      has_sites=$("${engine[@]}" -v "$ROOT:/p" --workdir /p -e MMM_AREA "$IMAGE" python3 -c 'import sys; sys.path.insert(0,"pipeline"); from areas import current; print(int((current().output/"buildings.json").is_file()))')
    fi
    if [[ "$has_sites" == 1 ]]; then run 27_bake_buildings.py --preserve-sites
    else run 27_bake_buildings.py; fi
    run 27_check_buildings.py
    run 28_bake_trees.py
    run 29_bake_props.py
    run 30_bake_building_styles.py
    run 31_bake_streams.py
    run 32_bake_cemeteries.py ;;
  roads)
    for script in 23_bake_roads.py 24_bake_corridor.py 25_bake_road_fields.py 26_check_roads.py 28_bake_trees.py 32_bake_cemeteries.py; do run "$script"; done ;;
  '' | -h | --help)
    sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//' ;;
  *)
    run "$@" ;;
esac
