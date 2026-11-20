import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync,writeFileSync,mkdirSync,mkdtempSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
import {areas,areaBase,sha} from './sidewalks-low-bake.mjs';
const root=resolve(import.meta.dirname,'..'),out=mkdtempSync(resolve(root,'data/work/checks/checks-sidewalk-size-')),baseRef=process.env.SIDEWALK_SIZE_BASE_REF??'origin/main';
const limit=32768,gz=b=>gzipSync(b,{level:9}).length,run=(cmd,args,options={})=>execFileSync(cmd,args,{cwd:root,stdio:'pipe',maxBuffer:32*1024*1024,...options});
// The published script is app.js and its chunks (web/area-chunks-build.ts); an older build has app.js alone. Count all of it.
const scripts=dir=>Buffer.concat([readFileSync(dir+'/app.js'),...(existsSync(dir+'/chunks')?readdirSync(dir+'/chunks').filter(n=>n.endsWith('.js')).sort().map(n=>readFileSync(dir+'/chunks/'+n)):[])]);
const base=resolve(out,'source-main');let created=false;const report={baseRef,limit,flags:{MMM_PUBLIC:'1',VITE_MP:'1'},builds:[]};
try{
 run('git',['worktree','add','--detach',base,baseRef]);created=true;report.resolvedBase=run('git',['rev-parse','HEAD'],{cwd:base}).toString().trim();run('ln',['-s',resolve(root,'web/node_modules'),base+'/web/node_modules']);
 for(const [label,source]of [['main',base],['head',root]]){
  const dest=resolve(out,label);mkdirSync(dest,{recursive:true});const env={...process.env,MMM_PUBLIC:'1',VITE_MP:'1',ARTIFACT_OUT:dest,SITE_OUT:dest};delete env.MMM_MUTATION;
  writeFileSync(out+'/'+label+'.log',run('npx',['--no-install','vite','build','-c','vite.artifact.config.ts'],{cwd:source+'/web',env}));const b=scripts(dest);report.builds.push({label,raw:b.length,gzip:gz(b),sha256:sha(b)});
 }
 const main=scripts(out+'/main'),head=scripts(out+'/head'),payloads=[];
 for(const area of areas)for(const quality of ['desktop','low'])payloads.push(JSON.parse(readFileSync(resolve(process.env.SIDEWALK_ASSET_WORK_ROOT,`data/baked/${areaBase(area)}/sidewalks-${quality}.json`))).payload);
 function check(a,b){for(const p of payloads)assert.ok(!b.includes(p),'no inlined sidewalk payload');assert.ok(gz(b)-gz(a)<=limit,'SITE script (app.js and chunks) gzip delta exceeds fixed 32768B');}
 check(main,head);assert.throws(()=>check(main,Buffer.concat([head,Buffer.from(JSON.stringify(payloads[0]))])),/inlined/);
 let seed=9843;const bytes=Buffer.alloc(65536);for(let i=0;i<bytes.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;bytes[i]=seed&255;}
 assert.throws(()=>check(main,Buffer.concat([main,Buffer.from('/*'+bytes.toString('base64')+'*/')])),/fixed 32768B/);
 report.delta=gz(head)-gz(main);report.pass=true;console.log('PASS exact public SITE gzip delta',report.delta,'<=',limit,'and no payloads; payload and entropy-growth mutants rejected');
}finally{
 writeFileSync(out+'/size.json',JSON.stringify(report,null,2)+'\n');console.log('Evidence kept at '+out);
 if(created){unlinkSync(base+'/web/node_modules');run('git',['worktree','remove',base]);}
}
