// Pure path/entrypoint checks. No bake, mkdir or writer runs against protected paths.
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname,basename} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';
import {tmpdir} from 'node:os';

const root=resolve(import.meta.dirname,'..'),ref=process.env.SIDEWALK_WORK_ROOT_SOURCE_REF;
const read=file=>ref?execFileSync('git',['show',ref+':'+file],{cwd:root,encoding:'utf8'}):readFileSync(resolve(root,file),'utf8');
const js=read('tools/sidewalks-low-bake.mjs'),python=read('tools/sidewalks_bake.py');
const start=js.indexOf('export function assertWorkRoot('),end=js.indexOf('export function bakeLow(');
assert.ok(start>=0&&end>start);
const source=js.slice(start,end).replace('export function','function').replace("resolve(import.meta.dirname,'..')",'SOURCE_ROOT');
function guard(text){
  return runInNewContext('('+text+')',{
    assert,resolve,dirname,basename,SOURCE_ROOT:'/fixture/worktree',existsSync:()=>true,
    realpathSync:p=>p==='/fixture/worktree/data/baked'?'/fixture/overlay/data/baked':p,
    execFileSync:(command,args)=>{assert.equal(command,'git');assert.ok(args.includes('--git-common-dir'));return '/fixture/primary/.git\n';}
  });
}
function primaryPaths(fn){
  for(const path of ['/fixture/primary','/fixture/primary/web/out','/fixture/primary/data/baked/out','/fixture/primary/data/site/out'])
    assert.throws(()=>fn(path),/primary|baked\/site/,'primary protected work root '+path);
}
primaryPaths(guard(source));
const protection=",...['web','data/baked','data/site'].map(p=>resolve(primaryRoot,p))";
assert.ok(source.includes(protection),'primary protection mutation anchor');
assert.throws(()=>primaryPaths(guard(source.replace(protection,''))),/primary protected work root/);
console.log('PASS pure primary paths with a separate selected overlay; removed-primary-protection mutant FAILS');

// Execute only the real Python CLI block in a sandbox. Every output method and
// the bake itself are replaced with a rejecting stub, not a real filesystem call.
const entrypoint=String.raw`
import ast,copy,sys,types
from pathlib import Path
tree=ast.parse(sys.stdin.read())
main=next(n for n in tree.body if isinstance(n,ast.If) and ast.unparse(n.test).replace(' ','')=="__name__=='__main__'")
class GuardRejected(Exception):pass
class OutputBeforeGuard(Exception):pass
def output(*a,**k):raise OutputBeforeGuard()
def deny(command,**kwargs):
 assert command==['node','tools/sidewalks-low-bake.mjs','--assert-work-root','/fixture/primary']
 assert kwargs=={'cwd':Path.cwd(),'check':True}
 raise GuardRejected()
class Parser:
 def add_argument(self,*a,**k):pass
 def parse_args(self):return types.SimpleNamespace(check=False,check_cases=False,work_root=Path('/fixture/primary'))
class NoWrites(ast.NodeTransformer):
 def visit_Call(self,node):
  node=self.generic_visit(node)
  if isinstance(node.func,ast.Attribute) and node.func.attr in ['mkdir','write_text','write_bytes','open']:
   node.func=ast.Name(id='output',ctx=ast.Load())
  return node
def check(block):
 env={'argparse':types.SimpleNamespace(ArgumentParser=Parser),'Path':Path,'ROOT':Path.cwd(),
      'subprocess':types.SimpleNamespace(run=deny),'bake':output,'output':output}
 code=ast.fix_missing_locations(NoWrites().visit(ast.Module(body=copy.deepcopy(block.body),type_ignores=[])))
 try:exec(compile(code,'<production CLI; all outputs stubbed>','exec'),env)
 except GuardRejected:return True
 except OutputBeforeGuard:return False
 raise AssertionError('entrypoint did not reach guard')
assert check(main),'Python must reject primary before bake/mkdir/write'
class RemoveGuard(ast.NodeTransformer):
 count=0
 def visit_Expr(self,node):
  if any(isinstance(n,ast.Constant) and n.value=='--assert-work-root' for n in ast.walk(node)):
   self.count+=1;return None
  return self.generic_visit(node)
remove=RemoveGuard();mutant=remove.visit(copy.deepcopy(main));assert remove.count==1
assert not check(mutant),'removed pre-write guard mutant escaped'
print('PASS Python pre-output guard; removed-guard mutant FAILS; all writers stubbed')
`;
process.stdout.write(execFileSync('python3',['-c',entrypoint],{cwd:root,input:python,encoding:'utf8'}));
if(!ref){
  const cli=spawnSync('node',['tools/sidewalks-low-bake.mjs','--assert-work-root',root],{cwd:root,encoding:'utf8'});
  assert.notEqual(cli.status,0);assert.match(cli.stderr,/isolated work root/);
  const probe=resolve(tmpdir(),'mmm-sidewalk-guard-no-write-'+process.pid);assert.equal(existsSync(probe),false);
  execFileSync('node',['tools/sidewalks-low-bake.mjs','--assert-work-root',probe],{cwd:root});
  assert.equal(existsSync(probe),false,'pure guard must not create its output path');
  console.log('PASS real guard CLI rejects source, accepts isolated path without creating it');
}
