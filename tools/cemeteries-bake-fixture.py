#!/usr/bin/env python3
"""Run the real direct cemetery bake in an isolated logical root; never touch live data."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

from osgeo import osr

ROOT = Path(__file__).absolute().parent.parent


def snapshot(folder):
    return {str(p.relative_to(folder)): (p.read_bytes(), p.stat().st_mode & 0o777)
            for p in folder.rglob('*') if p.is_file()}


def run_case(parent, mutation=None, linked=None, option=False):
    with tempfile.TemporaryDirectory(prefix='bake-root-', dir=parent) as folder:
        root = Path(folder).resolve()
        (root/'pipeline').symlink_to(ROOT/'pipeline')
        baked = root/'data/baked/terrain'; baked.mkdir(parents=True)
        raw = root/'data/raw/vectors'; raw.mkdir(parents=True)
        original = {'village': [624000, 5100000], 'sentinelKey': {'owner': 'other-bake', 'count': 17}}
        (baked/'manifest.json').write_text(json.dumps(original))
        (baked/'READY').write_bytes(b'ready-sentinel')
        (baked/'sentinel.bin').write_bytes(b'leave-this-alone')
        other = root/'data/baked/areas/fixture-other'; other.mkdir(parents=True)
        (other/'READY').write_bytes(b'other-ready')
        (other/'manifest.json').write_text('{"otherArea":true}')
        roads = {'crs': 'EPSG:2961', 'roads': [
            {'id': 1, 'name': 'Fixture Square Road', 'kind': 2, 'halfWidth': 1.5,
             'pts': [[623985, 5099985], [623990, 5099990]]},
            {'id': 2, 'name': 'Fixture Sharp Road', 'kind': 3, 'halfWidth': 1.5,
             'pts': [[624190, 5099998], [624190, 5100002]]}]}
        (baked/'roads.json').write_text(json.dumps(roads))
        src, dst = osr.SpatialReference(), osr.SpatialReference()
        src.ImportFromEPSG(2961); dst.ImportFromEPSG(4326)
        for srs in (src, dst): srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
        tr = osr.CoordinateTransformation(src, dst)
        rings = [[[624000,5100000],[624040,5100000],[624040,5100040],[624000,5100040],[624000,5100000]],
                 [[624200,5100000],[624280,5100000],[624280,5100028],[624200,5100000]]]
        features = [{'type': 'Feature', 'properties': {'FEAT_DESC': 'CEMETERY polygon', 'FEAT_CODE': 'DACM40'},
                     'geometry': {'type': 'Polygon', 'coordinates': [[tr.TransformPoint(*p)[:2] for p in ring]]}}
                    for ring in rings]
        (raw/'BASE_NSTDB_10k_Designated_Areas_WM84__01_fixture.geojson').write_text(json.dumps({'type':'FeatureCollection','features':features}))
        audit = root/'audit'; audit.mkdir()
        # Observe the actual direct process, including the same-directory temporary file and rename.
        (audit/'sitecustomize.py').write_text('''import os,json,pathlib,builtins,io
_allowed=pathlib.Path(os.environ['CEMETERY_PROOF_ROOT']).resolve()
def guard(path):
 if isinstance(path,int):return
 p=pathlib.Path(path).resolve()
 if p!=_allowed and _allowed not in p.parents:raise RuntimeError('fixture blocked write outside its root')
_open=os.open
def safe_open(path,flags,*a,**kw):
 if flags & (os.O_WRONLY|os.O_RDWR|os.O_CREAT|os.O_TRUNC):guard(path)
 return _open(path,flags,*a,**kw)
os.open=safe_open
_mkdir=os.mkdir
def safe_mkdir(path,*a,**kw):
 guard(path);return _mkdir(path,*a,**kw)
os.mkdir=safe_mkdir
_builtin=builtins.open
def safe_builtin(path,mode='r',*a,**kw):
 if any(c in mode for c in 'wax+'):guard(path)
 return _builtin(path,mode,*a,**kw)
builtins.open=safe_builtin
_io=io.open
def safe_io(path,mode='r',*a,**kw):
 if any(c in mode for c in 'wax+'):guard(path)
 return _io(path,mode,*a,**kw)
io.open=safe_io
_unlink=os.unlink
def safe_unlink(path,*a,**kw):
 guard(path);return _unlink(path,*a,**kw)
os.unlink=safe_unlink
_original=os.replace
def checked(src,dst,*a,**kw):
 guard(src);guard(dst)
 p,q=pathlib.Path(src),pathlib.Path(dst)
 if q.name in ('manifest.json','cemeteries.json'):
  record={'file':q.name,'sameFolder':p.parent==q.parent,'temporary':p.name.startswith('.'+q.name+'.'),'complete':isinstance(json.loads(p.read_text()).get('cemeteries'),dict if q.name=='manifest.json' else list)}
  with open(os.environ['CEMETERY_AUDIT'],'a') as f:f.write(json.dumps(record)+'\\n')
 return _original(src,dst,*a,**kw)
os.replace=checked
''')
        env = dict(os.environ, MMM_AREA='mabou', PYTHONDONTWRITEBYTECODE='1',
                   PYTHONPATH=os.pathsep.join([str(audit), *[p for p in sys.path if p]]), CEMETERY_AUDIT=str(root/'atomic.jsonl'), CEMETERY_PROOF_ROOT=str(root))
        env.pop('AREA', None)
        entry = root/'pipeline/32_bake_cemeteries.py'
        destination = baked
        if linked == 'backup-folder':
            # The folder where the bake once kept a manifest backup, as a link to another area's live folder
            # that holds a file of the backup's name. The bake writes into the area's own folder only.
            (other/'mabou.json').write_text('{"otherArea":true}')
            (root/'data/work/map-data/cemeteries').mkdir(parents=True)
            (root/'data/work/map-data/cemeteries/manifest-backups').symlink_to(other, target_is_directory=True)
        # The bake has no output option any more. An old command that still names a work folder must stop,
        # and must not bake into the live folder.
        extra = ['--out', str(root/'data/work/bakes/cemeteries/mabou')] if option else []
        command = [sys.executable, str(entry), *extra]
        if mutation:
            source = entry.read_text()
            if mutation == 'forbidden-write':
                anchor = "    cemeteries.sort(key=lambda c: c['id'])"
                assert anchor in source
                source = source.replace(anchor, "    (area.output / 'sentinel.bin').write_bytes(b'forbidden')\n"+anchor)
            elif mutation == 'non-atomic':
                assert 'os.replace(tmp, path)' in source
                source = source.replace('os.replace(tmp, path)', '__import__("shutil").copyfile(tmp, path)')
            elif mutation == 'cemeteries-in-place':
                # The cemetery file written in place, without the temporary file and the rename.
                anchor = "atomic_json(area.output / 'cemeteries.json', "
                assert source.count(anchor) == 1
                source = source.replace(anchor, "(lambda path, data: path.write_text(json.dumps(data)))(area.output / 'cemeteries.json', ")
            elif mutation == 'ignores-arguments':
                anchor = 'parser.parse_args()'
                assert source.count(anchor) == 1
                source = source.replace(anchor, 'parser.parse_known_args()')
            elif mutation == 'boundary-length':
                anchor = 'return max(0.0, math.dist(pts[0], pts[-1]) - WALL_THICKNESS)'
                assert anchor in source
                source = source.replace(anchor, 'return gap.Length()')
            else:
                raise ValueError(mutation)
            # Keep the logical entry identity, even for the deliberately changed production source.
            runner = "import sys;sys.path.insert(0,sys.argv[1]);__file__=sys.argv[2];sys.argv=[__file__,*sys.argv[3:]];exec(compile(sys.stdin.read(),__file__,'exec'))"
            command = [sys.executable, '-c', runner, str(root/'pipeline'), str(entry), *extra]
        before = snapshot(root/'data')
        process = subprocess.Popen(command, cwd=root, env=env, stdin=subprocess.PIPE if mutation else subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if mutation:
            process.stdin.write(source); process.stdin.close(); process.stdin = None
        partial = []
        while process.poll() is None:
            try: json.loads((destination/'manifest.json').read_text())
            except (ValueError, FileNotFoundError) as error: partial.append(str(error))
            # The cemetery file does not exist before its first bake; when it exists a reader must get whole JSON.
            try: json.loads((destination/'cemeteries.json').read_text())
            except FileNotFoundError: pass
            except ValueError as error: partial.append('cemeteries.json: '+str(error))
            time.sleep(0.002)
        stdout, stderr = process.communicate()
        if option:
            assert process.returncode == 2 and snapshot(root/'data') == before, \
                f'a command with the removed --out option was not refused: exit {process.returncode}'
            return None
        if process.returncode:
            raise AssertionError(f'bake exit {process.returncode}: {stdout}\n{stderr}')
        after = snapshot(root/'data')
        allowed = {'baked/terrain/cemeteries.json', 'baked/terrain/manifest.json'}
        changed = {key for key in before.keys() | after.keys() if before.get(key) != after.get(key)}
        assert changed <= allowed, f'forbidden baked writes: {changed-allowed}'
        assert json.loads((destination/'manifest.json').read_text()) == {**original, 'cemeteries': {'file':'cemeteries.json','count':2}}
        assert not partial, f'partial manifest observed: {partial[:2]}'
        records = [json.loads(line) for line in (root/'atomic.jsonl').read_text().splitlines()] if (root/'atomic.jsonl').exists() else []
        assert all(all(r.values()) for r in records) and sorted(r['file'] for r in records) == ['cemeteries.json', 'manifest.json'], \
            'cemeteries.json and manifest.json must each use complete temporary JSON and one same-folder os.replace'
        return {'cemeteries':json.loads((destination/'cemeteries.json').read_text())['cemeteries'], 'roads':roads['roads']}


def main():
    osr.UseExceptions()
    parser=argparse.ArgumentParser(); parser.add_argument('--out',required=True); parser.add_argument('--mutations',action='store_true');args=parser.parse_args()
    out=Path(args.out).resolve(); out.parent.mkdir(parents=True,exist_ok=True)
    good=run_case(out.parent)
    print('PASS direct bake filesystem: only cemetery file/key changed; READY and sentinels survived; both files by a complete same-folder temporary rename; no partial reader JSON')
    assert run_case(out.parent, linked='backup-folder') == good
    print('PASS bake with the old backup folder linked into another area: only the cemetery file and key of this area changed')
    run_case(out.parent, option=True)
    print('PASS a command with the removed --out option: refused (exit 2), nothing written')
    result={'good':good}
    if args.mutations:
        for name in ('forbidden-write', 'non-atomic', 'cemeteries-in-place', 'ignores-arguments'):
            try: run_case(out.parent, name, option=name == 'ignores-arguments')
            except AssertionError as error:
                markers = {'forbidden-write': ['forbidden baked writes'], 'ignores-arguments': ['was not refused'],
                           'non-atomic': ['partial manifest observed', 'must each use complete temporary JSON'],
                           # A reader can also get the half-written file itself: that catches the in-place write too.
                           'cemeteries-in-place': ['must each use complete temporary JSON', "partial manifest observed: ['cemeteries.json: "]}[name]
                assert any(marker in str(error) for marker in markers), f'mutation failed for the wrong reason: {error}'
                print(f'PASS bake mutation: {name} rejected by its write-boundary assertion')
            else: raise AssertionError(f'mutation survived: {name}')
        result['boundaryLength']=run_case(out.parent,'boundary-length')
    out.write_text(json.dumps(result))


if __name__=='__main__': main()
