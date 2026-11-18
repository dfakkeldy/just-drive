#!/usr/bin/env node
// The porch dog's asset contract: node names and pivots, the lying pose, size, colours, triangle/draw/byte budgets,
// and a pinned snapshot, so a changed generator needs an intentional update.
//   node tools/porch-dog-model-check.mjs                    check both models
//   node tools/porch-dog-model-check.mjs --mutations        also prove that broken models fail
//   node tools/porch-dog-model-check.mjs --update-snapshot  after an intended change to tools/blender/porch_dog.py
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { GLTFLoader } from '../web/node_modules/three/examples/jsm/loaders/GLTFLoader.js';

const contractPath = fileURLToPath(new URL('./blender/porch-dog-contract.json', import.meta.url));
const contract = JSON.parse(readFileSync(contractPath, 'utf8'));
const file = variant => fileURLToPath(new URL(`../web/public/models/porch-dog${variant === 'low' ? '-low' : ''}.glb`, import.meta.url));

function parse(bytes) {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, 'GLB magic');
  const jsonLength = bytes.readUInt32LE(12);
  const doc = JSON.parse(bytes.subarray(20, 20 + jsonLength));
  const binLength = bytes.readUInt32LE(20 + jsonLength);
  return { doc, bin: Buffer.from(bytes.subarray(28 + jsonLength, 28 + jsonLength + binLength)) };
}
function pack(doc, bin) {
  let json = Buffer.from(JSON.stringify(doc)); json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
  const header = Buffer.alloc(20), binHeader = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + json.length + bin.length, 8);
  header.writeUInt32LE(json.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  binHeader.writeUInt32LE(bin.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, json, binHeader, bin]);
}

/** Throws on the first broken promise. Returns what was measured. */
async function verify(bytes, variant, snapshot = contract.snapshot[variant]) {
  const budget = contract.budgets[variant], names = contract.nodes, wanted = contract.meshes[variant];
  assert.ok(bytes.length <= budget.bytes, `${variant}: ${bytes.length} bytes is over the ${budget.bytes} byte budget`);
  const { doc } = parse(bytes);
  assert.ok(doc.extensionsRequired?.includes('KHR_mesh_quantization'), 'quantized with KHR_mesh_quantization');
  assert.ok(!doc.extensionsUsed?.some(e => /draco|meshopt/i.test(e)), 'no decoder extension');
  assert.ok(!doc.images?.length && !doc.textures?.length, 'no textures');
  assert.ok(!doc.skins?.length && !doc.animations?.length, 'no skeleton and no animation: the game turns the pivots');
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const scene = gltf.scene; scene.updateMatrixWorld(true);
  const named = name => { const n = scene.getObjectByName(name); assert.ok(n, `named node ${name}`); return n; };
  const root = named(names.root);
  // Node identity is tested with ===: assert.equal would try to print two whole scene graphs.
  assert.ok(root.parent === scene, 'the root is the top node');
  assert.ok(root.matrixWorld.equals(new THREE.Matrix4()), 'the root is at the origin, unrotated and unscaled');
  const pivots = { [names.root]: root };
  for (const key of ['neck', 'head', 'tail']) {
    const n = pivots[names[key]] = named(names[key]), at = contract.pivots[key];
    assert.ok(n.parent === named(names[contract.parents[key]]), `${key} hangs from ${contract.parents[key]}`);
    assert.ok(!n.isMesh, `${key} is a pivot, not a mesh`);
    assert.ok(n.quaternion.angleTo(new THREE.Quaternion()) < 1e-6 && n.scale.distanceTo(new THREE.Vector3(1, 1, 1)) < 1e-6, `${key} is unrotated and unscaled`);
    at.forEach((v, i) => assert.ok(Math.abs(n.position.getComponent(i) - v) < 1e-5, `${key} pivot ${n.position.toArray()} is not ${at}`));
  }
  const meshes = []; scene.traverse(n => { if (n.isMesh) meshes.push(n); });
  assert.deepEqual(meshes.map(m => m.name).sort(), Object.keys(wanted).sort(), 'exactly the contract meshes');
  assert.ok(meshes.length <= budget.draws, `${variant}: ${meshes.length} draws is over ${budget.draws}`);
  let triangles = 0, agree = 0;
  const bounds = new THREE.Box3(), boxes = {}, colours = {}, back = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), face = new THREE.Vector3();
  for (const mesh of meshes) {
    assert.ok(mesh.parent === pivots[wanted[mesh.name]], `${mesh.name} hangs from its own pivot, ${wanted[mesh.name]}`);
    assert.equal(mesh.children.length, 0, `${mesh.name} is a leaf`);
    const g = mesh.geometry, position = g.attributes.position, normal = g.attributes.normal, colour = g.attributes.color, index = g.index;
    assert.ok(position && normal && colour && index, `${mesh.name} has positions, normals, vertex colours and an index`);
    for (const attribute of [position, normal, colour]) for (const v of attribute.array) assert.ok(Number.isFinite(v), `${mesh.name} finite data`);
    const box = boxes[mesh.name] = new THREE.Box3(), list = colours[mesh.name] = [];
    const world = [];
    for (let i = 0; i < position.count; i++) {
      const p = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld); world.push(p); box.expandByPoint(p);
      const r = colour.getX(i), gr = colour.getY(i), bl = colour.getZ(i);
      assert.ok(r >= 0 && r <= 1 && gr >= 0 && gr <= 1 && bl >= 0 && bl <= 1, `${mesh.name} colour range`);
      list.push([r, gr, bl, .2126 * r + .7152 * gr + .0722 * bl]);
      if (mesh.name === 'body-mesh' && p.z > -.1 && p.z < .2) back.push(p.y);
    }
    bounds.union(box);
    const rotation = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    for (let k = 0; k < index.count; k += 3) {
      const [i, j, l] = [index.getX(k), index.getX(k + 1), index.getX(k + 2)];
      a.copy(world[i]); b.copy(world[j]); c.copy(world[l]);
      face.subVectors(b, a).cross(c.sub(a));
      assert.ok(face.length() > 1e-13, `${mesh.name} triangle ${k / 3} has no area`);
      n.set(0, 0, 0);
      for (const v of [i, j, l]) n.add(new THREE.Vector3().fromBufferAttribute(normal, v).applyMatrix3(rotation).normalize());
      if (face.dot(n) > 0) agree++;
      triangles++;
    }
  }
  assert.ok(triangles <= budget.triangles, `${variant}: ${triangles} triangles is over ${budget.triangles}`);
  // Strands are shaded with the normal of the body under them. A mesh wound inside out agrees on almost none.
  assert.ok(agree / triangles > .8, `${variant}: winding agrees with the normals on only ${(100 * agree / triangles).toFixed(1)}% of triangles`);
  const within = (value, [lo, hi], what) => assert.ok(value >= lo && value <= hi, `${variant}: ${what} ${value.toFixed(3)} m is outside ${lo} to ${hi} m`);
  const head = boxes['head-mesh'], body = boxes['body-mesh'];
  within(head.max.y, contract.measures.headTop, 'top of the head');
  within(head.min.z, contract.measures.noseReach, 'nose (the dog faces -Z)');
  within(Math.max(...back), contract.measures.backHeight, 'back height (the dog lies down)');
  within(bounds.max.z - bounds.min.z, contract.measures.length, 'length, nose to tail');
  assert.ok(bounds.min.y > -.002 && bounds.min.y < .004, `${variant}: the dog lies on the floor (lowest point ${bounds.min.y})`);
  assert.ok(Math.abs(body.min.y) < .004, `${variant}: the body rests on the floor`);
  assert.ok(Math.abs(head.min.x + head.max.x) < .03, `${variant}: the head is off the middle line by ${(head.min.x + head.max.x).toFixed(3)} m`);
  assert.ok(head.min.y > Math.max(...back) + .05, `${variant}: the head is up, above the back`);
  // Colours are linear. The coat is red gold. An old dog's muzzle has greyed, but its face stays golden: a face
  // that is pale all over reads as a mask. Its eyes and nose are dark.
  const median = (values, k) => values.map(v => v[k]).sort((x, y) => x - y)[values.length >> 1];
  const coat = colours['body-mesh'], faceColours = colours['head-mesh'];
  const [r, g, bl] = [0, 1, 2].map(k => median(coat, k));
  assert.ok(r > 1.6 * g && g > 1.5 * bl && r > .12 && r < .6, `${variant}: the coat is red gold, not [${r.toFixed(3)}, ${g.toFixed(3)}, ${bl.toFixed(3)}]`);
  const share = test => faceColours.filter(test).length / faceColours.length;
  const greyed = share(v => v[0] < 1.5 * v[1] && v[3] > .3);
  assert.ok(greyed > .06, `${variant}: the muzzle has greyed (${(100 * greyed).toFixed(1)}% of the head)`);
  assert.ok(greyed < .25, `${variant}: the face stays golden; ${(100 * greyed).toFixed(1)}% of the head is greyed, which reads as a mask`);
  assert.ok(share(v => v[3] < .02) > .004, `${variant}: the head has dark eyes and a dark nose`);
  assert.ok(share(v => v[0] > 1.6 * v[1] && v[3] < .3) > .15, `${variant}: the crown and the ears are red`);
  const measured = { triangles, min: bounds.min.toArray().map(v => +v.toFixed(4)), max: bounds.max.toArray().map(v => +v.toFixed(4)) };
  if (snapshot) assert.deepEqual(measured, snapshot, `${variant}: pinned triangle count and bounds (run --update-snapshot after an intended change)`);
  return { ...measured, bytes: bytes.length, draws: meshes.length, windingAgrees: +(agree / triangles).toFixed(3) };
}

const variants = ['desktop', 'low'];
if (process.argv.includes('--update-snapshot')) {
  for (const variant of variants) {
    const { triangles, min, max } = await verify(readFileSync(file(variant)), variant, null);
    contract.snapshot[variant] = { triangles, min, max };
  }
  // Short arrays stay on one line, so the contract reads as a table.
  writeFileSync(contractPath, JSON.stringify(contract, null, 2).replace(/\[\n\s+([^\[\]{}]*?)\n\s+\]/g, (_, items) => `[${items.replace(/\n\s+/g, ' ')}]`) + '\n');
  console.log('snapshot updated in tools/blender/porch-dog-contract.json');
}
for (const variant of variants) {
  assert.ok(contract.snapshot[variant], `${variant}: the contract has no snapshot yet (run --update-snapshot)`);
  console.log(`PASS porch dog ${variant}: ${JSON.stringify(await verify(readFileSync(file(variant)), variant))}`);
}

if (process.argv.includes('--mutations')) {
  const node = (doc, name) => { const n = doc.nodes.find(x => x.name === name); assert.ok(n, `mutation anchor ${name}`); return n; };
  const primitive = (doc, name) => doc.meshes[node(doc, name).mesh].primitives[0];
  // Raw u16 access to one accessor of the binary chunk.
  const u16 = (doc, bin, accessor, each) => {
    const acc = doc.accessors[accessor], view = doc.bufferViews[acc.bufferView];
    assert.equal(acc.componentType, 5123, 'mutation expects u16 data');
    const size = { SCALAR: 1, VEC3: 3 }[acc.type], stride = view.byteStride ?? size * 2;
    for (let i = 0; i < acc.count; i++) each((view.byteOffset ?? 0) + (acc.byteOffset ?? 0) + i * stride, i);
  };
  const paint = (doc, bin, name, rgb) => u16(doc, bin, primitive(doc, name).attributes.COLOR_0, o => rgb.forEach((v, k) => bin.writeUInt16LE(Math.round(v * 65535), o + k * 2)));
  const repaint = (doc, bin, name, change) => u16(doc, bin, primitive(doc, name).attributes.COLOR_0, o => {
    const next = change([0, 1, 2].map(k => bin.readUInt16LE(o + k * 2) / 65535));
    if (next) next.forEach((v, k) => bin.writeUInt16LE(Math.round(v * 65535), o + k * 2));
  });
  // The quantized meshes decode through their node: scale then translation.
  const stretch = (doc, name, axis, factor) => { const n = node(doc, name); n.scale = [...n.scale]; n.scale[axis] *= factor; n.translation = [...n.translation]; n.translation[axis] *= factor; };
  const cases = {
    'head node renamed': doc => { node(doc, 'head').name = 'skull'; },
    'head pivot moved 5 cm': doc => { node(doc, 'head').translation[1] += .05; },
    'neck pivot scaled': doc => { node(doc, 'neck').scale = [1.1, 1.1, 1.1]; },
    'neck pivot turned': doc => { node(doc, 'neck').rotation = [0, .0872, 0, .9962]; },
    'tail pivot removed': doc => { node(doc, 'tail').name = 'spare'; },
    'head hung from the root, not the neck': doc => {
      const neck = node(doc, 'neck'), head = doc.nodes.findIndex(x => x.name === 'head');
      neck.children = neck.children.filter(i => i !== head); node(doc, 'root').children.push(head);
    },
    'head mesh hung from the root, not the head': doc => {
      const head = node(doc, 'head'), mesh = doc.nodes.findIndex(x => x.name === 'head-mesh');
      head.children = head.children.filter(i => i !== mesh); node(doc, 'root').children.push(mesh);
    },
    'vertex colours dropped': doc => { delete primitive(doc, 'body-mesh').attributes.COLOR_0; },
    'one more draw added': doc => { doc.nodes.push({ ...node(doc, 'head-mesh'), name: 'extra' }); node(doc, 'head').children.push(doc.nodes.length - 1); },
    'quantization no longer declared': doc => { doc.extensionsRequired = []; },
    'whole dog scaled up': doc => { node(doc, 'root').scale = [1.2, 1.2, 1.2]; },
    'the dog stands up': doc => { stretch(doc, 'body-mesh', 1, 1.7); },
    'the dog sinks into the floor': doc => { node(doc, 'body-mesh').translation[1] -= .05; },
    'the head faces backward': doc => { const n = node(doc, 'head-mesh'); n.scale = [n.scale[0], n.scale[1], -n.scale[2]]; n.translation = [n.translation[0], n.translation[1], -n.translation[2]]; },
    'head mesh shifted sideways': doc => { node(doc, 'head-mesh').translation[0] += .05; },
    'body wound inside out': (doc, bin) => {
      const offsets = []; u16(doc, bin, primitive(doc, 'body-mesh').indices, o => offsets.push(o));
      for (let i = 0; i + 2 < offsets.length; i += 3) { const x = bin.readUInt16LE(offsets[i + 1]); bin.writeUInt16LE(bin.readUInt16LE(offsets[i + 2]), offsets[i + 1]); bin.writeUInt16LE(x, offsets[i + 2]); }
    },
    'coat painted white': (doc, bin) => { paint(doc, bin, 'body-mesh', [1, 1, 1]); },
    'coat painted black': (doc, bin) => { paint(doc, bin, 'body-mesh', [.01, .01, .01]); },
    'face painted the red of the coat': (doc, bin) => { paint(doc, bin, 'head-mesh', [.4, .09, .02]); },
    // The ears and the back of the skull stay red and the eyes stay dark: only the mask rule can catch this one.
    'the golden face greyed all over: a mask': (doc, bin) => { repaint(doc, bin, 'head-mesh', ([r, g, b]) => (.2126 * r + .7152 * g + .0722 * b > .05 && r < 2.9 * g ? [.6, .5, .36] : null)); },
  };
  let rejected = 0;
  for (const variant of variants) {
    const original = readFileSync(file(variant));
    const same = parse(original);
    await verify(pack(same.doc, same.bin), variant);                 // the repacker itself changes no verdict
    for (const [name, mutate] of Object.entries(cases)) {
      const { doc, bin } = parse(original);
      mutate(doc, bin);
      await assert.rejects(verify(pack(doc, bin), variant), undefined, `${variant}: "${name}" must fail`);
      rejected++;
    }
  }
  await assert.rejects(verify(readFileSync(file('desktop')), 'low'), undefined, 'the desktop model must not pass as LOW'); rejected++;
  await assert.rejects(verify(readFileSync(file('low')), 'desktop'), undefined, 'the LOW model must not pass as desktop'); rejected++;
  console.log(`PASS ${rejected} porch dog model mutations rejected`);
}
