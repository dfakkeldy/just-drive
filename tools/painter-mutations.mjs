import {build} from '../web/node_modules/esbuild/lib/main.js';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),dir=mkdtempSync(`${tmpdir()}/mmm-painter-`);
const mutants=[['sea view','out.heading += 3 * Math.PI / 4','out.heading -= 3 * Math.PI / 4'],['mud overlap','!fishDay(day, forced) && day % 3 === 1','day % 3 === 2'],['forced fish','!fishDay(day, forced)','true'],['era',"era !== '1884'",'true'],['rail side','side: -7.5','side: 7.5'],['lane','side: -7.5','side: -2'],['speed','> PAINTER.speed','>= 2'],['range','distance < PAINTER.range && roadDistance','distance < 100 && roadDistance'],['off road','roadDistance <= halfWidth','true'],['washboard','kind === 3','true'],
 ['no dusty flag','this.dusty = true;','','painter-scene'],['reset keeps dusty','this.dusty = false; this.group','this.group','painter-scene'],['mesh faces field','rotation.y = -this.pose.heading','rotation.y = this.pose.heading','painter-scene'],
 ['no wiring','if (!this.paused) this.painter.step(player, playing && !this.shift.ended);','','road-scene'],['shift end ignored','this.painter.step(player, playing && !this.shift.ended)','this.painter.step(player, playing)','road-scene'],['pause ignored','if (!this.paused) this.painter.step','this.painter.step','road-scene'],
 ['road distance ignored','const fromCentre = Math.hypot(player.x-this.probe.x,player.z-this.probe.z);','const fromCentre = 0;','painter-scene'],['probe at painter','this.road.at(this.road.alongAt(player.x,player.z),0,this.probe);','this.road.at(PAINTER.along,0,this.probe);','painter-scene'],
 ['scene param ignored',"painterDay(this.shift.career.day, this.params.get('scene'),","painterDay(this.shift.career.day, null,",'painter-scene'],['forward only','Math.abs(player.speed) <= PAINTER.speed','player.speed <= PAINTER.speed','painter-scene'],
 ['unloaded complains','!playing || !this.group.visible ||','!playing ||','painter-scene'],
 ['inland view','3 * Math.PI / 4','Math.PI / 4'],['never culled','>PAINTER.draw) return;','>1e9) return;','painter-scene'],['no hint',"get hint(): string { return this.group.visible ? painterHint(this.distance, this.closing, this.speed, this.dusty) : ''; }","get hint(): string { return ''; }",'painter-scene'],['hint not wired','|| this.painter.hint; }','; }','road-scene'],
 ['hint late','range: 13, hint: 220','range: 13, hint: 160'],['hint not forced beside','distance < PAINTER.range || distance','distance'],['hint only beside','|| distance < PAINTER.hint && closing > 1','|| false'],['hint after passing','closing > 1','true'],['no too-late line','if (dusty) return','if (false) return'],['hint while parked',"if (Math.abs(speed) <= 1) return '';",''],['long too-late line','distance < 2 * PAINTER.range ?','distance < PAINTER.hint ?'],['speed not kept','this.speed = player.speed;','','painter-scene'],
 ['hint while unloaded','return this.group.visible ? painterHint','return true ? painterHint','painter-scene'],['closing sign','player.speed*(dx*Math.sin','-player.speed*(dx*Math.sin','painter-scene'],
 ['distance only when fast','if (!this.enabled) return;','if (!this.enabled || Math.abs(player.speed) <= PAINTER.speed) return;','painter-scene'],
 ['stays drawn','  update(camera: THREE.Camera): void {\n    this.group.visible = false;\n','  update(camera: THREE.Camera): void {\n','painter-scene']];
try {
 for(const mutant of [null,...(process.argv.includes('--mutations')?mutants:[])]) {
  const file=mutant?.[3]??'painter-rules',source=resolve(root,`web/src/${file}.ts`),original=readFileSync(source,'utf8');
  if(mutant)assert.ok(original.split(mutant[1]).length===2,mutant[0]+': anchor must match once');
  await build({entryPoints:[resolve(root,'tools/painter-check.mjs')],bundle:true,platform:'node',format:'esm',outfile:`${dir}/check.mjs`,logLevel:'silent',plugins:mutant?[{name:'mutate',setup(b){b.onLoad({filter:new RegExp(`/${file}\\.ts$`)},()=>({contents:original.replace(mutant[1],mutant[2]),loader:'ts',resolveDir:dirname(source)}));}}]:[]});
  const r=spawnSync(process.execPath,[`${dir}/check.mjs`],{cwd:resolve(root,'web'),encoding:'utf8'});
  if(!mutant){assert.equal(r.status,0,r.stderr);console.log(r.stdout.trim());}
  else {assert.notEqual(r.status,0,mutant[0]+' survived');assert.match(r.stderr,/AssertionError/);console.log('REJECTED',mutant[0]);}
 }
}finally{rmSync(dir,{recursive:true,force:true});}
