"""Portable check bake. Standard data links locate the shared work root; missing data is rebuilt."""
import contextlib,fcntl,hashlib,json,os,sys
from pathlib import Path


AREAS=('mabou','judique','porthood','westbay','pointtupper','cansocauseway')


def cache_key(repo, data):
    """Content key, including every baked dependency and prospective tree audit tile.

    All manifest tree tiles are included: a road/building/recipe edit may move the
    pavement into a previously unaudited tile. Heights remain in the full input
    audit, rather than re-reading gigabytes on every runtime check.
    """
    repo,data=Path(repo),Path(data)
    files=sorted([*repo.glob('pipeline/paved*.*'),repo/'pipeline/areas.py',repo/'pipeline/32_bake_paved.py',repo/'pipeline/hand_sites.py',repo/'tools/paved-sites.mjs',*repo.glob('web/src/*site.ts'),*repo.glob('web/src/quarry*.ts')])
    h=hashlib.sha256()
    def add(path,relative):
        h.update(relative.encode()+b'\0')
        with path.open('rb') as source:
            while block:=source.read(1024*1024):h.update(block)
        h.update(b'\0')
    for p in files:
        if p.is_file():add(p,p.relative_to(repo).as_posix())
    baked=set()
    for area in AREAS:
        folder=data/('data/baked/terrain' if area=='mabou' else f'data/baked/areas/{area}')
        manifest=folder/'manifest.json'
        doc=json.loads(manifest.read_text())
        baked.update((manifest,folder/'roads.json',folder/doc['buildings']['file']))
        baked.update(folder/f"{doc['trees']['level']}/{name}.t.bin" for name in doc['trees']['tiles'])
    # The shared site exporter also reads these three Mabou catalogs.
    baked.update(data/f'data/baked/terrain/{name}.json' for name in ('manifest','roads','buildings'))
    for p in sorted(baked):add(p,p.relative_to(data).as_posix())
    return h.hexdigest()


def ensure(repo=None):
    repo=Path(repo or Path(__file__).absolute().parents[1])
    areas=AREAS
    def complete(work):
        for area in areas:
            index=work/area/'paved/index.json'
            if not (work/area/'bake.json').exists() or not index.exists():return False
            try:tiles=json.loads(index.read_text())['tiles']
            except (KeyError,ValueError):return False
            if not all((index.parent/name).is_file() for name in tiles):return False
        return True
    if os.environ.get('PAVED_WORK'):
        work=Path(os.environ['PAVED_WORK'])
        if not complete(work):raise RuntimeError('Explicit PAVED_WORK is missing a bake')
        return work
    data=(repo/'data/baked').resolve().parent.parent
    if not (data/'data/baked/terrain/manifest.json').exists():raise RuntimeError('Standard data/baked link is required; no bake was checked')
    key=cache_key(repo,data)
    parent=data/'data/work/bakes/paved-open-checks';parent.mkdir(parents=True,exist_ok=True)
    work=parent/key[:20]
    with (parent/'.lock').open('w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        if (work/'complete.json').exists() and not complete(work):raise RuntimeError('Incomplete work bake; no data was checked')
        if not (work/'complete.json').exists():
            from areas import AREAS as area_configs
            from paved import bake
            # A failed partial build is ours and may be retried; never mark it complete.
            if work.exists():
                import shutil;shutil.rmtree(work)
            with contextlib.redirect_stdout(sys.stderr):
                for area in area_configs.values():bake(data,data/'data/raw/paved-open/ty4r-gcnk',work/area.id,area,data/'data/raw/paved-open/corrections.json')
            (work/'complete.json').write_text(json.dumps(dict(recipe=key,areas=list(area_configs)))+'\n')
    return work


if __name__=='__main__':print(ensure())
