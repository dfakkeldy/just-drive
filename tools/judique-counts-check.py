#!/usr/bin/env python3
"""The counts of the baked Judique land, pinned: a change to Judique's props or streams must change this file too.

Judique has no mail route, so no other check holds a Judique mailbox, pole or stream count. The numbers are read
from props.json and streams.json themselves, and the manifest must say the same.
Poles on public roads (kinds 1-3) are pinned. Power poles (#183) are accepted by rule, not by count: each stands on a
named kind-4 road that is no bridge, and they come only with the file's service drops. power-network-land checks
their placement and every drop.
Mutants: each count one off, a manifest that says another number, and power poles that break the rule must be found.
"""
import collections
import copy
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAND = os.path.join(ROOT, 'data', 'baked', 'areas', 'judique')
# The land of the bake of 14 Nov 2026 (no roadside box for the hand-built house site), with the the project brief road repair.
PINS = dict(mailboxes=340, frames=58, boxes_in_frames=142, public_poles=1534, community=0, streams=409, culverts=101)


def counts(props, streams, roads):
    groups = collections.Counter(b['group'] for b in props['mailboxes'] if b['group'] is not None)
    return dict(mailboxes=len(props['mailboxes']), frames=len(groups), boxes_in_frames=sum(groups.values()),
                public_poles=sum(1 for q in props['poles'] if q['road'] in roads and roads[q['road']]['kind'] <= 3),
                poles=len(props['poles']), community=len(props['communityBoxes']),
                streams=len(streams['streams']), culverts=len(streams['culverts']))


def power_faults(props, roads, manifest):
    power = [q for q in props['poles'] if not (q['road'] in roads and roads[q['road']]['kind'] <= 3)]
    found = [f'power pole on road {q["road"]}, not a named kind-4 road' for q in power
             if q['road'] not in roads or roads[q['road']]['kind'] != 4 or not (roads[q['road']].get('name') or '').strip() or roads[q['road']]['bridge']]
    if 'serviceDrops' not in props:
        found += [f'{len(power)} power poles without service drops'] if power else []
        found += [f'the manifest says {manifest["props"]["serviceDrops"]} serviceDrops, the file has none'] if 'serviceDrops' in manifest['props'] else []
    elif power and not props['serviceDrops']:
        found.append(f'{len(power)} power poles with no service drops')
    elif manifest['props'].get('serviceDrops') != len(props['serviceDrops']):
        found.append(f'the manifest says {manifest["props"].get("serviceDrops")} serviceDrops, the file holds {len(props["serviceDrops"])}')
    return found


def faults(props, streams, manifest, roads):
    got, found = counts(props, streams, roads), []
    found += [f'{name}: {got[name]}, pinned {PINS[name]}' for name in PINS if got[name] != PINS[name]]
    said = dict(mailboxes=manifest['props']['mailboxes'], poles=manifest['props']['poles'],
                streams=manifest['streams']['count'], culverts=manifest['streams']['culverts'])
    found += [f'the manifest says {said[name]} {name}, the file holds {got[name]}' for name in said if said[name] != got[name]]
    return found + power_faults(props, roads, manifest)


read = lambda name: json.load(open(os.path.join(LAND, name)))
props, streams, manifest = read('props.json'), read('streams.json'), read('manifest.json')
roads = {r['id']: r for r in read('roads.json')['roads']}
found = faults(props, streams, manifest, roads)
assert not found, 'Judique counts: ' + '; '.join(found) + ' (a wanted change: set PINS in tools/judique-counts-check.py)'

# Mutants: one item less in each list, a frame member set free, a manifest that says another number, and power poles
# that break the rule. The manifest is kept in step with each removal, so only the pin can find it.
public_at = next(i for i, q in enumerate(props['poles']) if roads[q['road']]['kind'] <= 3)
for name, key, at in (('mailboxes', 'mailboxes', -1), ('public_poles', 'poles', public_at)):
    less = copy.deepcopy(props); del less[key][at]
    kept = copy.deepcopy(manifest); kept['props'][key] -= 1
    assert any(line.startswith(name + ':') for line in faults(less, streams, kept, roads)), f'one of the {name} gone is not found'
for name, key in (('streams', 'streams'), ('culverts', 'culverts')):
    less = copy.deepcopy(streams); less[key].pop()
    assert any(line.startswith(name + ':') for line in faults(props, less, manifest, roads)), f'one of the {name} gone is not found'
free = copy.deepcopy(props)
next(b for b in free['mailboxes'] if b['group'] is not None)['group'] = None
assert any(line.startswith('boxes_in_frames:') for line in faults(free, streams, manifest, roads)), 'a box taken out of its frame is not found'
other = copy.deepcopy(manifest); other['props']['mailboxes'] += 1
assert any('the manifest says' in line for line in faults(props, streams, other, roads)), 'a manifest with another number is not found'
named = next(r for r in roads.values() if r['kind'] == 4 and (r.get('name') or '').strip() and not r['bridge'])
unnamed = next(r for r in roads.values() if r['kind'] == 4 and not (r.get('name') or '').strip())
pole = lambda road: dict(x=road['pts'][0][0], y=road['pts'][0][1], heading=0, road=road['id'], transformer=False, light=False, n=0)
power = copy.deepcopy(props); power['poles'].append(pole(named)); power.setdefault('serviceDrops', [dict(building=0, road=named['id'], n=0)])
told = copy.deepcopy(manifest); told['props']['poles'] += 1; told['props']['serviceDrops'] = len(power['serviceDrops'])
assert not faults(power, streams, told, roads), 'a power pole on a named kind-4 road with drops must pass'
track = copy.deepcopy(power); track['poles'][-1] = pole(unnamed)
assert any('not a named kind-4 road' in line for line in faults(track, streams, told, roads)), 'a power pole on an unnamed track is not found'
dropless = copy.deepcopy(power); del dropless['serviceDrops']
assert any('without service drops' in line for line in faults(dropless, streams, told, roads)), 'power poles without drops are not found'
empty = copy.deepcopy(power); empty['serviceDrops'] = []
assert any('no service drops' in line for line in faults(empty, streams, dict(told, props=dict(told['props'], serviceDrops=0)), roads)), 'power poles with an empty drop list are not found'
unpowered = copy.deepcopy(props); unpowered.pop('serviceDrops', None)
unpowered['poles'] = [q for q in unpowered['poles'] if roads[q['road']]['kind'] <= 3]
claims = copy.deepcopy(manifest); claims['props']['poles'] = len(unpowered['poles']); claims['props']['serviceDrops'] = 5
assert any('the file has none' in line for line in faults(unpowered, streams, claims, roads)), 'a manifest with drops beside unpowered props is not found'
drops = copy.deepcopy(told); drops['props']['serviceDrops'] += 1
assert any('serviceDrops' in line for line in faults(power, streams, drops, roads)), 'a manifest with another drop count is not found'
power_poles = counts(props, streams, roads)['poles'] - PINS['public_poles']
print('Judique counts: ' + ', '.join(f'{PINS[name]} {name}' for name in PINS) + f'; {power_poles} power poles by rule'
      + ('' if 'serviceDrops' not in props else f' with {len(props["serviceDrops"])} service drops') + '; the manifest agrees; 11 mutants found, a named-road power pole passes')
