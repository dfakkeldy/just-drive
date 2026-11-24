// Pure URL policy test. On the original source, exercise its inline plainVisit expression.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { transform } from '../web/node_modules/esbuild/lib/main.js';
const path = 'web/src/visit.ts';
// Preview-only model/detail/trim/clean/night/flash keys (night and flash: the Boss car study), the crowns look test, and the mail car's body (car=blender|code), keep the game's normal title-card policy.
const players = 'area car clean crowns daily date flash night detail time driveAt engine era exag finish mode model mp paved playerDate playerTime poster q radio reception room site start sunPaths title touch traffic trailer trim trip vehicle view weather'.split(' ');
const tests = 'aiDriver aiDriverCheck airport boss bossLook depot rideAlong animal at break brooks canvasAA cat cam camground cap church clouds coast damage day demo dir dirt double drlane f finishSamples finishSmooth finishType fishingCheck trafficCheck wildlife grass hawkesbury home hour hud interior jumpCheck knock lawn leaves low mabou maryville mpserver n name pair park photo porch postOffice prince ptIndustry waterTowers quarry reflections relief report res road run scene shadows sidewalks shot still stuffed test throw trees village x yard yardProps lotprops'.split(' ');
async function load(source) {
  const {code} = await transform(source, {loader:'ts', format:'esm'});
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}
const source = existsSync(path) ? readFileSync(path,'utf8') : `export function isTestVisit(params) { return !(${readFileSync('web/src/main.ts','utf8').match(/const plainVisit = (.*);/)[1]}); }`;
const policy = await load(source);
players.push('astra');  // Optional 3D studies keep the player's ordinary title card.
players.push('rain', 'season');
function verify(p) {
  const failures=[]; const equal=(...args)=>{try{assert.equal(...args);}catch(e){failures.push(e.message);}};
  for (const key of [...players, 'fbclid','utm_source','utm_medium','utm_campaign','gclid','igshid','mc_cid','ref','unknown']) {
    for (const value of ['x','']) equal(p.isTestVisit(new URLSearchParams(`${key}=${value}`)), false, `${key}=${value} shows the title card`);
  }
  equal(p.isTestVisit(new URLSearchParams()),false,'empty query shows the title card');
  for (const key of tests) for (const value of ['1','']) equal(p.isTestVisit(new URLSearchParams(`${key}=${value}`)),true,`${key}=${value} skips the title card`);
  if(failures.length) throw Error(failures.join('\n'));
}
verify(policy);
// Require an explicit decision for every params.get/has key, including preview pages.
function scan(dir) {return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?scan(`${dir}/${e.name}`):e.name.endsWith('.ts')?[`${dir}/${e.name}`]:[]);}
for (const file of scan('web/src')) for (const [,key] of readFileSync(file,'utf8').matchAll(/params\.(?:get|has)\('([^']+)'/g)) assert.ok([...players,...tests].includes(key),`${file}: classify ${key}`);
console.log(`PASS visit policy: ${players.length} player keys, ${tests.length} test keys, tracking/unknown/empty values; all source reads classified`);
if (process.argv.includes('--mutations')) {
  for (const key of tests) {
    const changed = source.replace(`'${key}'`, `'removed-${key}'`);
    assert.notEqual(changed,source,`mutation exists: ${key}`);
    const mutant = await load(changed);
    assert.throws(()=>verify(mutant),undefined,`source mutation removing ${key} must fail`);
  }
  assert.throws(()=>verify({isTestVisit:params=>[...params.keys()].some(k=>!players.includes(k))}));
  // A player's key classed as a test key would skip the title card for every visitor with that link.
  for (const key of players) {
    const changed = source.replace("  'animal',", `  '${key}', 'animal',`);
    assert.notEqual(changed,source,`mutation exists: ${key} as a test key`);
    const mutant = await load(changed);
    assert.throws(()=>verify(mutant),undefined,`source mutation classing ${key} as a test key must fail`);
  }
  console.log(`PASS ${tests.length + 1 + players.length} visit mutations rejected (each test key removed, unknown-key allowlist restored, each player key classed as a test key)`);
}
