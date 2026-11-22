// Node only: compare production row adapters with verbatim frozen constructor lines.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from '../web/node_modules/esbuild/lib/main.js';

// Frozen from main 59af225af7fa7226c94dc75b6d1c3cf5aa74e33a, web/src/shadows.ts lines 45-47, 49-62.
const oldShadows = {
  "initial": "    const saved = (() => { try { return localStorage.getItem('mmm.shadows'); } catch { return null; } })();\n    this.enabled = forced || saved !== '0';\n    this.chosen = forced || saved !== null;",
  "row": "    const panel = document.getElementById('settings');\n    if (panel) {\n      const label = document.createElement('label');\n      label.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:12px';\n      const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: this.on });\n      box.style.width = 'auto';\n      this.box = box;\n      box.addEventListener('change', () => {\n        this.enabled = box.checked; this.chosen = true;\n        try { localStorage.setItem('mmm.shadows', box.checked ? '1' : '0'); } catch { /* private mode */ }\n      });\n      label.append(box, 'Shadows');\n      panel.insertBefore(label, document.getElementById('startOver'));\n    }"
};

// Frozen from main 59af225af7fa7226c94dc75b6d1c3cf5aa74e33a, web/src/water.ts lines 75-76, 87-99.
const oldWater = {
  "initial": "    const saved = (() => { try { return localStorage.getItem('mmm.reflections'); } catch { return null; } })();\n    this.on = (asked ?? saved) !== '0';",
  "row": "    const panel = document.getElementById('settings');\n    if (panel) {\n      const label = document.createElement('label');\n      label.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:12px';\n      const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: this.on });\n      box.style.width = 'auto';\n      box.addEventListener('change', () => {\n        this.on = box.checked; this.invalidate();\n        try { localStorage.setItem('mmm.reflections', this.on ? '1' : '0'); } catch { /* private mode */ }\n      });\n      label.append(box, 'Water reflections');\n      panel.insertBefore(label, document.getElementById('startOver'));\n    }"
};

// Frozen from main 59af225af7fa7226c94dc75b6d1c3cf5aa74e33a, web/src/grass.ts lines 160-161, 174-187.
const oldGrass = {
  "initial": "    const saved = (() => { try { return localStorage.getItem('mmm.grass'); } catch { return null; } })();\n    this.on = (asked ?? saved) !== '0';",
  "row": "    const panel = document.getElementById('settings');\n    if (panel) {\n      const label = document.createElement('label');\n      label.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:12px';\n      const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: this.on });\n      box.style.width = 'auto';\n      box.addEventListener('change', () => {\n        this.enabled = box.checked;\n        try { localStorage.setItem('mmm.grass', box.checked ? '1' : '0'); } catch { /* private mode */ }\n      });\n      label.append(box, 'Grass');\n      panel.insertBefore(label, document.getElementById('startOver'));\n      this.box = box;\n    }"
};

const read = name => readFileSync(new URL('../web/src/' + name + '.ts', import.meta.url), 'utf8');
const source = read('settings'), main = read('main');
const definitions = [
  ['shadows', 'shadows', oldShadows], ['water', 'reflections', oldWater], ['grass', 'grass', oldGrass],
].map(([file, key, old]) => {
  const current = read(file);
  const initial = current.match(/    const saved = .*\n    this\.(?:enabled|on) = .*;(?:\n    this\.chosen = .*;)?/)[0];
  const row = current.match(/^    (?:if \(settings\) )?(?:this\.box = )?toggle\(.*$/m)?.[0];
  assert.ok(row, file + ': settings row exists');
  const compile = ({ initial, row }) => new Function('document', 'localStorage', 'forced', 'asked', 'toggle', 'location', 'settings = true', initial + '\n' + row);
  return { file, key, old: compile(old), current: compile({ initial, row }) };
});

// A small DOM with reflected attributes in insertion order, text nodes, and real insertBefore semantics.
function environment(s, old) {
  const callbacks = [], writes = [], reads = [], effects = [], events = [];
  class Element {
    attributes = new Map(); children = []; listeners = {}; checked = false;
    constructor(tag) {
      this.tag = tag;
      const style = new Map();
      this.style = new Proxy({}, { set: (_, key, value) => {
        if (key === 'cssText') { style.clear(); for (const part of value.split(';')) {
          const colon = part.indexOf(':'); if (colon > 0) style.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
        } } else style.set(key, value);
        this.setAttribute('style', [...style].map(([k, v]) => `${k}: ${v};`).join(' ')); return true;
      } });
    }
    setAttribute(key, value) { this.attributes.set(key, String(value)); }
    set id(value) { this.setAttribute('id', value); }
    get id() { return this.attributes.get('id'); }
    set type(value) { this.setAttribute('type', value); }
    get type() { return this.attributes.get('type'); }
    get hidden() { return this.attributes.has('hidden'); }
    set hidden(value) { if (value) this.setAttribute('hidden', ''); else this.attributes.delete('hidden'); }
    append(...nodes) { this.children.push(...nodes); }
    insertBefore(node, before) {
      const index = before === null ? this.children.length : this.children.indexOf(before);
      assert.ok(index >= 0, 'reference node belongs to panel'); this.children.splice(index, 0, node);
    }
    insertAdjacentElement(position, node) {
      assert.equal(position, 'afterend');
      const index = panel.children.indexOf(this); assert.ok(index >= 0); panel.children.splice(index + 1, 0, node);
    }
    addEventListener(type, callback, options) {
      // The old code passed no options. `once` or `passive` would change what a second click does.
      assert.equal(options, undefined, 'listener options');
      this.listeners[type] = old && type === 'change' ? () => { callbacks.push(this.checked); callback(); } : callback;
    }
    click() { assert.equal(this.type, 'checkbox'); this.checked = !this.checked; this.listeners.change?.(); }
  }
  const panel = new Element('section'); panel.id = 'settings';
  const previous = new Element('div'); previous.id = 'earlier'; panel.append(previous);
  const anchor = new Element('button'); anchor.id = 'startOver';
  if (s.panel === 'anchor') panel.append(anchor);
  const after = new Element('div'); after.id = 'later'; panel.append(after);
  const document = {
    createElement: tag => new Element(tag),
    getElementById: id => id === 'settings' ? s.panel === 'missing' ? null : panel : id === 'startOver' && s.panel === 'anchor' ? anchor : null,
  };
  const localStorage = {
    getItem(key) { reads.push(key); if (s.readThrows) throw Error('read blocked'); return s.stored; },
    setItem(key, value) { writes.push([key, value]); events.push(['write', key, value]); if (s.writeThrows) throw Error('write blocked'); },
  };
  const state = {
    on: true, chosen: false, box: null, invalidations: 0,
    set enabled(on) { this.on = on; effects.push(['enabled', on]); events.push(['enabled', on]); },
    invalidate() { this.invalidations++; events.push(['invalidate']); },
  };
  const serialize = element => typeof element === 'string' ? { text: element } : {
    tag: element.tag, attributes: [...element.attributes], children: element.children.map(serialize),
  };
  const boxes = () => panel.children.filter(row => row.tag === 'label').map(row => row.children[0]);
  const snapshot = () => ({
    dom: s.panel === 'missing' ? null : serialize(panel), checked: boxes().map(box => box.checked),
    hidden: boxes().map(box => box.hidden), boxReference: state.box === null ? null : boxes().indexOf(state.box),
    on: state.on, chosen: state.chosen, invalidations: state.invalidations,
    callbacks: [...callbacks], writes: [...writes], reads: [...reads], effects: [...effects], events: [...events],
  });
  const address = new URL(s.brand === 'just' ? 'https://drive.example.test/mabou/' : 'https://example.test/');
  if (s.phone) { address.searchParams.set('q', 'low'); address.searchParams.set('touch', '1'); }
  if (s.era === '1884') address.searchParams.set('era', '1884');
  if (s.override !== null) for (const key of ['shadows', 'reflections', 'grass']) address.searchParams.set(key, s.override);
  return { document, localStorage, state, callbacks, boxes, snapshot, location: address };
}

function helper(text) {
  const code = transformSync(text, { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
  return new Function('document', 'localStorage', 'module', 'exports', code + '\nreturn module.exports.toggle;');
}
function build(d, s, factory, old, gated) {
  const env = environment(s, old), module = { exports: {} };
  const toggle = factory(env.document, env.localStorage, module, module.exports);
  const observedToggle = (key, text, initial, callback) => toggle(key, text, initial, on => {
    env.callbacks.push(on); callback(on);
  });
  // The constructor rows also run directly in phone fixtures; the gated fixtures prove that main omits them.
  if (!gated || (!s.phone && (d.key !== 'shadows' || s.override !== '0'))) {
    const asked = env.location.searchParams.get(d.key);
    (old ? d.old : d.current).call(env.state, env.document, env.localStorage, asked === '1', asked, observedToggle, env.location);
  }
  return env;
}
function compare(d, s, factory, gated) {
  const old = build(d, s, factory, true, gated), current = build(d, s, factory, false, gated);
  const context = `${d.key} ${JSON.stringify(s)} gated=${gated}`;
  assert.deepEqual(current.snapshot(), old.snapshot(), 'first build: ' + context);
  // A checkbox click emits change after toggling checked. Exercise both values, then repeat on the same first-built row.
  for (let click = 0; click < 3; click++) {
    for (const env of [old, current]) for (const box of env.boxes()) box.click();
    assert.deepEqual(current.snapshot(), old.snapshot(), `click ${click + 1}: ${context}`);
  }
}

// Pin main creation order and LOW/quarry/URL gates, including the optional cemetery and stockpile exclusion. A grass
// chunk that does not load shows the Retry screen. Boot skips both the download and the grass draw on LOW or with
// winter cover. A normal desktop start still begins the download early.
assert.match(main, /\nconst grassChunk = LOW \|\| winter \? null : early\(import\('\.\/grass'\)\);/);
assert.match(main, /\.\.\.\(LOW \? \{ split: AREA\.quarry \? 1 : 1\.15, low: true, lazyRange: 600 \} : \{\}\), shadows: !LOW && params\.get\('shadows'\) !== '0' && !nightLook \}\);/);
assert.match(main, /const sunShadows = terrain\.shadows \? new SunShadows\(renderer, scene, sunLight, sunDir, params\.get\('shadows'\) === '1'\) : null;/);
assert.match(main, /const grass = !grassChunk \? null : new \(await grassChunk\.take\(\)\.catch\(partFailed\)\)\.Grass\(terrain, params\.get\('grass'\), grassExcludes\);/);
assert.match(main, /const waterReflections = LOW \? null : new WaterReflections\(/);
const order = [...main.matchAll(/const (sunShadows|grass|waterReflections) = /g)].map(match => match[1]);
assert.deepEqual(order, ['sunShadows', 'grass', 'waterReflections']);
const factory = helper(source);
let cases = 0;
for (const d of definitions) for (const stored of [null, '1', '0', 'other'])
for (const override of [null, '1', '0']) for (const readThrows of [false, true]) for (const writeThrows of [false, true])
for (const phone of [false, true]) for (const brand of ['mail', 'just']) for (const era of ['today', '1884'])
for (const panel of ['anchor', 'no-anchor', 'missing']) {
  const s = { stored, override, readThrows, writeThrows, phone, brand, era, panel };
  for (const gated of [false, true]) { compare(d, s, factory, gated); cases++; }
}
console.log(`PASS ${cases} old/new cases: first build, three clicks, ordered DOM, state, callbacks, read/write failures, phone/host/era and missing targets`);

// Check real row order together, with rows on both sides of the insertion anchor.
for (const panel of ['anchor', 'no-anchor']) {
  const s = { stored: null, override: null, readThrows: false, writeThrows: false, phone: false, panel };
  const results = [];
  for (const old of [true, false]) {
    const env = environment(s, old), module = { exports: {} }, toggle = factory(env.document, env.localStorage, module, module.exports);
    for (const file of ['shadows', 'grass', 'water']) {
      const d = definitions.find(d => d.file === file);
      (old ? d.old : d.current).call(env.state, env.document, env.localStorage, false, null, toggle);
    }
    results.push(env.snapshot().dom);
  }
  assert.deepEqual(results[1], results[0], 'combined constructor order: ' + panel);
}
console.log('PASS two combined-panel insertion orders; LOW and winter grass gates');

// The still view can use the same shadow map without offering a new choice in Settings.
const preview = environment({ stored: '0', panel: 'anchor' }, false);
const shadows = definitions.find(d => d.key === 'shadows');
shadows.current.call(preview.state, preview.document, preview.localStorage, false, null,
  () => assert.fail('the shadow preview added a Settings row'), preview.location, false);
assert.equal(preview.state.on, false, 'the shadow preview reads the saved state');
assert.deepEqual(preview.boxes(), []);
console.log('PASS shadow preview keeps the saved choice and adds no Settings row');
if (process.argv.includes('--mutations')) {
  const mutations = [
    ['wrong storage prefix', '`mmm.${key}`', '`wrong.${key}`'],
    ['off stored as false', "box.checked ? '1' : '0'", "box.checked ? '1' : 'false'"],
    ['listener fires once only', "  });\n  label.append(box, text);", "  }, { once: true });\n  label.append(box, text);"],
    // The first-created row must call its change callback, without requiring a rebuild.
    ['first-build onChange omitted', 'onChange(box.checked);', 'void box.checked;'],
    ['insert after startOver', "panel.insertBefore(label, document.getElementById('startOver'));", "const before = document.getElementById('startOver'); if (before) before.insertAdjacentElement('afterend', label); else panel.insertBefore(label, null);"],
  ];
  for (const [name, from, to] of mutations) {
    assert.equal(source.split(from).length, 2, name + ': unique mutation site');
    const mutant = helper(source.replace(from, to));
    for (const d of definitions) {
      assert.throws(() => compare(d, { stored: null, override: null, readThrows: false, writeThrows: false,
        phone: false, brand: 'mail', era: 'today', panel: 'anchor' }, mutant, false),
      { name: 'AssertionError' }, name + ' rejected for ' + d.key);
    }
    console.log('KILLED ' + name + ' (all three settings)');
  }
}
