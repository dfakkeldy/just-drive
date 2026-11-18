import { readBaseline } from './baseline-source.mjs';
import assert from 'node:assert/strict';
import {harness,source} from './pwa-harness.mjs';
const baseline=process.argv.includes('--baseline'),code=baseline?readBaseline('pwa-opt-in','web/pwa/sw.js'):source;
async function test(code){const h=await harness(code),a=h.build('A');await h.nav('a');let primed;await h.api.download(await h.api.stored(),{postMessage:p=>{if(p.primed){primed={saved:h.bins.get('mmm-offline-data-'+a.v.dataRevision).has('/terrain/unseen.bin'),unvisited:h.requests.includes('/terrain/tile.bin')};}},close(){}},['/terrain/unseen.bin']);assert.ok(primed,'transition saves loaded files first');assert.ok(primed.saved,'already-loaded file saved before primed');assert.equal(primed.unvisited,false,'unvisited files wait for loaded files');}
try{await test(code);console.log('PASS click transition primes already-loaded files before the rest');}catch(e){console.log('FAIL',e.message);process.exitCode=1;}
if(!process.exitCode&&process.argv.includes('--mutations')){const from="visited.filter(p=>typeof p==='string')";assert.ok(code.includes(from));let caught=false;try{await test(code.replace(from,'[]'));}catch{caught=true;}assert.ok(caught,'escaped loaded-file priority');console.log('caught mutation: loaded-file priority');}
