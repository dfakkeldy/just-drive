import { validateMutations } from './mutation-source.mjs';
import { build } from '../web/node_modules/esbuild/lib/main.js';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..');
const mutants=[
 ['reset horn silence','road-scene.ts','this.stopHorn(); this.setPaused(false);','this.setPaused(false);'],
 ['rendered hoof ground','road-scene.ts',' + sx * dx + sz * dz','','road-scene-sea-check'],
 ['modal motion','road-scene.ts','this.paused || !this.rules.enabled','false || !this.rules.enabled'],
 ['modal horn silence','road-scene.ts','this.hornGain?.disconnect(); this.hornGain = null;','this.hornGain = null;'],
 ['cattle in camera view','road-scene.ts','this.road.at(FISH_COWS[0].along, FISH_COWS[0].side, this.back)','this.road.at(-4, -21, this.back)'],
 ['cattle off road','road-scene-rules.ts','along: 5, side: 6.8','along: 5, side: 0'],
 ['sea cow standing','road-scene-rules.ts',"turn: Math.PI / 3, kind: 'cow', grazing: false","turn: Math.PI / 3, kind: 'cow', grazing: true"],
];
validateMutations(root, mutants.map(([name,file,from,to])=>({name,edits:[{file:'web/src/'+file,from,to}]})));
const dir=mkdtempSync(`${tmpdir()}/mmm-scene-world-mutations-`);
try{
 for(const [name,file,from,to,entry='road-scene-world-check']of mutants){
  const source=resolve(root,'web/src',file),original=readFileSync(source,'utf8');assert.ok(original.includes(from),name+' anchor');
  await build({entryPoints:[resolve(root,'tools',entry+'.mjs')],bundle:true,platform:'node',format:'esm',outfile:`${dir}/check.mjs`,logLevel:'silent',plugins:[{name:'break-adapter',setup(b){b.onLoad({filter:/road-scene(?:-rules)?\.ts$/},args=>args.path===source?{contents:original.replace(from,to),loader:'ts',resolveDir:dirname(source)}:undefined);}}]});
  const r=spawnSync(process.execPath,[`${dir}/check.mjs`],{cwd:resolve(root,'web'),encoding:'utf8'});assert.notEqual(r.status,0,name+' must fail');assert.match(r.stderr,/AssertionError/,name+' assertion');console.log('REJECTED deliberate world break:',name);
 }
}finally{rmSync(dir,{recursive:true,force:true});}
console.log('PASS seven adapter failures detected; source unchanged.');
