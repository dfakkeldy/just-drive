// Only explicit tool/dev controls bypass the title card. Player choices (area, mode, vehicle,
// trailer, trip, site (localhost brand preview), view, radio, engine, paved, exag, q, touch, mp, room, title, finish (the
// settings switch puts finish=0 there for a browser that saves nothing: finish-choice.ts), start (the
// first place: web/src/start-key.ts), daily (Today's run: web/src/daily-rules.ts), poster (the Sugar Camp Quarry start: web/src/sugar-camp-start.ts),
// sunPaths (driving sky sun paths: web/src/sun-paths-rules.ts)) and unknown/tracking
// keys do not.
// Preview-only keys are listed too, so every URL control in web/src has a deliberate classification.
const TEST_KEYS = new Set([
  'animal', 'at', 'blackstone', 'break', 'brooks', 'cam', 'camground', 'cap', 'cat', 'church', 'coast', 'damage', 'day',
  'aiDriver', 'aiDriverCheck', 'airport', 'boss', 'bossLook', 'depot', 'rideAlong', 'demo', 'dir', 'dirt', 'double', 'drlane', 'f', 'fishingCheck', 'trafficCheck', 'wildlife', 'grass', 'hawkesbury', 'home', 'hour', 'hud', 'interior',
  'jumpCheck', 'knock', 'lawn', 'looks', 'low', 'mabou', 'maryville', 'mpserver', 'n', 'name', 'pair', 'park', 'photo', 'porch', 'porthoodgas', 'postOffice', 'prince', 'reflections',
  'relief', 'report', 'res', 'road', 'run', 'scene', 'shadows', 'sidewalks', 'ptIndustry', 'waterTowers', 'shot', 'still', 'stuffed', 'test',
  'quarry', 'throw', 'trees', 'village', 'x', 'yard', 'yardProps', 'lotprops',
  'canvasAA', 'clouds', 'finishSamples', 'finishSmooth', 'finishType', 'leaves',
]);
export function isTestVisit(params: URLSearchParams): boolean {
  return [...params.keys()].some(key => TEST_KEYS.has(key));
}
