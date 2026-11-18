#!/usr/bin/env python3
"""Repeatable all-address, identity, kill, slot and multi-checkout proofs.

All concurrency uses tiny HTTP stand-ins through the production startup path.
No real browser is started by this script. Every run uses a private slot registry
and OS-selected free ports (hash-default tests select free, distinct pairs). --ownership omits slot tests; --slots omits address/checkout tests.
"""
import argparse
import concurrent.futures
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import shlex
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
sys.dont_write_bytecode=True
import browser_process as bp

ROOT=Path(__file__).resolve().parent.parent
# A cheap copy-on-write clone: macOS clonefile (cp -c); GNU cp reflinks where the file system can (btrfs).
CLONE=['cp','-c'] if sys.platform=='darwin' else ['cp','--reflink=auto']
BASE={k:v for k,v in os.environ.items() if k not in ['WEB_PORT','CDP_PORT','SOFTWARE_GL','MMM_CHECK_SUPERVISOR','MMM_CHECK_PORTS_LOCKED','CHROMIUM_BIN','MMM_BROWSER_SLOTS','MMM_BROWSER_WAIT','MMM_BROWSER_OVERFLOW']}
parser=argparse.ArgumentParser(); parser.add_argument('--ownership',action='store_true'); parser.add_argument('--slots',action='store_true'); parser.add_argument('--minute',action='store_true'); parser.add_argument('--listeners',action='store_true'); parser.add_argument('--kill-everything',action='store_true')
args=parser.parse_args(); trees=[]; jobs=[]


def until(condition, seconds=12):
    end=time.monotonic()+seconds
    while time.monotonic()<end:
        if condition():return
        time.sleep(.08)
    raise AssertionError('fixture timeout\n'+'\n'.join(j['log'].read_text()[-1600:] for j in jobs))


def load(path):
    try:return json.loads(Path(path).read_text())
    except (OSError,ValueError):return None


with tempfile.TemporaryDirectory(prefix='mmm-g4-runtime-') as directory:
    tmp=Path(directory)
    BASE['MMM_BROWSER_SLOT_DIR']=str(tmp/'slots'); BASE['TMPDIR']=str(tmp)
    BASE['MMM_CHECK_PORT_DIR']=str(tmp/'port-locks'); BASE['PYTHONDONTWRITEBYTECODE']='1'; BASE['OUT']=str(tmp)
    os.environ['MMM_BROWSER_SLOT_DIR']=BASE['MMM_BROWSER_SLOT_DIR']
    used_ports=set()
    def free_port():
        while True:
            with socket.socket() as listener:
                listener.bind(('127.0.0.1',0)); port=listener.getsockname()[1]
            if port in used_ports: continue
            used_ports.add(port)
            # A listener on another address (a VPN tunnel, IPv6) leaves 127.0.0.1 bindable, but the
            # start-up's lsof test sees the port as busy: ask the same question the start-up asks.
            busy=subprocess.run(['lsof','-nP',f'-iTCP:{port}','-sTCP:LISTEN','-t'],capture_output=True,text=True,timeout=5).stdout.strip()
            if not busy: return port
    def free_pair(): return (free_port(),free_port())
    def start(name, slot=2, ports='free', root=ROOT, script='check-browser-fixture.sh', hold=120000, env=None, barrier=None, ignore_signal=None):
        if ports=='free':ports=free_pair()
        state=tmp/(name+'.json'); log=tmp/(name+'.log')
        environment={**BASE,'MMM_CHECK_STANDIN':'1','CHROMIUM_BIN':str(root/'tools/check-browser-standin.py'),
                     'MMM_BROWSER_SLOTS':str(slot),'MMM_BROWSER_WAIT':'30','MMM_PROOF_STATE':str(state),
                     'OUT':str(tmp),'PROBE_HOLD_MS':str(hold),'RUN':'check-ports-probe.mjs','VIEWS':'proof|x=1'}
        if ports:environment.update(WEB_PORT=str(ports[0]),CDP_PORT=str(ports[1]))
        if env:environment.update(env)
        if barrier:barrier.wait()
        command=['/bin/bash',str(root/'tools'/script),*(['--phone'] if script=='check-budget.sh' else ['600','400'])]
        if ignore_signal:command=['/bin/bash','-c',f'trap "" {ignore_signal}; exec "$@"','ignored-entry',*command]
        with log.open('w') as stream:
            process=subprocess.Popen(command,cwd=root,env=environment,stdout=stream,stderr=subprocess.STDOUT,start_new_session=True)
        job={'process':process,'state':state,'log':log,'name':name};jobs.append(job);return job
    def ready(job):return load(job['state'])
    def finish(job, code=0):
        result=job['process'].wait(timeout=15)
        assert result==code,(job['name'],result,job['log'].read_text())
    def stop(job):
        value=ready(job)
        if value:bp.signal_pid(value['owner'],signal.SIGTERM)
        elif job['process'].poll() is None:job['process'].terminate()
        try:job['process'].wait(timeout=12)
        except subprocess.TimeoutExpired:os.killpg(job['process'].pid,signal.SIGKILL);job['process'].wait()
    def role_records(value):return [v for p in Path(value['lease']).glob('resource-*.json') if (v:=load(p))]
    def no_resource_survives(records):return all(bp.members(record)==[] for record in records)
    def fresh_slot(name):
        job=start(name,slot=1,hold=50);until(lambda:ready(job));finish(job)
        assert 'browser-slots: waiting' not in job['log'].read_text(),job['log'].read_text()

    def kill_everything(strategy):
        job=start('kill-all-'+strategy,slot=1);until(lambda:ready(job))
        # A record is written twice: 'starting' (no process yet), then 'running'. Under heavy load the first
        # read can see 'starting'; wait until all three resources have their process recorded.
        value=ready(job);until(lambda:len(rs:=role_records(value))==3 and all('process' in r for r in rs));records=role_records(value)
        victims={r['watchdog']['pid']:r['watchdog'] for r in records}
        for saved in [value['keeper'],*value['owners']]:victims[saved['pid']]=saved
        # Freeze only our recorded guardians first, so none can clean up the orphans early.
        for saved in victims.values():bp.signal_pid(saved,signal.SIGSTOP)
        for saved in victims.values():bp.signal_pid(saved,signal.SIGKILL)
        job['process'].wait(timeout=5)
        until(lambda:all(bp.alive(v) is False for v in victims.values()),5)
        assert any(bp.members(r) for r in records),'fixture must leave actual resource orphans'
        # Find an actual orphan's listening port rather than choosing a fixed port.
        diagnostic=None
        for r in records:
            result=subprocess.run(['lsof','-nP','-a','-p',str(r['process']['pid']),'-iTCP','-sTCP:LISTEN','-Fn'],capture_output=True,text=True)
            for line in result.stdout.splitlines():
                if line.startswith('n'):
                    port=line.rsplit(':',1)[1]
                    probe=subprocess.run([sys.executable,str(ROOT/'tools/check-ports.py'),'--probe',port,str(free_port())],env=BASE,capture_output=True,text=True)
                    assert probe.returncode==2 and 'proven-dead repository run' in probe.stderr and value['lease'] in probe.stderr,probe.stderr
                    diagnostic=probe.stderr.strip();break
            if diagnostic:break
        assert diagnostic
        if strategy=='manual':
            for helper in [('browser_process.py','stop'),('browser-slots.py','reap')]:
                result=subprocess.run([sys.executable,str(ROOT/'tools'/helper[0]),helper[1],value['lease']],env=BASE,capture_output=True,text=True)
                assert result.returncode==0,result.stderr
        else:
            fresh_slot('prune-recovers-all')
        until(lambda:no_resource_survives(records),8)
        until(lambda:not Path(value['lease']).exists(),8)
        if strategy=='manual':fresh_slot('after-manual-all')
        print(diagnostic,flush=True)
        print(f'PASS KILL-EVERYTHING {strategy}: recorded orphans stopped, profile/lease gone, next slot usable',flush=True)

    def foreign_race(root, mutant=False):
        pair=free_pair();marker=tmp/('race-server-'+str(pair[0]))
        job=start('foreign-race-'+str(pair[0]),root=root,ports=pair,env={'MMM_PROOF_DELAY_SERVER':str(marker),'EXPECT_CHECKOUT':'checkout-alpha'})
        until(lambda:marker.exists())
        foreign=subprocess.Popen([str(ROOT/'tools/check-browser-standin.py'),'server',str(pair[0]),str(ROOT)],env=BASE,stdout=subprocess.DEVNULL,start_new_session=True)
        saved=bp.identity(foreign.pid)
        try:
            def browser_up():
                try:
                    with urllib.request.urlopen(f'http://127.0.0.1:{pair[1]}/json/version',timeout=.5):return True
                except OSError:return False
            until(browser_up)
            # A false --owned result reaches readiness quickly; a correct result cannot.
            end=time.monotonic()+4
            while time.monotonic()<end and not ready(job):time.sleep(.05)
            assert bool(ready(job))==mutant,job['log'].read_text()
            stop(job);assert bp.alive(saved) is True
            print('PASS foreign-after-probe: '+('always-owned mutant detected' if mutant else 'foreign readiness rejected; listener survives cleanup'),flush=True)
        finally:bp.signal_pid(saved,signal.SIGTERM);foreign.wait(timeout=3)

    try:
        if args.kill_everything:
            kill_everything('automatic');kill_everything('manual')
        elif not args.slots:
            for family,address in [(socket.AF_INET,'0.0.0.0'),(socket.AF_INET,'127.0.0.1'),(socket.AF_INET6,'::'),(socket.AF_INET6,'::1')]:
                for occupied_role in [0,1]:
                    listener=socket.socket(family,socket.SOCK_STREAM)
                    if family==socket.AF_INET6:listener.setsockopt(socket.IPPROTO_IPV6,socket.IPV6_V6ONLY,1)
                    listener.bind((address,0));listener.listen();occupied=listener.getsockname()[1]
                    pair=list(free_pair());pair[occupied_role]=occupied
                    try:
                        for script in ['yard-shots.sh','props-shots.sh','check-budget.sh','check-trees.sh','check-pwa.sh']:
                            job=start('busy-'+str(occupied)+'-'+address.replace(':','v')+'-'+script,ports=pair,script=script,hold=0)
                            finish(job,2)
                            text=job['log'].read_text().strip()
                            assert text==f'port {occupied} is in use: another check is running; set WEB_PORT and CDP_PORT',text
                        print(f'PASS listener {address} role {occupied_role}: all five starters refuse exit 2',flush=True)
                    finally:listener.close()
            if args.listeners:raise SystemExit(0)
            race_ports=free_pair()
            barrier=threading.Barrier(2)
            with concurrent.futures.ThreadPoolExecutor(2) as pool:
                launched=list(pool.map(lambda n:start('race-'+str(n),ports=race_ports,hold=1500,barrier=barrier),range(2)))
            results=[j['process'].wait(timeout=15) for j in launched]
            assert sorted(results)==[0,2],[(r,j['log'].read_text()) for r,j in zip(results,launched)]
            assert any('PROBE browser survived to end' in j['log'].read_text() for j in launched)
            print('PASS simultaneous same ports: exactly one exit 0, one exit 2; winner survives',flush=True)
            roots=[]
            for label in ['checkout-alpha','checkout-beta']:
                suffix=0
                while True:
                    tree=tmp/(label+('-'+str(suffix) if suffix else ''))
                    checksum=int(subprocess.check_output(['cksum'],input=str(tree),text=True).split()[0])%380
                    pair=(5600+checksum,9600+checksum)
                    probe=subprocess.run([sys.executable,str(ROOT/'tools/check-ports.py'),'--probe',*map(str,pair)],capture_output=True)
                    if not any(p in used_ports for p in pair) and probe.returncode==0:break
                    suffix+=1
                used_ports.update(pair)
                label=tree.name
                subprocess.run(['git','worktree','add','--detach',str(tree),'HEAD'],cwd=ROOT,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);trees.append(tree)
                for source in (ROOT/'tools').rglob('*'):
                    if source.is_file() and not source.is_symlink() and '__pycache__' not in source.parts:
                        dest=tree/source.relative_to(ROOT);dest.parent.mkdir(exist_ok=True,parents=True)
                        subprocess.run([*CLONE,str(source),str(dest)],check=True)
                # A clean clone (CI) has no data/: a link would dangle and the starter's mkdir under it fails, so give an empty folder.
                if (ROOT/'data').is_dir(): (tree/'data').symlink_to((ROOT/'data').resolve())
                else: (tree/'data').mkdir()
                (tree/'web/node_modules').symlink_to((ROOT/'web/node_modules').resolve())
                fixture=tree/'tools/check-ports-probe.html';fixture.write_text(fixture.read_text().replace('checkout-alpha',label));roots.append(tree)
            barrier=threading.Barrier(2)
            with concurrent.futures.ThreadPoolExecutor(2) as pool:
                launched=list(pool.map(lambda tree:start(tree.name,ports=None,root=tree,script='props-shots.sh',hold=500,env={'EXPECT_CHECKOUT':tree.name},barrier=barrier),roots))
            default_ports=[]
            for job,tree in zip(launched,roots):
                finish(job);text=job['log'].read_text();assert f'own checkout={tree.name}' in text,text
                default_ports.append(text.split('PROBE own checkout=')[1].split('WEB=')[1].split()[0])
                print('PASS props '+next(line for line in text.splitlines() if 'PROBE own checkout=' in line),flush=True)
            assert len(set(default_ports))==2
            foreign_race(ROOT)
            mutant=roots[0]/'tools/check-ports.py'
            original=mutant.read_text();mutant.write_text(original.replace("if sys.argv[1] == '--owned':", "if sys.argv[1] == '--owned':\n        return 0",1))
            foreign_race(roots[0],mutant=True);mutant.write_text(original)
            failed=start('cannot-start',hold=0,env={'CHROMIUM_BIN':str(tmp/'missing-browser')})
            finish(failed,2)
            assert list(tmp.glob('browser-logs-*/browser.log'))
            print('PASS browser cannot start: exit 2; browser/Vite logs retained in OUT',flush=True)

            profile=tmp/'foreign';profile.mkdir()
            foreign_port=free_port()
            foreign=subprocess.Popen([str(ROOT/'tools/check-browser-standin.py'),'--remote-debugging-port='+str(foreign_port),'--user-data-dir='+str(profile)],stdout=subprocess.DEVNULL,start_new_session=True)
            saved=bp.identity(foreign.pid)
            try:
                def version():
                    try:
                        with urllib.request.urlopen(f'http://127.0.0.1:{foreign_port}/json/version',timeout=.5) as reply:return reply.read()
                    except OSError:return None
                until(lambda:version());before=version()
                job=start('foreign-refusal',ports=(free_port(),foreign_port));finish(job,2)
                assert version()==before and bp.alive(saved) is True
                print('PASS foreign browser stand-in: refused exit 2; endpoint unchanged, PID alive',flush=True)
            finally:bp.signal_pid(saved,signal.SIGTERM);foreign.wait(timeout=3)

            for mode in ['TERM','INT','KILL','GROUP-KILL','KEEPER-KILL','INT-IGNORED','TERM-IGNORED']:
                job=start('kill-'+mode,slot=1,ignore_signal=mode.split('-')[0] if mode.endswith('-IGNORED') else None);until(lambda:ready(job))
                value=ready(job);until(lambda:len(role_records(value))==3)
                records=role_records(value)
                if mode=='GROUP-KILL':os.killpg(job['process'].pid,signal.SIGKILL)
                elif mode=='KEEPER-KILL':assert bp.signal_pid(value['keeper'],signal.SIGKILL)
                else:assert bp.signal_pid(value['owner'],getattr(signal,'SIG'+mode.split('-')[0]))
                until(lambda:no_resource_survives(records),8)
                until(lambda:not Path(value['lease']).exists(),8)
                job['process'].wait(timeout=10)
                fresh_slot('after-'+mode)
                print(f'PASS {mode}: browser, Vite and check descendants gone; lease removed; next run gets slot',flush=True)

            fake_bin=tmp/'bin';fake_bin.mkdir();stamp=tmp/'ps-called'
            fake_ps=fake_bin/'ps';fake_ps.write_text(f'#!/bin/sh\necho called > "{stamp}"\nsleep 5\n');fake_ps.chmod(0o755)
            start_time=time.monotonic();job=start('slow-ps',hold=100,env={'PATH':str(fake_bin)+':'+BASE['PATH']});finish(job)
            assert not stamp.exists() and time.monotonic()-start_time<8
            print('PASS slow ps (5s fake): no ps invocation, bounded startup/stop, no traceback',flush=True)

            # Preserve stdin and stderr through the real shared command supervisor.
            script=tmp/'stdio.sh'
            script.write_text('set -euo pipefail\nROOT='+shlex.quote(str(ROOT))+'\nsource "$ROOT/tools/browser.sh"\nbrowser_ports "$@"\nstart_check 600 400\nrun_check node --input-type=module <<\'JS\'\nconsole.log("PASS heredoc stdin preserved");\nconsole.error("PASS stderr preserved");\nJS\nrun_check node "$ROOT/tools/check-cdp.mjs" --late\n')
            environment={**BASE,'WEB_PORT':str(free_port()),'CDP_PORT':str(free_port()),'MMM_CHECK_STANDIN':'1','CHROMIUM_BIN':str(ROOT/'tools/check-browser-standin.py'),'MMM_BROWSER_SLOTS':'0'}
            result=subprocess.run(['/bin/bash',str(script)],env=environment,capture_output=True,text=True,timeout=20,start_new_session=True)
            assert result.returncode==1,(result.returncode,result.stdout,result.stderr)
            assert 'PASS heredoc stdin preserved' in result.stdout and 'PASS the page settled' in result.stdout
            assert 'PASS stderr preserved' in result.stderr and 'check-cdp.mjs: page error: late fixture page error' in result.stderr
            print('PASS supervised heredoc stdin/stderr preserved; late page error prints check/reason and exits 1',flush=True)

            stream_script=tmp/'stream.sh'
            worker=tmp/'stream.py'
            worker.write_text('import time,sys\nstart=time.monotonic();print("START",start,flush=True)\ntime.sleep(.6);print("at .6",flush=True);print("err .6",file=sys.stderr,flush=True)\ntime.sleep(2.4);print("at 3",flush=True)\ntime.sleep(60)\n')
            stream_script.write_text('set -euo pipefail\nROOT='+shlex.quote(str(ROOT))+'\nsource "$ROOT/tools/browser.sh"\nbrowser_ports "$@"\nstart_check 600 400\npython3 - "$BROWSER_SLOT_LEASE" "$MMM_PROOF_STATE" <<\'PY_STATE\'\nimport json,pathlib,sys\np=pathlib.Path(sys.argv[2]);v=json.loads((pathlib.Path(sys.argv[1])/"ready.json").read_text());p.write_text(json.dumps(v))\nPY_STATE\nrun_check python3 '+shlex.quote(str(worker))+'\n')
            pair=free_pair();state=tmp/'stream-state.json'
            env={**BASE,'WEB_PORT':str(pair[0]),'CDP_PORT':str(pair[1]),'MMM_CHECK_STANDIN':'1','CHROMIUM_BIN':str(ROOT/'tools/check-browser-standin.py'),'MMM_BROWSER_SLOTS':'0','MMM_PROOF_STATE':str(state),'OUT':str(tmp)}
            stream=subprocess.Popen(['/bin/bash',str(stream_script)],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
            captured=[];errors=[]
            def collect(pipe,dest):
                for line in pipe:dest.append((time.monotonic(),line))
            threads=[threading.Thread(target=collect,args=(stream.stdout,captured)),threading.Thread(target=collect,args=(stream.stderr,errors))]
            for thread in threads:thread.start()
            until(lambda:any('START ' in line for _,line in captured))
            began=float(next(line.split()[1] for _,line in captured if line.startswith('START ')))
            until(lambda:any('at .6' in line for _,line in captured),1.5)
            visible=next(at for at,line in captured if line.strip()=='at .6')-began
            assert visible<1.5,visible
            time.sleep(max(0,began+4-time.monotonic()));assert bp.signal_pid(load(state)['owner'],signal.SIGTERM)
            assert stream.wait(timeout=10)==143
            for thread in threads:thread.join(timeout=3)
            assert any('at 3' in line for _,line in captured) and any('err .6' in line for _,line in errors)
            print(f'PASS streaming: .6s line visible at {visible:.2f}s; pre-TERM stdout/stderr retained after TERM at 4s',flush=True)

            child=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)'],start_new_session=True);saved=bp.identity(child.pid)
            try:
                reused={**saved,'start':[0,0] if isinstance(saved['start'],list) else '-1'}
                assert bp.alive(reused) is False and not bp.signal_pid(reused,signal.SIGKILL) and bp.alive(saved) is True
                spec=importlib.util.spec_from_file_location('slot_test',ROOT/'tools/browser-slots.py');slots=importlib.util.module_from_spec(spec);spec.loader.exec_module(slots)
                fake_lease=tmp/'reused-lease';fake_lease.mkdir()
                stale=slots.BASE/'slot-1'
                with slots.registry():
                    slots.prune();assert not stale.exists(),'run the slot proof when the registry is idle'
                    stale.mkdir();bp.write(stale/'owner.json',{'owner':reused,'pid':child.pid,'keeper':bp.identity(os.getpid()),'lease':str(fake_lease),'token':'fixture','checkout':'fixture','started':time.time()})
                    slots.prune();assert not stale.exists()
                old=bp.info;bp.info=lambda pid:None if pid==child.pid else old(pid)
                try:
                    assert bp.alive(saved) is None and not bp.signal_pid(saved,signal.SIGKILL)
                    uncertain={'watchdog':saved,'process':saved,'group':child.pid,'status':'running'}
                    assert bp.members(uncertain) is None and bp.stop_resource(uncertain) is False
                    uncertain_lease=tmp/'uncertain';uncertain_lease.mkdir();bp.write(uncertain_lease/'resource-browser.json',uncertain)
                    assert not bp.stopped(uncertain_lease)
                    assert not slots.release_record(uncertain_lease,{'token':'uncertain','slot':None})
                finally:bp.info=old
                assert bp.alive(saved) is True
                print('PASS PID reuse: stale lease reclaimed; reused PID never signalled; unknown identity stays alive and cannot release its lease',flush=True)
            finally:bp.signal_pid(saved,signal.SIGTERM);child.wait(timeout=3)

            kill_everything('automatic');kill_everything('manual')

        if not args.ownership and not args.kill_everything:
            trio=[start('limited-'+str(n),ports=free_pair()) for n in range(3)]
            until(lambda:sum(bool(ready(j)) for j in trio)==2 and any('browser-slots: waiting' in j['log'].read_text() for j in trio))
            active=[j for j in trio if ready(j)];waiting=next(j for j in trio if not ready(j))
            diagnostic=next(line for line in waiting['log'].read_text().splitlines() if 'browser-slots: waiting' in line)
            assert all(part in diagnostic for part in ['checkout=','pid=','held=']),diagnostic
            stop(active[0]);until(lambda:ready(waiting),5)
            assert active[1]['process'].poll() is None
            stop(active[1]);stop(waiting)
            print(diagnostic,flush=True);print('PASS N=2: two stand-in harnesses run; third starts after one ends',flush=True)
            trio=[start('off-'+str(n),slot=0,ports=free_pair()) for n in range(3)]
            until(lambda:all(ready(j) for j in trio))
            for j in trio:assert 'waiting' not in j['log'].read_text();stop(j)
            print('PASS N=0: three stand-in harnesses run together',flush=True)
            owner=start('cap-owner',slot=1);until(lambda:ready(owner))
            waiter=start('cap-waiter',slot=1,ports=free_pair(),env={'MMM_BROWSER_WAIT':'.5'})
            finish(waiter,2);text=waiter['log'].read_text()
            assert not ready(waiter) and 'ERROR wait cap 0.5s reached' in text and 'not starting a browser' in text and 'running without a slot' not in text,text
            assert ready(owner) and owner['process'].poll() is None
            print('PASS wait cap .5s: default fails with exit 2 and no browser starts, original owner survives',flush=True)
            waiter=start('cap-overflow',slot=1,ports=free_pair(),env={'MMM_BROWSER_WAIT':'.5','MMM_BROWSER_OVERFLOW':'run'})
            until(lambda:ready(waiter),6);assert 'WARNING wait cap 0.5s reached' in waiter['log'].read_text()
            stop(waiter);stop(owner);print('PASS wait cap .5s with MMM_BROWSER_OVERFLOW=run: warning and bypass, original owner survives',flush=True)
            owner=start('fifo-owner',slot=1);until(lambda:ready(owner))
            first=start('fifo-first',slot=1,ports=free_pair());until(lambda:'waiting' in first['log'].read_text())
            second=start('fifo-second',slot=1,ports=free_pair());until(lambda:'waiting' in second['log'].read_text())
            stop(owner);until(lambda:ready(first),5);assert not ready(second)
            stop(first);until(lambda:ready(second),5);stop(second);print('PASS FIFO: older waiter starts first',flush=True)
            for code in [0,1]:
                job=start('exit-'+str(code),hold=50,env={'PROBE_EXIT':str(code)});finish(job,code)
            print('PASS successful and failing child exit codes preserved',flush=True)
            if args.minute:
                owner=start('minute-owner',slot=1);until(lambda:ready(owner))
                waiting=start('minute-waiter',slot=1,ports=free_pair(),env={'MMM_BROWSER_WAIT':'90'})
                until(lambda:waiting['log'].read_text().count('browser-slots: waiting')==2,65)
                notices=[line for line in waiting['log'].read_text().splitlines() if 'browser-slots: waiting' in line]
                assert 'waited=0s' in notices[0] and any('waited='+str(n)+'s' in notices[1] for n in range(60,65))
                stop(owner);until(lambda:ready(waiting),5);stop(waiting)
                print('PASS minute notices: exactly one on entry and one after a minute',flush=True)
        print('PASS all requested stand-in proofs',flush=True)
    finally:
        for job in jobs:
            if job['process'].poll() is None:stop(job)
        for tree in trees:subprocess.run(['git','worktree','remove','--force',str(tree)],cwd=ROOT,check=True,stdout=subprocess.DEVNULL)
