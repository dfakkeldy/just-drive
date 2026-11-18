// Read-only exporter: execute the actual current site reservations and road-route recipe. No output files.
import {build} from '../web/node_modules/esbuild/lib/main.js';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=process.cwd(),read=p=>JSON.parse(readFileSync(resolve(root,p),'utf8'));
const entry=`export {routeWalk,WALK_RUNS,sidewalkObstacles} from './web/src/sidewalk-layout.ts';export {YardSite} from './web/src/yard-site.ts';export {FishingSite} from './web/src/fishing-site.ts';export {CoastSite} from './web/src/coast-site.ts';export {PorchSite} from './web/src/porch-site.ts';`;
const out=await build({stdin:{contents:entry,resolveDir:root},bundle:true,write:false,metafile:true,format:'esm',platform:'node',logLevel:'silent',alias:{three:resolve(root,'web/node_modules/three/build/three.module.js')}});
const m=await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
const result={runs:m.WALK_RUNS,areas:{},sources:Object.keys(out.metafile.inputs).filter(p=>p.startsWith('web/src/'))};
for(const area of ['mabou','porthood','pointtupper']) {
 const base=`data/baked/${area==='mabou'?'terrain':`areas/${area}`}/`,manifest=read(base+'manifest.json'),roads=read(base+'roads.json').roads,buildings=read(base+'buildings.json').buildings,props=read(base+'props.json'),v=manifest.village;
 const sites=area==='mabou'?[new m.YardSite(v),new m.FishingSite(v,1.5,0),new m.CoastSite(v)]:[];
 if(area==='mabou'){const box=m.PorchSite.find(buildings);if(box)sites.push(new m.PorchSite(box,v));}
 const reservations=sites.map((s,i)=>{const [x0,z0,x1,z1]=s.box;return {id:`hand-site-${i}`,polygon:[[x0+v[0],v[1]-z0],[x1+v[0],v[1]-z0],[x1+v[0],v[1]-z1],[x0+v[0],v[1]-z1]]};});
 result.areas[area]={manifest,roads,buildings,props,reservations,obstacles:[...m.sidewalkObstacles(buildings,props),...reservations],routes:Object.fromEntries(m.WALK_RUNS.filter(r=>r.area===area).map(r=>[r.id,m.routeWalk(r,roads).map(s=>[...s.p,s.road.id])]))};
}
process.stdout.write(JSON.stringify(result));
