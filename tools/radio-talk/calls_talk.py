#!/usr/bin/env python3
"""
Puts the recorded Get Fired calls of scripts.md (Part 16) in tools/radio_calls.json.

    python3 tools/radio-talk/calls_talk.py            # add each call and nickname that is recorded
    python3 tools/radio-talk/calls_talk.py --check    # only test the words and the list

A call or nickname is added when its audio and its record exist (data/audio/src/<stem>.mp3, data/audio/make/talk/<stem>.json):
make them first with make_talk.py <stem ...>. Entries already in the list are kept as they are. A new entry is marked
public, and its credit names the take's request (as order_talk.py does for a station track). Then run tools/radio.sh.

What the game needs from the words (party-line-rules.ts), and --check tests:
  - a call's heading says what it is about: talk-react-<about>-<n>, with <about> one of the rules' ABOUTS;
  - a call has Effie and at most one caller; its caller is that person, or Effie;
  - a call that ends on a name (heading "· ends on a name") ends with its caller's line, on "it was" with no stop,
    and its caller has a nickname of every kind, so any run gives that call a name;
  - a nickname is talk-nick-<caller>-<kind>-<n> · <the nickname as the screen shows it>, one line by that caller,
    that starts with the nickname;
  - every speaker already has a voice (make_talk.py VOICES): the calls bring no new voice.
"""
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))
import make_talk as talk   # noqa: E402
from order_talk import made   # noqa: E402
from radio_catalogue import ABOUTS, NICK_KINDS, CALLS_PATH, read_catalogue, validate_calls   # noqa: E402

PART = '## Part 16'
CALL = re.compile(r'### (talk-react-([a-z0-9]+)-[a-z0-9]+)( · ends on a name)?$')
NICK = re.compile(r'### (talk-nick-([a-z]+)-([a-z]+)-\d+) · (.+)$')


def pieces(text: str = None) -> tuple:
    """(calls, nicknames) of Part 16, in script order, as catalogue entries without credit (and their lines)."""
    text = talk.SCRIPTS.read_text() if text is None else text
    part = text.split(PART, 1)[1].split('\n## ', 1)[0] if PART in text else ''
    every = talk.segments()
    calls, nicknames = [], []
    for line in part.splitlines():
        call, nick = CALL.fullmatch(line), NICK.fullmatch(line)
        if call:
            stem, about, name = call.group(1), call.group(2), bool(call.group(3))
            says = [i for i in every.get(stem, []) if i[0] == 'say']
            others = sorted({s for _, s, _ in says if s != 'EFFIE'})
            calls.append({'source': stem, 'about': about, 'caller': (others[0] if len(others) == 1 else 'EFFIE').lower(),
                          'name': name, 'lines': says, 'callers': others})
        elif nick:
            stem, caller, kind, shown = nick.groups()
            nicknames.append({'source': stem, 'kind': kind, 'caller': caller, 'name': shown.strip(),
                              'lines': [i for i in every.get(stem, []) if i[0] == 'say']})
    return calls, nicknames


def faults(calls: list, nicknames: list) -> list:
    out = []
    kinds = {}
    for n in nicknames:
        kinds.setdefault(n['caller'], set()).add(n['kind'])
        lines = n['lines']
        if n['kind'] not in NICK_KINDS:
            out.append(f'{n["source"]}: kind {n["kind"]} is not one of {", ".join(NICK_KINDS)}')
        if len(lines) != 1 or lines[0][1].lower() != n['caller']:
            out.append(f'{n["source"]}: a nickname is one line, by {n["caller"].title()}')
        elif not lines[0][2].lower().startswith(n['name'].lower()):
            out.append(f'{n["source"]}: the line does not start with the nickname "{n["name"]}"')
        if len(n['name']) > 40:
            out.append(f'{n["source"]}: the nickname is longer than 40 characters')
    for c in calls:
        if c['about'] not in ABOUTS:
            out.append(f'{c["source"]}: about {c["about"]} is not one of {", ".join(ABOUTS)}')
        if not c['lines']:
            out.append(f'{c["source"]}: no lines')
            continue
        if len(c['callers']) > 1:
            out.append(f'{c["source"]}: more than one caller ({", ".join(c["callers"])})')
        if c['name']:
            last = c['lines'][-1]
            if last[1].lower() != c['caller'] or not re.search(r'\bit was$', last[2]):
                out.append(f'{c["source"]}: a call that ends on a name ends with its caller saying "it was", with no stop')
            missing = [k for k in NICK_KINDS if k not in kinds.get(c['caller'], set())]
            if missing:
                out.append(f'{c["source"]}: {c["caller"].title()} has no nickname of kind {", ".join(missing)}')
    for piece in calls + nicknames:
        for _, speaker, _ in piece['lines']:
            if speaker not in talk.VOICES:
                out.append(f'{piece["source"]}: {speaker} has no voice (the calls bring no new voice)')
    stems = [p['source'] for p in calls + nicknames]
    out += [f'{s} is in Part 16 twice' for s in sorted({s for s in stems if stems.count(s) > 1})]
    return out


def entry(piece: dict) -> dict:
    record = json.loads((talk.MAKE / f'{piece["source"]}.json').read_text())
    keep = ('source', 'about', 'caller', 'name') if 'about' in piece else ('source', 'kind', 'caller', 'name')
    return {**{k: piece[k] for k in keep}, 'public': True, 'credit_overrides': {'source': made(record), 'date': record['date']}}


def disagree(listed: dict, pieces_: list) -> list:
    """Entries of the list that are not in the words, or that the words now describe otherwise."""
    by = {p['source']: p for p in pieces_}
    out = []
    for e in listed['calls'] + listed['nicknames']:
        p = by.get(e['source'])
        if p is None:
            out.append(f'{e["source"]} is in radio_calls.json but not in scripts.md Part 16')
            continue
        for key in ('about', 'kind', 'caller', 'name'):
            if key in e and e[key] != p.get(key):
                out.append(f'{e["source"]}: radio_calls.json says {key} {e[key]!r}, the words say {p.get(key)!r}')
    return out


def main() -> int:
    calls, nicknames = pieces()
    wrong = faults(calls, nicknames)
    listed = json.loads(CALLS_PATH.read_text())
    wrong += disagree(listed, calls + nicknames)
    if '--check' in sys.argv:
        try:
            validate_calls(json.loads(CALLS_PATH.read_text()), read_catalogue())
        except ValueError as error:
            wrong.append(str(error))
        print('\n'.join(wrong) or f'{len(calls)} calls and {len(nicknames)} nicknames in the words; '
              f'{len(listed["calls"])} calls and {len(listed["nicknames"])} nicknames recorded and listed')
        return 1 if wrong else 0
    if wrong:
        raise SystemExit('\n'.join(wrong))
    recorded = lambda p: (talk.SRC / f'{p["source"]}.mp3').exists() and (talk.MAKE / f'{p["source"]}.json').exists()
    added = 0
    for key, every in (('calls', calls), ('nicknames', nicknames)):
        have = {e['source']: e for e in listed[key]}
        new = [entry(p) for p in every if p['source'] not in have and recorded(p)]
        added += len(new)
        order = [p['source'] for p in every]
        listed[key] = sorted([*have.values(), *new], key=lambda e: order.index(e['source']) if e['source'] in order else len(order))
    validate_calls(json.loads(json.dumps(listed)), read_catalogue())
    if added:
        CALLS_PATH.write_text(json.dumps(listed, indent=2, ensure_ascii=False) + '\n')
    left = [p['source'] for p in calls + nicknames if not recorded(p)]
    print(f'{added} added; {len(listed["calls"])} calls and {len(listed["nicknames"])} nicknames listed'
          + (f'; not recorded yet: {len(left)}' if left else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main())
