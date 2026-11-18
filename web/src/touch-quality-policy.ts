// All saved-session and frame decisions are pure: state in, event in, state and action out.
export type SavedDetail = 'low' | 'high' | null;
export type SessionMark = null | 'try' | 'ok' | 'left-try' | 'left-ok';
export type Recovery = null | 'device' | 'unfinished';
export interface QualityState {
  mark: SessionMark; unfinished: number; deaths: number; reason: Recovery;
  skipNext: boolean; good: number; slow: number; time: number; frames: number;
}
export type QualityEvent = { type: 'start' | 'hide' | 'leave' | 'show' | 'healthy' | 'lost' | 'crawl' | 'reset' }
  | { type: 'frame'; dt: number; settled: boolean; visible: boolean };
export type QualityAction = 'none' | 'write' | 'fallback';
export const initialQuality = (mark: SessionMark = null, unfinished = 0, deaths = 0): QualityState =>
  ({ mark, unfinished, deaths, reason: null, skipNext: false, good: 0, slow: 0, time: 0, frames: 0 });
const pause = (s: QualityState): QualityState => ({ ...s, good: 0, slow: 0, time: 0, frames: 0 });

export function qualityTransition(before: QualityState, event: QualityEvent): { state: QualityState; action: QualityAction } {
  let s = { ...before };
  const write = () => ({ state: s, action: 'write' as const });
  const fallback = (reason: Exclude<Recovery, null>) => ({ state: { ...initialQuality(), reason }, action: 'fallback' as const });
  if (event.type === 'reset') return { state: initialQuality(), action: 'write' };
  if (s.reason) return { state: s, action: 'none' };
  if (event.type === 'start') {
    if (s.mark === 'try') return fallback('device');
    if (s.mark === 'ok') { s.deaths++; if (s.deaths >= 2) return fallback('device'); }
    if (s.mark === 'left-try') { s.unfinished++; if (s.unfinished >= 3) return fallback('unfinished'); }
    if (s.mark === 'left-ok') { s.unfinished = 0; s.deaths = 0; }
    s = { ...pause(s), mark: 'try' };
    return write();
  }
  // Inactive/forced/phone sessions have no lifecycle transitions.
  if (s.mark === null) return { state: s, action: 'none' };
  switch (event.type) {
    case 'hide': case 'leave':
      s = { ...pause(s), mark: s.mark === 'ok' || s.mark === 'left-ok' ? 'left-ok' : 'left-try', skipNext: true };
      return write();
    case 'show':
      s = { ...pause(s), mark: s.mark === 'ok' || s.mark === 'left-ok' ? 'ok' : 'try', skipNext: true };
      return write();
    case 'healthy':
      if (s.mark === 'try' || s.mark === 'ok') { s.mark = 'ok'; s.unfinished = 0; return write(); }
      return { state: s, action: 'none' };
    case 'lost': case 'crawl': return fallback('device');
    case 'frame': {
      if (s.skipNext) return { state: { ...pause(s), skipNext: false }, action: 'none' };
      if (!event.settled || !event.visible || s.mark.startsWith('left-') || !(event.dt > 0) || !Number.isFinite(event.dt))
        return { state: pause(s), action: 'none' };
      // Two-second averages. Twenty consecutive eligible seconds at >=20 fps establish health;
      // twelve below 15 fps restore phone detail, including after a healthy start.
      s.time += event.dt; s.frames++;
      if (s.time < 2 - 1e-6) return { state: s, action: 'none' };
      const rate = s.frames / s.time;
      s.slow = rate < 15 - 1e-6 ? s.slow + s.time : 0;
      s.good = rate >= 20 - 1e-6 ? s.good + s.time : 0;
      s.time = s.frames = 0;
      if (s.slow >= 12 - 1e-6) return qualityTransition(s, { type: 'crawl' });
      if (s.mark === 'try' && s.good >= 20 - 1e-6) return qualityTransition(s, { type: 'healthy' });
      return { state: s, action: 'none' };
    }
  }
}

export function qualityStart(touch: boolean, forced: string | null, saved: SavedDetail, writable: boolean, state: QualityState) {
  const guarded = touch && !forced && saved === 'high' && writable;
  const next = guarded ? qualityTransition(state, { type: 'start' }) : { state, action: 'none' as const };
  return { ...next, guarded: guarded && next.action !== 'fallback',
    low: forced ? forced === 'low' : next.action === 'fallback' || saved === 'low' || touch && (saved !== 'high' || !writable) };
}
