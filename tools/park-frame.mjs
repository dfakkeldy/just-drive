// Park the game's main frame loop so a browser check can step the world itself.
//
// The check replaces requestAnimationFrame with a catcher, then waits until the game's own
// frame asks for its next frame. It used to wait a fixed 100 ms and take whatever had arrived.
// When the first frame after the title took longer than that (a shader build on a slow GPU),
// it took nothing: the real frame loop then ran on its own between the check's steps, with no
// pedal held, and stopped the car during every wait (fishing-hills-check, R14 at hill 1).
export const PARK_SCRIPT = 'window.nextFrame=undefined;window.requestAnimationFrame=fn=>{window.nextFrame=fn;return 0}';

export async function parkMainFrame(read, sleep, timeoutMs = 20000) {
  await read(PARK_SCRIPT);
  for (let waited = 0; ; waited += 25) {
    if (await read(`typeof window.nextFrame==='function'`)) return;
    if (waited >= timeoutMs) throw Error(`the main frame did not ask for a next frame within ${timeoutMs} ms`);
    await sleep(25);
  }
}
