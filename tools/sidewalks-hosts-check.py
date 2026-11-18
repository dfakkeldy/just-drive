"""Functional rows need a hardware browser; CPU timing runs only on an Apple silicon Mac (MacBook or mmm-m4)."""
import contextlib
import copy
import io
from remote_runner import ROOT, metadata, filter_rows

FUNCTIONAL = ['sidewalks-counts', 'sidewalks-live', 'sidewalks-quality-browser',
              'sidewalks-flat-site', 'sidewalks-installed-browser', 'sidewalks-installed-flat']
TIMING = ['sidewalks-runtime', 'sidewalks-frames']

def check(hosts):
    for name in FUNCTIONAL:
        assert hosts[name]['where'] in ('unproven', 'portable', 'apple'), name + ': functional checks are not MacBook-only'
        assert hosts[name]['software'] == 'no', name + ': hardware browser required'
    for name in TIMING:
        assert hosts[name]['where'] in ('mac-only', 'apple'), name + ': Apple silicon CPU timing only'
        assert hosts[name]['software'] == 'no', name + ': native timing needs the hardware browser'
    with contextlib.redirect_stdout(io.StringIO()):
        rows, refused = filter_rows(FUNCTIONAL, hosts, 'Darwin', False, 'arm64')
        assert rows == FUNCTIONAL and not refused, 'every functional row runs on an Apple silicon Mac'
        rows, refused = filter_rows(TIMING, hosts, 'Darwin', False, 'arm64')
        assert rows == TIMING and not refused, 'native timing runs on an Apple silicon Mac'
        linux = [name for name in FUNCTIONAL if hosts[name]['where'] in ('unproven', 'portable')]
        rows, refused = filter_rows(FUNCTIONAL, hosts, 'Linux', True)
        assert rows == linux and refused == (len(linux) != len(FUNCTIONAL)), 'explicit Linux selection runs only the non-apple rows'
        rows, refused = filter_rows(FUNCTIONAL, hosts, 'Linux', False)
        proven = [name for name in FUNCTIONAL if hosts[name]['where'] == 'portable']
        assert rows == proven and refused == (len(proven) != len(FUNCTIONAL)), 'unproven host still needs the explicit flag'
        rows, refused = filter_rows(TIMING, hosts, 'Linux', True)
        assert not rows and refused, 'an allow-unproven flag cannot move native timing'

hosts = metadata(ROOT, 'checks-hosts.tsv')
check(hosts)
for name, field, value in [('sidewalks-counts', 'where', 'mac-only'),
                           ('sidewalks-frames', 'where', 'unproven'),
                           ('sidewalks-runtime', 'where', 'portable'),
                           ('sidewalks-frames', 'software', 'ok'),
                           ('sidewalks-live', 'software', 'ok')]:
    mutant = copy.deepcopy(hosts)
    mutant[name][field] = value
    try:
        check(mutant)
    except AssertionError:
        print('REJECTED host mutant:', name, field, value)
    else:
        raise AssertionError('host mutant escaped: ' + name)
print('PASS functional rows on hardware browsers, native timing on Apple silicon only, no software GL')
