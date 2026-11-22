import { readBaseline } from './baseline-source.mjs';
import {build} from '../web/node_modules/esbuild/lib/main.js';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),dir=mkdtempSync(`${tmpdir()}/mmm-rail-fix-mutants-`);
const cases=[
 ['cow downhill side restored','animals.ts','a.side = l.ground < r.ground ? 1 : -1;','a.side = l.ground < r.ground ? -1 : 1;','cow'],
 ['cow imaginary rails restored','guardrails.ts','if (c.revision === this.terrain.dataRevision) {','if (false) {','cow'],
 ['cow road margin removed','cow-rest.ts','roadGap: .5,','roadGap: 0,','cow'],
 ['cow final herd-side guard removed','animals.ts','if (ownSide <= 0 || !inward || !outward || outward.ground < inward.ground) return false;','void ownSide;','cow'],
 ['cow ditch grazing restored','cow-rest.ts','if (h < roadHeight || outward < inward ||','if (','cow'],
 ['cow non-rail road kinds excluded','roads.ts','if (road === exclude || seen.has(key)) continue;','if (road.kind > 3 || road === exclude || seen.has(key)) continue;','cow','other-roads'],
 ['cow road-centre grazing filter restored','guardrails.ts','}, (x, z) => this.terrain.heightAt(x, z));','}, ground);','cow','centre'],
 ['cow road margin reduced to30cm','cow-rest.ts','roadGap: .5,','roadGap: .3,','cow','margin'],
 ['cow wait gate removed','guardrails.ts','if (!local.length || local.some(c => c.revision !== this.terrain.dataRevision)) return null;','void local;','cow','gate'],
 ['cow cross-road check removed','guardrails.ts','if (this.cowRoadClearance(body, road) < COW_REST.roadGap - 1e-6) return false;','void road;','cow','other-roads'],
 ['cow failed search cache removed','guardrails.ts','if (this.cowFailures.get(road)?.has(key)) return null;','if (false) return null;','cow','cache'],
 ['cow own road measured twice','guardrails.ts','}, ownRoad);','});','cow','other-roads'],
 ["nit seam aggregate yaw clamp removed", "guardrails.ts", "const limitedYaw = Math.max(-Math.PI / 6 * dt, Math.min(Math.PI / 6 * dt, yaw));", "const limitedYaw = yaw;", "physics"],
 ["nit washboard reduced to20percent with rails", "vehicle.ts", "        this.heading += (this.random() - 0.5) * this.spec.washboardYaw * Math.abs(vf) * (1.2 - skip) * dt * 6;\n        vl += (this.random() - 0.5) * this.spec.washboardSideways * Math.abs(vf) * (1.1 - skip) * dt * 4;", "        this.heading += (this.random() - 0.5) * (this.roads.guardrails ? .2 : 1) * this.spec.washboardYaw * Math.abs(vf) * (1.2 - skip) * dt * 6;\n        vl += (this.random() - 0.5) * (this.roads.guardrails ? .2 : 1) * this.spec.washboardSideways * Math.abs(vf) * (1.1 - skip) * dt * 4;", "physics"],
 ["nit seam speed reprojection removed", "guardrails.ts", "if (yaw !== limitedYaw) car.speed = car.vx * Math.sin(car.heading) - car.vz * Math.cos(car.heading);", "void limitedYaw;", "physics"],
 ['heading snap restored','parked.ts','car.heading += Math.max(-Math.PI / 6 * railDt, Math.min(Math.PI / 6 * railDt, error));','car.heading = tangent;','physics'],
 ['crashed bike hook','bike-ride.ts','      this.roads.guardrails?.block(this, dt);','      void dt;','physics'],
 ['M2 excessive rail friction','parked.ts','Math.exp(-.02 * railDt)','Math.exp(-3 * railDt)','physics'],
 ['M3 one yield per side','guardrail-rules.ts','yield; // One bounded station','if (i === lo) yield; // One bounded station','stream'],
 ['M4 cleared pending colliders','guardrails.ts','const work = this.work ??= {','if (!this.work) c.solids.length = 0; const work = this.work ??= {','stream'],
 ['M5 cow clearance 2cm','cow-rest.ts','clearance: .2,','clearance: .02,','cow'],
 ['M7 mailbox radius 20cm','props.ts','mailbox: .8,','mailbox: .2,','props'],
 ['fixed halo seed','guardrail-rules.ts','left > 0 && open(true)','false && left > 0 && open(true)','seams'],
 ['railway junction','guardrail-access.ts','!railwayRoad(r) &&','true &&','railway'],
 ['post soil omitted from rebuild key','guardrails.ts',", support].join(',');", "].join(',');",'look'],
 ['planning context rebuilt per frame','guardrails.ts','const { ground, context, profile, turnDown, damage } = this.planning;','Object.assign(this.planning, this.makePlanning()); const { ground, context, profile, turnDown, damage } = this.planning;','allocation'],
 ['boxed cell key','guardrails.ts','(x + 16384) * 32768 + z + 16384','(x + 32768) * 65536 + z + 32768','allocation'],
 ['cow old home','animals.ts','a.home.x = a.place.x = home.x; a.home.z = a.place.z = home.z; a.homeHeading = home.heading;', 'a.home.x = a.place.x = baseX + rx * (a.spot.road.halfWidth + 1.2) * a.side; a.home.z = a.place.z = baseZ + rz * (a.spot.road.halfWidth + 1.2) * a.side; a.homeHeading = home.heading;','cow'],
 ['railway class filter','railway-road.ts','  const tag = road.railway ?? road.tags?.railway;', '  return false; const tag = road.railway ?? road.tags?.railway;','railway'],
 ['vehicle hook','vehicle.ts','this.roads.guardrails?.block(this, dt);','void dt;','physics'],
 ['bike hook','bike-ride.ts','\n    this.roads.guardrails?.block(this, dt);','\n    void dt;','physics'],
 ['own cell only','guardrails.ts','const x = Math.floor(car.x / CHUNK), z = Math.floor(car.z / CHUNK);\n    for (let j = z - 1; j <= z + 1; j++) for (let i = x - 1; i <= x + 1;', 'const x = Math.floor(car.x / CHUNK), z = Math.floor(car.z / CHUNK);\n    for (let j = z; j <= z; j++) for (let i = x; i <= x;','physics'],
 ['sticky parked response','guardrails.ts','pushOut(car, c.solids, false, dt)','pushOut(car, c.solids)','physics'],
 // The old arbitrary 25cm minimum caused buried ends. The stronger replacement checks actual ground contact.
 ['terminal descent removed','guardrails.ts','const drop = (t: number) => startFall *','const drop = (t: number) => 0 *','look'],
 ['old 25cm end floor','guardrails.ts','top + LOOK.top - LOOK.depth / 2 - soil - LOOK.endClear;','Math.max(.25, Math.min(.75, top + LOOK.top - LOOK.depth / 2 - soil - LOOK.endClear));','look'],
 ['unbounded revision planning','guardrails.ts','RAIL_PLANS_PER_UPDATE = 1;\nexport const RAIL_SAMPLES_PER_UPDATE = 48;\nexport const RAIL_GROUND_QUERIES_PER_UPDATE = 512;','RAIL_PLANS_PER_UPDATE = Infinity;\nexport const RAIL_SAMPLES_PER_UPDATE = Infinity;\nexport const RAIL_GROUND_QUERIES_PER_UPDATE = Infinity;','stream'],
 ['terminal uses hidden height field','guardrails.ts','this.terrain.meshHeightAt?.(p.x, p.z, true) ?? this.terrain.heightAt(p.x, p.z)','this.terrain.heightAt(p.x, p.z)','look'],
 ['post floats above bank','guardrails.ts','Math.min(soil - .08, Math.max(soil - LOOK.bury, top - LOOK.maxPostLeg))','Math.max(soil - LOOK.bury, top - LOOK.maxPostLeg)','look'],
 ['end plate removed','guardrails.ts','capStart: a.along === s.runStart','capStart: false','look'],
 ['station batch limit','guardrails.ts','RAIL_SAMPLES_PER_UPDATE = 48','RAIL_SAMPLES_PER_UPDATE = Infinity','stream'],
 ['1884 rail construction','guardrails.ts','if (terrain.cartRoads) return;','if (false) return;','stream'],
 ['stale LOW material','guardrails.ts','this.materials[Number(low)] ??= railMaterial(low)','this.materials[0] ??= railMaterial(low)','stream'],
 ['mailbox opening removed','guardrail-access.ts','if (Math.abs((prop.x - p.x) * Math.cos(p.heading)', 'if (false && Math.abs((prop.x - p.x) * Math.cos(p.heading)','props'],
];
const entry={seams:'guardrail-seams-check.mjs',allocation:'guardrail-allocation-check.mjs',physics:'guardrail-physics-check.mjs',look:'guardrail-check.mjs',stream:'guardrail-stream-check.mjs',props:'guardrail-props-check.mjs',cow:'guardrail-cow-check.mjs',railway:'guardrail-railway-check.mjs'};
const selectedCases=cases.filter(c=>(!process.argv.includes('--r2')||['cow','railway'].includes(c[4]))&&(!process.argv.includes('--cow-only')||c[4]==='cow'));
try {
 if(process.argv.includes('--measure-allocation-r2')||process.argv.includes('--measure-r2')||process.argv.includes('--measure-before')||process.argv.includes('--measure-work-before')) {
  const sources=new Map(['guardrails.ts','guardrail-rules.ts','guardrail-look.ts','guardrail-access.ts','guardrail-damage.ts','parked.ts','vehicle.ts','bike-ride.ts'].map(f=>[resolve(root,'web/src',f),readBaseline(process.argv.some(a=>a==='--measure-r2'||a==='--measure-allocation-r2')?'guardrail-allocation':'guardrail-fix',`web/src/${f}`)]));
  await build({entryPoints:[resolve(root,process.argv.includes('--measure-allocation-r2')?'tools/guardrail-allocation-check.mjs':process.argv.includes('--measure-work-before')?'tools/guardrail-work-measure.mjs':'tools/guardrail-physics-check.mjs')],bundle:true,platform:'node',format:'esm',outfile:`${dir}/before.mjs`,logLevel:'silent',plugins:[{name:'before',setup(b){b.onLoad({filter:/\.ts$/},a=>sources.has(a.path)?{contents:sources.get(a.path),loader:'ts',resolveDir:dirname(a.path)}:undefined)}}]});
  const r=spawnSync(process.execPath,[`${dir}/before.mjs`],{encoding:'utf8',env:{...process.env,RAIL_MEASURE_ONLY:'1',RAIL_ALLOC_MEASURE_ONLY:'1'}});assert.equal(r.status,0,r.stderr);process.stdout.write(r.stdout);
 } else for(const [name,file,from,to,check,assertion]of selectedCases){
  const path=resolve(root,'web/src',file),source=readFileSync(path,'utf8');assert.equal(source.split(from).length,2,name+' anchor');
  let mutated=source.replace(from,to);
  if(name==='cow downhill side restored'){
   assert.equal(source.split('const fieldSide = a.side;').length,2,'old-side mutant restores both old lines');
   mutated=mutated.replace('const fieldSide = a.side;','const fieldSide = cow ? -a.side : a.side;');
  }
  await build({entryPoints:[resolve(root,'tools',entry[check])],bundle:true,platform:'node',format:'esm',outfile:`${dir}/check.mjs`,logLevel:'silent',plugins:[{name:'mutate',setup(b){b.onResolve({filter:/esbuild\/lib\/main\.js$/},a=>({path:resolve(a.resolveDir,a.path),external:true}));b.onLoad({filter:/\.mjs$/},a=>({contents:readFileSync(a.path,'utf8').replaceAll('import.meta.url',JSON.stringify(pathToFileURL(a.path).href)),loader:'js',resolveDir:dirname(a.path)}));b.onLoad({filter:/\.ts$/},a=>a.path===path?{contents:mutated,loader:'ts',resolveDir:dirname(path)}:undefined)}}]});
  const r=spawnSync(process.execPath,[`${dir}/check.mjs`,...(assertion?['--assert',assertion]:[])],{encoding:'utf8'});assert.notEqual(r.status,0,name+' must fail');assert.match(r.stderr,/AssertionError/,name+' assertion failure');
  if(name==='cow downhill side restored')assert.match(r.stderr,/real placement hook builds pasture|pasture cow body in road-to-rail strip/,'both-line old-side mutant must fail the cow check');
  console.log('REJECTED',name,'by',entry[check]);if(name.startsWith('nit '))console.log(r.stderr.split('\n').find(l=>l.includes('AssertionError')));
 }
} finally {rmSync(dir,{recursive:true,force:true});}
if(!process.argv.some(a=>a.startsWith('--measure')))console.log('PASS',selectedCases.length,'guardrail fix mutations');
