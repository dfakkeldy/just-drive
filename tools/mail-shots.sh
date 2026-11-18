#!/usr/bin/env bash
# Serve the game and take settled screenshots with a headless browser (tools/browser.sh picks it).
# Output: data/work/shots/<name>.png
# Usage: tools/mail-shots.sh [width height] [extra query for every view, e.g. "exag=1"]
#   VIEWS="name|query ..." picks the views; the default is the four gameplay views.
#   Example: VIEWS="drive-village|demo=6 seat|demo=6&view=seat" tools/mail-shots.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tools/browser.sh"
mem_report
W="${1:-1600}"; H="${2:-1200}"; Q="${3:-}"
OUT="$ROOT/data/work/shots"; mkdir -p "$OUT"
if [[ "${1:-}" == "--check" ]]; then
  cd "$ROOT/web"
  node --input-type=module <<'JS'
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
const dir = await mkdtemp(`${tmpdir()}/mmm-mail-check-`);
try {
  await build({ stdin: { contents: `
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Props } from './src/props';
import { CAR_SPEC } from './src/vehicle-spec';
import { Mail } from './src/mail';
const terrain = { heightAt: () => 0, surfaceAt: () => ({ level: 8, roadDist: 20, halfWidth: 3 }) };
const box = (x, group = null) => ({ x, y: 0, heading: 270, style: 0, tilt: 0, group, parcelBox: false });
const data = { crs: 'EPSG:2961', mailboxes: [box(0), box(10, 1), box(10.5, 1)], communityBoxes: [{ x: 30, y: 0, heading: 0, modules: 2 }], poles: [] };
const p = new Props(data, [0,0], terrain);
assert.equal(p.mailHit(-2,1.2,0,2,1.2,0,false), 0, 'swept delivery cannot tunnel through a mailbox');
assert.equal(p.mailHit(0,3,0,0,2,0,false), -1, 'mail above a box misses');
assert.equal(p.mailHit(0,0,0,.9,0,0,true), -1, 'a post-side landing is a miss');
assert.equal(p.serve(0),1); assert.equal(p.serve(0),0, 'served customers count once');
assert.equal(p.serve(3),30, 'two cabinets serve thirty customers');
assert.equal(p.totalCustomers,33);
assert.equal(p.hitCar(0,0,0,0,-1,0,0,CAR_SPEC),1, 'slow bump leaves a lean without knocking down');
assert.equal(p.downCount,0);
assert.ok(p.hitCar(0,0,0,0,-8,0,0,CAR_SPEC)<1); assert.equal(p.downCount,1);
assert.equal(p.serve(0),0, 'fallen boxes cannot receive');
assert.equal(p.knockMailbox(1,5,0),2, 'shared frame falls together');
assert.equal(p.downCount,3);
const camera = new THREE.PerspectiveCamera(); camera.position.set(0,4,8); camera.updateMatrixWorld();
p.update(camera,1); p.update(camera,1);
assert.ok(p.group.children.length>0, 'real instance cells built');
const boxes = p.group.children[0].children.find((m) => m.name === 'box-0');
const fallenMatrix = new THREE.Matrix4(); boxes.getMatrixAt(0,fallenMatrix);
assert.ok(Math.abs(fallenMatrix.elements[5])<.03, 'box instance lies on its side');
assert.equal(p.nearestMailbox(.2,.2,2).index,0, 'nearest mailbox keeps the stable ID after falling');
const car = { driverEye: new THREE.Object3D() }; car.driverEye.position.set(.43,1.36,-.08); car.driverEye.updateMatrixWorld();
const v = { x:0,z:0,y:0,heading:0,vx:0,vz:0,speed:0,car,spec:CAR_SPEC };
const mail = new Mail(terrain,null,[],[0,0],true);
mail.update(.01,v,true);
assert.equal(mail.thrown,1);
const mesh = mail.group.children[0]; const matrix = new THREE.Matrix4(); mesh.getMatrixAt(0,matrix);
assert.ok(matrix.elements[12]>.8, 'mail exits the right window');
for(let i=0;i<240;i++) mail.update(1/120,v,true);
assert.ok(mail.thrown>=8 && mail.thrown<=9, 'four throws per second');
for(let i=0;i<600;i++) mail.update(.1,v,true);
assert.equal(mail.capacity,120);
assert.equal(mail.activeCount,120, 'oldest litter reused at the phone cap');
assert.ok(mail.lawn+mail.ditch>0, 'landings count misses');
const deliveryProps = new Props({ ...data, mailboxes:[box(3)], communityBoxes:[] },[0,0],terrain);
const delivery = new Mail(terrain,deliveryProps,[],[0,0],false);
delivery.service={condition:()=> 'ready',deliver:()=>true,ground(){}};
delivery.update(.01,v,true);
for(let i=0;i<180;i++) delivery.update(1/120,v,false);
assert.equal(delivery.delivered,1, 'a real thrown bundle delivers');
assert.equal(delivery.customers,1);
delivery.thrown=8;v.x=-.8;v.z=.15;car.driverEye.position.set(v.x+.43,1.36,v.z-.08);car.driverEye.updateMatrixWorld();
delivery.update(1/120,v,true);for(let i=0;i<240;i++)delivery.update(1/120,v,false);
assert.equal(delivery.down,1, 'a close large parcel at the opening knocks the box down');
const count = delivery.delivered;
for(let i=0;i<180;i++) delivery.update(1/120,v,true);
assert.equal(delivery.delivered,count, 'fallen mailbox rejects subsequent throws');
const siteProps = new Props({ ...data, mailboxes:[], communityBoxes:[{x:6,y:0,heading:0,modules:2}] },[0,0],terrain);
const bulk = new Mail(terrain,siteProps,[],[0,0],true);
for(let i=0;i<300;i++) bulk.update(1/120,v,true);
assert.ok(bulk.delivered>0); assert.equal(bulk.customers,30);
console.log('Mail checks passed: swept hits, height, serving, shared knockdown, slow bump, right window, cadence, litter cap.');
`, resolveDir: process.cwd(), loader: 'ts' }, bundle:true, platform:'node', format:'esm', outfile:`${dir}/check.mjs` });
  await import(pathToFileURL(`${dir}/check.mjs`).href);
} finally { await rm(dir,{recursive:true,force:true}); }
JS
  exit
fi
# Before any cd: browser_ports may start this script again by its (relative) path.
browser_ports "$@"
cd "$ROOT/web"
browser_typecheck
# The dev server reads the baked tiles through the public/terrain link, so nothing is copied.
# A profile of its own, and a polite close through the debugging port, so no other Chromium window is touched.
start_check "$W" "$H" dev
URLS=()
for v in ${VIEWS:-mail-harbour|demo=10&road=Mabou%20Harbour%20Road&f=0.35&throw=1 mail-seat|demo=10&road=Mabou%20Harbour%20Road&f=0.35&throw=1&view=seat mail-knock|demo=12&road=Rankinville%20Road&f=0.5&knock=1 mail-village|demo=8&throw=1}; do
  URLS+=("http://127.0.0.1:$WEB/?name=${v%%|*}&${v#*|}&hud=${HUD:-1}${Q:+&$Q}")
done
CDP_PORT="$CDP" run_check node "$ROOT/tools/${RUN:-shot.mjs}" "$OUT" "${URLS[@]}"

# Optional real input checks and close views, using this same Chromium/profile.
if [[ "${MAIL_INTERACTION:-0}" == 1 ]]; then
run_check node --input-type=module - "$OUT" <<'JS'
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const out = process.argv[2];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve,ms));
const { cdp, cdpFetch } = await import(`${process.env.MMM_CHECK_ROOT}/tools/cdp.mjs`);
const tab = await (await cdpFetch(`http://127.0.0.1:${process.env.CDP_PORT}/json/new?about:blank`,{method:'PUT'})).json();
const errors=[];
const { ws, send } = await cdp(tab.webSocketDebuggerUrl, { onEvent: d => {
  if(d.method==='Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.text);
} });
const evaluate=async (expression) => (await send('Runtime.evaluate',{expression,returnByValue:true})).result?.result?.value;
const shot=async (name) => { const r=await send('Page.captureScreenshot',{format:'png'}); writeFileSync(`${out}/${name}.png`,Buffer.from(r.result.data,'base64')); console.log(`${out}/${name}.png`,await evaluate('document.getElementById("mailScore").textContent')); };
const key=async (code,down=true) => send('Input.dispatchKeyEvent',{type:down?'keyDown':'keyUp',key:code.replace('Key','').toLowerCase(),code});
const load=async (query) => { await send('Page.navigate',{url:`http://127.0.0.1:${process.env.WEB_PORT}/?${query}`}); for(let i=0;i<80;i++){ await sleep(500); if(await evaluate('document.title')==='settled') { await sleep(2000); if(await evaluate('document.title')==='settled') return; } } throw new Error('Game did not settle'); };
const hold=async (code,ms) => { await key(code); await sleep(ms); await key(code,false); };
const drag=async (x,y,dx,dy) => { await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1}); await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:x+dx,y:y+dy,button:'left',buttons:1}); await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:x+dx,y:y+dy,button:'left',clickCount:1}); await sleep(100); };
try {
  await send('Runtime.enable'); await send('Page.enable');
  // On the right side of the shared frame at rural mailbox indices 262/263.
  await load('at=621510.535,5104589.411,273.3');
  await hold('KeyM',1200); await sleep(250);
  const served=await evaluate('document.getElementById("mailScore").textContent');
  assert.match(served,/Delivered [1-9]/,'M delivers to the real roadside frame');
  await shot('mail-input-delivery');
  await hold('KeyE',1600); await sleep(800);
  assert.match(await evaluate('document.getElementById("mailScore").textContent'),/Boxes down 2/,'large box fells the shared frame');
  // Lift the camera drone off the roof to show the fallen frame and nearby litter.
  await hold('KeyF',30); await sleep(1500); await drag(800,180,-473,280); await hold('Space',900); await hold('KeyD',300); await sleep(1500);
  await shot('mail-input-fallen-frame');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  await load('q=low');
  const bounds=await evaluate('(()=>{const r=document.getElementById("mailButton").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,bottom:r.bottom,h:innerHeight}})()');
  assert.ok(bounds.width>=64 && bounds.bottom<=bounds.h*.62+1,'phone button clears the brake zone');
  await evaluate('window.mailInputQA={canvas:[],button:[]};for(const [id,key] of [["c","canvas"],["mailButton","button"]])document.getElementById(id).addEventListener("pointerdown",e=>window.mailInputQA[key].push(e.pointerId))');
  // Keep a steering finger and a pedal finger while the third finger holds MAIL.
  const fingers=[{id:1,x:60,y:600},{id:2,x:350,y:240}];
  await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:fingers});
  await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[...fingers,{id:3,x:bounds.x,y:bounds.y}]});
  await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:80,y:600},fingers[1],{id:3,x:bounds.x,y:bounds.y}]});
  await sleep(1100);
  const events=await evaluate('window.mailInputQA');
  assert.equal(events.canvas.length,2); assert.equal(events.button.length,1);
  await shot('mail-phone-three-fingers');
  await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await sleep(2500);
  assert.match(await evaluate('document.getElementById("mailScore").textContent'),/(Lawn|Ditch) [1-9]/,'phone button produces physical mail and counted landings');
  await shot('mail-phone-litter');
  assert.deepEqual(errors,[]);
  console.log('Real input checks passed: M, E, shared frame, phone button >=64px, brake clearance, three independent fingers, no runtime exceptions.');
} finally { await cdpFetch(`http://127.0.0.1:${process.env.CDP_PORT}/json/close/${tab.id}`); ws.close(); }
JS
fi
