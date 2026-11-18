// CPU contracts shared by the Node suite and the parent-run WebGL check.
export function ghostContracts(THREE, Ghosts, FLAG) {
        const checks = [], ok = (v, label) => { if (!v) throw new Error(label); checks.push(label); };
        const peer = (id, x=0, z=0) => ({id,name:'Loose Gravel '+id,hue:id%8,x,z,heading:0,speed:5,steer:0,air:0,flags:0,alpha:1});
        const cam = new THREE.PerspectiveCamera(48,1,.3,2000); cam.position.set(0,3,10); cam.lookAt(0,1,0); cam.updateMatrixWorld();
        let missing = false;
        const g = new Ghosts({low:false,cap:2,ground:(x,z)=>missing||x===999?null:0});
        const a = peer(1,0,0), b = peer(2,2,0), c = peer(3,50,0), list=[a,b,c];
        g.update(1/60,list,cam); const body=g.group.children[0], labels=g.group.children[1];
        const ids=()=>g.slots.filter(s=>s.used).map(s=>s.id).sort();
        ok(g.drawn===2 && ids().join() === '1,2', 'nearest peers fill cap');
        a.alpha=0; b.x=999; g.update(1/60,list,cam);
        ok(g.drawn===1 && ids().join()==='3', 'alpha zero and null centre are not drawn');
        missing=true; g.update(1/60,list,cam); ok(g.drawn===0 && body.count===0 && labels.count===0,'all missing ground hides all cars');
        missing=false; a.alpha=1; a.x=0; a.z=0; b.x=10; b.z=0; c.x=10.01; c.z=0;
        g.update(1/60,list,cam); c.x=9.99; g.update(1/60,list,cam);
        ok(ids().join()==='1,2','hysteresis keeps near ties stable');
        c.x=5; g.update(1/60,list,cam); ok(ids().join()==='1,3','clearly nearer entrant replaces far peer');
        a.alpha=.5; a.flags=FLAG.brake; a.air=2; g.update(1/60,[a],cam);
        const matrix=new THREE.Matrix4(); body.getMatrixAt(0,matrix);
        ok(Math.abs(matrix.elements[13]-2)<1e-6,'air adds to wheel ground height');
        ok(body.geometry.attributes.fade.getX(0)===.5 && body.geometry.attributes.brake.getX(0)===1,'fade and brake reach the GPU');
        ok(!body.material.transparent && body.material.depthWrite,'fade keeps opaque depth writes');
        a.name='Rain Road 22'; g.update(1/60,[a],cam); ok(g.slots.some(s=>s.name===a.name),'changed call sign updates its atlas row');
        a.z=-200; g.update(1/60,[a],cam); ok(labels.count===0 && g.drawn===1,'labels hidden beyond 150 metres');
        a.z=-100; g.update(1/60,[a],cam); ok(labels.count===1,'labels drawn around 120 metres');
        a.x=0; a.z=5; g.update(1/60,[a],cam); labels.getMatrixAt(0,matrix);
        ok(matrix.elements[13]-Math.hypot(matrix.elements[4],matrix.elements[5],matrix.elements[6])/2>3.65,'near label bottom clears roof, including air');
        const stableBytes=body.instanceMatrix.array.byteLength;
        for(let i=0;i<1000;i++) g.update(1/60,list,cam);
        ok(body.instanceMatrix.array.byteLength===stableBytes,'instance storage stays fixed');
        g.dispose(); ok(g.group.children.length===0,'dispose detaches both draws');
        const empty=new Ghosts({low:true,cap:0,ground:()=>0});empty.update(1/60,list,cam);ok(empty.drawn===0,'zero cap draws nothing');empty.dispose();
        // A plane has exact wheel averages and known pitch and roll at every heading.
        const slope=new Ghosts({low:false,cap:1,ground:(x,z)=>.2*x+.1*z}); a.x=3; a.z=-7; a.air=.8; a.heading=.7;
        slope.update(1/60,[a],cam); const m=new THREE.Matrix4(); slope.group.children[0].getMatrixAt(0,m);
        const expected=new THREE.Object3D(); expected.rotation.order='YXZ';
        expected.position.set(a.x,.2*a.x+.1*a.z+a.air,a.z);
        expected.rotation.set(Math.atan2(.2*Math.sin(.7)-.1*Math.cos(.7),1),-.7,Math.atan2(.2*Math.cos(.7)+.1*Math.sin(.7),1));expected.updateMatrix();
        ok(m.elements.every((v,i)=>Math.abs(v-expected.matrix.elements[i])<1e-6),'wheel pitch, roll and heading agree with vehicle convention');
        slope.dispose();
        return checks;

}

/** Geometry.boundingBox includes all morph targets. Inspect the selected shape's attribute instead. */
export function ghostGeometryStats(THREE, geometry) {
  const stats=(p,n)=>{
    const a=new THREE.Vector3(),b=a.clone(),c=a.clone(),cross=a.clone(),normal=a.clone();let flat=0,backwards=0;
    for(let i=0;i<p.count;i+=3){a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,i+1);c.fromBufferAttribute(p,i+2);
      cross.subVectors(b,a).cross(c.sub(a));if(cross.length()<1e-9)flat++;
      normal.fromBufferAttribute(n,i);if(cross.dot(normal)<-1e-9)backwards++;}
    const box=new THREE.Box3().setFromBufferAttribute(p);
    return {flat,backwards,size:box.getSize(a).toArray(),min:box.min.toArray(),max:box.max.toArray()};
  };
  return {base:stats(geometry.attributes.position,geometry.attributes.normal),
    models:geometry.morphAttributes.position.map((p,i)=>stats(p,geometry.morphAttributes.normal[i]))};
}
