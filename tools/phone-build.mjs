// All mutations live in esbuild's memory. Never write to the game's source files.
import { build } from '../web/node_modules/esbuild/lib/main.js';
import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root=realpathSync(fileURLToPath(new URL('../',import.meta.url)))+'/',out=process.env.PHONE_CHECK_DIR;
assert.ok(out,'PHONE_CHECK_DIR is required');
const changes={
 damage:['damage-rules.ts','return damaged && desktop && speed !== 0','return desktop && speed !== 0'],
 defects:['defects.ts','kind === 1 ? 0.17','kind === 1 ? 0.18'],
 frame:['vehicle.ts','if (this.stuck) {','if (!input.touch && dt !== 1 / 60) this.heading += .00001;\n    if (this.stuck) {'],
 gain:['vehicle.ts','err * 7 *',`err * ${Number(process.env.PHONE_MUTATE_GAIN??3)} *`],
};
function mutate(name){return {name:`mutate-${name}`,setup(b){b.onLoad({filter:/[/\\](vehicle|damage-rules|defects)\.ts$/},args=>{
 const [file,from,to]=changes[name];if(!args.path.endsWith(`/web/src/${file}`))return;
 const source=readFileSync(args.path,'utf8');assert.equal(source.split(from).length,2,`${name}: unique mutation site`);
 return {contents:source.replace(from,to),loader:'ts'};
});}};}
// The frozen car and its two rule files are never edited. A recorded hash says so before anything is bundled,
// so that an edit to a snapshot is named as that, and not as a change in today's car.
const frozen=JSON.parse(readFileSync(`${root}tools/baseline/frozen.json`,'utf8'));
for(const file of ['vehicle.ts','damage-rules.ts','defects.ts']){
 const sha256=frozen[file];assert.ok(sha256,`tools/baseline/frozen.json must record ${file}`);
 assert.equal(createHash('sha256').update(readFileSync(`${root}tools/baseline/${file}`)).digest('hex'),sha256,
  `tools/baseline/${file} was edited. Restore it from git: the frozen baseline files are never edited (tools/baseline/README.md).`);
}
// esbuild names its inputs relative to the working directory, so resolve them before the test.
const current=metafile=>Object.keys(metafile.inputs).map(path=>resolve(process.cwd(),path)).filter(path=>path.startsWith(`${root}web/src/`));
const options={bundle:true,platform:'node',format:'esm',logLevel:'silent',alias:{three:`${root}web/node_modules/three/build/three.module.js`}};
const entry=(folder)=>`export {Vehicle} from '${root}${folder}/vehicle.ts'; export {Damage} from '${root}${folder}/damage-rules.ts';`;
const baseline=await build({...options,metafile:true,stdin:{contents:entry('tools/baseline'),resolveDir:root},outfile:`${out}/baseline.mjs`});
assert.deepEqual(current(baseline.metafile),[],'baseline must not bundle current game modules');
// The guard itself is proved: a frozen car that imports one of today's modules must be seen.
const leak=await build({...options,metafile:true,write:false,stdin:{contents:entry('tools/baseline'),resolveDir:root},plugins:[{
 name:'leak-current-defects',setup(b){b.onResolve({filter:/^\.\/defects$/},()=>({path:`${root}web/src/defects.ts`}));}
}]});
assert.deepEqual(current(leak.metafile),[`${root}web/src/defects.ts`],'the guard must see a current module in the baseline bundle');
console.log('MUTATION baseline-imports-current rejected by the bundle guard');
await build({...options,entryPoints:[`${root}tools/phone-check.mjs`],outfile:`${out}/check.mjs`});
for(const name of Object.keys(changes)){
 await build({...options,stdin:{contents:entry('web/src'),resolveDir:root},plugins:[mutate(name)],outfile:`${out}/${name}.mjs`});
 // Optional evidence: recreate the old shared-dependency oracle, without git/history.
 if(process.argv.includes('--prove-legacy')&&['damage','defects'].includes(name)){
  await build({...options,stdin:{contents:`export {Vehicle} from '${root}tools/baseline/vehicle.ts'; export {Damage} from '${root}web/src/damage-rules.ts';`,resolveDir:root},plugins:[{
   name:'legacy-shared-dependencies',setup(b){b.onResolve({filter:/^\.\/(damage-rules|defects)$/},args=>({path:`${root}web/src/${args.path.slice(2)}.ts`}));}
  },mutate(name)],outfile:`${out}/legacy-${name}.mjs`});
 }
}
