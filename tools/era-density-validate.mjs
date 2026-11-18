import {Vector3,Matrix4} from '../web/node_modules/three/build/three.module.js';
import {footprintsOverlap,footprintRoadClear} from '../web/src/eras/history-footprints.ts';
// Independent acceptance path: production Terrain.load/heightAt/meshHeightAt, not the generator's PNG sampler.
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {makeGround,preload} from './phone-ground.mjs';
import {Roads} from '../web/src/roads.ts';
import {HistoryScene} from '../web/src/eras/history-scene.ts';
import {HistoryBridgeApproaches} from '../web/src/eras/history-approaches.ts';
import {historyLayout} from '../web/src/eras/history-layout.ts';
import {farmBarn,siteCorners} from '../web/src/eras/history-sites.ts';
import {RESIDENCES_1884,densityCellAt,inVillage1884,densityCellId} from '../web/src/eras/mabou-1884-density.ts';
import {privateDensityAudit,auditMarkRecords} from './era-density-private.mjs';
const canvas=()=>({width:0,height:0,getContext:()=>new Proxy({measureText:t=>({width:t.length*80})},{get:(t,k)=>k in t?t[k]:()=>{},set:(t,k,v)=>(t[k]=v,true)})});
export async function validateDensity(base,data){
 const oldExag=process.env.PHONE_EXAG;process.env.PHONE_EXAG='1';const {terrain}=makeGround();if(oldExag===undefined)delete process.env.PHONE_EXAG;else process.env.PHONE_EXAG=oldExag;
 terrain.cartRoads=true;globalThis.document={createElement:canvas};
 const bmp=await createImageBitmap(new Blob([readFileSync(base+'/'+terrain.manifest.cover.file)]));terrain.coverPixels={data:bmp.pixels,width:bmp.width,height:bmp.height};
 const roads=new Roads(JSON.parse(readFileSync(base+'/roads.json')),terrain.manifest.village,terrain),origin=terrain.manifest.village;
 const {trades,farms}=historyLayout(origin);const scene=new HistoryScene(terrain,roads,null,[],()=>0,{trades,farms});
 const approaches=new HistoryBridgeApproaches(roads,terrain,()=>10),physical={},levels={},stats={houses:farms.length,barns:0,rawMaxSlope:0,drawnMaxSlope:0};
 const resolution=(x,z,id)=>{
  const m=terrain.manifest,e=x+m.village[0]-m.origin[0],south=z+m.origin[1]-m.village[1];
  for(let level=8;level>=0;level--){const size=m.size/2**level,i=Math.floor(e/size),j=Math.floor(south/size),file=`${level}/${i}_${j}.png`;if(!m.levels[level]?.includes(`${i}_${j}`))continue;
   if(size/256<=4){if(!existsSync(base+'/'+file))throw Error(`${id}: missing fine tile ${file}; require raw spacing <=4 m`);return;}
   break;
  }
  const size=m.size/64;throw Error(`${id}: missing fine tile 6/${Math.floor(e/size)}_${Math.floor(south/size)}.png; require raw spacing <=4 m`);
 };
 // Panels/posts are upright. Flat contact heights expose their actual instance matrices without changing X/Z.
 const flat={cartRoads:true,manifest:{village:origin},clear:[],coverAt:(x,z)=>terrain.coverAt(x,z),dataRevision:1,contactRevision:1,meshContactSource:()=>1,meshContactAt(x,z,out){out.height=10;out.source=1;out.drawn=true;return true;},meshHeightAt:()=>10};
 const boardScene=new HistoryScene(flat,roads,null,[],()=>10),components=[];
 for(const board of boardScene.boards.list){
  boardScene.update(new Vector3(board.owner.site.x,50,board.owner.site.z+20));boardScene.group.updateMatrixWorld(true);
  assert(board.owner.ready,'board geometry probe has live owner');
  const c=Math.cos(board.yaw),a=Math.sin(board.yaw),pos=board.mesh.geometry.attributes.position,points=[];
  for(let i=0;i<pos.count;i++){const v=new Vector3(pos.getX(i),pos.getY(i),pos.getZ(i)).applyMatrix4(board.mesh.matrixWorld);points.push([v.x,v.z]);}
  const bound=(p,id)=>{const u=p.map(([x,z])=>x*c-z*a),v=p.map(([x,z])=>x*a+z*c),cx=(Math.min(...u)+Math.max(...u))/2,cz=(Math.min(...v)+Math.max(...v))/2;return{id,x:cx*c+cz*a,z:-cx*a+cz*c,yaw:board.yaw,width:Math.max(...u)-Math.min(...u),length:Math.max(...v)-Math.min(...v)};};
  components.push(bound(points,'panel-'+board.owner.site.id));
  const posts=boardScene.boards.posts,post=posts.geometry.attributes.position;
  for(let side=0;side<2;side++){const p=[],matrix=new Matrix4();posts.getMatrixAt(board.slot+side,matrix);for(let i=0;i<post.count;i++){const v=new Vector3(post.getX(i),post.getY(i),post.getZ(i)).applyMatrix4(matrix).applyMatrix4(posts.matrixWorld);p.push([v.x,v.z]);}components.push(bound(p,'post-'+side+'-'+board.owner.site.id));}
 }
 for(const component of components){assert(footprintRoadClear(component,roads.roads,1),component.id+' actual geometry clear of roads');for(const f of [...trades,...farms])for(const s of [f,farmBarn(f)].filter(Boolean))assert(!footprintsOverlap(component,s,1),component.id+' actual geometry conflicts with '+s.id);}
 stats.boardAssemblies=scene.boards.list.length;stats.boardComponents=components.length;stats.boardConflicts=0;
 const frame=(s,u,v)=>[s.x+u*Math.cos(s.yaw)+v*Math.sin(s.yaw),s.z-u*Math.sin(s.yaw)+v*Math.cos(s.yaw)];
 const points=s=>{const p=[];for(let u=-s.width/2-1;u<=s.width/2+1.001;u+=.5)for(let v=-s.length/2-1;v<=s.length/2+1.001;v+=.5)p.push(frame(s,u,v));return p;};
 const inBounds=s=>siteCorners(s,5).every(([x,z])=>x+origin[0]>=616196&&x+origin[0]<=632340&&origin[1]-z>=5095260&&origin[1]-z<=5111404);
 const offApproach=s=>{const p=siteCorners(s,2),xs=p.map(p=>p[0]),zs=p.map(p=>p[1]);return approaches.sites.every(a=>Math.max(...xs)<a.box[0]||Math.min(...xs)>a.box[2]||Math.max(...zs)<a.box[1]||Math.min(...zs)>a.box[3]);};
 for(const s of [...trades,...farms]){
  const barn=farmBarn(s),footprints=barn?[s,barn]:[s];if(barn)stats.barns++;
  for(const f of footprints){
   assert(offApproach(f),f.id+' clear of timber approach footprints');if(s.kind==='farm')assert(inBounds(f),f.id+' inside playable wall with 5 m margin');
   const p=points(f);for(const[x,z]of p)for(const[dx,dz]of[[0,0],[-1,-1],[-1,1],[1,-1],[1,1]])resolution(x+dx,z+dz,f.id);await preload(terrain,p.flatMap(([x,z])=>[[x,z],[x-1,z-1],[x+1,z+1]]),0);
   for(const [x,z]of p){
    const cover=terrain.coverAt(x,z);assert(cover!==0&&cover!==4,f.id+' dry production cover');
    const hit=roads.nearest(x,z,20,r=>r.kind>=1&&r.kind<=4);assert(!hit||hit.dist>hit.road.halfWidth+.1,f.id+' off production road');
    const surface=terrain.surfaceAt(x,z);assert(surface,f.id+' loaded fine surface');assert(terrain.manifest.size/2**surface.level/256<=4,f.id+' loaded an impermissibly coarse tile');levels[surface.level]=(levels[surface.level]??0)+1;
    if(s.kind==='farm'){
     assert(surface.brook>0,f.id+' outside production water field');
     for(const [name,ask]of [['raw',terrain.heightAt.bind(terrain)],['drawn',terrain.meshHeightAt.bind(terrain)]])for(const [dx,dz]of [[1,0],[0,1],[Math.SQRT1_2,Math.SQRT1_2],[Math.SQRT1_2,-Math.SQRT1_2]]){
      const a=ask(x-dx/2,z-dz/2),b=ask(x+dx/2,z+dz/2);assert(a!==null&&b!==null,f.id+' fine ground known');const grade=Math.abs(b-a);stats[name+'MaxSlope']=Math.max(stats[name+'MaxSlope'],grade);assert(grade<=.2001,f.id+' '+name+' fine slope '+grade.toFixed(4));
     }
    }
   }
   // Keep the acceptance check bounded on the shared Mac; these are owned Node meshes only.
   for(const t of terrain.tiles.values()){if(t.mesh){terrain.group.remove(t.mesh);t.mesh.geometry.dispose();t.mesh.material.dispose();}}terrain.tiles.clear();
  }
 }
 let beyond60=0,frontage=0;
 for(const s of farms){
  const e=origin[0]+s.x,n=origin[1]-s.z;
  assert.equal(inVillage1884(e,n),s.zone==='village');
  if(s.zone==='village'){
   const road=roads.nearest(s.x,s.z,25,r=>r.kind>=1&&r.kind<=3);if(road){frontage++;const dx=road.x-s.x,dz=road.z-s.z,front=Math.atan2(dx,dz),angle=Math.abs(Math.atan2(Math.sin(s.yaw-front),Math.cos(s.yaw-front)));assert(angle<.02||Math.abs(angle-Math.PI/2)<.02,'village gable/eave faces street');}
  }else{const cell=densityCellAt(e,n);physical[cell]=(physical[cell]??0)+1;if(!roads.nearest(s.x,s.z,60,r=>r.kind>=1&&r.kind<=4))beyond60++;}
  for(const b of farms)if(s!==b)assert(Math.hypot(s.x-b.x,s.z-b.z)>=(s.zone==='village'&&b.zone==='village'?18:60)-.00001,'independent centre spacing');
 }
 assert.equal(farms.filter(s=>s.zone==='village').length,35);assert(frontage>=30,'at least 30 village homes must be within 25 m of a main or connecting road');
 const deficits=data.header.deficits;assert.deepEqual(deficits,data.audit.deficits);
 for(let row=0;row<17;row++)for(let col=0;col<17;col++){
  const cell=densityCellId(col,row),counted=RESIDENCES_1884[row][col],listed=deficits.find(d=>d.cell===cell);if(listed){assert.equal(listed.counted,counted);assert(listed.built<counted&&listed.reason);}
  assert.equal(physical[cell]??0,listed?.built??counted,cell+' independent cell count; no moves');
 }
 assert.equal(data.header.ruralBeyond60m,beyond60);assert.equal(data.audit.ruralBeyond60m,beyond60);
 const privateResult=privateDensityAudit(base.replace(/\/baked\/terrain$/,'')+'/work/history-1884/density/mabou-1884-dwellings.json',farms,origin);
 const valid=Array.from({length:345},(_,i)=>({e:100000+i*100,n:100000,source_panel:'county-south'})),inset=Array.from({length:67},()=>({e:null,n:null,source_panel:'village-inset'}));
 for(const bad of [{marks:[]},{bad:true},{marks:[...valid.slice(1),...inset]},{marks:[{},...valid.slice(1),...inset]}])assert.throws(()=>auditMarkRecords(bad,farms,origin,()=>{}),'malformed/empty private input must fail');
 const house={...farms[0],x:0,z:0,yaw:0,barn:{x:100,z:0}};valid[0]={e:origin[0]+100,n:origin[1]};assert.throws(()=>auditMarkRecords({marks:[...valid,...inset]},[house],origin,()=>{}),'private check must include barn centres');
 console.log('PASS independent production fine-ground, water, roads, approaches, wall, spacing and counts',JSON.stringify({...stats,levels,frontage,ruralBeyond60m:beyond60,private:privateResult}));
 return {...stats,levels,frontage,ruralBeyond60m:beyond60,private:privateResult};
}
