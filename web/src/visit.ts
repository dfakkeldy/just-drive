// Only explicit tool/dev controls bypass the title card. Player choices (area, mode, vehicle,
// trailer, trip, site (localhost brand preview), view, radio, engine, paved, exag, q, touch, mp, room, title, start (the
// first place: web/src/start-key.ts), poster (the Sugar Camp Quarry start: web/src/sugar-camp-start.ts)) and unknown/tracking
// keys do not.
// Preview-only keys are listed too, so every URL control in web/src has a deliberate classification.
const TEST_KEYS = new Set([
  'animal', 'at', 'break', 'brooks', 'cam', 'camground', 'cap', 'cat', 'church', 'coast', 'damage', 'day',
  'aiDriver', 'aiDriverCheck', 'airport', 'demo', 'dir', 'dirt', 'double', 'f', 'fishingCheck', 'trafficCheck', 'wildlife', 'grass', 'hawkesbury', 'home', 'hour', 'hud', 'interior',
  'jumpCheck', 'knock', 'lawn', 'low', 'mabou', 'mpserver', 'n', 'name', 'pair', 'park', 'photo', 'porch', 'reflections',
  'relief', 'report', 'res', 'road', 'run', 'scene', 'shadows', 'shot', 'still', 'stuffed', 'test',
  'quarry', 'throw', 'trees', 'village', 'x', 'yard',
]);
export function isTestVisit(params: URLSearchParams): boolean {
  return [...params.keys()].some(key => TEST_KEYS.has(key));
}
