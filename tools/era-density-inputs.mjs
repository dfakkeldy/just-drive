import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
export const DENSITY_REGENERATE='tools/check-era-density.sh --write';
export const DENSITY_VALIDATE='tools/check-era-density.sh --validate';
// Step 29 alone writes manifest.props (prop and pole counts), and the initial paving delta paved install alone writes
// manifest.paved (the modern-only paved-lot index; main.ts loads it only when ERA.modern). Step 30 alone writes
// manifest.buildingStyles (paint and details; main.ts loads them only when ERA.modern). Far-data/turbine installs alone
// update manifest.tall (main.ts loads tall.json only when ERA.modern). No 1884 input reads any of them, so a prop,
// power, paved, building-colour or far-turbine install must not stale the layout. Every other manifest key stays
// fingerprinted.
export const MANIFEST_UNREAD=['buildingStyles','paved','props','tall'];
// Sorted keys at every depth, so key order is no input: the generator and verifier hash the same canonical text.
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
export function densityFingerprint(file,bytes){
 if(file!=='manifest.json')return {sha256:hash(bytes),bytes:bytes.length};
 let manifest;try{manifest=JSON.parse(bytes);}catch{return {sha256:'invalid manifest JSON',bytes:bytes.length,without:MANIFEST_UNREAD};}
 if(!manifest||typeof manifest!=='object'||Array.isArray(manifest))return {sha256:'invalid manifest object',bytes:bytes.length,without:MANIFEST_UNREAD};
 const kept=Buffer.from(canonical(Object.fromEntries(Object.entries(manifest).filter(([key])=>!MANIFEST_UNREAD.includes(key)))));
 return {sha256:hash(kept),bytes:kept.length,without:MANIFEST_UNREAD};
}
export function densityInputs(base){
 const files=new Map();
 const record=(file,entry)=>{const prior=files.get(file);if(prior&&prior.sha256!==entry.sha256)throw Error('Input changed during generation: '+file);files.set(file,entry);};
 // A read made elsewhere (the PR70 subprocess) reports raw bytes; confirm them, then record this file's own fingerprint.
 const confirm=(file,entry)=>{const bytes=readFileSync(base+'/'+file);if(hash(bytes)!==entry.sha256)throw Error('Input changed during generation: '+file);record(file,densityFingerprint(file,bytes));};
 return {read(file){const bytes=readFileSync(base+'/'+file);record(file,densityFingerprint(file,bytes));return bytes;},confirm,finish(){
  const sorted=[...files].sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0),fixed={},terrain=[];
  for(const [file,entry]of sorted){if(/^\d+\//.test(file))terrain.push({file,...entry});else fixed[file]=entry;}
  return {files:fixed,terrain:{sha256:hash(Buffer.from(terrain.map(r=>r.file+'\0'+r.sha256+'\n').join(''))),count:terrain.length,bytes:terrain.reduce((n,r)=>n+r.bytes,0),files:terrain}};
 }};
}
export function verifyDensityInputs(base,expected,read=file=>readFileSync(base+'/'+file)){
 const fail=message=>{throw Error(`${message}. Regenerate: ${DENSITY_REGENERATE}; validate: ${DENSITY_VALIDATE}`);};
 if(!expected?.files||!Array.isArray(expected?.terrain?.files))fail('Missing land fingerprints');
 for(const name of ['manifest.json','roads.json','streams.json','buildings.json'])if(!expected.files[name])fail('Missing input fingerprint: '+name);
 if(expected.terrain.files.length===0||expected.terrain.count!==expected.terrain.files.length)fail('Empty or incomplete terrain fingerprint set');
 const sorted=[...expected.terrain.files].sort((a,b)=>a.file<b.file?-1:a.file>b.file?1:0),setHash=hash(Buffer.from(sorted.map(e=>e.file+'\0'+e.sha256+'\n').join('')));
 if(setHash!==expected.terrain.sha256)fail('Invalid terrain fingerprint set hash');
 if(JSON.stringify(expected.files['manifest.json'].without)!==JSON.stringify(MANIFEST_UNREAD))fail('Stale manifest.json fingerprint: it must leave out exactly '+JSON.stringify(MANIFEST_UNREAD));
 const entries=[...Object.entries(expected.files).map(([file,e])=>({file,...e})),...expected.terrain.files];
 for(const e of entries){let actual;try{actual=densityFingerprint(e.file,read(e.file)).sha256;}catch{actual='missing';}if(actual!==e.sha256)throw Error(`Land input changed: ${e.file} (expected ${e.sha256}, got ${actual}). Regenerate: ${DENSITY_REGENERATE}; validate: ${DENSITY_VALIDATE}`);}
 let manifest;try{manifest=JSON.parse(read('manifest.json'));}catch{fail('Invalid manifest.json input');}if(!expected.files[manifest.cover?.file])fail('Missing cover input fingerprint: '+manifest.cover?.file);
 return {files:entries.length,bytes:entries.reduce((n,e)=>n+e.bytes,0),terrainSet:expected.terrain.sha256};
}
