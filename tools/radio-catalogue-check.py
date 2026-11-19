#!/usr/bin/env python3
"""Exercise the real catalogue generator with authored media and no live output writes."""
import json
import copy
import contextlib
import io
import hashlib
import importlib.util
import os
import pathlib
import subprocess
import sys
import tempfile
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parent.parent
source = (ROOT / 'tools/build_radio.py').read_text()
if '--drop-station' in sys.argv:
    anchor = 'just_all, just_public, just_page = stations, public, page'
    assert source.count(anchor) == 1
    source = source.replace(anchor, 'just_all, just_public, just_page = stations[:-1], public[:-1], page[:-1]')
plan = json.loads((ROOT / 'tools/radio_stations.json').read_text())
# A different existing station proves independent starts without hard-coded dials.
plan['just_start'] = next((s['dial'] for s in plan['stations'] if any(t.get('public') is True for t in s['tracks']) and not s.get('start')), plan['stations'][0]['dial'])
with tempfile.TemporaryDirectory(prefix='mmm-radio-catalogue-') as folder:
    root = pathlib.Path(folder)
    module = {'__file__': str(ROOT / 'tools/build_radio.py'), '__name__': 'radio_catalogue_test'}
    exec(compile(source, module['__file__'], 'exec'), module)
    module.update(ROOT=root, SRC=root / 'src', BASE=root / 'audio', OUT=root / 'audio/out',
                  PUBLIC=root / 'audio/site', PAGE=root / 'audio/page')
    (root / 'tools').mkdir()
    (root / 'src').mkdir()
    # False flags must not pass either filter; invalid non-booleans are rejected separately below.
    tracks = [t for s in plan['stations'] for t in s['tracks']]
    if tracks: tracks[0]['public'] = False
    if len(tracks)>1: tracks[1]['public'] = False
    if len(tracks)>2: tracks[2]['page'] = False
    (root / 'tools/radio_stations.json').write_text(json.dumps(plan))
    for track in tracks:
        (root / 'src' / (track['source'] + '.wav')).write_bytes(b'authored audio fixture')
    def run(args, **kwargs):
        if args[0] == 'ffmpeg':
            pathlib.Path(args[-1]).write_bytes(b'encoded fixture')
            return subprocess.CompletedProcess(args, 0)
        assert args[0] == 'ffprobe'
        # A different length per song: a derivation that took seconds from the wrong song differs.
        return subprocess.CompletedProcess(args, 0, stdout=str(10 + int(hashlib.sha256(args[-1].encode()).hexdigest()[:4], 16) / 100))
    module['level'] = lambda _: 'fixture'
    module['loudness'] = lambda _: {'input_i': '-16', 'input_tp': '-1.5'}
    with patch.object(subprocess, 'run', run):
        assert module['main']() == 0
    for kind in ['out', 'site', 'page']:
        read = lambda name: json.loads((root / 'audio' / kind / name).read_text())
        mail, just = read('radio.json'), read('radio-just.json')
        assert just['stations'] == mail['stations'], f'{kind}: Just Drive lost a station or track'
        flag = {'out': None, 'site': 'public', 'page': 'page'}[kind]
        expected = {t['source'] + '.mp3' for t in tracks if flag is None or t.get(flag) is True}
        actual = {t['file'] for s in just['stations'] for t in s['tracks']}
        assert actual == expected, f'{kind}: track filter changed'
        assert {p.name for p in (root / 'audio' / kind).glob('*.mp3')} == expected
        assert mail.get('start') == next((s['dial'] for s in plan['stations'] if s.get('start') is True and any(t['source']+'.mp3' in expected for t in s['tracks'])), None)
        assert just.get('start') == next((s['dial'] for s in plan['stations'] if s['dial']==plan['just_start'] and any(t['source']+'.mp3' in expected for t in s['tracks'])), None)
    # A host with only audio/out remakes the public folder for checks; it must equal the generator's, byte for byte.
    spec = importlib.util.spec_from_file_location('radio_public_from_out', ROOT / 'tools/radio-public-from-out.py')
    derive = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(derive)
    assert derive.public_folder(root / 'audio/out', root / 'derived', root / 'tools/radio_stations.json')
    site_files = {p.name: p.read_bytes() for p in (root / 'audio/site').iterdir()}
    assert {p.name: p.read_bytes() for p in (root / 'derived').iterdir()} == site_files, 'derived public radio differs from audio/site'
    try:
        # Any other catalogue bytes give another hash: the out folder no longer matches it.
        derive.public_folder(root / 'audio/out', root / 'derived-stale', root / 'audio/out/radio.json')
        raise AssertionError('a public folder was made from another catalogue')
    except ValueError as error:
        assert 'another radio catalogue' in str(error) and not (root / 'derived-stale').exists()
    print(f'PASS public radio made from audio/out equals the generator\'s audio/site ({len(site_files)} files)')
    # A missing source must stop before clearing any previous output or changing the credits module.
    before_outputs = {p: p.read_bytes() for p in (root / 'audio').rglob('*.json')}
    credits_file = root / 'web/src/radio-credits.generated.ts'
    before_credits = credits_file.read_bytes()
    for label, value, expected in [('missing', None, 'missing credit key'), ('unknown', 'not-a-credit', 'unknown credit key')]:
        invalid = copy.deepcopy(plan)
        first = invalid['stations'][0]['tracks'][0]
        if value is None:
            del first['credit']
        else:
            first['credit'] = value
        (root / 'tools/radio_stations.json').write_text(json.dumps(invalid))
        errors = io.StringIO()
        with contextlib.redirect_stderr(errors):
            assert module['main']() == 1
        assert expected in errors.getvalue(), errors.getvalue()
        assert all(p.read_bytes() == body for p, body in before_outputs.items())
        assert credits_file.read_bytes() == before_credits
        print(f'PASS real generator {label} credit: exit 1, clear message, previous outputs untouched')
    (root / 'tools/radio_stations.json').write_text(json.dumps(plan))
    for flag, value in [('public', 'yes'), ('page', 1)]:
        invalid = copy.deepcopy(plan)
        invalid['stations'][0]['tracks'][0][flag] = value
        (root / 'tools/radio_stations.json').write_text(json.dumps(invalid))
        errors = io.StringIO()
        with contextlib.redirect_stderr(errors):
            assert module['main']() == 1
        assert flag + ' must be true or false' in errors.getvalue()
        assert all(p.read_bytes() == body for p, body in before_outputs.items())
        assert credits_file.read_bytes() == before_credits
    (root / 'tools/radio_stations.json').write_text(json.dumps(plan))
    print('PASS non-boolean publication flags: exit 1 before any generated output changes')
    # A bad performer edit is rejected before replacing the old module or any list.
    invalid = copy.deepcopy(plan)
    invalid['credits']['performer-fixture'] = dict(by='Fixture maker', source='authored fixture', licence='CC0', date='2026-01-01', text='Music on {dials}: piano (CC0).')
    invalid['stations'][0]['tracks'].append(dict(source='bach-wtc1-prelude-01', title='Performer fixture', credit='performer-fixture'))
    (root / 'tools/radio_stations.json').write_text(json.dumps(invalid))
    before_stat = credits_file.stat().st_mtime_ns
    errors = io.StringIO()
    with contextlib.redirect_stderr(errors):
        assert module['main']() == 1
    assert 'Kimiko Ishizaka' in errors.getvalue(), errors.getvalue()
    assert credits_file.read_bytes() == before_credits and credits_file.stat().st_mtime_ns == before_stat
    assert all(p.read_bytes() == body for p, body in before_outputs.items())
    # Exercise the real entry guard against that edited catalogue and the untouched old module.
    flag = '-c' if sys.platform == 'darwin' else '--reflink=auto'
    for name in ['build_site.sh', 'radio_catalogue.py', 'radio-attribution-rules.json']:
        subprocess.run(['cp', flag, str(ROOT / 'tools' / name), str(root / 'tools' / name)], check=True)
    rejected_site = subprocess.run(['bash', str(root / 'tools/build_site.sh')], capture_output=True, text=True,
        env={**os.environ, 'RADIO': '0', 'SITE_OUT': str(root / 'must-not-create-site')})
    assert rejected_site.returncode == 1 and 'Kimiko Ishizaka' in rejected_site.stderr
    assert not (root / 'must-not-create-site').exists()
    print('PASS performer edit: module bytes/mtime and lists untouched; actual RADIO=0 site guard refuses')
    (root / 'tools/radio_stations.json').write_text(json.dumps(plan))
    media = root / 'src' / (tracks[0]['source'] + '.wav')
    media.unlink()
    errors = io.StringIO()
    with contextlib.redirect_stderr(errors):
        assert module['main']() == 1
    assert 'missing song source(s)' in errors.getvalue() and tracks[0]['source'] in errors.getvalue()
    assert all(p.read_bytes() == body for p, body in before_outputs.items())
    assert credits_file.read_bytes() == before_credits
    print('PASS missing source: exit 1, clear file stem, previous playlists and credits untouched')
    # Every generated list names the exact catalogue bytes used to make it.
    catalogue = root / 'tools/radio_stations.json'
    expected_hash = hashlib.sha256(catalogue.read_bytes()).hexdigest()
    for kind in ['out', 'site', 'page']:
        for name in ['radio.json', 'radio-just.json']:
            assert json.loads((root / 'audio' / kind / name).read_text())['catalogueHash'] == expected_hash
    from radio_catalogue import check_module
    check_module(catalogue)
    preflight = {'__file__': str(ROOT / 'tools/radio-site-preflight.py'), '__name__': 'radio_preflight_test'}
    exec(compile((ROOT / 'tools/radio-site-preflight.py').read_text(), preflight['__file__'], 'exec'), preflight)
    check = lambda: preflight['check_site'](root / 'audio/site', catalogue)
    check()
    def rejected(label):
        try:
            check()
        except ValueError:
            print('PASS rejected freshness mutation:', label)
        else:
            raise AssertionError('escaped freshness mutation: ' + label)
    original = catalogue.read_bytes()
    catalogue.write_bytes(original + b'\n')
    rejected('changed catalogue')
    catalogue.write_bytes(original)
    just_file = root / 'audio/site/radio-just.json'
    generated = just_file.read_bytes()
    data = json.loads(generated)
    del data['catalogueHash']
    just_file.write_text(json.dumps(data))
    rejected('old list without hash')
    just_file.unlink()
    rejected('missing Just Drive list')
    just_file.write_bytes(generated)
    # The real entry point must stop before compiling or clearing a previous site.
    for name in ['radio.json', 'radio-just.json']:
        path = root / 'audio/site' / name
        data = json.loads(path.read_text())
        data['catalogueHash'] = hashlib.sha256((ROOT / 'tools/radio_stations.json').read_bytes()).hexdigest()
        if name == 'radio-just.json':
            data['catalogueHash'] = 'stale'
        path.write_text(json.dumps(data))
    destination = root / 'existing-site'
    destination.mkdir()
    (destination / 'index.html').write_text('existing site must survive')
    failure = subprocess.run(['bash', str(ROOT / 'tools/build_site.sh')], env={**os.environ, 'AUDIO_SITE': str(root / 'audio/site'), 'SITE_OUT': str(destination), 'RADIO': '1'}, capture_output=True, text=True)
    assert failure.returncode == 1 and 'radio-just.json: stale radio catalogue' in failure.stderr
    assert (destination / 'index.html').read_text() == 'existing site must survive'
    print('PASS actual build_site stale-list rejection: exit 1, previous output untouched')
    # The Party Line's calls (tools/radio_calls.json): a mail-game list of its own, never in radio-just.json.
    for kind in ['out', 'site', 'page']:
        assert not (root / 'audio' / kind / 'calls.json').exists(), f'{kind}: no calls catalogue, no calls list'
    talk = next(s for s in plan['stations'] if any(t['credit'] == 'talk' for t in s['tracks']))
    calls_plan = {'dial': talk['dial'], 'credit': 'talk',
                  'calls': [{'source': 'talk-react-box-1', 'about': 'box', 'caller': 'theresa', 'name': False, 'public': True},
                            {'source': 'talk-react-lawn-4', 'about': 'lawn', 'caller': 'theresa', 'name': True, 'public': True},
                            {'source': 'talk-react-step1-a', 'about': 'step1', 'caller': 'effie', 'name': False}],
                  'nicknames': [{'source': 'talk-nick-theresa-lawn-1', 'kind': 'lawn', 'caller': 'theresa', 'name': 'the Lawnmower', 'public': True}]}
    calls_file = root / 'tools/radio_calls.json'
    calls_file.write_text(json.dumps(calls_plan))
    stems = [c['source'] for c in calls_plan['calls'] + calls_plan['nicknames']]
    for stem in stems:
        (root / 'src' / (stem + '.mp3')).write_bytes(b'authored call fixture')
    media.write_bytes(b'authored audio fixture')
    encoded = []
    def run_calls(args, **kwargs):
        encoded.append(args)
        return run(args, **kwargs)
    module['pauses'] = lambda path: [[1.0, 1.6], [4.25, 5.0]] if path.name.startswith('talk-') else []
    with patch.object(subprocess, 'run', run_calls):
        assert module['main']() == 0
    calls_hash = hashlib.sha256(calls_file.read_bytes()).hexdigest()
    talk_files = {t['source'] + '.mp3' for t in talk['tracks']}
    for kind, wanted in [('out', stems), ('site', ['talk-react-box-1', 'talk-react-lawn-4', 'talk-nick-theresa-lawn-1'])]:
        got = json.loads((root / 'audio' / kind / 'calls.json').read_text())
        assert got['catalogueHash'] == calls_hash and got['dial'] == talk['dial']
        assert [c['file'] for c in got['calls'] + got['nicknames']] == [s + '.mp3' for s in wanted], f'{kind}: calls filter'
        assert all((root / 'audio' / kind / c['file']).is_file() for c in got['calls'] + got['nicknames'])
        assert got['nicknames'][0] == {'file': 'talk-nick-theresa-lawn-1.mp3', 'seconds': got['nicknames'][0]['seconds'], 'kind': 'lawn',
                                      'caller': 'theresa', 'name': 'the Lawnmower'}
        assert set(got['gaps']) <= talk_files and got['gaps'], f'{kind}: pauses only for the calls station'
        assert set(got['gaps']) <= {t['file'] for s in json.loads((root / 'audio' / kind / 'radio.json').read_text())['stations'] for t in s['tracks']}
        for name in ['radio.json', 'radio-just.json']:
            assert 'calls' not in json.loads((root / 'audio' / kind / name).read_text()), 'the playable lists keep their schema'
    assert not (root / 'audio/site/talk-react-step1-a.mp3').exists(), 'a call not marked public stays off the public site'
    assert not (root / 'audio/page/calls.json').exists(), 'the private page has no calls'
    speech = [a for a in encoded if a[0] == 'ffmpeg' and any(str(x).endswith(('talk-react-box-1.part', 'talk-nick-theresa-lawn-1.part')) for x in a)]
    assert len(speech) == 2 and all(a[a.index('-ac') + 1] == '1' and a[a.index('-b:a') + 1] == '64k' for a in speech), 'calls are mono speech'
    songs = [a for a in encoded if a[0] == 'ffmpeg' and '-ac' in a and not any('talk-react' in str(x) or 'talk-nick' in str(x) for x in a)]
    assert all(a[a.index('-ac') + 1] == '2' and a[a.index('-b:a') + 1] == '128k' for a in songs), 'songs keep their encoding'
    print('PASS calls: out lists every call, site only the public ones with their files, pauses only for the calls station, mono speech')
    shutil = __import__('shutil')
    shutil.rmtree(root / 'derived-calls', ignore_errors=True)
    assert derive.public_folder(root / 'audio/out', root / 'derived-calls', root / 'tools/radio_stations.json')
    assert {p.name: p.read_bytes() for p in (root / 'derived-calls').iterdir()} == {p.name: p.read_bytes() for p in (root / 'audio/site').iterdir()}
    print('PASS public radio with calls made from audio/out equals the generator\'s audio/site')
    preflight['check_site'](root / 'audio/site', catalogue)
    calls_file.write_text(json.dumps({**calls_plan, 'note': 'changed'}))
    rejected('changed calls catalogue')
    calls_file.write_text(json.dumps(calls_plan))
    (root / 'src/talk-react-box-1.mp3').unlink()
    errors = io.StringIO()
    before_calls = (root / 'audio/out/calls.json').read_bytes()
    with contextlib.redirect_stderr(errors):
        assert module['main']() == 1
    assert 'missing call source(s)' in errors.getvalue() and 'talk-react-box-1' in errors.getvalue()
    assert (root / 'audio/out/calls.json').read_bytes() == before_calls
    print('PASS missing call source: exit 1, clear file stem, previous lists untouched')
    for label, change, words in [
        ('name call without nicknames', lambda c: c['nicknames'].clear(), 'has no nickname'),
        ('public name call, private nickname', lambda c: c['nicknames'][0].pop('public'), 'has no public nickname'),
        ('unknown about', lambda c: c['calls'][0].update(about='hedge'), 'about must be one of'),
        ('call not on a station', lambda c: c.update(dial='999.9'), 'dial must name a station'),
        ('credit the station does not have', lambda c: c.update(credit='suno'), 'credit must be a credit key'),
        ('call named like a track', lambda c: c['calls'][0].update(source='talk-call-hedge'), 'starts with talk-react-'),
        ('twice', lambda c: c['calls'].append(dict(c['calls'][0])), 'listed twice'),
        ('string public', lambda c: c['calls'][0].update(public='yes'), 'must be true or false'),
    ]:
        bad = copy.deepcopy(calls_plan)
        change(bad)
        calls_file.write_text(json.dumps(bad))
        errors = io.StringIO()
        with contextlib.redirect_stderr(errors):
            assert module['main']() == 1, label
        assert words in errors.getvalue(), (label, errors.getvalue())
        assert (root / 'audio/out/calls.json').read_bytes() == before_calls
    calls_file.unlink()
    print('PASS bad calls catalogues: exit 1 with the fix, before any output changes')
    print('PASS real generator: shared catalogues, every catalogue track, strict public/page filters and start dials')
