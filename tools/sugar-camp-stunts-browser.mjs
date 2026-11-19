// The two Places starts of the Sugar Camp stunt park, chosen from the normal West Bay start, put the vehicle
// (car, or the truck with its loaded trailer) on its run-up. Views: name easy-* or hard-*, and click=<place id>.
// A cold driveAt link into the park is refused and falls back to the area start, as at the works-yard park=test.
import { open } from './cdp.mjs';
const [, ...urls] = process.argv.slice(2);
const V = [642342, 5063327];
const want = { easy: [632309, 5064233], hard: [632344, 5064608] };
let bad = 0;
for (const url of urls) {
  const name = new URL(url).searchParams.get('name'), page = await open(url);
  const click = new URL(url).searchParams.get('click');
  if (click) {
    await page.read(`document.querySelector('[data-place="${click}"]').click()`);
    for (let i = 0; i < 120; i++) { await new Promise(r => setTimeout(r, 1000)); if (await page.read('document.title') === 'settled') break; }
    await new Promise(r => setTimeout(r, 4000));
  }
  const p = await page.read('(() => { const v = mmm.vehicle; return { x: v.x, z: v.z }; })()');
  const e = p.x + V[0], n = V[1] - p.z, [we, wn] = want[name.split('-')[0]], d = Math.hypot(e - we, n - wn);
  console.log(name, 'vehicle at', e.toFixed(1), n.toFixed(1), 'distance from start', d.toFixed(1), 'm', d < 25 ? 'OK' : 'REFUSED');
  if (d >= 25) bad++;
  await page.close();
}
process.exit(bad ? 1 : 0);
