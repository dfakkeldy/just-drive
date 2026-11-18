// A test driver: physical controls only. It follows the reverse of the unloading curve at walking speed.
export function approachControl(v, t, THREE, state = {}, bike = false) {
 const inverse=t.trailer.root.matrixWorld.clone().invert(),p=new THREE.Vector3(v.x,t.y,v.z).applyMatrix4(inverse),h=Math.atan2(Math.sin(v.heading-t.heading),Math.cos(v.heading-t.heading));
 // A bike parked close to the gate first backs into turning room, using the normal reverse control.
 if(bike&&!state.staged){if(p.z<9.3)return{throttle:-1,steer:0,handbrake:false,arrived:false,local:[p.x,p.z,h]};state.staged=true;}
 const alignment=25*Math.PI/180;
 state.stuck=Math.abs(v.speed)<.15&&p.z<7.5&&Math.abs(h)>alignment?(state.stuck??0)+1:0;
 if(state.stuck>20)state.recover=true;
 if(state.recover&&p.z>9&&Math.abs(h)<.4)state.recover=false;
 if(state.recover)return{throttle:-1,steer:Math.abs(h)>.08?Math.max(-1,Math.min(1,h*2)):0,handbrake:false,arrived:false,local:[p.x,p.z,h]};
 if(Math.abs(p.x)<.99&&Math.abs(p.z-6.8)<.99&&Math.abs(h)<alignment)return{throttle:Math.abs(v.speed)>.08?-Math.sign(v.speed):0,steer:0,handbrake:true,arrived:Math.abs(v.speed)<.45};
 if(Math.abs(p.x)<.99&&Math.abs(h)<alignment&&p.z<5.81)return{throttle:-.4,steer:0,handbrake:false,arrived:false,local:[p.x,p.z,h]};
 const side=bike?3.8:-3.8,end=bike?8.7:9.6;
 // Finish the turn behind the marked zone, before a front tyre can meet a gate.
 const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(side,0,end),new THREE.Vector3(0,0,bike?9:6.2),new THREE.Vector3(0,0,4.4)],false,'centripetal');
 let nearest=0,distance=Infinity;for(let i=0;i<=100;i++){const q=curve.getPoint(i/100),d=Math.hypot(q.x-p.x,q.z-p.z);if(d<distance){distance=d;nearest=i/100}}
 const q=curve.getPoint(Math.min(1,nearest+.25)).applyMatrix4(t.trailer.root.matrixWorld),dx=q.x-v.x,dz=q.z-v.z,len=Math.hypot(dx,dz),err=Math.atan2(Math.sin(Math.atan2(dx,-dz)-v.heading),Math.cos(Math.atan2(dx,-dz)-v.heading));
 return{throttle:Math.max(-1,Math.min(.55,(1.5-v.speed)*1.2)),steer:Math.max(-1,Math.min(1,Math.atan2(2*v.spec.wheelbase*Math.sin(err),Math.max(1,len))/(bike?.65:v.spec.maxSteer))),handbrake:false,arrived:false,local:[p.x,p.z,h]};
}
