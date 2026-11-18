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


if __name__ == '__main__':
    try:
        check_site(pathlib.Path(sys.argv[1]))
    except (OSError, ValueError) as error:
        sys.exit(f'{error}. Run python3 tools/build_radio.py after merging and before building the site '
                 '(AUDIO_OUT selects an isolated output folder; pass its site folder as AUDIO_SITE).')
