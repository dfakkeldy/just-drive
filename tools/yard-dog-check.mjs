// Real Mabou geography and production motion. No private imagery or survey changes.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildSync } from '../web/node_modules/esbuild/lib/main.js';
assert.ok(existsSync('web/src/yard-dog-site.ts'), 'the invented yard dog site exists');
const scratch = mkdtempSync(join(tmpdir(), 'yard-dog-'));
try {
  let alias={'yard-dog-mutant':join(process.cwd(),'web/src/yard-dog-site.ts')};
  if(process.env.YARD_DOG_MUTANT==='privacy') {
    const {writeFileSync}=await import('node:fs');
    const source=readFileSync('web/src/yard-dog-site.ts','utf8');
    assert.equal(source.split('gap(p)<300').length,3,'privacy mutation anchors');
    const path=join(scratch,'mutant.ts');writeFileSync(path,source.replaceAll('gap(p)<300','gap(p)<0'));alias={'yard-dog-mutant':path};
  }
  buildSync({alias,stdin:{contents:"export * from 'yard-dog-mutant'; export * from './web/src/yard-dog-rules'; export {YardDog} from './web/src/yard-dog'; export {Vector3,Box3} from './web/node_modules/three/build/three.module.js'; export { YardSite } from './web/src/yard-site'; export { PorchSite } from './web/src/porch-site'; export { BlackstoneSite } from './web/src/blackstone-site'; export { BrookVillageSite } from './web/src/brook-village-site'; export { HomeSite } from './web/src/home-site'; export { ChurchSite } from './web/src/church-site'; export { FishingSite } from './web/src/fishing-site'; export { CoastSite } from './web/src/coast-site'; export { ROUTE_ROADS } from './web/src/route';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:join(scratch,'check.mjs')});
  const { YardDogSite, YardDogRules, YARD_DOG, YardSite, PorchSite, BlackstoneSite, BrookVillageSite, HomeSite, ChurchSite, FishingSite, CoastSite, ROUTE_ROADS, YardDog, Vector3, Box3 } = await import(join(scratch,'check.mjs'));
  const json = name => JSON.parse(readFileSync(`data/baked/terrain/${name}.json`));
  const village = json('manifest').village;
  const roads = json('roads').roads.map(r => ({...r,pts:r.pts.map(([e,n])=>[e-village[0],village[1]-n])}));
  const props = json('props'), buildings = json('buildings').buildings;
  const mail = [...props.mailboxes,...props.communityBoxes].map(p=>({x:p.x-village[0],z:village[1]-p.y}));
  const houses = buildings.filter(b=>b.kind==='house').map(b=>({x:b.x-village[0],z:village[1]-b.y}));
  const handSites=[new YardSite(village,'invented'),new HomeSite(village),new ChurchSite(village),new FishingSite(village),new CoastSite(village)];
  const porch=PorchSite.find(buildings);if(porch)handSites.push(new PorchSite(porch,village));
  const blackstone=BlackstoneSite.find(buildings);if(blackstone)handSites.push(new BlackstoneSite(blackstone,village));
  const brookVillage=BrookVillageSite.find(buildings);if(brookVillage)handSites.push(new BrookVillageSite(brookVillage,village));
  const landmarks=existsSync('data/baked/terrain/landmarks.json')?json('landmarks'):[];
  const excluded=handSites.map(s=>s.box);
  for(const lm of landmarks){const ps=lm.footprint.map(([x,y])=>[x-village[0],village[1]-y]);excluded.push([Math.min(...ps.map(p=>p[0]))-4,Math.min(...ps.map(p=>p[1]))-4,Math.max(...ps.map(p=>p[0]))+4,Math.max(...ps.map(p=>p[1]))+4]);}
  const input = {roads,village,mail,houses,excluded};
  assert.ok(ROUTE_ROADS.includes(YARD_DOG.road),'invented driveway is on the mail route');
  assert.equal(YardDogSite.create({...input,houses:[]}),null,'missing houses fail closed');
  assert.equal(YardDogSite.create({...input,mail:[]}),null,'missing mailboxes fail closed');
  const site = YardDogSite.create(input);
  assert.ok(site,'a safe invented site exists on the actual Mabou route');
  assert.ok(site.road.kind>=1&&site.road.kind<=3,'selected geometry is in the actual route kinds');
  const timings=[];
  for(let i=0;i<5;i++){const start=performance.now();assert.ok(YardDogSite.create(input));timings.push(performance.now()-start);}
  const placementMs=timings.sort((a,b)=>a-b)[2];
  assert.ok(placementMs<150,`placement median stays below 150 ms: ${placementMs.toFixed(1)}`);
  // Finest land must cover the whole invented yard, not only the road centre.
  const manifest=json('manifest'),tileSize=manifest.size/256,finest=new Set(manifest.levels['8']);
  for(const x of [site.box[0],site.box[2]])for(const z of [site.box[1],site.box[3]]){
    const i=Math.floor((x+village[0]-manifest.origin[0])/tileSize),j=Math.floor((z-village[1]+manifest.origin[1])/tileSize);
    assert.ok(finest.has(`${i}_${j}`),'invented yard has finest mapped land');
  }
  // The yard paints only tiles that already have a baked road field. On a coarser tile it would add a whole road texture
  // (level 4, tile 4/8_9: +1 texture in six frame-budget rows) for a gravel entrance smaller than one sample.
  const roadLevels=Object.keys(manifest.roads.levels).map(Number),coarsestRoadTexel=manifest.size/2**Math.min(...roadLevels)/256;
  assert.ok(site.maxTexel<=coarsestRoadTexel,`yard paints no tile coarser than the baked road fields (${site.maxTexel} m > ${coarsestRoadTexel} m)`);
  assert.ok(manifest.size/2**Math.max(...roadLevels)/256<=site.maxTexel,'yard still paints the finest tiles');
  // Every tile the yard still paints must already have a road field, or it would get its own texture again.
  for(const level of Object.keys(manifest.levels).map(Number)){
    const size=manifest.size/2**level;if(size/256>site.maxTexel)continue;
    const fields=new Set(manifest.roads.levels[level]??[]);
    for(const x of [site.box[0],site.box[2]])for(const z of [site.box[1],site.box[3]]){
      const i=Math.floor((x+village[0]-manifest.origin[0])/size),j=Math.floor((z-village[1]+manifest.origin[1])/size);
      assert.ok(fields.has(`${i}_${j}`),`yard tile ${level}/${i}_${j} has a baked road field`);
    }
  }
  // Coarse tiles leave the site out entirely, heights included; that is safe only while the yard keeps the surveyed ground.
  for(let u=-21;u<=21;u+=7)for(let v=0;v<=18;v+=6){const p=site.world(u,v);assert.equal(site.height(p.x,p.z,42.5),42.5,'yard keeps the surveyed height');}
  let mailboxGap=Infinity,houseGap=Infinity;
  for(let u=-20;u<=20;u+=1) for(let v=0;v<=17;v+=1) {
    const p=site.world(u,v);
    for(const m of mail) mailboxGap=Math.min(mailboxGap,Math.hypot(p.x-m.x,p.z-m.z));
    for(const h of houses) houseGap=Math.min(houseGap,Math.hypot(p.x-h.x,p.z-h.z));
  }
  assert.ok(mailboxGap>=300,`mailbox separation ${mailboxGap}`);
  assert.ok(houseGap>=300,`house separation ${houseGap}`);
  // This mutation changes the real placement input, so the production privacy gate must reject it.
  if(process.argv.includes('--mutations')) {
    assert.equal(YardDogSite.create({...input,mail:[...mail,site.world(0,10)]}),null,'mailbox inside 300 m rejected');
    assert.equal(YardDogSite.create({...input,houses:[...houses,site.world(0,10)]}),null,'house inside 300 m rejected');
    assert.equal(YardDogSite.create({...input,excluded:[site.box]}),null,'hand-built overlap rejected');
    const edgePoint={x:site.box[2]+299.99,z:(site.box[1]+site.box[3])/2};
    assert.equal(YardDogSite.create({...input,mail:[edgePoint]}),null,'299.99 m from the yard box rejected');
    assert.ok(YardDogSite.create({...input,mail:[{...edgePoint,x:site.box[2]+300}]}),'exactly 300 m accepted');
  }
  const nearbyRoads=roads.flatMap(r=>r.pts.slice(1).map((b,i)=>({halfWidth:r.halfWidth,pts:[r.pts[i],b]}))).filter(r=>r.pts.some(([x,z])=>Math.hypot(x-site.x,z-site.z)<100));
  for(const direction of [-1,1]) for(const fps of [20,60,144]) for(const speed of [6,20,30]) {
    const dog=new YardDogRules(site.edge),dt=1/fps,states=new Set();let barks=0,minRoadGap=Infinity,maxAlong=0;
    for(let i=0;i<fps*25;i++) {
      const along=direction*(-38+i*dt*speed);
      dog.update(dt,along,0,direction*speed);states.add(dog.state);if(dog.bark)barks++;
      const p=site.world(dog.along,dog.across);maxAlong=Math.max(maxAlong,Math.abs(dog.along));
      for(const road of nearbyRoads) for(let j=1;j<road.pts.length;j++) {
        const [ax,az]=road.pts[j-1],[bx,bz]=road.pts[j],dx=bx-ax,dz=bz-az;
        if(Math.abs(ax-p.x)>100||Math.abs(az-p.z)>100)continue;
        const t=Math.max(0,Math.min(1,((p.x-ax)*dx+(p.z-az)*dz)/(dx*dx+dz*dz||1)));
        minRoadGap=Math.min(minRoadGap,Math.hypot(p.x-ax-t*dx,p.z-az-t*dz)-road.halfWidth);
      }
    }
    assert.ok(states.has('run')&&states.has('bark')&&states.has('follow')&&states.has('guard')&&states.has('return'),`full encounter ${direction}/${fps}: ${[...states]}`);
    assert.ok(barks>=2,'barks during the encounter');assert.ok(maxAlong>17.8,`reaches the property edge ${direction}/${fps}/${speed}: ${maxAlong}`);assert.ok(maxAlong<=18,'stops at property edge');
    assert.ok(minRoadGap>=1.1,`whole dog remains outside road: ${minRoadGap}`);
    assert.equal(dog.state,'home','returns home');
    const before=JSON.stringify(dog);dog.update(0,0,0,10);assert.equal(JSON.stringify(dog),before,'paused state is unchanged');
  }
  // Run the real model/update against a flat ground boundary. Browser tests use the live terrain.
  const oldAdd=globalThis.addEventListener,oldRemove=globalThis.removeEventListener;
  globalThis.addEventListener=()=>{};globalThis.removeEventListener=()=>{};
  try {
    let terrainReads=0,level=8,ground=0;
    const dog=new YardDog(site,{heightAt:()=>{terrainReads++;return ground;},surfaceAt:()=>{terrainReads++;return {level,ground};}});
    const car=site.world(0,0);
    for(let i=0;i<25;i++) {
      const before=site.world(dog.rules.along,dog.rules.across);
      dog.update(.05,{...car,vx:0,vz:0});
      const p=dog.rig.position,dx=p.x-before.x,dz=p.z-before.z;
      if(Math.hypot(dx,dz)>.001){
        const front=new Vector3(0,0,-1).applyQuaternion(dog.rig.quaternion);
        const alignment=(front.x*dx+front.z*dz)/(Math.hypot(front.x,front.z)*Math.hypot(dx,dz));
        assert.ok(alignment>.98,`dog faces its actual movement: ${alignment}`);
      }
    }
    dog.rig.rotation.set(0,0,0);dog.rig.updateMatrixWorld(true);
    const bounds=new Box3().setFromObject(dog.rig);
    assert.ok(Math.hypot(Math.max(Math.abs(bounds.min.x-dog.rig.position.x),Math.abs(bounds.max.x-dog.rig.position.x)),Math.max(Math.abs(bounds.min.z-dog.rig.position.z),Math.abs(bounds.max.z-dog.rig.position.z)))<1.1,'rendered whole-body radius fits the road clearance');
    const reads=terrainReads;dog.update(.05,{x:site.x+1000,z:site.z,vx:6,vz:0});
    assert.equal(terrainReads,reads,'culled dog does not pin or read terrain');assert.equal(dog.rules.state,'home');assert.equal(dog.group.visible,false);
    level=7;dog.update(.05,{...car,vx:0,vz:0});assert.ok(dog.posts.every(p=>!p.visible),'posts hide on coarse terrain');
    level=8;ground=3;dog.update(.05,{...car,vx:0,vz:0});assert.ok(dog.posts.every(p=>p.visible&&p.position.y===3),'posts follow arriving fine terrain');
    dog.dispose();
  } finally {globalThis.addEventListener=oldAdd;globalThis.removeEventListener=oldRemove;}
  if(process.argv.includes('--mutations')&&!process.env.YARD_DOG_MUTANT){
    const mutant=spawnSync(process.execPath,[process.argv[1],'--mutations'],{encoding:'utf8',env:{...process.env,YARD_DOG_MUTANT:'privacy'}});
    assert.equal(mutant.status,1,'privacy-removal source mutant must fail');
    assert.match(mutant.stderr,/mailbox inside 300 m rejected/,'mutant fails the placement assertion');
    console.log('PASS privacy-removal source mutant rejected');
  }
  console.log(`PASS yard dog: route ${YARD_DOG.road}; placement ${placementMs.toFixed(1)} ms; mailbox gap ${mailboxGap.toFixed(1)} m; house gap ${houseGap.toFixed(1)} m; both directions at 6/20/30 m/s and 20/60/144 Hz${process.argv.includes('--mutations')?'; four unsafe placements rejected; exact 300 m accepted':''}`);
} finally {rmSync(scratch,{recursive:true,force:true});}
