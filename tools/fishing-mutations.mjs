#!/usr/bin/env node
// Break each important pure rule in a temporary bundle; require the unchanged assertions to reject it.
import { validateMutations } from './mutation-source.mjs';
import assert from 'node:assert/strict';
import { build } from '../web/node_modules/esbuild/lib/main.js';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
const root=resolve(import.meta.dirname,'..');
const variants=[
  ['R1 no dwell','rules','stop: 1.5','stop: 0'],
  ['R2 repeat offer','rules','this.offered = true;','this.offered = false;'],
  ['R2 no new-shift reset','rules','this.offered = false; this.cancel();','this.cancel();'],
  ['R3 ineligible allowed','rules','!s.eligible || ',''],
  ['R4 airborne allowed','rules','s.airborne || ',''],
  ['R4 no deck or height check','rules','s.deck === null\n      || Math.abs(s.y - s.deck) > DECKHAND_RULES.height || ',''],
  ['R5 any distance','rules','s.distance > DECKHAND_RULES.radius','false'],
  ['R6 fast allowed','rules','Math.abs(s.speed) >= DECKHAND_RULES.speed','false'],
  ['R6 sideways slide allowed','rules','Math.abs(s.sideways) >= DECKHAND_RULES.speed','false'],
  ['R7 placement ignored','rules','s.placement === this.placement','true'],
  ['R7 teleport ignored','rules','Math.hypot(s.x - this.x, s.z - this.z) <= 0.6 + dt * 55','true'],
  ['R8 cancel disabled','rules','this.stopped = 0; this.observed = false;',''],
  ['R8 suspended time counts','rules','dt > DECKHAND_RULES.maxStep || ',''],
  ['R9 invisible deck','site','if (this.top === null || this.toe === null) return null;','if(this.top === null) this.top=3;if(this.toe===null)this.toe=3;'],
  ['R9 wrong cap height','site','? this.top : null','? this.top + .5 : null'],
  ['R9 changed land','site','if(weight<=0)return surveyed;','if(weight<=0)return surveyed + 1;'],
  ['R16 lost gravel','site','kind:11','kind:9'],
  ['R16 lost overlay flag','site','readonly visualGravel = true','readonly visualGravel = false'],
  ['R14 uncapped wharf','site','Math.min(MAX_DECK_ABOVE_WATER,(WHARF.top-sea)*exag)','(WHARF.top-sea)*exag'],
  ['R14 broken entrance join','site','(-2*t3+3*t2)*this.level','(-2*t3+3*t2)*(this.level+.5)'],
  ['R15 stops inside harbour','course','seconds-1','Math.min(seconds,30)-1'],
  ['R15 turns back inland','course','[616500,5105580]','[618500,5105580]'],
  ['R16 track field overwritten','terrain','if(f.kind===11){','if(false){'],
];
validateMutations(root, variants.map(([name,file,from,to])=>({name,edits:[{file:'web/src/'+(file==='terrain'?'terrain':'fishing-'+file)+'.ts',from,to}]})));
const dir=mkdtempSync(join(tmpdir(),'mmm-fishing-mutations-'));
try {
  for(const [name,file,from,to] of variants){
    const source=readFileSync(join(root,`web/src/${file==='terrain'?'terrain':'fishing-'+file}.ts`),'utf8');assert.ok(source.includes(from),`mutation anchor ${name}`);
    const outfile=join(dir,'check.mjs');
    await build({entryPoints:[join(root,'tools/fishing-rules-check.mjs')],bundle:true,platform:'node',format:'esm',outfile,logLevel:'silent',plugins:[{name:'break-one-rule',setup(b){b.onLoad({filter:new RegExp(`${file==='terrain'?'terrain':'fishing-'+file}\\.ts$`)},()=>({contents:source.replace(from,to),loader:'ts'}));}}]});
    const run=spawnSync(process.execPath,[outfile],{encoding:'utf8'});
    assert.notEqual(run.status,0,`${name}: broken rule passed!`);assert.match(run.stderr,/AssertionError/,`${name}: must fail an assertion, not startup`);
    console.log(`REJECTED ${name}`);
  }
} finally {rmSync(dir,{recursive:true,force:true});}
