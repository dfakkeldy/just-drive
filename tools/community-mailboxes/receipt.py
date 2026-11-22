#!/usr/bin/env python3
"""Receipt check for the 20 Nov community mailbox groups land delta (grok-bots#1347).

    receipt.py land [BAKED]
    receipt.py verify BAKED DELTA
"""
import copy
import hashlib
import json
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from land_receipt_pins import previous_digest

RECEIPT = HERE / 'hashes.json'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def compact(doc):
    return (json.dumps(doc, separators=(',', ':'), allow_nan=False) + '\n').encode()


def undo(props, rule):
    """Rebuild the pre-delta Mabou props from the post-delta props."""
    props = copy.deepcopy(props)
    added = rule['addedCommunityBox']
    removed = rule['removedMailbox']
    boxes = props['communityBoxes']
    if added['index'] >= len(boxes) or boxes[added['index']] != added['record']:
        raise AssertionError('Added community box does not match receipt undo record')
    del boxes[added['index']]
    props['mailboxes'].insert(removed['index'], copy.deepcopy(removed['record']))
    return props


def state(baked, report=None, later=()):
    """'before' or 'after' when both props files and terrain/manifest.json props key agree."""
    baked = Path(baked)
    report = report or json.loads(RECEIPT.read_text())
    seen = set()
    for f in report['files']:
        now = sha((baked / f['file']).read_bytes())
        for delta in reversed(later):
            now = previous_digest(delta, f['file'], now) or now
        seen.add('before' if now == f['before'] else 'after' if now == f['sha256'] else f'unknown bytes {f["file"]}')
    for m in report['manifests']:
        doc = json.loads((baked / m['folder'] / 'manifest.json').read_bytes())
        now = {k: doc.get(k) for k in m['after']}
        seen.add('before' if now == m['before'] else 'after' if now == m['after'] else f'unknown manifest {m["folder"]}/manifest.json')
    if len(seen) != 1 or not seen <= {'before', 'after'}:
        raise AssertionError('community-mailboxes land is mixed or unknown: ' + ', '.join(sorted(seen)))
    return seen.pop()


def verify(baked, delta, report=None):
    """Verify staged delta files and that undo reproduces the live before Mabou props byte for byte."""
    baked, delta = Path(baked), Path(delta)
    report = report or json.loads(RECEIPT.read_text())
    mode = state(baked, report)
    if mode != 'before':
        raise AssertionError(f'Expected before land for verify, found {mode}')
    for f in report['files']:
        got = sha((delta / f['file']).read_bytes())
        if got != f['sha256']:
            raise AssertionError(f'Delta {f["file"]} sha256 mismatch: {got} != {f["sha256"]}')
    for m in report['manifests']:
        doc = json.loads((delta / m['folder'] / 'manifest.json').read_bytes())
        got = {k: doc.get(k) for k in m['after']}
        if got != m['after']:
            raise AssertionError(f'Delta {m["folder"]}/manifest.json props key mismatch')
    rebuilt = compact(undo(json.loads((delta / 'terrain/props.json').read_bytes()), report['undo']))
    before_bytes = (baked / 'terrain/props.json').read_bytes()
    if rebuilt != before_bytes:
        raise AssertionError('Undo did not reproduce live terrain/props.json byte for byte')
    print(f'PASS community-mailboxes delta verified: {len(report["files"])} props files, terrain manifest props key, and exact undo')


def fixture():
    """All-before and all-after pass; every partial install and unknown byte/key fails; undo is exact."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / 'baked'
        (root / 'terrain').mkdir(parents=True)
        (root / 'areas/porthood').mkdir(parents=True)
        box = {'x': 1.0, 'y': 2.0, 'heading': 90.0, 'style': 5, 'tilt': 0.0, 'group': None, 'parcelBox': False}
        site = {'x': 3.0, 'y': 4.0, 'heading': 180.0, 'modules': 4}
        m_before = compact({'mailboxes': [box], 'communityBoxes': [], 'poles': []})
        m_after = compact({'mailboxes': [], 'communityBoxes': [site], 'poles': []})
        p_before = compact({'mailboxes': [], 'communityBoxes': []})
        p_after = compact({'mailboxes': [], 'communityBoxes': [site]})
        man_before = compact({'props': {'file': 'props.json', 'mailboxes': 1, 'poles': 0, 'serviceDrops': 0}, 'other': 1})
        man_after = compact({'props': {'file': 'props.json', 'mailboxes': 0, 'poles': 0, 'serviceDrops': 0}, 'other': 1})
        report = {
            'files': [
                {'file': 'terrain/props.json', 'before': sha(m_before), 'sha256': sha(m_after)},
                {'file': 'areas/porthood/props.json', 'before': sha(p_before), 'sha256': sha(p_after)},
            ],
            'manifests': [{
                'folder': 'terrain',
                'before': {'props': {'file': 'props.json', 'mailboxes': 1, 'poles': 0, 'serviceDrops': 0}},
                'after': {'props': {'file': 'props.json', 'mailboxes': 0, 'poles': 0, 'serviceDrops': 0}},
            }],
            'undo': {
                'removedMailbox': {'index': 0, 'record': box},
                'addedCommunityBox': {'index': 0, 'record': site},
            },
        }

        def lay(m, p, man):
            (root / 'terrain/props.json').write_bytes(m)
            (root / 'areas/porthood/props.json').write_bytes(p)
            (root / 'terrain/manifest.json').write_bytes(man)

        lay(m_before, p_before, man_before)
        assert state(root, report) == 'before'
        lay(m_after, p_after, man_after)
        assert state(root, report) == 'after'
        assert compact(undo(json.loads(m_after), report['undo'])) == m_before

        for label, args in [
            ('Mabou props only', (m_after, p_before, man_before)),
            ('Mabou props + manifest without Port Hood', (m_after, p_before, man_after)),
            ('Port Hood props only', (m_before, p_after, man_before)),
            ('manifest only', (m_before, p_before, man_after)),
            ('unknown props bytes', (b'{}\n', p_after, man_after)),
            ('unknown manifest count', (m_after, p_after, compact({'props': {'file': 'props.json', 'mailboxes': 9, 'poles': 0, 'serviceDrops': 0}}))),
        ]:
            lay(*args)
            try:
                state(root, report)
            except AssertionError:
                pass
            else:
                raise AssertionError(f'Accepted invalid state: {label}')


def land(baked):
    fixture()
    report = json.loads(RECEIPT.read_text())
    wharf = HERE.parent / 'mabou-wharf' / 'roads.json'
    later = [json.loads(wharf.read_text())] if wharf.exists() else []
    mode = state(baked, report, later)
    print(f'PASS community mailboxes land is {mode} ({len(report["files"])} props files and terrain manifest props key); fixture refuses every partial install and unknown bytes')


if __name__ == '__main__':
    if sys.argv[1:2] == ['land'] and len(sys.argv) <= 3:
        land(Path(sys.argv[2]) if len(sys.argv) == 3 else HERE.parents[1] / 'data/baked')
    elif sys.argv[1:2] == ['verify'] and len(sys.argv) == 4:
        verify(sys.argv[2], sys.argv[3])
    else:
        sys.exit(__doc__)
