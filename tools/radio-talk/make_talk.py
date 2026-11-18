#!/usr/bin/env python3
"""
Makes the talk station's source audio from tools/radio-talk/scripts.md with ElevenLabs stock voices.

    ELEVENLABS_KEY_FILE=/path/to/key python3 tools/radio-talk/make_talk.py [stem ...]
    python3 tools/radio-talk/make_talk.py --move-line-times <stem> [seconds]     # changes only the take's record: see move_line_times()

No stem means every segment. A segment whose raw voice file exists is not generated again (delete the raw
file to make a new take). The key is read from the named file and is never written anywhere.

    data/audio/make/talk/<stem>.voice.mp3   the raw voice, as ElevenLabs returned it
    data/audio/make/talk/<stem>.json        the record: date, model, voices, characters, request id, hashes
    data/audio/make/talk/sfx-*.mp3          sound effects (dog, car, mailbox), also from ElevenLabs
    data/audio/src/<stem>.mp3               the finished segment the radio build reads

TALK_MAKE and TALK_FINAL name other folders for the first three and for the last one: build and check new takes
there, and copy them into data/ only when they are right (the radio build of another session reads data/audio/src).

Callers are heard through a telephone filter. The host, the announcer and the studio guest are not.
Every voice is an ElevenLabs premade (stock) voice. No voice here is a clone of a person.
Some place names are sent to the voice in a phonetic spelling (SAY); the script keeps the real spelling.
"""
import base64
import datetime
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
SCRIPTS = pathlib.Path(__file__).with_name('scripts.md')
MAKE = pathlib.Path(os.environ.get('TALK_MAKE') or ROOT / 'data/audio/make/talk')    # raw voices and records
SRC = ROOT / 'data/audio/src'                                                        # the songs that clips come from
FINAL = pathlib.Path(os.environ.get('TALK_FINAL') or SRC)                            # the finished segments
MODEL = 'eleven_v4'
API = 'https://api.elevenlabs.io/v1'

# ElevenLabs premade voices (category "premade" in the voice library), by character.
VOICES = {
    'EFFIE': ('XrExE9yKIg1WjnnlVkGX', 'Matilda'),
    'ANNOUNCER': ('pqHfZKP75CvOlQylNhV4', 'Bill'),
    'DEVELOPER': ('CwhRBWXzGAHq8TQ4Fs17', 'Roger'),
    'CITIZEN': ('bIHbv24MWmeRgasZH58o', 'Will'),
    'THERESA': ('EXAVITQu4vr4xnSDxMaL', 'Sarah'),
    'ANGUS': ('nPczCjzI2devNBz1zQrb', 'Brian'),
    'HUGHIE': ('N2lVS1w4EtoT3dr4eOWO', 'Callum'),
    'COLLEEN': ('cgSgspJ2msm6clMCkdW9', 'Jessica'),
    'SANDY': ('cjVigY5qzO86Huf0OWal', 'Eric'),
    'MORAG': ('hpp4J3VqNfWAUOO0d1Us', 'Bella'),
    'RORY': ('iP95p4xoKVk53GoZ742B', 'Chris'),
    'FLORA': ('FGY2WhTYpPnrIDTdsKH5', 'Laura'),
    # round 2
    'BERNADETTE': ('pFZP5JQG7iQjIQuC4Bku', 'Lily'),
    'DUNCAN': ('JBFqnCBsd6RMkjVDRZzb', 'George'),
    'MALCOLM': ('onwK4e9ZLuTAKqWW03F9', 'Daniel'),
    'ARCHIE': ('pNInz6obpgDQGcFmaJgB', 'Adam'),
    'ISABEL': ('Xb7hH8MSUJpSbSDYk0k2', 'Alice'),
    'TESSA': ('cgSgspJ2msm6clMCkdW9', 'Jessica'),    # the youngest stock voice; Colleen's in round 1
    'GRETA': ('FGY2WhTYpPnrIDTdsKH5', 'Laura'),      # Flora's in round 1
}
# Words the voice can say wrong from their real spelling: the spelling SENT to the voice. The script and the record's
# 'text' keep the real spelling; the record's 'sent' has what the voice was given. Judique is "JOO-dik"; Mabou is "MAH-boo".
# Mabou was "Mahboo" at first: two voices (the host and the announcer) then said the h, "magh-boo" (the owner heard it,
# 16 Nov 2026; speech-to-text wrote the same word for the good and the bad ones). He chose "Mawboo" from four spellings.
# The button names are in capitals on the screen and in the script; a voice may spell capitals out letter by letter.
SAY = {'Judique': 'Joodick', 'Mabou': 'Mawboo', 'RESET': 'reset', 'VIEW': 'view', 'GO': 'go'}
# A spelling is right for a voice, not for every voice. The two British stock voices here say "Mawboo" as "MOR-boo"
# (speech-to-text wrote "Morbu", 17 Nov 2026) and "Mahboo" with the h. From "Marboo" they say "MAH-boo", with no r:
# speech-to-text writes "Mabu", and the vowel measures as "ah" (formants near 740 and 1170 Hz for both voices).
SAY_FOR = {'BERNADETTE': {'Mabou': 'Marboo'}, 'MALCOLM': {'Mabou': 'Marboo'}}
STUDIO = {'EFFIE', 'ANNOUNCER', 'DEVELOPER'}          # everyone else is on the telephone
PHONE = 'highpass=f=380,lowpass=f=3100'
# Song clips for the station promos: title in the script -> (source stem in data/audio/src, start second).
CLIPS = {
    'Red Flag Down': ('red-flag-down', 40), 'Put It in Writing': ('put-it-in-writing-2', 40),
    'Red Flag Down (reggae)': ('red-flag-down-reggae', 40), 'Bach: Prelude No. 1 in C': ('bach-wtc1-prelude-01', 0),
    'Where Two Rivers Meet': ('where-two-rivers-meet', 40), 'Saturday at the Hall (dance mix)': ('saturday-at-the-hall-dance', 40),
}
CLIP_SECONDS = 7
# A clip with a time in the script, [CLIP: "Title" at 1:05] or [CLIP: "Title" at 1:05 for 5.5], starts there. Its song is
# found by its title in the catalogue, so only the round 1 promos (no time in the script) need the table above.
CATALOGUE = ROOT / 'tools/radio_stations.json'
# Song clips mixed into one ad (not between two lines, as in the promos). All times are seconds. They fit one
# take of the voice, so 'voice_sha256' names that take: a new take needs new times.
#   lead    the song plays alone this long, then the voice starts and the song goes down under it
#   intro   (song time, length): from the start of the ad, under the first line, then it fades out
#   stop    (voice time, song time, length): the voice stops in a pause and the song plays alone
#   tail    (song time, length): starts as the voice ends
MUSIC = {
    'talk-real-word-is-bond': {
        'source': 'word-is-bond', 'voice_sha256': 'e8fa28d7043a195b16d29ea02cff17217d038086dcba21378cefe0afc843aca5',
        'lead': 2.4, 'intro': (18.3, 8.2), 'stop': (14.19, 26.5, 2.8), 'tail': (95.55, 6.9),
    },
}
MUSIC_UNDER = -15   # dB: the song under the voice, against the song alone
MIN_SECONDS = 6.0   # see make(): web/src/radio.ts reads only tracks longer than 5 s
# Sound effects, by the words in the script's [SFX: ...] note. (prompt, seconds)
DOG = 'A medium-sized farm dog, recorded close and dry, no room echo, no other sound: '
SFX = {
    'one low, careful "woof"': (DOG + 'one single low, careful woof.', 1.5),
    'two barks, a pause, a low growl': (DOG + 'two barks, a short pause, then a low growl.', 3.0),
    'short bark': (DOG + 'one short bark.', 1.0),
    'three quick barks, a whine': (DOG + 'three quick barks, then a whine.', 3.0),
    'long suspicious growl': (DOG + 'one long, low, suspicious growl.', 3.0),
    'bark, bark, sniff': (DOG + 'two barks, then loud sniffing.', 3.0),
    'urgent barking': (DOG + 'fast urgent barking.', 3.0),
    'one sharp bark': (DOG + 'one sharp bark.', 1.0),
    'low whine': (DOG + 'one low, sad whine.', 2.0),
    'a long pause, one doubtful "woof"': (DOG + 'one quiet, doubtful woof.', 1.5),
    'under the whole call, a car engine and a turn signal ticking': (
        'Inside a small car driving slowly on a country road: steady engine hum and a turn signal ticking. No voices, no music.', 12.0),
    'a hollow thump, then a metal clatter': ('A car bumper knocks over a metal rural mailbox: one hollow thump, then a metal clatter on gravel.', 2.5),
}


def key() -> str:
    return pathlib.Path(os.environ['ELEVENLABS_KEY_FILE']).read_text().strip()


def call(path: str, body: dict):
    request = urllib.request.Request(API + path, json.dumps(body).encode(), {'xi-api-key': key(), 'content-type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=600) as answer:
            return answer.read(), answer.headers.get('request-id') or answer.headers.get('x-request-id')
    except urllib.error.HTTPError as error:
        raise SystemExit(f'ElevenLabs {path}: {error.code} {error.read()[:400].decode("utf8", "replace")}')


def ff(*args: str) -> None:
    subprocess.run(['ffmpeg', '-v', 'error', '-y', *args], check=True)


def seconds(path: pathlib.Path) -> float:
    return float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)],
                                check=True, capture_output=True, text=True).stdout)


def sha(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def segments() -> dict:
    """stem -> list of ('say', speaker, text) | ('sfx', note) | ('clip', title), in script order."""
    out, stem = {}, None
    for line in SCRIPTS.read_text().splitlines():
        head = re.match(r'### (talk-[\w-]+)', line)
        if head:
            stem = head.group(1)
            out[stem] = []
            continue
        if line.startswith('## '):
            stem = None
        if stem is None or not line.startswith('**'):
            continue
        sfx = re.fullmatch(r'\*\*\[SFX: (.+)\]\*\*', line)
        if sfx:
            out[stem].append(('sfx', sfx.group(1)))
            continue
        speaker, text = re.fullmatch(r'\*\*([A-Z]+):\*\* (.+)', line).groups()
        for i, part in enumerate(re.split(r'\s*\*\*\[CLIP: (".+?"(?: at [\d:.]+)?(?: for [\d.]+)?)\]\*\*\s*', text)):
            if part:
                out[stem].append(clip(part) if i % 2 else ('say', speaker, part))
    return out


def clip(note: str) -> tuple:
    """('clip', title, start second or None, seconds) from the words inside [CLIP: ...]."""
    title, at, length = re.fullmatch(r'"(.+?)"(?: at ([\d:.]+))?(?: for ([\d.]+))?', note).groups()
    if at is None:
        return ('clip', title, None, CLIP_SECONDS)
    minutes, _, secs = at.rpartition(':')
    return ('clip', title, int(minutes or 0) * 60 + float(secs), float(length or CLIP_SECONDS))


def song(title: str) -> str:
    """The source stem of the song with this title in the catalogue (a talk segment is not a song)."""
    found = {t['source'] for s in json.loads(CATALOGUE.read_text())['stations'] for t in s['tracks']
             if t['title'] == title and not t['source'].startswith('talk-')}
    if len(found) != 1:
        raise SystemExit(f'clip "{title}": {len(found)} songs have this title in the catalogue')
    return found.pop()


def say(text: str, speaker: str = '') -> str:
    """The text as it is sent to this speaker's voice: place names in their phonetic spelling (SAY, then SAY_FOR)."""
    table = {**SAY, **SAY_FOR.get(speaker, {})}
    return re.sub('|'.join(rf'\b{re.escape(name)}\b' for name in table), lambda m: table[m.group()], text)


def sfx_file(note: str) -> pathlib.Path:
    path = MAKE / ('sfx-' + re.sub(r'[^a-z]+', '-', note.lower()).strip('-')[:40] + '.mp3')
    if not path.exists():
        prompt, length = SFX[note]
        audio, _ = call('/sound-generation?output_format=mp3_44100_192', {'text': prompt, 'duration_seconds': length, 'prompt_influence': 0.5})
        path.write_bytes(audio)
        print(f'  sound effect: {path.name}')
    return path


def voice(stem: str, says: list) -> tuple:
    """The raw voice of one segment and its record. One dialogue request, so the speakers answer each other."""
    raw, record = MAKE / f'{stem}.voice.mp3', MAKE / f'{stem}.json'
    if not (raw.exists() and record.exists()):
        inputs = [{'text': say(text, speaker), 'voice_id': VOICES[speaker][0]} for _, speaker, text in says]
        body, request_id = call('/text-to-dialogue/with-timestamps?output_format=mp3_44100_192', {'model_id': MODEL, 'inputs': inputs})
        got = json.loads(body)
        raw.write_bytes(base64.b64decode(got['audio_base64']))
        record.write_text(json.dumps({
            'stem': stem, 'date': datetime.date.today().isoformat(), 'tool': 'ElevenLabs text-to-dialogue', 'model': MODEL,
            'request_id': request_id, 'characters': sum(len(i['text']) for i in inputs),
            'voices': sorted({f'{VOICES[s][1]} ({VOICES[s][0]}, premade) as {s.title()}' for _, s, _ in says}),
            'lines': [{'speaker': s, 'text': t, **({'sent': say(t, s)} if say(t, s) != t else {})} for _, s, t in says],
            'voice_segments': got['voice_segments'], 'alignment': got.get('alignment'), 'voice_sha256': sha(raw)}, indent=1) + '\n')
        print(f'  voice: {raw.name}, {seconds(raw):.1f} s')
    return raw, json.loads(record.read_text())


def spans(record: dict) -> list:
    """(start, end) of each script line in the raw voice, by line number."""
    out = {}
    for s in record['voice_segments']:
        a, b = out.get(s['dialogue_input_index'], (s['start_time_seconds'], s['end_time_seconds']))
        out[s['dialogue_input_index']] = (min(a, s['start_time_seconds']), max(b, s['end_time_seconds']))
    return [out[i] for i in range(len(record['lines']))]


REACH = 0.7   # seconds: how far back snapped() looks for the pause before a line


def drift(changes: list, gaps: list, total: float) -> float:
    """
    An estimate, for a take that check_talk.py has shown wrong: the seconds to add to its line times when they are
    all early (or late) by about one amount, else 0.0. `changes` are the times where one line ends and the next
    starts; `gaps` are the pauses in the audio; `total` is its length.
    ElevenLabs gave one take line times about a second early (talk-call-mother, 17 Nov 2026): 2 of its 16 changes were
    in a pause, and 13 were with one second added. snapped() cannot repair that: it reaches REACH seconds back and a
    third of that forward.
    NOTHING CALLS THIS FOR A TAKE THAT IS RIGHT, and nothing may: the pauses alone cannot tell an early take from a
    good take whose lines each have a pause about a second after their start (snapped() places each change by its own
    pause; this looks for one shift for all). Only the words can tell (check_talk.py). See moved() and move_line_times().
    The shifts are tried in 0.05 s steps to 1.5 s each way; a change counts when it lies in a pause of 0.2 s or more.
    The answer is 0.0 unless all of this is true:
      - the take has 6 changes or more;
      - the best shift is outside what snapped() reaches, and it puts three quarters of the changes or more in a pause;
      - it puts at least twice as many changes in a pause as the best shift inside snapped()'s reach does;
      - the shifts that are equally good are next to each other (two separate answers are no answer);
      - with it, every change stays inside the audio.
    """
    wide = [g for g in gaps if g[1] - g[0] >= 0.2 - 1e-9]   # 1.0 - 0.8 is a little less than 0.2
    if len(changes) < 6:
        return 0.0
    count = {n: sum(any(a <= c + n / 20 <= b for a, b in wide) for c in changes) for n in range(-30, 31)}
    reach = [n for n in count if -REACH * 20 <= n <= REACH * 20 / 3]
    near = max(count[n] for n in reach)
    most = max(count[n] for n in count if n not in reach)
    best = [n for n in count if n not in reach and count[n] == most]
    if most * 4 < len(changes) * 3 or most < 2 * near or best[-1] - best[0] != len(best) - 1:
        return 0.0
    d = best[len(best) // 2] / 20   # the middle of the shifts that are equally good
    return d if all(0.0 < c + d < total for c in changes) else 0.0


def settled(record: dict, add: float, total: float) -> dict:
    """The record with its line times moved by `add` seconds, and the amount noted as 'line_times_moved'. No time
    leaves the audio (0 to `total`). The character times stay as ElevenLabs gave them."""
    at = lambda t: min(max(t + add, 0.0), total)
    moved = [{**s, 'start_time_seconds': at(s['start_time_seconds']), 'end_time_seconds': at(s['end_time_seconds'])}
             for s in record['voice_segments']]
    return {**record, 'voice_segments': moved, 'line_times_moved': add}


def moved(record: dict, amount, gaps: list, total: float) -> dict:
    """
    The record of a take with its line times moved (see drift): by `amount` seconds, or by drift()'s estimate when
    `amount` is None. 'line_times_moved' notes the amount. The new record names no finished file ('final_sha256' and
    'final_seconds' are gone): the segment must be built again. Raises ValueError, with the reason, for a record
    that was moved before or has one line, an amount that is 0 or not a number, an amount that puts a line change
    outside the audio, and a take for which drift() has no clear answer. The record that was given is not changed.
    """
    import math
    if 'line_times_moved' in record:
        raise ValueError(f'the line times were moved before, by {record["line_times_moved"]} s')
    changes = [b for _, b in spans(record)[:-1]]
    if not changes:
        raise ValueError('a take of one line has no change of line to move')
    add = drift(changes, gaps, total) if amount is None else amount
    if amount is None and not add:
        raise ValueError('no clear shift for the line times (name the seconds to try one)')
    if not math.isfinite(add) or not add:
        raise ValueError('the seconds must be a number, and not 0')
    if not all(0.0 < c + add < total for c in changes):
        raise ValueError(f'{add:+} s puts a line change outside the audio')
    return {k: v for k, v in settled(record, add, total).items() if k not in ('final_sha256', 'final_seconds')}


def move_line_times(stem: str, amount: str = '') -> int:
    """
    The maker's command for a take whose line times are all early or late (see drift). It changes one file, the
    take's record: see moved(). It makes no audio and calls no service. Use it only when check_talk.py shows the
    fault (most lines are heard with the end of the line before, or without their own end). Then build the segment
    again (make_talk.py <stem>) and run check_talk.py again: the move is right only if every line is then heard as
    written. A refusal changes nothing.
    """
    path, raw = MAKE / f'{stem}.json', MAKE / f'{stem}.voice.mp3'
    if not (path.exists() and raw.exists()):
        raise SystemExit(f'{stem}: no record and raw voice in {MAKE}; nothing is changed')
    try:
        new = moved(json.loads(path.read_text()), float(amount) if amount else None, pauses(raw), seconds(raw))
    except ValueError as error:
        raise SystemExit(f'{stem}: {error}; nothing is changed')
    whole = path.with_name(path.name + '.new')   # the record is replaced in one step
    whole.write_text(json.dumps(new, indent=1) + '\n')
    whole.replace(path)
    print(f'{stem}: line times moved by {new["line_times_moved"]:+} s in its record. Now build the segment again:\n'
          f'    make_talk.py {stem}\nand then run check_talk.py {stem}')
    return 0


def quiet_spans(x, rate: int = 16000, floor: float = -38.0, least: float = 0.06) -> list:
    """(start, end) of each pause in the samples `x`: 20 ms steps quieter than `floor` dB, for `least` seconds or more.
    A pause that is still open where the steps end is left out."""
    import math
    step, out, start = rate // 50, [], None
    for i in range(0, len(x) - step, step):
        quiet = 10 * math.log10(sum(v * v for v in x[i:i + step]) / step / 32768 ** 2 + 1e-12) < floor
        if quiet and start is None:
            start = i / rate
        if not quiet and start is not None:
            if i / rate - start >= least:
                out.append((start, i / rate))
            start = None
    return out


def pauses(path: pathlib.Path, floor: float = -38.0, least: float = 0.06) -> list:
    """The pauses in an audio file (see quiet_spans)."""
    import array
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-ar', '16000', '-ac', '1', '-f', 's16le', '-'], check=True, capture_output=True).stdout
    return quiet_spans(array.array('h', raw), 16000, floor, least)


def snapped(lines: list, gaps: list, total: float) -> list:
    """
    The line spans with each change of line moved into the pause between the two lines. ElevenLabs gives a time for
    every character, but the start of a line can be up to half a second late, so a caller's first word was heard
    without the telephone. A line starts after a pause: each change moves to the pause that ends nearest before it
    (a pause that starts after it counts three times as far), no further than REACH, and the changes keep their order.
    A change never crosses its neighbours: one that would stays at its own time. The first line starts with the
    audio and the last line ends with it (`total`), so a word before a late first time or after an early last time
    is still inside its line.
    """
    changes = [lines[i][1] for i in range(len(lines) - 1)]
    def far(t, gap):
        return 0.0 if gap[0] <= t <= gap[1] else t - gap[1] if gap[1] < t else 3 * (gap[0] - t)
    # best[j]: the least total distance with the changes so far placed in pauses before pause j; None keeps the time.
    best = [(0.0, [])] * (len(gaps) + 1)
    for t in changes:
        new = [(best[0][0] + REACH, best[0][1] + [None])]
        for j, gap in enumerate(gaps):
            keep = (best[j + 1][0] + REACH, best[j + 1][1] + [None])
            take = (best[j][0] + far(t, gap), best[j][1] + [gap]) if far(t, gap) <= REACH else keep
            new.append(min(new[j], keep, take, key=lambda option: option[0]))
        best = new
    start, end = 0.0, max(total, lines[-1][1])
    times = [(gap[0] + gap[1]) / 2 if gap else t for t, gap in zip(changes, best[-1][1])]
    for i, own in enumerate(changes):
        low, high = times[i - 1] if i else start, times[i + 1] if i + 1 < len(times) else end
        if not low <= times[i] <= high:
            times[i] = own
        times[i] = min(max(times[i], low), end)   # a kept time can still lie before a moved neighbour: never go back
    edges = [start, *times, end]
    return [(edges[i], edges[i + 1]) for i in range(len(lines))]


def lufs(path: pathlib.Path) -> float:
    out = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', str(path), '-af', 'ebur128', '-f', 'null', '-'],
                         check=True, capture_output=True, text=True).stderr
    return float(re.findall(r'I:\s+(-?[\d.]+) LUFS', out)[-1])


def with_music(stem: str, voiced: pathlib.Path, record: dict, work: pathlib.Path) -> pathlib.Path:
    """The voice of one ad with clips of a song from the game: an intro under the first line, a stop, a tail."""
    plan = MUSIC[stem]
    if record['voice_sha256'] != plan['voice_sha256']:
        raise SystemExit(f'{stem}: the voice is a new take; set new times in MUSIC')
    song = sorted(SRC.glob(plan['source'] + '.*'))[0]
    lead, (intro_at, intro_len), (stop, stop_at, stop_len), (tail_at, tail_len) = plan['lead'], plan['intro'], plan['stop'], plan['tail']
    level = lufs(voiced) - 1.0
    under = 10 ** (MUSIC_UNDER / 20)
    second = lead + stop + stop_len                      # where the voice starts again
    end = second + seconds(voiced) - stop
    shape = {   # each clip: where it sits in the ad, and how its level moves
        'intro': (intro_at, intro_len, 0.0, f"volume='if(lt(t,{lead - 0.2}),1,if(lt(t,{lead + 0.2}),1-(1-{under:.4f})*(t-{lead - 0.2})/0.4,{under:.4f}))':eval=frame,"
                                            f'afade=t=in:d=0.3,afade=t=out:st={intro_len - 0.9}:d=0.9'),
        'stop': (stop_at, stop_len, lead + stop, f'afade=t=in:d=0.15,afade=t=out:st={stop_len - 0.35}:d=0.35'),
        'tail': (tail_at, tail_len, end - 0.25, f'afade=t=in:d=0.25,afade=t=out:st={tail_len - 0.6}:d=0.6'),
    }
    inputs, graph = ['-i', str(voiced)], (f'[0:a]atrim=0:{stop},asetpts=PTS-STARTPTS,adelay={round(lead * 1000)}[v1];'
                                          f'[0:a]atrim=start={stop},asetpts=PTS-STARTPTS,adelay={round(second * 1000)}[v2];')
    for n, (name, (at, length, where, moves)) in enumerate(shape.items(), 1):
        cut = work / f'{stem}.{name}.wav'
        ff('-i', str(song), '-map', '0:a:0', '-ss', str(at), '-t', str(length), '-ar', '44100', '-ac', '1', str(cut))
        inputs += ['-i', str(cut)]
        graph += f'[{n}:a]volume={level - lufs(cut):.2f}dB,{moves},adelay={round(where * 1000)}[m{n}];'
    mixed = work / f'{stem}.music.wav'
    ff(*inputs, '-filter_complex', graph + '[v1][v2][m1][m2][m3]amix=inputs=5:duration=longest:normalize=0,alimiter=limit=0.89', str(mixed))
    record['music'] = {'song': song.name, 'song_sha256': sha(song), **{k: plan[k] for k in ('lead', 'intro', 'stop', 'tail')}}
    return mixed


def make(stem: str, items: list, work: pathlib.Path) -> None:
    says = [i for i in items if i[0] == 'say']
    raw, record = voice(stem, says)
    total = seconds(raw)
    line = snapped(spans(record), pauses(raw), total)
    phoned = [line[i] for i, (_, speaker, _) in enumerate(says) if speaker not in STUDIO]
    voiced = work / f'{stem}.voiced.wav'
    filters = 'aresample=44100,aformat=channel_layouts=mono'
    if phoned:
        when = '+'.join(f'between(t,{a:.3f},{b:.3f})' for a, b in phoned)
        filters += ''.join(f",{f}:enable='{when}'" for f in PHONE.split(','))
    ff('-i', str(raw), '-af', filters, str(voiced))
    if stem in MUSIC:
        voiced = with_music(stem, voiced, record, work)
        total = seconds(voiced)
    # Cut the voice where an effect or a song clip stands between two lines, and put that sound there.
    parts, said, start, bed = [], 0, 0.0, None
    for item in items:
        if item[0] == 'say':
            said += 1
            continue
        if item[0] == 'sfx' and item[1].startswith('under the whole call'):
            bed = sfx_file(item[1])
            continue
        end = line[said - 1][1] if said else 0.0
        if end > start:
            parts.append(('voice', start, end))
        parts.append(item)
        start = end
    if total > start:
        parts.append(('voice', start, total))
    files, clips = [], []
    for n, part in enumerate(parts):
        out = work / f'{stem}.{n:02d}.wav'
        if part[0] == 'voice':
            ff('-i', str(voiced), '-ss', f'{part[1]:.3f}', '-to', f'{part[2]:.3f}', str(out))
        elif part[0] == 'sfx':   # on the telephone too, with a short breath of silence around it
            ff('-i', str(sfx_file(part[1])), '-af', f'aresample=44100,aformat=channel_layouts=mono,{PHONE},loudnorm=I=-20:TP=-2,adelay=250,apad=pad_dur=0.35', str(out))
        else:
            _, title, at, length = part
            source, at = CLIPS[title] if at is None else (song(title), at)
            found = sorted(SRC.glob(source + '.*'))
            cut = work / f'{stem}.{n:02d}.cut.wav'   # two steps: one ffmpeg run that seeks an .ogg and levels it crashes here
            ff('-i', str(found[0]), '-map', '0:a:0', '-ss', str(at), '-t', str(length), str(cut))
            ff('-i', str(cut), '-af',
               f'aresample=44100,aformat=channel_layouts=mono,loudnorm=I=-19:TP=-2,afade=t=in:d=0.4,afade=t=out:st={length - 0.9}:d=0.9,adelay=200,apad=pad_dur=0.25', str(out))
            clips.append({'title': title, 'source': found[0].name, 'source_sha256': sha(found[0]), 'at': at, 'seconds': length})
        files.append(out)
    joined = work / f'{stem}.joined.wav'
    if len(files) == 1:
        joined = files[0]
    else:
        ff(*[a for f in files for a in ('-i', str(f))], '-filter_complex', ''.join(f'[{i}:a]' for i in range(len(files))) + f'concat=n={len(files)}:v=0:a=1', str(joined))
    final = FINAL / f'{stem}.mp3'
    short = MIN_SECONDS - seconds(joined)
    if short > 0:   # the player leaves out a track of 5 s or less (radio.ts): a short ident gets a pause before and after
        padded = work / f'{stem}.padded.wav'
        ff('-i', str(joined), '-af', f'adelay={round(short * 350)},apad=pad_dur={short * 0.65:.3f}', str(padded))
        joined = padded
    tail = ['-ar', '44100', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '192k', '-map_metadata', '-1', str(final)]
    if bed:   # the caller's car, quiet, on the telephone, under the whole call
        ff('-i', str(joined), '-stream_loop', '-1', '-i', str(bed), '-filter_complex',
           f'[1:a]aresample=44100,aformat=channel_layouts=mono,{PHONE},volume=0.16[b];[0:a][b]amix=inputs=2:duration=first:normalize=0', *tail)
    else:
        ff('-i', str(joined), *tail)
    record.update(final_sha256=sha(final), final_seconds=round(seconds(final), 2), **({'clips': clips} if clips else {}))
    (MAKE / f'{stem}.json').write_text(json.dumps(record, indent=1) + '\n')
    print(f'{stem}: {record["final_seconds"]} s')


def main() -> int:
    import tempfile
    if '--move-line-times' in sys.argv[2:]:
        raise SystemExit('use: make_talk.py --move-line-times <stem> [seconds]  (the option comes first)')
    if sys.argv[1:2] == ['--move-line-times']:
        if len(sys.argv) not in (3, 4):
            raise SystemExit('use: make_talk.py --move-line-times <stem> [seconds]')
        return move_line_times(*sys.argv[2:])
    MAKE.mkdir(parents=True, exist_ok=True)
    FINAL.mkdir(parents=True, exist_ok=True)
    every = segments()
    wanted = sys.argv[1:] or list(every)
    with tempfile.TemporaryDirectory(prefix='mmm-talk-') as work:
        for stem in wanted:
            make(stem, every[stem], pathlib.Path(work))
    done = [json.loads(p.read_text()) for p in sorted(MAKE.glob('talk-*.json'))]
    print(f'{len(done)} segments on record: {sum(r.get("final_seconds", 0) for r in done) / 60:.1f} min, {sum(r["characters"] for r in done)} characters')
    return 0


if __name__ == '__main__':
    sys.exit(main())
