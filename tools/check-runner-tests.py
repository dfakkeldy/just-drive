#!/usr/bin/env python3
"""Exercise selection, inventory drift and verdict precedence without a browser."""
import csv
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='mmm-runner-test-') as folder:
    fixture = Path(folder)
    (fixture / 'tools').mkdir()
    (fixture / 'data').mkdir()
    (fixture / 'bin').mkdir()
    (fixture / 'web/node_modules/.bin').mkdir(parents=True)
    (fixture / 'web/node_modules/.bin/tsc').touch()
    npx = fixture / 'bin/npx'
    npx.write_text('#!/bin/sh\necho tsc >> "$PROOF_COUNT"\nexit 0\n')
    npx.chmod(0o755)
    def table(entries):
        (fixture / 'tools/checks-hosts.tsv').write_text('name\twhere\tsoftware\tevidence\n' + ''.join(name+'\tunproven\tno\tfixture\n' for name,code,mode,globs,needs in entries if mode == 'browser'))
        with (fixture / 'tools/checks.tsv').open('w') as f:
            w = csv.DictWriter(f, fieldnames=['name','command','mode','globs','scripts','needs'], delimiter='\t')
            w.writeheader()
            w.writerow(dict(name='tsc',command='cd web && npx --no-install tsc --noEmit -p .',mode='node',globs='web/tsconfig.json',scripts='-',needs='web/node_modules/.bin/tsc'))
            for name,code,mode,globs,needs in entries:
                w.writerow(dict(name=name,command=f'echo "FAIL reason-{name}"; exit {code}',mode=mode,globs=globs,scripts='',needs=needs))
    scratch=[fixture/'data/work/checks']
    def run(*args):
        code = ('import importlib.util,sys,os;from pathlib import Path;'
                's=importlib.util.spec_from_file_location("checks",sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);'
                'm.ROOT=Path(sys.argv[2]);os.chdir(m.ROOT);sys.argv=[sys.argv[1],*sys.argv[3:]];sys.exit(m.main())')
        return subprocess.run([sys.executable,'-c',code,str(ROOT/'tools/check-all.py'),str(fixture),*args],text=True,capture_output=True,env={**os.environ,'PATH':str(fixture/'bin')+os.pathsep+os.environ['PATH'],'PROOF_COUNT':str(fixture/'tsc-count'),'MMM_CHECK_SCRATCH':str(scratch[0])})
    def expect(args, code, present=(), absent=()):
        result=run(*args)
        assert result.returncode==code,(args,result.stdout,result.stderr)
        for text in present: assert text in result.stdout,(args,text,result.stdout)
        for text in absent: assert text not in result.stdout,(args,text,result.stdout)
    table([('ok',0,'node','web/src/a.ts',''),('mut',0,'node-mutations','web/src/a.ts',''),('browser',1,'browser','tools/b.mjs','')])
    expect([],0,('ok | PASS','mut | PASS'),('browser |',))
    assert (fixture/'tsc-count').read_text().splitlines()==['tsc'],'tsc must run once'
    expect(['--quick'],0,('ok | PASS',),('mut |','browser |'))
    expect(['--only','browser'],1,('browser | FAIL | 1',),('ok |','mut |'))
    expect(['--for','tools/b.mjs','--list'],0,('browser | browser',),('ok |','mut |'))
    expect(['--for','docs/nothing.md'],0,('NO CHECK NEEDED docs/nothing.md',))
    expect(['--for','web/src/a.ts','README.md','--only','ok'],0,('NO CHECK NEEDED README.md','ok | PASS'))
    expect(['--for','unknown.bin','--only','ok'],2,('NO CHECK COVERS unknown.bin','ok | PASS'))
    expect(['--for','unknown.bin','--only','browser'],1,('NO CHECK COVERS unknown.bin','browser | FAIL'))
    expect(['--only','unknown'],2)
    table([('busy',2,'node','*',''),('fail',1,'node','*',''),('missing',0,'node','*','data/baked/terrain/manifest.json')])
    expect([],1,('busy | CANNOT RUN | 2','fail | FAIL | 1','reason-fail','missing | SKIP | 2','1 SKIP'))
    table([('busy',2,'node','*','')]);expect([],2,('CANNOT RUN',))
    result=run(); evidence=Path(result.stdout.split('Evidence kept at ')[1].strip())
    assert evidence.is_dir() and 'reason-busy' in (evidence/'busy.log').read_text()

    table([('missing',0,'node','*','data/baked/terrain/manifest.json')]);expect([],2,('SKIP','missing data/baked','1 SKIP'))
    # --ci: a mac-only row, a missing data file and a tracked link that dangles into data/ skip without failing.
    (fixture/'web/public').mkdir(parents=True)
    (fixture/'web/public/areas').symlink_to('../../data/baked/areas')
    def ci_table(entries):
        table(entries)
        with (fixture/'tools/checks-hosts.tsv').open('a') as f: f.write('mac\tmac-only\tno\tfixture\n')
    ci_table([('mac',1,'node','*',''),('nodata',0,'node','*','data/baked/terrain/manifest.json'),('link',0,'node','*','web/public/areas'),('ok',0,'node','*','')])
    expect(['--ci'],0,('mac | SKIP | 2','mac-only in tools/checks-hosts.tsv','nodata | SKIP','link | SKIP','ok | PASS','3 SKIP','CI: 3 SKIP rows'))
    expect([],1,('mac | FAIL | 1',),('CI:',))
    # Apple silicon rows retain the Mac-only CI skip; ordinary execution still runs them.
    ci_table([('mac',1,'node','*',''),('apple',1,'node','*',''),('ok',0,'node','*','')])
    with (fixture/'tools/checks-hosts.tsv').open('a') as f: f.write('apple\tapple\tno\tfixture\n')
    expect(['--ci'],0,('mac | SKIP | 2','apple | SKIP | 2','apple in tools/checks-hosts.tsv','ok | PASS','CI: 2 SKIP rows'))
    expect([],1,('mac | FAIL | 1','apple | FAIL | 1'),('CI:',))
    # A missing need outside data/ (npm ci did not run) and a real failure still fail a CI run.
    ci_table([('mac',1,'node','*',''),('nomodules',0,'node','*','web/node_modules/.bin/vite data/baked/terrain/manifest.json')])
    expect(['--ci'],2,('nomodules | SKIP | 2','CI: 1 SKIP rows'))
    ci_table([('mac',1,'node','*',''),('fail',1,'node','*','')]);expect(['--ci'],1,('fail | FAIL | 1','---- fail log, last 40 lines ----\nFAIL reason-fail'))
    expect([],1,('fail | FAIL | 1',),('---- fail log',))
    # Containment is by path components after links: a sibling named data-other/ and a link leading out of data/ still fail.
    (fixture/'web/public/escape').symlink_to('../../elsewhere')
    for needs in ('data-other/x.json','web/public/escape'):
        ci_table([('mac',1,'node','*',''),('outside',0,'node','*',needs)]);expect(['--ci'],2,('outside | SKIP | 2',),('CI: 2',))
    (fixture/'web/public/escape').unlink()
    # No data/ folder at all (a clean clone), and a repository root reached through a link (macOS /tmp, /var).
    ci_table([('mac',1,'node','*',''),('nodata',0,'node','*','data/baked/terrain/manifest.json'),('link',0,'node','*','web/public/areas')])
    # Keep the evidence folder inside the fixture: without data/, MMM_CHECK_SCRATCH must point elsewhere.
    scratch[0]=fixture/'scratch';scratch[0].mkdir()
    (fixture/'data').rename(fixture/'data-hidden')
    result=run('--ci');assert result.returncode==0 and all(s in result.stdout for s in ('nodata | SKIP','link | SKIP','CI: 3 SKIP rows')),(result.stdout,result.stderr)
    assert str(fixture/'scratch') in result.stdout.split('Evidence kept at ')[1],result.stdout
    (fixture/'data-hidden').rename(fixture/'data');scratch[0]=fixture/'data/work/checks'
    alias=Path(folder+'-alias');alias.symlink_to(fixture)
    try:
        result=subprocess.run([sys.executable,'-c',('import importlib.util,sys,os;from pathlib import Path;'
            's=importlib.util.spec_from_file_location("checks",sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);'
            'm.ROOT=Path(sys.argv[2]);os.chdir(m.ROOT);sys.argv=[sys.argv[1],"--ci"];sys.exit(m.main())'),str(ROOT/'tools/check-all.py'),str(alias)],
            text=True,capture_output=True,env={**os.environ,'PATH':str(fixture/'bin')+os.pathsep+os.environ['PATH'],'MMM_CHECK_SCRATCH':str(fixture/'data/work/checks')})
        assert result.returncode==0 and 'CI: 3 SKIP rows' in result.stdout,(result.stdout,result.stderr)
    finally: alias.unlink()
    (fixture/'web/public/areas').unlink()
    print('PASS --ci tolerates mac-only and data/ skips only')
    npx.write_text('#!/bin/sh\necho "tsc error"\nexit 2\n')
    expect(['--only','tsc'],1,('tsc | FAIL | 2',))
    npx.write_text('#!/bin/sh\nexit 0\n')
    # Every web source selects all CPU rows, regardless of narrow tool globs.
    table([('truck',0,'node','tools/truck.mjs',''),('phone',0,'node','tools/phone.mjs',''),('mutation',0,'node-mutations','tools/mutation.mjs',''),('browser-runtime',0,'node','tools/runtime.py','')])
    expect(['--for','web/src/terrain.ts','--list'],0,('truck | node','phone | node','mutation | node-mutations'))
    (fixture/'tools/runtime.py').write_text('print("runtime fixture")\n')
    manifest=fixture/'tools/checks.tsv'
    with manifest.open() as f: initial=list(csv.DictReader(f,delimiter='\t'))
    for row in initial:
        if row['name']=='browser-runtime':row['command']=sys.executable+' tools/runtime.py'
    with manifest.open('w') as f:
        writer=csv.DictWriter(f,fieldnames=initial[0].keys(),delimiter='\t');writer.writeheader();writer.writerows(initial)
    expect(['--for','tools/browser.sh','--list'],0,('browser start-up changed: run --browser','browser-runtime | node'))
    expect([],0,('start-up proofs not run (no starter changed); use --full',),('browser-runtime |',))
    expect(['--for','web/src/terrain.ts','--list'],0,absent=('browser-runtime |',))
    expect(['--full','--list'],0,('browser-runtime | node',))
    expect(['--for','tools/runtime.py','--list'],0,('browser-runtime | node',))
    # Failed/CANNOT rows retain logs, while successful executions remove their directory.
    result=run('--only','browser-runtime','--full')
    assert result.returncode==0
    # An explicit --only runs the named row: a start-up proof without --full, never 'nothing selected, exit 0'.
    expect(['--only','browser-runtime','--list'],0,('browser-runtime | node',))
    result=run('--only','browser-runtime');assert result.returncode==0 and 'browser-runtime | PASS' in result.stdout,result.stdout
    result=run('--only','truck');assert 'Evidence kept at' not in result.stdout

    table([('sleeper',0,'node','*',''),('next',0,'node','*','')])
    # Replace just fixture commands; no source copy or real browser is involved.
    manifest=fixture/'tools/checks.tsv'
    def change_row(name, command, limit='600'):
        with manifest.open() as f: rows=list(csv.DictReader(f,delimiter='\t'))
        for r in rows:
            r['timeout']=r.get('timeout','600')
            if r['name']==name: r['command']=command;r['timeout']=limit
        with manifest.open('w') as f:
            w=csv.DictWriter(f,fieldnames=[*rows[0].keys()],delimiter='\t');w.writeheader();w.writerows(rows)
    change_row('sleeper','sleep 20','0.25')
    expect([],1,('sleeper | FAIL | 1','timed out after 0.25 s','next | PASS'))
    # A pass whose row wrote evidence/<row>/ keeps only evidence/ (logs and the rest go) and prints where. Across runs the
    # newest three passing folders of the row stay; older ones go. A failed run keeps everything and is never pruned.
    import time as clock
    table([('shot',0,'node','*','')])
    shot='mkdir -p "$MMM_CHECK_OUT/evidence/shot" && echo 1 > "$MMM_CHECK_OUT/evidence/shot/result.json" && echo junk > "$MMM_CHECK_OUT/junk.log"'
    change_row('shot',shot+'; exit 1');result=run();assert result.returncode==1,result.stdout
    failed=Path(result.stdout.split('Evidence kept at ')[1].strip());assert (failed/'junk.log').exists() and (failed/'shot.log').exists()
    other=scratch[0]/'not-a-run';(other/'evidence/shot').mkdir(parents=True)   # a folder the runner did not make: never pruned
    change_row('shot',shot);kept=[]
    for _ in range(5):
        clock.sleep(.02);result=run();assert result.returncode==0 and 'Evidence kept at ' in result.stdout,result.stdout
        folder=Path(result.stdout.split('Evidence kept at ')[1].strip());kept.append(folder)
        assert sorted(p.name for p in folder.iterdir())==['evidence'] and (folder/'evidence/shot/result.json').exists(),sorted(folder.iterdir())
    assert [f for f in kept if f.exists()]==kept[-3:],kept
    assert (failed/'junk.log').exists(),'a failed run was pruned'
    assert (other/'evidence/shot').is_dir(),'a folder not named checks-* was pruned'
    print('PASS evidence: a pass keeps only evidence/ and prints it; newest 3 per row stay; failed runs untouched')
    table([('sleeper',0,'node','*',''),('next',0,'node','*','')])
    # A stubborn descendant must die with its process group, even if its parent exits first.
    import shlex, signal, time
    worker=fixture/'worker.py';pid=fixture/'child.pid';ready=fixture/'ready'
    worker.write_text('import os,signal,time\nfrom pathlib import Path\nsignal.signal(signal.SIGTERM,signal.SIG_IGN)\nPath('+repr(str(pid))+').write_text(str(os.getpid()))\ntime.sleep(30)\n')
    command=shlex.quote(sys.executable)+' '+shlex.quote(str(worker))+' & wait'
    change_row('sleeper',command,'0.5');expect([],1,('timed out after 0.5 s',))
    child=int(pid.read_text())
    def alive(pid):
        result=subprocess.run(['ps','-o','stat=','-p',str(pid)],capture_output=True,text=True)
        return bool(result.stdout.strip()) and not result.stdout.strip().startswith('Z')
    assert not alive(child),'timeout left descendant alive'
    # One signal must stop the run; the next row must never execute.
    for sig in [signal.SIGINT,signal.SIGTERM]:
        marker=fixture/'next-ran';marker.unlink(missing_ok=True);ready.unlink(missing_ok=True)
        change_row('sleeper','touch '+shlex.quote(str(ready))+'; sleep 30')
        change_row('next','touch '+shlex.quote(str(marker)))
        code = ('import importlib.util,sys,os;from pathlib import Path;'
                's=importlib.util.spec_from_file_location("checks",sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);'
                'm.ROOT=Path(sys.argv[2]);os.chdir(m.ROOT);sys.argv=[sys.argv[1]];sys.exit(m.main())')
        p=subprocess.Popen([sys.executable,'-c',code,str(ROOT/'tools/check-all.py'),str(fixture)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env={**os.environ,'PATH':str(fixture/'bin')+os.pathsep+os.environ['PATH']})
        for _ in range(100):
            if ready.exists():break
            time.sleep(.02)
        assert ready.exists();p.send_signal(sig);out,err=p.communicate(timeout=6)
        assert p.returncode==130 and 'sleeper | FAIL | 130' in out and not marker.exists(),(sig,out,err)
    print('PASS timeout: bounded wait and group kill; INT/TERM: exit 130 and no next row')
    # Each row's verdict reaches stderr as the row ends, in exactly the table's form, before the next row starts.
    change_row('sleeper','sleep 20','0.25');change_row('next','true')
    result=run();err=result.stderr.splitlines()
    results=[l[len('RESULT '):] for l in err if l.startswith('RESULT ')]
    table_rows=[l for l in result.stdout.splitlines() if l.startswith(('tsc |','sleeper |','next |'))]
    assert results==table_rows and len(results)==3,(results,table_rows)
    assert err.index('RESULT '+table_rows[1]) < err.index('Checking next'),err
    assert any(l.startswith('Evidence folder ') for l in err[:1]),err
    table([('missing',0,'node','*','data/baked/terrain/manifest.json')])
    err=run().stderr.splitlines();skip='RESULT missing | SKIP | 2 | 0.00 | missing data/baked/terrain/manifest.json'
    assert skip in err and err.index(skip) > err.index('Checking missing: SKIP (missing data/baked/terrain/manifest.json)'),err
    # A run killed outright (SIGKILL: no handler, no final table) still leaves the verdicts of finished rows.
    table([('first',1,'node','*',''),('sleeper',0,'node','*','')])
    group=fixture/'group.pid';ready.unlink(missing_ok=True)
    change_row('sleeper','echo $$ > '+shlex.quote(str(group))+'; touch '+shlex.quote(str(ready))+'; sleep 30')
    p=subprocess.Popen([sys.executable,'-c',code,str(ROOT/'tools/check-all.py'),str(fixture)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env={**os.environ,'PATH':str(fixture/'bin')+os.pathsep+os.environ['PATH']})
    try:
        for _ in range(150):
            if ready.exists():break
            time.sleep(.02)
        assert ready.exists();p.kill();out,err=p.communicate(timeout=6)
    finally:
        # Never leave the runner or the sleeper's own process group behind, even when an assertion fails.
        p.kill();p.wait()
        try: os.killpg(int(group.read_text()),signal.SIGKILL)
        except (FileNotFoundError, ValueError, ProcessLookupError): pass
    assert p.returncode==-signal.SIGKILL and 'check | result' not in out,(p.returncode,out)
    assert 'RESULT first | FAIL | 1 |' in err and 'reason-first' in err and 'RESULT sleeper' not in err,err
    folder=Path(next(l for l in err.splitlines() if l.startswith('Evidence folder '))[len('Evidence folder '):])
    assert 'reason-first' in (folder/'first.log').read_text()
    print('PASS progress: RESULT line per row (same as the table, SKIP too); SIGKILL keeps finished verdicts and the log folder')
    table([('sleeper',0,'node','*',''),('next',0,'node','*','')]);change_row('next','touch '+shlex.quote(str(marker)))
    # Six subshells, each with two sleeps: exercise the macOS zombie-group race 40 times per mode.
    for mode in ['timeout', signal.SIGINT, signal.SIGTERM]:
        for iteration in range(40):
            marker=fixture/'next-ran';marker.unlink(missing_ok=True);ready.unlink(missing_ok=True)
            command='for n in 1 2 3 4 5 6; do (sleep 2 & sleep 2 & wait) & done; touch '+shlex.quote(str(ready))+'; wait'
            change_row('sleeper',command,'0.08' if mode=='timeout' else '600')
            p=subprocess.Popen([sys.executable,'-c',code,str(ROOT/'tools/check-all.py'),str(fixture)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env={**os.environ,'PATH':str(fixture/'bin')+os.pathsep+os.environ['PATH']})
            if mode!='timeout':
                for _ in range(150):
                    if ready.exists():break
                    time.sleep(.02)
                assert ready.exists(),mode
                p.send_signal(mode)
            out,err=p.communicate(timeout=6)
            assert 'Traceback' not in out+err and 'check | result | exit code' in out,(mode,iteration,out,err)
            if mode=='timeout':assert p.returncode==1 and marker.exists() and 'next | PASS' in out,(mode,iteration,out,err)
            else:assert p.returncode==130 and not marker.exists(),(mode,iteration,out,err)
        print('PASS many-process '+str(mode)+': 40/40; no tracebacks; table printed')

    # Actual helper dependency closures, not additions from hand-written globs.
    spec=importlib.util.spec_from_file_location('real_checks',ROOT/'tools/check-all.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    with (ROOT/'tools/checks.tsv').open() as f: checks=list(csv.DictReader(f,delimiter='\t'))
    scan=module.DependencyScan(ROOT);deps={c['name']:scan.command(c['command']) for c in checks}
    def selected(path):return {name for name,inputs in deps.items() if path in inputs}
    assert {'phone','roads-key','sxs','trailer','truck'} <= selected('tools/phone-ground.mjs')
    assert {'explore-browser-mutations','bike-browser-mutations','trailer-review-browser'} <= selected('tools/mutation-session.mjs')
    assert {'store','store-mutations'} <= selected('tools/pack_terrain.py')
    for helper,count in [('truck-cdp.mjs',19),('shift-fixture.mjs',8)]:
        importers={str(p.relative_to(ROOT)) for p in (ROOT/'tools').glob('*.mjs') if "./"+helper in p.read_text()}
        assert len(importers)==count,(helper,importers)
        covered=set().union(*(deps[name] for name in selected('tools/'+helper)))
        for importer in importers: assert 'tools/'+helper in scan.command('node '+importer),importer
        executable=importers-{str(Path('tools')/name) for name in module.IGNORE}
        assert executable <= covered,(helper,executable-covered)
    print('PASS five helper dependency selections, including 19 truck-cdp and 8 shift-fixture importers')

    # A real tiny Git fixture proves --changed includes untracked input files.
    table([('untracked',0,'node','new-input.bin','')])
    (fixture/'.gitignore').write_text('*\n!new-input.bin\n')
    subprocess.run(['git','init','-q',str(fixture)],check=True)
    subprocess.run(['git','-C',str(fixture),'-c','core.hooksPath=/dev/null','-c','commit.gpgSign=false','-c','user.name=RunnerTest','-c','user.email=fixture@example.invalid','commit','--allow-empty','-qm','fixture'],check=True)
    subprocess.run(['git','-C',str(fixture),'update-ref','refs/remotes/origin/main','HEAD'],check=True)
    (fixture/'new-input.bin').write_text('untracked')
    expect(['--changed'],0,('untracked | PASS',))
    print('PASS untracked --changed input')
    for orphan in ['orphan-check.mjs','check-orphan.py','check_orphan.py','orphan-browser.mjs','orphan-regressions.sh','check-orphan.mjs','orphan-check.py','orphan-suite.mjs','orphan-shots.sh']:
        path=fixture/'tools'/orphan;path.touch();result=run('--list');assert result.returncode==1 and ('UNREGISTERED check: '+orphan) in result.stderr;path.unlink()
    (fixture/'tools/orphan-check.mjs').touch()
    result=run('--list');assert result.returncode==1 and 'UNREGISTERED check: orphan-check.mjs' in result.stderr
print('PASS runner: one tsc, default/quick/browser/only/coverage selection, unknown names, inventory drift, exit precedence and missing data')
