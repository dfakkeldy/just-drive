#!/usr/bin/env python3
"""FIFO machine-wide browser leases. Resource watchdogs survive the shell's group.
Unknown process identity retains a lease; cleanup never depends on ps.
"""
import contextlib
import fcntl
import math
import os
from pathlib import Path
import shutil
import signal
import sys
import time
import stat
import uuid
from browser_process import alive, identity, read, write, stop_lease, stopped, signal_pid

BASE = Path(os.environ.get('MMM_BROWSER_SLOT_DIR', f'/tmp/mmm-browser-slots-{os.getuid()}'))


@contextlib.contextmanager
def registry():
    own_folder(BASE, 'MMM_BROWSER_SLOT_DIR')
    with (BASE / 'registry.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield


def own_folder(path, setting):
    # /tmp is shared: never trust a folder (or a link) that another account made first.
    path.mkdir(mode=0o700, exist_ok=True)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid():
        raise RuntimeError(f'{path} is not a folder of this user; remove it or set {setting}')


def remove_made(path, prefix):
    # A record may only name folders this tool made (mktemp names). Anything else is left alone.
    if not path: return True
    path = Path(path)
    if not path.name.startswith(prefix):
        print(f'browser-slots: not removing unrecognised path {path}', file=sys.stderr); return False
    shutil.rmtree(path, ignore_errors=True); return True


def remove_profile(profile): return remove_made(profile, 'mmm-shots-')
def remove_lease(lease): return remove_made(lease, 'mmm-browser-lease-')


def release_record(lease, ready):
    if not ready or not stopped(lease): return False
    with registry():
        ticket = BASE / ('wait-' + ready['token'] + '.json')
        ticket.unlink(missing_ok=True)
        if ready.get('slot'):
            slot = Path(ready['slot']); current = read(slot / 'owner.json')
            if slot.parent == BASE and slot.name.startswith('slot-') and current and current['token'] == ready['token']: shutil.rmtree(slot)
    return True


def prune():
    # Called under registry lock. Do not free a stale slot until all registered
    # resources have actually stopped. Watchdogs handle normal orphan cleanup.
    for slot in BASE.glob('slot-*'):
        record = read(slot / 'owner.json')
        if not record: shutil.rmtree(slot); continue
        owner_dead = alive(record.get('owner', record)) is False
        if owner_dead or alive(record.get('keeper')) is False:
            lease = Path(record['lease']) if record.get('lease') else None
            if lease and not lease.name.startswith('mmm-browser-lease-'):
                # Not a lease this tool made: free the slot, touch nothing the record names.
                print(f'browser-slots: slot record names an unrecognised lease {lease}; slot freed', file=sys.stderr)
                shutil.rmtree(slot); continue
            if lease and owner_dead and not stopped(lease): stop_lease(lease)
            if lease and stopped(lease):
                remove_profile(record.get('profile'))
                remove_lease(lease)
                shutil.rmtree(slot)
    for ticket in BASE.glob('wait-*.json'):
        record = read(ticket)
        if record and (alive(record.get('owner', record)) is False or alive(record.get('keeper')) is False):
            ticket.unlink(missing_ok=True)


def holders(now):
    rows = []
    for slot in sorted(BASE.glob('slot-*')):
        record = read(slot / 'owner.json')
        if record: rows.append(f"{slot.name} checkout={record['checkout']} pid={record['pid']} held={int(now-record['started'])}s lease={record['lease']}")
    if not rows:
        for path in BASE.glob('wait-*.json'):
            record = read(path)
            if record: rows.append(f"queued checkout={record['checkout']} pid={record['pid']} waited={int(now-record['queued'])}s")
    return '; '.join(rows) or 'queue changing'


def hold(owner_pid, checkout, lease, profile):
    if os.getsid(0) != os.getpid(): os.setsid()
    lease = Path(lease)
    owners = [identity(owner_pid)]
    if os.environ.get('MMM_CHECK_SUPERVISOR'):
        owners.append(__import__('json').loads(os.environ['MMM_CHECK_SUPERVISOR']))
    keeper = identity(os.getpid())
    slots = int(os.environ.get('MMM_BROWSER_SLOTS', '2'))
    wait = float(os.environ.get('MMM_BROWSER_WAIT', '900'))
    if slots < 0 or wait < 0 or not math.isfinite(wait): raise ValueError('slot count and wait must be nonnegative')
    # Reaching the wait cap fails by default; MMM_BROWSER_OVERFLOW=run starts without a slot instead.
    overflow = os.environ.get('MMM_BROWSER_OVERFLOW', 'fail') or 'fail'
    if overflow not in ('fail', 'run'): raise ValueError(f'MMM_BROWSER_OVERFLOW={overflow!r} is not known (use fail or run)')
    token = uuid.uuid4().hex
    ticket = BASE / ('wait-' + token + '.json')
    record = {'owner': owners[0], 'owners': owners, 'pid': owner_pid, 'keeper': keeper, 'checkout': checkout,
              'queued': time.time(), 'token': token, 'lease': str(lease), 'profile': profile, 'slot': None}
    write(lease / 'owner.json', record)
    ending = False
    def end(_sig, _frame):
        nonlocal ending
        ending = True
    signal.signal(signal.SIGTERM, end); signal.signal(signal.SIGINT, end)
    def owner_dead(): return any(alive(owner) is False for owner in owners)
    beginning = time.monotonic(); notice = None
    try:
        if slots:
            with registry(): write(ticket, record)
            while not ending and not owner_dead():
                with registry():
                    prune()
                    queue = sorted((r for p in BASE.glob('wait-*.json') if (r := read(p))), key=lambda r: (r['queued'], r['token']))
                    free = next((BASE / f'slot-{n}' for n in range(1, slots+1) if not (BASE / f'slot-{n}').exists()), None)
                    if free and queue and queue[0]['token'] == token:
                        free.mkdir(); record.update(slot=str(free), started=time.time())
                        write(free / 'owner.json', record); ticket.unlink(missing_ok=True); break
                    elapsed = time.monotonic()-beginning
                    if notice is None or elapsed >= notice:
                        print(f'browser-slots: waiting (limit={slots}, waited={int(elapsed)}s): {holders(time.time())}', file=sys.stderr, flush=True)
                        notice = (int(elapsed//60)+1)*60
                    if elapsed >= wait:
                        ticket.unlink(missing_ok=True)
                        if overflow != 'run':
                            print(f'browser-slots: ERROR wait cap {wait:g}s reached with all {slots} slots held; not starting a browser '
                                  f'(raise MMM_BROWSER_WAIT, or set MMM_BROWSER_OVERFLOW=run to run without a slot): {holders(time.time())}', file=sys.stderr, flush=True)
                            return 2
                        print(f'browser-slots: WARNING wait cap {wait:g}s reached; running without a slot (MMM_BROWSER_OVERFLOW=run): {holders(time.time())}', file=sys.stderr, flush=True)
                        break
                for _ in range(10):
                    if ending or owner_dead(): break
                    time.sleep(.2)
        if ending or owner_dead(): return 130
        write(lease / 'ready.json', record)
        while not ending and not owner_dead() and not (lease / 'stop').exists(): time.sleep(.2)
        while not stop_lease(lease, timeout=3): time.sleep(.5)
        return 0
    finally:
        # A crash cannot release a lease containing a possibly live resource.
        if stopped(lease):
            release_record(lease, record)
            if owner_dead():
                remove_profile(profile)
                remove_lease(lease)


def reap(lease):
    lease = Path(lease); ready = read(lease / 'ready.json')
    if not ready: return 0
    if alive(ready['keeper']) is not False and all(alive(owner) is not False for owner in ready['owners']): return 0
    if any(alive(owner) is False for owner in ready['owners']) and not stopped(lease): stop_lease(lease)
    if not stopped(lease): return 1
    if release_record(lease, ready):
        remove_profile(ready.get('profile'))
        remove_lease(lease)
    return 0


def main():
    mode, *args = sys.argv[1:]
    if mode == 'hold': return hold(int(args[0]), args[1], args[2], args[3] if len(args)>3 else '')
    if mode == 'reap': return reap(args[0])
    if mode == 'release':
        lease = Path(args[0]); ready = read(lease / 'ready.json') or read(lease / 'owner.json')
        if not stop_lease(lease): return 1
        if ready:
            if not release_record(lease, ready): return 1
            signal_pid(ready['keeper'], signal.SIGTERM)
        return 0
    raise ValueError('unknown slot operation')


if __name__ == '__main__':
    try: sys.exit(main())
    except (OSError, ValueError, RuntimeError) as error:
        print('browser-slots: '+str(error), file=sys.stderr); sys.exit(2)
