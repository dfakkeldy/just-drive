import { tripParams, tripId, tripStorageKey, PARK_NOTICE } from './quarry-trip';
import { readSite, areaAddress } from './site';
import { AREAS } from './area';
/** Stop startup before constructing a world when the selected land is unavailable or mismatched. */
export function areaScreen(message: string, retry = false): Promise<never> {
  if (retry) {
    const query = new URLSearchParams(location.search), active = tripId(query);
    if (active) try { sessionStorage.removeItem(tripStorageKey(active)); } catch { /* private window */ }
    query.delete('trip');
    history.replaceState(history.state, '', location.pathname + '?' + query + location.hash);
  }
  const root = document.createElement('main');
  root.id = 'areaMessage';
  root.style.cssText = 'position:fixed;inset:0;display:grid;align-content:safe center;overflow:auto;justify-items:center;gap:20px;padding:24px;box-sizing:border-box;background:#0b1620;color:#eef2f6;font:20px/1.5 system-ui;text-align:center';
  root.append(Object.assign(document.createElement('p'), { textContent: message }));
  if(tripParams(new URLSearchParams(location.search)).get('area')==='westbay'||location.pathname==='/westbay')root.append(Object.assign(document.createElement('p'),{textContent:PARK_NOTICE}));
  if (retry) {
    const button = Object.assign(document.createElement('button'), {textContent:'Retry'});
    button.style.cssText = 'font:inherit;min-width:44px;min-height:44px;padding:8px 18px';
    button.onclick = () => location.reload(); root.append(button);
  }
  const site = readSite(location.hostname, location.pathname, new URLSearchParams(location.search));
  if (site.brand === 'just' || retry) {
    for (const area of AREAS.filter(a => a.id !== 'fixture')) {
      const link = Object.assign(document.createElement('a'), { textContent: `Just Drive: ${area.name}`, href: areaAddress(site, area.id, location.pathname, new URLSearchParams(location.search)) });
      link.style.cssText = 'color:#edb486;min-height:44px;display:grid;align-items:center'; root.append(link);
    }
  }
  const link = Object.assign(document.createElement('a'), { textContent: 'Back to Mabou', href: import.meta.env.BASE_URL });
  link.style.cssText = 'color:#edb486;min-height:44px;display:grid;align-items:center'; if (site.brand !== 'just') root.append(link);
  document.body.replaceChildren(root);
  document.title = site.brand === 'just' ? `Just Drive: ${message}` : message;
  return new Promise<never>(() => { /* No render loop or more asset requests after this screen. */ });
}
