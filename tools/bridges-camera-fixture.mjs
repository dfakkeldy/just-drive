// Execute the production main chase/park blocks without booting its DOM or renderer.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {transform} from '../web/node_modules/esbuild/lib/main.js';
import ts from '../web/node_modules/typescript/lib/typescript.js';
import {root} from './bridges-fixture.mjs';
const cache=new Map();
export async function cameraFixture(source=readFileSync(root+'web/src/main.ts','utf8')){
 if(cache.has(source))return cache.get(source);
 const ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true),node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='chase');
 if(!node)throw Error('production chase function missing');
 // The camera vectors chase() reuses (camPos, camLook, camAim, ...) are module-level in main.ts: take that declaration as written.
 const vectors=ast.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(ast)==='camPos'));
 if(!vectors)throw Error('production camera vectors missing');
 let parked;
 function visit(n){if(ts.isIfStatement(n)&&n.expression.getText(ast)==='terrain.surfaceAt(vehicle.x, vehicle.z)?.level === undefined')parked=n;ts.forEachChild(n,visit);}
 visit(ast);
 const start=parked?.getStart(ast)??-1,end=source.indexOf('      if ((loaded || lawnDemo?.driving)',start);
 if(start<0||end<0)throw Error('production parked placement block missing');
 const hold=source.slice(start,end)+'\n    }';
 const code=`import * as THREE from ${JSON.stringify(pathToFileURL(root+'web/node_modules/three/build/three.module.js').href)};
 export function makeChase(vehicle,terrain,roads){const camera=new THREE.PerspectiveCamera(),car=vehicle.car,vehicleSpec=vehicle.spec,ride={chase:()=>false},view='chase',started=true,towing=null,fleet=null,drone={active:false},landDrone=()=>{},astra=null,garageEntry={id:'car'};${vectors.getText(ast)}let camHeading=0,camReady=false;${node.getText(ast)}return{camera,chase};}
 export function hold(vehicle,terrain,waitingToDrive,refusal){const input={throttle:0,steer:0,handbrake:true},demo=0,dt=1/120,relief={busy:false};let drove=0;const driveVehicle=(dt,input)=>vehicle.update(dt,input);${hold}}
 `;
 const built=await transform(code,{loader:'ts',format:'esm',target:'es2022'}),mod=await import('data:text/javascript;base64,'+Buffer.from(built.code).toString('base64'));cache.set(source,mod);return mod;
}
