// Browser identity survives reloads and is shared by tabs. Session identity belongs to this tab.
// Storage can be unavailable in private/blocked contexts; that visit still gets an ephemeral identity.
export function browserSession(): { browserId: string; sessionKey: string } {
  const read = (kind: 'localStorage' | 'sessionStorage', key: string): string => {
    try {
      const storage = window[kind], saved = storage.getItem(key);
      if (saved && /^[a-zA-Z0-9-]{16,64}$/.test(saved)) return saved;
      const value = crypto.randomUUID(); storage.setItem(key, value); return value;
    } catch { return crypto.randomUUID(); }
  };
  return { browserId: read('localStorage', 'mmm-mp-browser'), sessionKey: read('sessionStorage', 'mmm-mp-session') };
}
