import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
import {basename,dirname,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Plugin} from 'vite';

/**
 * The quarry's published chunk keeps its module initializers inside its flag's factory and fetches its lake and
 * talus data as quarry-feature.json. This came before the published build split its chunks (area-chunks-build.ts),
 * and the quarry checks (quarry-deferred-check, quarry-published-browser) still prove the factory, so it stays.
 */
export function quarryLazyBuild():Plugin {
  const entry=fileURLToPath(new URL('./src/quarry-feature.ts',import.meta.url)),probe=process.env.QUARRY_EVAL_PROBE==='1';
  return {name:'deferred-quarry-in-flat-build',apply:'build',enforce:'pre',transform(code,id){
    if(probe&&id!==entry&&/^quarry(?:-|\.ts$)/.test(basename(id))&&!id.endsWith('quarry-trip.ts'))
      return `(globalThis.__quarryEvaluations??=[]).push(${JSON.stringify('outside factory:')}+${JSON.stringify(basename(id))});\n`+code;
    return null;
  },async load(id){
    if(id!==entry)return null;
    // The real lake/talus data is a file of its own, fetched when the park loads.
    const data:Record<string,unknown>={};
    for(const file of ['quarry-lakes','quarry-talus']){
      const source=readFileSync(resolve(dirname(entry),file+'.ts'),'utf8'),match=source.match(/export const (\w+) = (.+) as const;/);
      if(!match)throw Error('Missing quarry geometry data');data[match[1]]=JSON.parse(match[2]);
    }
    this.emitFile({type:'asset',fileName:'quarry-feature.json',source:JSON.stringify(data)});
    const shared=new Map<string,string>();
    const result=await build({entryPoints:[entry],bundle:true,write:false,format:'cjs',platform:'browser',target:'es2022',
      define:{'import.meta.env.DEV':'false'},logLevel:'silent',plugins:[{name:'shared-game-dependencies',setup(b){
        b.onResolve({filter:/^\./},args=>{
          const path=resolve(args.resolveDir,args.path)+(args.path.endsWith('.ts')?'':'.ts');
          if(path===entry||(/^quarry(?:-|\.ts$)/.test(basename(path))&&!path.endsWith('quarry-trip.ts')))return null;
          // Keyed by name, not by resolve order (esbuild resolves in parallel): the same source gives the same chunk.
          const key='shared:'+relative(dirname(entry),path);shared.set(key,path);return {path:key,external:true};
        });
        b.onResolve({filter:/^three$/},()=>{const key='shared:three';shared.set(key,'three');return {path:key,external:true};});
        b.onLoad({filter:/quarry(?:-[^/]+)?\.ts$/},args=>{
          let source=readFileSync(args.path,'utf8');
          if(/quarry-(?:lakes|talus)\.ts$/.test(args.path))source=source.replace(/export const (\w+) = .+ as const;/,(_all,name)=>'export const '+name+' = quarryData.'+name+';');
          return {contents:(probe?`(globalThis.__quarryEvaluations??=[]).push(${JSON.stringify(basename(args.path))});\n`:'')+source,loader:'ts',resolveDir:dirname(args.path)};
        });
      }}]});
    const sorted=[...shared].sort(([a],[b])=>a<b?-1:a>b?1:0);
    const imports=sorted.map(([,path],i)=>`import * as shared${i} from ${JSON.stringify(path)};`).join('\n');
    const lookup=sorted.map(([key],i)=>`${JSON.stringify(key)}:shared${i}`).join(',');
    return `${imports}\nlet feature;\nexport async function load(){if(feature)return feature;const response=await fetch(import.meta.env.BASE_URL+'quarry-feature.json');if(!response.ok)throw Error('Park data unavailable');const quarryData=await response.json();if(!Array.isArray(quarryData.QUARRY_LAKES)||!Array.isArray(quarryData.TALUS_TOES))throw Error('Park data incomplete');const module={exports:{}};const require=id=>({${lookup}})[id];\n${result.outputFiles[0].text}\nreturn feature=module.exports.load();}\n`;
  }};
}
