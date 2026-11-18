/** Live pictures only. No features, identifiers, attributes or persistent image storage. */
export const PROPERTY_LICENSE_URL = 'https://nsgiwa.novascotia.ca/documents/licenses/MapService/Restricted%20Map%20Services%20License%20-%20NSPRD%20v1.pdf';
export const PROPERTY_ACCEPTANCE_KEY = 'mmm:province-license:v1';
export const PROPERTY_ATTRIBUTION = 'Contains information obtained under license from the Province of Nova Scotia which is provided without warranty or liability for errors or omissions.';
export const PROPERTY_DISCLAIMER = `The Province of Nova Scotia makes no representations, expressed or implied, as to the accuracy, completeness and timeliness of the information, maps and other data, including PID numbers or property boundaries, which are displayed in this map that is presented in this application.

The map is provided on the understanding that it is not guaranteed to be correct or complete or current, is subject to change, and conclusions drawn or decisions made, based on an interpretation of the data, are the responsibility of the user.

By continuing to use this application, you agree to the terms of this disclaimer.`;
/** Our own words, shown above the Province's disclaimer and before "I agree": what the layer sends, and to whom. */
export const PROPERTY_REQUEST_NOTE = "With this layer on, the game asks the Province of Nova Scotia's map service for a picture of the property lines around the place your map shows, or around your car in ground mode. So each request tells the Province's server which part of the map you are looking at (where you are in the game), together with your internet address, as any visit to a website does. The game sends no name, no account and no cookie. Nothing is sent before you agree, or while the layer is off.";
export const PROPERTY_UNAVAILABLE = 'Property lines are not available right now';
export const PROPERTY_SERVICE = 'https://nsgiwa2.novascotia.ca/arcgis/rest/services/PLAN/PLAN_NSPRD_WM84/MapServer';
// The service has one polygon layer (0). Replace its symbol, suppress all labels, and draw no fill.
export const PROPERTY_DYNAMIC_LAYERS = [{ id: 0, source: { type: 'mapLayer', mapLayerId: 0 }, drawingInfo: {
  showLabels: false, labelingInfo: [], renderer: { type: 'simple', symbol: {
    type: 'esriSFS', style: 'esriSFSNull', outline: { type: 'esriSLS', style: 'esriSLSSolid', color: [147, 205, 190, 210], width: 0.8 },
  } },
} }];
export const PROPERTY_CACHE_CAP = 8;
export const PROPERTY_MAX_FLIGHT = 2;
export const PROPERTY_DEBOUNCE_MS = 350;
export const PROPERTY_INTERVAL_MS = 5000;
export const PROPERTY_RETRY_MS = 60000;
export const PROPERTY_FETCH_OPTIONS = { cache: 'no-store', credentials: 'omit', mode: 'cors', referrerPolicy: 'no-referrer' } as const;
export interface PropertyStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }

export class PropertyGate {
  accepted = false;
  enabled = false; // Always off on a new page, including after remembered agreement.
  pending = false;
  failed = false;
  private noticed = false;
  private retryAt = 0;
  constructor(readonly modern: boolean, private storage?: PropertyStorage) {
    try { this.accepted = storage?.getItem(PROPERTY_ACCEPTANCE_KEY) === 'accepted'; } catch { /* Ask this session. */ }
  }
  get canRequest(): boolean { return this.modern && this.enabled && this.accepted && !this.failed; }
  choose(on: boolean, now = 0): void {
    this.pending = false;
    // Only an explicit on choice can retry; the frame loop never clears a failure.
    if (on && this.failed && now >= this.retryAt) this.failed = false;
    this.enabled = on && this.modern && this.accepted && !this.failed;
    if (on && this.modern && !this.accepted && !this.failed) this.pending = true;
  }
  agree(): void {
    if (!this.pending || !this.modern || this.failed) return;
    this.accepted = true; this.pending = false; this.enabled = true;
    try { this.storage?.setItem(PROPERTY_ACCEPTANCE_KEY, 'accepted'); } catch { /* Agreement lasts this session. */ }
  }
  fail(now = 0): boolean {
    if (!this.failed) this.retryAt = now + PROPERTY_RETRY_MS;
    this.failed = true; this.enabled = false; this.pending = false;
    if (this.noticed) return false;
    this.noticed = true; return true;
  }
}

/** Absolute EPSG:2961 metres: east/north, rather than the game's south-positive z. */
export interface PropertyBox { west: number; south: number; east: number; north: number }
export function propertyViewBox(b: { x0: number; z0: number; x1: number; z1: number }, origin: readonly [number, number]): PropertyBox {
  return { west: origin[0] + b.x0, south: origin[1] - b.z1, east: origin[0] + b.x1, north: origin[1] - b.z0 };
}
export function propertyWorldRect(b: PropertyBox, origin: readonly [number, number]): [number, number, number, number] {
  return [b.west - origin[0], origin[1] - b.north, b.east - b.west, b.north - b.south];
}
export interface PropertyRequest { id: number; key: string; box: PropertyBox; safe: PropertyBox; range: number; url: string }
export function propertyBox(view: PropertyBox): PropertyBox {
  // Round the requested picture out to 100 m.
  return { west: Math.floor(view.west / 100) * 100, south: Math.floor(view.south / 100) * 100,
    east: Math.ceil(view.east / 100) * 100, north: Math.ceil(view.north / 100) * 100 };
}
const boxKey = (b: PropertyBox) => `${b.west},${b.south},${b.east},${b.north}`;
export function propertyCoverage(view: PropertyBox): { box: PropertyBox; safe: PropertyBox } {
  const halfWidth = (view.east - view.west) / 2, halfHeight = (view.north - view.south) / 2;
  const grow = (fraction: number) => propertyBox({ west: view.west - halfWidth * fraction, east: view.east + halfWidth * fraction,
    south: view.south - halfHeight * fraction, north: view.north + halfHeight * fraction });
  // 116 cells * 11 pixels fit below 1280. Rounding is included in the margin search.
  const fits = (b: PropertyBox) => Math.max(b.east - b.west, b.north - b.south) <= Math.floor(1280 / 11) * 100;
  let fraction = 1;
  if (!fits(grow(fraction))) {
    let low = 0, high = 1;
    for (let i = 0; i < 24; i++) { const mid = (low + high) / 2; if (fits(grow(mid))) low = mid; else high = mid; }
    fraction = low;
  }
  const box = grow(fraction), rimX = halfWidth * fraction * 0.1, rimY = halfHeight * fraction * 0.1;
  return { box, safe: { west: box.west + rimX, east: box.east - rimX, south: box.south + rimY, north: box.north - rimY } };
}
export function propertyExportURL(box: PropertyBox): string {
  const cols = (box.east - box.west) / 100, rows = (box.north - box.south) / 100;
  // Exact aspect ratio. <=1280 px, <=9.1 m/px (1:34,360 at 96 DPI): within the service's 1:36,114 floor.
  const pixels = Math.min(64, Math.floor(1280 / Math.max(cols, rows)));
  if (pixels < 11 || cols <= 0 || rows <= 0) throw Error('Property view is too wide');
  const query = new URLSearchParams({ bbox: boxKey(box), bboxSR: '2961', imageSR: '2961',
    size: `${cols * pixels},${rows * pixels}`, dpi: '96', format: 'png32', transparent: 'true', f: 'image',
    dynamicLayers: JSON.stringify(PROPERTY_DYNAMIC_LAYERS) });
  return `${PROPERTY_SERVICE}/export?${query}`;
}
const contains = (outer: PropertyBox, view: PropertyBox) => outer.west <= view.west && outer.east >= view.east && outer.south <= view.south && outer.north >= view.north;

/** Clock and completion driven; no timers, DOM or network. One whole-view export, never one request per frame. */
export class PropertyPlanner<T> {
  readonly cache = new Map<string, { box: PropertyBox; safe: PropertyBox; range: number; image: T }>();
  readonly flight = new Map<string, PropertyRequest>();
  private candidate = '';
  private since = 0;
  private lastRequest = -Infinity;
  private serial = 0;
  constructor(readonly gate: PropertyGate, private dispose: (image: T) => void = () => {}) {}
  plan(view: PropertyBox | null, now: number, range = 0): PropertyRequest | null {
    if (!this.gate.canRequest || !view) { this.candidate = ''; return null; }
    const hit = [...this.cache].reverse().find(([, entry]) => entry.range === range && contains(entry.safe, view));
    if (hit) { this.cache.delete(hit[0]); this.cache.set(...hit); this.candidate = ''; return null; }
    if ([...this.flight.values()].some(entry => entry.range === range && contains(entry.safe, view))) { this.candidate = ''; return null; }
    const { box, safe } = propertyCoverage(view), key = `${range}:${boxKey(box)}`;
    if (key !== this.candidate) { this.candidate = key; this.since = now; }
    if (now - this.since < PROPERTY_DEBOUNCE_MS || now - this.lastRequest < PROPERTY_INTERVAL_MS
      || this.flight.has(key) || this.flight.size >= PROPERTY_MAX_FLIGHT) return null;
    const request = { id: ++this.serial, key, box, safe, range, url: propertyExportURL(box) };
    this.flight.set(key, request); this.lastRequest = now; return request;
  }
  isCurrent(request: PropertyRequest): boolean { return this.gate.canRequest && request.id === this.serial && this.flight.get(request.key) === request; }
  release(request: PropertyRequest): void { if (this.flight.get(request.key) === request) this.flight.delete(request.key); }
  complete(request: PropertyRequest, image: T): void {
    const current = this.flight.get(request.key) === request; this.release(request);
    if (!current || !this.gate.canRequest || request.id !== this.serial) { this.dispose(image); return; }
    this.cache.set(request.key, { box: request.box, safe: request.safe, range: request.range, image });
    while (this.cache.size > PROPERTY_CACHE_CAP) {
      const oldest = this.cache.keys().next().value!;
      this.dispose(this.cache.get(oldest)!.image); this.cache.delete(oldest);
    }
  }
  /** One picture only: overlapping cached pictures must not darken the same boundary twice. */
  picture(view: PropertyBox, range = 0): { box: PropertyBox; image: T } | undefined {
    if (!this.gate.canRequest) return;
    return [...this.cache.values()].reverse().find(entry => entry.range === range && contains(entry.box, view));
  }
  cancelPending(): void { this.serial++; this.flight.clear(); this.candidate = ''; }
  clear(): void {
    this.cancelPending();
    for (const { image } of this.cache.values()) this.dispose(image);
    this.cache.clear();
  }
}
