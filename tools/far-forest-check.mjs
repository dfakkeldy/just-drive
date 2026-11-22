#!/usr/bin/env node
// Regression check for far-forest canopy palette blending across internal cover class boundaries
// (including the Mabou class-1 spruce / class-2 field edge near E 617163, N 5103171.96),
// cover-image perimeter fade, canopy-mask preservation, and water-source textureLod counting.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { program, preprocess } from './coast-programs.mjs';
import { compareWaterShaders } from './water-source-check.mjs';

const source = readFileSync(new URL('../web/src/shaders.ts', import.meta.url), 'utf8');

// Extract a GLSL function body by balanced braces from preprocessed TERRAIN_FRAG.
function fnBody(shader, signature) {
  const start = shader.indexOf(signature);
  assert.ok(start >= 0, `missing ${signature} in TERRAIN_FRAG`);
  const open = shader.indexOf('{', start);
  let depth = 0, end = open;
  for (; end < shader.length; end++) {
    if (shader[end] === '{') depth++;
    else if (shader[end] === '}') { depth--; if (depth === 0) break; }
  }
  assert.equal(depth, 0, `unbalanced braces in ${signature}`);
  return shader.slice(open + 1, end);
}

// Compile the real preprocessed coverShares and canopyShares GLSL bodies to JS.
// Any edit to the GLSL shader changes the executed math directly.
function buildSharesEvaluator(shaderSource, flags) {
  const shader = preprocess(program(shaderSource, 'TERRAIN_FRAG'), flags);
  const coverBody = fnBody(shader, 'vec2 coverShares(vec2 at, float hardwood)');
  const canopyBody = fnBody(shader, 'vec2 canopyShares(vec2 world, float hardwood)');

  // Check canopy mask and open-land skip stay intact in TERRAIN_FRAG main().
  const mainBody = shader.slice(shader.indexOf('void main()'));
  assert.ok(mainBody.includes('float tree = smoothstep(1.8, 3.5, canopy) * hull;'), 'canopy mask formula preserved');
  assert.ok(mainBody.includes('if (tree > 0.001) albedo = mix(albedo, treeColor('), 'open land skips treeColor');
  assert.ok(!coverBody.includes('canopy') && !canopyBody.includes('canopy'), 'palette helpers never mutate canopy');

  // Minimal GLSL-to-JS translator for vec2/vec4 expressions used in coverShares & canopyShares.
  const toJs = (body) => body
    .replace(/\bvec2\s+([A-Za-z_]\w*)\s*=/g, 'let $1 =')
    .replace(/\bvec4\s+([A-Za-z_]\w*)\s*=/g, 'let $1 =')
    .replace(/\bfloat\s+([A-Za-z_]\w*)\s*=/g, 'let $1 =')
    .replace(/,\s*f\s*=/g, '; let f =')
    .replace(/\bvec2\s*\(/g, 'V2(')
    .replace(/\bstep\s*\(/g, 'gStep(')
    .replace(/\bsmoothstep\s*\(/g, 'gSmoothstep(')
    .replace(/\bfloor\s*\(/g, 'gFloor(')
    .replace(/\bmin\s*\(/g, 'gMin(')
    .replace(/\bmix\s*\(/g, 'gMix(')
    .replace(/\.rg\b/g, '.rg')
    .replace(/\.xy\b/g, '.xy')
    .replace(/\.zw\b/g, '.zw');

  // Operator support via explicit AST-free tiny helper: verify only supported expressions appear,
  // then evaluate with exact GLSL value-noise and nearest-texel cover lookup.
  const coverJs = toJs(coverBody);
  const canopyJs = toJs(canopyBody);
  // Translate vec2 arithmetic operators explicitly for the exact expressions in these two helpers.
  const translateOps = (js) => js
    .replace(/\(at - coverRect\.xy\) \* coverRect\.zw/g, 'vMul(vSub(at, coverRect.xy), coverRect.zw)')
    .replace(/V2\(0\.45, 0\.55\) \* hardwood/g, 'vScale(V2(0.45, 0.55), hardwood)')
    .replace(/gMin\(uv, 1\.0 - uv\) \/ coverRect\.zw/g, 'vDiv(gMin(uv, vSub(V2(1.0, 1.0), uv)), coverRect.zw)')
    .replace(/c\.rg \* \(255\.0 \/ 250\.0\)/g, 'vScale(c.rg, 255.0 / 250.0)')
    .replace(/\(V2\(vnoise\(world \* 0\.045\), vnoise\(world \* 0\.045 \+ 31\.7\)\) - 0\.5\) \* 18\.0/g,
      'vScale(vSub(V2(vnoise(vScale(world, 0.045)), vnoise(vAdd(vScale(world, 0.045), V2(31.7, 31.7)))), V2(0.5, 0.5)), 18.0)')
    .replace(/\(world \+ jitter\) \/ 16\.0/g, 'vScale(vAdd(world, jitter), 1 / 16.0)')
    .replace(/q - q0/g, 'vSub(q, q0)')
    .replace(/f \* f \* \(3\.0 - 2\.0 \* f\)/g, 'vMul(vMul(f, f), vSub(V2(3.0, 3.0), vScale(f, 2.0)))')
    .replace(/q0 \* 16\.0/g, 'vScale(q0, 16.0)')
    .replace(/\(q0 \+ V2\(([^)]+)\)\) \* 16\.0/g, 'vScale(vAdd(q0, V2($1)), 16.0)');

  const compiledCover = translateOps(coverJs);
  const compiledCanopy = translateOps(canopyJs);

  return function evalShares(world, hardwood, coverRect, sampleCover) {
    const V2 = (x, y) => ({ x, y });
    const vAdd = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
    const vSub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
    const vMul = (a, b) => ({ x: a.x * b.x, y: a.y * b.y });
    const vDiv = (a, b) => ({ x: a.x / b.x, y: a.y / b.y });
    const vScale = (a, s) => ({ x: a.x * s, y: a.y * s });
    const fract = (x) => x - Math.floor(x);
    const hash = (p) => fract(Math.sin(p.x * 127.1 + p.y * 311.7) * 43758.5453);
    const vnoise = (p) => {
      const i = { x: Math.floor(p.x), y: Math.floor(p.y) };
      const f = { x: fract(p.x), y: fract(p.y) };
      const u = { x: f.x * f.x * (3 - 2 * f.x), y: f.y * f.y * (3 - 2 * f.y) };
      const a = hash(i), b = hash({ x: i.x + 1, y: i.y }), c = hash({ x: i.x, y: i.y + 1 }), d = hash({ x: i.x + 1, y: i.y + 1 });
      return (a + (b - a) * u.x) * (1 - u.y) + (c + (d - c) * u.x) * u.y;
    };
    const gStep = (e, x) => (x < e ? 0 : 1);
    const gSmoothstep = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
    const gFloor = (v) => (typeof v === 'number' ? Math.floor(v) : { x: Math.floor(v.x), y: Math.floor(v.y) });
    const gMin = (a, b) => (typeof a === 'number' ? Math.min(a, b) : { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) });
    const gMix = (a, b, t) => (typeof a === 'number'
      ? a * (1 - t) + b * t
      : { x: a.x * (1 - t) + b.x * t, y: a.y * (1 - t) + b.y * t });
    const textureLod = (_tex, uv) => {
      const [r, g, b] = sampleCover(uv.x, uv.y);
      return { r: r / 255, g: g / 255, b: b / 255, rg: { x: r / 255, y: g / 255 } };
    };
    const rect = { xy: { x: coverRect[0], y: coverRect[1] }, zw: { x: coverRect[2], y: coverRect[3] } };
    const coverShares = new Function(
      'at', 'hardwood', 'coverRect', 'tCover', 'V2', 'vAdd', 'vSub', 'vMul', 'vDiv', 'vScale', 'gStep', 'gSmoothstep', 'gFloor', 'gMin', 'gMix', 'textureLod',
      compiledCover
    );
    const canopyShares = new Function(
      'world', 'hardwood', 'coverShares', 'V2', 'vAdd', 'vSub', 'vMul', 'vDiv', 'vScale', 'vnoise', 'gFloor', 'gMix', 'gStep',
      compiledCanopy
    );
    return canopyShares(
      world, hardwood,
      (at, hw) => coverShares(at, hw, rect, null, V2, vAdd, vSub, vMul, vDiv, vScale, gStep, gSmoothstep, gFloor, gMin, gMix, textureLod),
      V2, vAdd, vSub, vMul, vDiv, vScale, vnoise, gFloor, gMix, gStep
    );
  };
}

function verify(shaderSource) {
  // Mabou cover rect in world coordinates (village [624271, 5103301], xmin 616076, xmax 632460, ymin 5095140, ymax 5111524).
  const coverRect = [616076 - 624271, 5103301 - 5111524, 1 / (632460 - 616076), 1 / (5111524 - 5095140)];
  // Boundary at E 617163, N 5103171.96 (world x = -7108, z = 129.04): north (z < 129.04) is spruce stand 1:000/025,
  // south (z >= 129.04) is field 2:000/000 with overhanging 9.6 m canopy.
  const boundaryZ = 129.04;
  const fieldSpruceCover = (u, v) => {
    const z = coverRect[1] + v / coverRect[3];
    return z < boundaryZ ? [0, 25, 1] : [0, 0, 2];
  };
  const standToStandCover = (u, v) => {
    const x = coverRect[0] + u / coverRect[2];
    return x < -7108 ? [0, 25, 1] : [175, 75, 1];
  };
  const class9Cover = (u, v) => {
    const z = coverRect[1] + v / coverRect[3];
    return z < boundaryZ ? [25, 50, 9] : [0, 0, 2];
  };

  for (const flags of [[], ['GROUND_CLASSES'], ['LOW'], ['LOW', 'GROUND_CLASSES']]) {
    const evalShares = buildSharesEvaluator(shaderSource, flags);

    // 1. Repro at E 617163, N 5103171.96: 2 cm step across the forest/field boundary must stay smooth.
    const north = evalShares({ x: -7108, y: boundaryZ - 0.01 }, 0.5, coverRect, fieldSpruceCover);
    const south = evalShares({ x: -7108, y: boundaryZ + 0.01 }, 0.5, coverRect, fieldSpruceCover);
    assert.ok(Math.abs(north.x - south.x) < 0.01 && Math.abs(north.y - south.y) < 0.01,
      `hard palette jump across forest/field boundary (${flags}): ${JSON.stringify({ north, south })}`);

    // 2. Continuous 0.1 m scan across +/-40 m across the boundary: no step may jump anywhere.
    let prev = evalShares({ x: -7108, y: boundaryZ - 40 }, 0.5, coverRect, fieldSpruceCover);
    for (let i = -399; i <= 400; i++) {
      const dy = i * 0.1;
      const cur = evalShares({ x: -7108, y: boundaryZ + dy }, 0.5, coverRect, fieldSpruceCover);
      assert.ok(Math.abs(cur.x - prev.x) < 0.025 && Math.abs(cur.y - prev.y) < 0.025,
        `hard jump at dy=${dy.toFixed(1)} (${flags}): ${JSON.stringify({ prev, cur })}`);
      prev = cur;
    }
    assert.ok(prev.x > 0.25 && prev.y > 0.35, 'deep field side reaches yard/fence palette');

    // 3. Deep interior preservation: spruce stand keeps (0.00, 0.10), deep field keeps (0.30, 0.40).
    const deepSpruce = evalShares({ x: -7108, y: boundaryZ - 100 }, 0.5, coverRect, fieldSpruceCover);
    assert.ok(Math.abs(deepSpruce.x - 0.0) < 1e-5 && Math.abs(deepSpruce.y - 0.10) < 1e-5,
      `deep spruce palette drifted: ${JSON.stringify(deepSpruce)}`);
    const deepField = evalShares({ x: -7108, y: boundaryZ + 100 }, 0.5, coverRect, fieldSpruceCover);
    assert.ok(Math.abs(deepField.x - 0.30) < 1e-5 && Math.abs(deepField.y - 0.40) < 1e-5,
      `deep field palette drifted: ${JSON.stringify(deepField)}`);

    // 4. Stand-to-stand boundary stays smooth across 2 cm step.
    const left = evalShares({ x: -7108.01, y: 0 }, 0.5, coverRect, standToStandCover);
    const right = evalShares({ x: -7107.99, y: 0 }, 0.5, coverRect, standToStandCover);
    assert.ok(Math.abs(left.x - right.x) < 0.01 && Math.abs(left.y - right.y) < 0.01,
      `hard jump across stand boundary (${flags}): ${JSON.stringify({ left, right })}`);

    // 5. Class 9 (with GROUND_CLASSES) keeps stand palette deep inside and blends smoothly to class 2.
    if (flags.includes('GROUND_CLASSES')) {
      const deep9 = evalShares({ x: -7108, y: boundaryZ - 100 }, 0.5, coverRect, class9Cover);
      assert.ok(Math.abs(deep9.x - 0.10) < 1e-5 && Math.abs(deep9.y - 0.20) < 1e-5,
        `class 9 stand palette wrong: ${JSON.stringify(deep9)}`);
      const n9 = evalShares({ x: -7108, y: boundaryZ - 0.01 }, 0.5, coverRect, class9Cover);
      const s9 = evalShares({ x: -7108, y: boundaryZ + 0.01 }, 0.5, coverRect, class9Cover);
      assert.ok(Math.abs(n9.x - s9.x) < 0.01 && Math.abs(n9.y - s9.y) < 0.01,
        `hard jump across class 9 / field boundary: ${JSON.stringify({ n9, s9 })}`);
    }

    // 6. Outside cover image uses regional hardwood shares, and perimeter fades smoothly.
    const outsideLow = evalShares({ x: coverRect[0] - 500, y: 0 }, 0.0, coverRect, fieldSpruceCover);
    const outsideHigh = evalShares({ x: coverRect[0] - 500, y: 0 }, 1.0, coverRect, fieldSpruceCover);
    assert.ok(outsideLow.x === 0 && outsideLow.y === 0, 'outside pure conifer');
    assert.ok(Math.abs(outsideHigh.x - 0.45) < 1e-5 && Math.abs(outsideHigh.y - 0.55) < 1e-5, 'outside hardwood');
    const perimIn = evalShares({ x: coverRect[0] + 0.01, y: 0 }, 0.5, coverRect, fieldSpruceCover);
    const perimOut = evalShares({ x: coverRect[0] - 0.01, y: 0 }, 0.5, coverRect, fieldSpruceCover);
    assert.ok(Math.abs(perimIn.x - perimOut.x) < 0.01 && Math.abs(perimIn.y - perimOut.y) < 0.01,
      `hard jump at cover perimeter (${flags}): ${JSON.stringify({ perimIn, perimOut })}`);
  }

  // 7. water-source-check must count textureLod calls in LOW + COAST_SHORE.
  const lodMutant = shaderSource.replace(
    'coastSurface(p, vGround, fine, dist, albedo, n);',
    'coastSurface(p, vGround, fine, dist, albedo, n);\n  albedo += textureLod(tCover, cuv, 0.0).rgb * 0.0;'
  );
  assert.notEqual(lodMutant, shaderSource, 'textureLod mutant applied');
  assert.throws(() => compareWaterShaders(lodMutant, shaderSource, () => {}),
    /COAST_SHORE must not add texture reads/, 'water-source-check counts textureLod');
}

verify(source);
console.log('PASS far-forest palette continuity across forest/field, stand/stand, class-9 and cover perimeter; canopy mask and textureLod guard verified');

if (process.argv.includes('--mutations')) {
  // Mutant 1: collapse the 16 m bilinear lattice to a single nearest-texel lookup (restores hard edge).
  const singleTap = source.replace(
    'return mix(mix(s00, s10, f.x), mix(s01, s11, f.x), f.y);',
    'return coverShares(world, hardwood);'
  );
  assert.notEqual(singleTap, source, 'single-tap mutant applied');
  assert.throws(() => verify(singleTap), /hard palette jump/, 'single-tap unblended mutant must fail');
  console.log('PASS rejected mutant single-tap-unblended');

  // Mutant 2: drop the smoothstep blend weights in canopyShares (step at 0.5 recreates a hard lattice edge).
  const blendAnchor = 'vec2 q0 = floor(q), f = q - q0;\n  f = f * f * (3.0 - 2.0 * f);';
  assert.equal(source.split(blendAnchor).length, 2, 'unique canopyShares blend anchor');
  const hardLattice = source.replace(
    blendAnchor,
    'vec2 q0 = floor(q), f = q - q0;\n  f = vec2(step(0.5, f.x), step(0.5, f.y));'
  );
  assert.notEqual(hardLattice, source, 'hard-lattice mutant applied');
  assert.throws(() => verify(hardLattice), /hard jump/, 'hard-lattice mutant must fail');
  console.log('PASS rejected mutant hard-lattice');

  // Mutant 3: treat class 9 as field under GROUND_CLASSES.
  const dropClass9 = source.replace('k > 1.5 && k != 9.0', 'k > 1.5');
  assert.notEqual(dropClass9, source, 'drop-class9 mutant applied');
  assert.throws(() => verify(dropClass9), /class 9 stand palette wrong/, 'drop-class9 mutant must fail');
  console.log('PASS rejected mutant drop-class9');
}
