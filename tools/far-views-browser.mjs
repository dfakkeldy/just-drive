#!/usr/bin/env node
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {cdp,cdpFetch,sleep} from './cdp.mjs';
const [out,base]=process.argv.slice(2),port=process.env.CDP_PORT;
const views=[
 ['marble-sw','porthood',612761.94,5099561.98,73.15,225,0,60,15],
 ['marble-se','porthood',612761.94,5099561.98,73.15,150,0,60,15],
 ['mabou-nw','mabou',622560,5112920,329.39,305,0,60,15],
 ['tupper-south','pointtupper',630000,5053000,160,210,0,60,15],
 ['tupper-night','pointtupper',630000,5053000,160,210,0,60,23],
 ['high-mabou','mabou',622560,5112920,900,305,-1,60,15],
 ['high-sea','mabou',622560,5112920,3000,305,-2,60,15],
 ['very-high-sea','mabou',622560,5112920,10000,305,-3,60,15],
];
views.push(['mabou-east','mabou',622560,5112920,329.39,85,0,60,15],['shore-mabou','mabou',622560,5112920,329.39,215,-1,60,15],['shore-cape','mabou',619881.19,5112017.41,182.82,210,-1,60,15],['marble-nw','porthood',612761.94,5099561.98,73.15,305,0,60,15]);
const selected=process.env.FAR_VIEWS?.split(',');
let tab,c;
try{
 tab=await(await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();c=await cdp(tab.webSocketDebuggerUrl);await c.send('Page.enable');
 await c.send('Emulation.setDeviceMetricsOverride',{width:Number(process.env.FAR_WIDTH??1920),height:Number(process.env.FAR_HEIGHT??1080),deviceScaleFactor:1,mobile:false});
 const read=async expression=>{const r=await c.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.result.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result.result.value;};
 for(const v of views){
  const [name,area,e,n,h,yaw,pitch,fov,hour]=v;const fileName=name+(process.env.FAR_LOW==='1'?'-LOW':'');if(selected&&!selected.includes(name))continue;
  for(const mode of process.env.FAR_MODES?.split(',')??['before','after']){
   await fetch(`${base}/__far-views-mode?mode=${mode}`);
   const url=`${base}/?area=${area}&cam=${e},${n},${h},${yaw},${pitch},${fov}&hour=${hour}&mode=explore&bare=1&res=1&hud=0&exag=1&shadows=0&q=${process.env.FAR_LOW==='1'?'low':'high'}&far=full`;
   await c.send('Page.navigate',{url});const since=Date.now();
   for(;;){if(await read(mode==='after'?"document.title==='settled'&&!!window.mmm?.farLand":"document.title==='settled'&&!!window.mmm"))break;assert.ok(Date.now()-since<240000,'settled '+name);await sleep(500);}
   await sleep(500);assert.equal(await read('mmm.renderer.getContext().isContextLost()'),false);
   const info=await read(`(()=>{const {renderer:r,farLand:f,farTurbines:t,camera,scene}=mmm;const sea=scene.getObjectByName('near-sea')??scene.children.find(o=>o.geometry?.parameters?.width===600000&&o.geometry?.parameters?.height===600000),g=sea.geometry,bytes=[...Object.values(g.attributes),g.index].filter(Boolean).reduce((n,a)=>n+a.array.byteLength,0);return {renderCalls:r.info.render.calls,renderTriangles:r.info.render.triangles,programCount:r.info.programs.length,sea:{triangles:g.index.count/3,bytes,depthTest:sea.material.depthTest,depthWrite:sea.material.depthWrite,low:!!sea.material.defines?.LOW,groups:g.groups.length},occlusion:mmm.farVisibility?.records.map(q=>({visible:q.visible,pending:q.pending,drawn:q.mesh.visible})),camera:camera.position.toArray(),fov:camera.fov,root:f?.data.root,draws:f?[f.group.children.length,t?.group.children.length]:[],land:f?.data.levels,farTurbines:t?.count,triangleCounts:t?.group.children.map(m=>(m.geometry.index?.count??m.geometry.getAttribute('position').count)*m.count/3),farTime:t?.time.value,programErrors:r.info.programs.filter(p=>p.diagnostics&&!p.diagnostics.runnable).map(p=>p.diagnostics),renderer:r.getContext().getParameter(r.getContext().getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL)}})()`);
   assert.deepEqual(info.programErrors,[],'no shader compile errors');if(mode==='after')assert.ok(info.farTurbines>0&&info.land,'real far data');
   if(mode==='after'&&['marble-se','shore-mabou','shore-cape'].includes(name)){
    info.shoreGap=await read(`(async()=>{const T=await import('/node_modules/three/build/three.module.js'),{renderDrop}=await import('/src/far-rules.ts');const{terrain:t,camera:c}=mmm,sea=mmm.scene.getObjectByName('near-sea'),p=sea.geometry.attributes.position,sectors=mmm.low?64:128,rings=[];
     for(let i=4;i<p.count;i+=sectors+1)rings.push(p.getX(i));const level=sea.material.uniforms.seaLevel.value,heading=c.getWorldDirection(new T.Vector3());let samples=0,worst={pixels720:0,metres:0};
     const seaY=(x,z)=>{const dx=x-c.position.x,dz=z-c.position.z,angle=(Math.atan2(dz,dx)+Math.PI*2)%(Math.PI*2),a=Math.floor(angle/(Math.PI*2)*sectors),q=a*Math.PI*2/sectors,q1=(a+1)*Math.PI*2/sectors,cross=Math.sin(q1-q),radial=((dx*Math.sin(q1)-dz*Math.cos(q1))+(Math.cos(q)*dz-Math.sin(q)*dx))/cross;let i=1;while(i<rings.length-1&&rings[i]<radial)i++;const f=(radial-rings[i-1])/(rings[i]-rings[i-1]);return level-(renderDrop(rings[i-1])*(1-f)+renderDrop(rings[i])*f);};
     const examine=(x,z,drop)=>{const dx=x-c.position.x,dz=z-c.position.z,d=Math.hypot(dx,dz);if(d<10000||d>30000||(dx*heading.x+dz*heading.z)/d<Math.cos(Math.PI/4))return;const land=level-drop,water=seaY(x,z),v=new T.Vector3(x,land,z).project(c),w=new T.Vector3(x,water,z).project(c),pixels=Math.abs(v.y-w.y)*360;samples++;if(pixels>worst.pixels720)worst={pixels720:pixels,metres:Math.abs(land-water),distance:d,e:x+t.manifest.village[0],n:t.manifest.village[1]-z};};
     t.group.traverse(o=>{if(!o.isMesh||!o.visible)return;const g=o.geometry,p=g.attributes.position,uv=g.attributes.uv,idx=g.index,hide=o.material.uniforms.hideQuad.value,pa=new T.Vector3(),pb=new T.Vector3(),pc=new T.Vector3();for(let k=0;k<idx.count;k+=3){const ids=[idx.getX(k),idx.getX(k+1),idx.getX(k+2)],u=ids.reduce((s,i)=>s+uv.getX(i),0)/3,v=ids.reduce((s,i)=>s+uv.getY(i),0)/3;if(hide.getComponent((u>=.5?1:0)+(v>=.5?2:0))>.5)continue;const vs=[pa.fromBufferAttribute(p,ids[0]),pb.fromBufferAttribute(p,ids[1]),pc.fromBufferAttribute(p,ids[2])];if(vs.every(a=>a.y<level)||vs.every(a=>a.y>level))continue;const cuts=[];for(let j=0;j<3;j++){const a=vs[j],b=vs[(j+1)%3];if((a.y<level)===(b.y<level))continue;const f=(level-a.y)/(b.y-a.y),drop=renderDrop(Math.hypot(a.x-c.position.x,a.z-c.position.z))*(1-f)+renderDrop(Math.hypot(b.x-c.position.x,b.z-c.position.z))*f;cuts.push([a.x+(b.x-a.x)*f,a.z+(b.z-a.z)*f,drop]);}for(const q of cuts)examine(...q);if(cuts.length===2)examine(...cuts[0].map((v,i)=>(v+cuts[1][i])/2));}});
     return{samples,worst,method:'Actual visible terrain triangle sea-level cuts versus the curved sea polygon mesh, 10-30 km, within 45 degrees bearing; projection at 1280x720 FOV60'};})()`);
    assert.ok(info.shoreGap.samples>0,'actual distant shore samples');assert.ok(info.shoreGap.worst.pixels720<1,'subpixel curved shoreline join');
   }
   const shot=await c.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/${fileName}-${mode}-wide.png`,Buffer.from(shot.result.data,'base64'));writeFileSync(`${out}/${fileName}-${mode}.json`,JSON.stringify({url,info,logs:c.logs},null,2));
   if(name==='tupper-night'&&mode==='after'){
    const lights=await read(`(async()=>{
      window.requestAnimationFrame=()=>0;
      const tallData=await fetch('/areas/pointtupper/tall.json').then(r=>r.json());
      const nearTurbines=tallData.turbines.filter(p=>p.ground!==null);
      const litTurbines=nearTurbines.filter(p=>p.status===undefined||p.status==='operating');
      const mesh=mmm.tall.group.getObjectByName('tall-turbine-beacons')??mmm.tall.group.children.find(m=>m.material?.defines?.BEACON&&m.count>0);
      if(!mesh)return null;
      const phases=mesh.geometry.getAttribute('beaconPhase');
      const rotors=mmm.tall.group.getObjectByName('tall-rotors');
      const motion=rotors?.geometry.getAttribute('motion');
      const m=new (mmm.camera.position.constructor)();
      const mat=new (mmm.camera.matrixWorld.constructor)();
      const litPts=[],c02LitPts=[],mastPts=[];
      for(const other of mmm.tall.group.children){
        if(!other.material?.defines?.BEACON||other===mesh)continue;
        for(let i=0;i<other.count;i++){
          other.getMatrixAt(i,mat);m.setFromMatrixPosition(mat);
          const ndc=m.clone().project(mmm.camera);
          if(ndc.z>=-1&&ndc.z<=1&&Math.abs(ndc.x)<1&&Math.abs(ndc.y)<1)mastPts.push({x:ndc.x,y:ndc.y});
        }
      }
      for(let i=0;i<mesh.count;i++){
        mesh.getMatrixAt(i,mat);m.setFromMatrixPosition(mat);
        const ndc=m.clone().project(mmm.camera);
        if(ndc.z>=-1&&ndc.z<=1&&Math.abs(ndc.x)<.98&&Math.abs(ndc.y)<.98){
          const nearMast=mastPts.some(mp=>Math.hypot((mp.x-ndc.x)*mmm.renderer.domElement.width*.5,(mp.y-ndc.y)*mmm.renderer.domElement.height*.5)<20);
          const pt={x:ndc.x,y:ndc.y,phase:phases.getX(i),farm:litTurbines[i]?.farm??null,id:litTurbines[i]?.id??null,nearMast};
          litPts.push(pt);
          if(pt.farm==='c02'&&!nearMast)c02LitPts.push(pt);
        }
      }
      let c02Total=0,c02Operating=0,c02Spinning=0;
      if(rotors&&motion){
        for(let i=0;i<Math.min(rotors.count,nearTurbines.length);i++){
          const p=nearTurbines[i];
          if(p.farm!=='c02')continue;
          c02Total++;
          if(p.status==='operating'||p.status===undefined)c02Operating++;
          if(motion.getY(i)>0)c02Spinning++;
        }
      }
      const otherGroup=litPts.find(p=>p.farm!=='c02'&&!p.nearMast);
      return {count:mesh.count,otherPhase:otherGroup?.phase??null,litPts,c02LitPts,c02Total,c02Operating,c02Spinning};
    })()`);
    assert.ok(lights&&lights.litPts.length>0,'visible operating night turbine beacons');await sleep(150);
    const farmPhase=s=>{let h=2166136261;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return (h>>>0)/4294967296;};
    const c02Phase=farmPhase('c02');
    const c02OnTime=(1-c02Phase)*2+.05;
    const c02OffTime=(1-c02Phase)*2+.8;
    assert.equal(lights.c02Total,24,'expected all 24 placed c02 turbines in pointtupper (including c02-08)');
    assert.equal(lights.c02Operating,24,'every placed c02 turbine must have status operating');
    assert.equal(lights.c02Spinning,24,'every placed c02 turbine must have positive rotor speed');
    assert.ok(lights.c02LitPts.length>=10,'expected >= 10 visible operating c02 beacons clear of masts (got '+lights.c02LitPts.length+')');
    assert.ok(lights.c02LitPts.every(p=>Math.abs(p.phase-c02Phase)<1e-6),'all c02 beacons share one synchronised farm phase');
    const otherLit=lights.otherPhase===null?[]:lights.litPts.filter(p=>p.farm!=='c02'&&!p.nearMast&&Math.abs(p.phase-lights.otherPhase)<1e-6);
    const schedule=[['c02-on',c02OnTime],['c02-off',c02OffTime]];
    if(otherLit.length>=4){
     const otherBase=(1-lights.otherPhase)*2;
     schedule.push(['other-on',otherBase+.05],['other-off',otherBase+.8]);
    }
    const frames=[];
    for(const [label,time]of schedule){
     const probe=await read(`(()=>{
      mmm.tall.time.value=${time};mmm.farTurbines.time.value=${time};
      const r=mmm.renderer;r.setRenderTarget(null);r.render(mmm.scene,mmm.camera);
      const g=r.getContext(),w=r.domElement.width,h=r.domElement.height,p=new Uint8Array(w*h*4);
      g.readPixels(0,0,w,h,g.RGBA,g.UNSIGNED_BYTE,p);
      const isRed=k=>p[k]>150&&p[k+1]<80&&p[k+2]<80;
      const boxRed=(pt,rad)=>{
       const cx=Math.round((pt.x*.5+.5)*w),cy=Math.round((pt.y*.5+.5)*h);let n=0;
       for(let dy=-rad;dy<=rad;dy++)for(let dx=-rad;dx<=rad;dx++){
        const x=cx+dx,y=cy+dy;if(x<0||x>=w||y<0||y>=h)continue;
        if(isRed((y*w+x)*4))n++;
       }
       return n;
      };
      let red=0;for(let i=0;i<p.length;i+=4)if(isRed(i))red++;
      const c02Pts=${JSON.stringify(lights.c02LitPts)};
      const otherPts=${JSON.stringify(otherLit)};
      const c02Hits=c02Pts.filter(pt=>boxRed(pt,8)>0).length;
      const otherHits=otherPts.filter(pt=>boxRed(pt,8)>0).length;
      return {red,c02Checked:c02Pts.length,c02Hits,otherChecked:otherPts.length,otherHits};
     })()`);
     if(label==='c02-on'||label==='c02-off'){const image=await c.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/tupper-night-beacons-${label==='c02-on'?'on':'off'}.png`,Buffer.from(image.result.data,'base64'));}
     frames.push({label,time,...probe});
    }
    writeFileSync(out+'/aviation-lights.json',JSON.stringify(frames,null,2));
    assert.equal(frames[0].c02Hits,frames[0].c02Checked,'every visible operating c02 turbine beacon registers red on flash-ON');
    assert.equal(frames[1].c02Hits,0,'projected operating c02 turbine beacons are dark on flash-OFF');
    if(otherLit.length>=4){
     assert.equal(frames[2].otherHits,frames[2].otherChecked,'every expected non-c02 operating turbine beacon registers on flash-ON');
     assert.equal(frames[3].otherHits,0,'projected non-c02 operating turbine beacons are dark on flash-OFF');
    }
   }
   if(name==='tupper-south'&&mode==='after'){
    const a=await read('({time:mmm.tall.time.value,frame:mmm.renderer.info.render.frame})');await sleep(1000);const b=await read('({time:mmm.tall.time.value,frame:mmm.renderer.info.render.frame})');assert.ok(b.time-a.time>.5&&b.frame>a.frame,'real rotor animation frames');
    writeFileSync(out+'/rotor-motion.json',JSON.stringify({a,b},null,2));
   }
   if(!name.startsWith('shore-')){
    await read('window.requestAnimationFrame=()=>0');await sleep(100);
    await read(`(()=>{const v=mmm.vehicle;v.place(${e}-mmm.terrain.manifest.village[0],mmm.terrain.manifest.village[1]-${n},${yaw}*Math.PI/180);mmm.driveVehicle(0,{throttle:0,steer:0,handbrake:true});mmm.chase(0);mmm.camera.updateMatrixWorld();mmm.renderer.setRenderTarget(null);mmm.renderer.render(mmm.scene,mmm.camera);})()`);
    await sleep(150);const chase=await c.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/${fileName}-${mode}-chase.png`,Buffer.from(chase.result.data,'base64'));
   }
   console.log('PASS',name,mode,JSON.stringify(info));
  }
 }
}catch(e){console.error(e.stack);process.exitCode=1;}
finally{c?.close();if(tab)await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(()=>{});}
