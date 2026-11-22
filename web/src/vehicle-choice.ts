import { readSite } from './site';
import { GARAGE, VEHICLE_KEY, periodRides } from './garage';
import type { Ride } from './ride';
const POSE = 'mmm.vehicle.pose';
const area = () => { const q = new URLSearchParams(location.search); const site = readSite(location.hostname, location.pathname, q); return site.brand === 'just' ? site.area : q.get('area') ?? 'mabou'; };
export interface VehicleChoice { kind: string; choose(kind: string): void }
export function vehicleChoice(kind: string, vehicle: Ride): VehicleChoice {
  return { kind, choose(next) {
    if (next === kind || next !== 'drone' && !GARAGE.some(entry => entry.id === next)) return;
    let saved = false;
    try { localStorage.setItem(VEHICLE_KEY, next); saved = localStorage.getItem(VEHICLE_KEY) === next; } catch { /* query fallback */ }
    try { sessionStorage.setItem(POSE, JSON.stringify({ x: vehicle.x, z: vehicle.z, heading: vehicle.heading, y:vehicle.y, when: Date.now(), area: area() })); } catch { /* no session storage */ }
    const q = new URLSearchParams(location.search),hadTrip=q.has('trip');q.delete('trip');
    if (q.has('vehicle') || !saved || hadTrip) { q.set('vehicle', next); location.search = q.toString(); } else location.reload();
  } };
}
export function restoreVehiclePose(vehicle: Ride): boolean {
  try {
    const saved = sessionStorage.getItem(POSE); sessionStorage.removeItem(POSE);
    if (!saved) return false;
    const p = JSON.parse(saved);
    if (p.y!==undefined&&!Number.isFinite(p.y)) return false;
    if (p.area !== area() || ![p.x, p.z, p.heading, p.when].every(Number.isFinite) || Date.now() - p.when > 60000 || Date.now() < p.when) return false;
    const b = vehicle.bounds; if (b && (p.x < b[0] || p.x > b[2] || p.z < b[1] || p.z > b[3])) return false;
    vehicle.place(p.x, p.z, p.heading,p.y); return true;
  } catch { return false; }
}
export function vehicleButtons(choice: VehicleChoice, id = 'vehicleChoice'): HTMLElement {
  const group = document.createElement('div'); group.id = id; group.setAttribute('role', 'group'); group.setAttribute('aria-label', 'Ride');
  // Today's picker offers car, dirt bike and drone; the 1884 era puts the horse in front.
  const period = periodRides(new URLSearchParams(location.search));
  group.style.cssText = `display:flex;${period ? 'flex-wrap:wrap;' : ''}gap:6px;margin:0 0 16px`;
  for (const [kind, name] of [...(period ? [['horse', 'Horse']] as const : []), ['car', 'Car'], ['bike', 'Dirt bike'], ['drone', 'Drone']] as const) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.vehicle = kind; b.textContent = name; b.setAttribute('aria-pressed', String(kind === choice.kind));
    b.style.cssText = `flex:1;min-height:44px;border:1px solid ${kind === choice.kind ? '#a7d9bc' : '#6b7780'};border-radius:6px;background:${kind === choice.kind ? '#31463a' : 'transparent'};color:inherit;font:700 13px system-ui;cursor:pointer;padding:8px`;
    b.addEventListener('click', () => choice.choose(kind)); group.appendChild(b);
  }
  return group;
}
export const bikeHelp = '\nWASD/arrows: ride · Shift + throttle: wheelie · space: rear slide\nAir: W forward / S back · A/D whip · H: horn · T: radio · R: road · V: eyes · F: drone · L: places · M: map · O: save picture';
const PAUSE_KEY: [string, string] = ['Esc / P', 'Pause or resume. A room keeps going when you pause.'];
const PAUSE_TOUCH: [string, string] = ['PAUSE', 'Pause or resume. A room keeps going when you pause.'];
export function bikeKeys(touch: boolean): [string, string][] {
  return touch ? [
    PAUSE_TOUCH,
    ['Left thumb', 'Slide the pad to steer. In the air, whip left or right.'],
    ['GO / BRAKE', 'Ride. In the air, GO pitches forward; BRAKE pitches back.'],
    ['PULL + GO', 'Lift the front wheel. Ease GO to balance; too far causes a tumble.'],
    ['RESET / VIEW', 'Back to the road / rider’s eye.'], ['HORN / RADIO', 'Honk / next station.'], ['DRONE', 'Camera drone.'], ['PLACES / ⚙', 'Places and the big map / settings.'], ['Save picture', 'Save a picture.'],
  ] : [
    PAUSE_KEY,
    ['W A S D / arrows', 'Ride. Hold S at rest to reverse.'], ['Shift + throttle', 'Wheelie. Ease throttle to balance; too far causes a tumble.'],
    ['Space', 'Rear brake and slide. S is the front brake.'], ['In the air', 'W pitches forward; S pitches back. A/D makes a whip.'],
    ['H / T', 'Small horn / next radio station.'], ['R / V', 'Back on the road / rider’s eye.'], ['F / L / M', 'Camera drone / places / the big map.'], ['O', 'Save a picture.'],
  ];
}

export const horseHelp = '\nWASD/arrows: ride · space: stop\nH: whinny · R: road · V: rider’s eye · F: drone · L: places · O: save picture';
export function horseKeys(touch: boolean, mail = false): [string, string][] {
  if (mail) return touch ? [
    PAUSE_TOUCH,
    ['Left thumb', 'Slide the pad to guide the horse.'], ['GO / WHOA', 'Ride / stop. Hold WHOA at rest to back up.'],
    ['MAIL / CAMERA', 'Throw mail from the saddle / take a photo.'], ['BLADDER', 'Step off when stopped. Look for houses first.'],
    ['WHINNY', 'Call to the other horses.'], ['RESET / VIEW', 'Road / rider’s eye.'], ['DRONE', 'Camera drone.'], ['⚙', 'Settings. END SHIFT finishes the day.'],
  ] : [
    PAUSE_KEY,
    ['W A S D / arrows', 'Ride. Hold S at rest to back up.'], ['Space', 'Stop.'], ['M / E', 'Throw mail to the right from the saddle.'],
    ['C', 'Take a photo.'], ['B', 'Step off when stopped, when the gauge says so. Look for houses first.'],
    ['H', 'Whinny.'], ['R / V', 'Road / rider’s eye.'], ['F', 'Camera drone.'], ['Enter', 'End the shift and read the calls.'],
  ];
  return touch ? [
    PAUSE_TOUCH,
    ['Left thumb', 'Slide the pad to guide the horse.'], ['GO / WHOA', 'Walk, trot, canter, gallop. Hold WHOA at rest to back up.'],
    ['WHINNY', 'Call to the other horses.'], ['RESET / VIEW', 'Back to the road / rider’s eye.'], ['DRONE', 'Camera drone.'], ['PLACES / ⚙', 'Places / settings.'], ['Save picture', 'Save a picture.'],
  ] : [
    PAUSE_KEY,
    ['W A S D / arrows', 'Ride. Hold S at rest to back up.'], ['Space', 'Stop.'], ['H', 'Whinny.'],
    ['R / V', 'Back to the road / rider’s eye.'], ['F / L', 'Camera drone / places.'], ['O', 'Save a picture.'],
  ];
}

export const horseMailHelp = '\nWASD/arrows: ride · space: stop · M/E: mail from saddle · C: photo · Esc/P: pause · B: step off · Enter: end shift\nH: whinny · R: road · V: rider’s eye · F: drone';

export function droneKeys(touch: boolean): [string, string][] {
  return touch ? [
    PAUSE_TOUCH,
    ['Left stick', 'Climb, descend and turn. Let go to hover.'],
    ['Right stick', 'Fly level.'],
    ['Drag', 'Turn and tilt the camera.'],
    ['ROAD', 'Back on the nearest road.'],
    ['PLACES / ⚙', 'Places and the big map / settings.'],
  ] : [
    PAUSE_KEY,
    ['W A S D', 'Fly level. Let go to hover.'],
    ['← / → or Q / E', 'Turn left or right.'],
    ['↑ / ↓', 'Tilt the camera.'],
    ['Space / Shift', 'Climb / descend (C also lowers).'],
    ['Wheel', 'Top speed.'],
    ['R', 'Back on the nearest road.'],
    ['L / M', 'Places / the big map.'],
  ];
}
