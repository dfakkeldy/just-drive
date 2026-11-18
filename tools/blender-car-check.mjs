#!/usr/bin/env node
// A fixed asset contract: changing the generator requires an intentional snapshot update.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { GLTFLoader } from '../web/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
const variants = process.argv[2] ? [process.argv[2]] : ['mail-car.glb', 'mail-car-low.glb'].map(name => fileURLToPath(new URL('../web/public/models/' + name, import.meta.url)));
for (const path of variants) {
const low = path.includes('-low.glb');
const bytes = readFileSync(path);
assert.ok(bytes.length < 600_000, `GLB hard budget: ${bytes.length} bytes`);
const jsonLength = bytes.readUInt32LE(12);
const doc = JSON.parse(bytes.subarray(20,20+jsonLength));
assert.ok(doc.extensionsRequired?.includes('KHR_mesh_quantization'));
assert.ok(!doc.extensionsUsed?.some(e=>/draco|meshopt/i.test(e)),'no external decoder extension');
// The car carries its own pictures (PNG, inside the file). Check them here, then hand GLTFLoader the same file
// without them: Node has no image decoder, and this check is about geometry and nodes.
const binAt = 20 + jsonLength, bin = bytes.subarray(binAt + 8, binAt + 8 + bytes.readUInt32LE(binAt));
for (const image of doc.images ?? []) {
  const view = doc.bufferViews[image.bufferView], png = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  assert.equal(image.mimeType, 'image/png'); assert.equal(png.subarray(0, 8).toString('latin1'), '\x89PNG\r\n\x1a\n', `${image.name} is a PNG`);
  assert.ok(png.length < 40_000, `${image.name} picture stays small: ${png.length} bytes`);
}
assert.equal(doc.images.length, 2, 'two pictures: one atlas (sign, plates and head lamps share it) and the mud tile');
assert.ok(doc.materials.some(m => m.name === 'Head lamp'), 'the head lamps have their own lit material');
// The sign and plate words are in the atlas picture, and the game shows another cell of it for a car without mail
// words (Just Drive, off duty): it slides the picture by 0.5 (sign) and 0.25 (plate), car-model.ts. No other check
// can read those words, so the cells are read here: the wordless sign has no letters, the off-duty plate is not
// the mail plate, and all four cells are pinned. Moving "MAIL 19" into the off-duty cell fails this.
{
  const picture = doc.images.find(image => image.name === 'Sign atlas'); assert.ok(picture, 'the atlas picture is in the file');
  const view = doc.bufferViews[picture.bufferView], png = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  const atlas = decodePng(png); assert.deepEqual([atlas.width, atlas.height], [1024, 512], 'atlas size');
  const cell = (x, y, w, h) => { const rows = []; for (let r = y; r < y + h; r++) rows.push(atlas.pixels.subarray((r * atlas.width + x) * atlas.channels, (r * atlas.width + x + w) * atlas.channels)); return Buffer.concat(rows); };
  const light = bytes => { let n = 0; for (let i = 0; i < bytes.length; i += atlas.channels) if (bytes[i] + bytes[i + 1] + bytes[i + 2] > 480) n++; return n; };
  const dark = bytes => { let n = 0; for (let i = 0; i < bytes.length; i += atlas.channels) if (bytes[i] + bytes[i + 1] + bytes[i + 2] < 300) n++; return n; };
  const cells = { sign: cell(0, 0, 512, 128), signWithoutWords: cell(512, 0, 512, 128), plate: cell(0, 256, 256, 128), plateOffDuty: cell(256, 256, 256, 128) };
  // Where the sign's words are (right of the envelope): light letters on the blue band in one cell, plain band in the other.
  assert.ok(light(cell(150, 30, 330, 68)) > 1500, 'the mail sign has its words');
  assert.equal(light(cell(512 + 150, 30, 330, 68)), 0, 'the sign without words has no letters where the words are');
  // The mail plate has a small line over its number; the off-duty plate has none, and is another picture.
  assert.ok(dark(cell(40, 256 + 18, 176, 22)) > 150, 'the mail plate has its small line');
  assert.equal(dark(cell(256 + 40, 256 + 18, 176, 22)), 0, 'the off-duty plate has no small line');
  assert.ok(!cells.plate.equals(cells.plateOffDuty) && dark(cells.plateOffDuty) > 300, 'the off-duty plate is its own picture, with a word on it');
  const hashes = Object.fromEntries(Object.entries(cells).map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex').slice(0, 16)]));
  if (process.env.CAR_ATLAS_PRINT) console.log('ATLAS ' + JSON.stringify(hashes));
  else assert.deepEqual(hashes, JSON.parse(readFileSync(new URL('./blender/mail-car-contract.json', import.meta.url), 'utf8')).atlas, 'the four word cells of the atlas are the pinned pictures (tools/blender/mail-car-contract.json)');
}
for (const material of doc.materials) {
  const textured = material.pbrMetallicRoughness?.baseColorTexture !== undefined;
  assert.equal(textured, ['Sign atlas', 'Head lamp', 'Mud overlay'].includes(material.name), `${material.name}: only the sign atlas, the head lamps and the mud carry a picture`);
  if (textured) for (const mesh of doc.meshes) if (doc.materials[mesh.primitives[0].material] === material) assert.ok('TEXCOORD_0' in mesh.primitives[0].attributes, `${mesh.name} has texture coordinates`);
  assert.ok(!material.doubleSided, `${material.name} is single-sided`);
}
const plain = JSON.parse(JSON.stringify(doc)); delete plain.images; delete plain.textures; delete plain.samplers;
for (const material of plain.materials) { delete material.pbrMetallicRoughness?.baseColorTexture; delete material.emissiveTexture; }
const plainJson = Buffer.from(JSON.stringify(plain)), padded = Buffer.concat([plainJson, Buffer.alloc((4 - plainJson.length % 4) % 4, 0x20)]);
const header = Buffer.alloc(20); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + padded.length + bytes.length - binAt, 8); header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
const stripped = Buffer.concat([header, padded, bytes.subarray(binAt)]);
const gltf = await new GLTFLoader().parseAsync(stripped.buffer.slice(stripped.byteOffset, stripped.byteOffset + stripped.byteLength), '');
const root = gltf.scene;
root.updateMatrixWorld(true);
let triangles = 0;
root.traverse(n => {
  if (!n.isMesh) return;
  triangles += (n.geometry.index?.count ?? n.geometry.attributes.position.count) / 3;
  for (const a of Object.values(n.geometry.attributes)) assert.ok([...a.array].every(Number.isFinite), `${n.name} finite attributes`);
  const p=n.geometry.attributes.position, ix=n.geometry.index, normal=n.geometry.attributes.normal;
  // Judge decoded render-space geometry: KHR position decode may scale axes differently.
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(n.matrixWorld);
  for (let k=0;k<(ix?.count??p.count);k+=3) {
    const at=i=>ix?ix.getX(i):i;
    const a=new THREE.Vector3().fromBufferAttribute(p,at(k)).applyMatrix4(n.matrixWorld), b=new THREE.Vector3().fromBufferAttribute(p,at(k+1)).applyMatrix4(n.matrixWorld), c=new THREE.Vector3().fromBufferAttribute(p,at(k+2)).applyMatrix4(n.matrixWorld);
    const face=b.sub(a).cross(c.sub(a));
    assert.ok(face.length()>1e-10, `${n.name} nonzero triangle ${k/3}`);
    const normals=new THREE.Vector3(); for(let j=0;j<3;j++)normals.add(new THREE.Vector3().fromBufferAttribute(normal,at(k+j)).applyMatrix3(normalMatrix).normalize());
    assert.ok(face.normalize().dot(normals.normalize())>0, `${n.name} winding agrees with normals`);
  }
});
const named = name => { const n=root.getObjectByName(name); assert.ok(n, `named node ${name}`); return n; };
for (const name of ['car_root','body','beacon','sign_light','roof_kit','driver_eye','driver_window','brake_left_brake','brake_left_upper','brake_right_brake','brake_right_upper']) named(name);
for (const key of ['fl','fr','rl','rr']) {
  const wheel=named(`wheel_${key}`), pivot=named(`${key.startsWith('f')?'steer':'axle'}_${key}`);
  assert.equal(wheel.parent,pivot);
  for (const node of [wheel,pivot]) { assert.ok(node.quaternion.angleTo(new THREE.Quaternion())<1e-6,'unrotated local X spin/Y steering'); assert.deepEqual(node.scale.toArray(),[1,1,1]); }
  assert.equal(pivot.parent,named('car_root'));
  [key.endsWith('l')?-.785:.785,0,key.startsWith('f')?-1.31:1.31].forEach((v,i)=>assert.ok(Math.abs(pivot.position.toArray()[i]-v)<1e-6));
  [0,.35,0].forEach((v,i)=>assert.ok(Math.abs(wheel.position.toArray()[i]-v)<1e-6));
  const bounds=new THREE.Box3().setFromObject(wheel,true);
  assert.ok(Math.abs(bounds.max.y-bounds.min.y-.70)<.00002,'wheel diameter');
}
assert.ok(named('driver_eye').position.x>0,'right-hand drive');
for (const name of ['beacon','sign_light','roof_kit','driver_window','driver_eye','brake_left_brake','brake_left_upper','brake_right_brake','brake_right_upper']) assert.equal(named(name).parent,named('body'),`${name} moves with the sprung body`);
assert.equal(new Set(['fl','fr','rl','rr'].map(key => doc.nodes.find(n => n.mesh !== undefined && doc.nodes.find(parent => parent.name === `wheel_${key}`).children.includes(doc.nodes.indexOf(n)) && doc.meshes[n.mesh].name.includes('Matte')).mesh)).size, 1, 'the four wheels share one stored mesh');
const bounds=new THREE.Box3().setFromObject(root,true);
const snapshot={triangles,min:bounds.min.toArray().map(n=>+n.toFixed(6)),max:bounds.max.toArray().map(n=>+n.toFixed(6))};
assert.ok(triangles <= (low ? 8000 : 40000), 'desktop 40k / LOW 8k triangle budget');
console.log(JSON.stringify({variant: low ? 'low' : 'desktop',bytes:bytes.length,...snapshot}));
const expected=JSON.parse(readFileSync(new URL('./blender/mail-car-contract.json',import.meta.url),'utf8'));
assert.deepEqual(snapshot,expected[low ? 'low' : 'desktop'],'committed triangle count and bounding box');

}

/** A small PNG reader for the car's own atlas: 8-bit RGB or RGBA, not interlaced. Returns raw pixel bytes. */
function decodePng(png) {
  let at = 8, width = 0, height = 0, channels = 0; const data = [];
  while (at < png.length) {
    const length = png.readUInt32BE(at), kind = png.subarray(at + 4, at + 8).toString('latin1'), body = png.subarray(at + 8, at + 8 + length);
    if (kind === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); assert.equal(body[8], 8, '8-bit PNG'); assert.ok(body[9] === 2 || body[9] === 6, 'RGB or RGBA PNG'); assert.equal(body[12], 0, 'not interlaced'); channels = body[9] === 6 ? 4 : 3; }
    if (kind === 'IDAT') data.push(body);
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data)), stride = width * channels, pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), out = pixels.subarray(y * stride, (y + 1) * stride), up = y ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? out[i - channels] : 0, b = up ? up[i] : 0, c = up && i >= channels ? up[i - channels] : 0;
      const paeth = () => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
      out[i] = (line[i] + (filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : paeth())) & 255;
    }
  }
  return { width, height, channels, pixels };
}
