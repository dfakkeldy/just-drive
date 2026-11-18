import type { Road, Roads } from './roads';

// Nine-candidate sweep (2/4/6 px x 1.5/1.8/2.1): 4 px / 1.5 minimizes
// off-road metres + unfinished metres on two skills x highway/gravel. See check-phone.
export const THUMB_DEAD = 4, THUMB_POWER = 1.5;
export function thumbSteer(pixels: number, range: number): number {
  const x = Math.max(0, Math.min(1, (Math.abs(pixels) - THUMB_DEAD) / (range - THUMB_DEAD)));
  return Math.sign(pixels) * Math.pow(x, THUMB_POWER);
}

/** Fixed junction locations, built once. No centre-line attraction or per-frame objects. */
export class DrivingHelp {
  private readonly junctions: Float64Array;
  constructor(roads: Roads) {
    const points: number[] = [];
    if (!roads.roads) { this.junctions = new Float64Array(); return; }
    // Everything the car can drive on counts, the rail trail (kind 5) too: it crosses the highway on the level.
    for (const road of roads.roads ?? []) {
      for (const p of [road.pts[0], road.pts[road.pts.length - 1]]) {
        const hit = roads.nearest(p[0], p[1], 8, r => r !== road);
        if (hit) points.push(p[0], p[1]);
      }
    }
    // A crossing can lie inside BOTH polylines, with neither road ending there.
    // Index segments once, so those junctions also suppress help. Bridge crossings
    // are at different heights; their actual connections are covered above.
    const cells = new Map<string, number[]>(), segments: number[] = [], seen = new Set<string>();
    for (let ri = 0; ri < roads.roads.length; ri++) {
      const road = roads.roads[ri];
      if (road.bridge) continue;
      for (let si = 1; si < road.pts.length; si++) {
        const a = road.pts[si - 1], b = road.pts[si], dx = b[0] - a[0], dz = b[1] - a[1];
        const index = segments.length; segments.push(ri, si);
        for (let cz = Math.floor(Math.min(a[1], b[1]) / 64); cz <= Math.floor(Math.max(a[1], b[1]) / 64); cz++) {
          for (let cx = Math.floor(Math.min(a[0], b[0]) / 64); cx <= Math.floor(Math.max(a[0], b[0]) / 64); cx++) {
            const key = `${cx},${cz}`;
            let list = cells.get(key);
            if (!list) cells.set(key, list = []);
            for (const other of list) {
              if (segments[other] === ri) continue;
              const pts = roads.roads[segments[other]].pts, s = segments[other + 1], c = pts[s - 1], d = pts[s];
              const ex = d[0] - c[0], ez = d[1] - c[1], cross = dx * ez - dz * ex;
              if (Math.abs(cross) < 1e-8) continue;
              const qx = c[0] - a[0], qz = c[1] - a[1], t = (qx * ez - qz * ex) / cross, u = (qx * dz - qz * dx) / cross;
              if (t < 0 || t > 1 || u < 0 || u > 1) continue;
              const x = a[0] + dx * t, z = a[1] + dz * t, id = `${Math.round(x)},${Math.round(z)}`;
              if (!seen.has(id)) { seen.add(id); points.push(x, z); }
            }
            list.push(index);
          }
        }
      }
    }
    this.junctions = new Float64Array(points);
  }
  /** Fade out before every side road, including unnamed tracks; return after the junction. */
  clear(x: number, z: number): number {
    let d2 = 42 * 42;
    for (let i = 0; i < this.junctions.length; i += 2) {
      const dx = x - this.junctions[i], dz = z - this.junctions[i + 1];
      d2 = Math.min(d2, dx * dx + dz * dz);
    }
    return Math.max(0, Math.min(1, (Math.sqrt(d2) - 22) / 20));
  }
}

/** A tangent a short distance along this SAME road. Never chooses a road at a fork. */
export function forwardTangent(road: Road, seg: number, t: number, heading: number, look: number): number {
  const pts = road.pts, a = pts[seg], b = pts[seg + 1];
  const forward = Math.sin(heading) * (b[0] - a[0]) - Math.cos(heading) * (b[1] - a[1]) >= 0;
  let i = seg, left = look, fraction = t;
  while (true) {
    const p = pts[i], q = pts[i + 1], len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const available = len * (forward ? 1 - fraction : fraction);
    if (left <= available || (forward ? i === pts.length - 2 : i === 0)) {
      const next = forward ? Math.min(i + 1, pts.length - 2) : Math.max(i - 1, 0);
      const r = pts[next], s = pts[next + 1];
      // Blend adjacent tangents so the heading help does not step at 4 m sample vertices.
      const u = Math.max(0, Math.min(1, forward ? fraction + left / (len || 1) : 1 - fraction + left / (len || 1)));
      return Math.atan2((q[0] - p[0]) * (1 - u) + (s[0] - r[0]) * u, -(q[1] - p[1]) * (1 - u) - (s[1] - r[1]) * u);
    }
    left -= available; i += forward ? 1 : -1; fraction = forward ? 0 : 1;
  }
}

export function drivingHelpSetting(panel: HTMLElement | null, before: HTMLElement | null, set: (strong: boolean) => void): void {
  let strong = true;
  try { strong = localStorage.getItem('mmm.help') !== 'light'; } catch { /* this visit only */ }
  set(strong);
  if (!panel) return;
  const group = Object.assign(document.createElement('div'), { id: 'drivingHelp' });
  group.setAttribute('role', 'group'); group.setAttribute('aria-label', 'Driving help');
  group.style.cssText = 'margin-top:12px';
  const title = Object.assign(document.createElement('div'), { textContent: 'Driving help' });
  title.style.marginBottom = '6px';
  const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:6px';
  const buttons = ['Strong', 'Light'].map((name, i) => {
    const button = Object.assign(document.createElement('button'), { type: 'button', textContent: name });
    button.dataset.help = name.toLowerCase();
    button.style.cssText = 'flex:1;min-height:36px;border-radius:6px;border:1px solid #6b7780;color:inherit;font:inherit;cursor:pointer';
    button.addEventListener('click', () => {
      strong = i === 0; set(strong);
      try { localStorage.setItem('mmm.help', strong ? 'strong' : 'light'); } catch { /* this visit only */ }
      show();
    });
    return button;
  });
  const show = () => buttons.forEach((b, i) => { const on = strong === (i === 0); b.setAttribute('aria-pressed', String(on)); b.style.background = on ? '#3d6f8f' : 'none'; });
  row.append(...buttons); group.append(title, row); panel.insertBefore(group, before); show();
}
