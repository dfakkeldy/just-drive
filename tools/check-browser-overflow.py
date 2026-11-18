#!/usr/bin/env python3
"""The wait cap fails by default and runs without a slot only on MMM_BROWSER_OVERFLOW=run.

Starts no browser and no server: it drives `tools/browser-slots.py hold` directly with a private
slot registry, one holder, SLOTS=1 and WAIT=0.
"""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

sys.dont_write_bytecode = True
TOOLS = Path(__file__).resolve().parent
SLOTS = TOOLS / 'browser-slots.py'
CLEAN = {k: v for k, v in os.environ.items() if not k.startswith('MMM_BROWSER_') and k not in ('MMM_CHECK_SUPERVISOR',)}
procs, folders = [], []


def until(condition, seconds=10):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if condition():
            return
        time.sleep(.05)
    raise AssertionError('timeout')


def keeper(registry, owner, env=None, **options):
    """Start one `hold` keeper for a stand-in owner process; return (process, lease folder, stderr file)."""
    lease = Path(tempfile.mkdtemp(prefix='mmm-browser-lease-')); folders.append(lease)
    log = lease.parent / (lease.name + '.err'); folders.append(log)
    environment = {**CLEAN, 'MMM_BROWSER_SLOT_DIR': str(registry), 'MMM_BROWSER_SLOTS': '1', 'MMM_BROWSER_WAIT': '0', **(env or {})}
    with log.open('w') as err:
        process = subprocess.Popen([sys.executable, str(SLOTS), 'hold', str(owner.pid), 'checkout-fixture', str(lease)],
                                   env=environment, stderr=err, stdout=subprocess.DEVNULL, start_new_session=True, **options)
    procs.append(process)
    return process, lease, log


def owner_process():
    process = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(120)'], start_new_session=True)
    procs.append(process)
    return process


try:
    registry = Path(tempfile.mkdtemp(prefix='mmm-slots-test-')); folders.append(registry)
    holder, holder_lease, _ = keeper(registry, owner_process())
    until(lambda: (holder_lease / 'ready.json').exists())
    assert len(list(registry.glob('slot-*'))) == 1, 'the holder must own the only slot'

    # Default: the wait cap fails, with a clear message, and no lease becomes ready.
    loser, loser_lease, loser_log = keeper(registry, owner_process())
    assert loser.wait(timeout=10) == 2, 'default must exit non-zero (2) at the wait cap'
    text = loser_log.read_text()
    assert 'ERROR wait cap 0s reached' in text and 'not starting a browser' in text and 'MMM_BROWSER_OVERFLOW=run' in text, text
    assert 'running without a slot' not in text, text
    assert not (loser_lease / 'ready.json').exists(), 'a failed start must not become ready'
    assert holder.poll() is None, 'the original holder must survive'
    assert not list(registry.glob('wait-*.json')), 'the failed start must leave no queue ticket'
    print('PASS default: slots=1, one holder, wait=0 fails with exit 2 and a clear message', flush=True)

    # An empty setting means the default; a value that is not known is refused, not guessed.
    empty, _, empty_log = keeper(registry, owner_process(), env={'MMM_BROWSER_OVERFLOW': ''})
    assert empty.wait(timeout=10) == 2 and 'ERROR wait cap' in empty_log.read_text()
    bad, bad_lease, bad_log = keeper(registry, owner_process(), env={'MMM_BROWSER_OVERFLOW': 'yes'})
    assert bad.wait(timeout=10) == 2 and 'not known' in bad_log.read_text() and not (bad_lease / 'ready.json').exists(), bad_log.read_text()
    print('PASS empty setting = default; unknown value is refused with exit 2', flush=True)

    # Opt in: the old behaviour, a warning and a start without a slot.
    runner, runner_lease, runner_log = keeper(registry, owner_process(), env={'MMM_BROWSER_OVERFLOW': 'run'})
    until(lambda: (runner_lease / 'ready.json').exists())
    text = runner_log.read_text()
    assert 'WARNING wait cap 0s reached; running without a slot' in text and 'ERROR' not in text, text
    assert runner.poll() is None and holder.poll() is None
    assert len(list(registry.glob('slot-*'))) == 1, 'the overflow start must not take or free a slot'
    print('PASS MMM_BROWSER_OVERFLOW=run: slots=1, one holder, wait=0 runs without a slot', flush=True)

    # A free slot is still taken normally, whatever the setting.
    for lease in (runner_lease, holder_lease):
        (lease / 'stop').touch()
    assert runner.wait(timeout=10) == 0 and holder.wait(timeout=10) == 0
    until(lambda: not list(registry.glob('slot-*')))
    free, free_lease, free_log = keeper(registry, owner_process())
    until(lambda: (free_lease / 'ready.json').exists())
    assert len(list(registry.glob('slot-*'))) == 1 and 'ERROR' not in free_log.read_text()
    (free_lease / 'stop').touch(); assert free.wait(timeout=10) == 0
    print('PASS a free slot is taken at wait=0 with the default setting', flush=True)
finally:
    for process in procs:
        if process.poll() is None:
            process.kill(); process.wait()
    for item in folders:
        shutil.rmtree(item, ignore_errors=True) if item.is_dir() else item.unlink(missing_ok=True)
