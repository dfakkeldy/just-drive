#!/usr/bin/env python3
"""Real local Git/rsync transport, fake SSH, and in-memory safety mutants."""
import contextlib
import csv
import fcntl
import hashlib
import io
import os
from pathlib import Path
import shlex
import signal
import subprocess
import sys
import shutil
import tempfile
import threading
import time
import types

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {name: (ROOT/'tools'/name).read_text() for name in ('remote_runner.py', 'remote_runner_host.py')}


def module(name, source=None):
    obj = types.ModuleType(name.removesuffix('.py'))
    obj.__file__ = str(ROOT/'tools'/name)
    exec(compile(source or SOURCES[name], obj.__file__, 'exec'), obj.__dict__)
    return obj


def git(root, *args):
    return subprocess.run(['git', '-C', str(root), *args], check=True, capture_output=True, text=True)


def commit(root, message):
    git(root, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', '-c', 'user.name=Fixture',
        '-c', 'user.email=test@example.invalid', 'commit', '-qm', message)


def host_code(source, args):
    return 'import sys;sys.argv='+repr(['remote_runner_host.py', *args])+';'+source


def fixture(root):
    (root/'tools').mkdir(parents=True)
    (root/'web').mkdir()
    (root/'data/baked').mkdir(parents=True)
    (root/'data/audio/out').mkdir(parents=True)
    (root/'data/baked/land').write_text('land')
    (root/'data/baked/unchanged').write_text('shared bytes')
    (root/'data/audio/out/radio').write_text('own audio')
    (root/'data/raw/paved-open').mkdir(parents=True)
    (root/'data/raw/paved-open/corrections.json').write_text('{"version":1}')
    (root/'data/raw/private-survey.tif').write_text('raw data that never travels')
    (root/'.gitignore').write_text('data\nnode_modules\nreference\n')
    (root/'web/package.json').write_text('{"name":"fixture","version":"1.0.0"}')
    (root/'web/package-lock.json').write_text('{"name":"fixture","version":"1.0.0","lockfileVersion":3,"packages":{"":{"name":"fixture","version":"1.0.0"}}}')
    for name in ('old.txt', 'deleted.txt', 'target.txt'):
        (root/name).write_text(name)
    (root/'tracked-link').symlink_to('target.txt')
    (root/'docs').mkdir()
    (root/'docs/x.md').write_text('private fixture')
    (root/'reference').mkdir()
    (root/'reference/private.txt').write_text('denied fixture')
    (root/'tools/check-all.py').write_text('''import sys
if '--plan' in sys.argv:
 print('start-up proofs not run (no starter changed); use --full')
 if 'uncovered.bin' in sys.argv: print('NO CHECK COVERS uncovered.bin')
 args=sys.argv[1:]; rows=['tsc','ok','mac','unknown']
 if '--only' in args:
  rows=args[args.index('--only')+1:]; rows=rows[:next((i for i,x in enumerate(rows) if x.startswith('--')),len(rows))]
 for row in rows: print('PLAN '+row)
 sys.exit(2 if 'uncovered.bin' in args else 0)
if '--list' in sys.argv:
 print('start-up proofs not run (no starter changed); use --full')
 if 'uncovered.bin' in sys.argv: print('NO CHECK COVERS uncovered.bin')
 print('check | mode | timeout seconds | last seconds | command')
 args=sys.argv[1:]; rows=['tsc','ok','mac','unknown']
 if '--only' in args:
  rows=args[args.index('--only')+1:]; rows=rows[:next((i for i,x in enumerate(rows) if x.startswith('--')),len(rows))]
 for row in rows: print(row+' | node | 600 | 0 | fixture')
 print('Ignored helpers: fixture')
 sys.exit(2 if 'uncovered.bin' in args else 0)
''')
    (root/'tools/check-all.sh').write_text('''#!/bin/bash
printf '%s\\n' "$*" > only-args
if [ -f sleep-mode ]; then
 exec python3 -c 'import os,signal,time;from pathlib import Path;Path("pid").write_text(str(os.getpid()));signal.signal(signal.SIGTERM,lambda *_:(Path("terminated").touch(),exit(130)));print("sleeping",flush=True);time.sleep(60)'
fi
if [ -f evidence-mode ]; then
 mkdir -p data/work/checks/checks-proof
 echo failure > data/work/checks/checks-proof/log
 echo "Evidence kept at $PWD/data/work/checks/checks-proof"
 exit 1
fi
printf 'check | result | exit code | seconds | first failing line\\n'
echo 'ok | PASS | 0 | 0.01 |'
exit 0
''')
    (root/'tools/check-all.sh').chmod(0o755)
    (root/'tools/checks-hosts.tsv').write_text('name\twhere\tsoftware\tevidence\nmac\tmac-only\tno\tpixel pin\napple\tapple\tno\tApple silicon proof\nunknown\tunproven\tno\tunmeasured\n')
    (root/'tools/remote-hosts.tsv').write_text('alias\ttrust\nfake\town\n')
    # Install source on each session just as the real checkout does.
    (root/'tools/remote_runner_host.py').write_text(SOURCES['remote_runner_host.py'])
    git(root, 'init', '-q')
    git(root, 'add', '.gitignore', 'tools', 'web', 'old.txt', 'deleted.txt', 'target.txt', 'tracked-link')
    git(root, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', '-c', 'user.name=Fixture', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture')
    git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
    (root/'untracked.txt').write_text('not indexed')
    (root/'staged.txt').write_text('staged')
    git(root, 'add', 'staged.txt')
    git(root, 'add', '-f', 'reference/private.txt')
    (root/'deleted.txt').unlink()


def allowlist(m, root):
    files = m.index_files(root)
    assert 'staged.txt' in files and 'tracked-link' in files
    assert not {'untracked.txt', 'deleted.txt', 'docs/x.md', 'reference/private.txt'} & set(files), files
    assert not m.allowed_path('a/../secret')
    return files


def stale(m, base):
    dest = base/'stale'
    dest.mkdir()
    (dest/'obsolete.py').write_text('stale')
    (dest/'current.py').write_text('current')
    (dest/'data').mkdir()
    (dest/'data/keep').touch()
    (dest/'web').mkdir()
    (dest/'web/node_modules').symlink_to(base)
    (dest/'web/.vite').mkdir()
    (dest/'web/.vite/cache').touch()
    (dest/'.git').write_text('worktree')
    m.clean_checkout(dest, ['current.py'])
    assert not (dest/'obsolete.py').exists(), 'stale file survived'
    assert (dest/'current.py').exists() and (dest/'data/keep').exists()
    assert (dest/'web/node_modules').is_symlink() and (dest/'web/.vite/cache').exists()


def refusal(m):
    hosts = {'mac': {'where':'mac-only','evidence':'pixel pin'}, 'apple': {'where':'apple','evidence':'Apple silicon proof'}, 'unknown': {'where':'unproven','evidence':'pending'}}
    with contextlib.redirect_stdout(io.StringIO()) as out:
        rows, refused = m.filter_rows(['tsc','mac','apple','unknown'], hosts, 'Linux', False)
    assert rows == ['tsc'] and refused and 'REFUSED mac:' in out.getvalue() and 'REFUSED apple:' in out.getvalue()
    assert 'not yet proven on this host' in out.getvalue()
    with contextlib.redirect_stdout(io.StringIO()):
        assert m.filter_rows(['mac','apple','unknown'], hosts, 'Linux', True, 'x86_64') == (['unknown'], True)
        assert m.filter_rows(['apple'], hosts, 'Linux', True, 'arm64') == ([], True)
        assert m.filter_rows(['mac','apple','unknown'], hosts, 'Darwin', False, 'arm64') == (['mac','apple','unknown'], False)
        assert m.filter_rows(['mac','apple','unknown'], hosts, 'Darwin', True, 'x86_64') == (['mac','unknown'], True)
        assert m.filter_rows(['apple'], hosts, 'Darwin', True) == ([], True)


def verdicts(m):
    for code in (0,1,2,130,255):
        for refused in (False,True):
            for uncovered in (False,True):
                expected = 130 if code == 130 else 1 if code == 1 else 2 if code or refused or uncovered else 0
                assert m.exit_code(code,refused,uncovered) == expected, (code,refused,uncovered)
                assert m.exit_code(code,refused,uncovered,True) == 130


def evidence_guard(m, base):
    root = base/'guard'
    inside = root/'checkouts/test/data/work/checks/checks-good'
    outside = root/'checks-outside'
    for path in (inside, outside):
        path.mkdir(parents=True)
        (path/'log').write_text('evidence')
    m.remove_evidence(root, 'test', outside)
    assert outside.exists(), 'outside evidence deleted'
    # A symlink that looks safe must not grant deletion outside the owned tree.
    escaped = inside.parent/'checks-escape'
    escaped.symlink_to(outside, target_is_directory=True)
    m.remove_evidence(root, 'test', escaped)
    assert outside.exists() and escaped.is_symlink()
    m.remove_evidence(root, 'test', inside)
    assert not inside.exists()
    # A symlinked parent folder must not make an outside checks-* folder look owned.
    other = base/'guard-parent'
    external = base/'external/checks/checks-x'
    external.mkdir(parents=True)
    (external/'log').write_text('outside evidence')
    (other/'checkouts/test/data/work').mkdir(parents=True)
    (other/'checkouts/test/data/work/checks').symlink_to(external.parent, target_is_directory=True)
    m.remove_evidence(other, 'test', other/'checkouts/test/data/work/checks/checks-x')
    assert external.exists(), 'evidence deleted through a symlinked parent folder'



def snapshot_and_settings(m, base):
    root=base/'snapshots'
    (root/'shared').mkdir(parents=True)
    dest=root/'checkouts/test/data'
    dest.mkdir(parents=True)
    old=root/'shared/baked-old';old.mkdir()
    unused=root/'shared/baked-unused';unused.mkdir()
    newest=root/'shared/baked-new';newest.mkdir()
    for index,path in enumerate((old,unused,newest)):
        os.utime(path,ns=(index+1,index+1))
    plan=m.stage_snapshot(root,'baked','next')
    assert plan['needed'] and plan['link_dest']==str(newest)
    m.prune(root,'baked')
    assert not old.exists() and unused.exists() and newest.exists(), 'prune keeps the two most recently used'
    assert m.stage_snapshot(root,'baked','new')=={'needed':False}
    try: m.host_env(root)
    except ValueError as error: assert 'host not set up: ' in str(error)
    else: raise AssertionError('missing host.env accepted')
    (root/'host.env').write_text('MMM_BROWSER_SLOTS=1\nPATH_PREPEND=/fixture/bin\nSECRET_FIXTURE=never-export\n')
    env=m.host_env(root)
    assert env['MMM_BROWSER_SLOTS']=='1' and env['PATH'].startswith('/fixture/bin'+os.pathsep)
    assert 'SECRET_FIXTURE' not in env


def farm_test(m, base):
    """Published snapshot files are read-only; each checkout gets its own folders of hard links."""
    root = base/'farm'
    staged = root/'shared/baked-fp1.partial'
    (staged/'terrain').mkdir(parents=True)
    (staged/'terrain/tile').write_text('shared bytes')
    target = m.publish(root, 'baked', 'fp1')
    assert target == root/'shared/baked-fp1' and not staged.exists()
    farm = root/'checkouts/a/data/baked'
    m.farm(target, farm, 'fp1')
    tile = farm/'terrain/tile'
    assert farm.is_dir() and not farm.is_symlink() and tile.stat().st_ino == (target/'terrain/tile').stat().st_ino
    assert not os.access(tile, os.W_OK), 'a check can write shared snapshot bytes'
    try:
        tile.write_text('changed')
    except PermissionError:
        pass
    else:
        raise AssertionError('write through a checkout changed the shared snapshot')
    (farm/'terrain/extra').write_text('own')  # folders are the checkout's own
    assert not (target/'terrain/extra').exists()
    m.farm(target, farm, 'fp1')
    assert (farm/'terrain/extra').exists(), 'same snapshot rebuilt the farm'
    shutil.rmtree(target)
    assert tile.read_text() == 'shared bytes', 'pruning took files from a checkout'
    real = root/'checkouts/b/data/baked'
    real.mkdir(parents=True)
    try:
        m.farm(root/'shared', real, 'fp1')
    except ValueError:
        pass
    else:
        raise AssertionError('host-owned folder replaced')


def symlink_parent(m, base):
    root = base/'parent-link'
    (root/'pkg').mkdir(parents=True)
    (root/'pkg/a.txt').write_text('tracked')
    git(root, 'init', '-q')
    git(root, 'add', 'pkg/a.txt')
    outside = base/'outside-secret'
    outside.mkdir()
    (outside/'a.txt').write_text('private bytes')
    shutil.rmtree(root/'pkg')
    (root/'pkg').symlink_to(outside, target_is_directory=True)
    try:
        m.index_files(root)
    except ValueError as error:
        assert 'symlinked folder' in str(error)
    else:
        raise AssertionError('tracked names under a symlinked folder accepted')


def history(m, base):
    """A private file committed once and deleted later must not reach the host through git."""
    root = base/'history'
    root.mkdir()
    git(root, 'init', '-q')
    (root/'a.txt').write_text('allowed')
    git(root, 'add', 'a.txt')
    commit(root, 'allowed')
    clean = git(root, 'rev-parse', 'HEAD').stdout.strip()
    git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
    (root/'docs').mkdir()
    (root/'docs/secret.md').write_text('private history')
    git(root, 'add', '-f', 'docs/secret.md')
    commit(root, 'private')
    blob = git(root, 'rev-parse', 'HEAD:docs/secret.md').stdout.strip()
    git(root, 'rm', '-q', '--cached', 'docs/secret.md')
    commit(root, 'removed')
    bare = base/'history.git'
    git(base, 'init', '-q', '--bare', str(bare))
    try:
        m.push(root, str(bare), 'id')
    except ValueError as error:
        assert 'private path (docs' in str(error), error
    else:
        raise AssertionError('history with a private path pushed')
    assert subprocess.run(['git', '--git-dir', str(bare), 'cat-file', '-e', blob], capture_output=True).returncode, \
        'private blob reached the host'
    git(root, 'checkout', '-q', '--detach', clean)
    m.push(root, str(bare), 'id')
    assert git(base, '--git-dir', str(bare), 'rev-parse', 'refs/mmm/id').stdout.strip() == clean
    # A replacement ref must not show the check a clean commit while the push sends the private original.
    git(root, 'checkout', '-q', '--detach', 'HEAD@{1}')
    private = git(root, 'rev-parse', 'HEAD~1').stdout.strip()
    git(root, 'replace', private, clean)
    try:
        m.push(root, str(bare), 'id')
    except ValueError as error:
        assert 'private path (docs' in str(error), error
    else:
        raise AssertionError('replacement ref hid private history from the check')
    assert subprocess.run(['git', '--git-dir', str(bare), 'cat-file', '-e', blob], capture_output=True).returncode, \
        'private blob reached the host through a replacement ref'
    git(root, 'replace', '-d', private)
    git(root, 'checkout', '-q', '--detach', clean)
    grafts = Path(git(root, 'rev-parse', '--absolute-git-dir').stdout.strip())/'info/grafts'
    grafts.parent.mkdir(exist_ok=True)
    grafts.write_text(clean+'\n')
    try:
        m.push(root, str(bare), 'id')
    except ValueError as error:
        assert 'grafts' in str(error)
    else:
        raise AssertionError('grafts accepted')
    grafts.unlink()
    # rev-list names no path for an object a ref points at directly, so a ref to a blob must be refused.
    (root/'docs/ref-only.md').write_text('private bytes behind a ref')
    loose = git(root, 'hash-object', '-w', 'docs/ref-only.md').stdout.strip()
    git(root, 'update-ref', 'refs/remotes/origin/main', loose)
    try:
        m.push(root, str(bare), 'id')
    except ValueError as error:
        assert 'not a commit' in str(error), error
    except subprocess.CalledProcessError as error:
        raise AssertionError('a ref naming a blob reached git push (refused there by ^{commit} only)') from error
    else:
        raise AssertionError('a ref naming a blob pushed')
    assert subprocess.run(['git', '--git-dir', str(bare), 'cat-file', '-e', loose], capture_output=True).returncode, \
        'a blob named by a ref reached the host'
    git(root, 'update-ref', 'refs/remotes/origin/main', clean)
    # A ref named HEAD under refs/ wins over .git/HEAD in a push refspec: the push must send the commit checked.
    assert git(root, 'rev-parse', 'HEAD').stdout.strip() == clean
    for ref, target in (('refs/heads/HEAD', private), ('refs/tags/HEAD', loose), ('refs/remotes/HEAD', private)):
        git(root, 'update-ref', ref, target)
        m.push(root, str(bare), 'id')
        assert git(base, '--git-dir', str(bare), 'rev-parse', 'refs/mmm/id').stdout.strip() == clean
        for leaked in (blob, loose):
            assert subprocess.run(['git', '--git-dir', str(bare), 'cat-file', '-e', leaked],
                                  capture_output=True).returncode, f'a ref named {ref} sent unchecked bytes'
        git(root, 'update-ref', '-d', ref)
    # A ref named after the checked id itself wins over the id as a push source, on either side of the push.
    for ref in ('refs/heads/'+clean, 'refs/tags/'+clean, 'refs/'+clean, 'refs/remotes/'+clean):
        git(root, 'update-ref', ref, private)
        m.push(root, str(bare), 'id')
        for sent in ('refs/mmm/id', 'refs/remotes/origin/main'):
            assert git(base, '--git-dir', str(bare), 'rev-parse', sent).stdout.strip() == clean, f'{ref} took {sent}'
        assert subprocess.run(['git', '--git-dir', str(bare), 'cat-file', '-e', blob], capture_output=True).returncode, \
            f'a ref named {ref} sent unchecked bytes'
        git(root, 'update-ref', '-d', ref)
    # push.followTags would also send tags (and their messages) that point into the checked history.
    git(root, 'config', 'push.followTags', 'true')
    git(root, '-c', 'user.name=Fixture', '-c', 'user.email=test@example.invalid', 'tag', '-a', '-m', 'private note',
        'note', clean)
    m.push(root, str(bare), 'id')
    assert not git(base, '--git-dir', str(bare), 'tag', '--list').stdout.strip(), 'a tag was pushed'
    git(root, 'tag', '-d', 'note')
    git(root, 'config', '--unset', 'push.followTags')
    # Commits that checks read with git show live on origin/fixture/<7 hex>: they reach the host, checked like HEAD.
    side = git(root, '-c', 'user.name=Fixture', '-c', 'user.email=test@example.invalid', 'commit-tree',
               clean+'^{tree}', '-p', clean, '-m', 'fixture').stdout.strip()
    git(root, 'update-ref', 'refs/remotes/origin/fixture/abc1234', side)
    git(root, 'update-ref', 'refs/remotes/origin/fixture/notes', side)
    m.push(root, str(bare), 'id')
    assert git(base, '--git-dir', str(bare), 'rev-parse', 'refs/remotes/origin/fixture/abc1234').stdout.strip() == side
    assert subprocess.run(['git', '--git-dir', str(bare), 'rev-parse', '--verify', '-q', 'refs/remotes/origin/fixture/notes'],
                          capture_output=True).returncode, 'a fixture ref of another shape was pushed'
    git(root, 'update-ref', 'refs/remotes/origin/fixture/abc1234', private)
    try:
        m.push(root, str(bare), 'id')
    except ValueError as error:
        assert 'private path (docs' in str(error) and 'fixture ref refs/remotes/origin/fixture/abc1234' in str(error), error
    else:
        raise AssertionError('a fixture ref with private history pushed')
    assert subprocess.run(['git', '--git-dir', str(bare), 'cat-file', '-e', blob], capture_output=True).returncode, \
        'private blob reached the host through a fixture ref'
    for ref in ('abc1234', 'notes'):
        git(root, 'update-ref', '-d', 'refs/remotes/origin/fixture/'+ref)
    # The same folder at an allowed path, then at docs/, then back: rev-list names its objects only once.
    moved = base/'history-moved'
    (moved/'allowed').mkdir(parents=True)
    git(moved, 'init', '-q')
    (moved/'allowed/file').write_text('same bytes')
    git(moved, 'add', 'allowed')
    commit(moved, 'allowed')
    git(moved, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
    (moved/'docs').mkdir()
    git(moved, 'mv', 'allowed/file', 'docs/file')
    commit(moved, 'into docs')
    git(moved, 'mv', 'docs/file', 'allowed/file')
    commit(moved, 'back')
    try:
        m.push(moved, str(bare), 'moved')
    except ValueError as error:
        assert 'private path (docs/file)' in str(error), error
    else:
        raise AssertionError('a private path hidden behind an allowed copy of the same object was pushed')


def casefold(m, base):
    """The Mac's file system ignores case: with core.ignorecase, `git add DOCS/secret.md` stores DOCS/secret.md even
    though the bytes live in docs/. No case (or Unicode) spelling of a private folder may be sent, from the index or
    from history."""
    for name in ('DOCS/secret.md', 'Docs/secret.md', 'Reference/secret.md', 'DATA/work/secret.md', 'ＤＯＣＳ/secret.md',
                 'doc\u017f/secret.md', 'Node_Modules/x', 'WEB/node_modules/x', 'DOCS', '.Wrangler/x'):
        assert not m.allowed_path(name), name
    for name in ('tools/docs/x.md', 'docsfoo/x', 'web/x.js'):
        assert m.allowed_path(name), name
    # HFS+ ignores invisible format characters in names (git's CVE-2014-9390).
    for name in ('do\u200ccs/secret.md', '\ufeffdocs/x', 'refer\u200dence/x', 'da\u206ata/x'):
        assert not m.allowed_path(name), ascii(name)
    # Canonically equal spellings (APFS joins NFC and NFD names) fold to one key.
    assert m.fold('Caf\u00e9') == m.fold('cafe\u0301') == m.fold('CAFE\u0301')
    bare = base/'casefold.git'
    git(base, 'init', '-q', '--bare', str(bare))
    for index, folder in enumerate(('DOCS', 'Docs', 'Reference', 'DATA')):
        root = base/f'casefold-{index}'
        root.mkdir()
        git(root, 'init', '-q')
        (root/'a.txt').write_text('allowed')
        git(root, 'add', 'a.txt')
        commit(root, 'allowed')
        clean = git(root, 'rev-parse', 'HEAD').stdout.strip()
        git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
        name = folder+'/secret.md'
        (root/folder).mkdir()
        (root/name).write_text('private '+folder)
        git(root, 'add', '-f', name)
        assert git(root, 'ls-files', folder).stdout.split() == [name]
        files = m.index_files(root)
        assert name not in files and 'a.txt' in files, files
        commit(root, 'private under '+folder)
        blob = git(root, 'rev-parse', 'HEAD:'+name).stdout.strip()
        git(root, 'rm', '-q', '--cached', name)
        commit(root, 'removed')
        try:
            m.push(root, str(bare), f'cf{index}')
        except ValueError as error:
            assert f'private path ({folder}' in str(error), error
        else:
            raise AssertionError(f'history holding {name} pushed')
        assert subprocess.run(['git', '--git-dir', str(bare), 'cat-file', '-e', blob], capture_output=True).returncode, \
            f'{name} reached the host'
        git(root, 'checkout', '-q', '--detach', clean)
        m.push(root, str(bare), f'cf{index}')
    # The reported case, where the file system ignores case: the folder on disk is docs/, the index says DOCS/.
    root = base/'casefold-disk'
    (root/'docs').mkdir(parents=True)
    (root/'docs/secret.md').write_text('private docs')
    if (root/'DOCS/secret.md').is_file():
        git(root, 'init', '-q')
        git(root, '-c', 'core.ignorecase=true', 'add', '-f', 'DOCS/secret.md')
        assert git(root, 'ls-files').stdout.split() == ['DOCS/secret.md']
        assert m.index_files(root) == [], m.index_files(root)
        commit(root, 'DOCS on a case-insensitive disk')
        try:
            m.history_check(root, ['HEAD'])
        except ValueError as error:
            assert 'private path (DOCS' in str(error), error
        else:
            raise AssertionError('DOCS/secret.md on a case-insensitive disk passed the history check')


def changed_merge(m):
    assert m.with_changed(['--quick', '--for', 'a', '--changed'], []) == ['--quick', '--for', 'a']
    assert m.with_changed(['--for', 'a', 'b', '--changed', '--quick'], ['b', 'c']) == ['--quick', '--for', 'a', 'b', 'c']
    assert m.with_changed(['--changed'], []) == ['--for', 'README.md']


def fresh_host(m, base):
    """A new host with no snapshots still sets up its shared npm folder."""
    root = base/'fresh'
    dest = root/'checkouts/test'
    (dest/'web').mkdir(parents=True)
    bin_dir = base/'fresh-bin'
    bin_dir.mkdir()
    (bin_dir/'npm').write_text('#!/bin/sh\nmkdir -p node_modules\n')
    (bin_dir/'npm').chmod(0o755)
    (root/'host.env').write_text('PATH_PREPEND='+str(bin_dir)+'\n')
    (dest/'web/package.json').write_text('{}')
    (dest/'web/package-lock.json').write_text('{}')
    git(dest, 'init', '-q')
    git(dest, 'add', 'web')
    commit(dest, 'fixture')
    git(dest, 'update-ref', 'refs/mmm/test', 'HEAD')
    try:
        m.prepare(root, 'test', ['web/package.json', 'web/package-lock.json'], 'no', 'no')
    except OSError as error:
        raise AssertionError(f'fresh host setup failed: {error}')
    assert (dest/'web/node_modules').is_symlink() and (root/'shared').is_dir()


def snapshot_root(m, base):
    # Mixed case in the root itself: a check that folds only one side of the comparison must fail here.
    root = base/'SnapRoot'
    leak = root/'data/work/leak/data/baked'
    leak.mkdir(parents=True)
    (leak/'still.png').write_text('private still')
    assert m.snapshot_source(root, 'baked') is None
    (root/'data/baked').symlink_to(leak, target_is_directory=True)
    for case in ('inside data/work', 'not a baked folder'):
        try:
            m.snapshot_source(root, 'baked')
        except ValueError:
            pass
        else:
            raise AssertionError('snapshot root accepted: '+case)
        (root/'data/baked').unlink()
        (root/'data/baked').symlink_to(root/'data/work', target_is_directory=True)
    (root/'data/baked').unlink()
    # resolve() keeps the case a symlink spells; on a case-insensitive disk DATA/WORK is data/work.
    variant = root/'DATA/WORK/leak/data/baked'
    variant.mkdir(parents=True, exist_ok=True)
    (root/'data/baked').symlink_to(variant, target_is_directory=True)
    try:
        m.snapshot_source(root, 'baked')
    except ValueError as error:
        assert 'private data/work' in str(error), error
    else:
        raise AssertionError('snapshot root accepted: inside DATA/WORK')
    # The folded spelling refuses on its own too, where identity cannot be read (a stat that fails is no match).
    identity = m.inside
    m.inside = lambda *_: False
    try:
        m.snapshot_source(root, 'baked')
    except ValueError as error:
        assert 'private data/work' in str(error), error
    else:
        raise AssertionError('snapshot root accepted by spelling alone: inside DATA/WORK')
    finally:
        m.inside = identity
    (root/'data/baked').unlink()
    # A private folder inside the snapshot: a symlinked docs/ there, by its plain and by its firmlink spelling.
    around = base/'SnapAround'
    (around/'data/baked/inner').mkdir(parents=True)
    for link, alone in ((around/'data/baked/inner', False), (around/'data/baked/inner', True),
                        (Path('/System/Volumes/Data'+str(around/'data/baked/inner')), False)):
        if sys.platform != 'darwin' and str(link).startswith('/System/'):
            continue
        with contextlib.suppress(FileNotFoundError):
            (around/'docs').unlink()
        (around/'docs').symlink_to(link, target_is_directory=True)
        identity = m.inside
        if alone:
            m.inside = lambda *_: False
        try:
            m.snapshot_source(around, 'baked')
        except ValueError as error:
            assert 'private docs' in str(error), error
        else:
            raise AssertionError(f'snapshot holding private docs/ accepted ({link}, spelling alone: {alone})')
        finally:
            m.inside = identity
    # A firmlink spelling of the same folder: resolve() keeps it, so only a comparison by identity sees data/work.
    firm = Path('/System/Volumes/Data'+str(root/'data/work/leak/data/baked'))
    if sys.platform == 'darwin':
        assert firm.is_dir(), firm
        (root/'data/baked').symlink_to(firm, target_is_directory=True)
        try:
            m.snapshot_source(root, 'baked')
        except ValueError as error:
            assert 'private data/work' in str(error), error
        else:
            raise AssertionError('snapshot root accepted: data/work through the /System/Volumes/Data firmlink')
    worktree = base/'snap-worktree'
    worktree.mkdir()
    (worktree/'data').symlink_to(base/'snap-main/data', target_is_directory=True)
    (base/'snap-main/data/baked').mkdir(parents=True)
    assert m.snapshot_source(worktree, 'baked') == (base/'snap-main/data/baked').resolve()


def snapshot_worktree(m, base):
    """A worktree's snapshot may link into the main checkout's data, never into its docs/ or reference/."""
    main = base/'snap-repo'
    main.mkdir()
    git(main, 'init', '-q')
    (main/'a.txt').write_text('allowed')
    git(main, 'add', 'a.txt')
    commit(main, 'allowed')
    (main/'data/baked').mkdir(parents=True)
    (main/'docs/x/data/baked').mkdir(parents=True)
    (main/'docs/x/data/baked/secret.md').write_text('private docs')
    tree = base/'snap-tree'
    git(main, 'worktree', 'add', '-q', '--detach', str(tree))
    (tree/'data').symlink_to(main/'data', target_is_directory=True)
    assert m.snapshot_source(tree, 'baked') == (main/'data/baked').resolve()
    (tree/'data').unlink()
    (tree/'data').mkdir()
    (tree/'data/baked').symlink_to(main/'docs/x/data/baked', target_is_directory=True)
    try:
        m.snapshot_source(tree, 'baked')
    except ValueError as error:
        assert 'private docs' in str(error), error
    else:
        raise AssertionError("a worktree's snapshot inside the main checkout's docs/ accepted")
    # A folder that is not a repository but sits in a checkout's data/work (as a check's scratch does) is not
    # one of that checkout's worktrees: its own data/baked stays a snapshot.
    nested = main/'data/work/scratch'
    (nested/'data/baked').mkdir(parents=True)
    try:
        assert m.snapshot_source(nested, 'baked') == (nested/'data/baked').resolve()
    except ValueError as error:
        raise AssertionError('a folder inside a checkout was taken for one of its worktrees') from error


def content_fingerprint(m, base):
    folder = base/'content/data/baked'
    folder.mkdir(parents=True)
    (folder/'land').write_text('land')
    cache = base/'content/cache.json'
    first, size = m.fingerprint(folder, cache)
    assert len(first) == 16 and size == 4 and m.fingerprint(folder, cache)[0] == first
    before = (folder/'land').stat()
    (folder/'land').write_text('LAND')
    os.utime(folder/'land', ns=(before.st_atime_ns, before.st_mtime_ns))
    assert (folder/'land').stat().st_mtime_ns == before.st_mtime_ns
    assert m.fingerprint(folder, cache)[0] != first, 'same size and time, new bytes, same fingerprint'


def pipe_test(source, base):
    """A broken output pipe (the Mac went away) stops the check group too."""
    root = base/'pipe'
    dest = root/'checkouts/test'
    dest.mkdir(parents=True)
    (root/'host.env').write_text('MMM_BROWSER_SLOTS=1\n')
    worker = ('import os,signal,sys,time\nfrom pathlib import Path\nPath("pid").write_text(str(os.getpid()))\n'
              'signal.signal(signal.SIGTERM,lambda *_:(Path("term").touch(),os._exit(130)))\n'
              'while True:\n print("x"*200,flush=True);time.sleep(.01)\n')
    proc = subprocess.Popen([sys.executable, '-c', host_code(source, ['run', str(root), 'test', '--', sys.executable, '-c', worker])],
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        wait_file(dest/'pid')
        proc.stdout.close()
        try:
            proc.wait(timeout=8)
        except subprocess.TimeoutExpired:
            raise AssertionError('host kept running after its output pipe broke')
        wait_file(dest/'term', 3)
    finally:
        with contextlib.suppress(ProcessLookupError, ValueError, FileNotFoundError):
            os.kill(int((dest/'pid').read_text()), signal.SIGKILL)
        if proc.poll() is None:
            proc.kill(); proc.wait()
        proc.stdin.close()


def lock_order(source, base):
    """The checkout lock outlasts checks that are still stopping after a disconnect."""
    root = base/'order'
    dest = root/'checkouts/test'
    dest.mkdir(parents=True)
    (root/'host.env').write_text('MMM_BROWSER_SLOTS=1\n')
    hold = subprocess.Popen([sys.executable, '-c', host_code(source, ['hold', str(root), 'test'])],
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    worker = ('import signal,sys,time\nfrom pathlib import Path\n'
              'def stop(*_):\n time.sleep(1.5);Path("stopped").touch();sys.exit(130)\n'
              'signal.signal(signal.SIGTERM,stop);Path("ready").touch();time.sleep(60)\n')
    run = None
    try:
        assert hold.stdout.readline().strip() == b'LOCKED'
        run = subprocess.Popen([sys.executable, '-c', host_code(source, ['run', str(root), 'test', '--', sys.executable, '-c', worker])],
                               stdin=subprocess.PIPE, stdout=subprocess.DEVNULL)
        wait_file(dest/'ready')
        run.stdin.close()
        hold.stdin.close()
        with (root/'locks/test.lock').open('a') as lock:
            end = time.monotonic()+10
            while True:
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    assert time.monotonic() < end, 'checkout lock never released'
                    time.sleep(.02)
            assert (dest/'stopped').exists(), 'checkout lock released while checks were still stopping'
    finally:
        for proc in (hold, run):
            if proc and proc.poll() is None:
                proc.kill(); proc.wait()
        hold.stdout.close()


def run_guard(source, base):
    """While checks from an earlier session still run, clean and prepare refuse to touch the checkout."""
    root = base/'guard-run'
    dest = root/'checkouts/test'
    dest.mkdir(parents=True)
    (root/'host.env').write_text('MMM_BROWSER_SLOTS=1\n')
    (dest/'input.txt').write_text('in use')
    worker = 'import time;from pathlib import Path;Path("ready").touch();time.sleep(60)'
    run = subprocess.Popen([sys.executable, '-c', host_code(source, ['run', str(root), 'test', '--', sys.executable, '-c', worker])],
                           stdin=subprocess.PIPE, stdout=subprocess.DEVNULL)
    try:
        wait_file(dest/'ready')
        result = subprocess.run([sys.executable, '-c', host_code(source, ['clean', str(root), 'test'])], input=b'other.txt\0',
                                capture_output=True)
        assert result.returncode == 2 and b'still running' in result.stderr, result
        assert (dest/'input.txt').exists(), 'clean changed a checkout with running checks'
    finally:
        run.stdin.close()
        try: run.wait(timeout=25)
        except subprocess.TimeoutExpired: run.kill(); run.wait()


def plan_parity(m):
    """The rows sent are the rows a local run executes, not the longer --list selection."""
    modes = {c['name']: c['mode'] for c in csv.DictReader((ROOT/'tools/checks.tsv').open(), delimiter='\t')}
    with contextlib.redirect_stdout(io.StringIO()):
        quick, _ = m.select_rows(ROOT, ['--quick', '--for', 'web/src/settings.ts'])
        browser, _ = m.select_rows(ROOT, ['--quick', '--browser', '--for', 'web/src/settings.ts'])
        only, _ = m.select_rows(ROOT, ['--only', 'tsc', 'jump'])
        try:
            m.select_rows(ROOT, ['--only', 'no-such-row'])
        except ValueError:
            pass
        else:
            raise AssertionError('unknown row selected')
    assert quick and not any(modes[r] == 'browser' for r in quick), 'browser rows selected without --browser'
    assert not any(modes[r] == 'node-mutations' for r in quick), 'mutation rows selected with --quick'
    assert set(quick) < set(browser) and any(modes[r] == 'browser' for r in browser)
    assert only == ['tsc', 'jump'], only


def lock_cancel(m, base):
    """Ctrl-C while another session holds the checkout cancels the lock request."""
    root = base/'cancel'
    (root/'bin').mkdir(parents=True)
    (root/'locks').mkdir()
    (root/'bin/remote_runner_host.py').write_text(SOURCES['remote_runner_host.py'])
    stub = base/'cancel-ssh'
    stub.write_text('#!/bin/bash\nshift\nexec bash -c "$*"\n')
    stub.chmod(0o755)
    remote = m.Remote('fake', str(root), 'test')
    remote.ssh = str(stub)
    result = {}
    def take():
        try:
            remote.release(remote.lock())
            result['r'] = 'locked'
        except m.Interrupted:
            result['r'] = 'interrupted'
        except Exception as error:
            result['r'] = repr(error)
    with (root/'locks/test.lock').open('a') as holder:
        fcntl.flock(holder, fcntl.LOCK_EX)
        m.INTERRUPTED[0] = False
        thread = threading.Thread(target=take, daemon=True)
        thread.start()
        time.sleep(.5)
        m.INTERRUPTED[0] = True
        thread.join(6)
        stuck = thread.is_alive()
        fcntl.flock(holder, fcntl.LOCK_UN)
    thread.join(10)
    m.INTERRUPTED[0] = False
    assert not stuck and result.get('r') == 'interrupted', result


def interrupted_setup(m):
    """A Ctrl-C that ends a setup step (rsync, git push, lock wait) exits 130; other setup failures exit 2."""
    failures = [lambda: subprocess.CalledProcessError(1, ['rsync']), lambda: subprocess.CalledProcessError(255, ['rsync']),
                lambda: ValueError('remote session lock failed')]
    for interrupted, error, expected in [(True, 0, 130), (False, 0, 2), (False, 1, 2), (True, 1, 130), (True, 2, 130), (False, 2, 2)]:
        def fail():
            m.INTERRUPTED[0] = interrupted
            raise failures[error]()
        m.main, m.INTERRUPTED[0] = fail, False
        old = sys.argv; sys.argv = ['remote-check.sh', 'host']
        try: assert m.cli() == expected, (interrupted, error)
        finally: sys.argv = old; m.INTERRUPTED[0] = False


def SOURCES_OF(mutant):
    return mutant.SOURCE


def wait_file(path, timeout=8):
    end = time.monotonic()+timeout
    while time.monotonic()<end:
        if path.exists():
            return
        time.sleep(.02)
    raise AssertionError('timed out waiting for '+str(path))


def eof_test(source, base):
    root = base/'eof'
    dest = root/'checkouts/test'
    dest.mkdir(parents=True)
    (root/'host.env').write_text('MMM_BROWSER_SLOTS=1\n')
    worker = ('import signal,time;from pathlib import Path;'
              'signal.signal(signal.SIGTERM,lambda *_:(Path("term").touch(),exit(130)));'
              'Path("ready").touch();time.sleep(60)')
    code = host_code(source, ['run',str(root),'test','--',sys.executable,'-c',worker])
    proc = subprocess.Popen([sys.executable,'-c',code], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        wait_file(dest/'ready')
        proc.stdin.close()
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            raise AssertionError('host ignored stdin EOF')
        assert proc.returncode == 130 and (dest/'term').exists(), 'EOF did not terminate check'
    finally:
        if proc.poll() is None:
            # Kill the helper; its signal handler still owns and stops the child group.
            proc.terminate()
            try: proc.wait(timeout=3)
            except subprocess.TimeoutExpired: proc.kill(); proc.wait()
        proc.stdout.close()
        proc.stderr.close()


def registry_and_env(base):
    checks = list(csv.DictReader((ROOT/'tools/checks.tsv').open(), delimiter='\t'))
    hosts = list(csv.DictReader((ROOT/'tools/checks-hosts.tsv').open(), delimiter='\t'))
    assert {c['name'] for c in checks if c['mode']=='browser'} <= {r['name'] for r in hosts}
    assert {r['name'] for r in hosts} <= {c['name'] for c in checks}
    root = base/'env'
    (root/'tools').mkdir(parents=True)
    (root/'data').mkdir()
    def table():
        (root/'tools/checks.tsv').write_text('name\tcommand\tmode\tglobs\tscripts\tneeds\n'
            'tsc\tprintf "%s" "${MMM_SOFTWARE_OK-unset}" > tsc-env\tnode\t*\t-\t-\n'
            'yes\tprintf "%s" "${MMM_SOFTWARE_OK-unset}" > yes-env\tbrowser\t*\t-\t-\n'
            'no\tprintf "%s" "${MMM_SOFTWARE_OK-unset}" > no-env\tnode\t*\t-\t-\n')
    table()
    (root/'tools/checks-hosts.tsv').write_text('name\twhere\tsoftware\tevidence\nyes\tportable\tok\tfixture\n')
    code = ('import os,sys;from pathlib import Path;'
            'ns={"__file__":sys.argv[1],"__name__":"fixture"};exec(compile(Path(sys.argv[1]).read_text(),sys.argv[1],"exec"),ns);'
            'ns["ROOT"]=Path(sys.argv[2]);os.chdir(sys.argv[2]);sys.argv=["check-all.py","--only","tsc","yes","no"];sys.exit(ns["main"]())')
    def run():
        return subprocess.run([sys.executable,'-c',code,str(ROOT/'tools/check-all.py'),str(root)], capture_output=True,text=True,env={**os.environ,'MMM_SOFTWARE_OK':'inherited'})
    result=run()
    assert result.returncode==0, result.stdout+result.stderr
    assert (root/'tsc-env').read_text()=='unset' and (root/'yes-env').read_text()=='1' and (root/'no-env').read_text()=='unset'
    (root/'tools/checks-hosts.tsv').write_text('name\twhere\tsoftware\tevidence\n')
    result=run(); assert result.returncode==1 and 'MISSING host classification: yes' in result.stderr
    (root/'tools/checks-hosts.tsv').write_text('name\twhere\tsoftware\tevidence\nyes\tportable\tok\tfixture\nnonexistent\tportable\tno\tfixture\n')
    result=run(); assert result.returncode==1 and 'UNKNOWN host classification: nonexistent' in result.stderr


def integration(m, base):
    root = base/'checkout'
    fixture(root)
    remote_root = base/'host with spaces'
    remote_root.mkdir()
    npm_bin = base/'host-bin'
    npm_bin.mkdir()
    (npm_bin/'npm').write_text('#!/bin/sh\nmkdir -p node_modules\n')
    (npm_bin/'npm').chmod(0o755)
    (remote_root/'host.env').write_text('MMM_BROWSER_SLOTS=1\nIGNORED=secret\nPATH_PREPEND='+str(npm_bin)+'\n')
    stub = base/'ssh'
    # Git also uses this stub; it may send -G / -o before the destination.
    stub.write_text('''#!/bin/bash
if [ "$1" = -G ]; then exit 0; fi
while [[ "$1" = -* ]]; do
 case "$1" in -o|-p) shift 2;; *) shift;; esac
done
dest="$1"; shift
if [ "$*" = 'uname -s' ]; then echo "${FAKE_UNAME:-Linux}"; exit 0; fi
if [ "$*" = 'uname -m' ]; then echo "${FAKE_ARCH:-x86_64}"; exit 0; fi
if [ "$dest" = unreachable ]; then exit 255; fi
exec bash -c "$*"
''')
    stub.chmod(0o755)
    env={**os.environ,'MMM_REMOTE_SSH':str(stub),'MMM_REMOTE_ROOT':str(remote_root)}
    source=SOURCES['remote_runner.py']
    def command(args):
        loader='import sys;from pathlib import Path;__file__='+repr(str(root/'tools/remote_runner.py'))+';sys.argv='+repr(['remote_runner.py',*args])+';'+source
        return [sys.executable,'-c',loader]
    def run(args, extra=None):
        result=subprocess.run(command(args),cwd=root,env={**env,**(extra or {})},capture_output=True,text=True,timeout=15)
        return result
    identity=root.name+'-'+hashlib.sha256(os.fsencode(str(root))).hexdigest()[:8]
    dest=remote_root/'checkouts'/identity
    r=run(['fake','--only','tsc','ok','mac']);assert r.returncode==2, r.stdout+r.stderr
    assert 'REFUSED mac:' in r.stdout and '--only tsc ok' in (dest/'only-args').read_text()
    assert (dest/'.git').is_dir() and not (remote_root/'shared/repo.git').exists()
    baseline=git(dest,'rev-parse','refs/remotes/origin/main').stdout.strip()
    other=base/'checkout-two'
    shutil.copytree(root,other,symlinks=True)
    git(other,'rm','-q','--cached','reference/private.txt')  # staged in the fixture; committing it is refused
    (other/'baseline.txt').write_text('moved');git(other,'add','baseline.txt');commit(other,'new baseline')
    git(other,'update-ref','refs/remotes/origin/main','HEAD')
    loader='import sys;__file__='+repr(str(other/'tools/remote_runner.py'))+';sys.argv='+repr(['remote_runner.py','fake','--only','ok'])+';'+source
    r2=subprocess.run([sys.executable,'-c',loader],cwd=other,env=env,capture_output=True,text=True,timeout=30)
    assert r2.returncode==0, r2.stdout+r2.stderr
    other_dest=remote_root/'checkouts'/(other.name+'-'+hashlib.sha256(os.fsencode(str(other))).hexdigest()[:8])
    assert git(other_dest,'show','origin/main:baseline.txt').stdout=='moved'
    assert git(dest,'rev-parse','refs/remotes/origin/main').stdout.strip()==baseline, \
        "another checkout's push moved this checkout's origin/main"
    files=allowlist(m,root)
    changed=m.changed_paths(root)
    assert {'staged.txt','deleted.txt','untracked.txt'} <= set(changed), changed
    for name in ('staged.txt','tracked-link','old.txt'):
        assert (dest/name).exists(), name
    assert (dest/'tracked-link').is_symlink()
    for name in ('untracked.txt','deleted.txt','docs/x.md','reference/private.txt'):
        assert not (dest/name).exists(), name
    assert (dest/'data/audio/out/radio').read_text()=='own audio'
    assert (dest/'data/baked/land').read_text()=='land'
    # The open-data paved inputs travel as a snapshot (rented hosts too); the rest of data/raw stays home.
    assert (dest/'data/raw/paved-open/corrections.json').read_text()=='{"version":1}'
    assert not os.access(dest/'data/raw/paved-open/corrections.json', os.W_OK)
    assert not (dest/'data/raw/private-survey.tif').exists()
    assert not (dest/'data/baked').is_symlink() and not os.access(dest/'data/baked/land', os.W_OK)
    assert (dest/'web/node_modules').is_symlink()
    assert git(dest,'show','origin/main:old.txt').stdout.strip()=='old.txt'
    unchanged_inode=(dest/'data/baked/unchanged').stat().st_ino
    (root/'data/baked/land').write_text('land2')
    (root/'data/raw/paved-open/corrections.json').write_text('{"version":2}')
    before=(root/'target.txt').stat()
    (root/'target.txt').write_text('edited.txt')
    os.utime(root/'target.txt',ns=(before.st_atime_ns,before.st_mtime_ns))
    (root/'old.txt').unlink();git(root,'rm','old.txt')
    (dest/'data/keep').touch()
    r=run(['fake','--only','ok']);assert r.returncode==0,r.stdout+r.stderr
    assert not (dest/'old.txt').exists() and (dest/'data/keep').exists()
    assert (dest/'target.txt').read_text()=='edited.txt', 'same-size working edit missed by rsync'
    assert (dest/'data/baked/land').read_text()=='land2'
    assert (dest/'data/raw/paved-open/corrections.json').read_text()=='{"version":2}', 'a changed corrections file did not reach the host'
    assert (dest/'data/baked/unchanged').stat().st_ino==unchanged_inode, 'link-dest did not reuse unchanged data'
    assert len(list((remote_root/'shared').glob('baked-*')))==2, 'prune keeps the two most recently used snapshots'
    r=run(['fake','--only','unknown']);assert r.returncode==2 and 'REFUSED unknown:' in r.stdout
    r=run(['fake','--only','unknown','--allow-unproven']);assert r.returncode==0,r.stdout+r.stderr
    r=run(['fake','--only','mac','unknown'],{'FAKE_UNAME':'Darwin'});assert r.returncode==0,r.stdout+r.stderr
    r=run(['fake','--only','apple','unknown','--allow-unproven']);assert r.returncode==2 and 'REFUSED apple:' in r.stdout,r.stdout+r.stderr
    assert '--only unknown' in (dest/'only-args').read_text()
    r=run(['fake','--only','apple'],{'FAKE_UNAME':'Darwin','FAKE_ARCH':'x86_64'});assert r.returncode==2 and 'REFUSED apple:' in r.stdout,r.stdout+r.stderr
    r=run(['fake','--only','apple'],{'FAKE_UNAME':'Darwin','FAKE_ARCH':'arm64'});assert r.returncode==0,r.stdout+r.stderr
    assert '--only apple' in (dest/'only-args').read_text()
    r=run(['fake','--only','ok','--for','uncovered.bin']);assert r.returncode==2 and 'NO CHECK COVERS' in r.stdout
    r=run(['unreachable','--only','ok']);assert r.returncode==2 and 'cannot reach unreachable' in r.stderr
    # --list is local, even when the SSH executable cannot run.
    r=run(['unreachable','--list'],{'MMM_REMOTE_SSH':'/does/not/exist'});assert r.returncode==0,r.stdout+r.stderr
    # Unknown hosts never receive audio, and an old own-host link is removed.
    r=run(['rented','--only','ok']);assert r.returncode==0,r.stdout+r.stderr
    assert not (dest/'data/audio/out').exists()
    (root/'evidence-mode').touch();git(root,'add','evidence-mode')
    r=run(['fake','--only','ok']);assert r.returncode==1 and 'Evidence copied to ' in r.stdout,r.stdout+r.stderr
    local=Path(r.stdout.split('Evidence copied to ')[1].splitlines()[0])
    assert (local/'log').read_text().strip()=='failure' and not (dest/'data/work/checks/checks-proof').exists()
    (root/'evidence-mode').unlink();git(root,'rm','--cached','evidence-mode')
    (root/'sleep-mode').touch();git(root,'add','sleep-mode')
    p=subprocess.Popen(command(['fake','--only','ok']),cwd=root,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
    try:
        wait_file(dest/'pid')
        start=time.monotonic();p.send_signal(signal.SIGTERM)
        out,_=p.communicate(timeout=25)
        assert p.returncode==130 and (dest/'terminated').exists(),out
        assert time.monotonic()-start<25
        with (remote_root/'locks'/(identity+'.lock')).open('a') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    finally:
        if p.poll() is None: p.kill();p.wait()
    print('PASS fake SSH + real Git push/rsync: index, staged/deleted/symlink, stale cleanup, selection/refusal, rented audio, evidence, TERM and lock release')


def pinned(m, base):
    """Only the exact pinned blobs at their exact docs/ paths pass the history check; nothing else in docs/ does."""
    def repo(name):
        root = base/name
        root.mkdir()
        git(root, 'init', '-q')
        (root/'docs').mkdir()
        (root/'docs/note.md').write_text('public note')
        git(root, 'add', '-f', 'docs/note.md')
        commit(root, 'note')
        return root
    def refused(root, why):
        try:
            m.history_check(root, ['HEAD'])
        except ValueError as error:
            assert 'private path (docs' in str(error).casefold(), error
        else:
            raise AssertionError(why)
    saved = m.HISTORY_PINNED
    try:
        root = repo('pinned-ok')
        m.HISTORY_PINNED = {'docs/note.md': git(root, 'rev-parse', 'HEAD:docs/note.md').stdout.strip()}
        git(root, 'mv', 'docs/note.md', 'note.md')
        commit(root, 'moved out')
        m.history_check(root, ['HEAD'])
        root = repo('pinned-edited')
        m.HISTORY_PINNED = {'docs/note.md': git(root, 'rev-parse', 'HEAD:docs/note.md').stdout.strip()}
        # The edit's bytes, and a folder holding only them, first appear at an allowed path, so the object
        # listing names both there; only the per-path history pass sees them at the pinned path.
        (root/'stuff').mkdir()
        (root/'stuff/note.md').write_text('private later edit')
        git(root, 'add', 'stuff/note.md')
        commit(root, 'same bytes at an allowed path first')
        (root/'docs/note.md').write_text('private later edit')
        git(root, 'add', '-f', 'docs/note.md')
        commit(root, 'edited')
        git(root, 'rm', '-q', '--cached', 'docs/note.md')
        commit(root, 'removed')
        refused(root, 'a later edit at a pinned path passed')
        root = repo('pinned-sibling')
        m.HISTORY_PINNED = {'docs/note.md': git(root, 'rev-parse', 'HEAD:docs/note.md').stdout.strip()}
        (root/'docs/other.md').write_text('private sibling')
        git(root, 'add', '-f', 'docs/other.md')
        commit(root, 'sibling')
        refused(root, 'a private file beside a pinned one passed')
        root = repo('pinned-renamed')
        m.HISTORY_PINNED = {'docs/note.md': git(root, 'rev-parse', 'HEAD:docs/note.md').stdout.strip()}
        git(root, 'mv', 'docs/note.md', 'docs/copy.md')
        commit(root, 'pinned bytes at another docs path')
        refused(root, 'pinned bytes at an unpinned docs path passed')
        # A case spelling of a pinned path is another path: it is refused, never pinned, beside the pin or alone.
        for index, (variant, keep) in enumerate((('Docs/note.md', True), ('DOCS/note.md', False), ('docs/NOTE.md', False))):
            root = repo(f'pinned-case-{index}')
            pin = git(root, 'rev-parse', 'HEAD:docs/note.md').stdout.strip()
            m.HISTORY_PINNED = {'docs/note.md': pin}
            if not keep:
                git(root, 'rm', '-q', '--cached', 'docs/note.md')
            git(root, 'update-index', '--add', '--cacheinfo', '100644,'+pin+','+variant)
            commit(root, 'pinned bytes at '+variant)
            refused(root, f'pinned bytes at the case variant {variant} passed')
        root = repo('pinned-newline')
        m.HISTORY_PINNED = {'docs/note.md': git(root, 'rev-parse', 'HEAD:docs/note.md').stdout.strip()}
        (root/'docs/note.md\n').write_text('private bytes behind a line break')
        git(root, 'add', '-f', 'docs/note.md\n')
        commit(root, 'a name that strips to the pinned path')
        refused(root, 'a path with a line break passed as the pinned path')
        root = repo('pinned-merge')
        pin = git(root, 'rev-parse', 'HEAD:docs/note.md').stdout.strip()
        m.HISTORY_PINNED = {'docs/note.md': pin}
        trunk = git(root, 'rev-parse', '--abbrev-ref', 'HEAD').stdout.strip()
        git(root, 'checkout', '-q', '-b', 'side')
        (root/'stuff').mkdir()
        (root/'stuff/note.md').write_text('private side edit')
        git(root, 'add', 'stuff/note.md')
        commit(root, 'same bytes at an allowed path first')
        (root/'docs/note.md').write_text('private side edit')
        git(root, 'add', '-f', 'docs/note.md')
        commit(root, 'side edit')
        (root/'docs/note.md').write_text('public note')
        git(root, 'add', '-f', 'docs/note.md')
        commit(root, 'side revert')
        git(root, 'checkout', '-q', trunk)
        (root/'other.txt').write_text('trunk work')
        git(root, 'add', 'other.txt')
        commit(root, 'trunk')
        git(root, '-c', 'user.name=Fixture', '-c', 'user.email=test@example.invalid', 'merge', '-q', '--no-edit', 'side')
        refused(root, 'an edit and revert on a merged side branch passed')
    finally:
        m.HISTORY_PINNED = saved


def main():
    started=time.monotonic()
    m=module('remote_runner.py');h=module('remote_runner_host.py')
    with tempfile.TemporaryDirectory(prefix='mmm-remote-tests-') as folder:
        base=Path(folder).resolve()
        root=base/'index';fixture(root)
        allowlist(m,root);stale(h,base);refusal(m);verdicts(m);evidence_guard(h,base)
        interrupted_setup(module('remote_runner.py'))
        eof_test(SOURCES['remote_runner_host.py'],base)
        registry_and_env(base)
        snapshot_and_settings(h,base)
        farm_test(h,base);symlink_parent(m,base);history(m,base);casefold(m,base);pinned(m,base);snapshot_root(m,base);snapshot_worktree(m,base);content_fingerprint(m,base)
        pipe_test(SOURCES['remote_runner_host.py'],base);lock_order(SOURCES['remote_runner_host.py'],base);lock_cancel(m,base)
        run_guard(SOURCES['remote_runner_host.py'],base);plan_parity(m);changed_merge(m);fresh_host(h,base)
        fp,size=m.fingerprint(root/'data/baked');assert len(fp)==16 and size==16
        (root/'data/baked/escape').symlink_to(root/'target.txt')
        try: m.fingerprint(root/'data/baked')
        except ValueError: pass
        else: raise AssertionError('snapshot symlink accepted')
        integration(m,base)
        print('PASS host classification completeness, software env reset, snapshot fingerprint and symlink refusal; 40 verdict combinations')
        mutants=[
            ('deny prefix', 'remote_runner.py', "key == p.rstrip('/') or key.startswith(p) for p in DENY_FOLDED", "key == p.rstrip('/') or key.startswith(p) for p in ()", lambda x,b:allowlist(x,root)),
            ('deny prefix case-sensitive', 'remote_runner.py', '    key = fold(name)\n', '    key = name\n', casefold),
            ('fold without Unicode normalisation', 'remote_runner.py', "    return unicodedata.normalize('NFKC', unicodedata.normalize('NFKC', text).casefold())", '    return text.casefold()', casefold),
            ('snapshot private check case-sensitive', 'remote_runner.py', ('    key = Path(fold(str(real)))\n', '            private = Path(fold(str(path)))\n'), ('    key = real\n', '            private = path\n'), snapshot_root),
            ('snapshot identity check dropped', 'remote_runner.py', ' or \\\n                    inside(real, path) or inside(path, real):', ':', snapshot_root),
            ('worktree list found through an enclosing repository', 'remote_runner.py', ", 'GIT_CEILING_DIRECTORIES': str(root.parent)}", '}', snapshot_worktree),
            ("snapshot checks this worktree's private folders only", 'remote_runner.py', '    for base in checkout_roots(root):\n', '    for base in [root]:\n', snapshot_worktree),
            ('ref to a non-commit pushed', 'remote_runner.py', "        if kind != 'commit':", '        if False:', history),
            ('snapshot around private, spelling', 'remote_runner.py', ' or private.is_relative_to(key) or', ' or', snapshot_root),
            ('snapshot around private, identity', 'remote_runner.py', ' or inside(path, real):', ':', snapshot_root),
            ('push sends names, not the checked ids', 'remote_runner.py', "'+'+head+'^{commit}:refs/mmm/'+identity", "'+HEAD:refs/mmm/'+identity", history),
            ('pushed HEAD id read as a ref name', 'remote_runner.py', "'+'+head+'^{commit}:refs/mmm/'+identity", "'+'+head+':refs/mmm/'+identity", history),
            ('pushed origin/main id read as a ref name', 'remote_runner.py', "'+'+main+'^{commit}:refs/remotes/origin/main'", "'+'+main+':refs/remotes/origin/main'", history),
            ('push follows tags', 'remote_runner.py', "'--no-follow-tags', ", '', history),
            ('fold keeps format characters', 'remote_runner.py', "    text = ''.join(c for c in text if unicodedata.category(c) != 'Cf')\n", '', casefold),
            # Both pinned guards (the object listing and the per-path pass) are exact; either alone refuses a variant.
            ('pinned path matched case-insensitively', 'remote_runner.py',
             ("        if name and not allowed_path(name) and not pinned_name(name):",
              "    if '\\n' in name or '\\r' in name or name not in HISTORY_PINNED:\n        return False\n"),
             ("        if name and not allowed_path(name) and not pinned_name(name.casefold()):",
              "    if '\\n' in name or '\\r' in name or name.casefold() not in HISTORY_PINNED:\n        return False\n    name = name.casefold()\n"),
             pinned),
            ('untracked files', 'remote_runner.py', "['ls-files', '-z', '--cached']", "['ls-files', '-z', '--cached', '--others', '--exclude-standard']",lambda x,b:allowlist(x,root)),
            ('stale removal', 'remote_runner_host.py', '    walk(dest)\n', '    pass\n',stale),
            ('Mac refusal', 'remote_runner.py', "if row['where'] == 'mac-only':", "if False:",lambda x,b:refusal(x)),
            ('Apple architecture refusal', 'remote_runner.py', "if platform != 'Darwin' or machine != 'arm64':", "if platform != 'Darwin':", lambda x,b:refusal(x)),
            ('Apple OS refusal', 'remote_runner.py', "if platform != 'Darwin' or machine != 'arm64':", "if machine != 'arm64':", lambda x,b:refusal(x)),
            ('refused exit zero', 'remote_runner.py', 'if remote != 0 or refused or uncovered:', 'if remote != 0 or uncovered:',lambda x,b:verdicts(x)),
            ('stdin EOF', 'remote_runner_host.py', '                        stop()  # stdin EOF terminates the owned check group', '                        pass  # mutant ignores EOF',None),
            ('Ctrl-C during setup exits 2', 'remote_runner.py', '    except subprocess.CalledProcessError as error:\n        if INTERRUPTED[0]:\n            return 130\n', '    except subprocess.CalledProcessError as error:\n', lambda x,b:interrupted_setup(x)),
            ('evidence deletion guard', 'remote_runner_host.py', '    target = evidence_allowed(root, identity, path)\n', '    target = path\n',evidence_guard),
            ('evidence symlinked parent', 'remote_runner_host.py', '    if any(p.is_symlink() or not p.is_dir() for p in chain):\n        return None\n', '', evidence_guard),
            ('history check skipped', 'remote_runner.py', "    head, main, *kept = history_check(root, ['HEAD', 'refs/remotes/origin/main', *fixtures])\n", "    head, main, *kept = 'HEAD', 'refs/remotes/origin/main', *fixtures\n", history),
            ('fixture refs pushed unchecked', 'remote_runner.py', "    head, main, *kept = history_check(root, ['HEAD', 'refs/remotes/origin/main', *fixtures])\n", "    (head, main), kept = history_check(root, ['HEAD', 'refs/remotes/origin/main']), fixtures\n", history),
            ('symlinked parent folder', 'remote_runner.py', "            if (root/parent).is_symlink():", "            if False:", symlink_parent),
            ('snapshot inside private folder', 'remote_runner.py', '            if key == private or key.is_relative_to(private) or private.is_relative_to(key) or \\\n                    inside(real, path) or inside(path, real):', '            if False:', snapshot_root),
            ('fingerprint ignores ctime', 'remote_runner.py', 'key = [stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns, stat.st_ino]', 'key = [stat.st_size, stat.st_mtime_ns, 0, 0]', content_fingerprint),
            ('writable snapshot', 'remote_runner_host.py', '                os.chmod(os.path.join(parent, name), 0o444)', '                pass', farm_test),
            ('broken pipe leaves checks running', 'remote_runner_host.py', '        stop()  # the Mac side went away (broken pipe): the group is stopped below', '        raise', lambda x,b:pipe_test(SOURCES_OF(x),b)),
            ('lock released before checks stop', 'remote_runner_host.py', "            fcntl.flock(running, fcntl.LOCK_EX)\n    return 0\n", "            pass\n    return 0\n", lambda x,b:lock_order(SOURCES_OF(x),b)),
            ('replacement refs honoured', 'remote_runner.py', "RAW_GIT = {'GIT_NO_REPLACE_OBJECTS': '1'}", "RAW_GIT = {}", history),
            ('grafts ignored', 'remote_runner.py', "    if grafts.exists():", "    if False:", history),
            ('clean beside running checks', 'remote_runner_host.py', '        with no_running_checks(root, identity):', '        with contextlib.nullcontext():', lambda x,b:run_guard(SOURCES_OF(x),b)),
            ('listing selection sent', 'remote_runner.py', "*args, '--plan']", "*args, '--list']", lambda x,b:plan_parity(x)),
            ('pinned path accepts any content', 'remote_runner.py', "        if parts[3] != HISTORY_PINNED[name] and set(parts[3]) != {'0'}:", "        if False:", pinned),
            ('pinned path with a line break', 'remote_runner.py', "    if '\\n' in name or '\\r' in name or name not in HISTORY_PINNED:", "    name = name.strip('\\n')\n    if name not in HISTORY_PINNED:", pinned),
            ('pinned history simplified', 'remote_runner.py', "'--diff-merges=separate', '--full-history', '--ignore-submodules=none', '--raw',", "'--ignore-submodules=none', '--raw',", pinned),
            ('history paths from objects only', 'remote_runner.py', "    for raw in os.fsdecode(out).split('\\0'):", "    for raw in []:", history),
            ('explicit --for dropped with --changed', 'remote_runner.py', '                explicit.append(args[index])', '                pass', lambda x,b:changed_merge(x)),
            ('fresh host shared folder', 'remote_runner_host.py', 'npm.mkdir(parents=True, exist_ok=True)', 'npm.mkdir(exist_ok=True)', fresh_host),
            ('Ctrl-C ignored while waiting for the lock', 'remote_runner.py', '                if INTERRUPTED[0]:\n                    raise Interrupted\n', '', lock_cancel),
        ]
        for index,(name,file,anchor,replacement,probe) in enumerate(mutants):
            source=SOURCES[file]
            pairs=zip(anchor,replacement) if isinstance(anchor,tuple) else [(anchor,replacement)]
            for anchor,replacement in pairs:
                assert source.count(anchor)==1, f'MISSING OR AMBIGUOUS MUTANT ANCHOR: {name}: {anchor!r}'
                source=source.replace(anchor,replacement,1)
            mutant=module(file,source);mutant.SOURCE=source
            scratch=base/f'mutant-{index}';scratch.mkdir()
            try:
                if probe: probe(mutant,scratch)
                else: eof_test(source,scratch)
            except AssertionError:
                print('CAUGHT mutant: '+name)
            else:
                raise AssertionError('SURVIVED mutant: '+name)
    print(f'PASS remote runner ({time.monotonic()-started:.2f}s); all {len(mutants)} mutants caught')


if __name__=='__main__':
    main()
