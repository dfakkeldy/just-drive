import { GATE_RADIUS, RACE_LIMIT, emptyRace, readRoute, type RaceState } from '../../web/src/mp/race-wire';
import { FLAG, readBody } from '../../web/src/mp/wire';
import type { Seat } from './room';
/** Casual room racing, not an anti-cheat service. The room checks ordered gates against accepted reports. */
export class Race {
  constructor(public state: RaceState = emptyRace()) {}
  join(id: number): void { if (!this.state.host) this.state.host = id; }
  leave(id: number, remaining: number[]): void {
    const s = this.state;
    const r = s.racers.find(r => r.id === id); if (r && r.time === null) r.out = true;
    if (s.host === id) { s.host = remaining[0] ?? 0; s.serial++; s.route = null; s.startAt = 0; s.racers = []; }
  }
  command(id: number, m: Record<string, unknown>, seats: Seat[], bounds: number, now: number): boolean {
    const s = this.state;
    if (id !== s.host) return false;
    if (m.action === 'cancel') { s.serial++; s.route = null; s.startAt = 0; s.racers = []; return true; }
    if (m.action === 'select') {
      const route = readRoute(m.route, bounds); if (!route) return false;
      s.serial++; s.route = route; s.startAt = 0; s.racers = []; return true;
    }
    if (m.action !== 'start' || !s.route || s.startAt) return false;
    const gate = s.route.gates[0];
    s.racers = seats.filter(p => p.last && (() => { const v = readBody(new DataView(p.last.buffer,p.last.byteOffset,p.last.byteLength),0); return Math.hypot(v.x-gate.x,v.z-gate.z) <= GATE_RADIUS && Math.hypot(v.vx,v.vz) < 1; })())
      .map(p => ({id:p.id,next:1,time:null,out:false}));
    if (!s.racers.some(p => p.id === id)) { s.racers = []; return false; }
    s.startAt = now + 5000; return true;
  }
  position(id: number, body: Uint8Array, now: number): boolean {
    const s = this.state, r = s.racers.find(p => p.id === id);
    if (!s.route || !s.startAt || !r || r.out || r.time !== null) return false;
    const p = readBody(new DataView(body.buffer, body.byteOffset, body.byteLength),0);
    const gate = s.route.gates[r.next];
    if (now - s.startAt > RACE_LIMIT || p.flags & FLAG.teleport
      || now < s.startAt && Math.hypot(p.x-s.route.gates[0].x,p.z-s.route.gates[0].z) > GATE_RADIUS) { r.out = true; return true; }
    if (now < s.startAt || !gate || Math.hypot(p.x-gate.x,p.z-gate.z) > GATE_RADIUS) return false;
    r.next++;
    if (r.next === s.route.gates.length) r.time = now - s.startAt;
    return true;
  }
  message(now: number): string { return JSON.stringify({t:'race',state:this.state,now}); }
}
