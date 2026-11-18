#!/usr/bin/env python3
"""Keep per-port advisory locks through compile, bind, checks and child cleanup.

All checkouts share the same locks. Never unlink lock files: another process may
already have the inode open. Kernel locks release on exit, including SIGKILL.
"""
import stat
import fcntl
import os
from pathlib import Path
import signal
import subprocess
import sys
import shlex


def dead_run_recovery(listeners):
    from browser_process import alive, read, resources, members
    base = Path(os.environ.get('MMM_BROWSER_SLOT_DIR', f'/tmp/mmm-browser-slots-{os.getuid()}'))
    leases = {Path(r['lease']) for p in base.glob('slot-*/owner.json') if (r := read(p)) and r.get('lease')}
    leases.update(p.parent for p in Path(os.environ.get('TMPDIR', '/tmp')).glob('mmm-browser-lease-*/ready.json'))
    for lease in leases:
        record = read(lease / 'ready.json') or read(lease / 'owner.json')
        if not record or alive(record.get('owner', record)) is not False: continue
        for resource in resources(lease):
            population = members(resource)
            if population and any(str(member['pid']) in listeners for member in population):
                tools = Path(__file__).resolve().parent
                return ('python3 '+shlex.quote(str(tools/'browser_process.py'))+' stop '+shlex.quote(str(lease))+
                        '; python3 '+shlex.quote(str(tools/'browser-slots.py'))+' reap '+shlex.quote(str(lease)))
    return None


def busy(port, listeners=()):
    recovery = dead_run_recovery(listeners) if listeners else None
    if recovery:
        print(f'port {port} is in use by a proven-dead repository run; recover: {recovery}', file=sys.stderr)
    else:
        print(f'port {port} is in use: another check is running; set WEB_PORT and CDP_PORT', file=sys.stderr)


def check_ports(ports):
    for port in ports:
        try:
            result = subprocess.run(['lsof', '-nP', f'-iTCP:{port}', '-sTCP:LISTEN', '-t'],
                                    capture_output=True, text=True, timeout=3)
        except (OSError, subprocess.TimeoutExpired) as error:
            print(f'cannot verify port {port}: {error}', file=sys.stderr); return False
        if result.stdout.strip() or result.returncode not in (0, 1):
            busy(port, result.stdout.split())
            return False
    return True


def main():
    if sys.argv[1] == '--owned':
        from browser_process import alive, read, members
        resource = read(sys.argv[2]); port = int(sys.argv[3])
        if not resource: return 1
        if sys.platform != 'linux' and alive(resource.get('process')) is not True: return 1
        try:
            command = ['lsof', '-nP', f'-iTCP:{port}', '-sTCP:LISTEN', '-t'] if sys.platform == 'linux' else ['lsof', '-nP', '-a', '-p', str(resource['process']['pid']), f'-iTCP:{port}', '-sTCP:LISTEN', '-t']
            value = subprocess.run(command, capture_output=True, text=True, timeout=2)
        except (OSError, subprocess.TimeoutExpired): return 1
        if sys.platform == 'linux':
            population = members(resource)
            return 0 if population and any(str(p['pid']) in value.stdout.split() and alive(p) is True for p in population) else 1
        return 0 if str(resource['process']['pid']) in value.stdout.split() and alive(resource['process']) is True else 1
    probe_only = sys.argv[1] == '--probe'
    offset = 2 if probe_only else 1
    ports = [int(value) for value in sys.argv[offset:offset+2]]
    if any(port < 1 or port > 65535 for port in ports) or len(set(ports)) != 2:
        print('yard-shots: WEB_PORT and CDP_PORT must be distinct ports (1–65535)', file=sys.stderr); return 2
    if probe_only: return 0 if check_ports(ports) else 2
    folder = Path(os.environ.get('MMM_CHECK_PORT_DIR', f'/tmp/mmm-check-ports-{os.getuid()}'))
    folder.mkdir(mode=0o700, exist_ok=True)
    info = folder.lstat()   # /tmp is shared: never lock in a folder (or a link) another account made first
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid():
        print(f'yard-shots: {folder} is not a folder of this user; remove it or set MMM_CHECK_PORT_DIR', file=sys.stderr); return 2
    locks = []
    for port in sorted(ports):
        lock = (folder / str(port)).open('a'); locks.append(lock)
        try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(f'port {port} is in use: another check is running; set WEB_PORT and CDP_PORT', file=sys.stderr); return 2
    if not check_ports(ports): return 2
    from browser_process import identity, signal_pid
    import json
    environment = dict(os.environ, MMM_CHECK_PORTS_LOCKED='1', MMM_CHECK_SUPERVISOR=json.dumps(identity(os.getpid())))
    saved = None
    def forward(signum, _frame):
        if saved is None: raise SystemExit(128+signum)
        signal_pid(saved, signum)
    # Install caught handlers BEFORE execing Bash. A background launcher may
    # have ignored INT/TERM; caught dispositions reset to default on exec,
    # allowing the owned shell's cleanup traps to receive those signals.
    signal.signal(signal.SIGINT, forward); signal.signal(signal.SIGTERM, forward)
    child = subprocess.Popen(sys.argv[3:], env=environment)
    saved = identity(child.pid)
    result = child.wait()
    return result if result >= 0 else 128-result


if __name__ == '__main__':
    sys.exit(main())
