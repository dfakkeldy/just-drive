#!/usr/bin/env python3
"""
Puts the talk station's tracks in order in tools/radio_stations.json.

    python3 tools/radio-talk/order_talk.py            # write the order
    python3 tools/radio-talk/order_talk.py --check    # only test the order that is in the catalogue

A segment is in the station when it is already in the catalogue, or when it has a title below AND its audio and its
record exist (data/audio/src/<stem>.mp3, data/audio/make/talk/<stem>.json). So a segment that is not recorded yet is
left out, and running this again after it is recorded puts it in. Entries already in the catalogue are kept as they are.
A segment in HELD is never added, recorded or not: it waits for the owner's yes. Take its stem out of HELD only then.
A new entry's credit names the take's request and the request of each line that was made again alone (the record's 'retakes').

The rules of the order (the station plays its tracks in this order, round and round):
  1. Two segments of the same kind never follow each other. An invented ad and a real ad count as the same kind here.
  2. Call-ins alternate between round 1 and round 2, as far as their numbers allow.
  3. Each kind is spread evenly over the hour, and promos for the same station are kept apart.
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
CATALOGUE = ROOT / 'tools/radio_stations.json'
MAKE = ROOT / 'data/audio/make/talk'
SRC = ROOT / 'data/audio/src'
DIAL = '94.9'

# Round 2 titles, by source stem. (Round 1 entries are already in the catalogue.)
TITLES = {
    'talk-call-mother': 'Mail Madness: An Ordinary Listener',
    'talk-call-parcel-in-hand': 'Mail Madness: The Missing Parcel',
    'talk-call-marks': 'Mail Madness: Marks out of Ten',
    'talk-call-fast-and-slow': 'Mail Madness: Too Fast, Too Slow',
    'talk-call-dog-evidence': 'Mail Madness: The Dog Has Evidence',
    'talk-call-kid': 'Mail Madness: Tessa Wants the Job',
    'talk-call-letters': 'Mail Madness: The Mailbag',
    'talk-call-wave': 'Mail Madness: He Waved Back',
    'talk-call-missed-you': 'Mail Madness: Sorry We Missed You',
    'talk-call-grader': 'Mail Madness: The Grader',
    'talk-call-tour': 'Mail Madness: The Tour',
    'talk-news-on-the-hour': 'News on the Hour',
    'talk-weather-washboard': 'The Washboard Forecast',
    'talk-sports-room-races': 'Sports: Room Races',
    'talk-lost-and-found': 'Lost and Found',
    'talk-quiz-mailbox': 'Quiz: Box or Ditch',
    'talk-road-report-swap-shop-2': 'Road Report and Swap Shop, Again',
    'talk-interview-traffic': 'The Developer: Traffic',
    'talk-interview-races': 'The Developer: Room Races',
    'talk-interview-beyond': 'The Developer: Beyond Mabou',
    **{f'talk-ident-{n}': 'Station ident' for n in range(6, 11)},
    'talk-ad-lawyer-2': 'Ad: Turfwell and Sodd, a New Case',
    'talk-ad-dog-school': 'Ad: Sit, Stay, Suspect',
    'talk-ad-flyers': 'Ad: Inkwater and Sons',
    'talk-ad-signs': 'Ad: Plain Words Signs',
    'talk-ad-puzzles': 'Ad: Shook Puzzles',
    'talk-ad-tea': 'Ad: Culvert Blend',
    'talk-tip-hill-height': 'Tip: Hill Height',
    'talk-tip-small-map': 'Tip: The Small Map',
    'talk-tip-reset': 'Tip: Back on the Road',
    'talk-tip-driver-seat': 'Tip: The Driver’s Seat',
    'talk-tip-picture': 'Tip: A Faster Picture',
    'talk-tip-haul': 'Tip: Haul to Sugar Camp',
    'talk-tip-room-race': 'Tip: Room Race',
    **{f'talk-promo-{name}-{n}': f'On the dial: {dial}' for name, dial in (
        ('flag-up', '88.3'), ('shoulder', '92.5'), ('washboard', '96.1'), ('please-hold', '99.1'),
        ('long-way-round', '103.5'), ('second-delivery', '107.3')) for n in (2, 3)},
    'talk-real-ns-marks-the-spot-2': 'Ad: NS Marks The Spot',
    'talk-real-echo-2': 'Ad: Echo',
    'talk-real-donate-c': 'A Coffee for the Developer',
}
# On hold: pieces that wait for the owner's yes. This script never adds a held piece. Remove a stem here only when he
# has said yes. The three pieces with Bernadette, who is clearly the carrier's mother, were here from 16 Nov 2026; the
# owner said "Yes to the mother" on 17 Nov 2026.
HELD = ()
SHOW = {'road', 'news', 'weather', 'sports', 'lost', 'quiz'}   # the small formats of the show
LONG = ('call', 'show', 'interview')


def kind(stem: str) -> str:
    word = stem.split('-')[1]
    return 'show' if word in SHOW else word


def clash(a: str, b: str) -> bool:
    """Rule 1: the same kind, or two ads."""
    ka, kb = kind(a), kind(b)
    return ka == kb or {ka, kb} == {'ad', 'real'}


def spread(*lists: list) -> list:
    """One list from several, each spread evenly over the whole (item i of n sits at (i + 0.5) / n)."""
    placed = [((i + .5) / len(items), n, i, item) for n, items in enumerate(lists) for i, item in enumerate(items)]
    return [item for *_, item in sorted(placed)]


def station_of(stem: str) -> str:
    return stem.removeprefix('talk-promo-').rstrip('-23')


def order(old: list, new: list) -> list:
    """`old` is the catalogue's order of the entries it has; `new` are the stems to add, in the order of TITLES."""
    by = lambda stems, k: [s for s in stems if kind(s) == k]
    calls = spread(by(new, 'call'), by(old, 'call'))
    others = spread(spread(by(old, 'show'), by(new, 'show')), spread(by(old, 'interview'), by(new, 'interview')))
    long = spread(calls, others)
    promos = sorted(by(old + new, 'promo'), key=lambda s: (s[-1] if s[-1] in '23' else '1', station_of(s)))
    short = spread(spread(by(old, 'ident'), by(new, 'ident')), spread(by(old, 'ad'), by(new, 'ad')),
                   spread(by(old, 'tip'), by(new, 'tip')), promos, spread(by(old, 'real'), by(new, 'real')))
    # Deal the short pieces into the gaps after the long ones, as evenly as their number allows.
    out, at = [], 0
    for n, piece in enumerate(long):
        upto = round((n + 1) * len(short) / len(long))
        out += [piece, *short[at:upto]]
        at = upto
    # Repair rule 1 by moving one short piece at a time to the nearest place where it clashes with neither neighbour.
    size = len(out)
    for _ in range(size * size):
        bad = next((i for i in range(size) if clash(out[i], out[(i + 1) % size])), None)
        if bad is None:
            break
        i = bad if kind(out[bad]) not in LONG else (bad + 1) % size
        if kind(out[i]) in LONG:
            raise SystemExit(f'two long segments of one kind meet: {out[bad]}, {out[(bad + 1) % size]}')
        piece = out.pop(i)
        for step in range(1, size):
            for j in ((i + step) % (size - 1), (i - step) % (size - 1)):
                if not clash(out[j - 1], piece) and not clash(piece, out[j % (size - 1)]) and j != i:
                    out.insert(j, piece)
                    break
            else:
                continue
            break
        else:
            raise SystemExit(f'no place for {piece}')
    first = next(i for i, s in enumerate(out) if kind(s) == 'ident')   # the list starts with an ident, as before
    return out[first:] + out[:first]


def faults(stems: list) -> list:
    size, out = len(stems), []
    for stem in sorted(set(stems)):
        if stems.count(stem) > 1:
            out.append(f'{stem} is in the station {stems.count(stem)} times')
        if stem in HELD:
            out.append(f'{stem} is on hold (HELD) and is in the station')
    for i, stem in enumerate(stems):
        if clash(stem, stems[(i + 1) % size]):
            out.append(f'same kind in a row: {stem}, {stems[(i + 1) % size]}')
    calls = [s in TITLES for s in stems if kind(s) == 'call']
    spare = abs(calls.count(True) - calls.count(False))
    runs = sum(1 for i, c in enumerate(calls) if c == calls[(i + 1) % len(calls)])
    if runs > spare:
        out.append(f'call-ins do not alternate: {runs} pairs from one round follow each other, {spare} cannot be helped')
    return out


def made(record: dict) -> str:
    """The credit's `source` for a take: its request, and the requests of the lines that were made again alone."""
    source = f'ElevenLabs text-to-dialogue API, model {record["model"]}, request {record["request_id"]}'
    again = record.get('retakes', [])
    if not again:
        return source
    count = 'one line' if len(again) == 1 else f'{len(again)} lines'
    days = ' and '.join(sorted({r['date'] for r in again}))
    return f'{source}; {count} made again on {days}, request{"s" * (len(again) > 1)} {", ".join(r["request_id"] for r in again)}'


def entry(stem: str) -> dict:
    record = json.loads((MAKE / f'{stem}.json').read_text())
    return {'source': stem, 'title': TITLES[stem], 'public': True, 'credit': 'talk', 'credit_overrides': {'source': made(record), 'date': record['date']}}


def unbuilt(stems) -> list:
    """The stems whose record had its line times moved (make_talk.py --move-line-times) and was not built again since."""
    records = [(s, MAKE / f'{s}.json') for s in stems]
    return [s for s, p in records if p.exists() and 'line_times_moved' in (r := json.loads(p.read_text())) and 'final_sha256' not in r]


def main() -> int:
    catalogue = json.loads(CATALOGUE.read_text())
    station = next(s for s in catalogue['stations'] if s['dial'] == DIAL)
    listed = [t['source'] for t in station['tracks']]   # the list as it is: a dict would hide a track that is there twice
    waiting = unbuilt(dict.fromkeys(listed + list(TITLES)))   # every talk track, round 1 too
    if waiting:   # its mp3 was cut at the old line times
        raise SystemExit('line times moved but not built again: ' + ', '.join(waiting) + '; run make_talk.py for each first')
    if '--check' in sys.argv:
        wrong = faults(listed)
        print('\n'.join(wrong) or f'{len(listed)} tracks in order')
        return 1 if wrong else 0
    twice = sorted({s for s in listed if listed.count(s) > 1})
    if twice:
        raise SystemExit('in the station more than once: ' + ', '.join(twice))
    have = {t['source']: t for t in station['tracks']}
    old = [s for s in have if s not in TITLES]
    new = [s for s in TITLES if s not in HELD and (s in have or ((SRC / f'{s}.mp3').exists() and (MAKE / f'{s}.json').exists()))]
    if set(old + new) == set(have) and not faults(listed):
        print(f'{len(listed)} tracks in order; nothing to add, so the order stays as it is'
              + (f'; on hold: {", ".join(HELD)}' if HELD else ''))
        return 0
    stems = order(old, new)
    wrong = faults(stems)
    if wrong:
        raise SystemExit('\n'.join(wrong))
    station['tracks'] = [have.get(s) or entry(s) for s in stems]
    CATALOGUE.write_text(json.dumps(catalogue, indent=2, ensure_ascii=False) + '\n')
    left = [s for s in TITLES if s not in stems and s not in HELD]
    print(f'{len(stems)} tracks in order ({len(new)} from round 2)' + (f'; not recorded yet: {", ".join(left)}' if left else '')
          + (f'; on hold: {", ".join(HELD)}' if HELD else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main())
