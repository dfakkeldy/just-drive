import assert from 'node:assert/strict';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {Props, splitRoadLines} from '../web/src/props.ts';
import {readFileSync} from 'node:fs';
const terrain={low:false,exag:2,seaLevel:10,heightAt:()=>30,surfaceAt:()=>({level:8})};
const pole=(x,y,n=0,road=1)=>({x,y,n,road,heading:0,transformer:false,light:false});
const drop={building:1,road:1,n:0,x:24,y:16,height:4,ground:20,groundX:24,groundY:20};
const camera=new THREE.PerspectiveCamera();camera.position.set(0,3,0);camera.updateMatrixWorld();
const make=(poles=[pole(0,0),pole(0,60,1)],drops=[drop],excludes)=>new Props({crs:'EPSG:2961',mailboxes:[],communityBoxes:[],poles,serviceDrops:drops},[0,0],terrain,excludes);
const lines=p=>{const result=[];p.group.traverse(o=>{if(o.isLineSegments)result.push(o);});return result;};
const tick=p=>{p.nextUpdate=0;p.update(camera,0);};
const props=make();tick(props);
assert.equal(lines(props).length,1,'all span wires and drops in one draw per cell');
let line=lines(props)[0],vertices=Array.from(line.geometry.attributes.position.array);
assert.equal(vertices.length,300,'four trunk wires plus one drop, ten line segments each');
const end=vertices.slice(-3);assert.deepEqual(end,[24,34,-16],'surveyed building height uses its datum and exaggeration');
const start=vertices.slice(-60,-57);assert.ok(Math.abs(start[1]-36.71)<1e-5,'drop starts on the pole neutral attachment');
const middle=vertices.slice(-30,-27);assert.ok(middle[1]<(start[1]+end[1])/2-.2,'the drop sags below the chord');
tick(props);assert.equal(lines(props)[0],line,'unchanged terrain does not rebuild wire geometry');
let disposed=0;line.geometry.addEventListener('dispose',()=>disposed++);
terrain.low=true;tick(props);assert.equal(disposed,1,'replaced batch is disposed');
assert.equal(lines(props)[0].geometry.attributes.position.count,80,'LOW hides drops and keeps trunk wires');
terrain.low=false;tick(props);assert.equal(lines(props)[0].geometry.attributes.position.count,100,'desktop restores drops without a terrain change');
// Quiet-site pole filtering cannot shift a numeric pole reference onto a neighbour.
const filtered=make([pole(0,0),pole(20,0,1)],[drop],(x)=>x===0);tick(filtered);
assert.equal(lines(filtered).length,0,'removed pole removes its drop');
const boundary=make([pole(255,0),pole(257,0,1)],[{...drop,x:250},{...drop,building:2,n:1,x:270}]);tick(boundary);
assert.equal(lines(boundary).length,2,'two cells still have only one merged wire draw each');
terrain.surfaceAt=()=>({level:5});const pending=make();tick(pending);assert.equal(lines(pending).length,0,'no wire on coarse/unavailable ground');
terrain.surfaceAt=()=>({level:8});tick(pending);assert.equal(lines(pending).length,1,'wire appears with local ground');
// Church uses its model-origin terrain, rather than the removed survey envelope's datum.
const church=make([pole(0,0)],[{...drop,ground:null,groundX:10,groundY:10}]);tick(church);
assert.equal(Array.from(lines(church)[0].geometry.attributes.position.array).at(-2),34);
// A split that kept the old road's pole numbers (18 Nov pavement limit) stays one wired line over the cut;
// split pieces whose poles were placed afresh (numbers restart) and plain neighbouring roads never join.
const split=(poles,roads)=>{const p=new Props({crs:'EPSG:2961',mailboxes:[],communityBoxes:[],poles,serviceDrops:[]},[0,0],terrain,undefined,undefined,splitRoadLines({roads}));tick(p);return lines(p).reduce((sum,l)=>sum+l.geometry.attributes.position.count,0);};
const pieces=[{id:7,correction:'18nov:x'},{id:9,correction:'18nov:x'}];
assert.equal(split([pole(0,0,0,7),pole(0,60,1,9)],pieces),80,'n-preserving split pieces keep the span over the cut');
assert.equal(split([pole(0,0,0,7),pole(0,60,1,9)],[{id:7},{id:9}]),0,'unsplit neighbouring roads stay apart');
assert.equal(split([pole(0,0,0,7),pole(0,60,0,9)],pieces),0,'pieces numbered afresh stay apart');
assert.deepEqual([...splitRoadLines({roads:[{id:1,correction:'a'},{id:2},{id:'3',correction:'b'}]})],[[1,'a']]);
const legacy=new Props({crs:'EPSG:2961',mailboxes:[],communityBoxes:[],poles:[]},[0,0],terrain);tick(legacy);
assert.equal(lines(legacy).length,0,'before-install packs remain readable');
if(process.argv.includes('--delta')){
 const root=process.argv[process.argv.indexOf('--delta')+1];
 for(const relative of ['terrain','areas/cansocauseway','areas/judique','areas/pointtupper','areas/porthood','areas/westbay']){
  const data=JSON.parse(readFileSync(`${root}/${relative}/props.json`));
  const land=new Props(data,[0,0],terrain);
  assert.equal(land.data.serviceDrops.length,data.serviceDrops.length);
  if(relative==='areas/judique')assert.ok(data.serviceDrops.some(d=>d.building===-1),'Judique church has a real drop');
 }
}
console.log('PASS merged-cell wires, sag/endpoints, roof datum, stable updates/disposal, LOW/desktop, quiet-site references, cell boundary and legacy data');
