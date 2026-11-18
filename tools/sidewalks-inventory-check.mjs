// Inspect the real build_site output. No build, PWA, packer or manifest changes.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync, mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {SIDEWALK_ASSETS} from '../web/src/sidewalks-assets.ts';

const site=resolve(process.argv[2]), baked=resolve('data/baked');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const files=root=>readdirSync(root,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(root+'/'+e.name).map(p=>e.name+'/'+p):[e.name]).sort();
const companions=Object.entries(SIDEWALK_ASSETS).flatMap(([area,qualities])=>Object.values(qualities).map(asset=>({url:`/${area==='mabou'?'terrain':'areas/'+area}/${asset.file}`,...asset})));
const report={siteFiles:files(site).length, companions, inventories:[]};
function check(read) {
  for(const asset of companions) {
    const body=read(site+asset.url);
    assert.equal(body.length,asset.bytes,'published companion bytes '+asset.url);
    assert.equal(hash(body),asset.sha256,'published companion hash '+asset.url);
  }
  // Independently derive every eligible area from its source manifest and READY marker.
  const areas=readdirSync(baked+'/areas').filter(id=>{
    try{return statSync(`${baked}/areas/${id}/READY`).size===0&&JSON.parse(read(`${baked}/areas/${id}/manifest.json`)).area.id===id;}catch{return false;}
  }).sort();
  assert.deepEqual(readdirSync(site+'/areas').sort(),areas,'exact READY/identity area guard');
  assert.deepEqual(files(site+'/terrain'),files(baked+'/terrain'),'all Mabou source files published');
  for(const area of areas)assert.deepEqual(files(site+'/areas/'+area),files(baked+'/areas/'+area).filter(f=>f!=='READY'),'all eligible area files published '+area);
  const inventories=[];
  for(const versionFile of ['version.json','version-just.json']) {
    const version=JSON.parse(read(site+'/'+versionFile)),index=JSON.parse(read(site+version.index));
    const entries=index.files.filter(f=>/\/sidewalks-/.test(f.url));
    assert.deepEqual(entries.map(f=>f.url).sort(),['/terrain/sidewalks-desktop.json','/terrain/sidewalks-low.json'],'both Mabou qualities and no unopened area');
    for(const asset of companions.filter(f=>f.url.startsWith('/terrain/'))) {
      const entry=entries.find(f=>f.url===asset.url);
      assert.equal(entry.bytes,asset.bytes);assert.equal(entry.hash,asset.sha256);
    }
    assert.equal(index.totalBytes,[...index.files,...index.shell].reduce((n,f)=>n+f.bytes,0),'exact offline totalBytes');
    const dataBytes=index.files.reduce((n,f)=>n+f.bytes,0),addedBytes=entries.reduce((n,f)=>n+f.bytes,0);
    inventories.push({version:versionFile,files:index.files.length,totalBytes:index.totalBytes,dataBytes,addedFiles:entries.length,addedBytes,dataBytesWithoutCompanions:dataBytes-addedBytes});
  }
  return {areas,inventories};
}
Object.assign(report,check(readFileSync));
for(const [name,mutate] of [
  ['missing published LOW', (p,b)=>p.endsWith('/terrain/sidewalks-low.json')?Buffer.alloc(0):b],
  ['published hash changed', (p,b)=>p.endsWith('/areas/pointtupper/sidewalks-desktop.json')?Buffer.concat([b,Buffer.from(' ')]):b],
  ['LOW omitted from offline inventory',(p,b)=>/\/offline\/files\./.test(p)?Buffer.from(JSON.stringify({...JSON.parse(b),files:JSON.parse(b).files.filter(f=>f.url!=='/terrain/sidewalks-low.json')})):b],
  ['unopened town in offline inventory',(p,b)=>/\/offline\/files\./.test(p)?Buffer.from(JSON.stringify({...JSON.parse(b),files:[...JSON.parse(b).files,{url:'/areas/porthood/sidewalks-low.json',bytes:1,hash:'x'}]})):b],
  ['stale totalBytes',(p,b)=>/\/offline\/files\./.test(p)?Buffer.from(JSON.stringify({...JSON.parse(b),totalBytes:JSON.parse(b).totalBytes-1})):b]
]) {
  assert.throws(()=>check(p=>mutate(p,readFileSync(p))),undefined,'escaped '+name);
  console.log('REJECTED inventory mutant',name);
}
mkdirSync('data/work/checks',{recursive:true});
const out=mkdtempSync(resolve('data/work/checks/checks-sidewalks-inventory-'));
writeFileSync(out+'/inventory.json',JSON.stringify(report,null,2)+'\n');
console.log('PASS actual site READY areas, source file counts, six companions and both offline inventories',JSON.stringify(report));
console.log('Evidence kept at '+out);
