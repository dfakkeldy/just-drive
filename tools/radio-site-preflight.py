#!/usr/bin/env python3
"""Reject stale generated public radio lists before a site build changes any output."""
import hashlib
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def check_site(audio, catalogue=ROOT / 'tools/radio_stations.json'):
    expected = hashlib.sha256(catalogue.read_bytes()).hexdigest()
    for name in ('radio.json', 'radio-just.json'):
        path = audio / name
        try:
            data = json.loads(path.read_text())
        except (OSError, ValueError) as error:
            raise ValueError(f'{path}: missing or invalid radio list') from error
        if not isinstance(data, dict) or data.get('catalogueHash') != expected:
            raise ValueError(f'{path}: stale radio catalogue')
    # The Party Line's calls: a list made from the tracked calls catalogue when it has a public call, and none when not.
    calls = catalogue.with_name('radio_calls.json')
    try:
        public = any(c.get('public') is True for key in ('calls', 'nicknames') for c in json.loads(calls.read_text()).get(key, []))
    except (OSError, ValueError, AttributeError):
        public = False
    path = audio / 'calls.json'
    if not public:
        if path.exists():
            raise ValueError(f'{path}: stale calls list (the calls catalogue has no public call)')
        return
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError) as error:
        raise ValueError(f'{path}: missing or invalid calls list') from error
    if not isinstance(data, dict) or data.get('catalogueHash') != hashlib.sha256(calls.read_bytes()).hexdigest():
        raise ValueError(f'{path}: stale calls catalogue')


if __name__ == '__main__':
    try:
        check_site(pathlib.Path(sys.argv[1]))
    except (OSError, ValueError) as error:
        sys.exit(f'{error}. Run python3 tools/build_radio.py after merging and before building the site '
                 '(AUDIO_OUT selects an isolated output folder; pass its site folder as AUDIO_SITE).')
