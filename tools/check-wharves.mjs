import {build} from '../web/node_modules/esbuild/lib/main.js';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),dir=mkdtempSync(join(tmpdir(),'mmm-wharf-'));
const mutants=[
 ['off outline','e:x,n:y,height:h','e:x+500,n:y,height:h','wharf-plan'],
 ['wrong height','height:h,angle','height:h+1,angle','wharf-plan'],
 ['underwater allowed','h<sea+.3','h<sea-20','wharf-plan'],
 ['winding ignored','+(sign===1?Math.PI:0)','','wharf-plan'],
 ['stack floats','length:1,lift,slope:0});','length:1,lift:lift+1,slope:0});','wharf-plan'],
 ['reversed instance rotation','set(0,-p.angle,Math.atan(p.slope))','set(0,p.angle,Math.atan(p.slope))','wharves'],
 ['north flip','this.village[1]-p.n','p.n-this.village[1]','wharves'],
 ['level curb','Math.atan(p.slope)','0','wharves'],
 ['detached mount','m.box(x,.18,-.55,.07,.07,.9,METAL)','m.box(x,.18,-1,.07,.07,.1,METAL)','wharves'],
 ['buildings ignored','if(!near.length)return ()=>false;','return ()=>false;','wharf-plan'],
 ['building margin dropped','<margin)return true','<0)return true','wharf-plan'],
 ['kit ignores buildings','this.sea,st.blocked)','this.sea)','wharves'],
 ['re-plan every frame',"if(stamp===''||stamp===st.stamp)continue;","if(stamp==='')continue;",'wharves'],
 ['never re-plan',"if(stamp===''||stamp===st.stamp)continue;","if(stamp===''||st.stamp!=='')continue;",'wharves'],
 ['clear when not drawn',"if(stamp===''||stamp===st.stamp)continue;","if(stamp===st.stamp)continue;",'wharves'],
 ['buried curb','m.box(0,.04,0,1,.32,.24','m.box(0,-.14,0,1,.28,.24','wharves'],
];
try{
 for(const [label,from,to,file] of [['baseline',null,null],...(process.argv.includes('--mutations')?mutants:[])]){
  let changed=false;
  await build({entryPoints:[join(root,'tools/wharf-cases.mjs')],bundle:true,platform:'node',format:'esm',outfile:join(dir,'check.mjs'),logLevel:'silent',plugins:[{name:'read-baked-png',setup(b){
   b.onLoad({filter:/\/web\/src\/(terrain|wharf-plan|wharves)\.ts$/},args=>{
    let source=readFileSync(args.path,'utf8');
    if(args.path.endsWith('/terrain.ts'))source=source.replace(/async function readPng\(base: string, path: string\): Promise<Uint8ClampedArray> \{[\s\S]*?\n\}/,'async function readPng(base:string,path:string):Promise<Uint8ClampedArray>{return globalThis.__wharfPng(base,path);}');
    else if(from&&args.path.endsWith('/'+file+'.ts')){assert.ok(source.includes(from),'missing mutation anchor '+label);source=source.replaceAll(from,to);changed=true;}
    return {contents:source,loader:'ts'};
   });
  }}]});
  const run=spawnSync(process.execPath,[join(dir,'check.mjs')],{cwd:root,env:{...process.env,WHARF_ROOT:root},encoding:'utf8',timeout:180000});
  if(!from){process.stdout.write(run.stdout);process.stderr.write(run.stderr);assert.equal(run.status,0,'baseline');}
  else{assert.ok(changed);assert.equal(run.status,1,label+' must fail an assertion');assert.match(run.stderr,/AssertionError/);console.log('KILLED '+label);}
 }
}finally{rmSync(dir,{recursive:true,force:true});}
