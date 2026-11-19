// "Far views on phone" (Settings > Advanced): what a phone-detail (LOW) page draws of the far views pack.
// Off is the default and draws exactly what a phone drew before the pack: no far land, no curved sea, no tall pack.
// Full is the LOW far scene as it was built. Coarse aims for the phone draw cap: one far-land draw on a coarser
// level, every turbine (near and far) in one instanced draw, and no tall masts, wires or near turbine draws.
// Desktop detail ignores the choice: it draws the far views whenever the pack is installed.

export type FarPhone = 'off' | 'coarse' | 'full';
export type FarLevelName = 'desktop' | 'low' | 'coarse';
/** What loads. null: nothing of the far views pack, not even its material hooks or Places. */
export interface FarPlan { level: FarLevelName; coarse: boolean }

export const FAR_PHONE_KEY = 'mmm.farPhone';
export const FAR_PHONE_CHOICES: readonly FarPhone[] = ['off', 'coarse', 'full'];

export function parseFarPhone(value: string | null | undefined): FarPhone | null {
  return value === 'off' || value === 'coarse' || value === 'full' ? value : null;
}

/** A valid `?far=` wins (checks and pictures), then the saved choice, then Off. */
export function farPhoneChoice(query: URLSearchParams, saved: string | null | undefined): { choice: FarPhone; fromUrl: boolean } {
  const typed = parseFarPhone(query.get('far'));
  return typed ? { choice: typed, fromUrl: true } : { choice: parseFarPhone(saved) ?? 'off', fromUrl: false };
}

export function farPlan(low: boolean, choice: FarPhone): FarPlan | null {
  if (!low) return { level: 'desktop', coarse: false };
  if (choice === 'off') return null;
  return choice === 'full' ? { level: 'low', coarse: false } : { level: 'coarse', coarse: true };
}

export function readFarPhone(): string | null {
  try { return localStorage.getItem(FAR_PHONE_KEY); } catch { return null; }
}
export function saveFarPhone(choice: FarPhone): boolean {
  try { localStorage.setItem(FAR_PHONE_KEY, choice); return localStorage.getItem(FAR_PHONE_KEY) === choice; } catch { return false; }
}
