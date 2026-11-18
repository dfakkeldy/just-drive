// Same-camera pictures, wall guard input and actual land/sheet provenance of the near-shore notch.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {open} from './cdp.mjs';
import {shoreShape} from './quarry-shore-shape.mjs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const[out,first]=process.argv.slice(2),origin=new URL(first).origin,baseline=process.env.QUARRY_LOOKS_BASELINE==='1';
const shapeFailures=[];
const views=[['wall-toe-hill-1',631796.361,5064433.895,1.8,295,-6,65,1,false],['wall-toe-hill-1.5',631796.361,5064433.895,1.8,295,-6,65,1.5,false],['wall-from-water',631870,5064500,2.8,270,12,60,1.5,false],['lake-shore-v2',631810,5064460,2.8,70,-8,60,1.5,false],['west-wall-close-v2',631825,5064430,12,295,-12,65,1,false],['sc-air-north-v2',631900,5063300,450,350,-32,60,1.5,false],['wall-toe-low',631796.361,5064433.895,1.8,295,-6,65,1.5,true]];
for(const[name,e,n,eye,heading,pitch,fov,hill,low]of views){
 if(baseline&&!['wall-toe-hill-1','lake-shore-v2'].includes(name))continue;
 if(process.env.QUARRY_LOOKS_SHORE_ONLY==='1'&&name!=='lake-shore-v2')continue;
 const url=`${origin}/?area=westbay&mode=explore&cam=${e},${n},${eye},${heading},${pitch},${fov}&camground=1&exag=${hill}&q=${low?'low':'high'}&hud=0&radio=0&res=1&shadows=1`;
 const p=await open(url);
 try{
  await p.send('Emulation.setDeviceMetricsOverride',{width:1392,height:866,deviceScaleFactor:1,mobile:false});
  await p.read(`(async()=>{window.requestAnimationFrame=()=>0;const THREE=await import('/node_modules/three/build/three.module.js');const{terrain:t,quarry:k,camera:c,renderer:r,trees,roads,water,vehicle:v}=mmm;let scene=v.car.root;while(scene.parent)scene=scene.parent;c.aspect=1392/866;c.updateProjectionMatrix();r.setSize(1392,866,false);window.look={THREE,t,k,c,r,trees,roads,water,v,scene};
   for(let i=0;i<220;i++){t.update(c);trees?.update(t.drawnFine,c.position);roads.update(c.position);k.update(c.position,v);water?.update(c);r.render(scene,c);water?.settle();water?.afterRender(c);await new Promise(r=>setTimeout(r,20));if(!t.pending&&!(trees?.pending??0)&&i>20)break;}
   ${name.startsWith('wall-toe')?'c.position.y=t.meshHeightAt(c.position.x,c.position.z,true)+1.8;c.updateMatrixWorld();':''}
   for(let i=0;i<10;i++){t.update(c);trees?.update(t.drawnFine,c.position);k.update(c.position,v);water?.update(c);r.render(scene,c);water?.settle();water?.afterRender(c);await new Promise(r=>setTimeout(r,20));}
   if(mmm.low!==${low})throw Error('wrong picture quality');})()`);
  await p.shot(out+'/'+(baseline?'pass4-baseline-':'')+name+'.png');
  if(name==='wall-toe-hill-1'){
   await p.read(`(()=>{const {t,r,scene,c}=look;look.savedRock=[];for(const mesh of t.group.children)if(mesh.isMesh&&mesh.material.defines?.QUARRY){const m=mesh.material;if(look.savedRock.some(([a])=>a===m))continue;look.savedRock.push([m,m.fragmentShader]);const start=m.fragmentShader.indexOf('#ifdef QUARRY',m.fragmentShader.indexOf('float warp = vnoise(en * 0.13)')),end=m.fragmentShader.indexOf('#else',start);if(start<0||end<0)throw Error('missing quarry rock branch');m.fragmentShader=m.fragmentShader.slice(0,start)+'#ifdef QUARRY\\n albedo=mix(albedo,vec3(.83,.806,.744)*(1.0-max(-vCoast.y,0.0)*.17),w.x);\\n }\\n'+m.fragmentShader.slice(end);m.needsUpdate=true;}r.render(scene,c);})()`);
   await p.shot(out+'/'+(baseline?'pass4-baseline-':'')+'wall-control.png');
   await p.read(`(()=>{for(const[m,src]of look.savedRock){m.fragmentShader=src;m.needsUpdate=true;}look.r.render(look.scene,look.c);})()`);
  }
  if(name==='wall-toe-hill-1'&&!baseline)for(const distance of [3,20,200,400]){
   await p.read(`(async()=>{const{THREE,t,k,c,r,trees,roads,water,v,scene}=look,x=631748-t.manifest.village[0],z=t.manifest.village[1]-5064500,h=t.meshHeightAt(x,z,true);if(h===null)throw Error('detail face not drawn');const dx=(t.meshHeightAt(x+1,z,true)-t.meshHeightAt(x-1,z,true))/2,dz=(t.meshHeightAt(x,z+1,true)-t.meshHeightAt(x,z-1,true))/2,target=new THREE.Vector3(x,h,z),normal=new THREE.Vector3(-dx,1,-dz).normalize();c.position.copy(target).addScaledVector(normal,${distance});c.lookAt(target);c.updateMatrixWorld();for(let i=0;i<180;i++){t.update(c);trees?.update(t.drawnFine,c.position);roads.update(c.position);k.update(c.position,v);water?.update(c);r.render(scene,c);water?.settle();water?.afterRender(c);await new Promise(r=>setTimeout(r,20));if(!t.pending&&!(trees?.pending??0)&&i>20)break;}})()`);
   await p.shot(out+'/wall-detail-'+distance+'m.png');
  }
  if(name==='lake-shore-v2'){
   const proof=await p.read(`(()=>{const{THREE,t,k,c,r}=look,W=1392,H=866,target=new THREE.WebGLRenderTarget(W,H),s=new THREE.Scene(),land=[],wet=[],old=r.getRenderTarget(),color=r.getClearColor(new THREE.Color()),alpha=r.getClearAlpha();t.group.updateMatrixWorld(true);k.water.group.updateMatrixWorld(true);
    for(const m of t.group.children)if(m.visible&&m.isMesh){const a=m.material.clone(),src=a.fragmentShader;a.fragmentShader=src.slice(0,src.lastIndexOf('}'))+'gl_FragColor=vec4(1.0,0.0,0.0,1.0);\\n}';const copy=new THREE.Mesh(m.geometry,a);copy.onBeforeRender=m.onBeforeRender;copy.matrixAutoUpdate=false;copy.matrix.copy(m.matrixWorld);copy.frustumCulled=false;s.add(copy);land.push({copy,source:a.fragmentShader});}
    for(const m of k.water.meshes)if(m.visible){const a=new THREE.MeshBasicMaterial({color:0x00ff00,side:THREE.DoubleSide,toneMapped:false}),copy=new THREE.Mesh(m.geometry,a);copy.matrixAutoUpdate=false;copy.matrix.copy(m.matrixWorld);copy.renderOrder=1;s.add(copy);wet.push(copy);}
    const draw=mode=>{for(const{copy,source}of land){copy.visible=mode!=='waterOnly';copy.material.fragmentShader=mode==='noMask'?source.replace(/if\\(vCoast\\.(?:y|z)>[^\\n]+discard;/,''):source;copy.material.needsUpdate=true;}r.setRenderTarget(target);r.setClearColor(0,0);r.clear();r.render(s,c);const px=new Uint8Array(W*H*4);r.readRenderTargetPixels(target,0,0,W,H,px);return px;};const normal=draw('normal'),noMask=draw('noMask'),waterOnly=draw('waterOnly');
    const label=(a,x,y)=>{const i=((H-1-y)*W+x)*4;return a[i]>200?'land':a[i+1]>200?'water':'none';};
    const ray=new THREE.Raycaster(),ndc=new THREE.Vector2(),meshes=t.group.children.filter(m=>m.visible&&m.isMesh),samples=[];
    for(const[x,y]of[[1145,650],[1160,665],[1175,680],[1190,660],[1200,680],[1230,670],[1300,680],[1370,670],[1258,728],[1268,740],[1275,752],[1290,771],[1310,740],[1300,785]]){
     ndc.set((x+.5)/W*2-1,1-(y+.5)/H*2);ray.setFromCamera(ndc,c);const hits=ray.intersectObjects(meshes,false).filter(h=>{const q=h.object.material.uniforms.hideQuad.value;return q.getComponent((h.uv.x>=.5?1:0)+(h.uv.y>=.5?2:0))<.5;}),hit=hits[0],water=ray.intersectObjects(k.water.meshes.filter(m=>m.visible),false)[0];let detail=null;
     if(hit){const g=hit.object.geometry,pos=g.attributes.position,ground=g.attributes.ground,coast=g.attributes.coast,ids=[hit.face.a,hit.face.b,hit.face.c],v=ids.map(i=>new THREE.Vector3().fromBufferAttribute(pos,i).applyMatrix4(hit.object.matrixWorld));let tile=null;for(const[key,q]of t.tiles)if(q.mesh===hit.object){tile=key;break;}detail={tile,face:hit.faceIndex,distance:hit.distance,point:{e:hit.point.x+t.manifest.village[0],n:t.manifest.village[1]-hit.point.z,y:hit.point.y},vertices:v.map((p,j)=>({e:p.x+t.manifest.village[0],n:t.manifest.village[1]-p.z,y:p.y,ground:ground.getX(ids[j]),drop:g.attributes.quarryWaterDrop?.getX(ids[j])??0,coast:coast?Array.from({length:4},(_,k)=>coast.array[ids[j]*4+k]):null}))};}
     samples.push({pixel:[x,y],normal:label(normal,x,y),noMask:label(noMask,x,y),waterOnly:label(waterOnly,x,y),land:detail,water:water?{distance:water.distance,y:water.point.y}:null});}
    let changed=0,boundary=0,footprint=0;for(let y=640;y<710;y++)for(let x=1145;x<1390;x++){if(label(normal,x,y)!==label(noMask,x,y))changed++;if(label(normal,x,y)==='land'&&(label(normal,x,y+1)==='water'||label(normal,x+1,y)==='water')){boundary++;if(label(waterOnly,x,y)==='none')footprint++;}}
    r.setRenderTarget(old);r.setClearColor(color,alpha);for(const{copy}of land)copy.material.dispose();for(const m of wet)m.material.dispose();target.dispose();return{viewport:[W,H],roi:[1145,640,1390,710],changedWithoutCoverageMask:changed,boundarySamples:boundary,withoutSheetBehind:footprint,samples};})()`);
   proof.waterViewAudit=await p.read(`(()=>{const{t}=look,stats={meshes:0,loweredVertices:0,nonWaterLowered:0,outsideBoxVertices:0,outsideBoxTriangles:0,maxDrop:0};for(const m of t.group.children)if(m.isMesh&&m.geometry.attributes.quarryWaterDrop){stats.meshes++;const g=m.geometry,p=g.attributes.position,d=g.attributes.quarryWaterDrop,c=g.attributes.coast;for(let i=0;i<d.count;i++)if(d.getX(i)>0){stats.loweredVertices++;stats.maxDrop=Math.max(stats.maxDrop,d.getX(i));if(c.getY(i)!==1)stats.nonWaterLowered++;const e=p.getX(i)+t.manifest.village[0],n=t.manifest.village[1]-p.getZ(i);if(e<630200||e>633200||n<5062000||n>5066500)stats.outsideBoxVertices++;}const idx=g.index.array;for(let i=0;i<idx.length;i+=3){const ids=[idx[i],idx[i+1],idx[i+2]];if(!ids.some(j=>d.getX(j)>0))continue;if(ids.some(j=>{const e=p.getX(j)+t.manifest.village[0],n=t.manifest.village[1]-p.getZ(j);return e<630200||e>633200||n<5062000||n>5066500;}))stats.outsideBoxTriangles++;}}return stats;})()`);
   proof.shape=await p.read(`(${shoreShape.toString()})(look.THREE,look.t,look.k,look.c,look.r)`);
   writeFileSync(out+'/pass4-'+(baseline?'baseline-':'')+'notch.json',JSON.stringify(proof,null,2));console.log('NOTCH',JSON.stringify(proof));if(proof.shape.unsupportedCount)shapeFailures.push(proof.shape);
  }
 }finally{await p.close();}
}

const metric=spawnSync('python3',[fileURLToPath(new URL('./quarry-blockiness.py',import.meta.url)),out+'/'+(baseline?'pass4-baseline-':'')+'wall-toe-hill-1.png','--control',out+'/'+(baseline?'pass4-baseline-':'')+'wall-control.png','--report',out+'/pass4-blockiness-'+(baseline?'baseline':'current')+'.json'],{encoding:'utf8'});console.log(metric.stdout);console.error(metric.stderr);if(metric.status!==0)process.exitCode=1;

assert.deepEqual(shapeFailures,[],'no unsupported shoreline turn above 50 degrees within 16 screen pixels');
