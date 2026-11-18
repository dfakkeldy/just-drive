// Which mail car did this page build, and where is its driver's glass? Both are read from the running game in a
// way that fits both bodies: the Blender-built car (the default, a model file) and the code car (?car=code, and
// the fallback when the model file fails).
//
// A browser check that tests the car says which body it expects. Without that, a page that silently fell back
// to the code car would pass a check that was meant for the default car: the fallback must fail such a check.
import assert from 'node:assert/strict';

/** Page expression: 'blender', 'code', or 'other: <root name>' for another ride; null before there is a vehicle. */
export const MAIL_CAR_BODY = `(()=>{const c=window.mmm?.vehicle?.car;if(!c?.root)return null;
  return c.root.name==='car_root'?'blender':c.root.name.startsWith('Mabou mail carrier')?'code':'other: '+c.root.name;})()`;

/** Fails unless the page built the body that the check expects. `read` evaluates an expression in the page. */
export async function assertMailCar(read, want = 'blender', label = 'this page') {
  const body = await read(MAIL_CAR_BODY);
  assert.equal(body, want, `${label}: expected the ${want === 'blender' ? 'Blender mail car (the default)' : 'code car (?car=code)'}, and the page built: ${body}. A fallback to the code car is a failed check here, not a pass.`);
}

// The driver's glass, measured in the car's own space (not by how one rig stores it: the model car's meshes keep
// a decode offset in their position). `now` is the state found; `up` and `down` are the glass put up and down
// with the rig's own setWindowDown, in the same instant, and then put back as it was found.
const DRIVER_GLASS = `(()=>{const c=mmm.vehicle.car,w=c.driverWindow;w.geometry.computeBoundingBox();const b=w.geometry.boundingBox;
  const at=()=>{c.root.updateMatrixWorld(true);return {top:c.root.worldToLocal(b.max.clone().applyMatrix4(w.matrixWorld)).y,
    x:c.root.worldToLocal(b.getCenter(b.max.clone()).applyMatrix4(w.matrixWorld)).x,visible:w.visible};};
  const now=at();c.setWindowDown(false);const up=at();c.setWindowDown(true);const down=at();c.setWindowDown(!now.visible);return {now,up,down};})()`;

/** The glass is in the right-hand door, and it drops by about half a metre from its own closed place. */
async function glass(read, label) {
  const g = await read(DRIVER_GLASS), text = `${label}: ${JSON.stringify(g)}`;
  assert.ok(g.now.x > 0 && g.up.x > 0, 'the driver\'s glass is on the right: ' + text);
  assert.ok(g.up.visible && !g.down.visible && g.up.top - g.down.top > .45 && g.up.top - g.down.top < .6, 'the glass drops about half a metre from its closed place, and hides: ' + text);
  return { ...g, text };
}
/** The glass is down: at its own lowered place (not merely somewhere low), and hidden. */
export async function assertGlassDown(read, label = 'driver glass') {
  const g = await glass(read, label);
  assert.ok(!g.now.visible && Math.abs(g.now.top - g.down.top) < .005, 'right glass lowered into door: ' + g.text);
  return g;
}
/** The glass is up: at its own closed place, and shown. */
export async function assertGlassUp(read, label = 'driver glass') {
  const g = await glass(read, label);
  assert.ok(g.now.visible && Math.abs(g.now.top - g.up.top) < .005, 'right glass back up in its closed place: ' + g.text);
  return g;
}
