#!/usr/bin/env node
import assert from 'node:assert/strict';
import {compareNonCoastPrograms,checkShaderBaseline,coastPrograms} from './coast-programs.mjs';
import {build} from '../web/node_modules/esbuild/lib/main.js';
import {readFileSync,mkdtempSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..');
const mutations=[
 ...['6.46','13.12','5.49','11.44','5.05'].map((h,i)=>['opening '+i+' moved away','coast-site','h:'+h,'h:1000.0']),
 ['gypsum removed','coast-site','face*white','0'],
 ['bench painted','coast-site','smooth(.42,.82,slope)','1'],
 ['away painted','coast-site','return [0,0,0,0];','return [1,0,0,0];'],
 ['highland painted','coast-site','shore*low*top*','shore*low*'],
 ['sea trees','coast-site','return h>.75 &&','return h<.75 ||'],
 ['cliff trees','coast-site','slope<.65','true'],
 ['beach bushes','coast-site','this.weights(x,z,h,slope)[3]<.15','true'],
 ['recess anchor not fitted','terrain','return y===null?p.h:sea+(y-sea)/this.exag;','return p.h;'],
 ['float blocks','coast','block.y=hi-.20','block.y=hi+1'],
 ['wrong ground reader','coast','block.x,block.z,true','block.x,block.z,false'],
 ['away work','coast','if(!this.group.visible)return;',''],
 ['missing frustum cull','coast','this.mesh.frustumCulled=true','this.mesh.frustumCulled=false'],
 ['discarded parent used as ground','terrain','return (q.mesh!.material as THREE.ShaderMaterial).uniforms.hideQuad.value.getComponent(quarter)<.5;','return true;'],
 ['mirror block clip missing','coast','clipping:true','clipping:false'],
 ['extra shadow draw','coast','this.mesh.userData.shadowSet=true','this.mesh.userData.shadowSet=false'],
 ['missing block batch','coast','this.mesh.count=this.blocks.length','this.mesh.count=0'],
];
const sourceMutations=[
  ['real coast call removed under LOW','shaders','  coastSurface(p, vGround, fine, dist, albedo, n);','#ifndef LOW\n  coastSurface(p, vGround, fine, dist, albedo, n);\n#endif'],
  ['real coast call removed on unshadowed desktop','shaders','  coastSurface(p, vGround, fine, dist, albedo, n);','#if defined(LOW) || defined(SHADOWS) || defined(MIRROR)\n  coastSurface(p, vGround, fine, dist, albedo, n);\n#endif'],
  ['real coast call removed outright','shaders','  coastSurface(p, vGround, fine, dist, albedo, n);',''],
  ['phone footprint forced zero','shaders','coastPixelScale * distance','0.0 * distance'],
  ['phone opening fade removed','shaders','float openingFade = smoothstep(3.5,4.0,extent/pixel) * smoothstep(3.0,6.0,extent/pixel);','float openingFade = 1.0;'],
  ['non-coast token joined','shaders','uniform vec3 sunDir;','uniformvec3 sunDir;',true],
  ['unshadowed sea magenta','shaders','void main() {\n#if defined(COAST_SHORE)', 'void main() {\n#if defined(SEA_WATER) && !defined(LOW) && !defined(SHADOWS) && !defined(MIRROR)\ngl_FragColor=vec4(1.,0.,1.,1.);return;\n#endif\n#if defined(COAST_SHORE)',true],
  ['phone extra texel fetch','shaders','#ifdef LOW\n  // No new noise','#ifdef LOW\n  vec4 forbidden=texelFetch(tNormal,ivec2(0),0);\n  // No new noise'],
  ['phone derivative','shaders','#ifdef LOW\n  // No new noise','#ifdef LOW\n  float forbidden=fwidth(h);\n  // No new noise'],
  ['phone extra noise','shaders','#ifdef LOW\n  // No new noise','#ifdef LOW\n  float forbidden=vnoise(p);\n  // No new noise'],
  ['coast compiled into unrelated tiles','shaders','#ifdef COAST_SHORE\nvarying vec4 vCoast;','#if 1\nvarying vec4 vCoast;'],
  ['missing safe derivative footprint','shaders','coastPixel = fwidth(vec3(vWorld.x, vGround, vWorld.z));','coastPixel = vec3(0.);'],
  ['round recesses','shaders','float x = dx * 1.3 / size.x;','float x = length(vec2(dx/size.x,(h-centreHeight)/size.y));'],
  ['recess detached from bedding','shaders','h - centreHeight - dx - 0.7 * (en.y - centre.y)','h - centreHeight'],
  ['beach grass shading guard removed','shaders','ring *= 1.0 - smoothstep(0.05,0.20,vCoast.w);','ring *= 1.0;'],
  ['beach strand orientation lost','shaders','float strandHeight = h +','float strandHeight = en.x +'],
  ['missing recess','shaders','      coastRecess(en,','      //coastRecess(en,'],
  ['recess bypassed shared height','shaders','coastRecess(en,h,anchor.xy,anchor.z','coastRecess(en,h,anchor.xy,1000.0'],
  ['mirror lost coast','terrain','original.defines.COAST_SHORE','original.defines.REMOVED_COAST_SHORE'],
 ];
// Preflight every source anchor before any bundle or scratch mutation is executed.
for(const [name,file,from] of [...mutations,...sourceMutations]) {
 const text=readFileSync(join(root,'web/src/'+file+'.ts'),'utf8');
 assert.ok(text.includes(from),'missing mutation anchor '+name+' in web/src/'+file+'.ts: '+JSON.stringify(from));
}
const shaderText=readFileSync(join(root,'web/src/shaders.ts'),'utf8');
for(const from of ['export const TERRAIN_FRAG =','export const SEA_FRAG =','gl_FragColor = vec4(col, 1.0);','  col = applyFog(col, vWorld, cameraPosition);','float x = dx * 1.3 / size.x;','  coastSurface(p, vGround, fine, dist, albedo, n);']) assert.ok(shaderText.includes(from),'missing mutation anchor in web/src/shaders.ts: '+JSON.stringify(from));
const dir=mkdtempSync(join(tmpdir(),'mmm-coast-check-'));
try{
 // Exercise both real entry points with in-memory source mutations, staged only in scratch files.
 const shaders=readFileSync(join(root,'web/src/shaders.ts'),'utf8');
 const baselineFile=join(dir,'programs.json'),shaderFile=join(dir,'shaders.ts');
 const baseline=readFileSync(join(root,'tools/baseline/programs.json'),'utf8');
 const runPin=(tool,source,args=[])=>{
  writeFileSync(shaderFile,source);
  return spawnSync(process.execPath,[join(root,'tools/'+tool+'-source-check.mjs'),...args],{encoding:'utf8',env:{...process.env,COAST_BASE_REF:'',WATER_MAIN_REF:'',SHADER_BASELINE_FILE:baselineFile,COAST_SHADER_FILE:shaderFile}});
 };
 const changed=(from,to)=>{assert.ok(shaders.includes(from),'pin mutation anchor '+from);return shaders.replace(from,to);};
 const landStart=shaders.indexOf('export const TERRAIN_FRAG =');
 assert.ok(landStart>=0,'TERRAIN_FRAG mutation anchor');
 const land=shaders.slice(0,landStart)+shaders.slice(landStart).replace('gl_FragColor = vec4(col, 1.0);','gl_FragColor = vec4(col, 1.1);');
 assert.ok(land!==shaders,'land-only mutation must change TERRAIN_FRAG');
 // Anchor the sea edit inside SEA_FRAG rather than an earlier terrain applyFog call.
 const seaStart=shaders.indexOf('export const SEA_FRAG =');
 assert.ok(seaStart>=0,'SEA_FRAG mutation anchor');
 const seaOnly=shaders.slice(0,seaStart)+shaders.slice(seaStart).replace('  col = applyFog(col, vWorld, cameraPosition);','  col = applyFog(col, vWorld, cameraPositiox);');
 assert.ok(seaOnly!==shaders,'sea-only mutation must change SEA_FRAG');
 for(const tool of ['coast','water']){
  writeFileSync(baselineFile,baseline);
  for(const [name,source,variant] of [['land one character',land,'TERRAIN_FRAG'],['sea one character',seaOnly,'SEA_FRAG']]){
   const run=runPin(tool,source);
   assert.equal(run.status,1,run.stdout+run.stderr);
   const message=run.stderr.split('\n').find(line=>line.startsWith('Error: Shader pin mismatch:'));
   assert.ok(message?.includes(variant)&&message.includes('[')&&message.includes('--update')&&/\d+ changed: /.test(message)&&message.includes('do not update'),run.stderr);
   console.log('REJECTED '+tool+' '+name+': '+message);
  }
  rmSync(baselineFile);
  const missing=runPin(tool,shaders);
  assert.equal(missing.status,1);assert.match(missing.stderr,/missing, unreadable or invalid \(ENOENT\)/);
  console.log('REJECTED '+tool+' deleted baseline: '+missing.stderr.split('\n').find(line=>line.startsWith('Error: Shader baseline')));
  mkdirSync(baselineFile);
  const unreadable=runPin(tool,shaders);
  assert.equal(unreadable.status,1);assert.match(unreadable.stderr,/missing, unreadable or invalid \(EISDIR\)/);
  console.log('REJECTED '+tool+' unreadable baseline: EISDIR');
  rmSync(baselineFile,{recursive:true});writeFileSync(baselineFile,baseline);
  const coastOnly=changed('float x = dx * 1.3 / size.x;','float x = dx * 1.4 / size.x;');
  const coastal=runPin(tool,coastOnly);
  assert.equal(coastal.status,0,coastal.stderr);
  console.log('PASS '+tool+' COAST_SHORE-only change: '+coastal.stdout.split('\n').find(line=>line.startsWith('PASS shader baseline:')));
  const updated=runPin(tool,seaOnly,['--update']);
  assert.equal(updated.status,0,updated.stderr);assert.notEqual(readFileSync(baselineFile,'utf8'),baseline);
  console.log('PASS '+tool+' scratch --update: '+updated.stdout.split('\n').find(line=>line.startsWith('UPDATED')));
  const rechecked=runPin(tool,seaOnly);
  assert.equal(rechecked.status,0,rechecked.stderr);
  console.log('PASS '+tool+' after scratch --update: '+rechecked.stdout.split('\n').find(line=>line.startsWith('PASS shader baseline:')));
 }
 // A coast-only error leaves the pin intact but still fails the existing live-call rule.
 const brokenCoast=changed('  coastSurface(p, vGround, fine, dist, albedo, n);','');
 writeFileSync(baselineFile,baseline);
 checkShaderBaseline(brokenCoast,{baselineFile,report:()=>{}});
 const rejectedCoast=runPin('coast',brokenCoast);
 assert.equal(rejectedCoast.status,1);assert.match(rejectedCoast.stderr,/one actual terrain coast call/);
 console.log('REJECTED COAST_SHORE-only broken call (pin unchanged): '+rejectedCoast.stderr.split('\n').find(line=>line.startsWith('AssertionError')));
 for(const [name,file,from,to] of [['unmodified',null,null,null],...mutations]){
  const plugins=file?[{name:'coast-rule-mutation',setup(b){b.onLoad({filter:new RegExp('/'+file+'\\.ts$')},args=>{const source=readFileSync(args.path,'utf8');assert.ok(source.includes(from),'mutation anchor '+name);return {contents:source.replace(from,to),loader:'ts'};});}}]:[];
  const outfile=join(dir,'check.mjs');await build({entryPoints:[join(root,'tools/coast-check.mjs')],bundle:true,platform:'node',format:'esm',outfile,plugins,logLevel:'silent'});
  const run=spawnSync(process.execPath,[outfile],{encoding:'utf8'});
  if(!file){assert.equal(run.status,0,run.stderr);console.log(run.stdout.trim());}
  else{assert.notEqual(run.status,0,name+' passed');assert.match(run.stderr,/AssertionError/,name+' failed outside assertion');console.log('REJECTED '+name);}
 }
 for(const [name,file,from,to,baseline] of sourceMutations){
  const source=readFileSync(join(root,'web/src/'+file+'.ts'),'utf8');assert.ok(source.includes(from),'source mutation anchor '+name);
  if(baseline){assert.throws(()=>compareNonCoastPrograms(source.replace(from,to),source),{code:'ERR_ASSERTION'},name+' must fail the exact constructor-derived comparison');console.log('REJECTED '+name);continue;}
  const path=join(dir,file+'.ts');writeFileSync(path,source.replace(from,to));
  const run=spawnSync(process.execPath,[join(root,'tools/coast-source-check.mjs')],{encoding:'utf8',env:{...process.env,COAST_BASE_REF:'',[file==='shaders'?'COAST_SHADER_FILE':'COAST_TERRAIN_FILE']:path}});
  assert.notEqual(run.status,0,name+' passed');assert.match(run.stderr,/AssertionError/,name+' must fail check');console.log('REJECTED '+name);
 }
}finally{rmSync(dir,{recursive:true,force:true})}
// A material constructor that the scanner cannot read must stop the check, not drop out of the pin.
{
 const real=file=>readFileSync(new URL('../web/src/'+file,import.meta.url),'utf8');
 const before=coastPrograms(real).length;
 for(const [name,extra] of [
  ['inline fragment program',"\nnew THREE.ShaderMaterial({ vertexShader: SEA_VERT, fragmentShader: 'void main(){}' });\n"],
  ['conditional program name',"\nnew THREE.ShaderMaterial({ vertexShader: SEA_VERT, fragmentShader: LOW ? SEA_FRAG : SEA_FRAG });\n"],
 ]){
  assert.throws(()=>coastPrograms(file=>real(file)+(file==='water.ts'?extra:'')),/Unsupported shader constructor at water\.ts:\d+/,name+' passed the scanner');
  console.log('REJECTED unreadable shader constructor: '+name);
 }
 const more=coastPrograms(file=>real(file)+(file==='water.ts'?"\nnew THREE.ShaderMaterial({ vertexShader: SEA_VERT, fragmentShader: SEA_FRAG, defines: { NIGHT: 1 } });\n":''));
 assert.ok(more.length>before,'a new readable constructor must add pinned variants');
 console.log('SEEN a new readable constructor adds '+(more.length-before)+' variants to the pin');
}
