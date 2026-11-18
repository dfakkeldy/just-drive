/** Address policy only: no browser, storage, asset paths or game startup. */
import { AREAS } from './area';
import { HISTORY_AREAS, historyArea } from './eras/history-areas';
export const SITE_AREAS = AREAS.map(area => area.id);
export type SiteArea = typeof SITE_AREAS[number];
export interface Site { brand: 'mail' | 'just'; area: SiteArea | null; era?: '1884' }
export function readSite(hostname: string, pathname: string, params = new URLSearchParams()): Site {
  const host = hostname.toLowerCase();
  const just = host.split('.')[0] === 'justdrive' || (host === 'localhost' && params.get('site') === 'just');
  if (!just) return { brand: 'mail', area: null };
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length > 1) return { brand: 'just', area: null };
  const segment = segments[0];
  const id = (segment ?? 'mabou').toLowerCase();
  const era = Object.values(HISTORY_AREAS).find(a => a.address === id);
  if (id === 'sugar-camp-quarry') return { brand: 'just', area: 'westbay' };
  if (era) return { brand: 'just', area: era.id, era: '1884' };
  return { brand: 'just', area: SITE_AREAS.find(area => area === id) ?? null };
}
/** One choice for the list and both saved radio settings; never fall back between brands. */
export const siteRadio = (site: Site): { list?: string; storageKey?: string } => site.brand === 'just' ? { list: 'radio-just.json', storageKey: 'mmm.radio.just' } : {};
/** Caller keeps its origin. A Just Drive area always uses a root path, without a trailing slash. */
export function areaAddress(site: Site, id: string, pathname: string, params: URLSearchParams): string {
  const query = new URLSearchParams(params);
  query.delete('trip');
  query.delete('driveAt'); // A deliberate area change starts in that area's coordinates.
  query.delete('start'); // A road name can exist in two areas: a start link belongs to the area it was made for.
  query.delete('poster'); // The Sugar Camp Quarry poster start belongs to West Bay.
  if (site.brand === 'just') query.delete('area'); else query.set('area', id);
  const path = site.brand === 'just' ? `/${id}` : pathname;
  return path + (query.size ? `?${query}` : '');
}

/** Era doors use the same clean-navigation convention as an area change. */
export function eraAddress(site: Site, historical: boolean, pathname: string, params: URLSearchParams): string {
  const query = new URLSearchParams(params);
  query.delete('era');
  const area = historyArea(site.area) ?? HISTORY_AREAS.mabou;
  return areaAddress(site, historical ? area.address : area.id, pathname, query);
}

/** Clean cross-brand destination. Both games support query-based 1884 on the mail host. */
export function otherGameAddress(site: Site): string {
  const target: Site = { brand: site.brand === 'mail' ? 'just' : 'mail', area: site.area };
  const origin = target.brand === 'just' ? 'https://justdrive.fakkeldy.ca' : 'https://mmm.fakkeldy.ca';
  if (site.era) {
    const historical = historyArea(site.area);
    if (!historical) return origin + '/';
    return origin + (target.brand === 'just'
      ? eraAddress(target, true, '/', new URLSearchParams())
      : areaAddress(target, historical.id, '/', new URLSearchParams({ era: '1884' })));
  }
  return origin + (target.brand === 'just' && site.area
    ? areaAddress(target, site.area, '/', new URLSearchParams()) : '/');
}
