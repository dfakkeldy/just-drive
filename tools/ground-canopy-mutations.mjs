import assert from 'node:assert/strict';
import {build} from '../web/node_modules/esbuild/lib/main.js';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
const root=process.cwd(),source=readFileSync('web/src/terrain.ts','utf8');
const edits=[
 ['canopy node clearing omitted','if(clearsGroundTrees(this.groundClassAt(x,z))){c=0;px[k*4+2]=0;}',''],
 ['averaging regrows a cleared hull','if(this.groundCover&&clearsGroundTrees(this.groundClassAt(t.x0+ga*mpp,t.z0+gb*mpp)))c=0;',''],
 ['unconfirmed canopy cleared','if(clearsGroundTrees(this.groundClassAt(x,z))){c=0;px[k*4+2]=0;}','if(true){c=0;px[k*4+2]=0;}'],
];
const dir=mkdtempSync(tmpdir()+'/mmm-ground-canopy-');
try{
 for(const [name,from,to]of edits){
  assert.equal(source.split(from).length,2,name+' anchor');
  await build({entryPoints:['tools/ground-canopy-check.mjs'],bundle:true,platform:'node',format:'esm',outfile:dir+'/mutant.mjs',logLevel:'silent',plugins:[{name:'canopy-mutant',setup(b){b.onLoad({filter:/\/terrain\.ts$/},()=>({contents:source.replace(from,to),loader:'ts',resolveDir:root+'/web/src'}));}}]});
  const run=spawnSync(process.execPath,[dir+'/mutant.mjs'],{cwd:root+'/web',encoding:'utf8'});
  assert.equal(run.status,1,'SURVIVED '+name+'\n'+run.stderr);assert.match(run.stderr,/AssertionError/,'mutant must fail its ground assertion');
  console.log('KILLED production terrain',name);
 }
}finally{rmSync(dir,{recursive:true,force:true});}
