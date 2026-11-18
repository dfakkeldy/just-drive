import { PropertyGate, PropertyPlanner, PROPERTY_FETCH_OPTIONS, type PropertyRequest } from './property-lines-rules';

export interface PropertyPicture<T> { image: T; url: string }
export interface PropertyImageIO<T> {
  fetch: typeof fetch;
  createURL(blob: Blob): string;
  revokeURL(url: string): void;
  decode(url: string): Promise<T>;
  online(): boolean;
  failure(): void;
}
interface Transfer { controller: AbortController; timer?: ReturnType<typeof setTimeout>; url?: string }

/** Owns every URL until the planner takes it. Late completions retain their original request identity. */
export class PropertyImages<T> {
  readonly planner: PropertyPlanner<PropertyPicture<T>>;
  private active = new Map<PropertyRequest, Transfer>();
  constructor(gate: PropertyGate, private io: PropertyImageIO<T>) {
    this.planner = new PropertyPlanner(gate, picture => io.revokeURL(picture.url));
  }
  private dispose(transfer: Transfer): void {
    if (transfer.url) { this.io.revokeURL(transfer.url); transfer.url = undefined; }
  }
  private abort(request: PropertyRequest, transfer: Transfer): void {
    transfer.controller.abort(); clearTimeout(transfer.timer); this.dispose(transfer);
    if (this.active.get(request) === transfer) this.active.delete(request);
    this.planner.release(request);
  }
  cancel(): void {
    for (const [request, transfer] of this.active) this.abort(request, transfer);
    this.planner.cancelPending();
  }
  clear(): void { this.cancel(); this.planner.clear(); }
  async load(request: PropertyRequest): Promise<void> {
    if (!this.planner.isCurrent(request)) return;
    for (const [old, transfer] of this.active) if (old.id < request.id) this.abort(old, transfer);
    const transfer: Transfer = { controller: new AbortController() }; this.active.set(request, transfer);
    const current = () => this.active.get(request) === transfer && !transfer.controller.signal.aborted && this.planner.isCurrent(request);
    transfer.timer = setTimeout(() => { const latest = current(); this.abort(request, transfer); if (latest) this.io.failure(); }, 12000);
    try {
      if (!this.io.online()) throw Error('offline');
      const response = await this.io.fetch(request.url, { ...PROPERTY_FETCH_OPTIONS, signal: transfer.controller.signal });
      if (!response.ok || !response.headers.get('Content-Type')?.startsWith('image/png')) throw Error('not an image');
      const blob = await response.blob();
      if (!current()) return;
      transfer.url = this.io.createURL(blob);
      const image = await this.io.decode(transfer.url);
      if (!current()) return;
      this.planner.complete(request, { image, url: transfer.url }); transfer.url = undefined;
    } catch { if (current()) this.io.failure(); }
    finally {
      clearTimeout(transfer.timer); this.dispose(transfer);
      if (this.active.get(request) === transfer) this.active.delete(request);
      this.planner.release(request);
    }
  }
}
