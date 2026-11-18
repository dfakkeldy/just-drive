// GPU proof for every browser start (tools/browser.sh start_check calls it once per started browser).
// Reads the WebGL renderer of the started browser's own about:blank page and its GPU feature states.
//   usage: node tools/gpu-proof.mjs <cdp-port> <out.json>
// Exit 0: a hardware renderer (or a software one on a row marked software ok: MMM_SOFTWARE_OK=1).
// Exit 2: a software renderer ("no hardware GPU"), no WebGL2, or the renderer could not be read.
// It never exits 1: a missing GPU means the check could not run, not that the game failed.
import { realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Software rasterisers that Chromium, Mesa or Windows can report instead of a GPU.
export const SOFTWARE = /swiftshader|llvmpipe|softpipe|software rasterizer|swrast|microsoft basic render/i;

// The probe returns 'no webgl2' or 'no renderer info' when it cannot name the GPU; those, and the generic
// masked names a browser reports without WEBGL_debug_renderer_info, never count as hardware.
const UNKNOWN = /^(?:no webgl2|no renderer info|webkit webgl|webkit|null|undefined)$/i;
export function classify(renderer) {
  if (typeof renderer !== 'string' || renderer.trim() === '' || UNKNOWN.test(renderer.trim())) return 'none';
  return SOFTWARE.test(renderer) ? 'software' : 'hardware';
}

// One verdict per start: [exit code, line for the log].
export function verdict(kind, renderer, softwareOk) {
  if (kind === 'hardware') return [0, `browser-check: GPU ${renderer}`];
  if (kind === 'software' && softwareOk) return [0, `browser-check: software renderer accepted (row marked software ok): ${renderer}`];
  if (kind === 'software') return [2, `browser-check: no hardware GPU: ${renderer} (mark the row software ok in tools/checks-hosts.tsv only if it compares no pictures)`];
  return [2, `browser-check: no hardware GPU: the GPU could not be identified (${renderer ?? 'nothing reported'})`];
}

// Only the unmasked renderer names the GPU; without it (or with a lost context) the answer is unknown.
export const PROBE = `(() => {
  const canvas = document.createElement('canvas'), gl = canvas.getContext('webgl2');
  if (!gl) return 'no webgl2';
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return typeof name === 'string' && name.trim() ? name : 'no renderer info';
})()`;

async function json(url, deadline) {
  const response = await fetch(url, { signal: AbortSignal.timeout(deadline) });
  if (!response.ok) throw Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

function session(url, deadline) {
  const ws = new WebSocket(url), pending = new Map();
  let next = 0;
  const opened = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('CDP connection timeout')), deadline);
    ws.onopen = () => { clearTimeout(timer); resolve(); };
    ws.onerror = () => { clearTimeout(timer); reject(Error('CDP socket error')); };
  });
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next, timer = setTimeout(() => reject(Error(`${method} timeout`)), deadline);
    pending.set(id, message => { clearTimeout(timer); message.error ? reject(Error(`${method}: ${message.error.message}`)) : resolve(message.result); });
    ws.send(JSON.stringify({ id, method, params }));
  });
  return { opened, send, close: () => ws.close() };
}

// 45 s by default: a loaded Mac (load 110 on 12 Nov) can be slow to answer; the tests shorten it.
export async function readGpu(port, deadline = Number(process.env.MMM_GPU_PROOF_DEADLINE_MS) || 45000) {
  const base = `http://127.0.0.1:${port}`;
  const version = await json(`${base}/json/version`, deadline);
  // The starter opens exactly one about:blank page; use it rather than adding a target the checks could pick up.
  const pages = (await json(`${base}/json/list`, deadline)).filter(t => t.type === 'page');
  const page = pages.find(t => t.url === 'about:blank') ?? pages[0];
  if (!page?.webSocketDebuggerUrl) throw Error('the started browser has no page to probe');
  const browser = session(version.webSocketDebuggerUrl, deadline);
  await browser.opened;
  let features = {};
  try { features = (await browser.send('SystemInfo.getInfo')).gpu?.featureStatus ?? {}; } finally { browser.close(); }
  const tab = session(page.webSocketDebuggerUrl, deadline);
  await tab.opened;
  let renderer;
  try {
    const result = await tab.send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
    renderer = result.result?.value;
  } finally { tab.close(); }
  return { browser: version.Browser, renderer, gpu_compositing: features.gpu_compositing ?? null, webgl: features.webgl ?? null, webgl2: features.webgl2 ?? null };
}

async function main() {
  const [port, out] = process.argv.slice(2);
  if (!port || !out) { console.error('usage: node tools/gpu-proof.mjs <cdp-port> <out.json>'); return 2; }
  let found;
  try { found = await readGpu(port); }
  catch (error) { console.error(`browser-check: could not read the WebGL renderer: ${error.message}`); return 2; }
  const kind = classify(found.renderer), softwareOk = process.env.MMM_SOFTWARE_OK === '1';
  const [code, line] = verdict(kind, found.renderer, softwareOk);
  try { writeFileSync(out, JSON.stringify({ ...found, kind, softwareOk, exit: code }, null, 1) + '\n'); }
  catch (error) { console.error(`browser-check: could not record the GPU proof in ${out}: ${error.message}`); return 2; }
  (code ? console.error : console.log)(`${line} | ${found.browser} | compositing ${found.gpu_compositing ?? 'unknown'}`);
  return code;
}

// Compare real paths: a linked home folder (on Linux) must not skip the proof.
// browser.sh also refuses a start that wrote no gpu.json, so a skipped proof can never pass.
const entry = process.argv[1] ? realpathSync(process.argv[1]) : '';
if (entry === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = await main();
  // A browser that never finishes the socket close handshake must not hold the start-up.
  setTimeout(() => process.exit(), 3000).unref();
}
