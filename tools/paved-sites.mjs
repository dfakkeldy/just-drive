/** Export current authored site boxes for a subtractive bake; never load reference media. */
import {build} from '../web/node_modules/esbuild/lib/main.js';
import {existsSync,readFileSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const repo=resolve(fileURLToPath(new URL('..',import.meta.url)));
const [root,area,scope]=process.argv.slice(2);
// The paved layer reserves the first eight. The ground-class bake ('ground' scope) reserves every
// web/src/*-site.ts module; tools/ground-classes-check.py holds this list to the folder.
const PAVED_SITES=['yard','home','church','porch','fishing','coast','quarry','mine'];
const GROUND_SITES=[...PAVED_SITES,'yard-dog','judique-village','port-hawkesbury','airport','mabou-main','maryville-store','drlane','depot','prince','blackstone','porthood-gas'];
const ground=scope==='ground';
const imports=(ground?GROUND_SITES:PAVED_SITES).map(s=>`export * as ${s.replace(/-(\w)/g,(_,c)=>c.toUpperCase())} from './web/src/${s}-site';`).join('\n');
const result=await build({stdin:{contents:imports,resolveDir:repo,loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',metafile:true,logLevel:'silent',plugins:[{name:'external-three',setup(b){b.onResolve({filter:/^three$/},()=>({path:pathToFileURL(repo+'/web/node_modules/three/build/three.module.js').href,external:true}));}}]});
const api=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const baked=resolve(root,'data/baked',area==='mabou'?'terrain':`areas/${area}`),read=f=>JSON.parse(readFileSync(resolve(baked,f),'utf8'));
const m=read('manifest.json'),v=m.village,sites=[];
const add=(id,b,world=true)=>{
 const [x0,z0,x1,z1]=b;
 const a=world?[x0+v[0],v[1]-z1,x1+v[0],v[1]-z0]:b;
 sites.push({id,geometry:{type:'Polygon',coordinates:[[[a[0],a[1]],[a[2],a[1]],[a[2],a[3]],[a[0],a[3]],[a[0],a[1]]]]}});
};
// The same fixed sites are reserved across overlapping area rectangles too.
add('yard',new api.yard.YardSite(v,'invented').box);
add('home',new api.home.HomeSite(v).box);
add('church',new api.church.ChurchSite(v).box);
add('fishing',new api.fishing.FishingSite(v).box);
add('coast',api.coast.COAST_BOX,false);
add('quarry',new api.quarry.QuarrySite(v).box);
if(ground){
// Sites made of many boxes reserve each one under the same id.
for(const b of new api.judiqueVillage.JudiqueVillageSite(v).clear)add('judique-village',b);
for(const b of new api.portHawkesbury.PortHawkesburySite(v).clear)add('port-hawkesbury',b);
for(const b of new api.mabouMain.MabouMainSite(v).clear)add('mabou-main',b);
add('maryville-store',new api.maryvilleStore.MaryvilleStoreSite(v).box);
add('depot',new api.depot.DepotSite(v).box);
add('airport',new api.airport.AirportSite(v).box);
}
// Porch and mine use the Mabou source catalog, even when baking overlapping Port Hood.
const main=resolve(root,'data/baked/terrain'),mm=JSON.parse(readFileSync(main+'/manifest.json','utf8'));
const list=JSON.parse(readFileSync(main+'/buildings.json','utf8')).buildings;
const b=api.porch.PorchSite.find(list);if(b)add('porch',new api.porch.PorchSite(b,v).box);
if(ground){const bb=api.blackstone.BlackstoneSite.find(list);if(bb)add('blackstone',new api.blackstone.BlackstoneSite(bb,v).box);}
const inputs=[main+'/manifest.json',main+'/buildings.json',main+'/roads.json'];
// The house on D.R.'s Lane uses the Judique source catalog in the same way.
// A host without the Judique pack has no such house to keep.
const judiqueList=resolve(root,'data/baked/areas/judique/buildings.json');
if(ground&&existsSync(judiqueList)){inputs.push(judiqueList);const jb=api.drlane.DrLaneSite.find(JSON.parse(readFileSync(judiqueList,'utf8')).buildings);if(jb)add('drlane',new api.drlane.DrLaneSite(jb,v).box);}
const tupperList=resolve(root,'data/baked/areas/pointtupper/buildings.json');
if(ground&&existsSync(tupperList)){inputs.push(tupperList);const pb=api.prince.PrinceSite.find(JSON.parse(readFileSync(tupperList,'utf8')).buildings);if(pb)add('prince',new api.prince.PrinceSite(pb,v).box);}
const porthoodList=resolve(root,'data/baked/areas/porthood/buildings.json');
if(ground&&existsSync(porthoodList)){inputs.push(porthoodList);const gb=api.porthoodGas.PortHoodGasSite.find(JSON.parse(readFileSync(porthoodList,'utf8')).buildings);if(gb)add('porthood-gas',new api.porthoodGas.PortHoodGasSite(gb,v).box);}
const roads=JSON.parse(readFileSync(main+'/roads.json','utf8')).roads.map(r=>({...r,pts:r.pts.map(([e,n])=>[e-mm.village[0],mm.village[1]-n])}));
const [l,bottom,r,t]=mm.mid, mv=mm.village;
// The yard dog's driveway snaps to Southwest Ridge Road. Reserve it whenever that placement holds:
// the game's mail, house and clearing guards can only drop the yard, and then the old ground is still right.
const far=[{x:1e9,z:1e9}];
const dog=ground?api.yardDog.YardDogSite.create({roads,village:mv,mail:far,houses:far,excluded:[]}):null;
if(dog)add('yard-dog',dog.box);
const p=api.mine.mineRoadEnd({roads},[l-mv[0]+120,mv[1]-t+120,r-mv[0]-120,mv[1]-bottom-120]);
if(p)for(const side of [-1,1]){
 const e=p.x+mv[0]+Math.cos(p.heading)*(p.halfWidth+18)*side;
 const n=mv[1]-p.z-Math.sin(p.heading)*(p.halfWidth+18)*side;
 add('mine-'+side,[e-16,n-16,e+16,n+16],false);
}
const sources=[...Object.keys(result.metafile.inputs).filter(p=>p!=='<stdin>').map(p=>relative(repo,resolve(repo,p))),'tools/paved-sites.mjs'];
console.log(JSON.stringify({sites,sources,inputs}));
