"""Catalogue validation and generated radio credits. No media or output writes here."""
import hashlib
import difflib
import html
import json
import os
import tempfile
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
CREDIT = ('by', 'licence', 'source', 'date', 'text')
TOP_KEYS = ('note', 'credits', 'stations', 'just_start')
STATION_KEYS = ('dial', 'name', 'tracks', 'start')
TRACK_KEYS = ('source', 'title', 'credit', 'credit_overrides', 'public', 'page')
RULES = json.loads(pathlib.Path(__file__).with_name('radio-attribution-rules.json').read_text())
# The title card's credits, About and Just Listen show the music credit. It must not grow with every song (#232 named
# songs and doubled it): credit by source and dial, never by song. tools/radio-expectations.mjs holds the same number.
MUSIC_CREDIT_MAX = 1100
SOURCE_WORDS = {source: group['requires'] for group in RULES['groups'] for source in group['sources']}


def normalized(text):
    return ' '.join(text.lower().split())


def names(text, words):
    return re.search(r'(?<![a-z0-9_])' + re.escape(normalized(words)) + r'(?![a-z0-9_])', normalized(text)) is not None


def check_track_content(track, credit, label):
    """Check this song's own text, never another song or the whole card."""
    text = credit['text']
    if 'on this map' in normalized(text):
        raise ValueError(f'{label}: credit.text must not say "on this map"; name the actual place')
    required = SOURCE_WORDS.get(track['source'])
    if required is not None:
        for word in required:
            if not names(text, word):
                raise ValueError(f'{label}: credit.text must name "{word}" for known source {track["source"]}')
    elif not names(text, credit['by']):
        raise ValueError(f'{label}: new source credit.text must name its maker from by: {credit["by"]!r}')


def atomic_write(path, content):
    """Publish one complete file, never a partially written list or credits module."""
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.' + path.name + '-', delete=False) as output:
            temporary = pathlib.Path(output.name)
            output.write(content.encode('utf-8') if isinstance(content, str) else content)
        temporary.chmod(path.stat().st_mode & 0o777 if path.exists() else 0o644)
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def effective_credit(plan, track):
    """A required credit key and optional song-specific fields travel with every song."""
    return {**plan['credits'][track['credit']], **track.get('credit_overrides', {})}


def allowed_keys(value, allowed, label):
    unknown = sorted(set(value) - set(allowed))
    if unknown:
        key = unknown[0]
        suggestion = difflib.get_close_matches(key, sorted(allowed), n=1, cutoff=0)[0]
        raise ValueError(f'{label}: unknown key {key!r}; did you mean {suggestion!r}? Allowed keys: {", ".join(allowed)}')


def boolean_fields(value, fields, label):
    for key in fields:
        if key in value and not isinstance(value[key], bool):
            raise ValueError(f'{label}: {key} must be true or false (JSON booleans)')


def dial_value(value):
    return value.strip().lower()


def validate(plan):
    text = lambda v: isinstance(v, str) and bool(v.strip())
    if not isinstance(plan, dict):
        raise ValueError('catalogue must be an object')
    allowed_keys(plan, TOP_KEYS, 'catalogue')
    if not isinstance(plan.get('stations'), list):
        raise ValueError('stations must be a list of station objects')
    credits = plan.get('credits')
    if not isinstance(credits, dict) or not credits:
        raise ValueError('credits must be a map of named, complete credits (for example suno)')

    def complete(credit, label):
        missing = [key for key in CREDIT if not text(credit.get(key))]
        if missing:
            raise ValueError(f'{label}: credit missing {", ".join(missing)}; fill the credits entry or the track credit_overrides')
        template = credit['text']
        if template.count('{dials}') != 1 or re.search(r'[{}]', template.replace('{dials}', '')):
            raise ValueError(f'{label}: credit.text needs exactly one {{dials}} placeholder and no other braces')

    for key, credit in credits.items():
        if not text(key) or not isinstance(credit, dict):
            raise ValueError('each credits entry needs a name and a credit object')
        complete(credit, f'credits.{key}')
    seen = set()
    for index, station in enumerate(plan['stations'], 1):
        label = f'station {index}'
        if not isinstance(station, dict):
            raise ValueError(f'{label}: supply a station object')
        allowed_keys(station, STATION_KEYS, label)
        if not text(station.get('dial')) or not text(station.get('name')) or not isinstance(station.get('tracks'), list):
            raise ValueError(f'{label}: supply dial, name and tracks')
        boolean_fields(station, ('start',), label)
        if 'on this map' in normalized(station['name']):
            raise ValueError(f'{label}: station name must not say "on this map"; name the actual place')
        dial = dial_value(station['dial'])
        station['dial'] = dial
        if dial == 'off':
            raise ValueError(f'{label}: off is reserved for the radio off setting; choose another dial')
        if dial in seen:
            raise ValueError(f'{label}: duplicate dial {dial!r} after trimming/case normalisation; give each station a different dial')
        seen.add(dial)
        for track in station['tracks']:
            if not isinstance(track, dict):
                raise ValueError(f'{dial}: each song must be an object')
            label = f'{dial} / {track.get("title", "unnamed track")}'
            allowed_keys(track, TRACK_KEYS, label)
            if not text(track.get('title')) or not isinstance(track.get('source'), str) or not re.fullmatch(r'[\w-]+', track['source']):
                raise ValueError(f'{dial}: each song needs title and source (file stem: letters, digits, - or _)')
            boolean_fields(track, ('public', 'page'), label)
            if 'on this map' in normalized(track['title']):
                raise ValueError(f'{label}: track title must not say "on this map"; name the actual place')
            if not text(track.get('credit')):
                raise ValueError(f'{label}: missing credit key; set credit to one of: {", ".join(credits)}')
            if track['credit'] not in credits:
                raise ValueError(f'{label}: unknown credit key {track["credit"]!r}; choose one of: {", ".join(credits)}')
            if not isinstance(track.get('credit_overrides', {}), dict):
                raise ValueError(f'{label}: credit_overrides must be an object')
            unknown = set(track.get('credit_overrides', {})) - set(CREDIT)
            if unknown:
                raise ValueError(f'{label}: unknown credit_overrides key(s): {", ".join(sorted(unknown))}; use {", ".join(CREDIT)}')
            credit = effective_credit(plan, track)
            complete(credit, label)
            check_track_content(track, credit, label)
    if sum(s.get('start') is True for s in plan['stations']) > 1:
        raise ValueError('more than one station is marked start: true; keep at most one')
    if plan.get('just_start') is not None:
        if not text(plan['just_start']):
            raise ValueError('just_start must name an existing station dial; change it when removing or changing that dial')
        plan['just_start'] = dial_value(plan['just_start'])
        if plan['just_start'] not in seen:
            raise ValueError('just_start must name an existing station dial; change it when removing or changing that dial')
    return plan


# The Party Line's call-ins for Get Fired (tools/radio_calls.json): short recorded calls the game plays into a pause of
# one station. They are not tracks: no station lists them and the credits card does not change for them. The words of
# ABOUTS, NICK_KINDS and the length limit are web/src/party-line-rules.ts's (the party-line row compares them).
CALLS_PATH = ROOT / 'tools/radio_calls.json'
CALLS_KEYS = ('note', 'dial', 'credit', 'calls', 'nicknames')
CALL_KEYS = ('source', 'about', 'caller', 'name', 'public', 'credit_overrides')
NICKNAME_KEYS = ('source', 'kind', 'caller', 'name', 'public', 'credit_overrides')
ABOUTS = ('box', 'lawn', 'mail', 'horn', 'dust', 'missing', 'late', 'flag', *(f'step{n}' for n in range(1, 8)))
NICK_KINDS = ('box', 'lawn', 'mail', 'painter', 'general')


def validate_calls(calls, plan):
    """The calls catalogue, against the station catalogue `plan` (already validated). Raises ValueError with the fix."""
    if not isinstance(calls, dict):
        raise ValueError('radio_calls.json must be an object')
    allowed_keys(calls, CALLS_KEYS, 'radio_calls.json')
    dial = dial_value(calls.get('dial', '')) if isinstance(calls.get('dial'), str) else ''
    station = next((s for s in plan['stations'] if s['dial'] == dial), None)
    if station is None:
        raise ValueError('radio_calls.json: dial must name a station of radio_stations.json')
    calls['dial'] = dial
    # The credits card names the station's credits by dial: the calls' credit must be one the station's tracks have.
    if calls.get('credit') not in {t['credit'] for t in station['tracks']}:
        raise ValueError(f'radio_calls.json: credit must be a credit key that a track of {dial} uses')
    seen = set()

    def entry(item, keys, prefix, label):
        if not isinstance(item, dict):
            raise ValueError(f'radio_calls.json: each of {label} must be an object')
        allowed_keys(item, keys, f'radio_calls.json {label}')
        source = item.get('source')
        if not isinstance(source, str) or not re.fullmatch(r'[\w-]+', source) or not source.startswith(prefix):
            raise ValueError(f'radio_calls.json {label}: source must be a file stem that starts with {prefix}')
        if source in seen:
            raise ValueError(f'radio_calls.json: {source} is listed twice')
        seen.add(source)
        if not isinstance(item.get('caller'), str) or not re.fullmatch(r'[a-z]+', item['caller']):
            raise ValueError(f'radio_calls.json {source}: caller must be a first name in small letters')
        boolean_fields(item, ('public',), f'radio_calls.json {source}')
        overrides = item.get('credit_overrides', {})
        if not isinstance(overrides, dict) or set(overrides) - set(CREDIT):
            raise ValueError(f'radio_calls.json {source}: credit_overrides takes only {", ".join(CREDIT)}')

    for key, keys, prefix in (('calls', CALL_KEYS, 'talk-react-'), ('nicknames', NICKNAME_KEYS, 'talk-nick-')):
        if not isinstance(calls.get(key), list):
            raise ValueError(f'radio_calls.json: {key} must be a list')
        for item in calls[key]:
            entry(item, keys, prefix, key)
    callers = {n['caller'] for n in calls['nicknames']}
    public_callers = {n['caller'] for n in calls['nicknames'] if n.get('public') is True}
    for call in calls['calls']:
        if call.get('about') not in ABOUTS:
            raise ValueError(f'radio_calls.json {call["source"]}: about must be one of {", ".join(ABOUTS)}')
        if not isinstance(call.get('name'), bool):
            raise ValueError(f'radio_calls.json {call["source"]}: name must be true or false (JSON booleans)')
        if call['name'] and call['caller'] not in callers:
            raise ValueError(f'radio_calls.json {call["source"]}: it ends on a name, and {call["caller"]} has no nickname')
        # The public site gets only public pieces: a public call that ends on a name needs a public nickname to follow it.
        if call['name'] and call.get('public') is True and call['caller'] not in public_callers:
            raise ValueError(f'radio_calls.json {call["source"]}: it is public and ends on a name, and {call["caller"]} has no public nickname')
    for nick in calls['nicknames']:
        if nick.get('kind') not in NICK_KINDS:
            raise ValueError(f'radio_calls.json {nick["source"]}: kind must be one of {", ".join(NICK_KINDS)}')
        if not isinstance(nick.get('name'), str) or not nick['name'].strip() or len(nick['name']) > 40:
            raise ValueError(f'radio_calls.json {nick["source"]}: name must be the nickname as the screen shows it (40 characters at most)')
    return calls


def read_calls(plan, path=None):
    """The validated calls catalogue, or None when there is no such file."""
    path = pathlib.Path(path or CALLS_PATH)
    if not path.is_file():
        return None
    try:
        calls = json.loads(path.read_text())
    except json.JSONDecodeError as error:
        raise ValueError(f'{path.name}: JSON error at line {error.lineno}, column {error.colno}: {error.msg}') from error
    return validate_calls(calls, plan)


def parse_catalogue(catalogue, label='radio_stations.json'):
    try:
        return validate(json.loads(catalogue))
    except json.JSONDecodeError as error:
        raise ValueError(f'{label}: JSON error at line {error.lineno}, column {error.colno}: {error.msg}') from error


def read_catalogue(path=ROOT / 'tools/radio_stations.json'):
    return parse_catalogue(path.read_bytes(), path.name)


def credit_text(plan, stations=None):
    """Group attribution by source, naming station dials only. A mixed station says how many of its songs a credit covers
    after its dial, "(2 of 5)", instead of listing song titles, so the credit stays short however many songs it gains."""
    groups = {}
    for station in plan['stations'] if stations is None else stations:
        texts = [effective_credit(plan, track)['text'] for track in station['tracks']]
        for template in dict.fromkeys(texts):
            share = texts.count(template)
            dial = station['dial'] + ('' if share == len(texts) else f' ({share} of {len(texts)})')
            groups.setdefault(template, []).append(dial)
    def joined(dials):
        return ' and '.join(dials) if len(dials) < 3 else ', '.join(dials[:-1]) + ' and ' + dials[-1]
    return ' '.join(template.replace('{dials}', joined(dials)) for template, dials in groups.items())


def selected(plan, flag=None):
    stations = []
    for station in plan['stations']:
        tracks = [t for t in station['tracks'] if flag is None or t.get(flag) is True]
        if tracks:
            stations.append({**station, 'tracks': tracks})
    return stations


def credits_module(catalogue):
    plan = parse_catalogue(catalogue)
    for flag in (None, 'public'):
        words = credit_text(plan, selected(plan, flag))
        if len(words) > MUSIC_CREDIT_MAX:
            raise ValueError(f'the {flag or "full"} music credit is {len(words)} characters, over {MUSIC_CREDIT_MAX}; '
                             'shorten the credits texts in tools/radio_stations.json')
    paragraph = lambda flag: '<p id="titleMusic">' + html.escape(credit_text(plan, selected(plan, flag)), quote=False) + '</p>'
    return ('// Generated by tools/build_radio.py. Edit tools/radio_stations.json, then run tools/radio.sh.\n'
            + 'export const catalogueHash = ' + json.dumps(hashlib.sha256(catalogue).hexdigest()) + ';\n'
            + 'export const MUSIC_CREDIT = ' + json.dumps(paragraph(None), ensure_ascii=False) + ';\n'
            + 'export const PUBLIC_MUSIC_CREDIT = ' + json.dumps(paragraph('public'), ensure_ascii=False) + ';\n')


def check_module(catalogue=ROOT / 'tools/radio_stations.json', module=None):
    module = module or catalogue.parent.parent / 'web/src/radio-credits.generated.ts'
    if not module.is_file() or module.read_text() != credits_module(catalogue.read_bytes()):
        raise ValueError(f'{module.name}: stale generated music credits; run tools/radio.sh')


if __name__ == '__main__':
    import sys
    try:
        check_module()
    except (OSError, ValueError) as error:
        sys.exit(f'error: {error}')
