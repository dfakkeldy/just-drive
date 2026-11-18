import { tripId } from './quarry-trip';
import { AREAS, readArea, type Area } from './area';
import { areaScreen } from './area-screen';
import { areaAddress, readSite } from './site';

export const SITE = readSite(location.hostname, location.pathname, new URLSearchParams(location.search));
export async function siteArea(params: URLSearchParams): Promise<Area> {
  if (SITE.brand !== 'just') return readArea(params);
  document.querySelector('link[rel="manifest"]')?.setAttribute('href', '/manifest-just.webmanifest');
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', 'Just Drive: Mabou');
  document.querySelector('link[rel="icon"]')?.setAttribute('href', 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"%3E%3Crect width="64" height="64" rx="12" fill="%230b1620"/%3E%3Cpath d="M12 64L25 0h14l13 64M32 4v12m0 12v12m0 12v12" stroke="%23eef2f6" fill="none" stroke-width="3"/%3E%3C/svg%3E');
  SITE.area=readSite(location.hostname,location.pathname,params).area;
  if (!SITE.area) return areaScreen('This place does not exist yet. Choose a place to drive.');
  const area = AREAS.find(area => area.id === (tripId(params) ? params.get('area') : SITE.area))!;
  document.title = `Just Drive: ${area.name}`;
  document.querySelector('meta[name="description"]')?.setAttribute('content', `Drive around the real land near ${area.name}, Cape Breton.`);
  for (const name of ['page', 'offline-bytes']) {
    const value = document.querySelector<HTMLMetaElement>(`meta[name="mmm-just-${name}"]`)?.content;
    if (value) document.querySelector(`meta[name="mmm-${name}"]`)?.setAttribute('content', value);
  }
  const boot = document.getElementById('boot');
  if (boot) boot.textContent = `Just Drive: ${area.name} · Loading the land…`;
  const panel = document.getElementById('settings');
  if (panel) {
    const label = document.createElement('label'); label.textContent = 'Place';
    const select = document.createElement('select'); select.id = 'siteArea'; select.style.cssText = 'min-height:44px;width:100%;font:inherit';
    for (const place of AREAS.filter(a => a.id !== 'fixture')) select.add(new Option(place.name, place.id, false, place.id === area.id));
    select.addEventListener('change', () => { location.href = areaAddress(SITE, select.value, location.pathname, new URLSearchParams(location.search)); });
    label.append(select); panel.append(label);
  }
  return area;
}
