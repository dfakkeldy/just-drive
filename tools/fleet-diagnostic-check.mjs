import { readBaseline } from './baseline-source.mjs';
// The opt-in dev hook never changes default arithmetic or ships an active production switch.
import assert from 'node:assert/strict';
import {build} from '../web/node_modules/esbuild/lib/main.js';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const temp=await mkdtemp(join(tmpdir(),'fleet-defect-proof-'));
try{
 const compile=async(name,dev,contents)=>{const path=join(temp,name+'.mjs');await build({...(contents?{stdin:{contents,loader:'ts'}}:{entryPoints:['web/src/defects.ts']}),outfile:path,bundle:true,format:'esm',platform:'node',define:{'import.meta.env.DEV':String(dev)},logLevel:'silent'});return import(path)};
 const baseline=await compile('main',false,readBaseline('fleet-diagnostics','web/src/defects.ts')),normal=await compile('normal',false),diagnostic=await compile('diagnostic',true);
 let hole=null;
 for(let i=0;i<20000;i++){const x=-10200+(i%200)*.23,z=1400+Math.floor(i/200)*.19,d=.42,expected=baseline.potholeDepth(x,z,d);assert.equal(normal.potholeDepth(x,z,d),expected);assert.equal(diagnostic.potholeDepth(x,z,d),expected);if(expected>.05)hole={x,z,d,expected};}
 assert.ok(hole);assert.throws(()=>normal.setDiagnosticPotholes(false),/dev server/);assert.equal(normal.potholeDepth(hole.x,hole.z,hole.d),hole.expected);
 diagnostic.setDiagnosticPotholes(false);assert.equal(diagnostic.potholeDepth(hole.x,hole.z,hole.d),0);diagnostic.setDiagnosticPotholes(true);assert.equal(diagnostic.potholeDepth(hole.x,hole.z,hole.d),hole.expected);
 console.log('PASS 20,000 main-equal default depths; production rejects toggle; dev-only disable and restore');
}finally{await rm(temp,{recursive:true,force:true})}
