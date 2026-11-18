#!/usr/bin/env node
import { readBaseline } from './baseline-source.mjs';
import { build } from '../web/node_modules/esbuild/lib/main.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const dir=mkdtempSync(join(tmpdir(),'mmm-mail-help-'));
const legacy=process.argv.includes('--legacy');
const mutations=[
  ['shared-throw-bypassed','mail.ts','Object.assign(p, this.prepareThrow(v, p.kind));', `v.car.driverEye.updateWorldMatrix(true, false); v.car.driverEye.getWorldPosition(this.window);
    const rx=Math.cos(v.heading), rz=Math.sin(v.heading), side=p.kind>=2?6:7, variety=Math.sin(this.thrown*2.4);
    Object.assign(p, {x:this.window.x+rx*.48,y:this.window.y-.08,z:this.window.z+rz*.48,
      vx:v.vx+rx*side+Math.sin(v.heading)*variety*.5,vz:v.vz+rz*side-Math.cos(v.heading)*variety*.5,
      vy:(p.kind>=2?2.1:2.5)+variety*.18});`],
  ['bend-non-due','mail.ts',"condition !== 'ready' && !(p.motion.down && condition === 'preExisting')",'false'],
  ['help-off-changed','mail.ts','if (!this.throwHelp) return start;','if (!this.throwHelp) return { ...start, vx: start.vx + .01 };'],
  ['variable-assisted-steps','mail.ts','const fixed = p.fixedFlight;','const fixed = false;'],
  ['preview-cut-before-contact','mail-flight.ts','k < PREVIEW_TICKS','k < 60'],
  ['pre-existing-drop-removed','mail.ts',"? 'ground' : 'skip' : 'opening';","? 'skip' : 'skip' : 'opening';"],
  ['lift-correction-removed','mail-flight.ts','vy: bestLift','vy: start.vy'],
  ['ordered-hit-ignored','mail-flight.ts','const index = contact.hit;', 'const index = contact.hit >= 0 ? targetIndex : -1;'],
];
try {
  for(const mutant of [null,...(process.argv.includes('--mutations')?mutations:[])]) {
    const plugin={name:'variants',setup(b){ b.onLoad({filter:/web\/src\/(mail|props|mail-flight|mailbox-rules)\.ts$/},a=>{
      if(legacy && /\/(mail|props)\.ts$/.test(a.path)) {
        const file=a.path.split('/').pop();
        return {contents:readBaseline('mail-help',`web/src/${file}`),loader:'ts'};
      }
      if(mutant && a.path.endsWith('/'+mutant[1])) {
        const s=readFileSync(a.path,'utf8'); assert.equal(s.split(mutant[2]).length,2,mutant[0]+' anchor');
        return {contents:s.replace(mutant[2],mutant[3]),loader:'ts'};
      }
    }); }};
    const file=join(dir,(mutant?.[0]??'baseline')+'.mjs');
    await build({entryPoints:['tools/mail-help-cases.mjs'],bundle:true,platform:'node',format:'esm',outfile:file,logLevel:'silent',nodePaths:[process.cwd()+'/web/node_modules'],plugins:[plugin]});
    const r=spawnSync(process.execPath,[file],{encoding:'utf8',env:{...process.env,MAIL_LEGACY:legacy?'1':'0'}});
    if(!mutant) { process.stdout.write(r.stdout+r.stderr); assert.equal(r.status,0,'baseline exit'); }
    else { assert.equal(r.status,1,'mutant must fail an assertion: '+mutant[0]); assert.match(r.stderr,/AssertionError/, 'must be an assertion, not a crash'); console.log('KILLED '+mutant[0]+' exit '+r.status+' '+(r.stderr.match(/AssertionError[^\n]*/)?.[0]??'')); }
  }
} finally { rmSync(dir,{recursive:true,force:true}); }
