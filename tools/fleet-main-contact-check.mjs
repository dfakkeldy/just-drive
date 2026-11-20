// The same mapped crossing and bake, with each revision driving its own production car and pickup.
import assert from 'node:assert/strict';
import{readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync}from'node:fs';
import{execFileSync}from'node:child_process';
import{createHash}from'node:crypto';
import{tmpdir}from'node:os';
import{pathToFileURL}from'node:url';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import{build}from'../web/node_modules/esbuild/lib/main.js';
import{png}from'./quarry-height-read.mjs';
import{wheelVertices}from'./fleet-wheel-vertices.mjs';
import{wheelPothole}from'./fleet-wheel-contact.mjs';
import{followPath}from'./fleet-quarry-path.mjs';
const root=process.cwd(),main=process.env.FLEET_MAIN_REF??execFileSync('git',['rev-parse','origin/main'],{encoding:'utf8'}).trim(),out=process.env.FLEET_CONTACT_OUT??(process.env.MMM_CHECK_OUT ? process.env.MMM_CHECK_OUT+'/fleet-main-contact' : root+'/data/work/west-bay/fleet/checks/main-contact'),work=mkdtempSync(tmpdir()+'/mmm-contact-');mkdirSync(out,{recursive:true});
const context=new Proxy({measureText:t=>({width:String(t).length*8}),createLinearGradient:()=>({addColorStop(){}})},{get:(o,k)=>k in o?o[k]:()=>{},set:(o,k,v)=>(o[k]=v,true)});globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>context})};THREE.TextureLoader.prototype.load=()=>new THREE.Texture();globalThis.fetch=async p=>new Response(readFileSync(p));globalThis.createImageBitmap=async b=>png(Buffer.from(await b.arrayBuffer()));globalThis.OffscreenCanvas=class{getContext(){let img;return{drawImage(b){img=b},getImageData(){return{data:img.pixels}}}}};
const base=root+'/data/baked/areas/westbay',manifest=JSON.parse(readFileSync(base+'/manifest.json'));
const path=[[-10752.56,-1082.09],[-10748.89,-1080.49],[-10745.25,-1078.84],[-10741.65,-1077.11],[-10738.13,-1075.26],[-10734.71,-1073.23],[-10731.43,-1070.99],[-10728.32,-1068.54],[-10725.33,-1065.93],[-10722.49,-1063.14],[-10719.89,-1060.13]].map(([x,z])=>({x,z}));const start={...path[0],heading:Math.atan2(path[1].x-path[0].x,-path[1].z+path[0].z)};
async function moduleAt(ref,label){const file=work+'/'+label+'.mjs';await build({stdin:{contents:"export {Vehicle} from './web/src/vehicle';export{Terrain}from'./web/src/terrain';export{Roads}from'./web/src/roads';export{QuarrySite}from'./web/src/quarry-site';export{createCar}from'./web/src/car';export{createTruck,TRUCK_SPEC}from'./web/src/truck';export{CAR_SPEC}from'./web/src/vehicle-spec';export{potholeDepth,potholeDensity}from'./web/src/defects';",resolveDir:root,loader:'ts'},outfile:file,bundle:true,platform:'node',format:'esm',define:{'import.meta.env.DEV':'false'},logLevel:'silent',plugins:[{name:'revision',setup(b){b.onResolve({filter:/^three(?:\/.*)?$/},a=>({path:a.path==='three'?pathToFileURL(root+'/web/node_modules/three/build/three.module.js').href:pathToFileURL(root+'/web/node_modules/three/'+a.path.slice(6).replace('addons/','examples/jsm/')).href,external:true}));if(ref)b.onLoad({filter:/\/web\/src\/.*\.ts$/},a=>({contents:execFileSync('git',['show',ref+':'+a.path.slice(root.length+1)],{encoding:'utf8'}),loader:'ts'}));}}]});return import(pathToFileURL(file).href);}
async function fixture(mod,hill,kind){const terrain=new mod.Terrain(manifest,base,{},hill,-.2),site=new mod.QuarrySite(manifest.village);terrain.sites.push(site);terrain.coast=site;const ids=new Set();for(let x=start.x-260;x<=start.x+260;x+=120)for(let z=start.z-260;z<=start.z+260;z+=120){const size=manifest.size/256;ids.add(Math.floor((x+manifest.village[0]-manifest.origin[0])/size)+'_'+Math.floor((z-manifest.village[1]+manifest.origin[1])/size));}for(const id of ids){const[i,j]=id.split('_').map(Number);await terrain.loadNow(8,i,j)}terrain.group.traverse(n=>{if(n.isMesh)n.visible=true});terrain.group.updateMatrixWorld(true);const roads=new mod.Roads(JSON.parse(readFileSync(base+'/roads.json')),manifest.village,terrain),rig=kind==='car'?mod.createCar(false):mod.createTruck(false),v=new mod.Vehicle(rig,terrain,roads,-.2,kind==='car'?mod.CAR_SPEC:mod.TRUCK_SPEC);
let seed=1;
v.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
v.assist=0;v.strongHelp=false;v.touchSpeedLimit=false;
assert.ok(v.place(start.x,start.z,start.heading),'crossing start accepted');for(let i=0;i<240;i++)v.update(1/120,{throttle:0,steer:0,handbrake:true});const wheels=[...new Set([...Object.values(rig.wheels),...(rig.extraWheels??[])])],tyres=wheels.map(w=>wheelVertices(THREE,rig,w)),samples=[];rig.root.traverse(m=>{if(!m.isMesh||m===rig.riderMesh)return;for(let p=m;p&&p!==rig.root;p=p.parent)if(wheels.includes(p))return;const a=m.geometry.attributes.position,cells=new Map();for(let i=0;i<a.count;i++){if(a.getY(i)>1)continue;const key=Math.floor(a.getX(i))+','+Math.floor(a.getZ(i)),old=cells.get(key);if(old===undefined||a.getY(i)<a.getY(old))cells.set(key,i)}for(const i of cells.values())samples.push({m,i})});return{mod,terrain,roads,rig,v,wheels,tyres,samples};}
function measure(f,s){const p=new THREE.Vector3(),c=new THREE.Vector3(),member={state:'DRIVEN',id:s.kind,vehicle:f.v};f.rig.root.updateMatrixWorld(true);const depth=Math.max(...f.wheels.map((_,i)=>wheelPothole(member,i,f.terrain,f.mod.potholeDepth,f.mod.potholeDensity)));for(let i=0;i<f.wheels.length;i++){const w=f.wheels[i],gaps=[Infinity,Infinity];w.getWorldPosition(c);for(const local of f.tyres[i]){p.copy(local).applyMatrix4(w.matrixWorld);if(p.y>c.y+.001)continue;const drawn=f.terrain.meshHeightAt(p.x,p.z,true),physics=f.terrain.heightAt(p.x,p.z);assert.notEqual(drawn,null);assert.notEqual(physics,null);s.drawnTyre=Math.max(s.drawnTyre,drawn-p.y);s.ownTyre=Math.max(s.ownTyre,physics-p.y-depth);gaps[local.x<0?0:1]=Math.min(gaps[local.x<0?0:1],p.y-drawn);s.samples++;}s.float=Math.max(s.float,...gaps);}for(const{m,i}of f.samples){m.getVertexPosition(i,p).applyMatrix4(m.matrixWorld);const h=f.terrain.meshHeightAt(p.x,p.z,true);assert.notEqual(h,null);s.body=Math.max(s.body,h-p.y);}}
const contactFields=['drawnTyre','ownTyre','float','body'];
const limit=.005;

async function drive(mod,hill,kind,label,reference){
  const f=await fixture(mod,hill,kind);
  const stats={label,hill,kind,drawnTyre:0,ownTyre:0,float:0,body:0,samples:0,progress:0,arrived:false};
  const inputs=[],state={};
  for(let tick=0;tick<12000;tick++){
    let input;
    // The path driver throws when a heavy vehicle stalls twice. On the main (reference) side that only ends
    // the stretch to compare; on the branch side it stays a failure.
    try{input=followPath(f.v,path,state,4);}catch(e){if(reference||!String(e.message).startsWith('Physical driver cannot progress'))throw e;stats.stall=String(e.message);break;}
    // A steep crossing can stall on main. Compare the same stretch even if the branch can go farther.
    if(reference&&!reference.arrived&&state.at>reference.progress+.05)break;
    stats.progress=Math.max(stats.progress,state.at??0);
    inputs.push(input);
    f.v.update(1/120,input);
    measure(f,stats);
    if(input.arrived){stats.arrived=true;break;}
  }
  assert.ok(stats.samples>0&&stats.progress>1,`${label} ${kind} exercised the crossing at Hill ${hill}`);
  const trace=JSON.stringify(inputs);
  writeFileSync(out+`/inputs-${label}-${hill}-${kind}.json`,trace);
  return {...stats,controls:inputs.length,inputHash:createHash('sha256').update(trace).digest('hex')};
}

function contactDeltas(reference,candidate){
  assert.ok(candidate.progress>=reference.progress-.25&&(!reference.arrived||candidate.arrived),
    `${candidate.label} ${candidate.kind} covered ${candidate.progress.toFixed(2)} m at Hill ${candidate.hill}, ${reference.label} covered ${reference.progress.toFixed(2)} m`);
  return Object.fromEntries(contactFields.map(key=>[key,candidate[key]-reference[key]]));
}

function requireContactParity(kind,deltas){
  for(const key of contactFields)
    assert.ok(deltas[key]<=limit,`branch worsens ${kind} ${key} by ${deltas[key]} m`);
}

function truckVariant(mod,overrides){
  return {...mod,TRUCK_SPEC:{...mod.TRUCK_SPEC,...overrides}};
}

try{
  const baseline=await moduleAt(main,'main'),branch=await moduleAt(null,'branch'),results=[];
  for(const hill of [1,2.5])for(const kind of ['car','truck']){
    const reference=await drive(baseline,hill,kind,'main');
    const candidate=await drive(branch,hill,kind,'branch',reference);
    const deltas=contactDeltas(reference,candidate);
    requireContactParity(kind,deltas);
    results.push({hill,kind,main:reference,branch:candidate,deltas});
    console.log('PASS same-path main comparison',hill,kind,JSON.stringify({deltas,mainProgress:reference.progress,branchProgress:candidate.progress,arrived:candidate.arrived}));
  }
  const reference=results.find(row=>row.hill===1&&row.kind==='truck').branch;
  const spec=branch.TRUCK_SPEC;
  // Vary only the spec consumed by fixture(), leaving the production model and solvers in place.
  // Keep the reduced acceleration below the track's grip limit even if production power rises.
  const lessPower=truckVariant(branch,{engineAcceleration:Math.min(spec.engineAcceleration*.65,4.9),enginePower:spec.enginePower*.65});
  const slower=await drive(lessPower,1,'truck','less-power',reference);
  assert.notEqual(reference.inputHash,slower.inputHash,'the stronger truck must choose different controls');
  const fasterDeltas=contactDeltas(slower,reference);
  requireContactParity('truck',fasterDeltas);
  console.log('PASS stronger pickup with independent controls',JSON.stringify(fasterDeltas));

  const shortWheelbase=truckVariant(branch,{wheelbase:spec.wheelbase*2/3});
  const mutant=await drive(shortWheelbase,1,'truck','short-wheelbase',reference);
  const mutantDeltas=contactDeltas(reference,mutant);
  assert.throws(()=>requireContactParity('truck',mutantDeltas),/branch worsens truck (drawnTyre|ownTyre|float|body)/,
    'a changed TRUCK_SPEC wheelbase must fail the contact comparison');
  console.log('MUTATION rejected shorter TRUCK_SPEC wheelbase',JSON.stringify(mutantDeltas));
  writeFileSync(out+'/comparison.json',JSON.stringify({mainRef:main,head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),limit,path,start,results,
    controls:{lessPower:{...slower,strongerDeltas:fasterDeltas},shortWheelbase:{...mutant,deltas:mutantDeltas}}},null,2));
}finally{rmSync(work,{recursive:true,force:true})}
