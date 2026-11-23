// Each deliberate production fault must fail a behavior assertion, with tracked source left untouched.
import { build } from '../web/node_modules/esbuild/lib/main.js';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'), dir=mkdtempSync(join(tmpdir(),'mmm-horse-mutations-'));
try {
 for(const [name,file,before,after,expectedAssertion]of [
  ['suspension phase','horse-motion.ts','hz: 2.1, stance: .20','hz: 2.1, stance: .65','gallop has suspension'],
  ['front knee direction','horse.ts','bend = i < 2 ? -1 : 1','bend = i < 2 ? 1 : -1','knee/hock bends on anatomical side'],
  ['footfall timing','horse.ts','rig.onFootfall?.(i)','rig.onFootfall?.((i + 1) % 4)','audio starts on visual contact'],
  ['trot posting','horse.ts','(1 - Math.cos(phase * Math.PI * 2)) * .09','(1 - Math.cos(phase * Math.PI * 4)) * .09','rider posts once per trot stride'],
  ['coarse deck support','vehicle.ts',"if (this.spec.locomotion === 'horse' && this.reach(deck,referenceY)) return deck;",'','timber deck remains authoritative under coarse land'],
  ['gait selection','horse-motion.ts','v < 2.5','v < 20','gait selection at'],
  ['leg cycle','horse-motion.ts','stride * (p / g.stance - .5)','0','legs really move'],
  ['grass cap','horse-motion.ts',"surface === 'grass' ? 10","surface === 'grass' ? 16",'grass surface limit'],
  ['horse repair immunity','vehicle.ts',"this.spec.locomotion !== 'horse' && this.damageActive) this.damage?.hit('impact', speed)","this.damageActive) this.damage?.hit('impact', speed)",'no motor damage on horse impact'],
 ]) {
  await build({entryPoints:[join(root,'tools/horse-check.mjs')],bundle:true,platform:'node',format:'esm',outfile:join(dir,'check.mjs'),logLevel:'silent',plugins:[{name:'horse-fault',setup(b){b.onLoad({filter:new RegExp('/'+file.replace('.','\\.')+'$')},args=>{const s=readFileSync(args.path,'utf8');assert.ok(s.includes(before),'mutation target exists');return{contents:s.replace(before,after),loader:'ts'};});}}]});
  const result=spawnSync(process.execPath,[join(dir,'check.mjs')],{cwd:join(root,'web'),encoding:'utf8'});
  assert.notEqual(result.status,0,'fault must fail: '+name);const assertion=result.stderr.match(/AssertionError[^\n]*: ([^\n]*)/)?.[1];assert.ok(assertion?.includes(expectedAssertion),'must fail its own assertion: '+name+'; expected '+expectedAssertion+'; got '+result.stderr);console.log('REJECTED horse '+name);
 }
} finally {rmSync(dir,{recursive:true,force:true});}
