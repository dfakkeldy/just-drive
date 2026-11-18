# Select an installed local Wrangler; never install, log in or deploy.
# Optional arguments supply an explicit candidate list for the contract tests.
mmm_select_wrangler() {
  local require_origin=0
  if [[ "${1:-}" == --require-origin-flag ]]; then require_origin=1; shift; fi
  if [[ -n "${WRANGLER:-}" ]]; then
    command -v "$WRANGLER" >/dev/null || { echo "Cannot run WRANGLER=$WRANGLER" >&2; return 2; }
    export WRANGLER; return 0
  fi
  local selected
  selected="$(python3 - "$require_origin" "$@" <<'PY'
from concurrent.futures import ThreadPoolExecutor
import os, pathlib, re, shutil, subprocess, sys
require_origin = sys.argv[1] == '1'
candidates = sys.argv[2:] or [str(p) for p in pathlib.Path.home().glob('.npm/_npx/*/node_modules/.bin/wrangler')]
fallback = shutil.which('wrangler')
candidates = sorted(set(candidates))
env = dict(os.environ, WRANGLER_SEND_METRICS='false')
def inspect(path):
    parts, label = (), 'unavailable'
    try:
        version = subprocess.run([path, '--version'], env=env, capture_output=True, text=True, timeout=20)
        output = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', version.stdout).strip().splitlines()
        versions = re.findall(r'\b(\d+)\.(\d+)\.(\d+)\b', output[0] if output else '')
        if not versions: return ((), 'unknown', path, False)
        parts = tuple(map(int, versions[0])); label = '.'.join(map(str, parts))
        if not require_origin: return (parts, label, path, version.returncode == 0)
        help = subprocess.run([path, 'dev', '--help'], env=env, capture_output=True, text=True, timeout=20)
        return (parts, label, path, help.returncode == 0 and '--infer-origin-from-routes' in help.stdout)
    except (OSError, subprocess.TimeoutExpired): return (parts, label, path, False)
with ThreadPoolExecutor(max_workers=4) as pool: found = list(pool.map(inspect, candidates))
usable = sorted((r for r in found if r[3]), reverse=True)
if not usable and fallback and fallback not in candidates:
    found.append(inspect(fallback))
    usable = [found[-1]] if found[-1][3] else []
if not usable:
    requirement = ' supporting --infer-origin-from-routes' if require_origin else ''
    print('Cannot run Wrangler: no installed version'+requirement+'; versions found: ' + ', '.join(sorted({r[1] for r in found}) or ['none']), file=sys.stderr)
    sys.exit(2)
print(usable[0][2])
PY
)" || return 2
  WRANGLER="$selected"; export WRANGLER
}
