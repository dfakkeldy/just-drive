// The controls as the title card lists them. Plain data, so the help pages (tools/about-pages.mjs) can list the
// same rows without a browser.

/** The mail game on a keyboard. */
export const KEYS: [string, string][] = [
  ['Esc / P', 'Pause or resume. A room keeps going when you pause.'],
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
  ['PAUSE', 'Pause or resume. A room keeps going when you pause.'],
  ['Left thumb', 'Slide the pad to steer.'],
  ['Right thumb', 'GO and BRAKE. Hold BRAKE when stopped to reverse. Both at once: handbrake.'],
  ['MAIL', 'Throw mail from the driver’s window, on the right.'],
  ['CAMERA', 'A photo taken before the damage is your only defence.'],
  ['RESET', 'Back on the road.'],
  ['DRONE', 'Camera drone. Left stick climbs and turns, right stick flies; RETURN TO CAR brings it back. LAND NOW lands at once.'],
  ['BLADDER', 'Tap the gauge when the car is stopped. Look for houses first.'],
  ['RADIO', 'Tap for the next station. After the last one, off.'],
  ['\u2699', 'Settings. END SHIFT is in there: press it when the day is done.'],
];

/** Just driving (no mail) on a keyboard and on a touch screen: the mail rows out, the driving rows in. */
export const DRIVING_KEYS: [string, string][] = KEYS.filter(([key]) => !['M or E', 'C', 'B', 'Enter'].includes(key))
  .concat([['Space', 'Handbrake. Pull it in a turn at speed to slide.'], ['L / M', 'Places / the map (today).'], ['O', 'Save a picture.']]);
export const DRIVING_TOUCH: [string, string][] = TOUCH.filter(([key]) => !['MAIL', 'CAMERA', 'BLADDER', '\u2699'].includes(key))
  .concat([['PLACES', 'Choose a place, or the map.'], ['Save picture', 'Save a picture.'], ['\u2699', 'Settings.']]);

/**
 * A controller with the standard layout (gamepad.ts, gamepad-rules.ts). The title card shows these rows in place of
 * the keyboard or touch rows while the controller is the device used last. `kind` is the ride; `mail` the mail game.
 */
export function padKeys(kind = 'car', mail = true, radio = true): [string, string][] {
  const horse = kind === 'horse', bike = kind === 'bike';
  const rows: [string, string][] = [
    ['Start', 'Pause or resume. A room keeps going when you pause.'],
    ['Left stick', horse ? 'Guide the horse.' : bike ? 'Steer. In the air, whip left or right.' : 'Steer.'],
    ['RT / LT', horse ? 'Ride / stop. Hold LT at rest to back up.' : bike ? 'Ride / brake. In the air, RT pitches forward; LT pitches back.' : 'Go / brake. Hold LT when stopped to reverse.'],
    ['A', horse ? 'Stop.' : bike ? 'Rear brake and slide.' : 'Handbrake.'],
  ];
  if (bike) rows.push(['LB or RB + RT', 'Wheelie. Ease RT to balance; too far causes a tumble.']);
  if (mail) rows.push(['Y', horse ? 'Throw mail to the right from the saddle.' : 'Throw mail from the driver’s window, on the right.'],
    ['D-pad down', 'Take a photo. A photo taken before the damage is your only defence.'],
    ['D-pad left', horse ? 'Step off when stopped, when the gauge says so.' : 'Step out of the car, when the gauge says so. Look for houses first.']);
  rows.push(['X', horse ? 'Whinny.' : mail ? 'Horn. The cat is not impressed.' : 'Horn.'], ['B', horse || bike ? 'Rider’s eye.' : 'Sit in the driver’s seat.']);
  if (radio && !horse) rows.push(['D-pad up', 'Radio: the next station. After the last one, off.']);
  rows.push(['Back', 'Back on the road.']);
  if (!mail) rows.push(['D-pad right', 'Places.']);
  rows.push(['Menus', mail ? 'D-pad to move, A to choose, B to go back. END SHIFT is in Settings.' : 'D-pad to move, A to choose, B to go back.']);
  return rows;
}
/** The HUD's help line for a controller (hud-text.ts), per ride. */
export function padHelp(kind = 'car', mail = true, radio = true): string {
  const horse = kind === 'horse', bike = kind === 'bike';
  const first = horse ? 'stick: guide · RT/LT: ride/stop · A: stop' : bike ? 'stick: steer · RT/LT: ride/brake · LB/RB + RT: wheelie · A: rear slide' : 'stick: steer · RT/LT: go/brake · A: handbrake';
  const mailPart = mail ? ' · Y: mail · ↓: photo · ←: step out' : '';
  const second = `${horse ? 'X: whinny' : 'X: horn'}${radio && !horse ? ' · ↑: radio' : ''} · B: ${horse || bike ? 'eyes' : 'seat'} · Back: road${mail ? '' : ' · →: places'} · Start: pause`;
  return `\n${first}${mailPart}\n${second}`;
}

/** Each keyboard key has its own cap. Joiners keep their original text. */
export function keyCaps(label: string, escape: (text: string) => string = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;')): string {
  const isKey = (token: string) => /^[A-Za-z←→↑↓⇧⚙]$/.test(token) || ['WASD', 'Esc', 'Enter', 'Space', 'Shift', 'arrows'].includes(token);
  const join = (text: string) => `<span class="keyJoin">${escape(text)}</span>`;
  return label.split(/( \/ | or | \+ )/).map((part, i) => {
    if (i % 2) return join(part);
    const tokens = part.split('/');
    if (tokens.length > 1 && tokens.every(isKey)) return tokens.map(t => `<kbd>${escape(t)}</kbd>`).join(join('/'));
    return isKey(part) ? `<kbd>${escape(part)}</kbd>` : escape(part);
  }).join('');
}
