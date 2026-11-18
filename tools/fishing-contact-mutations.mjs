#!/usr/bin/env node
import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import { validateMutations } from './mutation-source.mjs';
validateMutations(new URL('..',import.meta.url).pathname, ['if (surface && site.deckDriving)','if (this.groundContact && this.wantsDrawnContact(x,z))'].map(from=>({name:'fishing contact',edits:[{file:'web/src/terrain.ts',from,to:'',all:from.startsWith('if (this.groundContact')}]})));
for(const [mutation,mode]of[['surface','surface'],['mesh','rays']]){
 const run=spawnSync(process.execPath,['tools/fishing-contact-check.mjs'],{env:{...process.env,FISHING_CONTACT_MUTATION:mutation,FISHING_CONTACT_MODE:mode,FISHING_CONTACT_LABEL:'mutation-'+mutation},encoding:'utf8'});
 assert.notEqual(run.status,0,`broken ${mutation} passed`);assert.match(run.stderr,/AssertionError/,'must fail a behavior assertion, not startup');console.log(`REJECTED contact ${mutation}: ${mode} regression`);
}
