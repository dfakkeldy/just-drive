#!/usr/bin/env node
// Non-coast programs are pinned to a repository file. Site additions are reported separately.
import {readFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';import assert from 'node:assert/strict';
import {program,preprocess,normalized,checkShaderBaseline,withoutFarBend} from './coast-programs.mjs';
const metrics=s=>({lines:s.split('\n').filter(l=>l.trim()).length,textureReads:(s.match(/\b(?:texture|texture2D|textureLod|texelFetch)\s*\(/g)??[]).length});
export function compareWaterShaders(current,main=null,report=console.log){
 if(main===null)checkShaderBaseline(current,{report});
 const variants=[];
 for(const name of ['TERRAIN_VERT','TERRAIN_FRAG','SEA_VERT','SEA_FRAG']){
  const plain=preprocess(program(current,name),['LOW']),a=normalized(plain);
  if(main!==null){
   const b=normalized(preprocess(program(withoutFarBend(main),name),['LOW']));
   const compared=normalized(preprocess(program(withoutFarBend(current),name),['LOW']));
   if(compared!==b){let i=0;while(compared[i]===b[i])i++;throw Error(`${name} differs at ${i}: current ${compared.slice(i-40,i+100)} / main ${b.slice(i-40,i+100)}`);}
  }
  report(`PASS LOW ${name}: ${main===null?'matches shared file pin':'identical to main'} after preprocessing`);
  const site=preprocess(program(current,name),['LOW','SITE_GRAVEL']),baseStats=metrics(plain),siteStats=metrics(site);
  const row={program:name,low:baseStats,site:siteStats,addedLines:siteStats.lines-baseStats.lines,addedTextureReads:siteStats.textureReads-baseStats.textureReads};variants.push(row);
  assert.equal(row.addedTextureReads,0,`${name}: SITE_GRAVEL must reuse existing texture reads`);
  if(name==='TERRAIN_FRAG'){assert(normalized(site).includes('floatcoverage='),'SITE_GRAVEL coverage missing');assert(row.addedLines>0,'SITE_GRAVEL variant must be checked separately');}
  else assert.equal(normalized(site),a,`${name}: unrelated site changes`);
  report(`PASS LOW + SITE_GRAVEL ${name}: ${siteStats.lines} lines (${row.addedLines>=0?'+':''}${row.addedLines}), ${siteStats.textureReads} texture reads (+${row.addedTextureReads})`);
  const coastal=preprocess(program(current,name),['LOW','COAST_SHORE']),coastStats=metrics(coastal);
  row.coast=coastStats;row.coastAddedLines=coastStats.lines-baseStats.lines;row.coastAddedTextureReads=coastStats.textureReads-baseStats.textureReads;
  assert.equal(row.coastAddedTextureReads,0,`${name}: COAST_SHORE must not add texture reads`);
  if(current.includes('#ifdef COAST_SHORE')&&(name==='TERRAIN_VERT'||name==='TERRAIN_FRAG'))assert(row.coastAddedLines>0,`${name}: COAST_SHORE variant must be reported`);
  else if(!current.includes('#ifdef COAST_SHORE')||!['TERRAIN_VERT','TERRAIN_FRAG'].includes(name))assert.equal(normalized(coastal),a,`${name}: unrelated coast changes`);
  report(`PASS LOW + COAST_SHORE ${name}: ${coastStats.lines} lines (+${row.coastAddedLines}), ${coastStats.textureReads} texture reads (+${row.coastAddedTextureReads})`);
 }
 const dry=normalized(preprocess(program(current,'TERRAIN_FRAG'),['SHADOWS']));assert(!dry.includes('uniformsampler2DtReflection;')&&!dry.includes('floatlap='));assert(dry.includes('vec3inlandWaterColor('));
 const coast=normalized(preprocess(program(current,'TERRAIN_FRAG'),['SEA_WATER','SHADOWS']));assert(coast.includes('uniformsampler2DtReflection;')&&coast.includes('floatlap='));
 report('PASS dry/coastal shader variants: heavy water and shoreline code only on sea-capable tiles');return variants;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
 assert.ok(process.argv.slice(2).every(arg=>arg==='--update'),'usage: node tools/water-source-check.mjs [--update]');
 const source=readFileSync(process.env.COAST_SHADER_FILE??new URL('../web/src/shaders.ts',import.meta.url),'utf8');
 if(process.argv.includes('--update'))checkShaderBaseline(source,{update:true});
 // Preserve the exported source-to-source API used by fishing mutations. The CLI pin needs no git.
 compareWaterShaders(source);
 if(process.env.WATER_MAIN_REF){
  const ref=process.env.WATER_MAIN_REF;console.log('Extra LOW comparison baseline: '+ref);
  compareWaterShaders(source,execFileSync('git',['show',ref+':web/src/shaders.ts'],{encoding:'utf8'}));
 }
}
