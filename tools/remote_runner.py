#!/usr/bin/env python3
"""Send index-listed working files and run the serial checks over SSH."""
import contextlib
import csv
import hashlib
import json
import io
import os
from pathlib import Path
import re
import selectors
import shlex
import signal
import subprocess
import sys
import time
import unicodedata
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
# Set by the INT/TERM handler; a setup step that a Ctrl-C ends still exits 130, not 2.
INTERRUPTED = [False]
DENY = ('reference/', 'docs/', 'data/', 'web/node_modules/', 'node_modules/', '.wrangler/', '.cloudflare/')
# Snapshot folders that may be sent, and the private folders a snapshot may never be inside or contain.
# paved: the open-data paved inputs that land checks read beside data/baked (corrections, source receipt; small).
SNAPSHOTS = {'baked': ('data', 'baked'), 'audio': ('data', 'audio', 'out'), 'paved': ('data', 'raw', 'paved-open')}
PRIVATE = ('data/work', 'reference', 'docs')
# Two public-safe notes that #195 (62ee9330) committed under docs/ before they moved to tools/paved-open/.
# Shared history is never rewritten, so exactly these blobs at exactly these paths are accepted in history.
# Any other content ever committed at these paths, and every other docs/ path, is still refused.
HISTORY_PINNED = {
    'docs/paved-open.md': 'b7d27671a3883f19b93e6dba3e02cf9f09a8ab6a',
    'docs/paved-corrections.example.json': '2b9f30f8e366f8c2505a804c445d9b5e6cf6df60',
}


def fold(text):
    """The key under which a name is compared with a private prefix. The Mac's file system ignores case and Unicode
    normalisation, so with core.ignorecase git stores `git add DOCS/x` as DOCS/x while the bytes come from docs/x.
    Case is folded with casefold(); NFKC on both sides joins canonically equal spellings (what APFS joins) and also
    compatibility forms such as fullwidth letters (which APFS keeps apart): a folded match only ever refuses more.
    HFS+ also ignores invisible format characters (U+200C, U+FEFF, ...; git's CVE-2014-9390), so every format
    character (category Cf) is dropped first. HISTORY_PINNED is never folded: a variant spelling of a pinned path
    is a different path, and is refused."""
    text = ''.join(c for c in text if unicodedata.category(c) != 'Cf')
    return unicodedata.normalize('NFKC', unicodedata.normalize('NFKC', text).casefold())


DENY_FOLDED = tuple(fold(p) for p in DENY)


class Interrupted(Exception):
    """A Ctrl-C (or TERM) ended a setup step; the run exits 130."""


def checked(command, **kwargs):
    return subprocess.run(command, check=True, **kwargs)


def git_paths(root, command):
    return os.fsdecode(checked(['git', *command], cwd=root, capture_output=True).stdout).rstrip('\0').split('\0')


def changed_paths(root):
    paths = []
    for diff in (['origin/main...'], [], ['--cached']):
        paths.extend(p for p in git_paths(root, ['diff', '--name-only', '-z', *diff]) if p)
    entries = git_paths(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
    index = 0
    while index < len(entries):
        entry = entries[index]
        index += 1
        if not entry:
            continue
        paths.append(entry[3:])
        if 'R' in entry[:2] or 'C' in entry[:2]:
            if index < len(entries):
                paths.append(entries[index])
                index += 1
    return list(dict.fromkeys(paths))


def allowed_path(name):
    key = fold(name)
    return bool(name) and not Path(name).is_absolute() and '..' not in Path(name).parts and not any(
        key == p.rstrip('/') or key.startswith(p) for p in DENY_FOLDED)


def index_files(root):
    candidates = git_paths(root, ['ls-files', '-z', '--cached'])
    files, real = set(), set()
    for name in candidates:
        if not allowed_path(name):
            continue
        # rsync would follow a symlinked parent folder and send whatever it points at under tracked names.
        for parent in Path(name).parents:
            if str(parent) == '.' or parent in real:
                continue
            if (root/parent).is_symlink():
                raise ValueError(f'tracked path under a symlinked folder refused: {name}')
            real.add(parent)
        if (root/name).is_file() or (root/name).is_symlink():
            files.add(name)
    return sorted(files)


# The history check and the push must see the same, raw object graph: replacement refs would show the check a
# clean commit while the push sends the original.
RAW_GIT = {'GIT_NO_REPLACE_OBJECTS': '1'}


def history_check(root, refs):
    """Every object a push of these refs can send must appear in history under an allowed path.

    Git sends whole history, not the index: a private file committed once and deleted later is still reachable.
    Returns the commit ids it checked; push sends exactly those, never the names (a ref named refs/heads/HEAD or
    refs/tags/HEAD would win over .git/HEAD in a push refspec and send an object nobody checked)."""
    grafts = Path(os.fsdecode(checked(['git', 'rev-parse', '--git-path', 'info/grafts'], cwd=root,
                                      capture_output=True).stdout).strip())
    if not grafts.is_absolute():
        grafts = root/grafts
    if grafts.exists():
        raise ValueError(f'git grafts change what history looks like ({grafts}); nothing was pushed')
    # rev-list names no path for an object a ref points at directly: a ref to a blob would send it unchecked.
    oids = []
    for ref in refs:
        oid = checked(['git', 'rev-parse', '--verify', '--end-of-options', ref], cwd=root, capture_output=True,
                      text=True, env={**os.environ, **RAW_GIT}).stdout.strip()
        kind = checked(['git', 'cat-file', '-t', oid], cwd=root, capture_output=True, text=True,
                       env={**os.environ, **RAW_GIT}).stdout.strip()
        if kind != 'commit':
            raise ValueError(f'{ref} names a {kind}, not a commit; nothing was pushed')
        oids.append(oid)
    refs = oids
    out = checked(['git', 'rev-list', '--objects', *refs], cwd=root, capture_output=True,
                  env={**os.environ, **RAW_GIT}).stdout
    for line in os.fsdecode(out).splitlines():
        name = line.partition(' ')[2]
        if name and not allowed_path(name) and not pinned_name(name):
            raise ValueError(f'git history holds a private path ({name}); nothing was pushed')
    # rev-list names each object once, so an object at an allowed path can hide a later private copy of it.
    # Every path in any commit's tree is added by some commit (merges diffed against each parent, roots in full).
    out = checked(['git', 'log', '--no-renames', '--root', '--diff-merges=separate', '--ignore-submodules=none',
                   '--name-only', '-z',
                   '--format=', *refs], cwd=root, capture_output=True, env={**os.environ, **RAW_GIT}).stdout
    for raw in os.fsdecode(out).split('\0'):
        name = raw.strip('\n')
        if name and not allowed_path(name) and not pinned_history(root, refs, raw):
            raise ValueError(f'git history holds a private path ({name}); nothing was pushed')
    return oids


def pinned_name(name):
    """The object listing may name a pinned path or the folder that held it; pinned_history then checks every
    version ever committed at each pinned path, and the per-path pass sees every other path a commit adds."""
    return any(path == name or path.startswith(name + '/') for path in HISTORY_PINNED)


def pinned_history(root, refs, name):
    """A path named in some commit is accepted only if it is pinned, exactly (a name with a line break never is:
    git -z output has none of its own), and every version of it ever committed in these refs, on every side of
    every merge, is the pinned blob or its deletion. Output of any other shape refuses."""
    if '\n' in name or '\r' in name or name not in HISTORY_PINNED:
        return False
    out = checked(['git', 'log', '--no-renames', '--root', '--diff-merges=separate', '--full-history', '--ignore-submodules=none', '--raw',
                   '--no-abbrev', '-z', '--format=', *refs, '--', name], cwd=root, capture_output=True,
                  env={**os.environ, **RAW_GIT}).stdout
    fields = os.fsdecode(out).split('\0')
    if fields[-1] != '' or len(fields) % 2 != 1:
        return False
    for meta, path in zip(fields[0:-1:2], fields[1::2]):
        parts = meta.split()
        if not meta.startswith(':') or len(parts) != 5 or path != name:
            return False
        if parts[3] != HISTORY_PINNED[name] and set(parts[3]) != {'0'}:
            return False
    return True


FIXTURE_REF = re.compile(r'refs/remotes/origin/fixture/[0-9a-f]{7}')


def fixture_refs(root):
    """Forward fixture refs for older checkouts, subject to the same history checks as HEAD."""
    out = checked(['git', 'for-each-ref', '--format=%(refname)', 'refs/remotes/origin/fixture/'], cwd=root,
                  capture_output=True, text=True, env={**os.environ, **RAW_GIT}).stdout
    return sorted(ref for ref in out.splitlines() if FIXTURE_REF.fullmatch(ref))


def push(root, url, identity, env=None):
    fixtures = fixture_refs(root)
    try:
        head, main, *kept = history_check(root, ['HEAD', 'refs/remotes/origin/main', *fixtures])
    except ValueError as error:
        # Name a fixture ref that alone fails, so a stale local ref is easy to find (and delete).
        for ref in fixtures:
            try:
                history_check(root, [ref])
            except ValueError:
                raise ValueError(f'{error} (the fixture ref {ref} fails alone)') from error
        raise
    # A push source is matched against ref names before it is read as an object id: a ref named refs/heads/<id>
    # would win. No ref name holds '^', so <id>^{commit} can only mean the id. Tags and submodules stay home.
    checked(['git', 'push', '-q', '--force', '--no-follow-tags', '--no-recurse-submodules', url,
             '+'+head+'^{commit}:refs/mmm/'+identity, '+'+main+'^{commit}:refs/remotes/origin/main',
             *('+'+oid+'^{commit}:'+ref for ref, oid in zip(fixtures, kept))],
            cwd=root, env={**(env or os.environ), **RAW_GIT})


def checkout_roots(root):
    """This checkout and every worktree of its repository: a worktree's data folder may link into another's.
    Only a repository at root counts; a folder that merely sits inside another checkout (say in its data/work)
    is not one of that checkout's worktrees."""
    roots = [root]
    with contextlib.suppress(OSError, subprocess.CalledProcessError):
        out = checked(['git', 'worktree', 'list', '--porcelain', '-z'], cwd=root, capture_output=True,
                      env={**os.environ, 'GIT_CEILING_DIRECTORIES': str(root.parent)}).stdout
        roots += [Path(os.fsdecode(f[len(b'worktree '):])) for f in out.split(b'\0') if f.startswith(b'worktree ')]
    return list(dict.fromkeys(roots))


def inside(path, folder):
    """True when path is folder or lies inside it, compared by file identity: case, Unicode and firmlink spellings
    (/System/Volumes/Data/...) of one folder agree, where resolve() keeps whichever spelling it was given."""
    try:
        target = os.stat(folder)
    except OSError:
        return False
    for parent in (path, *path.parents):
        with contextlib.suppress(OSError):
            if os.path.samestat(os.stat(parent), target):
                return True
    return False


def snapshot_source(root, kind):
    """The real snapshot folder, or None. A symlinked data folder (a worktree) is fine; a snapshot that resolves
    elsewhere, or into or around a private folder of any worktree of the repository, is refused."""
    parts = SNAPSHOTS[kind]
    folder = root.joinpath(*parts)
    if not folder.exists():
        return None
    real = folder.resolve()
    if real.parts[-len(parts):] != parts:
        raise ValueError(f'{"/".join(parts)} resolves to {real}, not a {"/".join(parts)} folder')
    # A symlink may name a private folder in another case (DATA/work); resolve() keeps the spelling it was given.
    key = Path(fold(str(real)))
    for base in checkout_roots(root):
        for name in PRIVATE:
            path = (base/name).resolve()
            private = Path(fold(str(path)))
            if key == private or key.is_relative_to(private) or private.is_relative_to(key) or \
                    inside(real, path) or inside(path, real):
                raise ValueError(f'{"/".join(parts)} resolves into or around private {name} of {base}: {real}')
    return real


def file_hash(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def fingerprint(folder, cache_path=None):
    """Content fingerprint of a snapshot. Hashes are cached by size, mtime, ctime and inode: any write
    changes ctime, so changed bytes are always hashed again."""
    if folder is None or not folder.exists():
        return 'no', 0
    cache = {}
    if cache_path and cache_path.is_file():
        with contextlib.suppress(ValueError, OSError):
            cache = json.loads(cache_path.read_text())
    fresh, entries, total = {}, [], 0
    for parent, dirs, files in os.walk(folder, followlinks=False):
        dirs.sort()
        for name in dirs + files:
            path = Path(parent)/name
            if path.is_symlink():
                raise ValueError(f'symlink inside snapshot refused: {path}')
        rel_dir = Path(parent).relative_to(folder).as_posix()
        entries.append(f'd\0{rel_dir}')
        for name in sorted(files):
            path = Path(parent)/name
            stat = path.stat()
            rel = path.relative_to(folder).as_posix()
            key = [stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns, stat.st_ino]
            known = cache.get(rel)
            digest = known[4] if isinstance(known, list) and known[:4] == key else file_hash(path)
            fresh[rel] = key+[digest]
            entries.append(f'f\0{rel}\0{digest}')
            total += stat.st_size
    if cache_path:
        with contextlib.suppress(OSError):
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            temp = cache_path.with_name(cache_path.name+f'.{os.getpid()}')
            temp.write_text(json.dumps(fresh))
            temp.replace(cache_path)
    return hashlib.sha256(os.fsencode('\n'.join(sorted(entries)))).hexdigest()[:16], total


def metadata(root, name):
    path = root/'tools'/name
    if name == 'remote-hosts.tsv':
        local = path.with_suffix('.local.tsv')
        if local.is_file():
            path = local
    if not path.exists():
        return {}
    with path.open() as source:
        return {row['name' if name == 'checks-hosts.tsv' else 'alias']: row
                for row in csv.DictReader(source, delimiter='\t')}


def with_changed(args, changed):
    """Replace --changed with one --for holding the explicit and the changed paths (as check-all merges them)."""
    rest, explicit, index = [], [], 0
    while index < len(args):
        if args[index] == '--for':
            index += 1
            while index < len(args) and not args[index].startswith('--'):
                explicit.append(args[index])
                index += 1
        elif args[index] == '--changed':
            index += 1
        else:
            rest.append(args[index])
            index += 1
    # An empty changed selection must remain empty, rather than select the default suite.
    return rest+['--for', *(list(dict.fromkeys(explicit+changed)) or ['README.md'])]


def select_rows(root, args):
    args = list(args)
    if '--changed' in args:
        args = with_changed(args, changed_paths(root))
    # --plan gives exactly the rows a local run with these flags executes (--list adds rows for listing).
    result = subprocess.run([sys.executable, str(root/'tools/check-all.py'), *args, '--plan'],
                            cwd=root, text=True, capture_output=True)
    rows = []
    for line in result.stdout.splitlines():
        if line.startswith('PLAN '):
            rows.append(line[len('PLAN '):])
        else:
            print(line, flush=True)
    if result.stderr:
        print(result.stderr, file=sys.stderr, end='', flush=True)
    if result.returncode not in (0, 2) or (result.returncode == 2 and not rows and 'NO CHECK COVERS' not in result.stdout):
        raise ValueError('local check selection failed')
    return rows, result.returncode == 2


def filter_rows(rows, hosts, platform, allow_unproven, machine=None):
    chosen, refused = [], False
    for name in rows:
        row = hosts.get(name, {'where': 'portable', 'software': 'no', 'evidence': ''})
        reason = None
        if row['where'] == 'apple':
            if platform != 'Darwin' or machine != 'arm64':
                reason = f'Apple silicon macOS required (Darwin/arm64), host is {platform}/{machine or "unknown"}'
        elif platform != 'Darwin':
            if row['where'] == 'mac-only':
                reason = f'Mac only on a {platform} host'
            elif row['where'] == 'unproven' and not allow_unproven:
                reason = 'not yet proven on this host'
        if reason:
            target = "an Apple silicon Mac" if row["where"] == "apple" else "a Mac"
            print(f'REFUSED {name}: {reason} ({row["evidence"]}); run it on {target}', flush=True)
            refused = True
        else:
            chosen.append(name)
    return chosen, refused


def exit_code(remote, refused=False, uncovered=False, interrupted=False):
    if interrupted or remote == 130:
        return 130
    if remote == 1:
        return 1
    if remote != 0 or refused or uncovered:
        return 2
    return 0


def shell_path(path):
    # Keep home expansion on the host, with the remaining path quoted literally.
    return '"$HOME"/'+shlex.quote(path[2:]) if path.startswith('~/') else shlex.quote(path)


class Remote:
    def __init__(self, destination, root, identity):
        self.dest = destination
        self.root = root.rstrip('/')
        self.identity = identity
        self.ssh = os.environ.get('MMM_REMOTE_SSH', 'ssh')
        self.helper = self.root+'/bin/remote_runner_host.py'

    def command(self, text):
        return [self.ssh, self.dest, text]

    def call(self, command_text, **kwargs):
        return checked(self.command(command_text), **kwargs)

    def host_command(self, action, *args):
        return 'python3 '+shell_path(self.helper)+' '+shlex.join([action, self.root, self.identity, *args])

    def host(self, action, *args, **kwargs):
        return self.call(self.host_command(action, *args), **kwargs)

    def install(self, source):
        script = ('import os,pathlib,sys; p=pathlib.Path(sys.argv[1]).expanduser(); '
                  'p.parent.mkdir(parents=True,exist_ok=True); t=p.with_name(p.name+"."+str(os.getpid())); '
                  't.write_bytes(sys.stdin.buffer.read()); t.replace(p)')
        self.call('python3 -c '+shlex.quote(script)+' '+shlex.quote(self.helper), input=source)

    def lock(self, identity=None):
        command = self.host_command('hold') if identity is None else 'python3 '+shell_path(self.helper)+' '+shlex.join(['hold', self.root, identity])
        proc = subprocess.Popen(self.command(command), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=None)
        selector = selectors.DefaultSelector()
        selector.register(proc.stdout, selectors.EVENT_READ)
        pending = b''
        try:
            while True:
                # A Ctrl-C while waiting for the lock cancels the request (closing its stdin) and exits 130.
                if INTERRUPTED[0]:
                    raise Interrupted
                if not selector.select(.1):
                    continue
                chunk = os.read(proc.stdout.fileno(), 4096)
                if not chunk:
                    raise ValueError('remote session lock failed')
                pending += chunk
                while b'\n' in pending:
                    line, pending = pending.split(b'\n', 1)
                    if line.strip() == b'LOCKED':
                        return proc
                    print(os.fsdecode(line), flush=True)
        except BaseException:
            self.release(proc)
            raise
        finally:
            selector.close()

    @staticmethod
    def release(proc):
        if proc.stdin and not proc.stdin.closed:
            proc.stdin.close()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
        if proc.stdout:
            proc.stdout.close()

    def rsync(self, source, dest, files=None, link_dest=None, delete=False, snapshot=False):
        prefix = self.dest+':'
        if source.startswith(prefix): source = prefix+shell_path(source[len(prefix):])
        if dest.startswith(prefix): dest = prefix+shell_path(dest[len(prefix):])
        # Snapshots: compare content (-c), and leave modes out so read-only published files still link (--link-dest).
        command = ['rsync', '-rlt', '-c'] if snapshot else ['rsync', '-a']
        command += ['-e', shlex.quote(self.ssh)]
        if delete:
            command += ['--delete']
        if files is not None:
            # Preserve working edits even when size and coarse filesystem time match.
            command += ['-c', '--from0', '--files-from=-']
        if link_dest:
            command += ['--link-dest='+shlex.quote(link_dest)]
        command += [source, dest]
        # Paths are already shell-quoted for openrsync; use the same mode with GNU rsync. It must be 2, not 1:
        # at 1, GNU rsync (3.2.4 and later) still backslash-escapes option values, so a quoted --link-dest
        # reaches the host with literal quotes, names no folder, and every snapshot file is copied, not linked.
        env = {**os.environ, 'RSYNC_OLD_ARGS': '2', 'RSYNC_PROTECT_ARGS': '0'}
        checked(command, input=files, env=env)

    def snapshot(self, kind, fp, source):
        if fp == 'no':
            return
        result = self.host('stage', kind, fp, capture_output=True, text=True)
        stage = json.loads(result.stdout)
        if stage['needed']:
            self.rsync(str(source)+'/', self.dest+':'+stage['partial']+'/', link_dest=stage['link_dest'], delete=True,
                       snapshot=True)


def run_stream(remote, rows, flags, interrupted):
    command = remote.host_command('run', '--', 'tools/check-all.sh', '--only', *rows, *flags)
    proc = subprocess.Popen(remote.command(command), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT)
    selector = selectors.DefaultSelector()
    selector.register(proc.stdout, selectors.EVENT_READ)
    evidence = []
    pending = b''
    deadline = None
    try:
        while selector.get_map():
            if interrupted[0] and deadline is None:
                proc.stdin.close()
                deadline = time.monotonic()+30
            if deadline is not None and time.monotonic() >= deadline:
                proc.kill()
                break
            for key, _ in selector.select(.1):
                chunk = os.read(key.fileobj.fileno(), 65536)
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                sys.stdout.buffer.write(chunk)
                sys.stdout.buffer.flush()
                pending += chunk
                while b'\n' in pending:
                    line, pending = pending.split(b'\n', 1)
                    text = os.fsdecode(line)
                    if text.startswith('Evidence kept at '):
                        evidence.append(text[len('Evidence kept at '):].strip())
        if pending.startswith(b'Evidence kept at '):
            evidence.append(os.fsdecode(pending[len(b'Evidence kept at '):]).strip())
        return proc.wait(), evidence
    finally:
        selector.close()
        remote.release(proc)


def copy_evidence(remote, root, paths):
    for index, path in enumerate(dict.fromkeys(paths)):
        stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')
        safe = re.sub(r'[^A-Za-z0-9_-]', '-', remote.dest)
        local = root/'data/work/remote-checks'/f'{safe}-{remote.identity}-{stamp}'
        if index:
            local = local.with_name(local.name+f'-{index}')
        local.mkdir(parents=True, exist_ok=True)
        remote.rsync(remote.dest+':'+path+'/', str(local)+'/')
        print('Evidence copied to '+str(local), flush=True)
        remote.host('remove-evidence', path)


def main():
    if len(sys.argv) < 2:
        print('usage: remote-check.sh <ssh-destination> [check-all args]', file=sys.stderr)
        return 2
    dest, *args = sys.argv[1:]
    if '--list' in args:
        args = [a for a in args if a != '--allow-unproven']
        return subprocess.run([sys.executable, str(ROOT/'tools/check-all.py'), *args], cwd=ROOT).returncode
    if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.@-]*', dest):
        raise ValueError('invalid SSH destination')
    allow = '--allow-unproven' in args
    args = [a for a in args if a != '--allow-unproven']
    with contextlib.redirect_stdout(io.StringIO()) as local_output:
        rows, uncovered = select_rows(ROOT, args)
    if not rows:
        print(local_output.getvalue(), end='', flush=True)
        print('No checks selected; nothing sent')
        return 2 if uncovered else 0
    identity = ROOT.name+'-'+hashlib.sha256(os.fsencode(str(ROOT))).hexdigest()[:8]
    identity = re.sub(r'[^A-Za-z0-9_-]', '-', identity)
    remote = Remote(dest, os.environ.get('MMM_REMOTE_ROOT', '~/mmm-runner'), identity)
    remote.install((ROOT/'tools/remote_runner_host.py').read_bytes())
    platform = remote.call('uname -s', capture_output=True, text=True).stdout.strip()
    machine = remote.call('uname -m', capture_output=True, text=True).stdout.strip()
    version = remote.host('info', capture_output=True, text=True).stdout.strip()
    mac = checked(['node', '--version'], capture_output=True, text=True).stdout.strip()
    print(f'remote-check: host {dest} ({platform}/{machine}), checkout {identity}, node {version} (Mac {mac})', flush=True)
    print(local_output.getvalue(), end='', flush=True)
    rows, refused = filter_rows(rows, metadata(ROOT, 'checks-hosts.tsv'), platform, allow, machine)
    if not rows:
        return 2
    trust = metadata(ROOT, 'remote-hosts.tsv').get(dest, {}).get('trust', 'rented')
    files = index_files(ROOT)
    payload = b''.join(os.fsencode(p)+b'\0' for p in files)
    cache = ROOT/'data/work/remote-checks'
    baked_source = snapshot_source(ROOT, 'baked')
    audio_source = snapshot_source(ROOT, 'audio') if trust == 'own' else None
    baked, _ = fingerprint(baked_source, cache/'content-baked.json')
    audio, _ = fingerprint(audio_source, cache/'content-audio.json')
    try:
        paved_source = snapshot_source(ROOT, 'paved')
    except ValueError as error:
        # Optional input: send nothing (its rows SKIP on the host for the missing path) rather than stop every run.
        print(f'not sending data/raw/paved-open: {error}', file=sys.stderr, flush=True)
        paved_source = None
    paved, _ = fingerprint(paved_source, cache/'content-paved.json')
    print(f'sending {len(files)} files (git index), baked {baked}, audio {audio}, paved-open {paved}', flush=True)
    interrupted = INTERRUPTED
    def stop(_sig, _frame):
        interrupted[0] = True
    old = {s: signal.signal(s, stop) for s in (signal.SIGINT, signal.SIGTERM)}
    session = shared = None
    try:
        session = remote.lock()
        remote.host('init')
        # Each checkout is its own repository: another session's push cannot move this one's origin/main.
        repo = remote.root+'/checkouts/'+identity+'/.git'
        url = 'ssh://'+dest+('' if repo.startswith('/') else '/')+repo
        env = {**os.environ, 'GIT_SSH_COMMAND': shlex.quote(remote.ssh)}
        push(ROOT, url, identity, env)
        remote.host('clean', input=payload)
        remote.rsync(str(ROOT)+'/', dest+':'+remote.root+'/checkouts/'+identity+'/', files=payload)
        shared = remote.lock('shared')
        remote.snapshot('baked', baked, baked_source)
        remote.snapshot('audio', audio, audio_source)
        remote.snapshot('paved', paved, paved_source)
        remote.host('prepare', baked, audio, paved, input=payload)
        remote.release(shared)
        shared = None
        if interrupted[0]:
            return 130
        code, evidence = run_stream(remote, rows, [a for a in args if a in {'--browser', '--full', '--quick'}], interrupted)
        if code == 255:
            print('remote-check: cannot reach '+dest, file=sys.stderr)
        try:
            copy_evidence(remote, ROOT, evidence)
        except (OSError, subprocess.CalledProcessError) as error:
            print('remote-check: evidence copy failed: '+str(error), file=sys.stderr)
            if code not in (1, 130): code = 2
        return exit_code(code, refused, uncovered, interrupted[0])
    finally:
        if shared:
            remote.release(shared)
        if session:
            remote.release(session)
        for sig, handler in old.items():
            signal.signal(sig, handler)


def cli():
    try:
        return main()
    except (KeyboardInterrupt, Interrupted):
        return 130
    except subprocess.CalledProcessError as error:
        if INTERRUPTED[0]:
            return 130
        if error.returncode == 255:
            print('remote-check: cannot reach '+sys.argv[1], file=sys.stderr)
        else:
            print('remote-check: setup failed: '+str(error), file=sys.stderr)
        return 2
    except (OSError, ValueError) as error:
        if INTERRUPTED[0]:
            return 130
        print('remote-check: '+str(error), file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(cli())
