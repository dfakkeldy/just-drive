// LOW (phones): small roadside props (mailboxes, insulators, transformers, lamps) draw within LOW_SMALL_RANGE of the
// camera; poles, crossarms and the wire line keep the cell range (900 m). Desktop (HIGH) keeps every part to 900 m.
// Node only: the real Props class on flat invented land, no data. Usage: node tools/run-node-check.mjs tools/props-low-range-check.mjs
import assert from 'node:assert/strict';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { Props, LOW_SMALL_RANGE } from '../web/src/props.ts';
const TALL = ['pole', 'crossarm', 'Sagging wires and service drops'];
// One mailbox and two poles with a transformer, together in one 256 m cell centred near (128, 128).
const data = { crs: 'EPSG:2961', communityBoxes: [],
  mailboxes: [{ x: 100, y: -100, heading: 0, style: 0, tilt: 0, group: null, parcelBox: false }],
  poles: [{ x: 110, y: -100, heading: 0, road: 1, n: 0, transformer: true, light: true }, { x: 150, y: -100, heading: 0, road: 1, n: 1, transformer: false, light: false }] };
const visibility = (low, distance) => {
  const terrain = { cartRoads: false, low, dataRevision: 1, exag: 1, seaLevel: 0, heightAt: () => 0, meshHeightAt: () => 0, surfaceAt: () => ({ ground: 0, level: 8, canopy: 0 }) };
  const props = new Props(data, [0, 0], terrain), camera = new THREE.PerspectiveCamera();
  camera.position.set(110, 2, 100); camera.updateMatrixWorld(); props.update(camera, 0);   // build the cell from close by
  camera.position.set(110 - 128 - distance, 2, 100); camera.updateMatrixWorld(); props.nextUpdate = 0; props.update(camera, 0);
  const cell = props.group.children[0];
  assert.ok(cell && cell.visible === distance < 900, `cell shown within 900 m (${distance} m)`);
  return Object.fromEntries(cell.children.map(m => [m.name, m.visible]));
};
for (const distance of [0, LOW_SMALL_RANGE - 20, LOW_SMALL_RANGE + 20, 800]) {
  for (const low of [false, true]) {
    const shown = visibility(low, distance);
    assert.ok(Object.keys(shown).length > 8, 'the cell has its parts');
    for (const [name, visible] of Object.entries(shown)) {
      const want = TALL.includes(name) || !low || distance < LOW_SMALL_RANGE;
      assert.equal(visible, want, `${low ? 'LOW' : 'HIGH'} ${distance} m: ${name} ${want ? 'shown' : 'hidden'}`);
    }
  }
}
// A cell first built beyond the range on LOW never shows its small parts, not even for one update.
{
  const terrain = { cartRoads: false, low: true, dataRevision: 1, exag: 1, seaLevel: 0, heightAt: () => 0, meshHeightAt: () => 0, surfaceAt: () => ({ ground: 0, level: 8, canopy: 0 }) };
  const props = new Props(data, [0, 0], terrain), camera = new THREE.PerspectiveCamera();
  camera.position.set(110 - 128 - (LOW_SMALL_RANGE + 50), 2, 100); camera.updateMatrixWorld(); props.update(camera, 0);
  const cell = props.group.children[0];
  assert.ok(cell, 'built within 600 m');
  assert.ok(cell.children.filter(m => !TALL.includes(m.name)).every(m => !m.visible), 'small parts hidden at once on a far build');
}
// Each mailbox style batches its body and inset door in one box-<style> InstancedMesh (no separate door-<style> draw).
{
  const terrain = { cartRoads: false, low: true, dataRevision: 1, exag: 1, seaLevel: 0, heightAt: () => 0, meshHeightAt: () => 0, surfaceAt: () => ({ ground: 0, level: 8, canopy: 0 }) };
  const mailboxes = Array.from({ length: 8 }, (_, style) => ({ x: 100 + style * 2, y: -100, heading: 0, style, tilt: 0, group: null, parcelBox: false }));
  const props = new Props({ crs: 'EPSG:2961', mailboxes, communityBoxes: [], poles: [] }, [0, 0], terrain);
  const camera = new THREE.PerspectiveCamera(); camera.position.set(100, 2, 100); camera.updateMatrixWorld();
  props.update(camera, 0);
  const meshes = props.group.children.flatMap(c => c.children);
  for (let style = 0; style < 8; style++) {
    const box = meshes.find(m => m.name === `box-${style}`);
    assert.ok(box && box.count === 2, `style ${style}: body and inset door share one box-${style} mesh (count 2)`);
    assert.equal(meshes.find(m => m.name === `door-${style}`), undefined, `style ${style}: no separate door-${style} draw`);
  }
}
console.log(`PASS props LOW range: small parts within ${LOW_SMALL_RANGE} m on LOW, poles, crossarms and wires to 900 m; HIGH unchanged`);
