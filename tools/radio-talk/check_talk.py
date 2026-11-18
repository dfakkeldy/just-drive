#!/usr/bin/env python3
"""
Checks the talk station's takes by machine, because the maker cannot hear them.

    python3 tools/radio-talk/check_talk.py [stem ...]        # no stem: every round 2 segment that is recorded

For each segment it cuts the raw voice into its script lines, has whisper.cpp write down each line, and compares that
with the script. It prints:
  - every line where less than 80% of the words were heard as written (a wrong word, a dropped line, a mumble);
  - every line with a place name, with what was heard, and for the names in SAY the loudness of each syllable
    ("JOO-dik" and "MAH-boo" have the first syllable louder);
  - every line where Mabou was written down with an h ("Mahbu"). On 16 Nov 2026 the owner marked 10 takes as wrong
    ("magh-boo") and 3 as right; the listener had written "Mahbu" for all 10 and "Mabu" for all 3;
  - every line where Mabou was not written down as "Mabu", "Mabou" or "Maboo" at all (a British voice said "Mawboo"
    as "MOR-boo", and the listener wrote "Morbu": the rest of the line was right, so its score did not show it);
  - for a take with three or more such lines, the shift of its line times that make_talk.drift() estimates, if any
    (one take came with every line time a second early; make_talk.py --move-line-times repairs the record), and a
    take whose record was repaired that way but whose segment was not built again;
  - for a segment with song clips, what was heard in each clip, cut again from its song (so a clip's words can be read).
It needs `whisper-cli` and a model (WHISPER_MODEL, default ~/.cache/whisper-cpp/ggml-large-v3-turbo.bin). It is a help
for the person who checks, not a proof: a speech-to-text model can mishear, and it knows how "Mabou" is spelled.
"""
import difflib
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import make_talk as talk          # noqa: E402
from order_talk import TITLES     # noqa: E402

MODEL = os.environ.get('WHISPER_MODEL', str(pathlib.Path.home() / '.cache/whisper-cpp/ggml-large-v3-turbo.bin'))
PLACES = ('Mabou', 'Judique', 'Canso', 'Hawkesbury')
SYLLABLE = {'Mawboo': 3, 'Marboo': 3, 'Mahboo': 3, 'Joodick': 3}   # where the second syllable starts in the spelling that was sent
RATE = 16000


NUMBERS = set('zero oh one two three four five six seven eight nine ten twenty thirty forty fifty sixty seventy eighty ninety hundred point'.split())


# Spellings a listener writes for the same sound. They are not faults.
SAME = {'teresa': 'theresa', 'huey': 'hughie', 'grater': 'grader', 'greater': 'grader', 'gray': 'grey', 'male': 'mail',
        'mahbu': 'mabou', 'mabu': 'mabou', 'mahbou': 'mabou', 'mahboo': 'mabou', 'mawboo': 'mabou', 'maboo': 'mabou', 'judick': 'judique', 'judic': 'judique', 'judik': 'judique',
        'alright': 'right', 'all': '', 'rosebush': 'bush', 'rose': ''}


def words(text: str) -> list:
    """The words to compare. Numbers are left out: the script spells them and the listener writes digits."""
    found = re.findall(r"[a-z']+|\d+", text.lower().replace('’', "'").replace('-', ' '))
    return [same for w in found if w not in NUMBERS and not w.isdigit() and (same := SAME.get(w, w))]


# Mabou written down with an h ("Mahbu", "Mahbou", "Mahpu", "Mahgu"): the voice said "magh-boo". Not "mahogany".
ROUGH = re.compile(r'\bmah[a-z]{0,2}(?:u|ou|oo)\b')
# Mabou as the listener writes it when it is said right.
RIGHT = re.compile(r'\bmab(?:u|ou|oo)\b')


def unheard(want: str, got: str) -> bool:
    """The script line names Mabou more often than the listener wrote it down in a right spelling."""
    return len(re.findall(r'\bMabou\b', want)) > len(RIGHT.findall(got.lower()))


def short(text: str) -> bool:
    return len(words(text)) <= 3


def heard(files: list) -> list:
    subprocess.run(['whisper-cli', '-m', MODEL, '-l', 'en', '-nt', '-np', '-otxt', *map(str, files)], check=True, capture_output=True)
    return [' '.join(pathlib.Path(f'{f}.txt').read_text().split()) for f in files]


def samples(path: pathlib.Path) -> list:
    import array
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-ar', str(RATE), '-ac', '1', '-f', 's16le', '-'], check=True, capture_output=True).stdout
    return array.array('h', raw)


def level(x) -> float:
    import math
    return 10 * math.log10(sum(v * v for v in x) / max(1, len(x)) / 32768 ** 2 + 1e-12)


def stress(record: dict, raw: pathlib.Path) -> list:
    """(name, time, first syllable dB, second syllable dB) for each SAY name in the take, from the character times."""
    align = record.get('alignment')
    if not align:
        return []
    x, chars, start, end = samples(raw), ''.join(align['characters']), align['character_start_times_seconds'], align['character_end_times_seconds']
    out = []
    for name, cut in SYLLABLE.items():
        for found in re.finditer(name, chars):
            a, m, b = start[found.start()], start[found.start() + cut], end[found.end() - 1]
            out.append((name, a, level(x[int(a * RATE):int(m * RATE)]), level(x[int(m * RATE):int(b * RATE)])))
    return sorted(out, key=lambda row: row[1])


def check(stem: str, work: pathlib.Path) -> int:
    raw, record = talk.MAKE / f'{stem}.voice.mp3', json.loads((talk.MAKE / f'{stem}.json').read_text())
    spans, files = talk.snapped(talk.spans(record), talk.pauses(raw), talk.seconds(raw)), []
    for n, (a, b) in enumerate(spans):
        files.append(work / f'{stem}.{n:02d}.wav')
        pad = .4 if short(record['lines'][n]['text']) else .05   # a line of a word or two is too short to write down alone
        talk.ff('-i', str(raw), '-ss', f'{max(0, a - pad):.3f}', '-to', f'{b + pad:.3f}', '-ar', str(RATE), '-ac', '1', str(files[-1]))
    faults = differently = 0
    for line, got in zip(record['lines'], heard(files)):
        want = line['text']
        score = difflib.SequenceMatcher(None, words(want), words(got)).ratio()
        if short(want):   # its neighbours are in the cut too: it is enough that its own words are there
            score = sum(w in words(got) for w in words(want)) / len(words(want)) if words(want) else 1.0
        named = [p for p in PLACES if p in want]
        rough = 'Mabou' in want and ROUGH.search(got.lower())
        other = not rough and unheard(want, got)
        if score < .8 or rough or other:
            faults += 1
        differently += score < .8
        if rough:
            print(f'  MABOU HEARD WITH AN H ("{rough.group()}"): listen to this one, or make it again')
        if other:
            print('  MABOU NOT HEARD AS MABOU: listen to this one, or make it again')
        if score < .8 or named:
            print(f'  {"HEARD DIFFERENTLY" if score < .8 else "place name"} ({score:.2f}) {line["speaker"]}: {want}\n      heard: {got}')
    if differently >= 3 and 'line_times_moved' not in record:   # the pattern of line times that are all early or late
        shift = talk.drift([b for _, b in talk.spans(record)[:-1]], talk.pauses(raw), talk.seconds(raw))
        if shift:
            print(f'  LINE TIMES: {shift:+} s would put the line changes in pauses. If the lines above are heard with the end of the line\n'
                  f'      before (or without their own end), run: make_talk.py --move-line-times {stem}   and then this check again')
    if 'line_times_moved' in record and 'final_sha256' not in record:
        faults += 1
        print(f'  NOT BUILT AGAIN since its line times were moved: run make_talk.py {stem}')
    for name, at, first, second in stress(record, raw):
        mark = 'first syllable louder' if first >= second - 1 else 'SECOND SYLLABLE LOUDER: listen to this one'
        faults += first < second - 1
        print(f'  {name} at {at:.1f} s: {first:.0f} dB then {second:.0f} dB, {mark}')
    cuts = []
    for n, c in enumerate(record.get('clips', [])):
        cuts.append(work / f'{stem}.clip{n}.wav')
        cut = work / f'{stem}.clip{n}.cut.wav'   # two steps, as in make_talk.py: a seek in an .ogg with a filter crashes ffmpeg here
        talk.ff('-i', str(talk.SRC / c['source']), '-map', '0:a:0', '-ss', str(c['at']), '-t', str(c['seconds']), str(cut))
        talk.ff('-i', str(cut), '-ar', str(RATE), '-ac', '1', str(cuts[-1]))
    for c, got in zip(record.get('clips', []), heard(cuts) if cuts else []):
        print(f'  clip "{c["title"]}" at {c["at"]} s for {c["seconds"]} s: {got or "(no words)"}')
    return faults


def main() -> int:
    stems = sys.argv[1:] or [s for s in TITLES if (talk.MAKE / f'{s}.json').exists()]
    total = 0
    with tempfile.TemporaryDirectory(prefix='mmm-talk-check-') as work:
        for stem in stems:
            print(stem)
            total += check(stem, pathlib.Path(work))
    print(f'{len(stems)} segments checked, {total} lines or names to listen to')
    return 0


if __name__ == '__main__':
    sys.exit(main())
