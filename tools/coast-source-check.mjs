#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {coastPrograms,program,preprocess as preprocessText,normalized,compareNonCoastPrograms,checkShaderBaseline,reviewedMirrorCrown} from './coast-programs.mjs';
const source=readFileSync(process.env.COAST_SHADER_FILE??new URL('../web/src/shaders.ts',import.meta.url),'utf8');
const preprocess=(source,flags)=>normalized(preprocessText(source,flags));
const variants=coastPrograms();
assert.ok(process.argv.slice(2).every(arg=>arg==='--update'),'usage: node tools/coast-source-check.mjs [--update]');
// Strip comments first, then inspect GLSL identifiers. This catches coast attributes, varyings,
// uniforms and functions wherever they leak, even with no git history or comparison baseline.
for(const {name,flags} of variants){
 const compiled=preprocessText(program(source,name),flags);
 const tokens=compiled.match(/\b[A-Za-z_]\w*\b/g)??[];
 assert.ok(!tokens.some(t=>/coast/i.test(t)),name+' leaked coast identifier outside COAST_SHORE: '+flags);
}
console.log('PASS '+variants.length+' constructor-derived non-coast programs contain no coast identifiers');
checkShaderBaseline(source,{update:process.argv.includes('--update')});
if(process.env.COAST_BASE_REF){
 const ref=process.env.COAST_BASE_REF,base=execFileSync('git',['show',ref+':web/src/shaders.ts'],{encoding:'utf8'});
 // The reference has no era program. Compare every shared program; CART programs remain separately pinned.
 const shared=variants.filter(v=>!v.name.startsWith('CART_'));
 // The reviewed mirror crown line is pinned in programs.json; map it to its old text on both sides only here.
 compareNonCoastPrograms(reviewedMirrorCrown(source),reviewedMirrorCrown(base),shared);
 console.log('PASS all '+shared.length+' shared non-coast programs (including SITE_GRAVEL) match '+ref);
}
// The actual land main must call the material exactly once, at top level, in both modes.
const coastalFlags=variants.filter(v=>v.name==='TERRAIN_FRAG').map(v=>['COAST_SHORE',...v.flags]);
for(const flags of coastalFlags){
 const compiled=preprocessText(program(source,'TERRAIN_FRAG'),flags),main=compiled.slice(compiled.indexOf('void main()'));
 const call='coastSurface(p, vGround, fine, dist, albedo, n);';
 assert.equal(main.split(call).length-1,1,'one actual terrain coast call '+flags);
 const before=main.slice(0,main.indexOf(call));let depth=0;for(const c of before){if(c==='{')depth++;else if(c==='}')depth--;}
 assert.equal(depth,1,'coast call at main top level '+flags);assert.ok(/[;}]\s*$/.test(before)&&! /\breturn\b/.test(before),'coast call on live path '+flags);
}
console.log('PASS live terrain coast call in all '+coastalFlags.length+' constructor-derived coast fragment variants');
const phone=preprocess(program(source,'COAST_SURFACE'),['COAST_SHORE','LOW']);
assert.ok(phone.includes('voidcoastSurface('));assert.ok(!/texture|texelFetch|sampler|vnoise|fbm|dFdx|dFdy|fwidth/.test(phone),'arithmetic-only phone recesses/seams');
const full=preprocess(program(source,'COAST_SURFACE'),['COAST_SHORE']);assert.ok((full.match(/coastRecess\(/g)??[]).length===2&&full.includes('for(inti=0;i<5;i++)')&&full.includes('anchor=coastRecessAnchor[i]')&&full.includes('coastRecess(en,h,anchor.xy,anchor.z,vec2(anchor.w,coastRecessRise[i])')&&full.includes('floatcoal='),'five shared shallow recess anchors and coal');
assert.ok(phone.includes('coastRecess(en,h,anchor.xy,anchor.z')&&phone.includes('floatcoal=')&&(phone.match(/coastPixelScale\*distance/g)??[]).length===2&&phone.includes('openingFade=smoothstep(3.5,4.0,extent/pixel)*smoothstep(3.0,6.0,extent/pixel)')&&phone.includes('width=max(halfBed,span*1.25)'),'phone openings and distance-faded seams');assert.ok(!full.includes('sampler'),'no coast textures');assert.ok(full.includes('vec3coastBed(')&&!full.includes('length(q)')&&!full.includes('floatx=length('),'uneven relief beds and non-circular openings');assert.ok(full.includes('coalStrata-235.0')&&full.includes('coalStrata-277.0')&&full.includes('coalStrata-326.0')&&!full.includes('fract(seamPhase)'),'three non-periodic seams');assert.ok(full.includes('h-centreHeight-dx-0.7*(en.y-centre.y)'),'recesses share bedding coordinate');assert.ok(full.includes('floatstrandHeight=h+')&&!full.includes('en*vec2(.16,.7)'),'alongshore height contours');
const coastLand=preprocess(program(source,'TERRAIN_FRAG'),['COAST_SHORE','SEA_WATER','SHADOWS']);assert.ok(coastLand.includes('ring*=1.0-smoothstep(0.05,0.20,vCoast.w);'),'no grass-root shade seam on bare coast sand');const footprint=coastLand.indexOf('coastPixel=fwidth(');assert.ok(footprint>=0&&footprint<coastLand.indexOf('discard;')&&!full.includes('fwidth('),'coast derivatives precede every branch/discard');
const terrain=readFileSync(process.env.COAST_TERRAIN_FILE??new URL('../web/src/terrain.ts',import.meta.url),'utf8');
assert.ok(terrain.includes('this.low)mesh.onBeforeRender')&&terrain.includes('updateCoastView(renderer,camera,material)'),'footprint updated at actual draw');
const coastConstructors=coastPrograms(file=>file==='terrain.ts'?terrain:readFileSync(new URL('../web/src/'+file,import.meta.url),'utf8'),true,true);
assert.ok(coastConstructors.some(r=>r.name==='TERRAIN_FRAG'&&r.flags.includes('COAST_SHORE')&&!r.flags.includes('MIRROR')),'actual ordinary tile constructor retains coast specialization');
assert.ok(coastConstructors.some(r=>r.name==='TERRAIN_FRAG'&&r.flags.includes('COAST_SHORE')&&r.flags.includes('MIRROR'))&&terrain.includes('original.defines.COAST_SHORE'),'actual mirror constructor retains the source coast flag');
console.log('PASS LOW coast has no extra texture reads/noise/derivatives; desktop coast has no textures; mirror retains coast mask');
