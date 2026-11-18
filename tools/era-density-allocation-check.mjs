// Boot the static import graph in both normal and artifact-style inline builds.
import assert from 'node:assert/strict';
import {build} from '../web/node_modules/vite/dist/node/index.js';
import ts from '../web/node_modules/typescript/lib/typescript.js';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync} from 'node:child_process';
const root=process.cwd(),temp=mkdtempSync(join(tmpdir(),'mmm-layout-boot-')),rows=[];
const main=readFileSync('web/src/main.ts','utf8');assert.match(main,/ERA\.id\s*===\s*'1884'\s*\?/,'actual main must guard the era constructor');
try{
 for(const inline of [false,true,'eager-fault']){
  const dir=join(temp,inline===false?'normal':inline===true?'artifact':'eager-fault');
  const entry=`import assert from 'node:assert/strict';import {HistoryScene} from '${root}/web/src/eras/history-scene.ts';import {Roads} from '${root}/web/src/roads.ts';import {readEra} from '${root}/web/src/era.ts';import {historyLayoutState} from '${root}/web/src/eras/history-layout.ts';
const boot=process.argv[2],era=readEra(new URLSearchParams(boot==='era'?'era=1884':''));
assert.equal(globalThis.__densityLayoutLiteralObjects??0,0,'unused layout import must allocate no layout object/array');assert.deepEqual(historyLayoutState(),{decodes:0,hasLayout:false});assert.equal(globalThis.__densityLayoutParses??0,0,'today must not parse layout data');
if(era.id==='1884'){
 globalThis.document={createElement:()=>({getContext:()=>new Proxy({measureText:s=>({width:s.length*80})},{get:(t,k)=>k in t?t[k]:()=>{},set:(t,k,v)=>(t[k]=v,true)})})};
 const terrain={cartRoads:true,manifest:{village:[624271,5103301]},clear:[],coverAt:()=>2},roads=new Roads({roads:[]},terrain.manifest.village,terrain);
 new HistoryScene(terrain,roads,null,[],()=>10);new HistoryScene(terrain,roads,null,[],()=>10);
 assert.deepEqual(historyLayoutState(),{decodes:1,hasLayout:true},'era must parse once across repeated constructors');assert.equal(globalThis.__densityLayoutParses,1);
}else assert.deepEqual(historyLayoutState(),{decodes:0,hasLayout:false},'today must not decode or retain a layout object');
console.log(JSON.stringify({boot,parses:globalThis.__densityLayoutParses??0,materializedLayoutObjects:globalThis.__densityMaterializedLayoutObjects??0,literalObjects:globalThis.__densityLayoutLiteralObjects??0,...historyLayoutState()}));`;
  await build({root:root+'/web',configFile:false,publicDir:false,logLevel:'error',plugins:[{name:'layout-boot-probe',resolveId(id){if(id==='density-boot-entry')return '\0density-boot-entry';},load(id){if(id==='\0density-boot-entry')return entry;},transform(text,id){if(!id.endsWith('/mabou-1884-layout.ts'))return;const ast=ts.createSourceFile(id,text,ts.ScriptTarget.Latest,true),patch=[];const visit=n=>{if(ts.isObjectLiteralExpression(n)||ts.isArrayLiteralExpression(n)){patch.push([n.getStart(ast),'(globalThis.__densityLayoutLiteralObjects++,']);patch.push([n.end,')']);}ts.forEachChild(n,visit);};visit(ast);for(const[at,s]of patch.sort((a,b)=>b[0]-a[0]))text=text.slice(0,at)+s+text.slice(at);return `globalThis.__densityLayoutLiteralObjects??=0;globalThis.__densityLayoutParses??=0;globalThis.__densityMaterializedLayoutObjects??=0;const originalLayoutParse=JSON.parse;JSON.parse=function(value,...args){const result=originalLayoutParse.call(this,value,...args);if(typeof value==='string'&&value.includes('\"farms\":')&&value.includes('\"trades\":')){globalThis.__densityLayoutParses++;const nodes=v=>v&&typeof v==='object'?1+Object.values(v).reduce((n,x)=>n+nodes(x),0):0;globalThis.__densityMaterializedLayoutObjects+=nodes(result);}return result;};\n`+text+(inline==='eager-fault'?'\nJSON.parse(MABOU_1884_LAYOUT_JSON);':'');}}],build:{outDir:dir,emptyOutDir:true,target:'es2022',minify:false,rollupOptions:{input:'density-boot-entry',external:['node:assert/strict'],output:{inlineDynamicImports:!!inline,entryFileNames:'probe.mjs',format:'es'}}}});
  for(const boot of ['today','era']){const r=spawnSync(process.execPath,[join(dir,'probe.mjs'),boot],{encoding:'utf8',env:process.env});if(inline==='eager-fault'){assert.notEqual(r.status,0,'eager decode fault must be rejected');assert.match(r.stderr,/unused layout import|today must not parse layout data/);break;}assert.equal(r.status,0,r.stderr);const value=JSON.parse(r.stdout.trim());assert.equal(value.boot,boot);assert.equal(value.parses,boot==='era'?1:0);assert.equal(value.hasLayout,boot==='era');if(boot==='today')assert.equal(value.materializedLayoutObjects,0);rows.push({build:inline?'artifact-inline':'normal',...value});}
 }
 if(process.env.DENSITY_ALLOCATION_OUT)writeFileSync(process.env.DENSITY_ALLOCATION_OUT,JSON.stringify(rows,null,2));console.log('PASS layout boot allocation',JSON.stringify(rows));
}finally{rmSync(temp,{recursive:true,force:true});}
