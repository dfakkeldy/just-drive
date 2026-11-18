#!/usr/bin/env bash
# Serve the game and take settled screenshots with a headless browser (tools/browser.sh picks it).
# Output: data/work/shots/<name>.png
# Usage: tools/art-shots.sh [width height] [extra query for every view, e.g. "exag=1"]
#   VIEWS="art-name|query ..." picks the views; defaults cover trees and the village.
#   tools/art-shots.sh --stats measures all baked trees and checks building geometry.
#   Example: VIEWS="art-drive-village|demo=7 art-seat|demo=7&view=seat" tools/art-shots.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tools/browser.sh"
# Recompute the real geometry budget without starting a browser.
if [[ "${1:-}" == "--stats" ]]; then
  cd "$ROOT/web"
  node --input-type=module <<'JS'
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
const source = fs.readFileSync('src/trees.ts', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
const compiled = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None });
const { treeGeometry, variantFor, Trees } = new Function('THREE', 'mergeGeometries', compiled + '; return {treeGeometry, variantFor,Trees};')(THREE, mergeGeometries);
const triangles = [];
for (let kind = 0; kind < 5; kind++) {
  const row = [], nearRow = [];
  for (const near of [false, true]) for (let variant = 0; variant < 4; variant++) {
    const g = treeGeometry(kind, variant, variant === 3, near);
    const target = near ? nearRow : row;
    target.push((g.index?.count ?? g.getAttribute('position').count) / 3);
    for (const attribute of Object.values(g.attributes)) {
      if ([...attribute.array].some(x => !Number.isFinite(x))) throw new Error('Non-finite tree geometry');
    }
    g.computeBoundingBox();
    if (Math.abs(g.boundingBox.max.y - 1) > 1e-5) throw new Error('Tree height changed');
    const radius = Math.max(Math.abs(g.boundingBox.min.x), g.boundingBox.max.x,
      Math.abs(g.boundingBox.min.z), g.boundingBox.max.z);
    if (radius > 1.001 || radius < 0.70) throw new Error('Tree crown envelope changed');
    if (near && target.at(-1) > 500) throw new Error('Near tree exceeds 500 triangles');
    if (near && (kind === 1 || kind === 2) && variant !== 3) {
      // Every leaf mass is closed; a missing underside must not become a sky-coloured hole.
      const p = g.getAttribute('position'), leaf = g.getAttribute('leafTint'), edges = new Map();
      const key = i => [p.getX(i), p.getY(i), p.getZ(i)].map(x => Math.round(x * 1e6)).join(',');
      for (let i = 0; i < p.count; i += 3) if (leaf.getX(i) >= 1) {
        for (const [a, b] of [[i, i + 1], [i + 1, i + 2], [i + 2, i]]) {
          const edge = [key(a), key(b)].sort().join('|');
          edges.set(edge, (edges.get(edge) ?? 0) + 1);
        }
      }
      // No leaf mass at all would pass the closure test with nothing to test.
      if (edges.size === 0) throw new Error('A near hardwood has no leaf mass');
      if ([...edges.values()].some(n => n !== 2)) throw new Error('Open hardwood leaf mass');
    }
    g.dispose();
  }
  triangles.push(...row);
  console.log(['spruce/fir', 'maple', 'birch/aspen', 'larch', 'shrub'][kind],
    'far:', row.join(' / '), 'near (within 75 m, desktop only):', nearRow.join(' / '));
}
let total = 0, trees = 0;
const counts = new Array(20).fill(0);
for (const file of fs.readdirSync('../data/baked/terrain/8').filter(f => f.endsWith('.t.bin'))) {
  const data = fs.readFileSync(path.join('../data/baked/terrain/8', file));
  for (let offset = 0; offset + 7 < data.length; offset += 8) {
    const variant = variantFor(data[offset + 6], data[offset + 7], data[offset + 4] * 0.2);
    counts[variant]++; trees++; total += triangles[variant];
  }
}
console.log(JSON.stringify({ trees, triangles: total, average: total / trees, variantCounts: counts }, null, 2));
if (total / trees >= 60) throw new Error('Tree triangle budget exceeded');
console.log('Near geometry cap: 500 triangles; transition: 45–75 m; phone uses far geometry only.');
// Inspect the emitted program, so leaf shading cannot quietly reintroduce near alpha cutouts.
const model = new Trees([], '', { low: false });
const program = material => {
  const shader = { vertexShader: THREE.ShaderLib.lambert.vertexShader,
    fragmentShader: THREE.ShaderLib.lambert.fragmentShader, uniforms: {} };
  material.onBeforeCompile(shader); return shader;
};
const nearProgram = program(model.nearMaterial), farProgram = program(model.farMaterial);
if ((nearProgram.fragmentShader.match(/diffuseColor\.a\s*[*+/-]?=/g) ?? []).length !== 1 ||
    /\bdiscard\b/.test(nearProgram.fragmentShader)) throw new Error('Near crown has a non-LOD alpha cutout');
if (!nearProgram.vertexShader.includes('smoothstep(45.0, 75.0, distance(treeEye, treeBase.xyz))')) throw new Error('Tree fade band changed');
if (model.nearMaterial.side !== THREE.DoubleSide) throw new Error('Near leaf undersides are culled');
const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const coverage = shader => new Function('vTreeFade', 'smoothstep',
  'return ' + shader.fragmentShader.match(/diffuseColor\.a \*= ([^;]+);/)[1]);
const nearCoverage = coverage(nearProgram), farCoverage = coverage(farProgram);
for (let d = 0; d <= 80; d += 0.25) {
  const fade = smoothstep(45, 75, d), n = nearCoverage(fade, smoothstep), f = farCoverage(fade, smoothstep);
  if (d <= 45 && n !== 1) throw new Error('Near crown is not fully covered');
  if (Math.max(n, f) < 1) throw new Error('LOD fade has a coverage gap');
  // Each shape must also leave: the far one is absent up to 45 m, the near one from 75 m. Inside the band the far
  // shape comes in during the first half while the near one stays solid, and the near shape goes out during the
  // second half while the far one stays solid. Two shapes that both stayed solid would be drawn on top of each other.
  if (d <= 45 && f !== 0) throw new Error('Far crown shows inside the near range');
  if (d >= 75 && n !== 0) throw new Error('Near crown shows beyond the fade band');
  if (fade > 0.05 && fade < 0.45 && !(f > 0 && f < 1 && n === 1)) throw new Error('The far crown does not fade in during the first half of the band');
  if (fade > 0.55 && fade < 0.95 && !(n > 0 && n < 1 && f === 1)) throw new Error('The near crown does not fade out during the second half of the band');
}
console.log('PASS: closed hardwood masses; solid near coverage through 45 m; alpha changes only in the LOD band; overlapping fades stay covered.');
const buildingSource = fs.readFileSync('src/buildings.ts', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
const { Buildings } = new Function('THREE', ts.transpile(buildingSource, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }) + '; return {Buildings};')(THREE);
const list = JSON.parse(fs.readFileSync('../data/baked/terrain/buildings.json', 'utf8')).buildings;
const manifest = JSON.parse(fs.readFileSync('../data/baked/terrain/manifest.json', 'utf8'));
const { styles } = JSON.parse(fs.readFileSync('../data/baked/terrain/building-styles.json', 'utf8'));
let buildingTriangles = 0, styledBuildingTriangles = 0;
for (const building of list) {
  const model = new Buildings([building], manifest.village, 1.5, -0.2);
  const geo = model.mesh.geometry, p = geo.getAttribute('position');
  for (const attribute of Object.values(geo.attributes)) {
    if ([...attribute.array].some(x => !Number.isFinite(x))) throw new Error('Non-finite building geometry');
  }
  // The first four wall quads remain the measured rectangle, before facade detail.
  const base = -0.2 + (building.ground + 0.2) * 1.5;
  for (let i = 0; i < 24; i++) {
    const y = p.getY(i) - base;
    if (Math.min(Math.abs(y + 3), Math.abs(y - building.eave)) > 0.001) throw new Error('Measured wall height changed');
    const angle = building.axisDeg * Math.PI / 180;
    const dx = p.getX(i) - building.x + manifest.village[0];
    const dz = p.getZ(i) - manifest.village[1] + building.y;
    const u = dx * Math.sin(angle) - dz * Math.cos(angle);
    const v = dx * Math.cos(angle) + dz * Math.sin(angle);
    if (Math.abs(Math.abs(u) - building.length / 2) > 0.002 || Math.abs(Math.abs(v) - building.width / 2) > 0.002) throw new Error('Measured wall footprint changed');
  }
  buildingTriangles += p.count / 3;
  const styled = new Buildings([building], manifest.village, 1.5, -0.2, styles);
  styledBuildingTriangles += styled.triangles;
  styled.mesh.geometry.dispose(); styled.mesh.material.dispose();
  geo.dispose(); model.mesh.material.dispose();
}
console.log(JSON.stringify({ buildings: list.length, buildingTriangles, styledBuildingTriangles, drawCalls: 1, finiteGeometry: true, measuredWalls: true }));
JS
  exit
fi
browser_ports "$@"
W="${1:-1280}"; H="${2:-900}"; Q="${3:-}"
OUT="$ROOT/data/work/shots"; mkdir -p "$OUT"
cd "$ROOT/web"
mem_report
browser_typecheck
# The dev server reads the baked tiles through the public/terrain link, so nothing is copied.
start_check "$W" "$H" dev
URLS=()
for v in ${VIEWS:-art-drive-village|demo=7 art-drive-harbour|demo=10&road=Mabou%20Harbour%20Road&f=0.35 art-air-village|shot=2}; do
  URLS+=("http://127.0.0.1:$WEB/?name=${v%%|*}&${v#*|}&hud=${HUD:-0}${Q:+&$Q}")
done
CDP_PORT="$CDP" run_check node "$ROOT/tools/${RUN:-shot.mjs}" "$OUT" "${URLS[@]}"
