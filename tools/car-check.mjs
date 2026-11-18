#!/usr/bin/env node
import { cdp, cdpFetch } from './cdp.mjs';
// RUN=car-check.mjs WEB_PORT=5212 CDP_PORT=9412 OUT=... tools/car-shots.sh
// Geometry, render budget and driving contracts in the isolated viewer; no game data is baked.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { lampSideStandouts, lampSurfaceChecks } from './car-lamp-fit.mjs';
const [out, ...urls] = process.argv.slice(2), port = process.env.CDP_PORT ?? '9334';
for (const url of urls) {
  const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const errors = [];
  const { ws, send } = await cdp(tab.webSocketDebuggerUrl, { onEvent: d => {  if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text); } });
  const read = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true });
    assert.ok(!r.result?.exceptionDetails, r.result?.exceptionDetails?.text);
    return r.result?.result?.value;
  };
  try {
    await send('Runtime.enable'); await send('Page.enable'); await send('Page.navigate', { url });
    // Wait for the requested document itself (the tab starts on about:blank), with its own
    // deadline for a cold first load; the viewer then gets its unchanged render budget.
    let loaded = false;
    for (let i = 0; i < 450; i++) {
      if (await read(`location.href === ${JSON.stringify(new URL(url).href)} && document.readyState === 'complete'`)) { loaded = true; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(loaded, 'viewer document loaded: '+errors.join(' | '));
    let ready = false;
    for (let i = 0; i < 100; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      if (await read('document.title === "settled"')) { ready = true; break; }
    }
    if(process.env.CAR_EXPECT_MUTATION)assert.ok((await read('globalThis.__mmmMutationSources??[]')).includes(process.env.CAR_EXPECT_MUTATION),'intended car source mutation loaded');
    assert.ok(ready, 'viewer settled: '+errors.join(' | ')+' '+await read('JSON.stringify({triangles:window.carPreview?.triangles,materials:window.carPreview?.materials})')); assert.deepEqual(errors, [], 'no runtime errors');
    const stats = await read(`(() => {
      const {car,scene,camera,renderer} = carPreview;
      const spin = Object.values(car.wheels).map(w=>w.rotation.x);
      Object.values(car.wheels).forEach(w=>w.rotation.x=0); car.root.updateMatrixWorld(true);
      let bounds, triangles=0, finite=true, normals=true, hatchSamples=0, hatchNormalsOutward=true, flat=0, reversed=0, twisted=0; const reversedIn={}, twistedIn={}; const materials=new Set(), culling=[];
      car.root.traverse(n=>{if(!n.isMesh)return;
        const g=n.geometry; g.computeBoundingBox();
        const b=g.boundingBox.clone().makeEmpty(),p=g.attributes.position,point=b.min.clone(),matrix=n.matrixWorld.clone();
        for(let instance=0;instance<(n.isInstancedMesh?n.count:1);instance++) {
          if(n.isInstancedMesh){n.getMatrixAt(instance,matrix);matrix.premultiply(n.matrixWorld);}
          for(let i=0;i<p.count;i++){point.fromBufferAttribute(p,i).applyMatrix4(matrix);b.expandByPoint(point);}
        }
        bounds ? bounds.union(b) : bounds=b;
        triangles+=(g.index?.count??g.attributes.position.count)/3*(n.isInstancedMesh?n.count:1);
        for(const a of Object.values(g.attributes)) finite &&= [...a.array].every(Number.isFinite);
        const normal=g.attributes.normal;
        for(let i=0;i<normal.count;i++) {const len=Math.hypot(normal.getX(i),normal.getY(i),normal.getZ(i)); if(Math.abs(len-1)>.001) normals=false;}
        // Every triangle has an area, and faces the way its normals say (a mirrored part with unreversed triangles is
        // lit from the wrong side). Instanced parts are judged in their own frame.
        if(!n.isInstancedMesh){
          const ix=g.index, count=ix?ix.count:p.count, at=(k)=>ix?ix.getX(k):k, edges=new Map();
          const V=()=>car.root.position.clone(), A=V(),B=V(),C=V(),F=V(),N=V(),M=V();
          for(let k=0;k<count;k+=3){
            const a=at(k),b2=at(k+1),c=at(k+2);
            A.fromBufferAttribute(p,a);B.fromBufferAttribute(p,b2);C.fromBufferAttribute(p,c);
            F.subVectors(B,A).cross(M.subVectors(C,A));
            if(F.length()<1e-10){flat++;continue;}
            N.fromBufferAttribute(normal,a).add(M.fromBufferAttribute(normal,b2)).add(M.fromBufferAttribute(normal,c));
            if(F.normalize().dot(N.normalize())<-.5){reversed++;reversedIn[n.material.name||'?']=(reversedIn[n.material.name||'?']??0)+1;}
            // Two triangles that share an edge and face the same way run along it in opposite directions. The same
            // direction twice means one of them faces the other way (the walls of a window hole against its faces).
            // This assumes no part is drawn as two coincident sheets with their own back faces (the materials here are
            // double-sided where both sides show, so none is). If such a part is ever added on purpose, exempt it here.
            const key=(v)=>Math.round(v.x*1e4)+','+Math.round(v.y*1e4)+','+Math.round(v.z*1e4), ka=key(A),kb=key(B),kc=key(C);
            for(const e of [ka+'>'+kb,kb+'>'+kc,kc+'>'+ka]){const seen=edges.get(e)??0; if(seen===1){twisted++;twistedIn[n.material.name||'?']=(twistedIn[n.material.name||'?']??0)+1;} edges.set(e,seen+1);}
          }
        }
        if(n.material.name==='Body paint')for(let i=0;i<p.count;i++){
          if(Math.abs(p.getX(i))<.4&&p.getY(i)>.65&&p.getY(i)<1.0&&p.getZ(i)>2.1){hatchSamples++;hatchNormalsOutward &&= normal.getZ(i)>.2;}
        }
        for(const m of Array.isArray(n.material)?n.material:[n.material])materials.add(m);
        culling.push([n,n.frustumCulled]);n.frustumCulled=false;
      });
      const hidden=scene.children.filter(n=>n!==car.root&&!n.isLight).map(n=>[n,n.visible]); hidden.forEach(([n])=>n.visible=false);
      renderer.render(scene,camera); const calls=renderer.info.render.calls;
      hidden.forEach(([n,v])=>n.visible=v);culling.forEach(([n,v])=>n.frustumCulled=v);
      Object.values(car.wheels).forEach((w,i)=>w.rotation.x=spin[i]);
      const brakeBands=car.brakeLights.map(l=>{const p=l.geometry.attributes.position;let upper=0,lower=0,middle=0;
        for(let i=0;i<p.count;i++){const y=p.getY(i);if(y>1.22)upper++;else if(y<.94)lower++;else middle++;}
        return {upper,lower,middle};});
      const pivots=Object.fromEntries(Object.entries(car.wheels).map(([k,w])=>[k,{spin:w.position.toArray(),axle:w.parent.position.toArray(),underBody:car.body.children.includes(w.parent)}]));
      const dirt=[-1,0,.5,1,2,NaN].map(v=>{car.setDirt(v);const a=[...materials].find(m=>m.polygonOffset);return [a.opacity,a.visible];}); car.setDirt(Number(new URLSearchParams(location.search).get('dirt')??.75));
      const under=(o)=>{while(o&&o!==car.root)o=o.parent;return o===car.root;};
      const contracts={brakesDistinct:new Set(car.brakeLights).size===car.brakeLights.length, brakesAttached:car.brakeLights.every(l=>l.isMesh&&l.visible&&under(l)&&l.geometry.attributes.position.count>0),
        steerIsWheelParent:car.steer.fl===car.wheels.fl.parent&&car.steer.fr===car.wheels.fr.parent&&car.steer.fl!==car.steer.fr, wheelsDistinct:new Set(Object.values(car.wheels)).size===4};
      return {flat,reversed,reversedIn,twisted,twistedIn,contracts,triangles,materials:materials.size,drawCalls:calls,dimensions:bounds.max.clone().sub(bounds.min).toArray(),min:bounds.min.toArray(),max:bounds.max.toArray(),finite,normals,hatchSamples,hatchNormalsOutward,brakeBands,pivots,eye:car.driverEye.position.toArray(),brakes:car.brakeLights.length,beaconAttached:car.beacon.parent===car.body,signAttached:car.signLight.parent===car.body,dirt};
    })()`);
    stats.lampStandouts = await read(`(${lampSideStandouts.toString()})(carPreview.car)`);
    stats.lampSurfaces = await read(`(${lampSurfaceChecks.toString()})(carPreview.car)`);
    console.log(new URL(url).searchParams.get('view'), JSON.stringify(stats));
    assert.ok(stats.lampStandouts.every(l=>l.samples>=12&&l.misses===0&&l.maxStandout<=.006),
      'rear lamp side standout stays within 0.6 cm: '+JSON.stringify(stats.lampStandouts));
    assert.ok(stats.lampSurfaces.sides.every(s=>s.samples>1000&&s.paintHits===0&&s.rubberHits===0),
      'body skin over rear lamp lens: '+JSON.stringify(stats.lampSurfaces.sides));
    assert.ok(stats.lampSurfaces.dividers.length===4&&stats.lampSurfaces.dividers.every(d=>d.samples>=16&&d.hits===d.samples&&d.maxOffset<=.003),
      'rear lamp dividers are present and seated within 3 mm: '+JSON.stringify(stats.lampSurfaces.dividers));
    assert.ok(stats.lampSurfaces.sockets.length===2&&stats.lampSurfaces.sockets.every(s=>s.edges>=60&&s.samples>=800&&s.misses===0&&s.maxRecess<=.04),
      'rear lamp socket closed within 40 mm of the edge: '+JSON.stringify(stats.lampSurfaces.sockets));
    // 40 draw calls: 38 for the merged car, and 2 for the driver's window, which is its own mesh so that it can go down
    // when its regulator breaks (double-sided glass is drawn in two passes).
    assert.ok(stats.triangles < 40000 && stats.materials <= 11 && stats.drawCalls <= 40, 'render budget');
    if (process.env.CAR_PHASE !== 'baseline') {
      assert.equal(stats.flat, 0, 'no triangle without area');
      assert.deepEqual(stats.reversedIn, {}, 'every triangle faces the way its normals say');
      assert.deepEqual(stats.twistedIn, {}, 'triangles that share an edge face the same way (no wall of a hole faces into the solid)');
      assert.deepEqual(stats.contracts, { brakesDistinct: true, brakesAttached: true, steerIsWheelParent: true, wheelsDistinct: true }, 'brake lamps are separate meshes on the car, and each front wheel is steered by its own parent');
    }
    assert.ok(stats.finite && (process.env.CAR_PHASE === 'baseline' || stats.normals) && stats.beaconAttached && stats.signAttached && stats.brakes >= 2);
    if(process.env.CAR_PHASE!=='baseline')assert.ok(stats.hatchSamples>10&&stats.hatchNormalsOutward,'rear skin normals face out for sun shadows');
    assert.ok(stats.brakeBands.every(b=>b.upper>0&&b.lower>0&&b.middle===0),'brake lens has red upper and lower chambers, with a clear gap');
    assert.deepEqual(stats.eye, [.43,1.36,-.08]);
    const original = [2.287986418,1.955000015,4.605000001];
    stats.dimensions.forEach((n,i) => assert.ok(Math.abs(n/original[i]-1) <= .03, 'outer dimensions within three percent'));
    assert.ok(Math.abs(stats.min[1]) < .00001, 'tyres still meet the ground');
    for (const [k,p] of Object.entries(stats.pivots)) {
      assert.deepEqual(p.spin,[0,.35,0]); assert.equal(p.underBody,false);
      assert.deepEqual(p.axle,[k.endsWith('l')?-.785:.785,0,k.startsWith('f')?-1.31:1.31]);
    }
    assert.deepEqual(stats.dirt, [[0,false],[0,false],[.5,true],[1,true],[1,true],[0,false]]);
    const phase=process.env.CAR_PHASE??'after';
    if(url===urls[0])writeFileSync(`${out}/stats-${phase}.json`,JSON.stringify(stats,null,2)+'\n');
    const shot=await send('Page.captureScreenshot',{format:'png'});
    writeFileSync(`${out}/${phase}-${new URL(url).searchParams.get('view')}.png`,Buffer.from(shot.result.data,'base64'));
  } finally {await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`);ws.close();}
}
