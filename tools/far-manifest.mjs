import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
export const manifestBytes=value=>Buffer.from(JSON.stringify(value)+'\n');
/** A patch can never replace unrelated live keys, including later road-ground data. */
export function mergeFarManifest(live,patch){
 assert.ok(patch&&typeof patch==='object'&&!Array.isArray(patch));
 assert.deepEqual(Object.keys(patch).sort(),['farLand','tall']);
 assert.equal(patch.tall.file,'tall.json');assert.equal(patch.farLand.file,'far-land.json');
 return {...live,...patch};
}
export async function overlayManifest(data,bake,area,before=false){
 const live=JSON.parse(await readFile(resolve(data,'baked',area,'manifest.json'),'utf8'));
 if(before){delete live.tall;delete live.farLand;return manifestBytes(live);}
 // A promoted snapshot (the rehearsal, and data/baked after promotion) already holds the merged keys and has no
 // patch file: serve its manifest as it is.
 if(resolve(bake)===resolve(data,'baked')){assert.ok(live.farLand&&live.tall,'promoted manifest has no far keys: '+area);assert.equal(live.tall.file,'tall.json');assert.equal(live.farLand.file,'far-land.json');return manifestBytes(live);}
 const patch=JSON.parse(await readFile(resolve(bake,area,'manifest-patch.json'),'utf8'));
 return manifestBytes(mergeFarManifest(live,patch));
}
