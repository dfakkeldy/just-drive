#!/usr/bin/env python3
"""Host-side lifecycle; installed outside the checkout before every session."""
import contextlib
import fcntl
import json
import os
from pathlib import Path
import selectors
import shutil
import signal
import subprocess
import sys
import time

HOST_KEYS = {'CHROMIUM_BIN', 'MMM_BROWSER_GL', 'MMM_BROWSER_SLOTS',
             'MMM_BROWSER_WAIT', 'MMM_BROWSER_OVERFLOW', 'MMM_NVIDIA_EGL_VENDOR', 'PATH_PREPEND'}


def host_env(root):
    path = root / 'host.env'
    if not path.is_file():
        raise ValueError(f'host not set up: {path}')
    env = dict(os.environ)
    for line in path.read_text().splitlines():
        key, sep, value = line.partition('=')
        if sep and key.strip() in HOST_KEYS:
            env[key.strip()] = value.strip()
    prepend = env.pop('PATH_PREPEND', '')
    if prepend:
        env['PATH'] = prepend + os.pathsep + env.get('PATH', '')
    return env


class Released(Exception):
    pass


def released(_sig=None, _frame=None):
    raise Released


def hold(root, identity):
    (root / 'locks').mkdir(parents=True, exist_ok=True)
    with (root / 'locks' / (identity + '.lock')).open('a') as lock:
        begin = time.monotonic()
        next_notice = begin + 60
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                now = time.monotonic()
                if now - begin >= 600:
                    raise ValueError('checkout lock wait exceeded 10 minutes')
                if now >= next_notice:
                    print(f'Waiting for {identity} lock ({int(now-begin)}s)', flush=True)
                    next_notice += 60
                # EOF cancels a waiting lock request too.
                ready = selectors.DefaultSelector()
                ready.register(sys.stdin, selectors.EVENT_READ)
                try:
                    if ready.select(1) and not os.read(sys.stdin.fileno(), 4096):
                        return 2
                finally:
                    ready.close()
        print('LOCKED', flush=True)
        old = {s: signal.signal(s, released) for s in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP)}
        try:
            while os.read(sys.stdin.fileno(), 4096):
                pass
        except (Released, OSError):
            pass
        # Keep the checkout until a run in it has stopped its checks (run_check holds the run lock until then),
        # so another session cannot clean or relink files under checks that are still stopping.
        for sig in old:
            signal.signal(sig, signal.SIG_IGN)
        # No time limit: while a run lives (its own connection may still be open), the checkout stays locked.
        with (root / 'locks' / (identity + '.run')).open('a') as running:
            fcntl.flock(running, fcntl.LOCK_EX)
    return 0


@contextlib.contextmanager
def no_running_checks(root, identity):
    """Changing a checkout needs its run lock too: checks from an earlier session may still be stopping."""
    (root / 'locks').mkdir(parents=True, exist_ok=True)
    with (root / 'locks' / (identity + '.run')).open('a') as running:
        try:
            fcntl.flock(running, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('checks from an earlier session are still running in this checkout') from None
        yield


def checkout(root, identity):
    """The checkout is its own repository, so its refs (origin/main above all) belong to it alone."""
    dest = root / 'checkouts' / identity
    dest.mkdir(parents=True, exist_ok=True)
    git_dir = dest / '.git'
    if git_dir.is_file():  # an older layout: a worktree of one shared repository
        git_dir.unlink()
    if not git_dir.is_dir():
        subprocess.run(['git', 'init', '-q', str(dest)], check=True)
    return dest


def clean_checkout(dest, files):
    """Remove stale leaves without following symlinks or entering host-owned data."""
    keep = set(files)
    parents = {str(p) for name in files for p in Path(name).parents if str(p) != '.'}
    protected = {'.git', 'data', 'web/node_modules', 'web/.vite'}
    def walk(folder):
        for path in folder.iterdir():
            rel = path.relative_to(dest).as_posix()
            if rel in protected:
                continue
            if path.is_symlink() or not path.is_dir():
                if rel not in keep:
                    path.unlink()
            elif rel not in parents and not any(p.startswith(rel+'/') for p in protected):
                shutil.rmtree(path)
            else:
                walk(path)
    walk(dest)


def stage_snapshot(root, kind, fingerprint):
    if kind not in FARMS:
        raise ValueError(f'unknown snapshot kind: {kind}')
    shared = root / 'shared'
    shared.mkdir(parents=True, exist_ok=True)
    target = shared / f'{kind}-{fingerprint}'
    if target.is_dir():
        return {'needed': False}
    partial = target.with_name(target.name+'.partial')
    partial.mkdir(exist_ok=True)
    previous = sorted((p for p in shared.glob(kind+'-*') if p.is_dir()
                       and not p.name.endswith('.partial')), key=lambda p: p.stat().st_mtime_ns)
    return {'needed': True, 'partial': str(partial),
            'link_dest': str(previous[-1]) if previous else None}


def link(path, target):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        path.unlink()
    elif path.exists():
        raise ValueError(f'refusing to replace host-owned folder: {path}')
    path.symlink_to(target)


def publish(root, kind, fingerprint):
    """Complete a staged snapshot; its files become read-only, so no check can change shared bytes."""
    target = root / 'shared' / f'{kind}-{fingerprint}'
    if not target.exists():
        staged = target.with_name(target.name+'.partial')
        for parent, _dirs, files in os.walk(staged):
            for name in files:
                os.chmod(os.path.join(parent, name), 0o444)
        staged.rename(target)
    # Record use order: prune keeps the two most recently used snapshots.
    os.utime(target, None)
    return target


def farm(target, path, fingerprint):
    """A checkout's own writable folders of read-only hard links into one snapshot.

    Checks cannot change the shared bytes or another checkout's folders, and pruning a snapshot never takes
    files away from a check that is still running (the links keep them)."""
    marker = path.with_name('.'+path.name+'.snapshot')
    if path.is_dir() and not path.is_symlink() and marker.is_file() and marker.read_text() == fingerprint:
        return
    if path.is_symlink():
        path.unlink()
    elif path.exists():
        if not marker.is_file():
            raise ValueError(f'refusing to replace host-owned folder: {path}')
        shutil.rmtree(path)
    marker.unlink(missing_ok=True)
    for parent, _dirs, files in os.walk(target):
        here = path / Path(parent).relative_to(target)
        here.mkdir(parents=True, exist_ok=True)
        for name in files:
            os.link(os.path.join(parent, name), here / name)
    marker.write_text(fingerprint)


def unfarm(path):
    marker = path.with_name('.'+path.name+'.snapshot')
    if path.is_symlink():
        path.unlink()
    elif path.exists() and marker.is_file():
        shutil.rmtree(path)
    marker.unlink(missing_ok=True)


def prune(root, kind):
    snapshots = sorted((p for p in (root/'shared').glob(kind+'-*') if p.is_dir()
                        and not p.name.endswith('.partial')), key=lambda p: p.stat().st_mtime_ns)
    for path in snapshots[:-2]:
        shutil.rmtree(path)


FARMS = {'baked': 'data/baked', 'audio': 'data/audio/out', 'paved': 'data/raw/paved-open'}


def prepare(root, identity, files, baked, audio, paved='no'):
    env = host_env(root)
    dest = checkout(root, identity)
    clean_checkout(dest, files)
    for kind, fp in [('baked', baked), ('audio', audio), ('paved', paved)]:
        path = dest / FARMS[kind]
        if fp == 'no':
            unfarm(path)
            prune(root, kind)
            continue
        farm(publish(root, kind, fp), path, fp)
        prune(root, kind)
    import hashlib
    lock = dest / 'web/package-lock.json'
    fp = hashlib.sha256(lock.read_bytes()).hexdigest()[:16]
    npm = root / 'shared' / ('npm-'+fp)
    if not (npm/'.complete').exists():
        npm.mkdir(parents=True, exist_ok=True)
        for name in ['package.json', 'package-lock.json']:
            shutil.copyfile(dest/'web'/name, npm/name)
        subprocess.run(['npm', 'ci', '--no-audit', '--no-fund'], cwd=npm, env=env, check=True)
        (npm/'.complete').touch()
    link(dest/'web/node_modules', npm/'node_modules')
    subprocess.run(['git', 'update-ref', '--no-deref', 'HEAD', 'refs/mmm/'+identity], cwd=dest, check=True)
    subprocess.run(['git', 'reset', '-q', '--mixed'], cwd=dest, check=True)


def evidence_allowed(root, identity, path):
    """The evidence folder, built from the runner root: every folder on the way is real (not a symlink)."""
    base = root/'checkouts'/identity
    parent = base/'data/work/checks'
    chain = [root/'checkouts', base, base/'data', base/'data/work', parent]
    if not path.name.startswith('checks-') or path.name == 'checks-':
        return None
    if any(p.is_symlink() or not p.is_dir() for p in chain):
        return None
    target = parent/path.name
    if target.is_symlink() or not target.is_dir() or os.path.realpath(path.parent) != os.path.realpath(parent):
        return None
    return target


def remove_evidence(root, identity, path):
    target = evidence_allowed(root, identity, path)
    if target:
        shutil.rmtree(target)


def signal_group(proc, sig):
    try:
        os.killpg(proc.pid, sig)
    except ProcessLookupError:
        pass


def run_check(root, identity, command):
    env = host_env(root)
    (root / 'locks').mkdir(parents=True, exist_ok=True)
    # Held until the checks have stopped; hold() waits for it before it releases the checkout.
    with (root / 'locks' / (identity + '.run')).open('a') as running:
        fcntl.flock(running, fcntl.LOCK_EX)
        return run_locked(root, identity, command, env)


def run_locked(root, identity, command, env):
    proc = subprocess.Popen(command, cwd=root/'checkouts'/identity, env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
    selector = selectors.DefaultSelector()
    selector.register(proc.stdout, selectors.EVENT_READ, 'output')
    selector.register(sys.stdin, selectors.EVENT_READ, 'input')
    disconnected = None
    def stop(_sig=None, _frame=None):
        nonlocal disconnected
        if disconnected is None:
            disconnected = time.monotonic()
            signal_group(proc, signal.SIGTERM)
    old = {s: signal.signal(s, stop) for s in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP)}
    try:
        while selector.get_map():
            for key, _ in selector.select(.1):
                chunk = os.read(key.fileobj.fileno(), 65536)
                if key.data == 'input':
                    if not chunk:
                        selector.unregister(key.fileobj)
                        stop()  # stdin EOF terminates the owned check group
                elif chunk:
                    sys.stdout.buffer.write(chunk)
                    sys.stdout.buffer.flush()
                else:
                    selector.unregister(key.fileobj)
            if disconnected is not None and time.monotonic()-disconnected >= 20:
                break
            if proc.poll() is not None and not any(k.data == 'output' for k in selector.get_map().values()):
                break
    except OSError:
        stop()  # the Mac side went away (broken pipe): the group is stopped below
    finally:
        selector.close()
        if disconnected is not None:
            # TERM went to the group; give it the rest of 20 s, then KILL the group, stragglers included.
            try:
                proc.wait(timeout=max(0, disconnected+20-time.monotonic()))
            except subprocess.TimeoutExpired:
                pass
            signal_group(proc, signal.SIGKILL)
        for sig, handler in old.items():
            signal.signal(sig, handler)
    code = proc.wait()
    return 130 if disconnected is not None else (128-code if code < 0 else code)


def main():
    action, raw_root, identity, *args = sys.argv[1:]
    root = Path(raw_root).expanduser().resolve()
    if not identity or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-' for c in identity):
        raise ValueError('invalid checkout identity')
    if action == 'hold':
        return hold(root, identity)
    if action == 'init':
        host_env(root)
        checkout(root, identity)
    elif action == 'info':
        result = subprocess.run(['node', '--version'], env=host_env(root), capture_output=True, text=True, check=True)
        print(result.stdout.strip())
    elif action == 'stage':
        print(json.dumps(stage_snapshot(root, *args)))
    elif action in {'clean', 'prepare'}:
        files = os.fsdecode(sys.stdin.buffer.read()).rstrip('\0').split('\0')
        files = [f for f in files if f]
        with no_running_checks(root, identity):
            dest = checkout(root, identity)
            if action == 'clean':
                clean_checkout(dest, files)
            else:
                prepare(root, identity, files, *args)
    elif action == 'run':
        return run_check(root, identity, args[1:] if args[:1] == ['--'] else args)
    elif action == 'remove-evidence':
        remove_evidence(root, identity, Path(args[0]))
    else:
        raise ValueError('unknown host action: '+action)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print('remote-check: '+str(error), file=sys.stderr)
        sys.exit(2)
