#!/usr/bin/env node
// Source mutations are bundled in memory. Each must fail its named executable physics regression.
import { validateMutations } from './mutation-source.mjs';
import { build } from '../web/node_modules/esbuild/lib/main.js';
import { mkdtempSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const mutations=[
 ['mail default','garage choice precedence and mail defaults','garage.ts','if (explore) { try','if (true) { try'],
 ['query precedence','garage choice precedence and mail defaults','garage.ts','if (query) return query;','if (query) return GARAGE[0];'],
 ['saved choice','garage choice precedence and mail defaults','garage.ts','if (entry) return entry;','if (entry) return GARAGE[0];'],
 ['own solver factory','garage pairs bike rig and its independent solver','garage.ts','ride: (rig, terrain, roads, sea, spec) => new BikeRide(rig as Bike, terrain, roads, sea, spec)','ride: undefined'],
 ['registered spec','garage pairs bike rig and its independent solver','garage.ts',"name: 'Dirt bike', spec: BIKE_SPEC","name: 'Dirt bike', spec: CAR_SPEC"],
 ['two wheel alias','garage pairs bike rig and its independent solver','bike.ts','fl: front, fr: front','fl: front, fr: rear'],
 ['explore collision spec','explore contacts use the selected collision spec','explore.ts','this.oldZ : vehicle.z, vehicle.spec)','this.oldZ : vehicle.z)'],
 ['landing whip','a whip never outlives the flight, on a rising landing too','bike-ride.ts','this.pitchRate = 0; this.whip = 0;\n      }','this.pitchRate = 0;\n      }'],
 ['ground whip decay','a whip on the ground fades out','bike-ride.ts','this.whip *= Math.max(0, 1 - dt * 8);','this.whip *= 1;'],
 ['impact damage','active damage sees bike impacts, landings and driving time; inactive damage sees nothing','bike-ride.ts',"if (this.damageActive) this.damage?.hit('impact', speed);",''],
 ['inactive damage','active damage sees bike impacts, landings and driving time; inactive damage sees nothing','bike-ride.ts',"if (this.damageActive) this.damage?.drive(","if (true) this.damage?.drive("],
 ['driving wear','active damage sees bike impacts, landings and driving time; inactive damage sees nothing','bike-ride.ts',"if (this.damageActive) this.damage?.drive(dt, Math.abs(forward), surf.name, 0, this.airborne);",''],
 ['first path landing hit','both landing paths report the landing, clean or crashed','bike-ride.ts',"this.damage?.hit('landing', -this.vy);   // a bad landing costs as much as a good one",''],
 ['first path crash order','both landing paths report the landing, clean or crashed','bike-ride.ts',"if (this.damageActive) this.damage?.hit('landing', -this.vy);   // a bad landing costs as much as a good one\n        if (!clean) { this.crash(); return; }","if (!clean) { this.crash(); return; }\n        if (this.damageActive) this.damage?.hit('landing', -this.vy);"],
 ['second path landing hit','both landing paths report the landing, clean or crashed','bike-ride.ts',"this.damage?.hit('landing', -this.vy);\n        if (!clean) this.crash();","if (!clean) this.crash();"],
 ['tumble cooldown','damage time runs on through a tumble','bike-ride.ts',"if (this.damageActive) this.damage?.drive(dt, 0, surf.name, 0, false);",''],
 ['pavement limit','pavement speed and acceleration','bike-ride.ts','top: 115 / 3.6','top: 65 / 3.6'],
 ['pavement power','pavement speed and acceleration','bike-ride.ts','accel: 6.4','accel: 3.0'],
 ['gravel limit','gravel speed and acceleration','bike-ride.ts','top: 104 / 3.6','top: 60 / 3.6'],
 ['gravel power','gravel speed and acceleration','bike-ride.ts','accel: 5.9','accel: 3.0'],
 ['grass limit','grass speed and acceleration','bike-ride.ts','top: 88 / 3.6','top: 60 / 3.6'],
 ['grass power','grass speed and acceleration','bike-ride.ts','accel: 5.2','accel: 3.0'],
 ['lean sign','lean has correct sign and steady magnitude','bike-ride.ts','? -Math.atan(speed * input.steer * maxYaw / G)', '? Math.atan(speed * input.steer * maxYaw / G)'],
 ['lean magnitude','lean has correct sign and steady magnitude','bike-ride.ts','surf.grip * G / Math.max(speed, 2)','surf.grip * G * .1 / Math.max(speed, 2)'],
 ['rest upright','upright and stationary at rest','bike-ride.ts','speed * input.steer * maxYaw / G) : 0;', 'speed * input.steer * maxYaw / G) : .2;'],
 ['wheel contact pitch','two wheel contacts follow a real slope','bike-ride.ts','this.pitch = Math.atan2(this.frontHeight - this.rearHeight, this.spec.wheelbase);','this.pitch = 0;'],
 ['wheelie lift','wheelie comes up balances and loops out','bike-ride.ts','(t - .42) * 2.8','(t - .42) * 0'],
 ['wheelie balance','wheelie comes up balances and loops out','bike-ride.ts','(t - .42) * 2.8','(t - .9) * 2.8'],
 ['loop out','wheelie comes up balances and loops out','bike-ride.ts','if (this.wheelie > 1.38)','if (this.wheelie > 100)'],
 ['brake dive','front brake dives and rear brake slides','bike-ride.ts','(t < 0 ? .08 : 0)','(t < 0 ? 0 : 0)'],
 ['rear slide','front brake dives and rear brake slides','bike-ride.ts','sideways += input.steer * speed * dt * 1.4','sideways += 0'],
 ['fixed steps','same physics at 20 30 60 and 120 fps','bike-ride.ts','while (this.acc + 1e-10 >= BIKE_STEP)', 'if (this.acc + 1e-10 >= BIKE_STEP)'],
 ['launch','ballistic ramp range and clean landing','bike-ride.ts',') this.beginJump();',') this.vy = 0;'],
 ['ballistic gravity','ballistic ramp range and clean landing','bike-ride.ts','this.y += this.vy * dt - .5 * G * dt * dt; this.vy -= G * dt;', 'this.y += this.vy * dt - .5 * G * 2 * dt * dt; this.vy -= G * 2 * dt;'],
 ['flip count','one full backflip is counted','bike-ride.ts','Math.floor((Math.abs(this.airPitch) + 1e-6) / TAU)','Math.floor((Math.abs(this.airPitch) + 1e-6) / (TAU * 2))'],
 ['bad landing','bad landing crashes and resets safe upright at rest','bike-ride.ts','Math.abs(angle(this.pitch - slope)) < .62','Math.abs(angle(this.pitch - slope)) < 6.3'],
 ['crash timer recovery','bad landing crashes and resets safe upright at rest','bike-ride.ts','if (this.crashTime >= 1.6)','if (this.crashTime >= 100)'],
 ['safe placement','bad landing crashes and resets safe upright at rest','bike-ride.ts','this.place(safe.x, safe.z, safe.heading);','this.place(safe.x + 40, safe.z, safe.heading);'],
 ['whip','whip returns after air control is released','bike-ride.ts','-input.steer * .85','input.steer * .85'],
 ['edge wall','map edge is a wall','bike-ride.ts','if (!this.bounds) return;','if (this.bounds) return;'],
 ['solid crash','yard solids cannot be crossed and cause a tumble','bike-ride.ts','if (speed > 7 && !this.crashTime)','if (speed > 100 && !this.crashTime)'],
 ['water flight','air above water stays ballistic until contact','bike-ride.ts','&& this.y < this.seaLevel + .1',''],
 ['water recovery','water slows then respawns','bike-ride.ts','if (this.sunk > 1.4) this.respawn();','if (this.sunk > 100) this.respawn();'],
 ['tile correction','new ground data rebases without launching','bike-ride.ts','this.prevGround += correction','this.vy += 1000'],
 ['ground floor','bounded finite state never falls through land','bike-ride.ts','if (newGround !== null && this.y < newGround)', 'if (false)'],
 ['finite throttle','bounded finite state never falls through land','bike-ride.ts','Number.isFinite(input.throttle) ? clamp(input.throttle, -1, 1) : 0','clamp(input.throttle, -1, 1)'],
 ['finite steering','bounded finite state never falls through land','bike-ride.ts','Number.isFinite(input.steer) ? clamp(input.steer, -1, 1) : 0','clamp(input.steer, -1, 1)'],
 ['finite input','bounded finite state never falls through land','bike-ride.ts','if (!Number.isFinite(dt) || dt < 0) return;', 'if (dt < 0) return;'],
 ['speed bound','bounded finite state never falls through land','bike-ride.ts','if (horizontal > 34)', 'if (horizontal > 340)'],
 ['wheel ground clearance','tyres sit on land through lean suspension and wheelies','bike-ride.ts','this.y + axleHeight + lift','this.y + axleHeight - .2 + lift'],
 ['eye outside helmet','procedural model stays within geometry and draw budget','bike.ts','[0, .73, -.34]','[0, .73, -.1]'],
 ['crash model clearance','crash model separates and stays above ground','bike.ts','mesh.position.y = Math.max(mesh.position.y, -BIKE_AXLE_HEIGHT - low);','mesh.position.y = 0;'],
 ['fork guard clearance','front tyre clears the guard at full fork travel','bike.ts','guard(fork, -.75, .82, .61)','guard(fork, -.75, .82, .55)'],
 ['model budget','procedural model stays within geometry and draw budget','bike.ts','triangles, drawCalls: 2','triangles: triangles * 3, drawCalls: 2'],
 ['model shadows','procedural model stays within geometry and draw budget','bike.ts','mesh.castShadow = true','mesh.castShadow = false'],
 ['model fork travel','procedural model stays within geometry and draw budget','bike.ts','sliders.position.y = s.front','sliders.position.y = 0'],
];
validateMutations(root, mutations.map(([name,,file,from,to])=>({name,edits:[{file:'web/src/'+file,from,to,all:true}]})));
const rows=[];
const scratch=mkdtempSync(tmpdir()+'/mmm-bike-mutations-');
try{
 for(const [name,test,file,before,after]of mutations){
  const path=root+'/web/src/'+file,source=readFileSync(path,'utf8');assert.ok(source.includes(before),'missing mutation '+name);
  await build({entryPoints:[root+'/tools/bike-physics-check.mjs'],bundle:true,platform:'node',format:'esm',outfile:scratch+'/check.mjs',logLevel:'silent',plugins:[{name:'bike-break',setup(b){b.onLoad({filter:/[/\\]src[/\\].*\.ts$/},a=>a.path===path?{contents:source.split(before).join(after),loader:'ts'}:undefined)}}]});
  const run=spawnSync(process.execPath,[scratch+'/check.mjs'],{env:{...process.env,BIKE_CASE:test},encoding:'utf8',timeout:30000});
  const detected=run.status!==0&&/AssertionError/.test(run.stderr);rows.push({name,test,exit:run.status,detected});console.log((detected?'DETECTED ':'MISSED ')+name);
  if(!detected)console.log(run.stdout,run.stderr);
 }
 assert.ok(rows.every(r=>r.detected),'a physics mutation survived');console.log(`${rows.length} source mutations detected.`);
}finally{rmSync(scratch,{recursive:true,force:true})}
