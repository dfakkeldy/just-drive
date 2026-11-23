// Generate/check reduced production-rig snapshots. Never run in the browser or write into data/.
import { build } from '../web/node_modules/esbuild/lib/main.js';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const root = new URL('../', import.meta.url);
export const inputs = ['web/src/car-model.ts','web/src/glb-model.ts','web/public/models/mail-car-low.glb','web/src/truck.ts','web/src/truck-surfaces.ts','web/src/truck-reflections.ts','web/src/sxs.ts','web/src/sxs-variants.ts','web/src/bike.ts','web/src/trailer.ts','web/src/vehicle-spec.ts','tools/mp-model-source.ts','tools/mp-models-build.mjs','web/package-lock.json'];
export const fingerprint = () => createHash('sha256').update(inputs.map(p=>readFileSync(new URL(p,root))).join('\n')).digest('hex');
export function canvasStub() {
  const ctx = new Proxy({}, { get: (o,k) => k==='createLinearGradient' ? ()=>({addColorStop(){}}) : k==='measureText' ? ()=>({width:100}) : o[k]??(()=>{}), set:(o,k,v)=>(o[k]=v,true) });
  globalThis.document = {createElement:()=>{const canvas={width:1,height:1,getContext:()=>ctx};ctx.canvas=canvas;return canvas;}};
  globalThis.innerHeight = 1000;
}
/** The mail car is a model file. Give the bundled game code what a page has for reading it: the file by its address,
 *  a picture decoder (the pictures are not used: textured parts stay out of a ghost) and `self`. */
export function modelFiles() {
  const network = globalThis.fetch;
  globalThis.self = globalThis;
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1 });
  globalThis.fetch = async (url, init) => {
    const name = /^\/models\/([\w-]+\.glb)$/.exec(String(url))?.[1];
    if (!name) return network(url, init);
    const b = readFileSync(new URL('web/public/models/' + name, root));
    return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
  };
}
/** The mail car's ghost at unit scale (metres): its length and height. Two checks pin it; the numbers live here. */
export const CAR_GHOST_SIZE = { length: 4.6173, height: 1.66535 };
/** esbuild options that the game's model loader needs when it is bundled for node. */
export const modelDefine = { 'import.meta.env.BASE_URL': '"/"' };
export async function generate() {
  const bundled = await build({entryPoints:[new URL('tools/mp-model-source.ts',root).pathname], bundle:true,nodePaths:[new URL('web/node_modules',root).pathname],platform:'node',format:'esm',write:false,logLevel:'silent',define:modelDefine});
  const mod = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
  canvasStub(); modelFiles(); await mod.prepareCar();
  const models={};
  for(const kind of ['car','truck','trailer','sxs','bike','sxs-utility','sxs-crew','sxs-cabin']) {
    const t=performance.now(),source=mod.sourceModel(kind),g=mod.reduceModel(source);
    models[kind]={...source.userData.ghostSpec,...Object.fromEntries(['position','color'].map(k=>[k,Array.from(g.attributes[k].array,v=>Math.round(v*100000)/100000)]))};
    g.dispose();console.log(kind,Math.round(performance.now()-t)+' ms');
  }
  return {source:fingerprint(),triangles:mod.MODEL_TRIANGLES,models};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const generated=await generate(),path=new URL('web/src/mp/ride-models.json',root);
  if(process.argv.includes('--write'))writeFileSync(path,JSON.stringify(generated)+'\n');
  else if(JSON.stringify(generated)!==readFileSync(path,'utf8').trim())throw Error('Ghost models are stale: node tools/mp-models-build.mjs --write');
}
