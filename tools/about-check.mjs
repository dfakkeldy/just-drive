// The About and Help pages of both brands: built from the real builder into a temporary folder, then read as a visitor would.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '../web/node_modules/esbuild/lib/main.js';
process.on('uncaughtException', e => { console.error(e.name + ': ' + e.message); process.exit(1); });

const { outputFiles } = await build({ stdin: { contents: "export { AREAS } from './area'; export * from './credits'; export * from './controls'; export { bikeKeys } from './vehicle-choice';", resolveDir: process.cwd() + '/web/src', loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const { AREAS, ABOUT_URL, HELP_URL, KEYS, TOUCH, DRIVING_KEYS, DRIVING_TOUCH, padKeys, bikeKeys, CONTACT, COFFEE_URL, COFFEE_TEXT, LAND_CREDITS, FAR_CREDITS, ENGINE_CREDIT } = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'));

const out = mkdtempSync(join(tmpdir(), 'mmm-about-'));
try {
  execFileSync('node', ['tools/about-pages.mjs', out], { stdio: 'pipe' });
  const page = brand => readFileSync(`${out}/about/${brand}/index.html`, 'utf8');
  const text = html => html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  for (const brand of ['mail', 'just']) {
    const html = page(brand), words = text(html);
    assert.equal([...html.matchAll(/<title>/g)].length, 1, brand + ' one title');
    assert.match(html, /<meta name="viewport"/);
    assert.ok(html.includes(`<link rel="canonical" href="${ABOUT_URL[brand]}">`), brand + ' canonical');
    for (const tag of ['title', 'description', 'type', 'url', 'image']) assert.match(html, new RegExp(`property="og:${tag}"`), brand + ' og:' + tag);
    assert.ok(html.includes('<script src="/about/page-links.js" defer></script>'), brand + ' keyboard link support');
    assert.ok(existsSync(out + '/about/page-links.js'), 'keyboard script ships');
    // The credits the title card shows, word for word, and the owner's choices of 14 Nov 2026.
    for (const credit of [LAND_CREDITS, FAR_CREDITS, ENGINE_CREDIT]) assert.ok(html.includes(credit), brand + ' credits verbatim');
    assert.match(html, /id="titleMusic"/, brand + ' music credit');
    assert.ok(html.includes(`href="mailto:${CONTACT}"`), brand + ' contact');
    assert.ok(html.includes('href="https://fakkeldy.ca/"'), brand + ' maker link');
    // The radio's donation ad says "the coffee link": both brands carry it exactly once, to the one address.
    assert.equal(COFFEE_URL, 'https://ko-fi.com/fakkeldy');
    assert.equal(html.split(`<a id="coffee" href="${COFFEE_URL}" rel="noopener">${COFFEE_TEXT}</a>`).length, 2, brand + ' coffee link');
    assert.match(words, /Dan Fakkeldy designed/, brand + ' byline');
    assert.match(words, /Claude/); assert.match(words, /Codex/);
    // Every picture the page names is in the build; nothing loads from another site.
    for (const [, src] of html.matchAll(/<img src="([^"]+)"/g)) { assert.ok(src.startsWith('/about/img/'), src); assert.ok(statSync(out + src).size > 20_000, src); }
    const image = html.match(/property="og:image" content="([^"]+)"/)[1];
    assert.ok(image.startsWith(new URL(ABOUT_URL[brand]).origin + '/about/img/') && existsSync(out + new URL(image).pathname), brand + ' og:image');
    assert.doesNotMatch(html, /(?:src|href)="\/\/|<link rel="stylesheet"/, brand + ' no outside files');
    // Privacy rule: road names are fine, civic numbers are not.
    assert.doesNotMatch(words, /\b\d{1,5} [A-Z][a-z]+(?: [A-Z][a-z]+)* (?:Rd|Road|Lane|Street|St)\b/, brand + ' no civic address');
  }
  const just = page('just'), mail = page('mail');
  assert.doesNotMatch(just.match(/<title>([^<]+)<\/title>/)[1], /\b(mail|post|route|shift|carrier|delivery)\b/i, 'Just Drive title has no mail words');
  for (const area of AREAS) assert.ok(just.includes(`<a href="/${area.id}">${area.name}</a>`), 'place link ' + area.id);
  assert.ok(!just.includes('href="/fixture"'), 'no development area');
  assert.match(text(mail), /Not affiliated with any postal service/, 'satire notice');
  // Today's board: one plain paragraph on what is stored and for how long, on the mail game's page only.
  assert.equal(mail.split('id="boardData"').length, 2, 'one board paragraph');
  assert.match(text(mail), /Today’s board keeps only what you post .* points, discipline step, time, bingo squares and vehicle, and a number your device makes from its own random secret .* No account, no email and no network address\. Each day’s board keeps its top 100, and the whole board is deleted after 60 days\./, 'board data paragraph');
  assert.ok(!just.includes('boardData'), 'Just Drive has no board');
  assert.match(text(mail), /drives a rural mail route around Mabou/, 'the true story');
  assert.ok(mail.includes('<a class="button" href="/">'), 'mail plays at its root');
  assert.ok(just.includes('<a class="button" href="/mabou">'), 'Just Drive plays at /mabou');
  assert.match(text(just), /not a map for navigation/, 'Just Drive caution');
  // Help: the control rows are the title card's own, in order, and each page links its partner.
  const help = brand => readFileSync(`${out}/help/${brand}/index.html`, 'utf8');
  const esc = t => t.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
  const rows = list => list.map(([k, v]) => `<div class="row"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
  for (const [brand, lists] of [['mail', [KEYS, TOUCH, padKeys('car', true)]], ['just', [DRIVING_KEYS, DRIVING_TOUCH, bikeKeys(false), bikeKeys(true), padKeys('car', false), padKeys('bike', false)]]]) {
    const html = help(brand), words = text(html);
    for (const list of lists) assert.ok(html.includes(`<dl>${rows(list)}</dl>`), brand + ' help control table matches the title card');
    assert.ok(html.includes(`<link rel="canonical" href="${HELP_URL[brand]}">`), brand + ' help canonical');
    assert.ok(html.includes('<script src="/about/page-links.js" defer></script>'), brand + ' Help keyboard link support');
    assert.ok(html.includes('<a href="/about">About</a>') && page(brand).includes('<a href="/help">Help</a>'), brand + ' About and Help link each other');
    for (const id of [...html.matchAll(/<a href="#([a-z]+)"/g)].map(m => m[1])) assert.match(html, new RegExp(`id="${id}"`), brand + ' contents link #' + id);
    assert.ok(html.includes(`href="mailto:${CONTACT}"`), brand + ' help contact');
    assert.match(words, /Download for offline play/); assert.match(words, /Copy invitation link/);
    for (const [, src] of html.matchAll(/<img src="([^"]+)"/g)) assert.ok(statSync(out + src).size > 20_000, src);
  }
  // Every list is styled list-style:none, which drops list semantics in Safari/VoiceOver unless role="list" restores them.
  for (const brand of ['mail', 'just']) for (const [name, html] of [['About', page(brand)], ['Help', help(brand)]]) {
    const lists = [...html.matchAll(/<(ul|ol)\b[^>]*>/g)].map(m => m[0]);
    assert.ok(lists.length, `${brand} ${name} has lists`);
    for (const tag of lists) assert.match(tag, /\brole="list"/, `${brand} ${name} list keeps its role: ${tag}`);
  }
  assert.doesNotMatch(text(help('just')), /\b(mail|carrier|delivery)\b|\bthe shift\b|END SHIFT/i, 'Just Drive help never mentions the mail game (the Shift key is fine)');
  for (const area of AREAS) assert.ok(help('just').includes(`<a href="/${area.id}">${area.name}</a>`), 'help place link ' + area.id);
  assert.match(text(help('mail')), /END SHIFT/);
  console.log(`PASS both Help pages: control tables equal the title card's lists, contents links, partner links, no mail words on Just Drive`);
  console.log(`PASS both About pages: titles, credits verbatim, byline, ${AREAS.length} place links, local pictures, keyboard script, list roles, no civic address`);
} finally { rmSync(out, { recursive: true, force: true }); }
