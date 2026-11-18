"""Nonblocking process identity and independent check-resource watchdogs.

macOS reads proc_bsdinfo directly from libproc (no ps process or timeout).
Linux stand-in proofs use /proc. Unknown identity is never treated as death.
"""
import ctypes
import errno
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

if sys.version_info < (3, 11):
    print('browser-check: Python 3.11+ required; scripts select python3 from PATH (currently '+sys.executable+')', file=sys.stderr)
    raise SystemExit(2)

if sys.platform == 'darwin':
    class BSDInfo(ctypes.Structure):
        _fields_ = [(name, ctypes.c_uint32) for name in (
            'flags', 'status', 'xstatus', 'pid', 'ppid', 'uid', 'gid', 'ruid',
            'rgid', 'svuid', 'svgid', 'reserved')]
        _fields_ += [('comm', ctypes.c_char * 16), ('name', ctypes.c_char * 32)]
        _fields_ += [(name, ctypes.c_uint32) for name in ('nfiles', 'pgid', 'jobc', 'tdev', 'tpgid')]
        _fields_ += [('nice', ctypes.c_int32), ('sec', ctypes.c_uint64), ('usec', ctypes.c_uint64)]
    LIB = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
    LIB.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64, ctypes.c_void_p, ctypes.c_int]
    LIB.proc_listpids.argtypes = [ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_int]


def info(pid):
    """dict=identity, False=dead, None=unknown; every read is a kernel/local read."""
    try: os.kill(int(pid), 0)
    except ProcessLookupError: return False
    except PermissionError: return None
    if sys.platform == 'darwin':
        value = BSDInfo()
        ctypes.set_errno(0)
        size = LIB.proc_pidinfo(int(pid), 3, 0, ctypes.byref(value), ctypes.sizeof(value))
        if size != ctypes.sizeof(value):
            return False if ctypes.get_errno() in (errno.ESRCH, errno.ENOENT) else None
        return {'pid': int(pid), 'start': [value.sec, value.usec], 'pgid': value.pgid, 'zombie': value.status == 5}
    try:
        fields = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
        return {'pid': int(pid), 'start': fields[19], 'pgid': int(fields[2]), 'zombie': fields[0] == 'Z'}
    except FileNotFoundError: return False
    except (OSError, IndexError): return None


def identity(pid):
    for _ in range(20):
        value = info(pid)
        if isinstance(value, dict): return {'pid': value['pid'], 'start': value['start']}
        if value is False: raise RuntimeError(f'process {pid} exited before identity registration')
        time.sleep(.05)
    raise RuntimeError(f'cannot read process {pid} identity; refusing unverified startup')


def alive(saved):
    if not saved: return None
    value = info(saved['pid'])
    if value is False: return False
    if value is None or 'start' not in saved: return None
    return bool(value and value['start'] == saved['start'] and not value['zombie'])


def signal_pid(saved, sig):
    """Never signal a PID whose start time is missing, unknown, or different."""
    if alive(saved) is not True: return False
    try: os.kill(saved['pid'], sig); return True
    except ProcessLookupError: return False


def read(path):
    try: return json.loads(Path(path).read_text())
    except (OSError, ValueError): return None


def write(path, value):
    path = Path(path)
    temporary = path.with_name(path.name + f'.{os.getpid()}.tmp')
    temporary.write_text(json.dumps(value)); temporary.replace(path)


def pids():
    if sys.platform != 'darwin':
        try: return [int(p.name) for p in Path('/proc').iterdir() if p.name.isdigit()]
        except OSError: return None
    needed = LIB.proc_listpids(1, 0, None, 0)
    if needed <= 0: return None
    for _ in range(3):
        array = (ctypes.c_int * (needed // 4 + 1024))()
        count = LIB.proc_listpids(1, 0, array, ctypes.sizeof(array))
        if 0 < count < ctypes.sizeof(array): return [pid for pid in array[:count // 4] if pid]
        needed = ctypes.sizeof(array) * 2
    return None


def members(resource):
    """Authenticate the saved process group and watchdog session through live members."""
    watchdog = info(resource['watchdog']['pid'])
    if watchdog is None: return None
    if watchdog and watchdog['start'] != resource['watchdog']['start']: return []
    population = pids()
    if population is None: return None
    found, unknown = [], False
    for pid in population:
        value = info(pid)
        if value is None:
            # Restrict uncertainty to our group when the kernel permits that query.
            try: unknown |= (resource.get('group') is None and os.getsid(pid) == resource['watchdog']['pid']) or os.getpgid(pid) == resource.get('group')
            except ProcessLookupError: pass
            except PermissionError: unknown = True
        elif value and (resource.get('group') is None or value['pgid'] == resource['group']) and not value['zombie']:
            try:
                if os.getsid(pid) == resource['watchdog']['pid']: found.append(value)
            except ProcessLookupError: pass
            except PermissionError: unknown = True
    return None if unknown else found


def signal_group(resource, sig):
    population = members(resource)
    if population is None: return False
    for member in population:
        # Recheck PID AND birth immediately before using the saved group number.
        if alive(member) is True:
            try:
                if os.getpgid(member['pid']) == member['pgid'] and os.getsid(member['pid']) == resource['watchdog']['pid']:
                    os.killpg(member['pgid'], sig)
            except ProcessLookupError: pass
    return True


def stop_resource(resource):
    for sig, seconds in [(signal.SIGTERM, 1.5), (signal.SIGKILL, 1.5)]:
        if members(resource) == []: return True
        signal_group(resource, sig)
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            if members(resource) == []: return True
            time.sleep(.1)
    return members(resource) == []


def resources(lease):
    return [value for path in Path(lease).glob('resource-*.json') if (value := read(path))]


def stopped(lease):
    for resource in resources(lease):
        if resource.get('status') != 'done' and alive(resource['watchdog']) is not False: return False
        if members(resource) != []: return False
    return True


def stop_lease(lease, timeout=8):
    lease = Path(lease)
    if not lease.exists(): return True
    (lease / 'stop').touch()
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        for resource in resources(lease):
            # Each independent watchdog normally handles this. Recover a killed watchdog too.
            if alive(resource['watchdog']) is False:
                stop_resource(resource)
        if stopped(lease): return True
        time.sleep(.1)
    print('browser-check: resource identity/exit still unknown; lease retained for recovery', file=sys.stderr)
    return False


def watch(lease, role, command):
    os.setsid()  # The shell's group cannot kill this watchdog.
    lease = Path(lease); ready = read(lease / 'ready.json')
    if not ready: raise RuntimeError('missing browser lease')
    resource = {'owner': ready['owner'], 'keeper': ready['keeper'], 'watchdog': identity(os.getpid()), 'status': 'starting'}
    target = lease / f'resource-{role}.json'
    write(target, resource)
    exiting = False
    def terminate(_sig, _frame):
        nonlocal exiting
        exiting = True
    signal.signal(signal.SIGTERM, terminate); signal.signal(signal.SIGINT, terminate)
    # A separate group within this watchdog's session contains only this resource's descendants.
    child = subprocess.Popen(command, process_group=0)
    resource.update(process=identity(child.pid), group=child.pid, status='running')
    write(target, resource)
    (lease / f'resource-{role}.pid').write_text(str(child.pid))
    try:
        while child.poll() is None and not exiting and not (lease / 'stop').exists():
            if any(alive(owner) is False for owner in ready['owners']) or alive(resource['keeper']) is False: break
            time.sleep(.15)
    finally:
        # Unknown is conservative: retry here; never mark done or release a possibly live resource.
        while not stop_resource(resource): time.sleep(.5)
        child.wait(timeout=1)
        resource.update(status='done', exit=child.returncode); write(target, resource)
        # Keeper may have been killed alone. A surviving watchdog can finish the stale lease.
        if alive(resource['keeper']) is False:
            subprocess.run([sys.executable, str(Path(__file__).with_name('browser-slots.py')), 'reap', str(lease)], timeout=10)
    return child.returncode if child.returncode >= 0 else 128-child.returncode


def main():
    mode, *args = sys.argv[1:]
    if mode == 'watch': return watch(args[0], args[1], args[2:])
    elif mode == 'stop': sys.exit(0 if stop_lease(args[0]) else 1)
    else: raise ValueError('unknown process operation')


if __name__ == '__main__':
    try: sys.exit(main())
    except (OSError, RuntimeError, subprocess.TimeoutExpired) as error:
        print(f'browser-check: {error}', file=sys.stderr); sys.exit(1)
