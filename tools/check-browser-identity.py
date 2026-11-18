#!/usr/bin/env python3
"""Kernel identity faults: no browser, slot, port, or ps process."""
import ctypes
import errno
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
sys.dont_write_bytecode=True
import browser_process as bp

if sys.platform == 'darwin':
    original = bp.LIB.proc_pidinfo
    try:
        bp.LIB.proc_pidinfo = lambda *_args: 0  # Kernel gave no usable identity, without setting errno.
        ctypes.set_errno(errno.ESRCH)           # A previous call left a misleading errno.
        assert bp.info(os.getpid()) is None
    finally: bp.LIB.proc_pidinfo = original
    print('PASS failed proc_pidinfo with stale errno is unknown, never dead')
with tempfile.TemporaryDirectory(prefix='mmm-identity-proof-') as directory:
    path=Path(directory)/'child.json'
    code='import subprocess,sys,time,json; p=subprocess.Popen([sys.executable,"-c","import time;time.sleep(60)"],process_group=0);open(sys.argv[1],"w").write(json.dumps(p.pid));time.sleep(60)'
    watcher=subprocess.Popen([sys.executable,'-c',code,str(path)],start_new_session=True)
    saved=bp.identity(watcher.pid); child=None
    try:
        end=time.monotonic()+3
        while not path.exists() and time.monotonic()<end:time.sleep(.02)
        child=bp.identity(json.loads(path.read_text()))
        resource={'watchdog':saved,'process':child,'group':child['pid']}
        original=bp.info
        bp.info=lambda pid:None if pid==watcher.pid else original(pid)
        try:
            assert bp.members(resource) is None
            assert not bp.signal_group(resource,signal.SIGKILL)
        finally:bp.info=original
        assert bp.alive(child) is True
        print('PASS unknown watchdog identity cannot authorize a group signal')
        stale={**saved,'start':[0,0] if isinstance(saved['start'],list) else '-1'}
        assert bp.alive(stale) is False and not bp.signal_pid(stale,signal.SIGKILL)
        assert bp.alive(saved) is True
        print('PASS same PID with different start time is never signalled')
    finally:
        if child:bp.signal_pid(child,signal.SIGTERM)
        bp.signal_pid(saved,signal.SIGTERM);watcher.wait(timeout=3)
