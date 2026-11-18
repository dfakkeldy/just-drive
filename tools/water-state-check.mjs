// Context and warm-up state checks need no browser or GPU.
import assert from 'node:assert/strict';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { WaterReflections } from '../web/src/water.ts';
globalThis.document = { getElementById: () => null };
Object.defineProperty(globalThis, 'localStorage', { value: { getItem: () => null }, configurable: true });
let serial = 0;
let open = 0, floatImages = true;
const gl = { createQuery: () => ({ id: ++serial }), isContextLost: () => false, ANY_SAMPLES_PASSED_CONSERVATIVE: 1,
  beginQuery: () => { assert.equal(open, 0, 'no query is begun inside another'); open++; }, endQuery: () => { assert.equal(open, 1, 'a query is ended once'); open--; } };
const mask = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
const renderer = {
  domElement: new EventTarget(), autoClear: true, shadowMap: { autoUpdate: true, needsUpdate: true, enabled: true },
  scissor: new THREE.Vector4(4, 6, 800, 600), scissorTest: false, draws: 0, fail: false,
  getContext: () => gl, getPixelRatio: () => 2, extensions: { has: () => floatImages },
  getScissor(out) { return out.copy(this.scissor); }, getScissorTest() { return this.scissorTest; },
  setScissor(...args) { args[0]?.isVector4 ? this.scissor.copy(args[0]) : this.scissor.set(...args); },
  setScissorTest(on) { this.scissorTest = on; },
  render(scene, cam) {
    this.draws++;
    assert.equal(scene, mask); assert.equal(cam, camera);
    assert.equal(this.autoClear, false); assert.equal(this.shadowMap.autoUpdate, false); assert.equal(this.shadowMap.needsUpdate, false);
    assert.equal(this.scissorTest, true); assert.deepEqual(this.scissor.toArray(), [0, 0, 0.5, 0.5]);
    if (this.fail) { this.fail = false; throw new Error('draw failed'); }
  },
};
const terrain = { manifest: { village: [0, 0] }, uniforms: { tCover: { value: new THREE.Texture() } }, waterMask: () => mask };
const water = new WaterReflections(renderer, new THREE.Scene(), new THREE.Mesh(), -0.2, new Set(), terrain, null, '1');
const state = () => ({ clear: renderer.autoClear, shadow: { ...renderer.shadowMap }, scissor: renderer.scissor.toArray(), test: renderer.scissorTest });
water.seaVisibility.visible = true;
const before = state();
water.afterRender(camera);
assert.equal(renderer.draws, 1); assert.equal(water.maskWarm, true); assert.deepEqual(state(), before);
water.afterRender(camera);
assert.equal(renderer.draws, 1, 'a warm visibility program needs no second warm draw');
console.log('PASS one physical pixel warms the visibility program once and restores main state.');
water.maskWarm = false; renderer.fail = true;
assert.throws(() => water.afterRender(camera), /draw failed/);
assert.equal(water.maskWarm, false); assert.deepEqual(state(), before);
water.afterRender(camera);
assert.equal(water.maskWarm, true); assert.deepEqual(state(), before);
console.log('PASS failed warm draw restores state and can retry.');
const oldSea = water.seaVisibility.query, oldLand = water.landVisibility.query;
water.seaVisibility.pending = water.landVisibility.pending = true;
water.valid = true; water.uniforms.reflectionOn.value = 1;
renderer.domElement.dispatchEvent(new Event('webglcontextlost'));
assert.equal(water.valid, false); assert.equal(water.maskWarm, false); assert.equal(water.uniforms.reflectionOn.value, 0);
assert.equal(water.seaVisibility.query, null); assert.equal(water.landVisibility.query, null);
renderer.domElement.dispatchEvent(new Event('webglcontextrestored'));
assert.notEqual(water.seaVisibility.query, oldSea); assert.notEqual(water.landVisibility.query, oldLand);
for (const query of [water.seaVisibility, water.landVisibility]) {
  assert.equal(query.pending, false); assert.equal(query.active, false); assert.equal(query.visible, false);
}
assert.equal(water.valid, false); assert.equal(water.uniforms.reflectionOn.value, 0);
console.log('PASS restored contexts get new empty queries and cannot sample the old mirror.');
// A sea draw that throws never reaches the callback that ends its query. settle() ends it; the next frame can begin one.
water.seaVisibility.pending = false;
water.sea.onBeforeRender();
assert.equal(open, 1); assert.equal(water.seaVisibility.active, true);
water.settle();
assert.equal(open, 0); assert.equal(water.seaVisibility.active, false); assert.equal(water.seaVisibility.pending, true);
water.settle();
assert.equal(open, 0, 'settle with nothing open does nothing');
water.seaVisibility.pending = false;
water.sea.onBeforeRender(); water.sea.onAfterRender(); water.settle();
assert.equal(open, 0, 'a draw that ended its own query is not ended twice');
console.log('PASS a failed sea draw leaves no open query.');
// A graphics chip that cannot draw into a half-float image gets an eight-bit mirror.
assert.equal(water.target.texture.type, THREE.HalfFloatType);
floatImages = false;
const plain = new WaterReflections(renderer, new THREE.Scene(), new THREE.Mesh(), -0.2, new Set(), terrain, null, '1');
assert.equal(plain.target.texture.type, THREE.UnsignedByteType);
console.log('PASS the mirror image is half-float where the chip can draw into one, eight-bit where it cannot.');
