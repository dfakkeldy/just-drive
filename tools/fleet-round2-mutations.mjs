// Served/bundled source faults only. Production files are never rewritten.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const root=new URL('../',import.meta.url).pathname,scratch=mkdtempSync(join(process.env.MMM_CHECK_OUT??tmpdir(),'fleet-faults-'));
const motion=readFileSync(root+'web/src/fleet-motion.ts','utf8'),fleet=readFileSync(root+'web/src/fleet.ts','utf8');
const surface=readFileSync(root+'web/src/fleet-surface.ts','utf8'),checkpoint=readFileSync(root+'web/src/fleet-checkpoint.ts','utf8');
const faults=[
 ['failed final handoff','FLEET_SOURCE',fleet,"if (!this.take(plan.after)) { this.abort(this.message + '; load cancelled'); return; }",'this.take(plan.after);','review15_late','failed final pickup handoff returns the pre-LOAD driver'],
 ['publish before current-support refit','FLEET_SOURCE',fleet,'target.rollback(); if (changed)',"if (changed) { saved.rollback(); this.draw(new THREE.Vector3()); } target.rollback(); if (changed)",'review16','first restored draw tyres meet CURRENT drawn land within 40 mm'],
 ['one-way display copy','FLEET_SOURCE',fleet,'target.position.copy(source.position);','source.position.copy(target.position);','r27','drawing a parked alias does not mutate the controller pose'],
 ['reparked alias position','FLEET_SOURCE',fleet,'m.lightState = undefined;','','r27','reparked LOW alias follows the actual new position'],
 ['reparked alias bones','FLEET_SOURCE',fleet,'target.position.copy(source.position); target.quaternion.copy(source.quaternion); target.scale.copy(source.scale);','','r27','parked display wheel centres match the native suspension'],
 ['reparked alias rotation','FLEET_SOURCE',fleet,'target.quaternion.copy(source.quaternion);','target.quaternion.identity();','r27','parked display wheel orientation matches native spin and steering'],
 ['native suspension cache','FLEET_SOURCE',fleet,"m.state = m === this.driven ? 'DRIVEN' : 'PARKED'; m.pose = null;","m.state = m === this.driven ? 'DRIVEN' : 'PARKED';",'r27','retaking a natively parked bike keeps its actual suspension cache'],
 ['pair support history','FLEET_SOURCE',fleet,'if (!m.vehicle.resumeAfterParking(pose.travel, pose.spin)) return false;','','r28','committed parked-pair refit updates its native ground history'],
 ['foreign helper teleport import','TELEPORT_AUDIT_SOURCE',"import {teleport as move} from './fleet-motion'; export const automatic=()=>move({});",'automatic','automaticHelper','r15','unauthorized teleport import or re-export'],
 ['recovery state flags','FLEET_SOURCE',fleet,'m.vehicle.airborne = m.vehicle.atEdge = false;','','r26','recovered body no longer reports the old map edge'],
 ['reset ramp destination','FLEET_SOURCE',fleet,"if (member.id !== 'truck' && !attached && this.gates > 0)",'if (false)','r25','R must search beyond a destination'],
 ['skinned query binding','SURFACE_SOURCE',surface,'rig.root.updateMatrixWorld(true); // Refresh attached skinned bind inverses, as the renderer does.','','r23','collision query refreshes skinned binding matrices'],
 ['skinned rollback binding','CHECKPOINT_SOURCE',checkpoint,'{ root.updateWorldMatrix(true, true); root.updateMatrixWorld(true); } for (const skin of skins)','root.updateWorldMatrix(true, true); for (const skin of skins)','r24','rejected provisional pose restores skinned binding matrices'],
 ['fleet-body wake','FLEET_SOURCE',fleet,'this.refreshBodyChanges();','/* omitted body change notification */','r21','fleet-body movement retries a blocked settle'],
 ['real ramp settle','FLEET_SOURCE',fleet,"geometry: deck && this.surface ? p => !this.surface!.crosses(m.rig, this.poseMatrix(m, p)) : m.id !== 'truck' ? p => !this.rampsBlock(m, p) : undefined",'geometry: undefined','r22','land fall cannot settle the bike through real ramp triangles'],
 ['vertical midpoint','MOTION_SOURCE',motion,'const steps = Math.ceil(distance / .02);','const steps = 0;','r17','middle blocks a vertical settle'],
 ['gate midpoint','MOTION_SOURCE',motion,'Math.max(1, Math.ceil(span / .015))','1','r17','middle blocks a gate refit'],
 ['foreign teleport caller','FLEET_SOURCE',fleet,'private park(m: FleetMember): boolean {',"private park(m: FleetMember): boolean { this.teleport('road-reset');",'r15','unauthorized teleport caller park'],
 ['teleport commit check','MOTION_SOURCE',motion,'for (const target of change.targets)','for (const target of [])','r18','commit boundary rechecks all endpoints'],
];
try{for(const[name,key,source,from,to,caseId,message]of faults){assert.ok(source.includes(from),name+' anchor');const file=join(scratch,key+'.ts');writeFileSync(file,source.replace(from,to));const result=spawnSync('/bin/bash',[root+'tools/check-fleet-round2.sh'],{cwd:root,env:{...process.env,[key]:file,REVIEW_CASE:caseId,...(caseId.startsWith('review')?{REVIEW_ENTRY:'fleet-round3-check.mjs'}:{})},encoding:'utf8',timeout:600000,maxBuffer:1024*1024});const output=result.stdout+result.stderr;assert.equal(result.status,1,name+' must fail with an assertion: '+output);assert.ok(output.includes(message),name+' failed its intended assertion: '+output);console.log('KILLED',name)}console.log('PASS fleet round-2 mutations; source unchanged');}finally{rmSync(scratch,{recursive:true,force:true})}
