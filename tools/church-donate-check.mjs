// Pure Node check: the church donation link exists only at the River Denys Mountain church (stopped door prompt and the
// walk's last caption), uses only the official Diocese of Antigonish form URL with noopener, carries no personal/contact
// data or tracking, and is reachable by gamepad (directly in the walk HUD and via the pause screen).
// Run via: node tools/run-node-check.mjs tools/church-donate-check.mjs
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { CHURCH_DONATE_LABEL, CHURCH_DONATE_LINK, CHURCH_DONATE_TEXT, CHURCH_DONATE_URL, ChurchVisit } from '../web/src/church-room-rules.ts';
import { churchDoorPosition, churchRail } from '../web/src/church-room.ts';
import { ChurchSite } from '../web/src/church-site.ts';
import { YardSite } from '../web/src/yard-site.ts';
import { DepotSite } from '../web/src/depot-site.ts';
import { BUTTON } from '../web/src/gamepad-rules.ts';

const EXPECTED_URL = 'https://fs26.formsite.com/DioceseofAntigonish/jdqh7w8ymr/index.html';
const EXPECTED_TEXT = "Support this church: donate through the Diocese of Antigonish. Choose parish St. Mary of the Angels, Glendale, and write 'St. Margaret of Scotland, River Denys Mountain' in the comments.";

// 1. Exact URL and text, no query/tracking parameters.
assert.equal(CHURCH_DONATE_URL, EXPECTED_URL);
assert.equal(CHURCH_DONATE_LABEL, 'Support this church');
assert.equal(CHURCH_DONATE_TEXT, EXPECTED_TEXT);
assert.equal(CHURCH_DONATE_LINK.url, EXPECTED_URL);
assert.equal(`${CHURCH_DONATE_LINK.label}${CHURCH_DONATE_LINK.note}`, EXPECTED_TEXT);
const parsed = new URL(CHURCH_DONATE_URL);
assert.equal(parsed.protocol, 'https:');
assert.equal(parsed.search, '');
assert.equal(parsed.hash, '');

// 2. Source audit: URL appears only in church-room-rules.ts; no unofficial donation URLs, private contacts, or third-party scripts.
const root = resolve(process.env.MMM_ROOT ?? resolve(import.meta.dirname, '..'));
const walkFiles = dir => {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
};
const webSrcFiles = walkFiles(join(root, 'web/src')).filter(f => /\.[cm]?[jt]s$/.test(f));
const formsiteHolders = [];
const forbidden = [
  /canadahelps\.org/i,
  /gofundme\.com/i,
  /paypal\.com\/donate/i,
  /\bhtns\.ca\b/i,
  /keela\.co/i,
  /wixsite\.com/i,
  /5churches@/i,
  /625-2345|625-3441|302-1734|423-4807/,
  /3080\s+River\s+Denys/i,
  /17\s+Church\s+St/i,
  /106880107RR/i,
  /MacIsaac/i,
];
for (const file of webSrcFiles) {
  const text = readFileSync(file, 'utf8');
  const rel = file.slice(root.length + 1);
  if (/formsite\.com/i.test(text)) {
    formsiteHolders.push(rel);
    const urls = text.match(/https?:\/\/[^\s'"`<>]+formsite\.com[^\s'"`<>]*/gi) ?? [];
    assert.deepEqual(urls, [EXPECTED_URL], `${rel} must contain only the exact Diocese form URL`);
  }
  for (const re of forbidden) assert.doesNotMatch(text, re, `${rel} must not contain ${re}`);
}
assert.deepEqual(formsiteHolders, ['web/src/church-room-rules.ts'], 'Diocese form URL lives only in web/src/church-room-rules.ts');
const indexHtml = readFileSync(join(root, 'web/index.html'), 'utf8');
assert.doesNotMatch(indexHtml, /<script[^>]+src=["']https?:/i, 'no third-party scripts in web/index.html');
const mainTs = readFileSync(join(root, 'web/src/main.ts'), 'utf8');
assert.match(mainTs, /interiors\.canEnter\s*&&\s*interiors\.nearbyId\s*===\s*'church'/, 'gamepad Y door shortcut stays limited to the church');
console.log('PASS source audit: exact Diocese URL only in church-room-rules.ts; no unofficial links, contacts, names or third-party scripts.');

// 3. Minimal browser-compatible DOM stand-in to drive real Interiors, churchDoor, ChurchInterior, other doors, and createGamepad.
const pen = new Proxy({}, { get: (_, key) => key === 'createLinearGradient' || key === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}, set: () => true });
const byId = new Map();
const winListeners = new Map();
class FakeElement {
  tagName; id = ''; className = ''; hidden = false; disabled = false; textContent = ''; href = ''; target = ''; rel = '';
  parentElement = null; children = []; listeners = new Map(); width = 0; height = 0;
  style = { values: new Map(), opacity: '0', setProperty(k, v) { this.values.set(k, v); }, removeProperty(k) { this.values.delete(k); } };
  names = new Set();
  classList = {
    add: (...cs) => cs.forEach(c => this.names.add(c)),
    remove: (...cs) => cs.forEach(c => this.names.delete(c)),
    toggle: (c, force) => (force === undefined ? (this.names.has(c) ? (this.names.delete(c), false) : (this.names.add(c), true)) : force ? (this.names.add(c), true) : (this.names.delete(c), false)),
    contains: c => this.names.has(c),
  };
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); }
  addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(fn); }
  append(...nodes) {
    for (const node of nodes) {
      node.parentElement = this;
      this.children.push(node);
      if (node.id) byId.set(node.id, node);
    }
  }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) {
    for (const old of this.children) { old.parentElement = null; if (old.id && byId.get(old.id) === old) byId.delete(old.id); }
    this.children = [];
    this.append(...nodes);
  }
  contains(node) { for (let p = node; p; p = p.parentElement) if (p === this) return true; return false; }
  closest(sel) {
    for (let p = this; p; p = p.parentElement) {
      if (sel === '[hidden]' && p.hidden) return p;
    }
    return null;
  }
  getClientRects() { return this.hidden || this.closest('[hidden]') ? [] : [{ width: 100, height: 44 }]; }
  focus() { globalThis.document.activeElement = this; }
  click() { for (const fn of this.listeners.get('click') ?? []) fn({ target: this, preventDefault() {} }); }
  getContext() { return pen; }
  _all(out = []) {
    for (const c of this.children) { out.push(c); c._all(out); }
    return out;
  }
  querySelectorAll(sel) {
    const all = this._all();
    return all.filter(el => {
      if (sel.includes('a[href]') && el.tagName === 'A' && !!el.href) return true;
      if (sel.includes('button') && el.tagName === 'BUTTON') return true;
      return false;
    });
  }
  querySelector(sel) {
    if (sel.startsWith('#')) {
      const want = sel.slice(1).split('.')[0];
      const cls = sel.includes('.') ? sel.split('.')[1] : null;
      const el = byId.get(want) ?? null;
      if (!el || !this.contains(el)) return null;
      return cls ? (el.classList.contains(cls) ? el : null) : el;
    }
    return this.querySelectorAll(sel)[0] ?? null;
  }
}
globalThis.HTMLElement = FakeElement;
globalThis.HTMLDialogElement = class FakeDialog extends FakeElement {};
const docBody = new FakeElement('body');
const docHead = new FakeElement('head');
globalThis.document = {
  head: docHead,
  body: docBody,
  hidden: false,
  activeElement: null,
  createElement: tag => new FakeElement(tag),
  getElementById: id => byId.get(id) ?? null,
  querySelector: sel => docBody.querySelector(sel),
  querySelectorAll: sel => docBody.querySelectorAll(sel),
  addEventListener: () => {},
};
globalThis.addEventListener = (name, fn) => { if (!winListeners.has(name)) winListeners.set(name, []); winListeners.get(name).push(fn); };

const { Interiors, renderInteriorLink } = await import('../web/src/interiors.ts');
const { churchDoor } = await import('../web/src/interior-church.ts');
const { plantDoor } = await import('../web/src/interior-plant.ts');
const { depotDoor } = await import('../web/src/interior-depot.ts');
const { createGamepad } = await import('../web/src/gamepad.ts');

const allAnchors = () => docBody.querySelectorAll('a[href]');
const assertExactChurchLink = (anchor, box, where) => {
  assert.ok(anchor, `${where}: anchor exists`);
  assert.equal(box.hidden, false, `${where}: container visible`);
  assert.equal(anchor.href, EXPECTED_URL, `${where}: exact Diocese URL`);
  assert.equal(anchor.target, '_blank', `${where}: opens in new tab`);
  const relTokens = anchor.rel.split(/\s+/);
  assert.ok(relTokens.includes('noopener'), `${where}: rel includes noopener`);
  assert.ok(relTokens.includes('noreferrer'), `${where}: rel includes noreferrer`);
  assert.equal(anchor.textContent, 'Support this church', `${where}: exact link label`);
  const combined = box.children.map(c => c.textContent).join('');
  assert.equal(combined, EXPECTED_TEXT, `${where}: exact instruction text`);
};

const idle = { throttle: 0, steer: 0, handbrake: false };
const churchSite = new ChurchSite([630000, 5080000]);
const churchPos = churchDoorPosition(churchSite);
const yardSite = new YardSite([624271, 5103301], 'invented');
const depotSite = new DepotSite([617000, 5096000]);
const otherDoors = [
  { id: 'mine', name: 'Mabou Mines', position: { x: 500, z: 500 }, radius: 14, prompt: 'Parcel for the night shift.',
    create: () => ({ scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), result: null, readout: 'In the mine', update() {}, render() {}, leave() { this.result = { delivered: false, note: 'Out.' }; }, dispose() {} }) },
  plantDoor(yardSite),
  depotDoor(depotSite, 'default'),
];

// 4. Drive mode and mail mode: link exists ONLY parked at the church or at the walk's last caption (gallery).
for (const mail of [false, true]) {
  docBody.replaceChildren();
  const doors = new Interiors(() => (mail ? 1 : 0), () => (mail ? '10:00' : ''), () => {});
  doors.register(churchDoor(churchSite, mail));
  for (const d of otherDoors) doors.register(d);

  // Driving past the church (>= 3 km/h): no prompt, no link.
  doors.update(0.1, idle, { x: churchPos.x + 2, z: churchPos.z, speed: 2 }, true);
  assert.equal(byId.get('doorPrompt').hidden, true, `mail=${mail}: hidden while driving past church`);
  assert.equal(allAnchors().length, 0, `mail=${mail}: zero anchors while driving past church`);
  assert.equal(doors.activeLink, null, `mail=${mail}: no activeLink while driving`);
  assert.equal(doors.canEnter, false);
  assert.equal(doors.nearbyId, null);

  // Rolling slowly past the church (2 km/h forward or reverse): door prompt may show, but donation link stays off until parked.
  for (const speed of [2 / 3.6, -2 / 3.6]) {
    doors.update(0.1, idle, { x: churchPos.x + 2, z: churchPos.z, speed }, true);
    assert.equal(byId.get('doorPrompt').hidden, false, `mail=${mail} speed=${speed.toFixed(2)}: rolling door prompt shows`);
    assert.equal(byId.get('doorSupport').hidden, true, `mail=${mail} speed=${speed.toFixed(2)}: support box hidden while moving`);
    assert.equal(allAnchors().length, 0, `mail=${mail} speed=${speed.toFixed(2)}: zero anchors while moving`);
    assert.equal(doors.activeLink, null, `mail=${mail} speed=${speed.toFixed(2)}: activeLink null while moving`);
  }

  // Stopped away from the church: no prompt, no link.
  doors.update(0.1, idle, { x: churchPos.x + 25, z: churchPos.z, speed: 0 }, true);
  assert.equal(byId.get('doorPrompt').hidden, true);
  assert.equal(allAnchors().length, 0, `mail=${mail}: zero anchors away from church`);
  assert.equal(doors.activeLink, null);

  // Stopped at every non-church door (mine, steel plant, Port Hood depot): prompt shows, ZERO donation links.
  for (const other of otherDoors) {
    doors.update(0.1, idle, { x: other.position.x, z: other.position.z, speed: 0 }, true);
    assert.equal(byId.get('doorPrompt').hidden, false, `${other.id}: prompt shown`);
    assert.equal(byId.get('doorSupport').hidden, true, `${other.id}: support box hidden`);
    assert.equal(allAnchors().length, 0, `${other.id}: zero anchors at non-church door`);
    assert.equal(doors.activeLink, null, `${other.id}: no activeLink at non-church door`);
    assert.equal(doors.nearbyId, other.id, `${other.id}: nearbyId identifies non-church door`);
  }

  // Inside a non-church interior (mine): zero anchors.
  doors.enter('mine');
  doors.update(0.41, idle, { x: 500, z: 500, speed: 0 }, true);
  doors.update(0.1, idle, { x: 500, z: 500, speed: 0 }, true);
  assert.equal(byId.get('interiorHud').hidden, false);
  assert.equal(byId.get('interiorSupport').hidden, true);
  assert.equal(allAnchors().length, 0, 'mine interior: zero anchors');
  assert.equal(doors.activeLink, null);
  doors.leave();
  doors.update(0.41, idle, { x: 500, z: 500, speed: 0 }, true);

  // Parked at the River Denys Mountain church: link appears in #doorPrompt.
  doors.update(0.1, idle, { x: churchPos.x + 3, z: churchPos.z, speed: 0 }, true);
  assert.equal(byId.get('doorPrompt').hidden, false, `mail=${mail}: church prompt visible`);
  assert.equal(doors.canEnter, true);
  assert.equal(doors.activeLink, CHURCH_DONATE_LINK);
  assert.equal(allAnchors().length, 1, `mail=${mail}: exactly one anchor parked at church`);
  assertExactChurchLink(byId.get('doorSupportLink'), byId.get('doorSupport'), `mail=${mail} parked at church`);

  // Same-frame acceleration past 0.5 km/h clears both door link and activeLink before the next frame's update.
  doors.syncSpeed(0.55 / 3.6);
  assert.equal(byId.get('doorSupport').hidden, true, `mail=${mail}: syncSpeed hides door support on first moving frame`);
  assert.equal(allAnchors().length, 0, `mail=${mail}: syncSpeed removes anchor on first moving frame`);
  assert.equal(doors.activeLink, null, `mail=${mail}: syncSpeed clears activeLink on first moving frame`);
  doors.syncSpeed(0);
  assert.equal(allAnchors().length, 1, `mail=${mail}: syncSpeed restores anchor when stopped again`);

  // Enter the church: #doorSupport clears immediately; early stops (door, altar, vestry) show NO link.
  doors.enter();
  assert.equal(allAnchors().length, 0, `mail=${mail}: entering clears door prompt link`);
  doors.update(0.41, idle, { x: churchPos.x + 3, z: churchPos.z, speed: 0 }, true);
  doors.update(0.05, idle, { x: churchPos.x + 3, z: churchPos.z, speed: 0 }, true);
  const walkTo = (visit, stopId) => {
    for (let i = 0; i < 60 * 400 && visit.stop.id !== stopId && !visit.result; i++) visit.update(1 / 60, { walk: visit.halted && i % 2 ? 0 : 1, look: 0 });
    assert.equal(visit.stop.id, stopId);
  };
  const visit = doors.game.visit;
  for (const stopId of ['door', 'altar', 'vestry']) {
    if (visit.stop.id !== stopId) walkTo(visit, stopId);
    doors.update(0.016, idle, { x: churchPos.x + 3, z: churchPos.z, speed: 0 }, true);
    assert.equal(byId.get('interiorSupport').hidden, true, `mail=${mail} stop ${stopId}: support box hidden`);
    assert.equal(allAnchors().length, 0, `mail=${mail} stop ${stopId}: zero anchors before last caption`);
    assert.equal(doors.activeLink, null, `mail=${mail} stop ${stopId}: no activeLink before last caption`);
  }

  // Last captioned stop (gallery): link appears in #interiorHud.
  walkTo(visit, 'gallery');
  doors.update(0.016, idle, { x: churchPos.x + 3, z: churchPos.z, speed: 0 }, true);
  assert.equal(doors.activeLink, CHURCH_DONATE_LINK, `mail=${mail} gallery: activeLink set`);
  assert.equal(allAnchors().length, 1, `mail=${mail} gallery: exactly one anchor`);
  assertExactChurchLink(byId.get('interiorSupportLink'), byId.get('interiorSupport'), `mail=${mail} gallery stop`);

  // Walk > 2.5 m past gallery toward exit: caption fades, link hides and clears.
  visit.update(1 / 60, { walk: 0, look: 0 });
  for (let i = 0; i < 60 * 5 && visit.reading !== null && !visit.result; i++) visit.update(1 / 60, { walk: 1, look: 0 });
  assert.equal(visit.reading, null, 'walked past gallery caption');
  doors.update(0.016, idle, { x: churchPos.x + 3, z: churchPos.z, speed: 0 }, true);
  assert.equal(allAnchors().length, 0, `mail=${mail}: past gallery clears anchor`);
  assert.equal(doors.activeLink, null);

  // Step back into gallery, then leave: leaving clears link immediately.
  for (let i = 0; i < 60 * 5 && visit.reading?.id !== 'gallery'; i++) visit.update(1 / 60, { walk: -1, look: 0 });
  doors.update(0.016, idle, { x: churchPos.x + 3, z: churchPos.z, speed: 0 }, true);
  assert.equal(allAnchors().length, 1, `mail=${mail}: stepping back restores gallery anchor`);
  doors.leave();
  assert.equal(allAnchors().length, 0, `mail=${mail}: leave clears anchor immediately`);
  doors.update(0.41, idle, { x: churchPos.x + 3, z: churchPos.z, speed: 0 }, true);
  assert.equal(doors.busy, false);

  // Back outside parked at the church: link still shows (even in mail mode when already visited today).
  doors.update(0.1, idle, { x: churchPos.x + 3, z: churchPos.z, speed: 0 }, true);
  assert.equal(allAnchors().length, 1, `mail=${mail}: parked after visit still shows link`);
  assertExactChurchLink(byId.get('doorSupportLink'), byId.get('doorSupport'), `mail=${mail} parked after visit`);
  if (mail) assert.equal(doors.canEnter, false, 'mail mode visit still once per shift');

  // Reset clears everything cleanly.
  doors.reset();
  assert.equal(allAnchors().length, 0, `mail=${mail}: reset clears anchors`);
}
console.log('PASS door & walk rules: link appears only parked at church and at gallery caption; absent while driving, away, at other doors, and at earlier stops.');

// 5. Bare mode suppresses all donation links.
{
  docBody.replaceChildren();
  const bareDoors = new Interiors(() => 0, () => '', () => {}, true);
  bareDoors.register(churchDoor(churchSite, false));
  bareDoors.update(0.1, idle, { x: churchPos.x + 2, z: churchPos.z, speed: 0 }, true);
  assert.equal(allAnchors().length, 0, 'bare mode: zero anchors');
  assert.equal(bareDoors.activeLink, null, 'bare mode: activeLink null');
}

// 6. Gamepad reachability: directly in #interiorHud at gallery (D-pad + A) AND in #pauseScreen (D-pad + A).
{
  docBody.replaceChildren();
  const doors = new Interiors(() => 0, () => '', () => {});
  doors.register(churchDoor(churchSite, false));
  const pauseScreen = new FakeElement('div');
  pauseScreen.id = 'pauseScreen'; pauseScreen.hidden = true;
  const resumeBtn = new FakeElement('button'); resumeBtn.id = 'resumeGame';
  const pauseSupport = new FakeElement('div'); pauseSupport.id = 'pauseSupport'; pauseSupport.hidden = true;
  pauseScreen.append(resumeBtn, pauseSupport);
  docBody.append(pauseScreen);

  const pad = {
    index: 0, mapping: 'standard', connected: true, axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => [pad] } });
  const actions = { horn() {}, mail() {}, view() {}, pause() {}, reset() {}, radio() {}, photo() {}, relief() {}, places() {}, back() {} };
  const gp = createGamepad(actions, false, () => true);
  let t = 2000;
  const press = btn => {
    pad.buttons[btn] = { pressed: true, value: 1 }; t += 50; gp.poll(t);
    pad.buttons[btn] = { pressed: false, value: 0 }; t += 50; gp.poll(t);
  };

  // Enter church and walk to gallery.
  doors.enter('church');
  doors.update(0.41, idle, { x: churchPos.x, z: churchPos.z, speed: 0 }, true);
  const visit = doors.game.visit;
  for (let i = 0; i < 60 * 400 && visit.stop.id !== 'gallery'; i++) visit.update(1 / 60, { walk: visit.halted && i % 2 ? 0 : 1, look: 0 });
  doors.update(0.016, idle, { x: churchPos.x, z: churchPos.z, speed: 0 }, true);

  // D-pad UP in #interiorHud focuses #interiorSupportLink; A clicks it.
  let hudClicks = 0;
  byId.get('interiorSupportLink').addEventListener('click', () => { hudClicks++; });
  press(BUTTON.UP);
  assert.equal(globalThis.document.activeElement?.id, 'interiorSupportLink', 'gamepad D-pad reaches #interiorSupportLink in walk HUD');
  assert.ok(byId.get('interiorSupportLink').classList.contains('padFocus'), 'gamepad marks #interiorSupportLink with padFocus');
  press(BUTTON.A);
  assert.equal(hudClicks, 1, 'gamepad A activates #interiorSupportLink');

  // Opening pause screen at the church shows #pauseSupportLink; D-pad + A activates it; closing clears it.
  pauseScreen.hidden = false;
  renderInteriorLink(pauseSupport, doors.activeLink, 'pauseSupportLink');
  assertExactChurchLink(byId.get('pauseSupportLink'), pauseSupport, 'pause screen at church');
  let pauseClicks = 0;
  byId.get('pauseSupportLink').addEventListener('click', () => { pauseClicks++; });
  resumeBtn.focus();
  press(BUTTON.DOWN);
  assert.equal(globalThis.document.activeElement?.id, 'pauseSupportLink', 'gamepad D-pad reaches #pauseSupportLink on pause screen');
  press(BUTTON.A);
  assert.equal(pauseClicks, 1, 'gamepad A activates #pauseSupportLink');
  pauseScreen.hidden = true;
  renderInteriorLink(pauseSupport, null, 'pauseSupportLink');
  assert.equal(byId.get('pauseSupportLink') ?? null, null, 'closing pause removes #pauseSupportLink');
}
console.log('PASS gamepad reachability: direct D-pad + A in walk HUD at gallery, and D-pad + A on pause screen; cleared on close.');
