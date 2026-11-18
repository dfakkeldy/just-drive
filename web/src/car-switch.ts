/**
 * Which body the mail car wears: the Blender-built one (car-model.ts) or the code car (car.ts).
 *
 * The Blender car is the car. `?car=code` asks for the code car (the way back, and a side-by-side for tests);
 * `?car=blender` says the default out loud.
 *
 * The Blender car is a file, so it must be fetched before the first frame. The game starts the download as soon
 * as it knows the vehicle (`preloadMailCar`), and waits for it once, just before it builds the car
 * (`readyMailCar`). The 8 s limit counts from that wait, not from the page's start. If the file is missing,
 * damaged or too slow, that is not an error for the player: one line goes to the console and the code car is
 * built instead, with the trim that the mode asks for.
 */
import { createCar, type Car } from './car';

/**
 * The Blender car is the default (14 Nov 2026). To go back to the code car, revert the pull request that made it
 * the default; do not only set this to false. tools/offline-models.mjs reads this line: with false, the car's
 * files leave the offline download, and the offline worker (web/pwa/sw.js) no longer passes a file outside the
 * download to the network. A player with offline play on who opens ?car=blender would then get the code car and
 * an "update" notice on every start, because the update has no car either.
 */
export const BLENDER_CAR_DEFAULT = true;
/** Once the game needs the car, it waits this long for the load (script, download, reading, decoding its pictures); then the code car is used. */
export const BLENDER_CAR_LIMIT_MS = 8000;
/** A download that is still open after this long is cancelled. It is long: the download runs beside the land's. */
export const BLENDER_CAR_DOWNLOAD_MS = 60000;

export function wantsBlenderCar(params: URLSearchParams): boolean {
  const asked = params.get('car');
  return asked === 'blender' || (BLENDER_CAR_DEFAULT && asked !== 'code');
}

let blender: { create(mailTrim?: boolean, cleanText?: boolean): Car } | null = null;
/** A download that was started early, for the car that `readyMailCar` will ask for. */
let early: { low: boolean; startedAt: number; load: Promise<{ create(mailTrim?: boolean, cleanText?: boolean): Car }>; forget(): void } | null = null;

/**
 * Starts the car's download. The game calls this as soon as it knows the vehicle, so the file loads beside the
 * land. It starts no clock: a slow first visit that needs a long time for its land does not lose the car for it.
 * `downloadMs` cancels a download that is still open then (a server that never answers).
 */
export function preloadMailCar(params: URLSearchParams, low: boolean, downloadMs = BLENDER_CAR_DOWNLOAD_MS): void {
  early = null;
  if (!wantsBlenderCar(params)) return;
  const model = import('./car-model'), load = model.then(module => module.loadBlenderCar(low, downloadMs));
  load.catch(() => {});   // a failure is heard in readyMailCar; until then nobody else listens
  early = { low, startedAt: Date.now(), load, forget: () => { model.then(module => module.forgetBlenderCar(low), () => {}); } };
}

/**
 * Call once before `buildMailCar`, when the game needs the car. It waits at most `limitMs` from this call (the
 * download may have begun long before, in `preloadMailCar`). Resolves in every case; it never rejects.
 */
export async function readyMailCar(params: URLSearchParams, low: boolean, limitMs = BLENDER_CAR_LIMIT_MS): Promise<void> {
  blender = null;
  if (!wantsBlenderCar(params)) { early = null; return; }
  if (!early || early.low !== low) preloadMailCar(params, low);
  const mine = early!;
  early = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`no car after ${limitMs} ms of waiting (its download began ${Date.now() - mine.startedAt} ms ago)`)), limitMs); });
    try { blender = await Promise.race([mine.load, late]); }
    catch (error) {
      // A file that arrives after the limit is not kept: the next visit asks for it again.
      mine.forget();
      throw error;
    }
  } catch (error) {
    blender = null;
    console.warn('The Blender mail car did not load. The built-in car is used instead.', error);
  } finally { clearTimeout(timer); }
}

/** The same signature as `createCar`, so the garage can use either. */
export function buildMailCar(mailTrim = true, cleanText = false): Car {
  if (blender) {
    try { return blender.create(mailTrim, cleanText); }
    catch (error) { blender = null; console.warn('The Blender mail car could not be built. The built-in car is used instead.', error); }
  }
  return createCar(mailTrim, cleanText);
}
