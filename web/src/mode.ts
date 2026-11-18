import { readSite, type Site } from './site';
/** 'fired' is Get Fired: the mail shift's route and clock, where complaints score. Never offered in Just Drive. */
export type GameMode = 'mail' | 'explore' | 'fired';
export const EXPLORE_TITLE = 'Driving Mabou';
const KEY = 'mmm.mode';
type ModeStore = Pick<Storage, 'getItem'>;
const valid = (value: string | null): value is GameMode => value === 'mail' || value === 'explore' || value === 'fired';

/** Called once at boot. Invalid queries do not erase a saved choice. Storage can be blocked. */
export function readMode(params: URLSearchParams, storage: () => ModeStore = () => localStorage, site?: Site): GameMode {
  if (site?.brand === 'just') return 'explore';
  const query = params.get('mode');
  if (valid(query)) return query;
  try { const saved = storage().getItem(KEY); if (valid(saved)) return saved; } catch { /* private window */ }
  return 'mail';
}

/** Keep an existing query honest; add a fallback only when the saved choice cannot be read back. */
export function chooseMode(mode: GameMode): void {
  if (readSite(location.hostname ?? '', location.pathname ?? '/', new URLSearchParams(location.search)).brand === 'just') return;
  let saved = false;
  try { localStorage.setItem(KEY, mode); saved = localStorage.getItem(KEY) === mode; } catch { /* query fallback */ }
  const query = new URLSearchParams(location.search);
  const hadTrip=query.has('trip');query.delete('trip');
  if (query.has('mode') || !saved || hadTrip) { query.set('mode', mode); location.search = query.toString(); }
  else location.reload();
}
