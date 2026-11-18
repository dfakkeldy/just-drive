#!/usr/bin/env node
// The Highland bull's asset contract: node names and pivots, hoof contacts, size, triangle/draw/byte budgets,
// and a pinned snapshot, so a changed generator needs an intentional update.
//   node tools/highland-model-check.mjs                    check both models
//   node tools/highland-model-check.mjs --mutations        also prove that broken models fail
//   node tools/highland-model-check.mjs --update-snapshot  after an intended change to tools/blender/highland.py
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { GLTFLoader } from '../web/node_modules/three/examples/jsm/loaders/GLTFLoader.js';

const contractPath = fileURLToPath(new URL('./blender/highland-contract.json', import.meta.url));
const contract = JSON.parse(readFileSync(contractPath, 'utf8'));
const file = variant => fileURLToPath(new URL(`../web/public/models/highland-bull${variant === 'low' ? '-low' : ''}.glb`, import.meta.url));

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
  const low = variant === 'low', budget = contract.budgets[variant], names = contract.nodes;
  assert.ok(bytes.length <= budget.bytes, `${variant}: ${bytes.length} bytes is over the ${budget.bytes} byte budget`);
  const { doc } = parse(bytes);
  assert.ok(doc.extensionsRequired?.includes('KHR_mesh_quantization'), 'quantized with KHR_mesh_quantization');
  assert.ok(!doc.extensionsUsed?.some(e => /draco|meshopt/i.test(e)), 'no decoder extension');
  assert.ok(!doc.images?.length && !doc.textures?.length, 'no textures');
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const scene = gltf.scene; scene.updateMatrixWorld(true);
  const named = name => { const n = scene.getObjectByName(name); assert.ok(n, `named node ${name}`); return n; };
  const root = named(names.root), body = named(names.body);
  // Node identity is tested with ===: assert.equal would try to print two whole scene graphs.
  assert.ok(body.parent === root, 'body hangs from the root');
  const pivot = (name, at) => {
    const n = named(name);
    assert.ok(n.parent === body, `${name} hangs from body`);
    assert.ok(!n.isMesh, `${name} is a pivot, not a mesh`);
    assert.ok(n.quaternion.angleTo(new THREE.Quaternion()) < 1e-6 && n.scale.distanceTo(new THREE.Vector3(1, 1, 1)) < 1e-6, `${name} is unrotated and unscaled`);
    at.forEach((v, i) => assert.ok(Math.abs(n.position.getComponent(i) - v) < 1e-5, `${name} pivot ${n.position.toArray()} is not ${at}`));
    return n;
  };
  for (const n of [root, body]) assert.ok(n.matrixWorld.equals(new THREE.Matrix4()), `${n.name} is at the origin, unrotated and unscaled`);
  const expected = new Map([[names.torso, body], ['head_mesh', pivot(names.head, contract.pivots.head)]]);
  const tail = pivot(names.tail, contract.pivots.tail);
  if (!low) expected.set('tail_mesh', tail);
  names.legs.forEach((leg, i) => {
    const node = pivot(leg, contract.pivots[leg]), hoof = named(names.hooves[i]);
    assert.ok(Math.abs(node.position.y - .63 * contract.shoulder) < 1e-4, `${leg}: the pivot is .63 x shoulder high (animals.ts groundRig)`);
    assert.ok(hoof.parent === node, `${names.hooves[i]} moves with ${leg}`);
    const p = hoof.getWorldPosition(new THREE.Vector3());
    assert.ok(Math.abs(p.y) < 1e-5 && Math.abs(p.x - node.position.x) < 1e-5 && Math.abs(p.z - node.position.z) < 1e-5, `${names.hooves[i]} is on the ground, straight below its pivot`);
    if (!low) expected.set(`${leg}_mesh`, node);
  });
  const meshes = []; scene.traverse(n => { if (n.isMesh) meshes.push(n); });
  assert.deepEqual(meshes.map(m => m.name).sort(), [...expected.keys()].sort(), 'exactly the contract meshes');
  // The loader merges the legs into the body, so the game draws body, head and (desktop) tail.
  const draws = meshes.filter(m => !/^leg_/.test(m.name)).length;
  assert.ok(draws <= budget.draws, `${variant}: ${draws} draws is over ${budget.draws}`);
  let triangles = 0, agree = 0;
  const bounds = new THREE.Box3(), boxes = {}, luminance = {}, back = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), face = new THREE.Vector3();
  for (const mesh of meshes) {
    assert.ok(mesh.parent === expected.get(mesh.name), `${mesh.name} hangs from its own pivot`);
    assert.equal(mesh.children.length, 0, `${mesh.name} is a leaf`);
    const g = mesh.geometry, position = g.attributes.position, normal = g.attributes.normal, colour = g.attributes.color, index = g.index;
    assert.ok(position && normal && colour && index, `${mesh.name} has positions, normals, vertex colours and an index`);
    for (const attribute of [position, normal, colour]) for (const v of attribute.array) assert.ok(Number.isFinite(v), `${mesh.name} finite data`);
    const box = boxes[mesh.name] = new THREE.Box3(), lum = luminance[mesh.name] = [];
    const world = [];
    for (let i = 0; i < position.count; i++) {
      const p = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld); world.push(p); box.expandByPoint(p);
      const r = colour.getX(i), gr = colour.getY(i), bl = colour.getZ(i);
      assert.ok(r >= 0 && r <= 1 && gr >= 0 && gr <= 1 && bl >= 0 && bl <= 1, `${mesh.name} colour range`);
      lum.push(.2126 * r + .7152 * gr + .0722 * bl);
      if (mesh.name === names.torso && p.z > -.2 && p.z < .5) back.push(p.y);
    }
    bounds.union(box);
    const rotation = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    for (let k = 0; k < index.count; k += 3) {
      const [i, j, l] = [index.getX(k), index.getX(k + 1), index.getX(k + 2)];
      a.copy(world[i]); b.copy(world[j]); c.copy(world[l]);
      face.subVectors(b, a).cross(c.sub(a));
      assert.ok(face.length() > 1e-12, `${mesh.name} triangle ${k / 3} has no area`);
      n.set(0, 0, 0);
      for (const v of [i, j, l]) n.add(new THREE.Vector3().fromBufferAttribute(normal, v).applyMatrix3(rotation).normalize());
      if (face.dot(n) > 0) agree++;
      triangles++;
    }
  }
  assert.ok(triangles <= budget.triangles, `${variant}: ${triangles} triangles is over ${budget.triangles}`);
  // Strands are shaded with the normal of the body under them, and the hanging ones are closed underneath:
  // those undersides face away from their normals. A mesh wound inside out agrees on almost none.
  assert.ok(agree / triangles > .8, `${variant}: winding agrees with the normals on only ${(100 * agree / triangles).toFixed(1)}% of triangles`);
  const within = (value, [lo, hi], what) => assert.ok(value >= lo && value <= hi, `${variant}: ${what} ${value.toFixed(3)} m is outside ${lo}-${hi} m`);
  const head = boxes.head_mesh;
  within(head.max.x - head.min.x, contract.measures.hornSpan, 'horn span');
  within(head.max.y, contract.measures.hornTipHeight, 'horn tip height');
  within(Math.max(...back), contract.measures.backHeight, 'back height');
  within(bounds.max.z - bounds.min.z, contract.measures.length, 'length');
  assert.ok(bounds.min.y > -.002 && bounds.min.y < .004, `${variant}: the hooves stand on the ground (lowest point ${bounds.min.y})`);
  if (!low) for (const leg of names.legs) assert.ok(Math.abs(boxes[`${leg}_mesh`].min.y) < .004, `${leg}: its hoof reaches the ground`);
  // Each main mesh is centred on the animal's middle line (the strands are random, so allow 4 cm).
  for (const name of [names.torso, 'head_mesh']) assert.ok(Math.abs(boxes[name].min.x + boxes[name].max.x) < .04, `${variant}: ${name} is off the middle line by ${(boxes[name].min.x + boxes[name].max.x).toFixed(3)} m`);
  const median = values => [...values].sort((x, y) => x - y)[values.length >> 1];
  assert.ok(median(luminance.head_mesh) < .8 * median(luminance[names.torso]), 'the head is darker than the body');
  assert.ok(median(luminance[names.torso]) > .006 && median(luminance[names.torso]) < .2, 'the coat is a dark colour, not black and not pale');
  const measured = { triangles, min: bounds.min.toArray().map(v => +v.toFixed(4)), max: bounds.max.toArray().map(v => +v.toFixed(4)) };
  if (snapshot) assert.deepEqual(measured, snapshot, `${variant}: pinned triangle count and bounds (run --update-snapshot after an intended change)`);
  return { ...measured, bytes: bytes.length, draws, meshes: meshes.length, windingAgrees: +(agree / triangles).toFixed(3) };
}

const variants = ['desktop', 'low'];
if (process.argv.includes('--update-snapshot')) {
  for (const variant of variants) {
    const { triangles, min, max } = await verify(readFileSync(file(variant)), variant, null);
    contract.snapshot[variant] = { triangles, min, max };
  }
  // Short arrays stay on one line, so the contract reads as a table.
  writeFileSync(contractPath, JSON.stringify(contract, null, 2).replace(/\[\n\s+([^\[\]{}]*?)\n\s+\]/g, (_, items) => `[${items.replace(/\n\s+/g, ' ')}]`) + '\n');
  console.log('snapshot updated in tools/blender/highland-contract.json');
}
for (const variant of variants) console.log(`PASS highland ${variant}: ${JSON.stringify(await verify(readFileSync(file(variant)), variant))}`);

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
  const cases = {
    'head node renamed': doc => { node(doc, 'head').name = 'skull'; },
    'head pivot moved 5 cm': doc => { node(doc, 'head').translation[1] += .05; },
    'head pivot scaled': doc => { node(doc, 'head').scale = [1.1, 1.1, 1.1]; },
    'head mesh hung from the body, not the head': doc => {
      const head = node(doc, 'head'), mesh = doc.nodes.findIndex(x => x.name === 'head_mesh');
      head.children = head.children.filter(i => i !== mesh); node(doc, 'body').children.push(mesh);
    },
    'front left leg pivot raised': doc => { node(doc, 'leg_fl').translation[1] += .03; },
    'hoof contact removed': doc => { node(doc, 'hoof_rr').name = 'spare'; },
    'hoof contact off the ground': doc => { node(doc, 'hoof_rl').translation[1] += .02; },
    'vertex colours dropped': doc => { delete primitive(doc, 'torso').attributes.COLOR_0; },
    'a fourth draw added': doc => { doc.nodes.push({ ...node(doc, 'head_mesh'), name: 'extra' }); node(doc, 'body').children.push(doc.nodes.length - 1); },
    'quantization no longer declared': doc => { doc.extensionsRequired = []; },
    'whole animal scaled up': doc => { node(doc, 'highland_bull').scale = [1.2, 1.2, 1.2]; },
    'body mesh shifted sideways': doc => { node(doc, 'torso').translation[0] += .06; },
    'torso wound inside out': (doc, bin) => {
      const offsets = []; u16(doc, bin, primitive(doc, 'torso').indices, o => offsets.push(o));
      for (let i = 0; i + 2 < offsets.length; i += 3) { const x = bin.readUInt16LE(offsets[i + 1]); bin.writeUInt16LE(bin.readUInt16LE(offsets[i + 2]), offsets[i + 1]); bin.writeUInt16LE(x, offsets[i + 2]); }
    },
    'coat painted white': (doc, bin) => {
      for (const name of ['torso', 'head_mesh']) u16(doc, bin, primitive(doc, name).attributes.COLOR_0, o => { for (let k = 0; k < 3; k++) bin.writeUInt16LE(65535, o + k * 2); });
    },
    'horns cut short': (doc, bin) => {
      // Pull every head vertex beyond 0.3 m from the centre line back to it: the span no longer matches.
      const scale = node(doc, 'head_mesh').scale[0], shift = node(doc, 'head_mesh').translation[0];
      u16(doc, bin, primitive(doc, 'head_mesh').attributes.POSITION, o => {
        const x = bin.readUInt16LE(o) / 65535 * scale + shift;
        if (Math.abs(x) > .3) bin.writeUInt16LE(Math.round((Math.sign(x) * .3 - shift) / scale * 65535), o);
      });
    },
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
  console.log(`PASS ${rejected} highland model mutations rejected`);
}
