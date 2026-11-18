#!/usr/bin/env node
// Run only inside one owned yard-shots browser session, after the clean integration checks.
// Run: node tools/bike-browser-mutations.mjs. Source edits exist only in Vite transforms.
import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mutationSession, serveMutation } from './mutation-session.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const cases=[
 ['bike selection','ride','garage.ts','ride: (rig, terrain, roads, sea, spec) => new BikeRide(rig as Bike, terrain, roads, sea, spec)','ride: undefined','explore bike shows bike and rider instead of car'],
 ['title buttons','ride','title.ts','if (explore && ride)', 'if (false && ride)', 'title ride choice and bike keys'],
 ['title multiplayer layout','ride','title.ts','{grid-row:7}','{grid-row:5}','explore title keeps choice and multiplayer controls in order'],
 ['title keys','ride','title.ts',"ride?.kind === 'bike' ? bikeKeys(touch)","ride?.kind === 'never' ? bikeKeys(touch)", 'title ride choice and bike keys'],
 ['driving input','ride','main.ts','vehicle.update(dt, ride.input(input), resolveYardSolids)','vehicle.update(0, ride.input(input), resolveYardSolids)','W drives the bike'],
 ['map releases pull','ride','bike-controls.ts',',#bigMap:not([hidden])','','a Shift held through the map needs a fresh press to pull'],
 ['keyboard pull','ride','bike-controls.ts','pull: held || keys.size > 0','pull: held','desktop Shift plus W lifts the front wheel'],
 ['settings visibility','ride','ride-features.ts',"panel.append(heading, vehicleButtons(choice, 'settingsVehicleChoice'));",'void heading;','settings exposes the ride choice'],
 ['car help hidden','phone','ride-features.ts','get drivingHelp(): boolean { return !bike; }','get drivingHelp(): boolean { return true; }','PULL target and no car steering help'],
 ['choice storage','ride','vehicle-choice.ts','localStorage.setItem(VEHICLE_KEY, next)','localStorage.setItem(VEHICLE_KEY, \'bike\')','settings switch saves reloads and keeps pose'],
 ['choice reload','ride','vehicle-choice.ts','location.search = q.toString();','void q.toString();','settings switch saves reloads and keeps pose'],
 ['position restore','ride','vehicle-choice.ts','vehicle.place(p.x, p.z, p.heading);','vehicle.place(p.x + 20, p.z, p.heading);','settings switch saves reloads and keeps pose'],
 ['title save','ride','vehicle-choice.ts','localStorage.setItem(VEHICLE_KEY, next)','localStorage.setItem(VEHICLE_KEY, \'car\')','title switch saves reloads and keeps pose'],
 ['mail garage defaults','ride','garage.ts','if (explore) { try','if (true) { try','saved bike leaves ordinary mail on the original car and game'],
 ['ramp engine','ramp','bike-ride.ts','t * surf.accel','t * 0','bike climbs the real slipway and launches'],
 ['ramp launch','ramp','bike-ride.ts',') this.beginJump();',') this.vy = 0;','bike climbs the real slipway and launches'],
 ['ramp landing','ramp','bike-ride.ts','const clean = Math.abs(angle(this.pitch - slope)) < .62','const clean = false && Math.abs(angle(this.pitch - slope)) < .62','bike lands the slipway jump cleanly'],
 ['jump telemetry','ramp','bike-ride.ts','this.lastJump = { ...this.jump };','this.lastJump = { ...this.jump, peakHeight: NaN };','jump telemetry is exposed in dev'],
 ['jump HUD','ramp','ride-features.ts','j && j.airTime > 1','j && j.airTime > 100','HUD shows long jump summary'],
 ['places road placement','places','main.ts','vehicle.restart(x, z, heading); vehicle.vx','vehicle.restart(x+20, z+20, heading); vehicle.vx','bike place jump rests on road and shows arrival'],
 ['animal horn','places','main.ts','animals?.honk(vehicle); roadScene?.honk(vehicle);','roadScene?.honk(vehicle);','bike horn reaches animals'],
 ['eye camera','places','bike-camera.ts',"if (view === 'seat')",'if (false)','bike eye camera stays above land'],
 ['road reset','places','bike-ride.ts','respawn(): void {','respawn(): void { return;','R resets bike to road at rest'],
 // The planner writes PULL's inline rectangle at every phone size, over bike-controls.ts CSS, so mutate the planner.
 ['phone pull target','phone','phone-controls-layout.ts',"put('tcPull', driveLeft, bottom - pedal, width, pedal)","put('tcPull', driveLeft, bottom - pedal, 0, pedal)",'PULL target and no car steering help'],
 ['phone overlap','phone','phone-controls-layout.ts',"driveLeft -= width + gap; put('tcPull'","put('tcPull'",'clear controls'],
 ['runtime error collection','places','ride-features.ts','if (!explore) return;',"setTimeout(() => { throw new Error('bike test break'); }, 100); if (!explore) return;",'places animals horn and camera have no runtime errors'],
 ['phone pull input','phone','bike-controls.ts','pull: held || keys.size > 0','pull: false','phone GO plus PULL raises front wheel'],
 ['area yard disabled','area','main.ts','AREA.worksYard ? new YardSite','true ? new YardSite','Judique bike has no yard or animals and keeps its garage choice'],
 ['area driving','area','main.ts','vehicle.update(dt, ride.input(input), resolveYardSolids)','vehicle.update(0, ride.input(input), resolveYardSolids)','bike drives on Judique land'],
 ['area nullable horn','area','main.ts','animals?.honk(vehicle)','animals!.honk(vehicle)','Judique bike reset horn eye and fly have no runtime errors'],

 ['mail explicit override','ride','main.ts','readVehicle(params, !mailMode)','readVehicle(mailMode ? new URLSearchParams() : params, !mailMode)','explicit mail vehicle override uses the bike garage entry'],
 ['at parameter','parameters','main.ts','placeUrlPose(urlPlacement, manifest.village, pose)','placeUrlPose(urlPlacement, manifest.village, [pose[0]+20, pose[1], pose[2] ?? 0])','bike parameter at='],
 ['road parameter','parameters','main.ts','placeVisit(ax, az, Math.atan2(bx - ax, -(bz - az)) + flip);','placeVisit(ax+20, az+20, Math.atan2(bx - ax, -(bz - az)) + flip);','bike parameter road='],
 ['cam parameter','parameters','main.ts','camera.position.set(p.x, s.abs','camera.position.set(p.x+20, s.abs','bike parameter cam='],
 ['shot parameter','parameters','main.ts',"if (SHOTS.length && params.has('shot'))",'if (false)','bike parameter shot='],
 ['demo parameter','parameters','dev-hooks.ts',"autopilot(vehicle, roads, this.throwMail ? 8 : 16)",'autopilot(vehicle, roads, 0)','bike parameter demo='],
 ['multiplayer flag','parameters','main.ts','const multiplayer = MULTIPLAYER ?', 'const multiplayer = false ?','bike parameter mp='],

];
const rows=[];
const documents=cases.map(([name,,file,from,to])=>({name,edits:[{file:'web/src/'+file,from,to,all:true}]}));
if (!await mutationSession(root,'bike-browser-mutations.mjs',documents,process.argv.slice(2),'mode=explore&vehicle=bike')) {
 try {
  const selected=cases.filter(([name])=>!process.env.BIKE_MUTATION||process.env.BIKE_MUTATION.split('|').includes(name));
  assert.ok(selected.length,'BIKE_MUTATION matches no mutations');
  for(const [name,family,,,,target]of selected){
   const marker=name+'-'+randomUUID();
   await serveMutation({...documents.find(d=>d.name===name),marker},process.argv[3]);
   const result=await new Promise((resolve,reject)=>{
    const p=spawn(process.execPath,[root+'/tools/bike-browser-check.mjs',...process.argv.slice(2)],{env:{...process.env,SHOTS:'0',BIKE_FAMILY:family,BIKE_SIZES:'844x390',BIKE_EXPECT_MUTATION:marker},stdio:['ignore','pipe','pipe']});let text='';
    const int=()=>p.kill('SIGINT'),term=()=>p.kill('SIGTERM');process.on('SIGINT',int);process.on('SIGTERM',term);
    p.stdout.on('data',d=>text+=d);p.stderr.on('data',d=>text+=d);p.on('error',reject);p.on('close',(code,signal)=>{process.off('SIGINT',int);process.off('SIGTERM',term);resolve({code,text,signal});});
   });
   if(result.signal)throw Error('mutation interrupted: '+result.signal);
   const detected=result.code!==0&&result.text.split('\n').some(line=>line.startsWith('FAIL ')&&line.includes(target));rows.push({name,target,detected,exit:result.code});console.log((detected?'DETECTED ':'MISSED ')+name);if(!detected)console.log(result.text.slice(-7000));
  }
 }finally{await serveMutation({edits:[]},process.argv[3]);writeFileSync(process.argv[2]+'/bike-browser-mutations.json',JSON.stringify(rows,null,2))}
 assert.ok(rows.every(r=>r.detected),'a browser mutation survived or failed at the wrong gate');console.log(`${rows.length} browser source mutations detected without source writes.`);
}
