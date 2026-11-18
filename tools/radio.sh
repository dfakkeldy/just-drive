#!/usr/bin/env bash
# One command after editing radio_stations.json. No browser, publication or source-audio changes.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
exec python3 - <<'PY'
import csv, os, pathlib, socket, subprocess, sys, tempfile
sys.path.insert(0, 'tools')
from radio_catalogue import atomic_write
root = pathlib.Path.cwd()
module = root / 'web/src/radio-credits.generated.ts'
previous = module.read_bytes() if module.exists() else None
code = 1
try:
    # validate() applies every content rule before the generator writes any output.
    subprocess.run([sys.executable, 'tools/build_radio.py'], check=True)
    with tempfile.TemporaryDirectory(prefix='mmm-radio-checks-') as out:
        with socket.socket() as port:
            port.bind(('127.0.0.1', 0))
            free_port = str(port.getsockname()[1])
        env = {**os.environ, 'OUT': out, 'MMM_CHECK_OUT': out,
               'MP_PORT': os.environ.get('MP_PORT') or free_port, 'REHEARSE_LINK_INPUTS': '1'}
        rows = csv.DictReader((root / 'tools/checks.tsv').open(), delimiter='\t')
        for row in rows:
            if row['mode'] == 'browser' or not row['name'].startswith(('radio', 'site', 'pwa')):
                continue
            print('CHECK ' + row['name'], flush=True)
            result = subprocess.run(row['command'], shell=True, executable='/bin/bash', cwd=root, env=env)
            print(f"CHECK {row['name']}: exit {result.returncode}", flush=True)
            if result.returncode:
                raise subprocess.CalledProcessError(result.returncode, row['command'])
    code = 0
    print('Radio ready. No files published.')
except subprocess.CalledProcessError as error:
    code = error.returncode
except (OSError, ValueError) as error:
    print(f'error: {error}', file=sys.stderr)
except KeyboardInterrupt:
    code = 130
finally:
    if code:
        if previous is None:
            module.unlink(missing_ok=True)
        elif not module.exists() or module.read_bytes() != previous:
            atomic_write(module, previous)
            print('Radio checks failed; restored the previous credits module.', file=sys.stderr)
sys.exit(code)
PY
