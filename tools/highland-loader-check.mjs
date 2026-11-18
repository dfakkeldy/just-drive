// Exercise the production loader and its Highland-specific rejection/cleanup paths without a browser or Blender.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from '../web/node_modules/esbuild/lib/main.js';
import { damageHighland } from './highland-damaged-model.mjs';
const root = new URL('../', import.meta.url), scratch = mkdtempSync(join(tmpdir(), 'mmm-highland-loader-'));
const desktop = readFileSync(new URL('web/public/models/highland-bull.glb', root));
const low = readFileSync(new URL('web/public/models/highland-bull-low.glb', root));
const originalFetch = globalThis.fetch;
let next = null, failed = false, asked = [];
try {
  const compiled = await build({ entryPoints: [new URL('web/src/highland-model.ts', root).pathname], bundle: true, format: 'esm', platform: 'node', write: false, define: { 'import.meta.env.BASE_URL': JSON.stringify('http://highland.test/') } });
  const moduleFile = join(scratch, 'loader.mjs'); writeFileSync(moduleFile, compiled.outputFiles[0].contents);
  const { loadHighlandBull } = await import(pathToFileURL(moduleFile).href);
  globalThis.fetch = async url => {
    asked.push(String(url)); if (failed) throw Error('Highland download failed');
    return new Response(next ?? (String(url).endsWith('-low.glb') ? low : desktop), { status: 200 });
  };
  let prototype;
  for (const [options, triangles, draws] of [[{},7600,3],[{legs:true},7600,7],[{low:true,legs:true},1478,2]]) {
    const rig = await loadHighlandBull(options), meshes=[]; rig.root.traverse(n=>{if(n.isMesh)meshes.push(n)});
    assert.equal(rig.shoulder,1.12); assert.equal(rig.hooves.length,4);
    assert.equal(meshes.length,draws); assert.equal(meshes.reduce((sum,m)=>sum+m.geometry.index.count/3,0),triangles);
    assert.ok(meshes.every(m=>Number.isFinite(m.geometry.boundingSphere.radius)&&m.geometry.boundingSphere.radius>0));
    prototype=rig.torso.geometry.constructor.prototype;
    for(const mesh of meshes)mesh.geometry.dispose();
    console.log('PASS production Highland loader',JSON.stringify(options),triangles,'triangles',draws,'draws');
  }
  assert.deepEqual(asked,['http://highland.test/models/highland-bull.glb','http://highland.test/models/highland-bull.glb','http://highland.test/models/highland-bull-low.glb']);
  const dispose=prototype.dispose; let freed=0;
  prototype.dispose=function(){freed++;return dispose.call(this)};
  try {
    for(const [kind,reason] of [['missing-node',/Highland bull is missing head/],['missing-colour',/needs positions, normals, colours and an index/],['missing-mesh',/Highland bull is missing torso/]]) {
      next=damageHighland(desktop,kind); const before=freed;
      await assert.rejects(loadHighlandBull({legs:true}),reason);
      assert.ok(freed>before,'GLTF scene geometry is freed when '+kind+' rejects');
      console.log('PASS production Highland rejects and frees',kind);
    }
  } finally {prototype.dispose=dispose;}
  failed=true; await assert.rejects(loadHighlandBull(),/Highland download failed/);
  console.log('PASS failed Highland download rejects for the caller fallback');
} finally {globalThis.fetch=originalFetch;rmSync(scratch,{recursive:true,force:true});}
