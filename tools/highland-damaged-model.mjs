// Corrupt only the JSON contract; preserve the valid GLB header, chunks and binary accessor offsets.
export function damageHighland(bytes, kind) {
  const length = bytes.readUInt32LE(12), doc = JSON.parse(bytes.subarray(20, 20 + length));
  if (kind === 'missing-node') doc.nodes.find(n => n.name === 'head').name = 'broken_head';
  else if (kind === 'missing-mesh') doc.nodes.find(n => n.name === 'torso').name = 'broken_torso';
  else if (kind === 'missing-colour') for (const mesh of doc.meshes) for (const primitive of mesh.primitives) delete primitive.attributes.COLOR_0;
  else throw Error(`Unknown Highland damage: ${kind}`);
  let json = Buffer.from(JSON.stringify(doc));
  json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
  const bin = bytes.subarray(20 + length), head = Buffer.from(bytes.subarray(0, 20));
  head.writeUInt32LE(20 + json.length + bin.length, 8); head.writeUInt32LE(json.length, 12);
  return Buffer.concat([head, json, bin]);
}
