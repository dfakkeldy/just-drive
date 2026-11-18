import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {preprocess,normalized} from './coast-programs.mjs';
const require=createRequire(new URL('../web/package.json',import.meta.url)),{buildSync}=require('esbuild');
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const renderer=read('web/node_modules/three/src/renderers/WebGLRenderer.js'),program=read('web/node_modules/three/src/renderers/webgl/WebGLProgram.js');
function rendererContract(text){assert.match(text,/const contextName = 'webgl2';/);assert.doesNotMatch(text,/const contextName = '(?:webgl|experimental-webgl)';/);assert.match(text,/WebGL 1 is not supported since r163/);assert.match(program,/versionString = '#version 300 es/);}
rendererContract(renderer);
assert.equal(JSON.parse(read('web/node_modules/three/package.json')).version,JSON.parse(read('web/package.json')).dependencies.three);
assert.match(read('web/src/main.ts'),/antialias: !LOW(?: && FINISH\.canvasSamples)?, logarithmicDepthBuffer: !LOW/);
function moduleAt(change){const m={exports:{}};const code=buildSync({stdin:{contents:change??read('web/src/far-materials.ts'),resolveDir:new URL('../web/src',import.meta.url).pathname,loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false,external:['three']}).outputFiles[0].text;new Function('require','module','exports',code)(require,m,m.exports);return m.exports;}
const strip=s=>s.replace(/\/\/ FAR_LOG_DEPTH_BEGIN[\s\S]*?\/\/ FAR_LOG_DEPTH_END/g,'');
function guards(mod){for(const shader of [mod.centroidDepthVertex('#include <logdepthbuf_pars_vertex>\nvoid main(){\n#include <logdepthbuf_vertex>\n}'),mod.centroidDepthFragment('#include <logdepthbuf_pars_fragment>\nvoid main(){\n#include <logdepthbuf_fragment>\n}')]){assert.equal(normalized(preprocess(shader,['LOW'])),normalized(preprocess(strip(shader),['LOW'])),'LOW preprocessed centroid additions are empty');assert.match(preprocess(shader,['USE_LOGDEPTHBUF']),/centroid varying/,'desktop log-depth compiles covered-sample declarations');assert.doesNotMatch(preprocess(shader,[]),/vFarFragDepth|vFarDepthXZ/);}}
guards(moduleAt());
if(process.argv.includes('--mutations')){assert.throws(()=>guards(moduleAt(read('web/src/far-materials.ts').replaceAll('#ifdef USE_LOGDEPTHBUF','#if 1'))),{name:'AssertionError'});console.log('KILLED centroid enabled in LOW');assert.throws(()=>rendererContract(renderer.replace("const contextName = 'webgl2';","const contextName = 'webgl';")),{name:'AssertionError'});console.log('KILLED WebGL1 fallback assumption');}
console.log('PASS pinned WebGL2/GLSL300 contract; LOW centroid code preprocesses away');
