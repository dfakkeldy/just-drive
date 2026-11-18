// The owner grants a quiet MacBook window for these timing observations.
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {mkdirSync} from 'node:fs';
const[out,base]=process.argv.slice(2);
for(const[file,part]of [['far-mini-cost.mjs','cost'],['far-mini-load.mjs','load']]){const dir=out+'/'+part;mkdirSync(dir,{recursive:true});const r=spawnSync(process.execPath,[resolve(import.meta.dirname,file),dir,base],{env:process.env,stdio:'inherit'});if(r.status!==0)process.exit(r.status??1);}
