// Tests for the GPU proof (tools/gpu-proof.mjs) and its call in tools/browser.sh, with mutants.
// A fake CDP endpoint (HTTP + a minimal WebSocket server) answers like a started browser, so the
// real command-line path is exercised: exit codes, gpu.json, a linked folder, an unreachable port.
//   usage: node tools/gpu-proof-tests.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS = dirname(fileURLToPath(import.meta.url));
const PROOF = readFileSync(join(TOOLS, 'gpu-proof.mjs'), 'utf8');
const BROWSER_SH = readFileSync(join(TOOLS, 'browser.sh'), 'utf8');

// ---- a fake browser endpoint -------------------------------------------------------------
function frame(text) {
  const body = Buffer.from(text);
  const head = body.length < 126 ? Buffer.from([0x81, body.length]) : Buffer.from([0x81, 126, body.length >> 8, body.length & 255]);
  return Buffer.concat([head, body]);
}
function frames(buffer) {
  const out = [];
  while (buffer.length >= 2) {
    let length = buffer[1] & 127, offset = 2;
    if (length === 126) { length = buffer.readUInt16BE(2); offset = 4; }
    const masked = buffer[1] & 128, mask = masked ? buffer.subarray(offset, offset + 4) : null;
    offset += masked ? 4 : 0;
    if (buffer.length < offset + length) break;
    const data = Buffer.from(buffer.subarray(offset, offset + length));
    if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
    if ((buffer[0] & 15) === 1) out.push(data.toString());
    if ((buffer[0] & 15) === 8) out.push(null);
    buffer = buffer.subarray(offset + length);
  }
  return [out, buffer];
}
async function fakeBrowser(renderer) {
  const server = createServer((request, response) => {
    const { port } = server.address(), ws = `ws://127.0.0.1:${port}/devtools`;
    const body = request.url === '/json/version' ? { Browser: 'Fake/1.0', webSocketDebuggerUrl: `${ws}/browser/b` }
      : request.url === '/json/list' ? [{ type: 'page', url: 'about:blank', webSocketDebuggerUrl: `${ws}/page/p` }] : null;
    response.writeHead(body ? 200 : 404, { 'content-type': 'application/json' }); response.end(JSON.stringify(body));
  });
  const sockets = new Set();
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.stop = () => { for (const socket of sockets) socket.destroy(); server.close(); };
  server.on('upgrade', (request, socket) => {
    const accept = createHash('sha1').update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    let pending = Buffer.alloc(0);
    socket.on('data', chunk => {
      let messages; [messages, pending] = frames(Buffer.concat([pending, chunk]));
      for (const text of messages) {
        if (text === null) { socket.end(Buffer.from([0x88, 0])); continue; }
        const { id, method } = JSON.parse(text);
        const result = method === 'SystemInfo.getInfo' ? { gpu: { featureStatus: { gpu_compositing: 'enabled', webgl: 'enabled' } } }
          : method === 'Runtime.evaluate' ? { result: { type: 'string', value: renderer } } : {};
        socket.write(frame(JSON.stringify({ id, result })));
      }
    });
    socket.on('error', () => {});
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server;
}
function run(script, args, env = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [script, ...args], { env: { ...process.env, MMM_GPU_PROOF_DEADLINE_MS: '4000', MMM_SOFTWARE_OK: '0', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', d => { output += d; }); child.stderr.on('data', d => { output += d; });
    child.on('close', code => resolve({ code, output }));
  });
}

// ---- the suite; every case throws on a wrong answer ------------------------------------
async function suite(proofSource, browserSh) {
  const dir = mkdtempSync(join(tmpdir(), 'mmm-gpu-proof-tests-'));
  try {
    const script = join(dir, 'gpu-proof.mjs');
    writeFileSync(script, proofSource);
    const { classify, verdict, PROBE } = await import(`${script}?v=${Math.random()}`);
    // The real probe expression against fake WebGL contexts: only an unmasked name identifies the GPU.
    const probe = gl => new Function('document', `return ${PROBE}`)({ createElement: () => ({ getContext: () => gl }) });
    const context = (unmasked, extension = true) => ({ RENDERER: 7937, getParameter: k => k === 37446 ? unmasked : 'WebKit WebGL',
      getExtension: n => n === 'WEBGL_debug_renderer_info' ? (extension ? { UNMASKED_RENDERER_WEBGL: 37446 } : null) : n === 'WEBGL_lose_context' ? { loseContext() {} } : null });
    assert.equal(probe(null), 'no webgl2');
    assert.equal(probe(context('ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)')), 'ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)');
    for (const [gl, why] of [[context('x', false), 'no debug extension'], [context(null), 'lost context'], [context(''), 'empty name']]) {
      const answer = probe(gl);
      assert.equal(answer, 'no renderer info', why);
      assert.equal(classify(answer), 'none', why);
    }
    for (const name of ['ANGLE (NVIDIA Corporation, NVIDIA GeForce GTX 980M/PCIe/SSE2, OpenGL ES 3.2)',
      'ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)', 'ANGLE (Intel, Mesa Intel(R) HD Graphics 4600 (HSW GT2), OpenGL 4.6)'])
      assert.equal(classify(name), 'hardware', name);
    for (const name of ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
      'llvmpipe (LLVM 19.1.0, 256 bits)', 'softpipe', 'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11)', 'Google SwiftShader'])
      assert.equal(classify(name), 'software', name);
    for (const name of ['no webgl2', 'no renderer info', 'WebKit WebGL', 'null', '  ', '', undefined, null]) assert.equal(classify(name), 'none', String(name));
    assert.equal(verdict('hardware', 'x', false)[0], 0);
    assert.equal(verdict('software', 'x', true)[0], 0);
    assert.equal(verdict('software', 'x', false)[0], 2);
    assert.match(verdict('software', 'x', false)[1], /no hardware GPU/);
    assert.equal(verdict('none', 'no webgl2', true)[0], 2, 'software ok never excuses a missing WebGL2 context');

    // The real command line, through a linked folder (on Linux) so the entry check is exercised.
    const linked = join(dir, 'linked'); symlinkSync(dir, linked);
    const viaLink = join(linked, 'gpu-proof.mjs');
    for (const [renderer, env, code, text] of [
      ['ANGLE (NVIDIA Corporation, NVIDIA GeForce GTX 980M/PCIe/SSE2, OpenGL ES 3.2)', {}, 0, /browser-check: GPU ANGLE \(NVIDIA/],
      ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', {}, 2, /no hardware GPU/],
      ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', { MMM_SOFTWARE_OK: '1' }, 0, /software renderer accepted/],
      ['no webgl2', { MMM_SOFTWARE_OK: '1' }, 2, /could not be identified/],
      ['WebKit WebGL', {}, 2, /could not be identified/]]) {
      const server = await fakeBrowser(renderer), out = join(dir, `gpu-${Math.random()}.json`);
      try {
        const result = await run(viaLink, [String(server.address().port), out], env);
        assert.equal(result.code, code, `${renderer} ${JSON.stringify(env)}: ${result.output}`);
        assert.match(result.output, text);
        assert.ok(existsSync(out), 'gpu.json written');
        assert.equal(JSON.parse(readFileSync(out, 'utf8')).renderer, renderer);
      } finally { server.stop(); }
    }
    // A result that cannot be recorded is exit 2 (cannot run), never 1.
    const recorder = await fakeBrowser('ANGLE (NVIDIA Corporation, NVIDIA GeForce GTX 980M/PCIe/SSE2, OpenGL ES 3.2)');
    try {
      const unrecorded = await run(viaLink, [String(recorder.address().port), join(dir, 'missing-folder', 'gpu.json')]);
      assert.equal(unrecorded.code, 2, unrecorded.output);
      assert.match(unrecorded.output, /could not record the GPU proof/);
    } finally { recorder.stop(); }
    // Nothing listening: could not read, exit 2, never 0 or 1.
    const closed = await fakeBrowser('x'), port = closed.address().port; closed.close();
    await new Promise(resolve => closed.on('close', resolve));
    const unreachable = await run(viaLink, [String(port), join(dir, 'none.json')]);
    assert.equal(unreachable.code, 2, unreachable.output);
    assert.match(unreachable.output, /could not read the WebGL renderer/);

    // browser.sh: every real start runs the proof, refuses a missing result, and only stand-ins skip it.
    const body = browserSh.slice(browserSh.indexOf('start_check() {'));
    assert.match(body, /if \[\[ "\$\{MMM_CHECK_STANDIN:-0\}" != 1 \]\]; then\n\s+node "\$BROWSER_TOOLS\/gpu-proof\.mjs" "\$CDP" "\$BROWSER_LOG_DIR\/gpu\.json" \|\| return 2\n/);
    assert.match(body, /\[\[ ! -s "\$BROWSER_LOG_DIR\/gpu\.json" \]\]; then echo .*; return 2; fi/);
    assert.match(browserSh, /--use-gl=angle --use-angle=gl-egl/);
    assert.match(browserSh, /if \[\[ \$mac == 0 \]\]; then cmd=\(env TMPDIR="\$\{MMM_BROWSER_TMPDIR:-\/tmp\}" "\$\{cmd\[@\]\}"\); fi/, 'Linux browsers need a short TMPDIR for their socket');
    assert.match(browserSh, /__EGL_VENDOR_LIBRARY_FILENAMES="\$vendor"/);
    assert.doesNotMatch(browserSh.replace(/^\s*#.*$/gm, ''), /flatpak run/, 'the Flatpak cannot prove ownership; it must not be started');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const MUTANTS = [
  ['proof', 'software regex misses SwiftShader', "/swiftshader|llvmpipe", "/xswiftshaderx|llvmpipe"],
  ['proof', 'software verdict passes', "if (kind === 'software') return [2,", "if (kind === 'software') return [0,"],
  ['proof', 'software ok excuses a missing context', "if (kind === 'software' && softwareOk)", "if (kind !== 'hardware' && softwareOk)"],
  ['proof', 'wrong variable for software ok', "process.env.MMM_SOFTWARE_OK === '1'", "process.env.SOFTWARE_OK === '1'"],
  ['proof', 'unreadable renderer passes', "could not read the WebGL renderer: ${error.message}`); return 2;", "could not read the WebGL renderer: ${error.message}`); return 0;"],
  ['proof', 'textual entry check (the /var/home bug)', "if (entry === realpathSync(fileURLToPath(import.meta.url)))", "if (process.argv[1] === fileURLToPath(import.meta.url))"],
  ['proof', 'masked renderer name accepted', "const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;", "const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);"],
  ['proof', 'null name stringified', "return typeof name === 'string' && name.trim() ? name : 'no renderer info';", "return String(name);"],
  ['proof', 'generic names count as hardware', "const UNKNOWN = /^(?:no webgl2|no renderer info|webkit webgl|webkit|null|undefined)$/i;", "const UNKNOWN = /^(?:no webgl2)$/i;"],
  ['proof', 'unrecorded result exits 1', "catch (error) { console.error(`browser-check: could not record the GPU proof in ${out}: ${error.message}`); return 2; }", "catch (error) { throw error; }"],
  ['browser', 'proof call removed', 'node "$BROWSER_TOOLS/gpu-proof.mjs" "$CDP" "$BROWSER_LOG_DIR/gpu.json" || return 2\n', 'true\n'],
  ['browser', 'missing gpu.json accepted', `then echo 'browser-check: the GPU proof wrote no result; refusing the start' >&2; return 2; fi`, `then echo 'browser-check: the GPU proof wrote no result; refusing the start' >&2; fi`],
  ['browser', 'stand-in skip inverted', 'if [[ "${MMM_CHECK_STANDIN:-0}" != 1 ]]; then\n    node', 'if [[ "${MMM_CHECK_STANDIN:-0}" == 1 ]]; then\n    node'],
  ['browser', 'long TMPDIR kept for the Linux browser', 'then cmd=(env TMPDIR="${MMM_BROWSER_TMPDIR:-/tmp}" "${cmd[@]}"); fi', 'then :; fi'],
  ['browser', 'NVIDIA mode without EGL', '--use-gl=angle --use-angle=gl-egl', '--use-gl=angle'],
];

await suite(PROOF, BROWSER_SH);
console.log('PASS gpu-proof: classification, verdicts, command line (linked folder), unreachable endpoint, browser.sh call');
let failed = 0;
for (const [target, name, from, to] of MUTANTS) {
  const source = target === 'proof' ? PROOF : BROWSER_SH;
  if (source.split(from).length !== 2) { console.error(`FAIL mutant anchor missing or not unique: ${name}`); failed++; continue; }
  const mutated = source.replace(from, () => to);
  try {
    await (target === 'proof' ? suite(mutated, BROWSER_SH) : suite(PROOF, mutated));
    console.error(`FAIL mutant survived: ${name}`); failed++;
  } catch { console.log(`PASS mutant caught: ${name}`); }
}
if (failed) { console.error(`FAIL ${failed} mutant(s) not caught`); process.exit(1); }
console.log(`PASS all ${MUTANTS.length} mutants caught`);
