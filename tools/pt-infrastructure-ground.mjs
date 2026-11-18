import {railLand} from './guardrail-land.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
const raw=process.argv[2]; if(!raw)throw Error('give extraction scratch folder');
const land=railLand('areas/pointtupper'),data=JSON.parse(readFileSync(`${raw}/selected.json`));
const culverts=JSON.parse(readFileSync('data/baked/areas/pointtupper/streams.json')).culverts;
function segdist(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy)));return Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dy*t);}
for(const f of data.features){
 f.outline=f.outline.filter((p,i,a)=>!i||Math.hypot(p[0]-a[i-1][0],p[1]-a[i-1][1])>.01);
 if(f.kind==='culvert')f.existing=culverts.some(c=>f.outline.slice(1).some((b,i)=>segdist([(c.a[0]+c.b[0])/2,(c.a[1]+c.b[1])/2],f.outline[i],b)<20));
 const pts=[];
 for(let i=0;i<f.outline.length;i++){
  const a=f.outline[i],b=f.outline[i+1],n=b?Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/(f.kind==='conveyor'||f.kind==='pipeline'?1:8)):1;
  for(let j=0;j<n;j++){
   const e=a[0]+(b?b[0]-a[0]:0)*j/n,north=a[1]+(b?b[1]-a[1]:0)*j/n;
   const y=land.ground(e-land.village[0],land.village[1]-north,true);if(y===null)throw Error('no baked height '+f.id);
   pts.push([+e.toFixed(2),+north.toFixed(2),+y.toFixed(2)]);
  }
 }
 f.points=pts;
 if(f.kind==='gate'&&f.outline.length===1){const [e,n]=f.outline[0];f.gateGround=[-2,2].map(dx=>+land.ground(e+dx-land.village[0],land.village[1]-n,true).toFixed(2));}
}
writeFileSync('web/src/pt-infrastructure-source.ts',`// Extracted 2026-11-15. EPSG:2961. Ground samples only from shipped data/baked/areas/pointtupper.\n// NSTDB: Open Government Licence - Nova Scotia; CanVec: Open Government Licence - Canada; © OpenStreetMap contributors: ODbL 1.0.\n// Unspecified dimensions are schematic: conveyor 2.4 x 1.6 m, clearance 5 m; pipe diameter 0.6 m, clearance 1.2 m; fence 2 m; point gate 4 m; pier width 2 m; culvert diameter 1 m.\nimport type { InfrastructureFeature } from './pt-infrastructure';\nexport const PT_BOUNDS = [620172,5045988,632460,5058276] as const;\nexport const PT_FEATURES = [\n${data.features.map(f=>JSON.stringify(f)).join(',\n')}\n] satisfies readonly InfrastructureFeature[];\n`);
console.log('source',data.features.length,'existing culverts',data.features.filter(f=>f.existing).length);
