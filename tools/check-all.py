#!/usr/bin/env python3
"""Run registered checks serially, retaining each check's exit verdict."""
import argparse
import csv
import fnmatch
from functools import lru_cache
import os
from pathlib import Path
import re
import signal
import shutil
import shlex
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)
# Discover executable test families and name every library/fixture explicitly.
PATTERNS = ('check-*.sh', '*-check.mjs', '*-mutations.mjs', '*-check.py',
            'check-*.py', 'check_*.py', 'check-*.mjs', '*-browser.mjs',
            '*-regressions.sh', '*-tests.py', '*-tests.mjs', '*-physics.mjs',
            '*-integration.mjs', '*-regressions.mjs', '*-review.mjs', '*-round[23].mjs', '*-sweep.mjs', '*-witnesses.mjs', '*-test-*.mjs', '*-suite.mjs', '*-shots.sh', '*-survey.py', '*-game-pictures.mjs')
IGNORE = {
    'check-all.sh': 'orchestrator', 'check-all.py': 'orchestrator',
    'check-browser-fixture.sh': 'fixture used by browser-runtime',
    'check-browser-standin.py': 'HTTP stand-in used by browser-runtime',
    'check-ports.py': 'port lock/probe helper exercised by browser-runtime',
    'check-ports-probe.mjs': 'stand-in/real browser fixture, not a standalone verdict',
    'run-node-check.mjs': 'bundling helper; requires a check entry point',
    'coast-recess-browser.mjs': 'probe library executed by coast-browser',
    'coast-scene-browser.mjs': 'scene library executed by coast-browser',
    'pwa-test-download.mjs': 'download assertions used by PWA browser suites',
    'fishing-browser.mjs': 'CDP fixture used by the three fishing browser checks',
    'car-shots.sh': 'pictures only; also a starter for car-check',
    'props-shots.sh': 'pictures only', 'styles-shots.sh': 'pictures only',
    'yard-shots.sh': 'pictures only; also the shared check starter',
    'sxs-game-pictures.mjs': 'standalone picture helper with two assertions',
    'sxs-pictures.mjs': 'pictures only',
    'fishing-survey.py': 'survey/picture helper with one assertion',
    'bridges-missing-survey.py': 'read-only source/DTM census requiring --source-data; bridge contracts run in bridges-source',
    'damage-timing-browser.mjs': 'assertion library executed by damage-browser',
    'tree-triangles.mjs': 'prints far tree triangle counts; no verdict',
}
SLOW_STARTUP_PROOFS = {'browser-runtime', 'browser-listeners', 'browser-ownership', 'browser-kill-everything'}
STARTUP_PROOFS = {'browser-runtime', 'browser-listeners', 'browser-ownership',
                  'browser-kill-everything', 'browser-identity', 'cdp', 'runner-contract', 'gpu-proof'}


@lru_cache(maxsize=None)
def startup_path(path):
    if path in {'tools/browser.sh', 'tools/browser_process.py', 'tools/browser-slots.py',
                'tools/check-ports.py', 'tools/cdp.mjs', 'tools/shots.sh', 'tools/gpu-proof.mjs'} or fnmatch.fnmatchcase(path, 'tools/*-shots.sh'):
        return True
    if path.startswith('tools/') and path.endswith('.sh') and (ROOT/path).is_file():
        source = re.sub(r'^\s*#.*$', '', (ROOT/path).read_text(), flags=re.M)
        return bool(re.search(r'\bstart_check\b|tools/yard-shots\.sh', source))
    return False


class DependencyScan:
    """Read each tool once; follow static imports and literal wrapper inputs, never execute them."""
    def __init__(self, root):
        self.root = root
        self.cache = {}

    def references(self, text, parent):
        # Expand the simple literal shell loops used by bundled-check wrappers.
        text = re.sub(r'^\s*(?:#|//).*$', '', text, flags=re.M)
        text = re.sub(r"^\s*(?:echo|printf)\s+(?:'[^']*'|\"[^\"]*\")\s*$", '', text, flags=re.M)
        expanded = text
        for variable, values in re.findall(r'for (\w+) in ([^;\n]+);?\s*do', text):
            try: words = shlex.split(values)
            except ValueError: continue
            for value in words:
                value = re.sub(r'^\$\{\w+:-', '', value).rstrip('}')   # ${LIST:-a.mjs b.mjs}
                if re.fullmatch(r'[\w.-]+', value):
                    expanded += '\n' + re.sub(r'\$'+variable+r'\b|\$\{'+variable+r'\}', value, text)
        specs = re.findall(r"(?:from\s*|import\s*\(\s*)['\"]([^'\"]+)['\"]", expanded)
        specs += re.findall(r"['\"]([\w./-]+\.(?:mjs|js|ts|py|sh))['\"]", expanded)
        specs += ['tools/'+part for part in re.findall(r'tools/([\w./-]+\.(?:mjs|js|ts|py|sh))', expanded)]
        specs += [part+'.py' for part in re.findall(r'^(?:from|import) (\w+)', text, re.M)]
        specs += re.findall(r"\bRUN=['\"]?([\w.-]+\.mjs)", expanded)
        specs += re.findall(r"['\"]([\w./-]+)['\"]", expanded)
        found = set()
        for spec in specs:
            candidates = [parent/spec, self.root/spec, self.root/'tools'/spec]
            if not Path(spec).suffix:
                candidates += [Path(str(path)+suffix) for path in candidates for suffix in ('.mjs','.py','.sh')]
            if spec.startswith('./tools/'): candidates.append(self.root/spec[2:])
            for path in candidates:
                path = Path(os.path.normpath(path))
                try: relative = path.relative_to(self.root)
                except ValueError: continue
                if relative.parts and relative.parts[0] == 'tools' and path.is_file(): found.add(relative.as_posix())
        return found

    def command(self, command):
        pending = list(self.references(command, self.root))
        seen = set()
        while pending:
            path = pending.pop()
            if path in seen: continue
            seen.add(path)
            if path not in self.cache:
                source = (self.root/path).read_text() if Path(path).suffix in {'.mjs','.js','.ts','.py','.sh'} else ''
                self.cache[path] = self.references(source, (self.root/path).parent)
            pending.extend(self.cache[path] - seen)
        return seen


def no_check_needed(path):
    # A removed tracked executable has no source left to exercise. Do not treat
    # arbitrary missing --for paths as deletions: a typo must remain uncovered.
    if not (ROOT/path).exists() and not (ROOT/path).is_symlink():
        for base in ('HEAD', 'origin/main...'):
            result = subprocess.run(['git','diff',base,'--name-only','--diff-filter=D','-z','--',path],capture_output=True,text=True)
            if result.returncode == 0 and path in result.stdout.split('\0'): return True
    return path.endswith('.md') or path.startswith('docs/') or Path(path).name in {'.gitignore', 'LICENSE'}


def covers(check, path, dependencies):
    # The four costly stand-in proofs never read game source.
    if check['name'] in SLOW_STARTUP_PROOFS:
        return startup_path(path) or path in dependencies[check['name']]
    if path.startswith('tools/baseline/source/'):
        return any(fnmatch.fnmatchcase(path, pattern) for pattern in check['globs'].split()
                   if pattern.startswith('tools/baseline/source/'))
    web = path.startswith(('web/src/', 'web/pwa/')) or path == 'web/index.html' or any(
        fnmatch.fnmatchcase(path, p) for p in ('web/package*.json', 'web/vite*.ts', 'web/*-build.ts', 'web/tsconfig*'))
    if web: return True
    if path.startswith(('server/', 'deploy/')) and check['name'].startswith(('site', 'pwa', 'mp')): return True
    if startup_path(path) and (check['name'] in STARTUP_PROOFS or check['mode'] == 'browser'): return True
    if path in dependencies[check['name']]: return True
    globs = check['globs'].split() + ['tools/check-all*', 'tools/checks.tsv', 'tools/run-node-check.mjs']
    return any(fnmatch.fnmatchcase(path, pattern) for pattern in globs)


def row_line(row):
    name, state, code, elapsed, first = row
    return f'{name} | {state} | {code} | {elapsed:.2f} | {first.replace(chr(10), " ")}'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--full', action='store_true', help='include the four costly stand-in start-up proofs')
    parser.add_argument('--browser', action='store_true', help='include serial browser checks')
    parser.add_argument('--quick', action='store_true', help='omit node-mutations rows')
    parser.add_argument('--list', action='store_true', help='list inventory, modes, commands and coverage')
    parser.add_argument('--plan', action='store_true', help='print "PLAN <row>" for exactly the rows a run with these flags executes')
    parser.add_argument('--only', nargs='+', default=[], metavar='NAME')
    parser.add_argument('--for', dest='paths', nargs='+', default=[], metavar='PATH')
    parser.add_argument('--changed', action='store_true', help='select from git diff --name-only origin/main... plus working edits')
    parser.add_argument('--ci', action='store_true', help='clean clone without data/: rows marked mac-only or apple in checks-hosts.tsv, and rows whose missing needs lie inside data/, SKIP without failing the run; any other missing need still exits 2')
    args = parser.parse_args()
    with (ROOT / 'tools/checks.tsv').open() as f:
        checks = list(csv.DictReader(f, delimiter='\t'))
    names = [c['name'] for c in checks]
    hosts_path = ROOT / 'tools/checks-hosts.tsv'
    hosts = {}
    if hosts_path.exists():
        with hosts_path.open() as f:
            hosts = {r['name']: r for r in csv.DictReader(f, delimiter='\t')}
    missing_hosts = sorted(c['name'] for c in checks if c['mode'] == 'browser' and c['name'] not in hosts)
    stale_hosts = sorted(set(hosts) - set(names))
    if missing_hosts or stale_hosts:
        for name in missing_hosts: print('MISSING host classification: ' + name, file=sys.stderr)
        for name in stale_hosts: print('UNKNOWN host classification: ' + name, file=sys.stderr)
        return 1
    if len(names) != len(set(names)):
        parser.error('duplicate check names in checks.tsv')
    compilers = [c for c in checks if c['name'] == 'tsc']
    if len(compilers) != 1: parser.error('checks.tsv must contain exactly one tsc row')
    compiler = compilers[0]
    if any(c['mode'] not in ('node', 'node-mutations', 'browser') for c in checks): parser.error('invalid check mode')
    registered = {s for c in checks for s in c['scripts'].split() if s != '-'}
    discovered = {p.name for pattern in PATTERNS for p in (ROOT / 'tools').glob(pattern)}
    missing = sorted(discovered - registered - IGNORE.keys())
    stale = sorted(registered - {p.name for p in (ROOT / 'tools').iterdir()})
    if missing or stale:
        for name in missing: print('UNREGISTERED check: ' + name, file=sys.stderr)
        for name in stale: print('MISSING registered script: ' + name, file=sys.stderr)
        return 1
    unknown = sorted(set(args.only) - set(names))
    if unknown: parser.error('unknown check(s): ' + ', '.join(unknown))
    scan = DependencyScan(ROOT)
    dependencies = {c['name']: scan.command(c['command']) for c in checks}
    paths = list(args.paths)
    if args.changed:
        for diff in (['origin/main...'], [], ['--cached']):
            run = subprocess.run(['git', 'diff', '--name-only', '-z', *diff], capture_output=True, text=True)
            if run.returncode: print(run.stderr, file=sys.stderr); return 2
            paths += run.stdout.rstrip('\0').split('\0') if run.stdout else []
        status = subprocess.run(['git', 'status', '--porcelain=v1', '-z', '--untracked-files=all'], capture_output=True, text=True)
        if status.returncode: print(status.stderr, file=sys.stderr); return 2
        entries = status.stdout.split('\0'); index = 0
        while index < len(entries):
            entry = entries[index]; index += 1
            if not entry: continue
            paths.append(entry[3:])
            if 'R' in entry[:2] or 'C' in entry[:2]:
                if index < len(entries): paths.append(entries[index]); index += 1
    paths = list(dict.fromkeys(os.path.relpath(p, ROOT) if os.path.isabs(p) else p.removeprefix('./') for p in paths))
    prose = [p for p in paths if no_check_needed(p)]
    for path in prose: print('NO CHECK NEEDED ' + path)
    paths = [p for p in paths if p not in prose]
    uncovered = [p for p in paths if not any(covers(c, p, dependencies) for c in checks)]
    for path in uncovered: print('NO CHECK COVERS ' + path)
    if any(startup_path(p) for p in paths): print('browser start-up changed: run --browser')
    def enabled(check):
        return check['name'] not in SLOW_STARTUP_PROOFS or args.full or check['name'] in (args.only or []) or any(covers(check, p, dependencies) for p in paths)
    if not args.full and not any(enabled(c) for c in checks if c['name'] in SLOW_STARTUP_PROOFS):
        print('start-up proofs not run (no starter changed); use --full')
    chosen = []
    for check in checks:
        if args.only and check['name'] not in args.only: continue
        if not enabled(check): continue
        if not args.only and (args.paths or args.changed) and not (args.full and check['name'] in SLOW_STARTUP_PROOFS) and not any(covers(check, p, dependencies) for p in paths): continue
        # Explicit --only is sufficient to select a browser row; no browser starts by default.
        if check['mode'] == 'browser' and not (args.browser or args.only or (args.list and (args.paths or args.changed))): continue
        if args.quick and check['mode'] == 'node-mutations' and not args.only: continue
        chosen.append(check)
    # A mutations row marked 'includes-base' runs the plain cases first: do not run the plain row a second time.
    covered = {c['name'][:-len('-mutations')] for c in chosen if (c.get('notes') or '').startswith('includes-base')}
    if not args.only: chosen = [c for c in chosen if c['name'] not in covered]
    missing = [name for name in (args.only or []) if name not in {c['name'] for c in chosen}]
    if chosen: chosen = [compiler] + [c for c in chosen if c['name'] != 'tsc']
    if args.plan:
        # Run semantics, not listing semantics: --list adds browser rows for --for/--changed that a run leaves out.
        if missing:
            print('NOT RUN, no such row or not selectable: ' + ', '.join(missing)); return 2
        for c in chosen: print('PLAN ' + c['name'])
        return 2 if uncovered else 0
    if args.list:
        print('check | mode | timeout seconds | last seconds | command | tool/input globs | coverage notes')
        for c in chosen: print(' | '.join([c['name'], c['mode'], c.get('timeout') or ('1800' if c['mode'] == 'browser' else '600'), c.get('last_seconds') or '-', c['command'], c['globs'], c.get('notes') or '-']))
        print('Ignored helpers: ' + ', '.join(f'{k} ({v})' for k, v in IGNORE.items()))
        measured = [float(c['last_seconds']) for c in chosen if c.get('last_seconds') not in (None, '', '-')]
        print(f'Estimated total {sum(measured):.2f}s; {len(chosen)-len(measured)} unmeasured rows')
        return 2 if uncovered else 0
    if missing and not args.list:
        print('NOT RUN, no such row or not selectable: ' + ', '.join(missing)); return 2
    if not chosen:
        print('No checks selected for: ' + ', '.join(paths))
        print('check | result | exit code | seconds | first failing line')
        print('TOTAL 0.00s; exit '+str(2 if uncovered else 0)+'; 0 SKIP')
        return 2 if uncovered else 0
    started = time.monotonic()
    rows = []
    # --ci: rows that skip only because this host is not the Mac or has no data/ do not fail the run.
    tolerated = set()
    data_root = Path(os.path.realpath(ROOT / 'data'))
    # With data absent, source-only checks still run. Do not manufacture a data folder.
    scratch_parent = Path(os.environ.get('MMM_CHECK_SCRATCH', os.environ.get('MMM_CHECK_PARENT', str(ROOT / 'data/work/checks')))).resolve()
    if (ROOT / 'data').is_dir(): scratch_parent.mkdir(parents=True, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix='checks-', dir=scratch_parent if scratch_parent.is_dir() else None)
    # Progress goes to stderr as each row ends, so a run killed outright still leaves its verdicts and logs.
    print('Evidence folder ' + tmp, file=sys.stderr, flush=True)
    def finish(row):
        rows.append(row)
        print('RESULT ' + row_line(row), file=sys.stderr, flush=True)
    try:
        env = {**os.environ, 'TMPDIR': tmp, 'MMM_CHECK_OUT': tmp, 'OUT': tmp,
               'MMM_COAST_OUT': tmp + '/coast'}
        interrupted = []
        active = [None]
        def signal_group(sig):
            if active[0] is not None:
                try: os.killpg(active[0], sig)
                except (ProcessLookupError, PermissionError): pass
        def stop(sig, _frame):
            interrupted.append(sig)
            signal_group(signal.SIGKILL if len(interrupted) > 1 else sig)
        old = {s: signal.signal(s, stop) for s in (signal.SIGINT, signal.SIGTERM)}
        def terminate(p):
            signal_group(signal.SIGTERM)
            # Kill descendants too, even when the group leader exits before its child.
            try: p.wait(timeout=2)
            except subprocess.TimeoutExpired: pass
            signal_group(signal.SIGKILL)
            p.wait()
        def run(name, command, needs='', limit=600):
            if interrupted: return
            env.pop('MMM_SOFTWARE_OK', None)
            if hosts.get(name, {}).get('software') == 'ok': env['MMM_SOFTWARE_OK'] = '1'

            host_class = hosts.get(name, {}).get('where')
            if args.ci and host_class in {'mac-only', 'apple'}:
                print(f'Checking {name}: SKIP ({host_class})', file=sys.stderr, flush=True)
                tolerated.add(name)
                finish((name, 'SKIP', 2, 0., host_class + ' in tools/checks-hosts.tsv'))
                return
            absent = [p for p in needs.split() if p != '-' and not (ROOT / p).exists()]
            # A tracked link into data/ (web/public/areas) dangles in a clean clone, so judge where the path leads.
            if args.ci and absent and all(Path(os.path.realpath(ROOT / p)).is_relative_to(data_root) for p in absent):
                tolerated.add(name)
            if absent:
                print(f'Checking {name}: SKIP (missing {", ".join(absent)})', file=sys.stderr, flush=True)
                finish((name, 'SKIP', 2, 0., 'missing ' + ', '.join(absent)))
                return
            print('Checking ' + name, file=sys.stderr, flush=True)
            begin = time.monotonic()
            with open(Path(tmp) / (name + '.log'), 'w+') as log:
                p = subprocess.Popen(['bash', '-c', command], env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
                active[0] = p.pid
                timed_out = False
                deadline = begin + limit
                while True:
                    if interrupted:
                        terminate(p); code = 130; break
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        timed_out = True; terminate(p); code = 1; break
                    try: code = p.wait(timeout=min(.1, remaining)); break
                    except subprocess.TimeoutExpired: pass
                if interrupted: terminate(p); code = 130
                active[0] = None
                log.seek(0); output = log.read()
            if code < 0: code = 128 - code
            state = 'PASS' if code == 0 else 'CANNOT RUN' if code == 2 and name != 'tsc' else 'FAIL'
            plain = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', output)
            lines = [s.strip() for s in plain.splitlines() if s.strip()]
            diagnostic = next((s for s in lines if re.search(r'^FAIL\b|\[ERROR\]|: ERROR:', s)), None)
            first = diagnostic or next((s for s in lines if re.search(r'^(?:[A-Za-z]*Error[: \[]|Traceback|No Wrangler)|missing |not found|cannot|could not|did not start', s, re.I)), lines[0] if lines else '')
            if timed_out: first = f'timed out after {limit:g} s'
            elif interrupted: first = 'interrupted by ' + signal.Signals(interrupted[0]).name
            elif not code: first = ''
            finish((name, state, code, time.monotonic() - begin, first))
        run(compiler['name'], compiler['command'], compiler['needs'], float(compiler.get('timeout') or 600))
        env['MMM_SKIP_TYPECHECK'] = '1'
        for check in sorted([c for c in chosen if c['name'] != 'tsc'], key=lambda c: ('node', 'node-mutations', 'browser').index(c['mode'])):
            if interrupted: break
            run(check['name'], check['command'], check['needs'], float(check.get('timeout') or (1800 if check['mode'] == 'browser' else 600)))
    finally:
        for sig, handler in old.items(): signal.signal(sig, handler)
    print('check | result | exit code | seconds | first failing line')
    for row in rows: print(row_line(row))
    elapsed = time.monotonic() - started
    skipped = sum(r[1] == 'SKIP' for r in rows)
    code = 130 if interrupted else 1 if any(r[1] == 'FAIL' for r in rows) else 2 if uncovered or any(r[2] == 2 and r[0] not in tolerated for r in rows) else 0
    if elapsed > 600:
        print('Slowest: ' + ', '.join(f'{r[0]} {r[3]:.1f}s' for r in sorted(rows, key=lambda r: r[3], reverse=True)[:5]) + '; use --quick to omit node-mutations.')
    print(f'TOTAL {elapsed:.2f}s; exit {code}; {skipped} SKIP' + (' (missing prerequisites; checks did not run)' if skipped else ''))
    if tolerated: print(f'CI: {len(tolerated)} SKIP rows need the Mac or data/ and do not fail this run; run them there')
    # A CI runner's evidence folder is gone after the job, so print the end of each failed row's log.
    if args.ci:
        for row in rows:
            log = Path(tmp) / (row[0] + '.log')
            if row[1] in ('FAIL', 'CANNOT RUN') and log.exists():
                print(f'---- {row[0]} log, last 40 lines ----')
                print('\n'.join(log.read_text(errors='replace').splitlines()[-40:]))
    # A failed run keeps everything. After a pass, a measurement row's small named folder (tmp/evidence/<row>/: numbers,
    # a picture) is kept and the rest (browser profiles, builds, logs) is removed; only the newest EVIDENCE_KEEP of
    # each row stay in the scratch folder.
    keep = Path(tmp) / 'evidence'
    # Rows marked retain-evidence (picture deliverables) keep their whole folder after a pass too.
    if any(r[1] != 'PASS' for r in rows) or any('retain-evidence' in c.get('notes', '').split('; ') for c in chosen): print('Evidence kept at ' + tmp)
    elif keep.is_dir():
        for item in Path(tmp).iterdir():
            if item == keep: continue
            if item.is_dir() and not item.is_symlink(): shutil.rmtree(item)
            else: item.unlink()
        if Path(tmp).parent == scratch_parent: prune_evidence(scratch_parent)
        print('Evidence kept at ' + tmp)
    else: shutil.rmtree(tmp)
    return code


EVIDENCE_KEEP = 3


def prune_evidence(parent, keep=EVIDENCE_KEEP):
    """Keep the newest `keep` passing evidence folders of each row under `parent` and remove older ones.

    Only the runner's own run folders (named checks-*) count. A passing run's folder holds only evidence/<row>/ (see
    main). Any other folder, such as a failed run that kept everything, a file or a link, is never touched."""
    parent = Path(parent)
    if not parent.is_dir(): return
    runs, by_row = [], {}
    for run in parent.iterdir():
        if not run.name.startswith('checks-') or run.is_symlink() or not run.is_dir(): continue
        try: entries = list(run.iterdir())
        except OSError: continue
        evidence = run / 'evidence'
        if [e.name for e in entries] != ['evidence'] or evidence.is_symlink() or not evidence.is_dir(): continue
        runs.append(run)
        for row in evidence.iterdir():
            if row.is_dir() and not row.is_symlink(): by_row.setdefault(row.name, []).append(row)
    for rows in by_row.values():
        rows.sort(key=lambda r: (r.stat().st_mtime_ns, str(r)), reverse=True)
        for old in rows[keep:]: shutil.rmtree(old, ignore_errors=True)
    for run in runs:
        if not any((run / 'evidence').iterdir()): shutil.rmtree(run, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
