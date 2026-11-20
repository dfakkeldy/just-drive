// The real published build (web/vite.artifact.config.ts) keeps the park out of every other area: all its modules are in
// the quarry-feature chunk, no other chunk holds one, and only main.ts's West Bay import() loads that chunk. A module
// in a chunk that is never fetched never runs (quarry-published-browser sees that in the browser). Two mutants: a park
// module imported by main.ts, and the park chunk imported at once.
import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const root=process.cwd(),web=resolve(root,'web'),work=mkdtempSync(join(tmpdir(),'quarry-deferred-'));
const {build}=await import(resolve(web,'node_modules/vite/dist/node/index.js'));
const {parkModule}=await import('data:text/javascript;base64,'+Buffer.from((await import(resolve(web,'node_modules/esbuild/lib/main.js'))).buildSync({entryPoints:[resolve(web,'quarry-probe-build.ts')],bundle:true,write:false,format:'esm',platform:'node',packages:'external',logLevel:'silent'}).outputFiles[0].text).toString('base64'));
const park=readdirSync(web+'/src').filter(parkModule).map(name=>resolve(web,'src',name)).sort();
assert.equal(park.length,10,'the park is ten modules (web/src/quarry*.ts without quarry-trip.ts)');
const feature=resolve(web,'src/quarry-feature.ts'),main=resolve(web,'src/main.ts');
// mutate: a transform of main.ts, as a mutant would edit it.
async function published(mutate){
  const saved={ARTIFACT_OUT:process.env.ARTIFACT_OUT,MMM_PUBLIC:process.env.MMM_PUBLIC};process.env.ARTIFACT_OUT=work;process.env.MMM_PUBLIC='1';
  process.chdir(web);   // the config's input is relative, as for tools/build_site.sh
  try{
    const result=await build({root:web,configFile:resolve(web,'vite.artifact.config.ts'),logLevel:'silent',build:{write:false},
      plugins:mutate?[{name:'quarry-deferred-mutant',enforce:'pre',transform(code,id){return id===main?mutate(code):null;}}]:[]});
    return (Array.isArray(result)?result[0]:result).output.filter(file=>file.type==='chunk');
  }finally{process.chdir(root);for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
}
function deferred(chunks){
  const parkChunk=chunks.find(chunk=>chunk.facadeModuleId===feature);
  assert.ok(parkChunk&&!parkChunk.isEntry&&parkChunk.isDynamicEntry,'the park is a chunk that only an import() loads');
  assert.match(parkChunk.fileName,/^chunks\/quarry-feature-[\w-]+\.js$/);
  for(const file of park){
    assert.ok(file in parkChunk.modules,'the park chunk holds '+file.slice(web.length+1));
    for(const chunk of chunks)if(chunk!==parkChunk)assert.ok(!(file in chunk.modules),chunk.fileName+' holds the park module '+file.slice(web.length+1));
  }
  for(const chunk of chunks)assert.ok(!chunk.imports.includes(parkChunk.fileName),chunk.fileName+' imports the park chunk at once');
  assert.deepEqual(chunks.filter(chunk=>chunk.dynamicImports.includes(parkChunk.fileName)).map(chunk=>chunk.fileName),['app.js'],'only app.js (main.ts) loads the park chunk');
  return parkChunk;
}
try{
  const parkChunk=deferred(await published());
  console.log('PASS published build keeps all',park.length,'park modules in',parkChunk.fileName,'and only main.ts imports it, on demand');
  const mutants={
    'a park module imported by main.ts':code=>"import './quarry';\n"+code,
    'the park chunk imported at once':code=>"import './quarry-feature';\n"+code,
  };
  for(const [name,mutate] of Object.entries(mutants)){
    const chunks=await published(mutate);
    assert.throws(()=>deferred(chunks),undefined,'the check must reject '+name);
    console.log('REJECTED',name);
  }
}finally{rmSync(work,{recursive:true,force:true});}
