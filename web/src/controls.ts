// The controls as the title card lists them. Plain data, so the help pages (tools/about-pages.mjs) can list the
// same rows without a browser.

/** The mail game on a keyboard. */
export const KEYS: [string, string][] = [
  ['Esc / P', 'Pause or resume. Room games do not pause.'],
  ['W A S D / arrows', 'Drive. Hold S when stopped to reverse.'],
  ['M or E', 'Throw mail from the driver’s window, on the right.'],
  ['C', 'Take a photo. A photo taken before the damage is your only defence.'],
  ['H', 'Horn. The cat is not impressed.'],
  ['B', 'Step out of the car, when the gauge says so. Look for houses first.'],
  ['T', 'Radio: the next station. After the last one, off.'],
  ['R', 'Back on the road.'],
  ['V', 'Sit in the driver’s seat.'],
  ['F', 'Camera drone. WASD fly, ←/→ turn, ↑/↓ tilt the camera, Space/Shift up/down, R brings it back, F lands.'],
  ['Enter', 'End the shift and read the calls.'],
];
export const TOUCH: [string, string][] = [
  ['PAUSE', 'Pause or resume. Room games do not pause.'],
  ['Left thumb', 'Slide the pad to steer.'],
  ['Right thumb', 'GO and BRAKE. Hold BRAKE when stopped to reverse.'],
  ['MAIL', 'Throw mail from the driver’s window, on the right.'],
  ['CAMERA', 'A photo taken before the damage is your only defence.'],
  ['RESET', 'Back on the road.'],
  ['DRONE', 'Camera drone. Left stick climbs and turns, right stick flies; RETURN brings it back.'],
  ['BLADDER', 'Tap the gauge when the car is stopped. Look for houses first.'],
  ['RADIO', 'Tap for the next station. After the last one, off.'],
  ['\u2699', 'Settings. END SHIFT is in there: press it when the day is done.'],
];

/** Just driving (no mail) on a keyboard and on a touch screen: the mail rows out, the driving rows in. */
export const DRIVING_KEYS: [string, string][] = KEYS.filter(([key]) => !['M or E', 'C', 'B', 'Enter'].includes(key))
  .concat([['Space', 'Brake.'], ['L / M', 'Places / the map (today).']]);
export const DRIVING_TOUCH: [string, string][] = TOUCH.filter(([key]) => !['MAIL', 'CAMERA', 'BLADDER', '\u2699'].includes(key))
  .concat([['PLACES', 'Choose a place, or the map.'], ['\u2699', 'Settings.']]);
