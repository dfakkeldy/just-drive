#!/usr/bin/env python3
"""Tests for the talk station tools that need no audio and no network: python3 tools/radio-talk/test_talk.py"""
import json
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
    # A spelling for one voice: the two British voices get "Marboo"; the others keep "Mawboo".
    assert talk.say('The Mabou Mines Road, in Judique.', 'MALCOLM') == 'The Marboo Mines Road, in Joodick.'
    assert talk.say('The Mabou Mines Road.', 'BERNADETTE') == 'The Marboo Mines Road.' and talk.say('In Mabou.', 'EFFIE') == 'In Mawboo.'
    assert all(speaker in talk.VOICES for speaker in talk.SAY_FOR)
    assert talk.clip('"Word Is Bond" at 5:07.8 for 4.3') == ('clip', 'Word Is Bond', 307.8, 4.3)
    assert talk.clip('"Red Flag Down"') == ('clip', 'Red Flag Down', None, talk.CLIP_SECONDS)


def test_drift() -> None:
    changes = [5.0 * n for n in range(1, 11)]
    late = [(c + 0.8, c + 1.2) for c in changes]   # every pause is a second after its change
    assert talk.drift(changes, late, 56.0) == 1.0
    assert talk.drift(changes, [(c - 0.1, c + 0.3) for c in changes], 56.0) == 0.0     # the changes are in their pauses
    assert talk.drift(changes, [(c - 0.4, c - 0.1) for c in changes], 56.0) == 0.0     # a little late: snapped() repairs that
    assert talk.drift(changes, [(c - 0.7, c - 0.3) for c in changes], 56.0) == 0.0     # half a second late: still snapped()'s work
    assert talk.drift(changes, [(c - 1.2, c - 0.8) for c in changes], 56.0) == -1.0    # a second late: past its reach
    assert talk.drift(changes[:5], late[:5], 56.0) == 0.0                              # too few changes to be sure
    assert talk.drift(changes, late[:6], 56.0) == 0.0                                  # only 6 of 10 would be in a pause
    assert talk.drift(changes, [(c + 0.8, c + 0.95) for c in changes], 56.0) == 0.0    # pauses shorter than 0.2 s do not count
    assert talk.drift(changes, [], 56.0) == 0.0
    # Review findings, 17 Nov 2026.
    # 1. A pause before each change (the real one) and a pause a second after it (inside the next line): both shifts
    #    explain the take, so the times stay and snapped() takes the pause before.
    both = sorted([(c - 0.4, c - 0.1) for c in changes] + late)
    assert talk.drift(changes, both, 56.0) == 0.0
    assert [b for _, b in talk.snapped([(c - 5.0, c) for c in changes] + [(50.0, 55.0)], both, 56.0)[:-1]] == [c - 0.25 for c in changes]
    #    Two separate answers (a second early or a second late) are no answer.
    assert talk.drift(changes, sorted(late + [(c - 1.2, c - 0.8) for c in changes]), 56.0) == 0.0
    # 2. A shift never moves a change out of the audio: here the last two would lie after its end, or the first before its start.
    ends = [5.0, 10.0, 15.0, 20.0, 25.0, 30.0, 34.8, 35.2]
    assert talk.drift(ends, [(c + 0.8, c + 1.2) for c in ends[:6]], 35.5) == 0.0
    assert talk.drift(ends, [(c + 0.8, c + 1.2) for c in ends[:6]], 37.0) == 1.0
    starts = [0.6, 5.0, 10.0, 15.0, 20.0, 25.0, 30.0, 35.0]
    assert talk.drift(starts, [(c - 1.2, c - 0.8) for c in starts[1:]], 40.0) == 0.0
    # 3. A pause of exactly 0.2 s counts, also where the subtraction gives a little less (1.0 - 0.8).
    assert talk.drift(changes, [(c + 0.8, c + 1.0) for c in changes], 56.0) == 0.9
    # Review finding, 17 Nov 2026, pass 2: the pauses alone cannot tell an early take from a good take whose lines each
    # have a pause a second after their start. So drift() is only an estimate for a take that the speech-to-text
    # check has shown wrong: a new take is never moved when it is made, only by the maker's command.
    import inspect
    assert 'settled' not in inspect.getsource(talk.voice) and 'drift' not in inspect.getsource(talk.voice)
    assert 'settled' not in inspect.getsource(talk.make) and 'drift' not in inspect.getsource(talk.make)
    record = {'lines': [{}] * 11, 'voice_segments': [{'dialogue_input_index': n, 'start_time_seconds': 5.0 * n, 'end_time_seconds': 5.0 * n + 5}
                                                     for n in range(11)], 'alignment': {'character_start_times_seconds': [0.0]}}
    moved = talk.settled(record, 1.0, 55.5)
    assert moved['line_times_moved'] == 1.0 and talk.spans(moved) == [(a + 1.0, min(b + 1.0, 55.5)) for a, b in talk.spans(record)]
    assert moved['alignment'] == record['alignment'] and 'line_times_moved' not in record and talk.spans(record)[0] == (0.0, 5.0)
    assert talk.spans(talk.settled(record, -1.0, 55.5))[:2] == [(0.0, 4.0), (4.0, 9.0)]   # no time before the start
    # The maker's command changes only the record: moved(). The estimate, or the seconds that are named.
    built = {**record, 'final_sha256': 'abc', 'final_seconds': 55.5}
    got = talk.moved(built, None, late, 55.5)
    assert got['line_times_moved'] == 1.0 and talk.spans(got) == talk.spans(moved) and got['alignment'] == record['alignment']
    assert 'final_sha256' not in got and 'final_seconds' not in got and built['final_sha256'] == 'abc'   # it must be built again
    assert talk.moved(built, -0.5, [], 55.5)['line_times_moved'] == -0.5
    # Review findings, 17 Nov 2026, pass 3: every refusal comes before any change, with its reason.
    for wrong, amount, gaps, why in ((got, None, late, 'moved before'), (built, None, [], 'no clear shift'), (built, 0.0, late, 'not 0'),
                                     (built, float('nan'), late, 'a number'), (built, float('inf'), late, 'a number'), (built, 6.0, late, 'outside the audio'),
                                     (built, -5.0, late, 'outside the audio'), ({**built, 'lines': [{}], 'voice_segments': built['voice_segments'][:1]}, float('nan'), late, 'one line')):
        same = json.dumps(wrong)
        try:
            talk.moved(wrong, amount, gaps, 55.5)
        except ValueError as error:
            assert why in str(error) and json.dumps(wrong) == same, (why, error)
        else:
            raise AssertionError(f'not refused: {why}')
    # The command makes no audio and calls no service: it does not build the segment.
    command = inspect.getsource(talk.move_line_times)
    assert 'make(' not in command and 'call(' not in command and 'sfx_file' not in command and 'voice(' not in command
    # The command itself, in a folder of its own, with the two audio readers replaced: a refusal leaves the file as it
    # was, byte for byte; a move replaces it and leaves no other file.
    import tempfile
    was = talk.MAKE, talk.pauses, talk.seconds
    with tempfile.TemporaryDirectory(prefix='mmm-talk-test-') as folder:
        talk.MAKE, talk.pauses, talk.seconds = pathlib.Path(folder), lambda raw: late, lambda raw: 55.5
        try:
            path = talk.MAKE / 'talk-call-test.json'
            path.write_text(json.dumps(built))
            (talk.MAKE / 'talk-call-test.voice.mp3').write_bytes(b'')
            before = path.read_bytes()
            for amount in ('0', 'nan', 'abc', '80', '-5'):
                try:
                    talk.move_line_times('talk-call-test', amount)
                except SystemExit as stop:
                    assert 'nothing is changed' in str(stop) and path.read_bytes() == before, (amount, stop)
                else:
                    raise AssertionError(f'not refused: {amount}')
            try:
                talk.move_line_times('talk-call-none')
            except SystemExit as stop:
                assert 'no record' in str(stop)
            assert talk.move_line_times('talk-call-test') == 0 and json.loads(path.read_text()) == got
            assert sorted(f.name for f in talk.MAKE.iterdir()) == ['talk-call-test.json', 'talk-call-test.voice.mp3']
            again = path.read_bytes()
            try:
                talk.move_line_times('talk-call-test', '0.5')
            except SystemExit as stop:
                assert 'moved before' in str(stop) and path.read_bytes() == again
            else:
                raise AssertionError('moved twice')
        finally:
            talk.MAKE, talk.pauses, talk.seconds = was
    # With the line times moved, snapped() puts every change in its pause, and the lines still end with the audio.
    got = talk.snapped(talk.spans(moved), late, 55.5)
    assert [b for _, b in got[:-1]] == [c + 1.0 for c in changes] and in_order(got, 0.0, 55.5)


def test_heard_with_an_h() -> None:
    import check_talk as check
    for word in ('mahbu', 'mahbou', 'mahpu', 'mahgu', 'mahboo'):
        assert check.ROUGH.search(f'duncan in {word}, you are on'), word
    for text in ('mabou has mahogany tables', 'duncan in mabu', 'the mahatma of mabou'):
        assert not check.ROUGH.search(text), text
    # Mabou that was not written down as Mabou at all (a British voice's "MOR-boo").
    assert check.unheard('Take your time on the Mabou Mines Road.', 'Take your time on the Morbu Mines Road.')
    assert check.unheard('From Mabou to Mabou Harbour.', 'From Mabu to my boo harbour.')
    assert not check.unheard('It is to a Theresa, in Mabou.', "It's to a Teresa in Mabu.")
    assert not check.unheard('From Mabou to Mabou Harbour.', 'From Mabou to Maboo Harbour.') and not check.unheard('In Judique.', 'In Judick.')


def test_order() -> None:
    old = [f'talk-call-old{n}' for n in range(10)] + [f'talk-ident-{n}' for n in range(1, 6)] + ['talk-ad-a', 'talk-ad-b', 'talk-tip-a',
           'talk-tip-b', 'talk-promo-flag-up', 'talk-promo-shoulder', 'talk-real-echo', 'talk-interview-land', 'talk-road-report-swap-shop']
    held = 'talk-call-mother'   # any round 2 piece: the list is empty when nothing waits for the owner
    new = [s for s in order.TITLES if s != held]
    stems = order.order(old, new)
    assert sorted(stems) == sorted(old + new) and order.faults(stems) == [], order.faults(stems)
    # The check sees a track that is there twice, a held piece, and two of a kind in a row.
    assert any('2 times' in fault for fault in order.faults(stems + [stems[0]]))
    was, order.HELD = order.HELD, (held,)
    try:
        assert any('on hold' in fault for fault in order.faults(stems + [held]))
    finally:
        order.HELD = was
    assert not any('on hold' in fault for fault in order.faults(stems + [held]))
    assert any('same kind' in fault for fault in order.faults(['talk-ident-1', 'talk-ident-2', 'talk-call-a', 'talk-tip-a']))
    assert all(stem in order.TITLES for stem in order.HELD)
    # The credit names every request: the take, and each line that was made again alone.
    take = {'model': 'eleven_v4', 'request_id': 'aaa'}
    assert order.made(take) == 'ElevenLabs text-to-dialogue API, model eleven_v4, request aaa'
    assert order.made({**take, 'retakes': [{'date': '2026-11-17', 'request_id': 'bbb'}]}).endswith('request aaa; one line made again on 2026-11-17, request bbb')
    assert order.made({**take, 'retakes': [{'date': '2026-11-17', 'request_id': r} for r in ('bbb', 'ccc')]}).endswith('; 2 lines made again on 2026-11-17, requests bbb, ccc')


if __name__ == '__main__':
    for test in (test_snapped, test_say_and_clip, test_drift, test_heard_with_an_h, test_order):
        test()
        print('PASS', test.__name__)
