#!/usr/bin/env python3
"""Tests for the talk station tools that need no audio and no network: python3 tools/radio-talk/test_talk.py"""
import pathlib
import random
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import make_talk as talk     # noqa: E402
import order_talk as order   # noqa: E402


def in_order(spans: list, first: float, last: float) -> bool:
    """The spans join end to end from `first` to `last` and none has a negative length."""
    return (spans[0][0] == first and spans[-1][1] == last and all(a <= b for a, b in spans)
            and all(spans[i][1] == spans[i + 1][0] for i in range(len(spans) - 1)))


def test_snapped() -> None:
    # A change moves into the pause that ends just before it; the late start of the second line is repaired.
    assert talk.snapped([(0.2, 2.0), (2.0, 3.0)], [(1.3, 1.5)], 3.2) == [(0.0, 1.4), (1.4, 3.2)]
    # No pause in reach: the change keeps its time.
    assert talk.snapped([(0.0, 2.0), (2.0, 3.0)], [(0.2, 0.4)], 3.0) == [(0.0, 2.0), (2.0, 3.0)]
    # Review finding, 16 Nov 2026: two changes in one pause. The moved one must not cross the one that stays.
    got = talk.snapped([(0, 1), (1, 1.1), (1.1, 2)], [(0.9, 1.5)], 2)
    assert in_order(got, 0.0, 2) and got[1][1] > got[1][0], got
    # The outer edges: the first line starts with the audio and the last one ends with it.
    got = talk.snapped([(0.4, 1.0), (1.0, 1.8)], [(0.0, 0.3), (0.9, 1.1), (1.9, 2.4)], 2.4)
    assert got[0][0] == 0.0 and got[-1][1] == 2.4, got
    # Any lines and pauses: the spans stay in order.
    rng = random.Random(1208)
    for _ in range(2000):
        cuts = sorted(rng.uniform(0, 30) for _ in range(rng.randint(2, 9)))
        lines = [(cuts[i], cuts[i + 1]) for i in range(len(cuts) - 1)]
        edges = sorted(rng.uniform(0, 31) for _ in range(2 * rng.randint(0, 8)))
        gaps = [(edges[i], edges[i + 1]) for i in range(0, len(edges), 2)]
        total = cuts[-1] + rng.uniform(0, 1)
        got = talk.snapped(lines, gaps, total)
        assert len(got) == len(lines) and in_order(got, 0.0, total), (lines, gaps, got)


def test_say_and_clip() -> None:
    assert talk.say('Colleen in Judique, on the Mabou Mines Road. Tap RESET.') == 'Colleen in Joodick, on the Mawboo Mines Road. Tap reset.'
    assert talk.clip('"Word Is Bond" at 5:07.8 for 4.3') == ('clip', 'Word Is Bond', 307.8, 4.3)
    assert talk.clip('"Red Flag Down"') == ('clip', 'Red Flag Down', None, talk.CLIP_SECONDS)


def test_heard_with_an_h() -> None:
    import check_talk as check
    for word in ('mahbu', 'mahbou', 'mahpu', 'mahgu', 'mahboo'):
        assert check.ROUGH.search(f'duncan in {word}, you are on'), word
    for text in ('mabou has mahogany tables', 'duncan in mabu', 'the mahatma of mabou'):
        assert not check.ROUGH.search(text), text


def test_order() -> None:
    old = [f'talk-call-old{n}' for n in range(10)] + [f'talk-ident-{n}' for n in range(1, 6)] + ['talk-ad-a', 'talk-ad-b', 'talk-tip-a',
           'talk-tip-b', 'talk-promo-flag-up', 'talk-promo-shoulder', 'talk-real-echo', 'talk-interview-land', 'talk-road-report-swap-shop']
    new = [s for s in order.TITLES if s not in order.HELD]
    stems = order.order(old, new)
    assert sorted(stems) == sorted(old + new) and order.faults(stems) == [], order.faults(stems)
    # The check sees a track that is there twice, a held piece, and two of a kind in a row.
    assert any('2 times' in fault for fault in order.faults(stems + [stems[0]]))
    assert any('on hold' in fault for fault in order.faults(stems + [order.HELD[0]]))
    assert any('same kind' in fault for fault in order.faults(['talk-ident-1', 'talk-ident-2', 'talk-call-a', 'talk-tip-a']))
    assert all(stem in order.TITLES for stem in order.HELD)


if __name__ == '__main__':
    for test in (test_snapped, test_say_and_clip, test_heard_with_an_h, test_order):
        test()
        print('PASS', test.__name__)
