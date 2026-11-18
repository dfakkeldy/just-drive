// The browser driver must still use the controls when its projection reaches the end before the body does.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {followPath as currentDriver} from './fleet-quarry-path.mjs';
const followPath=process.env.FLEET_PATH_BASELINE
 ?(await import('data:text/javascript,'+encodeURIComponent(execFileSync('git',['show',process.env.FLEET_PATH_BASELINE+':tools/fleet-quarry-path.mjs'],{encoding:'utf8'})))).followPath
 :currentDriver;
function verify(driver){
 const path=[{x:0,z:0},{x:0,z:-10}],spec={mass:900,wheelbase:2.2,maxSteer:.6};
 const outside={x:3,z:-10,heading:-Math.PI/2,speed:0,spec};
 const input=driver(outside,path,{at:10},4);
 assert.equal(input.arrived,false,'the existing two-metre arrival radius stays unchanged');
 assert.ok(input.throttle>0,'projection at the end must not command zero speed while the body is outside the arrival radius');
 assert.equal(input.handbrake,false);
 const behind={x:34,z:-10,heading:Math.PI/2,speed:0,spec};
 assert.ok(driver(behind,path,{at:10},4).throttle<0,'an overshot endpoint behind the body requires reverse input');
 assert.equal(driver({...outside,x:1.99},path,{at:10},4).arrived,true,'a stopped body inside the existing radius arrives');
 assert.equal(driver({...outside,x:2.01},path,{at:10},4).arrived,false,'a stopped body outside the existing radius cannot arrive');
 assert.deepEqual(outside,{x:3,z:-10,heading:-Math.PI/2,speed:0,spec},'the driver issues inputs and never places the body');
}
verify(followPath);
for(const[name,from,to]of[
 ['arrived outside radius','handbrake:arrived,arrived,at','handbrake:arrived,arrived:true,at'],
 ['never arrives','handbrake:arrived,arrived,at','handbrake:arrived,arrived:false,at'],
 ['reverse endpoint input','driveSign*Math.min','Math.min'],
 ['zero speed at projection','Math.max(0,brakingLeft)','Math.max(0,left)'],
 ['larger arrival radius','endDistance<2&&','endDistance<2.1&&'],
 ['premature handbrake','handbrake:arrived,arrived','handbrake:true,arrived'],
 ['body placement',' return{throttle:arrived?',' v.x+=.01;return{throttle:arrived?'],
]){
 const source=followPath.toString(),mutated=source.replace(from,to);assert.notEqual(mutated,source,'mutation anchor '+name);
 assert.throws(()=>verify(Function('return ('+mutated+')')()),assert.AssertionError,'mutation must fail: '+name);
 console.log('KILLED',name);
}
console.log('PASS endpoint correction uses only inputs; existing arrival radius and all seven mutations hold');
