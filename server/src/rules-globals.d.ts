// The game's rules modules (web/src/*-rules.ts) name the browser's storage in their own save and load helpers, which
// the Worker never calls. These lines only let the server compile those modules: the Worker has no localStorage.
interface Storage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
declare const localStorage: Storage;
