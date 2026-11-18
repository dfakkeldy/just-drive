#!/usr/bin/env python3
"""Make the public site's radio folder (what build_radio.py writes to data/audio/site) from data/audio/out alone.

A host that holds only data/audio/out (the remote runner sends an own host that folder and no other; the rented Mac mini keeps
only it) builds the public site without a radio, so a check that needs the public radio cannot run there. This
writes the same folder without ffmpeg and without the song sources: the songs are the files build_radio.py links
into data/audio/site, the lists come from the tracked catalogue's "public" marks and the seconds in out/radio.json,
and they are written by build_radio.py's own listing() and folder(). An out folder made from another catalogue (its
catalogueHash differs) is refused. With no public song there is no folder, as with build_radio.py.

For checks only; it never writes data/audio/site. Usage: radio-public-from-out.py <out folder> <new folder>
"""
import hashlib
import importlib.util
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


class InputError(ValueError):
    """A missing, stale or already-made input: the check cannot run (exit 2). Any other error is a bug (exit 1)."""


def build_radio():
    spec = importlib.util.spec_from_file_location('build_radio', ROOT / 'tools/build_radio.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def public_folder(out: pathlib.Path, where: pathlib.Path, catalogue_path=ROOT / 'tools/radio_stations.json') -> bool:
    """Writes the folder; returns False when no song is public (no folder, as build_radio.py leaves it)."""
    radio = build_radio()
    catalogue = catalogue_path.read_bytes()
    catalogue_hash = hashlib.sha256(catalogue).hexdigest()
    try:
        every = json.loads((out / 'radio.json').read_text())
    except (OSError, ValueError) as error:
        raise InputError(f'{out / "radio.json"}: missing or unreadable ({error})') from error
    if every.get('catalogueHash') != catalogue_hash:
        raise InputError(f'{out / "radio.json"}: made from another radio catalogue; run python3 tools/build_radio.py')
    seconds = {t['file']: t['seconds'] for s in every['stations'] for t in s['tracks']}
    plan = radio.parse_catalogue(catalogue)
    wanted = plan['stations']
    public = []
    for station in wanted:
        # build_radio.py leaves out a song with no source; such a song is missing from out/radio.json too.
        tracks = [{'file': t['source'] + '.mp3', 'title': t['title'], 'seconds': seconds[t['source'] + '.mp3']}
                  for t in station['tracks'] if t.get('public') is True and t['source'] + '.mp3' in seconds]
        if tracks:
            public.append({'dial': station['dial'], 'name': station['name'], 'tracks': tracks})
    for name in {t['file'] for s in public for t in s['tracks']}:
        if not (out / name).is_file():
            raise InputError(f'{out / name}: listed in radio.json but missing')
    if where.exists():
        raise InputError(f'{where}: already exists')
    radio.OUT = out
    radio.folder(where, {'radio.json': (public, radio.starting(wanted, 'station')),
                         'radio-just.json': (public, plan.get('just_start'))}, catalogue_hash)
    return where.is_dir()


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    try:
        made = public_folder(pathlib.Path(sys.argv[1]).resolve(), pathlib.Path(sys.argv[2]))
    except InputError as error:
        print(f'radio-public-from-out: {error}', file=sys.stderr)
        sys.exit(2)
    print(f'public radio folder made from {sys.argv[1]}: {sys.argv[2]}' if made else 'no public song: no folder')
