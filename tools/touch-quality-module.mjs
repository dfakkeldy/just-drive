import { readBaseline } from './baseline-source.mjs';
import { build } from '../web/node_modules/esbuild/lib/main.js';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const owned=['touch-quality.ts','detail.ts','picture.ts','touch-quality-policy.ts'];
export function boundary(sources=Object.fromEntries(owned.map(name=>[name,readFileSync('web/src/'+name,'utf8')]))){
 for(const [name,source]of Object.entries(sources))assert.doesNotMatch(source,/\blocalStorage\b/,name+' bypasses quality-store.ts');
}
export async function modules(baseline,mutation,entries=['touch-quality','detail','picture']){
 const exports=[...entries.map(name=>`export * from './web/src/${name}.ts';`),...(!baseline?["export * from './web/src/quality-store.ts';"]:[])].join('\n');
 let hits=0;
 const result=await build({stdin:{contents:exports,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent',plugins:[{name:'quality-sources',setup(b){b.onLoad({filter:/[/\\]web[/\\]src[/\\].*\.ts$/},args=>{
  const name=args.path.split('/').at(-1);
  let source=baseline?readBaseline('touch-quality',`web/src/${name}`):readFileSync(args.path,'utf8');
  if(mutation){const before=source;source=mutation(name,source);if(before!==source)hits++;}
  if(!baseline&&name!=='quality-store.ts')boundary({[name]:source});
  return {contents:source,loader:'ts'};
 });}}]});
 if(mutation)assert.ok(hits,'mutation target reached');
 return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
}
