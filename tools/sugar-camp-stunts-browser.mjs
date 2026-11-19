// The Sugar Camp stunt park's ways in, on the real page from the normal West Bay start.
// Views are named <case>-<line>-<rig>:
//   click-easy-car, click-hard-truck ...: click=<place id> picks the Places start; the vehicle lands on that run-up.
//     A truck view must still be the truck with its loaded trailer attached.
//   cold-easy-car, cold-easy-truck ...: a typed driveAt start inside the park is ignored; the vehicle stays outside the park.
import { open, exitCheck } from './cdp.mjs';
const [, ...urls] = process.argv.slice(2);
const V = [642342, 5063327];
const want = { easy: [632309, 5064233], hard: [632344, 5064608] };
const PARK = [632200, 5064120, 632480, 5064760];   // east,north box around the whole park and its margins
let bad = 0;
const fail = (name, why) => { console.log(name, 'FAIL', why); bad++; };
for (const url of urls) {
  const params = new URL(url).searchParams, name = params.get('name'), [kind, line, rig] = name.split('-');
  const page = await open(url);
  const click = params.get('click');
  if (click) {
    await page.read(`document.querySelector('[data-place="${click}"]').click()`);
    for (let i = 0; i < 120; i++) { await new Promise(r => setTimeout(r, 1000)); if (await page.read('document.title') === 'settled') break; }
    await new Promise(r => setTimeout(r, 4000));
  }
  const s = await page.read('(() => { const v = mmm.vehicle, t = mmm.towing; return { x: v.x, z: v.z, id: mmm.vehicleId, attached: t ? t.attached : null, loaded: t ? t.loaded : null }; })()');
  const e = s.x + V[0], n = V[1] - s.z;
  console.log(name, 'vehicle', s.id, 'at', e.toFixed(1), n.toFixed(1), 'trailer attached', s.attached, 'loaded', s.loaded);
  if (rig === 'truck' && !(s.id === 'truck' && s.attached === true && s.loaded === true)) fail(name, 'not the truck with its loaded trailer attached');
  if (kind === 'click') { const d = Math.hypot(e - want[line][0], n - want[line][1]); if (d >= 25) fail(name, `${d.toFixed(1)} m from the ${line} start`); }
  if (kind === 'cold' && e > PARK[0] && e < PARK[2] && n > PARK[1] && n < PARK[3]) fail(name, 'a typed start inside the park was used');
  if (page.errors.length) fail(name, 'page errors: ' + page.errors.join(' | '));
  await page.close();
}
exitCheck(bad ? 1 : 0);
