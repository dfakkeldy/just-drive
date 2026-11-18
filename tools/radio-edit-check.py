#!/usr/bin/env python3
"""Catalogue edits, naive credit-safe moves, and the real no-radio site build guard."""
import copy
import hashlib
import json
import os
import pathlib
import subprocess
import sys
import tempfile
from radio_catalogue import MUSIC_CREDIT_MAX, ROOT, check_module, credit_text, credits_module, effective_credit, read_catalogue, selected, validate, SOURCE_WORDS

plan = read_catalogue()
check_module()
for kind, flag in [('out', None), ('site', 'public'), ('page', 'page')]:
    expected = selected(plan, flag)
    for name in ['radio.json', 'radio-just.json']:
        path = pathlib.Path(os.environ.get('AUDIO_OUT', ROOT / 'data/audio')) / kind / name
        if not expected and kind != 'out':
            assert not path.exists(), f'{path}: empty playlist must not leave an old list'
            continue
        stale = f'{path}: the radio lists are stale; run tools/radio.sh'
        try:
            got = json.loads(path.read_text())
        except (OSError, ValueError) as error:
            raise AssertionError(stale) from error
        assert isinstance(got, dict) and got.get('catalogueHash') == hashlib.sha256((ROOT / 'tools/radio_stations.json').read_bytes()).hexdigest(), stale
        assert 'musicCredit' not in got, 'unused credit fields must not return to the playable lists'
        assert [(s['dial'], s['name'], [(t['file'], t['title']) for t in s['tracks']]) for s in got['stations']] == [
            (s['dial'], s['name'], [(t['source']+'.mp3', t['title']) for t in s['tracks']]) for s in expected], stale
print('PASS every generated list: stations, track membership and catalogue hash; credits only in the module')

# Small authored catalogue, independent of today's names, dials, songs and permissions.
credit = dict(by='a composer', licence='a licence', source='a source', date='2026-01-01', text='Music on {dials}: a composer (a licence).')
other = dict(by='another composer', licence='another licence', source='another source', date='2026-01-01', text='Other music on {dials}: another composer.')
fixture = {'credits': {'one': credit, 'two': other},
           'stations': [{'dial': 'a', 'name': 'One', 'tracks': [{'source': 'song', 'title': 'Song', 'public': True, 'credit': 'one'}]},
                        {'dial': 'b', 'name': 'Two', 'tracks': [{'source': 'other', 'title': 'Another song', 'credit': 'two'}]}],
           'just_start': 'a'}
validate(fixture)
canonical = copy.deepcopy(fixture)
canonical['stations'][0]['dial'] = ' A '
canonical['just_start'] = ' A '
validate(canonical)
assert canonical['stations'][0]['dial'] == canonical['just_start'] == 'a'
assert credit_text(fixture, selected(fixture, 'public')) == 'Music on a: a composer (a licence).'
moved = copy.deepcopy(fixture)
track = moved['stations'][0]['tracks'].pop()
before = effective_credit(moved, track)
moved['stations'][1]['tracks'].append(track)  # No credit edit or extra step.
validate(moved)
assert effective_credit(moved, track) == before
assert credit_text(moved) == ('Other music on b (1 of 2): another composer. '
                             'Music on b (1 of 2): a composer (a licence).')
assert effective_credit(fixture, {'credit': 'one', 'credit_overrides': {'by': 'another composer'}})['by'] == 'another composer'
print('PASS naive whole-track move preserves its credit; a mixed station says (1 of 2), never song titles')

# Unequal counts, with the minority first, prevent a minimum/first-group primary-credit bug (R6).
unequal = copy.deepcopy(fixture)
unequal['stations'] = [{'dial': 'a', 'name': 'Mixed', 'tracks': [
    {'source': 'minority', 'title': 'Minority $&', 'credit': 'two'},
    *[{'source': f'major-{i}', 'title': f'Major {i}', 'credit': 'one'} for i in range(3)]
]}]
unequal['just_start'] = 'a'
validate(unequal)
expected_mixed = ('Other music on a (1 of 4): another composer. '
                  'Music on a (3 of 4): a composer (a licence).')
assert credit_text(unequal) == expected_mixed
assert 'Minority' not in credit_text(unequal)
# Adding songs to a station changes only its counts: 300 more of each kind add two digits per count, no titles.
crowded = copy.deepcopy(unequal)
crowded['stations'][0]['tracks'] += [{'source': f'more-{i}', 'title': f'More {i}', 'credit': ('one', 'two')[i % 2]} for i in range(600)]
validate(crowded)
assert credit_text(crowded) == ('Other music on a (301 of 604): another composer. '
                                'Music on a (303 of 604): a composer (a licence).')
assert len(credit_text(crowded)) - len(expected_mixed) == 8 and 'More ' not in credit_text(crowded)
print('PASS authored 3-to-1 mixed-station fixture says (3 of 4)/(1 of 4); 600 more songs add only digits')

# The real-catalogue demonstration is conditional; deleting a genre must remain a valid edit.
actual = copy.deepcopy(plan)
origins = [(s, i) for s in actual['stations'] for i, t in enumerate(s['tracks']) if 'Suno' in SOURCE_WORDS.get(t['source'], [])]
if origins:
    origin, index = origins[0]
    # The target has no Suno song of its own: after the move the Suno sentence names the target dial with "(1 of N)",
    # and never the song's title.
    targets = [s for s in actual['stations'] if s is not origin and any('ElevenLabs Music' in SOURCE_WORDS.get(t['source'], []) for t in s['tracks'])
               and not any('Suno' in SOURCE_WORDS.get(t['source'], []) for t in s['tracks'])]
    if targets:
        target = targets[0]
        track = origin['tracks'].pop(index)
        original_track, original_credit = copy.deepcopy(track), effective_credit(actual, track)
        target['tracks'].append(track)
        validate(actual)
        assert track == original_track and effective_credit(actual, track) == original_credit
        assert 'Suno' in original_credit['text']
        got = credit_text(actual, [target])
        assert original_credit['text'].replace('{dials}', f"{target['dial']} (1 of {len(target['tracks'])})") in got and track['title'] not in got
        print(f'PASS actual naive move: {track["title"]} -> {target["dial"]}; unchanged track object keeps Suno credit')
    else:
        print('SKIP actual naive move: no station has ElevenLabs Music songs and no Suno song')
else:
    print('SKIP actual naive move: the catalogue has no Suno song')
print('PASS authored move/content fixtures remain active even when a credit type is absent')
for flag in (None, 'public'):
    words = credit_text(plan, selected(plan, flag))
    assert len(words) <= MUSIC_CREDIT_MAX, f'{flag or "all"} music credit is {len(words)} characters; cap {MUSIC_CREDIT_MAX}'
    assert not any('“' + t['title'] + '”' in words for s in plan['stations'] for t in s['tracks']), 'no song titles in the credit'
long_credit = copy.deepcopy(fixture)
long_credit['credits']['one']['text'] = credit['text'] + ' A very long credit.' * 60
try:
    credits_module(json.dumps(long_credit).encode())
except ValueError as error:
    assert 'characters' in str(error)
else:
    raise AssertionError('an over-long music credit must stop the build')
print(f'PASS the generated music credit is at most {MUSIC_CREDIT_MAX} characters with no song titles; a longer one stops the build')

# Every rule is exercised on one resolved track, without help from other songs' credits.
def content_fixture(source, text):
    return {'credits': {'fixture': dict(by='Fixture maker', source='authored fixture', licence='Fixture permission', date='2026-01-01', text=text)},
            'stations': [{'dial': 'x', 'name': 'Fixture', 'tracks': [{'source': source, 'title': 'Fixture song', 'credit': 'fixture'}]}]}

ai_source = 'where-two-rivers-meet'  # Fixed source fixture; it must not depend on a rule under test.
valid_geography = content_fixture(ai_source, 'Music on {dials}: Claude and ElevenLabs Music about places around Mabou.')
validate(valid_geography)
for label, candidate, message in [
    ('C2 around Mabou present', content_fixture(ai_source, 'Music on {dials}: Claude and ElevenLabs Music.'), 'around Mabou'),
    ('C5 on this map absent', content_fixture('authored-geography', 'Music on {dials}: Fixture maker, ON tHiS MaP.'), 'on this map'),
    ('unknown source names maker', content_fixture('authored-maker', 'Music on {dials}: an unidentified musician.'), 'maker'),
]:
    try:
        validate(candidate)
    except ValueError as error:
        assert message in str(error), str(error)
    else:
        raise AssertionError('escaped independent content fixture: ' + label)
    print('PASS independent per-track content rule:', label)
for source, words in SOURCE_WORDS.items():
    valid = content_fixture(source, 'Music on {dials}: ' + ', '.join(words) + '.')
    validate(valid)
    for word in words:
        bad = copy.deepcopy(valid)
        bad['credits']['fixture']['text'] = bad['credits']['fixture']['text'].replace(word, 'omitted')
        try:
            validate(bad)
        except ValueError as error:
            assert word in str(error), str(error)
        else:
            raise AssertionError(f'fixed source attribution escaped: {source} / {word}')
print(f'PASS all {len(SOURCE_WORDS)} known source files pin their own attribution words independently of by/source metadata')

for label, mutate, message in [
    ('top-level typo', lambda p: p.update(just_strat='a'), "did you mean 'just_start'"),
    ('station typo', lambda p: p['stations'][0].update(strat=True), "did you mean 'start'"),
    ('track typo', lambda p: p['stations'][0]['tracks'][0].update(pubilc=True), "did you mean 'public'"),
    ('override field typo', lambda p: p['stations'][0]['tracks'][0].update(credit_overides={}), "did you mean 'credit_overrides'"),
    ('public type', lambda p: p['stations'][0]['tracks'][0].update(public='yes'), 'public must be true or false'),
    ('page type', lambda p: p['stations'][0]['tracks'][0].update(page=1), 'page must be true or false'),
    ('start type', lambda p: p['stations'][0].update(start='true'), 'start must be true or false'),
    ('canonical duplicate dial', lambda p: p['stations'][1].update(dial=' A '), 'duplicate dial'),
    ('reserved OFF dial', lambda p: p['stations'][1].update(dial=' OFF '), 'off is reserved'),
    ('duplicate dial', lambda p: p['stations'][1].update(dial='a'), 'duplicate dial'),
    ('multiple starts', lambda p: [s.update(start=True) for s in p['stations']], 'more than one'),
    ('retired Just Drive dial', lambda p: p.update(just_start='retired'), 'just_start'),
    ('incomplete credit', lambda p: p['credits']['one'].pop('licence'), 'licence'),
    ('missing credit key', lambda p: p['stations'][0]['tracks'][0].pop('credit'), 'missing credit key'),
    ('unknown credit key', lambda p: p['stations'][0]['tracks'][0].update(credit='unknown'), 'unknown credit key'),
    ('incomplete override', lambda p: p['stations'][0]['tracks'][0].update(credit_overrides={'by': ''}), 'by'),
    ('missing credit template', lambda p: p['credits']['one'].update(text='No dial list'), '{dials}'),
    ('station default forbidden', lambda p: p['stations'][0].update(credit=credit), 'credit'),
    ('misspelled override', lambda p: p['stations'][0]['tracks'][0].update(credit_overrides={'soruce': 'typo'}), 'soruce'),
    ('station geography', lambda p: p['stations'][0].update(name='ON THIS MAP FM'), 'station name'),
    ('track geography', lambda p: p['stations'][0]['tracks'][0].update(title='On This Map'), 'track title'),
    ('unsafe source', lambda p: p['stations'][0]['tracks'][0].update(source='../song'), 'file stem'),
]:
    bad = copy.deepcopy(fixture); mutate(bad)
    try:
        validate(bad)
    except ValueError as error:
        assert message in str(error), str(error)
    else:
        raise AssertionError('invalid catalogue escaped: ' + label)
    print('PASS rejected catalogue fault:', label)
with tempfile.TemporaryDirectory(prefix='mmm-radio-credit-') as directory:
    root = pathlib.Path(directory)
    catalogue = root / 'radio_stations.json'
    catalogue.write_text(json.dumps(fixture))
    module = root / 'radio-credits.generated.ts'
    module.write_text(credits_module(catalogue.read_bytes()))
    check_module(catalogue, module)
    module.write_text(module.read_text().replace('a composer', 'wrong composer'))
    try:
        check_module(catalogue, module)
    except ValueError:
        print('PASS rejected modified generated credits (even with unchanged catalogueHash)')
    else:
        raise AssertionError('modified module escaped freshness check')


def site_guard(source):
    """Run the actual entry script against stale credits with RADIO=0, before any build or clearing."""
    with tempfile.TemporaryDirectory(prefix='mmm-radio-site-guard-') as directory:
        root = pathlib.Path(directory)
        for part in ['tools', 'web/src', 'bin', 'existing-site']:
            (root / part).mkdir(parents=True, exist_ok=True)
        # Clone the small scripts/rules; no media or land inputs are copied into the fixture.
        clone_flag = '-c' if sys.platform == 'darwin' else '--reflink=auto'
        for name in ['build_site.sh', 'radio_catalogue.py', 'radio-attribution-rules.json']:
            subprocess.run(['cp', clone_flag, str(ROOT / 'tools' / name), str(root / 'tools' / name)], check=True)
        (root / 'tools/build_site.sh').write_text(source)
        (root / 'tools/radio_stations.json').write_text(json.dumps(fixture))
        (root / 'web/src/radio-credits.generated.ts').write_text('stale credits module')
        (root / 'bin/npx').write_text('#!/bin/sh\nprintf build > "$RADIO_GUARD_MARKER"\nexit 93\n')
        (root / 'bin/npx').chmod(0o755)
        previous = root / 'existing-site/index.html'
        previous.write_text('previous site must survive')
        marker = root / 'build-started'
        result = subprocess.run(['bash', str(root / 'tools/build_site.sh')], capture_output=True, text=True,
            env={**os.environ, 'RADIO': '0', 'SITE_OUT': str(root / 'existing-site'),
                 'PATH': str(root / 'bin') + os.pathsep + os.environ['PATH'], 'RADIO_GUARD_MARKER': str(marker)})
        assert result.returncode == 1 and 'stale generated music credits' in result.stderr, f'RADIO=0 must reject stale credits before compiling; exit {result.returncode}: {result.stderr}'
        assert not marker.exists(), 'stale no-radio credits must stop before the compiler'
        assert previous.read_text() == 'previous site must survive'


site_source = (ROOT / 'tools/build_site.sh').read_text()
site_guard(site_source)
print('PASS actual build_site RADIO=0 stale-module rejection: exit 1, no compiler or output changes')
anchor = 'python3 "$ROOT/tools/radio_catalogue.py"\n'
assert site_source.count(anchor) == 1
try:
    site_guard(site_source.replace(anchor, ''))
except AssertionError:
    print('PASS rejected M6: removed no-radio credits guard')
else:
    raise AssertionError('M6 removed guard escaped')

# A later row failure must also restore the old module, even after a valid generation succeeded.
with tempfile.TemporaryDirectory(prefix='mmm-radio-command-') as directory:
    root = pathlib.Path(directory)
    for part in ['tools', 'web/src']:
        (root / part).mkdir(parents=True, exist_ok=True)
    flag = '-c' if sys.platform == 'darwin' else '--reflink=auto'
    for name in ['radio.sh', 'radio_catalogue.py', 'radio-attribution-rules.json']:
        subprocess.run(['cp', flag, str(ROOT / 'tools' / name), str(root / 'tools' / name)], check=True)
    catalogue = root / 'tools/radio_stations.json'
    catalogue.write_text(json.dumps(fixture))
    previous = credits_module(catalogue.read_bytes()).encode()
    module = root / 'web/src/radio-credits.generated.ts'
    module.write_bytes(previous)
    catalogue.write_bytes(catalogue.read_bytes() + b'\n')  # A legitimate catalogue edit changes its hash.
    (root / 'tools/build_radio.py').write_text(
        "import pathlib,sys\nsys.path.insert(0,'tools')\nfrom radio_catalogue import credits_module,atomic_write\n"
        "atomic_write(pathlib.Path('web/src/radio-credits.generated.ts'),credits_module(pathlib.Path('tools/radio_stations.json').read_bytes()))\n")
    (root / 'tools/checks.tsv').write_text('name\tcommand\tmode\nsite-deliberate-failure\tfalse\tnode\n')
    failed = subprocess.run(['bash', str(root / 'tools/radio.sh')], capture_output=True, text=True)
    assert failed.returncode == 1 and 'site-deliberate-failure: exit 1' in failed.stdout
    assert module.read_bytes() == previous
    try:
        check_module(catalogue, module)
    except ValueError:
        print('PASS failed command restores previous module; changed catalogue remains stale')
    else:
        raise AssertionError('failed command left a fresh-looking module')
