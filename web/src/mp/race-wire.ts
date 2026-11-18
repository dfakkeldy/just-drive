// Small, bounded race protocol. Positions still use the existing binary reports.
export interface Gate { x: number; z: number }
export interface RaceRoute { roadId: number; gates: Gate[] }
export interface Racer { id: number; next: number; time: number | null; out: boolean }
export interface RaceState { host: number; serial: number; route: RaceRoute | null; startAt: number; racers: Racer[] }
export const GATE_RADIUS = 12, RACE_LIMIT = 600000;
export const emptyRace = (): RaceState => ({ host: 0, serial: 0, route: null, startAt: 0, racers: [] });
export function readRoute(value: unknown, bounds: number): RaceRoute | null {
  const r = value as RaceRoute | null;
  if (!r || !Number.isSafeInteger(r.roadId) || r.roadId < 0 || !Array.isArray(r.gates) || r.gates.length < 3 || r.gates.length > 24) return null;
  if (!r.gates.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.z) && Math.abs(p.x) <= bounds && Math.abs(p.z) <= bounds)) return null;
  let length = 0;
  for (let i = 1; i < r.gates.length; i++) {
    const d = Math.hypot(r.gates[i].x - r.gates[i-1].x, r.gates[i].z - r.gates[i-1].z);
    if (d < 15 || d > 100) return null;
    length += d;
  }
  return length >= 100 && length <= 1000 ? { roadId: r.roadId, gates: r.gates.map(({x,z}) => ({x,z})) } : null;
}
export function readRace(text: string): { state: RaceState; now: number } | null {
  if (text.length > 8192) return null;
  try {
    const m = JSON.parse(text), s = m.state as RaceState;
    if (m.t !== 'race' || !Number.isFinite(m.now) || !s || !Number.isInteger(s.host) || !Number.isInteger(s.serial)
      || !Number.isFinite(s.startAt) || !Array.isArray(s.racers) || s.racers.length > 24
      || s.racers.some(r => !Number.isInteger(r.id) || !Number.isInteger(r.next) || r.next < 0 || r.next > 24
        || typeof r.out !== 'boolean' || r.time !== null && (!Number.isFinite(r.time) || r.time < 0 || r.time > RACE_LIMIT))) return null;
    const route = s.route === null ? null : readRoute(s.route, 1000000);
    if (s.route !== null && !route) return null;
    return { state: { host: s.host, serial: s.serial, route, startAt: s.startAt, racers: s.racers }, now: m.now };
  } catch { return null; }
}
