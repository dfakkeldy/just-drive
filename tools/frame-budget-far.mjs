// Far views cost, kept apart from the pins until the main thread installs the far pack (PR #122).
// The stored pins (frame-budget.json, frame-budget-traffic.json) always mean the land WITHOUT the far pack.
// On verified after land (tools/far-delta-check.mjs) each ceiling is pin + this row's measured far delta, and
// --update/--raise store measured - delta, so the pins keep their meaning on either land.
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {metrics,allKeys} from './frame-budget-policy.mjs';
import {landState} from './far-delta-check.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
export const FAR_DELTAS=JSON.parse(readFileSync(new URL('./baseline/frame-budget-far.json',import.meta.url),'utf8'));

export function validDeltas(deltas=FAR_DELTAS){
 assert.deepEqual(Object.keys(deltas.rows).sort(),allKeys().sort(),'far deltas cover every scene/mode row');
 for(const [key,row] of Object.entries(deltas.rows)){
  assert.deepEqual(Object.keys(row).sort(),[...metrics].sort(),key+': far delta has the seven counts');
  for(const k of metrics)assert.ok(Number.isSafeInteger(row[k])&&row[k]>=0,key+': far delta '+k+' is a whole number >= 0');
 }
 return true;
}
/** 'before' or 'after' for the checkout's data/baked; throws on a half install. */
export function farLand(baked=root+'data/baked'){return existsSync(baked+'/terrain/manifest.json')?landState(baked):'before';}
const shift=(baseline,sign,state,deltas)=>{
 if(state!=='after')return baseline;
 validDeltas(deltas);
 return Object.fromEntries(Object.entries(baseline).map(([key,row])=>[key,deltas.rows[key]?Object.fromEntries(metrics.map(k=>[k,row[k]+sign*deltas.rows[key][k]])):row]));
};
/** Ceilings to compare against on this land. */
export const effective=(baseline,state=farLand(),deltas=FAR_DELTAS)=>shift(baseline,1,state,deltas);
/** What --update/--raise writes: always the land without the far pack. */
export const stored=(next,state=farLand(),deltas=FAR_DELTAS)=>shift(next,-1,state,deltas);
