// The "Date, time and weather" section of the settings panel, in a real page at two desktop and two phone sizes:
// shown values, place in the panel, reach by scrolling, touch sizes, no overlap with the other sections (the phone
// race panel is one of them), driving keys kept out, and Apply: a refused empty date, then a reload on player keys only.
// Pictures go to $MMM_CHECK_OUT/evidence/weather-settings-browser/, which check-all keeps after a pass.
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { cdp, cdpFetch, sleep } from './cdp.mjs';
const port = process.env.CDP_PORT, base = new URL(process.argv[3]).origin;
const out = process.env.MMM_CHECK_OUT ? join(process.env.MMM_CHECK_OUT, 'evidence', 'weather-settings-browser')
  : new URL('../data/work/weather-settings-1171/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

// In the page: the section's state and geometry, with the panel open.
const measure = () => {
  const panel = document.getElementById('settings'), section = document.getElementById('weatherSet'), faults = [];
  if (!section) return { faults: ['no weather section'] };
  const controls = [...section.querySelectorAll('summary,input,select,button')];
  const phone = document.body.classList.contains('tcOn');
  const drawn = section.open ? controls.filter(e => !e.closest('[hidden]')) : controls.slice(0, 1);   // closed: only the summary is drawn
  for (const control of drawn) {
    control.scrollIntoView({ block: 'center' });
    const r = control.getBoundingClientRect(), name = control.getAttribute('aria-label') ?? control.textContent;
    if (r.width <= 0 || r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight) faults.push(`outside the view: ${name} ${[r.left, r.top, r.right, r.bottom].map(Math.round)}`);
    const top = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
    if (!top || !control.contains(top)) faults.push(`covered: ${name} by ${top?.id || top?.tagName}`);
    if (r.height < (phone ? 56 : 32) - 0.5) faults.push(`small target: ${name} ${Math.round(r.height)} px`);
  }
  // The section stands in the panel's column: it may cover no other part of the panel (the phone race panel is one).
  panel.scrollTop = 0;
  const boxes = [...panel.children].filter(e => e !== section && e.getClientRects().length)
    .map(e => [e.id || e.tagName + ':' + (e.textContent ?? '').trim().slice(0, 24), e.getBoundingClientRect()]);
  const a = section.getBoundingClientRect();
  for (const [other, b] of boxes)
    if (Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1 && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1) faults.push(`overlap: weather section and ${other}`);
  const p = panel.getBoundingClientRect();
  if (p.left < 0 || p.right > innerWidth || p.top < 0 || p.bottom > innerHeight) faults.push(`panel outside the view: ${[p.left, p.top, p.right, p.bottom].map(Math.round)}`);
  if (section.nextElementSibling !== panel.querySelector('label[for="exag"]')) faults.push('the section is not directly above Hill height');
  // A key typed in the section must not reach the game's window listener; the same key on the hill slider does (the probe works).
  const reaches = target => { let seen = false; const listener = () => { seen = true; }; addEventListener('keydown', listener);
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', bubbles: true })); removeEventListener('keydown', listener); return seen; };
  for (const control of controls) if (reaches(control)) faults.push(`driving key leaks from ${control.getAttribute('aria-label') ?? control.textContent}`);
  if (!reaches(document.getElementById('exag'))) faults.push('key probe is blind');
  section.querySelector('summary').scrollIntoView({ block: 'start' });
  return { faults, drawn: drawn.length, open: section.open, phone, date: section.querySelector('[type=date]').value, time: section.querySelector('[type=time]').value,
    mood: section.querySelector('[aria-label="Weather"]').value,
    moods: [...section.querySelectorAll('[aria-label="Weather"] option')].map(o => o.textContent),
    season: section.querySelector('[aria-label="Season"]').value,
    rain: section.querySelector('[aria-label="Rain intensity"]').value, sections: boxes.map(b => b[0]) };
};

for (const [name, width, height, touch] of [['desktop', 1400, 950, false], ['desktop-short', 1280, 720, false], ['phone', 393, 852, true], ['phone-wide', 844, 390, true]]) {
  const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const c = await cdp(tab.webSocketDebuggerUrl);
  const read = async expression => {
    const r = await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result.exceptionDetails) throw Error(JSON.stringify(r.result.exceptionDetails));
    return r.result.result.value;
  };
  const settle = async (what, wanted = 'true') => {
    for (let i = 0; i < 240; i++) {
      await sleep(500);
      try { if (await read(`document.title.startsWith('settled') && !!document.getElementById('weatherSet') && (${wanted})`)) return; } catch { /* between two pages */ }
    }
    assert.fail(`${name}: ${what} did not settle`);
  };
  const shot = async file => { await sleep(300); const s = await c.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(out, `${name}-${file}.png`), Buffer.from(s.result.data, 'base64')); };
  try {
    await c.send('Page.enable');
    await c.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: touch });
    const query = `hud=1&test=1${touch ? '&touch=1' : ''}`;
    // Default page: the section is there, closed, with the game's own date and clock.
    await c.send('Page.navigate', { url: `${base}/?${query}` });
    await settle('default page');
    await read(`document.getElementById('gear').click()`);
    const closed = await read(`(${measure})()`);
    assert.deepEqual(closed.faults, [], `${name} closed: ${closed.faults.join('; ')}`);
    assert.deepEqual([closed.open, closed.drawn, closed.date, closed.time, closed.mood], [false, 1, '2026-10-10', '16:45', 'clear'], `${name} default values`);
    assert.deepEqual(closed.moods, ['Clear', 'Overcast', 'Fog / haze', 'Rain', 'Snow']);
    assert.equal(closed.season, 'date');
    assert.ok(await read('!mmm.precipitationMesh && !mmm.terrain.uniforms.winterCover'), 'ordinary start keeps weather effects off');
    await shot('closed');

    await c.send('Page.navigate', { url: `${base}/?${query}&playerDate=2026-12-21&playerTime=12:00&weather=overcast&season=off` });
    await settle('chosen page');
    await read(`document.getElementById('gear').click()`);
    const shown = await read(`(${measure})()`);
    assert.deepEqual(shown.faults, [], `${name} open: ${shown.faults.join('; ')}`);
    assert.deepEqual([shown.open, shown.drawn, shown.date, shown.time, shown.mood], [true, 6, '2026-12-21', '12:00', 'overcast'], `${name} chosen values`);
    assert.equal(shown.season, 'off');
    await shot('open');

    // An empty date is refused by the form: no reload.
    const before = await read('location.href');
    const submitted = await read(`(()=>{const s=document.getElementById('weatherSet'),form=s.querySelector('form');let fired=false;form.addEventListener('submit',()=>{fired=true;},{once:true,capture:true});window.mmmWeatherStay=true;s.querySelector('[type=date]').value='';form.requestSubmit();return fired;})()`);
    assert.equal(submitted, false, `${name}: an empty date must not submit`);
    await sleep(800);
    assert.deepEqual([await read('location.href'), await read('window.mmmWeatherStay === true')], [before, true], `${name}: an empty date must not reload`);
    // Apply: the page loads again on the three player keys, with no tool or light-study clock beside them.
    await read(`(()=>{const s=document.getElementById('weatherSet');s.querySelector('[type=date]').value='2026-06-21';s.querySelector('[type=time]').value='18:30';s.querySelector('[aria-label=Weather]').value='fog';s.querySelector('[aria-label=Season]').value='date';s.querySelector('form').requestSubmit();})()`);
    await settle('applied page', `location.search.includes('weather=fog')`);
    const after = new URL(await read('location.href')).searchParams;
    assert.deepEqual([after.get('playerDate'), after.get('playerTime'), after.get('weather')], ['2026-06-21', '18:30', 'fog'], `${name} applied address`);
    const added = [...after.keys()].filter(key => !new URLSearchParams(query).has(key)).sort();
    assert.deepEqual(added, ['playerDate', 'playerTime', 'weather'], `${name}: Apply adds player keys only`);
    await read(`document.getElementById('gear').click()`);
    const applied = await read(`(${measure})()`);
    assert.deepEqual(applied.faults, [], `${name} applied: ${applied.faults.join('; ')}`);
    assert.deepEqual([applied.open, applied.drawn, applied.date, applied.time, applied.mood], [true, 6, '2026-06-21', '18:30', 'fog'], `${name} applied values`);
    if (touch) {
      await read(`(()=>{const w=document.querySelector('[aria-label=Weather]');w.value='rain';w.dispatchEvent(new Event('change'));})()`);
      const raining = await read(`(${measure})()`);
      assert.deepEqual(raining.faults, [], name + ' rain control');
      assert.deepEqual([raining.drawn, raining.mood, raining.rain], [7, 'rain', 'steady']);
      await read(`(()=>{document.querySelector('[aria-label="Rain intensity"]').value='downpour';document.querySelector('[aria-label=Season]').value='winter';document.querySelector('#weatherSet form').requestSubmit();})()`);
      await settle('downpour and winter', `location.search.includes('rain=downpour')`);
      assert.deepEqual(await read('[mmm.terrain.uniforms.rainWet.value,mmm.terrain.uniforms.winterCover.value,!!mmm.precipitationMesh]'), [1, 1, true]);
    }
    if (name === 'desktop') {
      await c.send('Page.navigate', { url: `${base}/?${query}&era=1884&weather=rain&rain=downpour&season=winter` });
      await settle('1884 with modern weather keys', "location.search.includes('era=1884')");
      assert.deepEqual(await read(`(()=>{
        const section = document.getElementById('weatherSet');
        const mood = section.querySelector('[aria-label=Weather]');
        return [section.open, mood.value, [...mood.options].map(o => o.value),
          section.querySelector('[aria-label=Season]').closest('label').hidden];
      })()`), [false, 'clear', ['clear', 'overcast', 'fog'], true], 'hidden weather choices leave the 1884 section closed');
      await read(`(()=>{
        const section = document.getElementById('weatherSet');
        section.open = true;
        section.querySelector('form').requestSubmit();
      })()`);
      await settle('1884 Apply', "location.search.includes('weather=clear')");
      const legacy = new URL(await read('location.href')).searchParams;
      assert.equal(legacy.get('era'), '1884');
      assert.equal(legacy.has('season'), false, '1884 Apply removes the hidden season');
      assert.equal(legacy.has('rain'), false, '1884 Apply removes the hidden rain intensity');
    }
    console.log(`${name} ${width}x${height}: ${shown.sections.length} other panel parts clear; values, reach, ${shown.phone ? '56 px targets, ' : ''}key isolation, refused empty date and Apply round trip PASS`);
  } finally { c.close(); await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`); }
}
