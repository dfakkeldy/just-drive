// The sole storage boundary for detail, its session evidence/notice, and Picture choices.
// One intent per key: a newer value supersedes an older pending value, including removals.
type Value = string | null;
type Intent = { value: Value; pending: boolean; dependencies: string[] };
export class QualityStore {
  private intents = new Map<string, Intent>();
  private confirmed = new Map<string, Value>();
  private retryAt = 0;
  constructor(private clock: () => number) {}
  useClock(clock: () => number) { this.clock = clock; }
  /** Two agreeing reads out of at most three: one throw/stale read cannot select a different policy path. */
  read(key: string): Value | undefined {
    const seen: Value[] = [];
    for (let n = 0; n < 3; n++) {
      try {
        const value = localStorage.getItem(key);
        if (seen.includes(value)) { this.confirmed.set(key, value); return value; }
        seen.push(value);
      } catch { /* unknown is not absence */ }
    }
    return undefined;
  }
  probe(key: string): boolean {
    const before = this.read(key);
    const works = this.intend(key, before === '1' ? '0' : '1'); // It must require an actual change.
    const restored = this.intend(key, before ?? null);
    return before !== undefined && works && restored;
  }
  private attempt(key: string, intent: Intent): boolean {
    if (intent.dependencies.some(key => this.intents.get(key)?.pending)) return false;
    // A bounded transaction absorbs one dropped/throwing mutation. Longer outages remain pending.
    for (let n = 0; n < 2; n++) {
      try { if (intent.value === null) localStorage.removeItem(key); else localStorage.setItem(key, intent.value); } catch { /* independently verify */ }
      if (this.read(key) === intent.value) { intent.pending = false; return true; }
    }
    return false;
  }
  intend(key: string, value: Value, dependencies: string[] = []): boolean {
    const intent = { value, pending: true, dependencies };
    this.intents.set(key, intent); // Record before touching storage, even when that touch throws.
    this.retryAt = this.clock() + 2000;
    return this.attempt(key, intent);
  }
  retry() {
    for (const [key, intent] of [...this.intents].sort((a, b) => a[1].dependencies.length - b[1].dependencies.length)) if (intent.pending) this.attempt(key, intent);
    this.retryAt = this.clock() + 2000;
  }
  frame(visible: boolean) { if (visible && this.pending && this.clock() >= this.retryAt) this.retry(); }
  get pending() { return [...this.intents.values()].some(intent => intent.pending); }
  value(key: string) { return this.confirmed.get(key); }
  get snapshot() { return { wanted: Object.fromEntries([...this.intents].map(([key, intent]) => [key, intent.value])), confirmed: Object.fromEntries(this.confirmed), pending: this.pending, retryAt: this.retryAt }; }
}

const pages = new WeakMap<Document, QualityStore>();
export function qualityStore(clock?: () => number): QualityStore {
  let store = pages.get(document);
  if (!store) {
    store = new QualityStore(clock ?? (() => performance.now()));
    pages.set(document, store);
    const retry = () => store!.retry();
    addEventListener('pagehide', retry);
    addEventListener('pageshow', retry);
    document.addEventListener('visibilitychange', retry);
    document.addEventListener('freeze', retry);
    document.addEventListener('resume', retry);
  }
  if (clock) store.useClock(clock);
  return store;
}
