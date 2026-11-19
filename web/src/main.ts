import { Sidewalks } from './sidewalks';
import { loadSidewalkData } from './sidewalks-cache';
import { StreamCulverts } from './stream-culverts';
import { sugarCampStart } from './sugar-camp-start';
import { PointTupperDriver, driverEnabled, driverLive } from './point-tupper-driver';
import { PauseGate } from './pause';
import { TrafficSignals } from './traffic-signals';
import { CLEAR_HAZE, MOODS, moodLook, weatherMoment, weatherSettings, weatherUI } from './weather';
import { placeUrlPose } from './placement-pose';
import { bootTripParams, tripId } from './quarry-trip';
import {historyRoadName} from './eras/history-road-names';
import { PhoneMailHud } from './phone-mail-hud';
import { hudLine, setHud, type HudState } from './hud-text';
import { SITE, siteArea } from './site-page';
import { siteRadio } from './site';
import { isTestVisit } from './visit';
import { pageState } from './page-state';
import { Towing, trailerHelpSetting } from './towing';
import { AreaContacts } from './world-contacts';
import { pushOut } from './parked';
import { Fleet } from './fleet';
import { fleetEnabled, fleetRig } from './fleet-models';
import { fleetHud } from './fleet-hud';
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { Buildings, buildingSites, readBuildingStyles, roofSites, type Building } from './buildings';
import { Animals } from './animals';
import { loadAreaManifest, roadStart, utm20ToLatLon } from './area';
import { areaScreen } from './area-screen';
import { GARAGE, readVehicle } from './garage';
import { rideFeatures } from './ride-features';
import { legacyVehicle, type RideInput } from './ride';
import { Canal } from './canal';
import { Landmarks } from './landmarks';
import { Roads } from './roads';
import { detailSetting } from './detail';
import { offlinePlay } from './offline-play';
import { bindOfflineVersion } from './offline-version';
import { pictureSetting } from './picture';
import { EdgeSamples, Finish, type CloudLight } from './finish';
import { FINISH, finishSetting } from './finish-choice';
import { cloudReflections } from './finish-shaders';
import { startHere, placeAtStart } from './start-here';
import { startKey } from './start-key';
import { startTouchQuality } from './touch-quality';
import { Props, splitRoadLines } from './props';
import { TallLandmarks } from './tall';
import { FarLand, farSeaVertex, farSeaFragment } from './far-land';
import { FarTurbines } from './far-turbines';
import { curveSceneMaterials } from './far-materials';
import { FarVisibility } from './far-visibility';
import type { FarFile } from './far-rules';
import type { TallFile } from './tall-rules';
import { tallPlaces } from './places';
import { Radio, loadRadio } from './radio';
import { Mail } from './mail';
import { Shift } from './shift';
import { readMode } from './mode';
import { readEra, areaInEra } from './era';
import { HistoryScene } from './eras/history-scene';
import { historyGround } from './eras/history-ground';
import { HistoryBridgeApproaches } from './eras/history-approaches';
import { FreeDrive, SceneryContact, quietInteriors, quietRelief, quietEndings, prepareExplore, exploreKey } from './explore';
import { placesFor, homePlaces, churchPlaces, westBayPlaces, areaPlaces } from './places';
import { PlacesUI } from './places-ui';
import { BigMap } from './big-map';
import { typing, hikesFor, playableBox, worldHikeLines } from './hikes';
import { Footpaths } from './footpaths';
import { RoadScene } from './road-scene';
import { SchoolBus } from './school-bus';
import { BUS } from './school-bus-rules';
import { BUS_STOP_RADIUS, churchZones, placeAt } from './score-rules';
import { FiredRun } from './fired';
import { DailyRun } from './daily';
import { atlanticDate, CARD_SIZE, dailyArea, dailyPlan, drawCard, supplyFor, type Square } from './daily-rules';
import { PartyLine, fetchCalls } from './party-line';
import { callSign } from './party-line-rules';
import { inventedName } from './mp/social';
import { DriftFeedback } from './drift-feedback';
import { phoneHandbrake } from './drift-rules';
import { AmbientTraffic } from './ambient-traffic';
import { RoadAnimals } from './road-animals';
import { noZoom } from './no-zoom';
import { multiplayerSwitch } from './mp/switch';
import { MiniMap, type MapMark, type MapStop } from './minimap';
import { propertyLines } from './property-lines';
import { PropertyGround } from './property-lines-ground';
import { Relief } from './relief';
import { CLOCK_FACTOR, clock } from './shift-rules';
import { Interiors } from './interiors';
import { MineSite } from './mine-site';
import { MineInterior } from './interior-mine';
import { LawnDemo } from './shift-demo';
import { Route } from './route';
import { SEA_FRAG, SEA_VERT } from './shaders';
import { SunShadows } from './shadows';
import { Streams, type StreamFile } from './streams';
import { WaterReflections } from './water';
import { initStore } from './store';
import { Edge } from './edge';
import { directionFromAngles, sunAngles } from './sun';
import { readLightStudy, studyScale, studyLightingElevation, lightStudyUI, readDrivePosition } from './light-study';
import { chooseYardLights, nightPalette } from './night-rules';
import { Night, NightShading } from './night';
import { HarbourLights } from './harbour-lights';
import { Terrain, type Manifest } from './terrain';
import { createTitle } from './title';
import { Endings } from './ending';
import { YardJob } from './yard-job';
import { FishingSite } from './fishing-site';
import { Fishing } from './fishing';
import { Deckhand } from './deckhand';
import { PublicWharves, hasWharves } from './wharves';
import { createTouchControls } from './touch';
import { createGamepad } from './gamepad';
import { drivingHelpSetting } from './driving-help';
import { Trees, crownTest, treeLook } from './trees';
import { CoastSite } from './coast-site';
import { Coast } from './coast';
import { Vehicle, type Input } from './vehicle';
import { DevHooks } from './dev-hooks';
import { Yard } from './yard';
import { Home } from './home';
import { Cemeteries } from './cemeteries';
import { Stockpiles } from './stockpiles';
import { HomeSite } from './home-site';
import { PorchDog } from './porch-dog';
import { YardDogSite } from './yard-dog-site';
import { YardDog } from './yard-dog';
import { PorchHouse } from './porch-house';
import { PorchSite } from './porch-site';
import { ChurchSite } from './church-site';
import { JudiqueVillageSite, VILLAGE_PLACES } from './judique-village-site';
import { PortHawkesburySite, aimDrops } from './port-hawkesbury-site';
import { MabouMainSite, MAIN_ITEMS, aimDrops as aimMabouDrops } from './mabou-main-site';
import { Replay } from './replay';
import { YardSite, yardMode } from './yard-site';
import {createTestPark,testParkPlaces} from './stunt-test-park';
import { EngineSound, engineVolumeSetting, saveEngineVolume, savedEngineVolume, type DrivingMoment } from './engine-sound';
import { Drone, createDroneButton, createDroneSticks, roofHeights } from './drone';
import { DRONE } from './drone-rules';

// Mabou village, and the game's moment: the second week of October, late afternoon (Atlantic Daylight Time, UTC-3).
const LAT = 46.0717, LON = -61.392;
const SEA_LEVEL = -0.2;   // metres CGVD2013; the surveyed harbour surface is at about -0.3 to -0.7

const params = bootTripParams();
const baseArea = await siteArea(params);
const touchDevice = matchMedia('(pointer: coarse)').matches || params.get('touch') === '1';   // ?touch=1 shows the phone controls for a test
const quality = startTouchQuality(touchDevice, params.get('q'));
const LOW = quality.low;
// A test of a richer look (?leaves=1): leaf clumps on the trees.
treeLook.leafy = params.get('leaves') === '1';
treeLook.oneSample = FINISH.oneSample;
const ERA = readEra(params, baseArea.id, SITE.era);
const AREA = areaInEra(baseArea, ERA);
// Today's run (?daily=1, daily-rules.ts): one seeded Get Fired run a day, the same for everybody. Only on the mail game's own
// land today; Just Drive, 1884 and the areas without a route ignore it. The seed sets the player keys it fixes, in memory:
// the address keeps ?daily=1, so a reload is still today's run.
const DAILY = params.get('daily') === '1' && SITE.brand !== 'just' && ERA.modern && !ERA.explore && AREA.mail && dailyArea(AREA.id)
  ? dailyPlan(atlanticDate(new Date()), AREA.id) : null;
if (DAILY) {
  params.set('mode', 'fired'); params.set('vehicle', DAILY.vehicle); params.set('weather', DAILY.mood); params.set('start', DAILY.start);
  for (const key of ['playerDate', 'playerTime', 'driveAt']) params.delete(key);
}
const gameMode = ERA.explore ? 'explore' : AREA.mail ? readMode(params, undefined, SITE) : 'explore', firedMode = gameMode === 'fired', mailMode = gameMode === 'mail' || firedMode;
if (!mailMode) prepareExplore();
// A vehicle whose model is a file starts its download now, beside the land. The game waits for it once, just before
// the vehicle is built (below); the entry's own time limit counts from that wait, not from here.
readVehicle(params, !mailMode).preload?.(params, LOW);
// The player's date, time and weather mood (weather.ts). The light study, when it is on, keeps its own clock and light.
const weather = weatherSettings(params);
const lightStudy = readLightStudy(params, !mailMode);
// Vertical exaggeration of the land. 1 is true scale; Dan prefers a stretched look (9 Nov 2026).
// It is a game setting: the address bar wins, then the saved choice, then the default of 1.5.
const stored = lightStudy.active ? null : (() => { try { return localStorage.getItem('mmm.exag'); } catch { return null; } })();
const EXAG = studyScale(params, lightStudy.active, () => stored);
// A study that failed (a bad date) carries the game's own moment; a player's own clock wins over that.
const when = (weather.chosen && !lightStudy.active ? undefined : lightStudy.when) ?? weatherMoment(weather);

// Fixed views for match shots: east and north in EPSG:2961, eye height above ground (or an absolute height),
// heading from north, pitch, vertical field of view.
interface Shot { name: string; e: number; n: number; eye?: number; abs?: number; heading: number; pitch: number; fov: number }
const SHOTS: Shot[] = AREA.fixedShots ? [
  { name: 'Mabou Harbour Road, toward the harbour mouth', e: 622951.3, n: 5104332.1, eye: 2.2, heading: 270, pitch: -3, fov: 51 },
  { name: 'Over Mabou village, toward the highlands', e: 624500, n: 5102900, abs: 90, heading: 318, pitch: -7, fov: 51 },
  { name: 'Above the harbour, toward the village', e: 619062.3, n: 5104643.4, abs: 420, heading: 105, pitch: -13, fov: 45 },
  { name: 'Above Glenora Falls, toward the sea', e: 627900, n: 5108200, abs: 520, heading: 250, pitch: -16, fov: 50 },
  { name: 'Mabou River bridge, long lens on the church', e: 624095.0, n: 5103049.8, eye: 2.2, heading: 9, pitch: -0.6, fov: 7 },
  { name: 'Near the church', e: 624230, n: 5103300, abs: 45, heading: 325, pitch: -8, fov: 51 },
] : [];

const page = pageState(params, import.meta.env.DEV, SITE.brand === 'just' ? document.title : undefined);
if (ERA.title) page.setTitle(ERA.title, true);

const base = `${import.meta.env.BASE_URL}${AREA.base}`;
const localJust = SITE.brand === 'just' && location.hostname === 'localhost';
const offlinePageKey = __PUBLIC_APP__ && !localJust ? bindOfflineVersion(AREA.id) : '';
const sidewalkDataReady = ERA.modern && params.get('sidewalks') !== '0' ? loadSidewalkData(AREA.id, base, LOW) : Promise.resolve(null);
const manifest = await loadAreaManifest<Manifest>(AREA, base).catch(error => {
  if (__PUBLIC_APP__ && error instanceof Error && error.name === 'GameUpdateRequired') return new Promise<never>(() => {});
  return areaScreen(error instanceof Error ? error.message : String(error));
});
if (__PUBLIC_APP__) offlinePlay(document.getElementById('settings'), document.getElementById('startOver'), offlinePageKey, AREA.id, SITE.brand === 'just', localJust);
const getJson = async (name: string) => (await fetch(`${base}/${name}`)).json();
await initStore(base);

const canvas = document.getElementById('c') as HTMLCanvasElement;
const hud = document.getElementById('hud')!;
const bare = params.get('hud') === '0';
if (bare) for (const id of ['hud', 'credit', 'gear', 'touch', 'mailButton', 'mailScore', 'shiftHud', 'cameraButton', 'endShift', 'stopHint', 'photoTag', 'photoFlash']) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }

if (touchDevice) noZoom();   // two quick taps on a button must not zoom the page (no-zoom.ts)
// Phone mode trades detail for speed (first measured on an iPhone 12: 20 fps before this mode existed).
// ?q=low or ?q=high forces it either way.
// A desktop can choose it too, for a slow computer (the "Low detail" switch in the settings panel: detail.ts).
// Saved touch full detail is guarded by an early start mark (touch-quality.ts).
// The logarithmic depth buffer keeps far shores clean but makes every pixel cost more, so phone mode goes without it.
quality.watch(canvas);
if (FINISH.mode && FINISH.low !== LOW) console.warn('finish: the choice was made for another detail', FINISH.low, LOW);
if (FINISH.clouds) cloudReflections();
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !LOW && FINISH.canvasSamples, logarithmicDepthBuffer: !LOW, powerPreference: 'high-performance' });
// Phones have many pixels and less power. On a desktop the player chooses how sharp the picture is (picture.ts).
// A picture run (hud=0) is drawn at full sharpness, and ?res=<ratio> pins any value: so pictures and frame rate
// measurements can be compared with each other.
const askedRatio = Number(params.get('res'));
const chosenPicture = (!LOW || touchDevice) && !bare && !(askedRatio > 0);
// A first-visit measurement that ends under 30 frames a second, at whatever choice, points the player at Low detail.
const picture = chosenPicture ? pictureSetting(renderer, document.getElementById('settings'), document.getElementById('startOver'),
  (choice, rate) => { if (rate < 30) detail?.nudge(rate); }, touchDevice, touchDevice && LOW) : null;
const detail = !bare ? detailSetting(renderer.getContext(), document.getElementById('settings'), document.getElementById('startOver'), LOW, undefined, touchDevice, quality.writable, quality.chosen) : null;
if (!bare && FINISH.offered && !LOW && !touchDevice) finishSetting(document.getElementById('settings'), document.getElementById('startOver'), FINISH.mode !== null);
if (!bare) quality.notice(document.getElementById('settings'));
if (!picture) renderer.setPixelRatio(askedRatio > 0 ? Math.min(askedRatio, 3) : Math.min(devicePixelRatio, LOW ? 1.35 : 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.55;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(51, 1, LOW ? 0.45 : 0.3, LOW ? 150000 : 400000);
camera.rotation.order = 'YXZ';

const { lat, lon } = AREA.fixedSun ? { lat: LAT, lon: LON } : utm20ToLatLon(...manifest.village);
const sun = sunAngles(when, lat, lon);
if (!mailMode && !bare) lightStudyUI(lightStudy, when, lat, lon, () => ({ e: vehicle.x + manifest.village[0], n: manifest.village[1] - vehicle.z, heading: THREE.MathUtils.radToDeg(vehicle.heading) }));
// A clock that was chosen (the light study's, or the player's own date or time) may put the sun below the horizon.
// It then gets the night look; a tool view with only `hour` keeps the old light.
const chosenClock = lightStudy.active || weather.chosen;
const sunDir = directionFromAngles(sun.az, studyLightingElevation(sun.el, chosenClock));
// Low sun is warmer and weaker; the sky fill grows in share as the sun drops.
const low = THREE.MathUtils.clamp(sun.el / 35, 0, 1);
const sunColor = new THREE.Color().setRGB(1.0, 0.62 + 0.3 * low, 0.36 + 0.5 * low).multiplyScalar(2.2 + 2.3 * low);
const skyColor = new THREE.Color().setRGB(0.30, 0.44, 0.72).multiplyScalar(0.55 + 0.5 * low);
const fogColor = new THREE.Color().setRGB(0.62, 0.66, 0.72).multiplyScalar(0.75 + 0.35 * low);
// The night of a chosen clock (night-rules.ts). On every other page this is null and none of the night is built.
const nightLook = nightPalette(sun.el, chosenClock);
if (nightLook) { sunColor.multiplyScalar(nightLook.sunScale); skyColor.setRGB(...nightLook.sky); fogColor.setRGB(...nightLook.fog); }
// Drive around: Apply keeps the player's place, as the light study does. A mail shift starts its day again.
if (!bare && !lightStudy.active) weatherUI(weather, mailMode ? undefined : () => ({ e: vehicle.x + manifest.village[0], n: manifest.village[1] - vehicle.z, heading: THREE.MathUtils.radToDeg(vehicle.heading) }));
// A weather mood changes numbers the light already has. Clear gives null: nothing below runs and the frame is as before.
const mood = lightStudy.active ? null : moodLook(weather.mood);
if (mood) {
  // Thick haze takes the low sun's colour and dims with it; without this, far hills stand pale against a dusk sky.
  const dusk = mood.dusk * (1 - low) * (1 - (nightLook?.level ?? 0));
  fogColor.lerp(new THREE.Color().setRGB(1.0, 0.62 + 0.3 * low, 0.36 + 0.5 * low).multiplyScalar(fogColor.r), 0.5 * dusk).multiplyScalar(1 - 0.38 * dusk);
  sunColor.multiplyScalar(mood.sun); skyColor.lerp(fogColor, mood.flat);
  // Cloud hides the dusk bands as it hides the stars.
  if (nightLook) { nightLook.stars *= mood.stars; nightLook.warm *= 1 - mood.flat; nightLook.pink *= 1 - mood.flat; }
}
const nightShading = nightLook ? new NightShading(nightLook, LOW) : null;

const shared: Record<string, THREE.IUniform> = {
  sunDir: { value: sunDir }, sunColor: { value: sunColor }, skyColor: { value: skyColor }, fogColor: { value: fogColor },
  fogDensity: { value: mood?.haze ?? CLEAR_HAZE }, seaLevel: { value: SEA_LEVEL }, time: { value: 0 },
  gulfTint: { value: AREA.gulfTint },
  farExag: { value: EXAG }, farCurveOn: { value: 0 },
  tallViewport: { value: new THREE.Vector2(1920,1080) },
};
if (nightShading) Object.assign(shared, nightShading.uniforms);   // before the terrain: every land material spreads them

const sky = new Sky();
sky.scale.setScalar(300000);
const su = sky.material.uniforms;
su.turbidity.value = 5.5; su.rayleigh.value = 1.7; su.mieCoefficient.value = 0.006; su.mieDirectionalG.value = 0.82;
su.sunPosition.value.copy(sunDir);
if (mood) { su.turbidity.value = mood.turbidity; su.rayleigh.value = mood.rayleigh; su.mieCoefficient.value = mood.mie; su.mieDirectionalG.value = mood.glow; }
scene.add(sky);

const sea = new THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>(
  new THREE.PlaneGeometry(600000, 600000).rotateX(-Math.PI / 2),
  new THREE.ShaderMaterial({ vertexShader: SEA_VERT, fragmentShader: SEA_FRAG, defines: LOW ? { LOW: 1 } : { SEA_WATER: 1 }, uniforms: shared }));
// WaterReflections swaps the mesh material; retain the original colour target.
const seaColour = sea.material;
sea.name = 'near-sea';
sea.position.y = SEA_LEVEL;
sea.frustumCulled = false;
if (LOW) {
  // Without the fine depth buffer the sea and the sea floor would flicker far away. So the sea is painted first,
  // as a backdrop, and the land leaves out everything below sea level.
  sky.renderOrder = -2;
  sea.renderOrder = -1;
  seaColour.depthTest = false;
  seaColour.depthWrite = false;
}
scene.add(sea);

const landmarkList = AREA.landmarks ? await getJson('landmarks.json') : [];
const clear = landmarkList.map((lm: { footprint: [number, number][] }) => {
  const xs = lm.footprint.map((p) => p[0] - manifest.village[0]), zs = lm.footprint.map((p) => manifest.village[1] - p[1]);
  return [Math.min(...xs) - 4, Math.min(...zs) - 4, Math.max(...xs) + 4, Math.max(...zs) + 4];
});
// The works yard on Highway 19: its own model replaces the measured boxes there, unless the owners said no.
const yardSite = AREA.worksYard ? new YardSite(manifest.village, yardMode(params)) : null;
// the Red Roof by the Brook house on Old Chisholm Mill Road (Judique): newer than the land survey, so it is modelled by hand.
const homeSite = AREA.home && params.get('home') !== '0' ? new HomeSite(manifest.village) : null;
const quarryFeature = AREA.quarry ? await import('./quarry-feature').then(feature => feature.load()).catch(() => areaScreen('The park could not load. Retry or choose another area.', true)) : null;
const quarrySite = quarryFeature && params.get('quarry') !== '0' ? new quarryFeature.QuarrySite(manifest.village) : null;
const churchSite = ERA.modern && AREA.church && params.get('church') !== '0' ? new ChurchSite(manifest.village) : null;
// The heart of Judique on Highway 19 (stone church, music centre, community centre, store, garage): built by hand from
// the dash cam brief. ?village=0 leaves the surveyed boxes.
const villageSite = ERA.modern && AREA.id === 'judique' && params.get('village') !== '0' ? new JudiqueVillageSite(manifest.village) : null;
// Port Hawkesbury (the hardware store front, the dealers, the gas bars, the corner garage, the big lots' furniture): built by
// hand from the dash cam brief. ?hawkesbury=0 leaves the surveyed boxes and bare lots.
const hawkesburySite = ERA.modern && AREA.id === 'pointtupper' && params.get('hawkesbury') !== '0' ? new PortHawkesburySite(manifest.village) : null;
let mappedBuildings: Building[] = [];
// Mabou's main street (the grocery, the post office building and its memorial lawn, the hall, the gas station, the junction
// group, the pub, the bank branch, lamp posts, sidewalk, string lights): built by hand from the dash cam brief. The boxes
// it replaces leave the drawing only; they stay properties. ?mabou=0 leaves the surveyed boxes.
const mabouSite = ERA.modern && AREA.id === 'mabou' && params.get('mabou') !== '0' ? new MabouMainSite(manifest.village) : null;
const buildingList: Building[] | null = manifest.buildings ? await getJson(manifest.buildings.file).then((data: { buildings: Building[] }) => {
  mappedBuildings = data.buildings;
  const list = homeSite ? Home.buildings(data.buildings, homeSite, manifest.village) : yardSite ? Yard.buildings(data.buildings, yardSite, manifest.village) : data.buildings;
  const kept = churchSite ? churchSite.buildings(list) : list;
  const placed = villageSite ? villageSite.buildings(kept) : kept;
  return hawkesburySite ? hawkesburySite.buildings(placed) : placed; }) : null;
const buildingStyles = ERA.modern && manifest.buildingStyles

  ? await getJson(manifest.buildingStyles.file).then(readBuildingStyles).catch((e: unknown) => { console.warn('building styles', e); return undefined; })
  : undefined;
// One house at the end of Beaton Road is built by hand, with a dog on its porch (Mabou today). ?porch=0 leaves the surveyed box.
const porchBox = ERA.modern && AREA.id === 'mabou' && params.get('porch') !== '0' && buildingList ? PorchSite.find(buildingList) : null;
const porchSite = porchBox ? new PorchSite(porchBox, manifest.village) : null;
const drawnBuildings = buildingList && porchBox ? PorchHouse.drawn(buildingList, porchBox) : buildingList;
const buildings = ERA.modern && drawnBuildings ? new Buildings(mabouSite ? mabouSite.drawn(drawnBuildings) : drawnBuildings, manifest.village, EXAG, SEA_LEVEL, buildingStyles) : null;
// A building drawn from wings is still one property, at its place from before the split. Everything that counts
// houses, customers or complaints reads this list; only the drawing (and the roof animals) reads the wings.
const properties = buildingSites(buildingList ?? []);
if (buildings) clear.push(...buildings.clear);
if (yardSite) clear.push(...yardSite.clear);
const fishingSite = AREA.fishing ? new FishingSite(manifest.village, EXAG, SEA_LEVEL) : null;
if (fishingSite) clear.push(...fishingSite.clear);
if (homeSite) clear.push(...homeSite.clear);
if (porchSite) clear.push(...porchSite.clear);
if (churchSite) clear.push(...churchSite.clear);
if (villageSite) clear.push(...villageSite.clear);
if (hawkesburySite) clear.push(...hawkesburySite.clear);
if (mabouSite) clear.push(...mabouSite.clear);
if (quarrySite) clear.push(...quarrySite.clear);
// Modern Point Tupper only; airport=0 turns it off. The module (and its source extract) loads only here.
const airportModule = ERA.modern && AREA.id === 'pointtupper' && params.get('airport') !== '0' ? await import('./airport').catch(e => { console.warn('Airport unavailable', e); return null; }) : null;
const airportSite = airportModule ? new airportModule.AirportSite(manifest.village) : null;
const terrain = new Terrain(manifest, base, shared, EXAG, SEA_LEVEL, clear);
// Complete the approved CPU class mask before any terrain canopy or individual tree is built.
// Modern land only: the 1884 era keeps today's cover handling, like other modern features.
if (ERA.modern) await terrain.readGroundCover().catch(() => areaScreen('The land could not load. Retry this area.', true));
terrain.night = nightShading;
if (airportSite) terrain.sites.push(airportSite);
const airport = airportModule && airportSite ? new airportModule.Airport(airportSite, terrain, !!nightLook) : null;
if (airport) {
  scene.add(airport.group);
  if (import.meta.env.DEV) expose({ airport });   // only where the airfield stands, like fleet: the pinned dev keys stay
}
terrain.cartRoads = ERA.cartRoads;
// Open designated pavement (NSTDB lots): on by default in an area whose bake lists it.
// paved=0 turns it off; paved=1 forces a load (work-bake previews). Absent data means no request.
if (ERA.modern && params.get('paved') !== '0' && (!!manifest.paved || params.get('paved') === '1')) {
  terrain.paved = await import('./paved').then(m => m.loadPaved(base, manifest.village, AREA.id)).catch(e => { console.warn('Paved layer unavailable', e); return null; });
}
if (yardSite) terrain.sites.push(yardSite);
const stuntPark=await createTestPark(params, terrain, yardSite, LOW, buildingList ?? []);
if(stuntPark)scene.add(stuntPark.group);
if (fishingSite) terrain.sites.push(fishingSite);
if (homeSite) terrain.sites.push(homeSite);
if (porchSite) terrain.sites.push(porchSite);
if (churchSite) terrain.sites.push(churchSite);
if (quarrySite) { terrain.sites.push(quarrySite); terrain.coast=quarrySite; }
const cemeteries = ERA.modern ? await Cemeteries.load(manifest, getJson, terrain, LOW, AREA.id) : null;
if (cemeteries) scene.add(cemeteries.group);
const stockpiles = ERA.modern ? await Stockpiles.load(manifest, getJson, terrain, LOW, AREA.id) : null;
if (stockpiles) { scene.add(stockpiles.group); terrain.canopyExcludes = stockpiles.excludes; }
// The coast at Mabou Coal Mines is Mabou's own: another area gets none of it.
const coast = !AREA.coast || params.get('coast') === '0' ? null : new Coast(new CoastSite(manifest.village), terrain, LOW);
if (coast) { terrain.coast = coast.site; scene.add(coast.group); }
// Brooks are scenery: when their file is missing or broken, the game still starts, without them.
// ?brooks=0 leaves them out (to time one build both ways).
terrain.streams = manifest.streams && params.get('brooks') !== '0'
  ? await getJson(manifest.streams.file).then((d: StreamFile) => new Streams(d, manifest.village)).catch((e: unknown) => { console.warn('streams', e); return null; })
  : null;
if (LOW) { terrain.split = AREA.quarry ? 1 : 1.15; terrain.low = true; }   // fine tiles and single trees reach less far
else if (params.get('shadows') !== '0') terrain.shadows = true;
// Phone cold start: past 600 m, land outside the view is read later, in the background (terrain.ts lazyRange).
if (LOW) terrain.lazyRange = 600;
if (nightLook) terrain.shadows = false;   // a night has no sun to cast shadows
if (buildings) scene.add(buildings.mesh);
crownTest.lobed = params.get('crowns') === '1';   // a test: lobed far crowns, off by default
const trees = manifest.trees ? new Trees(manifest.trees.tiles, base, terrain, params.get('trees') !== 'far', stockpiles?.excludes) : null;
if (trees) scene.add(trees.group);
scene.add(terrain.group);
const [VE, VN] = manifest.village;
const toWorld = (e: number, n: number) => new THREE.Vector3(e - VE, 0, VN - n);

// Models use the standard materials, so they need scene lights that agree with the terrain shader.
const sunLight = new THREE.DirectionalLight(sunColor, 1.0);
sunLight.position.copy(sunDir);
scene.add(sunLight, new THREE.HemisphereLight(skyColor, new THREE.Color(0.22, 0.20, 0.15), 3.2));
// Desktop quality: real shadows from the low sun. The phone build keeps its speed and goes without.
// ?shadows=0 turns them off; ?shadows=1 keeps them on even on a slow computer (pictures are taken that way).
const sunShadows = terrain.shadows ? new SunShadows(renderer, scene, sunLight, sunDir, params.get('shadows') === '1') : null;
if (sunShadows) Object.assign(terrain.uniforms, sunShadows.uniforms);   // every land tile made from here on reads the map
// Phones do not load the grass module or read the cover image back to the CPU.
const grassExcludes = stockpiles ? (east: number, north: number) => stockpiles.excludes(east, north) || !!cemeteries?.excludes(east, north) : cemeteries?.excludes;
const grass = LOW ? null : new (await import('./grass')).Grass(terrain, params.get('grass'), grassExcludes);
if (grass) scene.add(grass.group);
// Mapped public wharves (today, in the areas that have them); like airport, the dev key exists only there.
const wharves = ERA.id === 'today' && hasWharves(AREA.id) ? new PublicWharves(AREA.id, terrain, manifest.village, SEA_LEVEL, (buildings ? buildingList ?? [] : []).map(b => b.footprint)) : null;
if (wharves) { scene.add(wharves.group); if (import.meta.env.DEV) expose({ wharves }); }

const landmarks = AREA.landmarks ? new Landmarks(landmarkList, manifest.village, EXAG, SEA_LEVEL) : null;
if (landmarks) scene.add(landmarks.group);
const harbourLights = ERA.modern ? new HarbourLights(AREA.id, manifest.village, EXAG, nightLook !== null, SEA_LEVEL) : null;
if (harbourLights) scene.add(harbourLights.group);
const waterReflections = LOW ? null : new WaterReflections(renderer, scene, sea, SEA_LEVEL,
  new Set([terrain.group, ...(landmarks ? [landmarks.group] : []), ...(buildings ? [buildings.mesh] : []), ...(trees ? [trees.group] : [])]),
  terrain, trees?.group ?? null, params.get('reflections'));
if (coast) waterReflections?.include(coast.group);
if (waterReflections) {
  Object.assign(shared, waterReflections.uniforms);
  Object.assign(terrain.uniforms, waterReflections.uniforms);
}

const roadData = manifest.roads ? await getJson(manifest.roads.file) : { roads: [] };
const roads = new Roads(roadData, manifest.village, terrain);
const culvertMouths = ERA.modern && terrain.streams
  ? new StreamCulverts(terrain.streams, roads.roads, (x, z) => { const s = terrain.surfaceAt(x, z); return s && s.level >= 8 ? s.ground : null; }, LOW, () => terrain.dataRevision)
  : null;
if (culvertMouths) scene.add(culvertMouths.group);
scene.add(roads.group);
// Null where no sourced junction stands (every area but Point Tupper, and 1884): no registry entry, no draws.
const trafficSignals = TrafficSignals.forArea(AREA.id, manifest.village, roads, terrain, ERA.id === '1884');
if (trafficSignals) {
  scene.add(trafficSignals.group);
  if (import.meta.env.DEV) expose({ trafficSignals });   // only where signals stand, like fleet: the pinned dev keys stay
}

// Modern Point Tupper only. Scenery: a failed chunk load warns and the game still starts, like the airport.
// Not on LOW: the Point Tupper phone start is already at PHONE_CAP (tools/frame-budget-policy.mjs) with the AI driver.
if (ERA.modern && AREA.id === 'pointtupper' && !LOW) {
  const loaded = await Promise.all([import('./pt-infrastructure'), import('./pt-infrastructure-source')])
    .catch(e => { console.warn('Point Tupper infrastructure unavailable', e); return null; });
  if (loaded) scene.add(new loaded[0].PointInfrastructure(loaded[1].PT_FEATURES, manifest.village, EXAG, SEA_LEVEL, roads).group);
}

const history = ERA.id === '1884' ? await (async () => {
  await terrain.readCover();
  const streams = manifest.streams ? await getJson(manifest.streams.file) as StreamFile : null;
  const ground=await historyGround(manifest,base,roads.roads.filter(r=>r.bridge).flatMap(r=>r.pts.map(([x,z]):[number,number]=>[x+manifest.village[0],manifest.village[1]-z])));
  new HistoryBridgeApproaches(roads,terrain,ground).install(terrain);
  return new HistoryScene(terrain, roads, streams, roofSites(buildingList ?? []), ground);
})() : null;
if (history) { scene.add(history.group); waterReflections?.include(history.group); }
const sidewalkData = await sidewalkDataReady;
// The checked offline plan contains the current site reservations and source road geometry.
// An optional layer: a failure or a refused budget warns once and leaves the town as main draws it (no clearing, no pole moves).
const sidewalks = (() => {
  if (!ERA.modern || !sidewalkData) return null;
  const bridgeWalks = new Map(roads.bridgeWalks);   // the layer widens bridge parapets while it builds
  try {
    const layer = new Sidewalks(sidewalkData, manifest.village, terrain, roads, LOW);
    if (!layer.audit.disabled) return layer;
    layer.dispose();
  } catch (error) { console.warn('Sidewalks failed to start; skipping sidewalks', error); }
  roads.bridgeWalks.clear(); for (const [id, walk] of bridgeWalks) roads.bridgeWalks.set(id, walk);
  return null;
})();
if (sidewalks) { terrain.sidewalks=sidewalks; scene.add(sidewalks.group); if (mabouSite) mabouSite.sidewalkLayer = true; }
// Roadside props are scenery: when their file is missing or broken, the game still starts.
const props = await (async () => {
  if (!ERA.modern || !manifest.props) return null;
  try {
    const read = await getJson(manifest.props.file);
    // The service drops of the boxes Port Hawkesbury and Mabou's main street replace end on their models, not in the air.
    const placed = hawkesburySite && Array.isArray(read.serviceDrops) ? { ...read, serviceDrops: aimDrops(read.serviceDrops) } : read;
    const data = mabouSite && Array.isArray(placed.serviceDrops) ? { ...placed, serviceDrops: aimMabouDrops(placed.serviceDrops) } : placed;
    return new Props(yardSite ? Yard.props(data, yardSite, manifest.village) : data, manifest.village, terrain, cemeteries?.excludes, sidewalks && !sidewalks.audit.disabled ? sidewalkData?.plans[LOW?1:0].poleMoves : undefined, splitRoadLines(roadData)); }
  catch (e) { console.warn('props', e); return null; }
})();
if (props) { scene.add(props.group); roads.guardrails?.setObstacles(props.railObstacles); }
// Optional scenery starts after a drawn frame and Start; it never delays boot.
const rootBounds = [manifest.origin[0], manifest.origin[1] - manifest.size, manifest.origin[0] + manifest.size, manifest.origin[1]];
const sameRoot = (root: readonly number[] | undefined) => Array.isArray(root) && root.length === 4 && root.every((n, i) => n === rootBounds[i]);
const farKey = (manifest as Manifest & { farLand?: { file: string } }).farLand;
// Only the far pack's manifest key (it carries a far count) names a version 2 tall.json. The older live key
// names a file the game never draws, so before install nothing is fetched and no Places UI appears.
const tallKey = ((t?: { file: string; far?: number }) => (t && Number.isInteger(t.far) ? t : undefined))((manifest as Manifest & { tall?: { file: string; far?: number } }).tall);
let farLand: FarLand | null = null, tall: TallLandmarks | null = null, farTurbines: FarTurbines | null = null;
let farVisibility: FarVisibility | null = null, farLoading = false;
async function loadFarViews(): Promise<void> {
  const [landResult,tallResult] = await Promise.allSettled([
    (async()=>{
      if(!farKey)return null;
      const data:FarFile=await getJson(farKey.file);
      if(!sameRoot(data.root)||data.origin?.[0]!==manifest.village[0]||data.origin?.[1]!==manifest.village[1])throw Error('Far land belongs to another terrain pack');
      const land=await FarLand.load(data,base,LOW,shared);
      const vertex=farSeaVertex(SEA_VERT),fragment=farSeaFragment(SEA_FRAG);
      return {land,vertex,fragment};
    })(),
    (async()=>{
      if(!(ERA.modern && tallKey))return null;
      const data:TallFile=await getJson(tallKey.file);
      if(data.version!==2||!sameRoot(data.root))return null;
      return {data,near:new TallLandmarks(data,terrain,LOW,shared,sun.el<0,false)};
    })(),
  ]);
  if(landResult.status==='rejected')console.warn('optional far land',landResult.reason);
  if(tallResult.status==='rejected')console.warn('optional tall landmarks',tallResult.reason);
  const landPart=landResult.status==='fulfilled'?landResult.value:null;
  const tallPart=tallResult.status==='fulfilled'?tallResult.value:null;
  if(landPart){
    try{
      // Check both query rewrites before changing the live sea. This failure
      // affects only land/water; valid turbines and their solids still attach.
      waterReflections?.transformSea(farSeaVertex,farSeaFragment);
      sea.geometry.dispose();sea.geometry=landPart.land.seaGeometry;
      seaColour.vertexShader=landPart.vertex;seaColour.fragmentShader=landPart.fragment;
      seaColour.depthTest=seaColour.depthWrite=true;seaColour.needsUpdate=true;
      shared.farCurveOn.value=1;
      farLand=landPart.land;scene.add(farLand.group);
    }catch(e){console.warn('optional far sea',e);}
  }
  const near=tallPart?.near??null;
  if(near){tall=near;scene.add(near.group);}
  if(tallPart&&near&&farLand){
    try{farTurbines=new FarTurbines(tallPart.data.far,manifest.village,LOW,shared,sun.el<0);scene.add(farTurbines.group);}
    catch(e){console.warn('optional far turbines',e);}
  }
  const queryMeshes:THREE.Mesh[]=[];
  if(farLand){farLand.land.renderOrder=3;queryMeshes.push(farLand.land);}
  if(farTurbines){for(const mesh of farTurbines.group.children)mesh.renderOrder=3;if(sun.el>=0&&farTurbines.count)queryMeshes.push(farTurbines.group.children[0] as THREE.Mesh);}
  farVisibility=new FarVisibility(renderer,queryMeshes);
  if(near?.turbineCount&&!history)placesUI?.addPlaces(tallPlaces(AREA.id));
  if(import.meta.env.DEV)expose({tall,farLand,farTurbines,farVisibility});
}

// One invented driveway, guarded against all mailboxes, houses and existing site clearings.
const yardDogSite = ERA.modern && AREA.id === 'mabou' && buildingList && props ? YardDogSite.create({
  roads: roads.roads, village: manifest.village, mail: [...props.mail,...props.sites],
  houses: properties.filter(b=>b.kind==='house').map(b=>({x:b.x-manifest.village[0],z:manifest.village[1]-b.y})),
  excluded: [...terrain.sites.map(s=>s.box), ...(coast ? [coast.site.box] : []), ...clear.map((b: number[]):[number,number,number,number]=>[b[0],b[1],b[2],b[3]])],
}) : null;
if (yardDogSite) { clear.push(...yardDogSite.clear); terrain.sites.push(yardDogSite); }
let garageEntry = readVehicle(params, !mailMode), vehicleSpec = garageEntry.spec;
// A vehicle whose model is a file (the mail car): its download began at the top of this file. A load that fails must
// never stop the game: the entry builds its fallback, and a rejection is swallowed here.
await garageEntry.ready?.(params, LOW).catch((error: unknown) => { console.warn('The vehicle model did not load.', error); });
const horse = vehicleSpec.locomotion === 'horse';
let car = fleetRig(garageEntry, mailMode, LOW, params, SITE.brand === 'just', ERA.modern);
scene.add(car.root);
let vehicle = garageEntry.ride
  ? legacyVehicle(garageEntry.ride(car, terrain, roads, SEA_LEVEL, vehicleSpec))
  : new Vehicle(car, terrain, roads, SEA_LEVEL, vehicleSpec);
/** Live selection seam for journey HUDs, saves and other host consumers. */
export function getDrivenVehicle(): Vehicle { return vehicle; }
if (terrain.paved) terrain.paved.car = vehicle;
if (!mailMode) vehicle.touchSpeedLimit = false;
const ride = rideFeatures(vehicle, garageEntry, terrain, !mailMode, SITE.brand !== 'just', SITE.brand === 'just');
// The playable area stops 120 m inside the box of fine map data. Past it the roads are not in the data.
const EDGE = 120;
const edge = manifest.mid ? new Edge(roads, terrain, [manifest.mid[0] - VE + EDGE, VN - manifest.mid[3] + EDGE, manifest.mid[2] - VE - EDGE, VN - manifest.mid[1] - EDGE], SITE.brand === 'just' ? false : AREA.route, vehicleSpec.envelope.nose, !ERA.modern) : null;
if (edge) { vehicle.bounds = edge.bounds; scene.add(edge.group); }
const yardDog = yardDogSite ? new YardDog(yardDogSite, terrain) : null;
if (yardDog) scene.add(yardDog.group);
// Night lamps: the town street lamps the props already draw, and invented yard lamps far from every house and box.
const night = nightShading ? new Night(nightShading, {
  scene, sky, sunDir: directionFromAngles(sun.az, sun.el), car, fog: shared.fogColor,
  heightAt: (x, z) => terrain.heightAt(x, z), level: (x, z) => terrain.levelAt(x, z),
  streets: props?.poleSites.filter(p => p.light) ?? [],
  yards: props ? chooseYardLights(props.poleSites, {
    protectedPlaces: [...properties.map(b => ({ x: b.x - VE, z: VN - b.y })), ...props.mail, ...props.sites],
    excluded: [...terrain.sites.map(s => s.box), ...(coast ? [coast.site.box] : [])], village: { x: 0, z: 0 },
  }) : [],
  village: { x: 0, z: 0 }, when, lat, lon,
}) : null;
if (night) scene.onBeforeRender = (r, _scene, view) => night.update(r, view);
const yard = yardSite ? new Yard(yardSite, terrain, LOW) : null;
if (yard) scene.add(yard.group);
const home = homeSite ? new Home(homeSite, terrain, (metres) => (metres > SEA_LEVEL ? SEA_LEVEL + (metres - SEA_LEVEL) * EXAG : metres)) : null;
if (home) scene.add(home.group);
const porch = porchSite ? new PorchHouse(porchSite, terrain, (metres) => (metres > SEA_LEVEL ? SEA_LEVEL + (metres - SEA_LEVEL) * EXAG : metres)) : null;
const porchDog = porch ? new PorchDog(LOW) : null;
if (porch) { scene.add(porch.group); if (porchDog) porch.seat(porchDog.group); }
const church = churchSite ? new (await import('./church')).Church(churchSite, terrain) : null;
if (church) scene.add(church.group);
const village = villageSite ? new (await import('./judique-village')).JudiqueVillage(villageSite, terrain, LOW) : null;
if (village) scene.add(village.group);
const hawkesbury = hawkesburySite ? new (await import('./port-hawkesbury')).PortHawkesbury(hawkesburySite, terrain, LOW,
  roads.roads.map(r => ({ halfWidth: r.halfWidth, pts: r.pts.map(([x, z]): [number, number] => [x + manifest.village[0], manifest.village[1] - z]) })), mappedBuildings) : null;
if (hawkesbury) scene.add(hawkesbury.group);
const mabouMain = mabouSite ? new (await import('./mabou-main')).MabouMain(mabouSite, terrain, LOW, roads.roads) : null;
if (mabouMain) scene.add(mabouMain.group);
const quarry = quarryFeature && quarrySite ? new quarryFeature.Quarry(quarrySite, terrain, roads) : null;
if (quarry) quarry.attach(scene, waterReflections);
// The small switch loads other players' cars only after consent.
// A build made with VITE_MP=0 has the code compiled out (web/vite.artifact.config.ts sets the default, which is on).
// Off in a history era: rooms are per area, not per era, so two eras would meet in one room.
const MULTIPLAYER = (import.meta.env.DEV || import.meta.env.VITE_MP === '1') && ERA.modern;
const multiplayer = MULTIPLAYER ? multiplayerSwitch({ scene, roads: roads.roads, get vehicle() { return vehicle; }, low: LOW, bare, params, area: AREA.id, touch: touchDevice, label: SITE.brand === 'just' ? (_name, id) => `Driver ${id}` : undefined,
  ride: () => ({ kind: (horse ? 'car' : garageEntry.id) as 'car' | 'truck' | 'sxs' | 'bike', trailer: towing?.attached ?? false }),
  settings: document.getElementById('settings'), before: document.getElementById('startOver'),
  ground: (x, z) => { const g = terrain.heightAt(x, z), deck = roads.deckHeight(x, z); return g === null ? null : deck !== null ? Math.max(deck, g) : g; } }) : null;
const canal = ERA.modern && AREA.id === 'cansocauseway' ? new Canal(roads, terrain, manifest.village, SEA_LEVEL) : null;
if (canal) scene.add(canal.group);
let canalBeforeX = 0, canalBeforeZ = 0;
// A site registers here once. Fleet sweeps and fixed-step driving use this same list.
const fleetContacts = new AreaContacts();
if(stuntPark)fleetContacts.add(stuntPark.contactProvider());
if (quarry) {
  fleetContacts.add(quarry.contactProvider());
  if (!fleetEnabled(garageEntry, params, !mailMode, ERA.modern)) quarry.bindVehicle(vehicle, fleetContacts);
}
if (yard) fleetContacts.add({ revision: () => yard.collisionVersion(), resolve: body => yard.resolveSolids(body), allows: body => yard.allowsBody(body, body.spec, body.y) });
if (history) fleetContacts.add({ resolve: body => history.resolve(body as unknown as Vehicle) });
if (home) fleetContacts.add({ resolve: body => home.resolveSolids(body) });
if (porch) fleetContacts.add({ resolve: body => porch.resolveSolids(body) });
if (church) fleetContacts.add({ resolve: body => church.resolveSolids(body) });
// The optional pack arrives after boot; the registry must see its new solids.
if (tallKey) fleetContacts.add({ revision: () => tall?.solids.length ?? 0, resolve: body => tall?.resolveSolids(body) });
if (village) fleetContacts.add({ resolve: body => village.resolveSolids(body) });
if (hawkesbury) fleetContacts.add({ resolve: body => hawkesbury.resolveSolids(body) });
if (mabouMain) fleetContacts.add({ resolve: body => mabouMain.resolveSolids(body) });
if (cemeteries) fleetContacts.add({ resolve: body => cemeteries.resolveSolids(body) });
if (props) fleetContacts.add({ revision: () => props.downCount, resolve: () => {}, allows: body => props.allowsFleetBody(body) });
if (roads.guardrails) {
  const rails = roads.guardrails, probe = { x: 0, z: 0, y: 0, heading: 0, spec: vehicleSpec, vx: 0, vz: 0, speed: 0 };
  fleetContacts.add({ revision: () => rails.audit.planned + rails.audit.samples,
    resolve: body => { if (body !== vehicle) rails.block(body); },
    allows: body => { probe.x=body.x; probe.z=body.z; probe.y=body.y; probe.heading=body.heading; probe.spec=body.spec; probe.vx=probe.vz=probe.speed=0; rails.block(probe); return Math.hypot(probe.x-body.x,probe.z-body.z)<1e-7; },
  });
}
fleetContacts.add({ resolve: () => {}, allows: body => { const b = vehicle.bounds, r = body.spec.envelope.reach; return !b || body.x - r >= b[0] && body.z - r >= b[1] && body.x + r <= b[2] && body.z + r <= b[3]; } });
// LOW (phones) builds the AI from the parked display models, without the car.
const aiDriver = driverEnabled(AREA.id, ERA.modern, params, import.meta.env.DEV) ? new PointTupperDriver(roads, terrain, fleetContacts, garageEntry.id, SEA_LEVEL, Math.random, undefined, LOW) : null;
if (aiDriver) scene.add(aiDriver.group);
// Time-travel seam: read the live era every call, so a runtime swap to 1884 hides the AI.
const aiDriverOn = () => driverLive(ERA.modern, !!multiplayer?.choice.on);
let towing: Towing | null = null;
let fleet: Fleet | null = null, updateFleetHud: (() => void) | null = null;
if (aiDriver) aiDriver.obstacles = () => [...(towing?.bodies() ?? []), ...(fleet?.members.filter(m => m.state === 'PARKED' || m.state === 'DRIVEN').map(m => m.vehicle) ?? [])];
let drivenChanged: (() => void) | null = null;
let roadsidePlaying = false;
let hookPlaced = false, jumpPlacement = 0;
const jumpCheck = import.meta.env.DEV && params.get('jumpCheck') === '1';
const fishingCheck = import.meta.env.DEV && params.get('fishingCheck') === '1';
const resolveYardSolids = () => {
  if (endings.busy) return;
  canal?.resolve(vehicle, canalBeforeX, canalBeforeZ);
  if (aiDriverOn()) aiDriver?.resolve(vehicle);
  if (fleet || quarry || stuntPark) fleetContacts.resolve(vehicle);
  else { yard?.resolveSolids(vehicle); history?.resolve(vehicle); home?.resolveSolids(vehicle); porch?.resolveSolids(vehicle); church?.resolveSolids(vehicle); village?.resolveSolids(vehicle); hawkesbury?.resolveSolids(vehicle); mabouMain?.resolveSolids(vehicle); cemeteries?.resolveSolids(vehicle); tall?.resolveSolids(vehicle); }
  stuntPark?.step(1/120,vehicle,started&&mode==='drive',jumpPlacement,false);
  fishing?.step(1 / 120, started && !shift.ended && !demo && mode === 'drive' && (!hookPlaced || fishingCheck), jumpPlacement);
  yardJob?.step(1 / 120, started && !shift.ended && !demo && mode === 'drive' && (!hookPlaced || jumpCheck), jumpPlacement);
  syncRoadScenePause();
  if (!scenePaused()) roadScene?.step(1 / 120, vehicle, horse ? roadsidePlaying : vehicle.damageActive);
  if (!scenePaused()) ambientTraffic?.step(1 / 120, vehicle);
  if (!scenePaused()) roadAnimals?.step(1 / 120, vehicle, horse ? roadsidePlaying : vehicle.damageActive);
  if (!scenePaused()) canal?.advance(1 / 120, vehicle, !multiplayer?.choice.on);   // the canal clock runs with the traffic
  if (!fleet && !quarry && !stuntPark) ambientTraffic?.resolve(vehicle);   // otherwise fleetContacts, above, holds the traffic
  schoolBus?.setPaused(scenePaused());
  schoolBus?.step(1 / 120, vehicle, horse ? roadsidePlaying : vehicle.damageActive, jumpPlacement);
  if (fleet) fleet.resolve(); else towing?.step();
};
let engineThrottle = 0;   // the pedal the vehicle really got this frame, for the engine sound
const engineMoment: DrivingMoment = { kind: '', speed: 0, throttle: 0, surface: '', airborne: false, grade: 0, towing: false, radio: false, slide: 0 };
function driveVehicle(dt: number, input: Input): void {
  engineThrottle = input.throttle;
  syncRoadScenePause();
  if (scenePaused()) return;
  canalBeforeX = vehicle.x; canalBeforeZ = vehicle.z;
  terrain.withGroundContact(vehicle, () => fleet ? fleet.drive(dt, ride.input(input), resolveYardSolids) : vehicle.update(dt, ride.input(input), resolveYardSolids));
  if (!fleet) towing?.update();
  if (aiDriverOn()) aiDriver?.step(dt, vehicle);
}
// For test scripts on the dev server only. Each call is guarded by import.meta.env.DEV so a production build drops the
// whole statement, arguments included. tools/yard-drive.mjs moves the car through this, and tools/fps-check.mjs
// reads from the renderer how many frames it has really drawn.
function expose(part: object, enumerable = true): void {
  if (import.meta.env.DEV) {
    const dev = window as unknown as { mmm?: object };
    // Keep live driven-vehicle accessors when adding development tools.
    const properties = Object.getOwnPropertyDescriptors(part);
    if (!enumerable) for (const property of Object.values(properties)) property.enumerable = false;
    const target = dev.mmm ??= {};
    for (const [name, property] of Object.entries(properties)) {
      // Data assignments still notify instrumentation installed before boot; incoming getters stay live.
      if ('value' in property && Object.getOwnPropertyDescriptor(target, name)?.set) Reflect.set(target, name, property.value);
      else Object.defineProperty(target, name, property);
    }
  }
}
if (import.meta.env.DEV) expose({ vehicle: new Proxy(vehicle, {
  getPrototypeOf() { return Object.getPrototypeOf(vehicle); },
  set(target, key, value) {
    if (['x', 'z', 'y', 'heading', 'vx', 'vz', 'vy', 'speed', 'airborne'].includes(String(key))) { hookPlaced = true; jumpPlacement++; }
    return Reflect.set(vehicle, key, value);
  },
  get(target, key) {
    const current = vehicle, value = Reflect.get(current, key);
    if (typeof value !== 'function') return value;
    return (...args: unknown[]) => {
      if (key === 'place' || key === 'restart' || key === 'respawn') { hookPlaced = true; jumpPlacement++; }
      return value.apply(current, args);
    };
  },
}), era: ERA, history, canal, scene, props, buildings, landmarks, harbourLights, tall, farLand, farTurbines, farVisibility, area: AREA, roads, edge, yard, ...(stuntPark ? { stuntPark, sunShadows } : {}), renderer, grass, trees, terrain, camera, driveVehicle, chase, water: waterReflections, detail, quality, picture, coast, culverts: culvertMouths, low: LOW });
if (import.meta.env.DEV && multiplayer) expose({ mp: multiplayer });   // for tools/mp-game-check.mjs
const mail = mailMode ? new Mail(terrain, props, properties, manifest.village, LOW) : new SceneryContact(props);
scene.add(mail.group);
const phoneMailHud = mail instanceof Mail ? new PhoneMailHud(mail, touchDevice && !bare, bare) : null;
const mailScore = document.getElementById('mailScore');
const mailButton = document.getElementById('mailButton');
const mailPointers = new Set<number>();
let mailRequested = false, photoRequested = false;
mailButton?.addEventListener('pointerdown', (ev) => {
  ev.preventDefault(); ev.stopPropagation();
  mailButton.setPointerCapture(ev.pointerId); mailPointers.add(ev.pointerId); mailRequested = true;
  mailButton.classList.add('held');
});
const releaseMail = (ev: PointerEvent) => {
  mailPointers.delete(ev.pointerId);
  if (!mailPointers.size) mailButton?.classList.remove('held');
};
mailButton?.addEventListener('pointerup', releaseMail);
mailButton?.addEventListener('pointercancel', releaseMail);
mailButton?.addEventListener('lostpointercapture', releaseMail);
addEventListener('blur', () => { mailRequested = false; mailPointers.clear(); mailButton?.classList.remove('held'); });
const animals = AREA.animals ? new Animals(roads, terrain, buildingList, manifest.village) : null;
await animals?.ready;
if (animals) scene.add(animals.group);

// ---- modes --------------------------------------------------------------------------------
// drive: behind the car. fly: the camera drone (F, drone.active), or a free camera for the fixed views and ?cam.
let mode: 'drive' | 'fly' = AREA.fixedShots && params.has('shot') || params.has('cam') ? 'fly' : 'drive';
let view: 'chase' | 'seat' = params.get('view') === 'seat' ? 'seat' : 'chase';
const devHooks = new DevHooks(params);
const demo = devHooks.demo;   // seconds of self-driving, including production screenshot links
let yaw = 0, pitch = 0, flySpeed = 40, pendingShot: Shot | null = null;
let waitingToDrive = true;
const drone = new Drone();
scene.add(drone.group);
// The drone's floor reads the roofs that are drawn: the surveyed boxes less those Mabou's main street replaces, and the
// hand-built main street's own roofs, measured from its geometry once each place is built. 1884 draws other roofs.
const boxRoofAt = roofHeights(ERA.modern && buildingList ? mabouSite ? mabouSite.drawn(buildingList) : buildingList : [], manifest.village, EXAG, SEA_LEVEL);
const roofAt = mabouMain ? (x: number, z: number) => Math.max(boxRoofAt(x, z), mabouMain.roofAt(x, z)) : boxRoofAt;
if (import.meta.env.DEV) expose({ drone });

function applyShot(s: Shot) {
  drone.stow(); droneSticks?.show(false);
  mode = 'fly';
  const p = toWorld(s.e, s.n);
  yaw = -THREE.MathUtils.degToRad(s.heading);
  pitch = THREE.MathUtils.degToRad(s.pitch);
  camera.fov = s.fov;
  camera.position.set(p.x, s.abs !== undefined ? s.abs * EXAG : 80, p.z);
  pendingShot = s.eye !== undefined ? s : null;   // settle on the ground once it has loaded
  resize();
}

// Today's run starts every try at its seeded place, not at the first stop of the route.
const dailyPose = DAILY ? startKey(DAILY.start, roads.roads, vehicle.bounds) : null;
function placeFirstStop(kind: 'start-over' | 'new-visit' = 'start-over'): void {
  const start = AREA.route ? shift.run.start : roadStart(roads.roads);
  const namedStart = AREA.id === 'westbay' && ERA.modern && params.get('poster') === 'sugar-camp-quarry' ? sugarCampStart(roads.roads, manifest.village, vehicle.bounds!) : undefined;
  const pose = namedStart ?? dailyPose ?? start ?? { x: 0, z: 0, heading: Math.PI / 4 };
  // The poster start always faces south, toward the quarry, on Start over too.
  const southward = namedStart ? (candidate: { heading: number }) => Math.cos(candidate.heading) < 0 : undefined;
  if (fleet) { if (kind === 'new-visit') fleet.startVisit(pose.x, pose.z, pose.heading, southward); else fleet.restart(pose.x, pose.z, pose.heading, 'start-over', southward); } else vehicle.restart(pose.x, pose.z, pose.heading);
}
// Boxes within 12 m of the wall, or past it, are left to the next carrier.
if (edge) { const [bx0, bz0, bx1, bz1] = edge.bounds; Route.reachable = (x, z) => x > bx0 + 12 && x < bx1 - 12 && z > bz0 + 12 && z < bz1 - 12; }
const resets: Array<() => void> = [];
// Named slots preserve the old reset order, independent of feature construction order.
const resetSlot = { interiors: 0, relief: 1, yardJob: 2, fishing: 3, roadScene: 4, schoolBus: 5, stuntPark: 6, roadAnimals: 7 };
const shift = mail instanceof Mail ? new Shift(props, mail, roads, terrain, properties, manifest.village, LOW, params, () => {
  multiplayer?.reset();
  resets.forEach(reset => reset()); hookPlaced = false; jumpPlacement++; placeFirstStop(); waitingToDrive = true; keys.clear(); pointers.clear(); mailPointers.clear(); mailRequested = photoRequested = false;
  touch.steer = touch.throttle = 0; camReady = false; mode = 'drive'; drove = demo; devHooks.reset();
}, AREA.route, firedMode, DAILY?.day ?? 0) : new FreeDrive(roads, manifest.village);
const roadScene = AREA.roadScene && shift instanceof Shift ? new RoadScene(roads, terrain, shift, params) : null;
resets[resetSlot.roadScene] = () => roadScene?.reset();
if (roadScene) { scene.add(roadScene.group, roadScene.painter.group); vehicle.placementGuard = pose => roadScene.allowPlacement(pose, vehicleSpec); }
// Players get traffic; the dev server and test visits only with trafficCheck=1, so existing checks keep their scenes.
const trafficWanted = params.get('trafficCheck') === '1' || !import.meta.env.DEV && !isTestVisit(params);
const ambientTraffic = ERA.modern && params.get('traffic') !== '0' && trafficWanted ? new AmbientTraffic(roads, terrain, LOW) : null;
if (ambientTraffic) { scene.add(ambientTraffic.group); fleetContacts.add(ambientTraffic); }
// At Canso the traffic stops at the closed canal barrier and its queue, and holds the transit while it is on the span.
if (canal && ambientTraffic) { ambientTraffic.others = canal.drivers; ambientTraffic.keepOut = canal.keepOut; canal.traffic = ambientTraffic.cars; }
// The Point Tupper AI and the traffic keep their distance from each other; the AI stops at the junction signals.
if (aiDriver) {
  aiDriver.signals = trafficSignals;
  if (ambientTraffic) {
    aiDriver.traffic = ambientTraffic.cars;
    ambientTraffic.others = aiDriver.onRoad;
  }
}
if (import.meta.env.DEV) expose({ ambientTraffic });
const schoolBus = ERA.modern && AREA.id === 'mabou' && shift instanceof Shift ? new SchoolBus(roads, terrain, shift) : null;
if (shift instanceof Shift) {
  // The score stream names real places where nothing scores: church grounds, cemeteries and the school bus stop.
  const stop = { x: 0, z: 0, heading: 0 }; schoolBus?.road?.at(BUS.stop, BUS.lane, stop);
  const zones = [...churchZones(landmarkList, manifest.village), ...schoolBus?.road ? [{ place: 'busStop', ...stop, radius: BUS_STOP_RADIUS }] : []];
  const cemetery = cemeteries ? (x: number, z: number) => cemeteries.excludes(x + manifest.village[0], manifest.village[1] - z) : undefined;
  shift.placeAt = (x, z) => placeAt(x, z, zones, cemetery);
  if (schoolBus) schoolBus.onPass = p => shift.reportScore('schoolBus', p.x, p.z, p.speed);
}
resets[resetSlot.schoolBus] = () => schoolBus?.reset();
resets[resetSlot.stuntPark]=()=>stuntPark?.reset();
if (schoolBus) {
  scene.add(schoolBus.group);
  fleetContacts.add({ resolve: body => pushOut(body, schoolBus.placementSolids, true), allows: body => schoolBus.allows(body, body.spec) });
  const previousGuard = vehicle.placementGuard;
  vehicle.placementGuard = pose => (!previousGuard || previousGuard(pose)) && schoolBus.allows(pose, vehicleSpec);
}
// Deer, foxes and a rare moose on the paved and gravel roads of a mail day (a roadside scene, so mail areas only: never the
// Canso canal span). The same gate as the traffic: players get them; the dev server and test visits only with wildlife=1,
// so existing checks keep their scenes. A multiplayer room clears them, as it clears the traffic.
const wildlifeWanted = params.get('wildlife') === '1' || !import.meta.env.DEV && !isTestVisit(params);
const animalApart: { x: number; z: number }[] = roadScene ? [roadScene.centre] : [];
// The school bus loop too: its STOP hint must never share the HUD line with an animal's, nor its lane with one.
if (schoolBus?.road) for (let along = 0; along < schoolBus.road.cumulative.at(-1)!; along += 50) { const p = { x: 0, z: 0, heading: 0 }; schoolBus.road.at(along, 0, p); animalApart.push(p); }
const roadAnimals = ERA.modern && shift instanceof Shift && wildlifeWanted ? new RoadAnimals(roads, terrain, shift,
  [...(coast ? [coast.site.box] : []), ...(props?.railObstacles ?? []).map(p => { const r = (p.radius ?? 1) + 1; return [p.x - r, p.z - r, p.x + r, p.z + r]; })],
  animalApart) : null;
// The dogs, the bull and the cows keep their roads: their homes are chosen after the first frames.
if (roadAnimals && animals) void animals.ready.then(() => { animalApart.push(...animals.places); });
resets[resetSlot.roadAnimals] = () => roadAnimals?.reset();
// Built after the fish truck, painter and school bus: shift.roadside order is HUD priority, and theirs comes first.
if (roadAnimals) scene.add(roadAnimals.group);
if (import.meta.env.DEV) expose({ roadAnimals });
if (ERA.modern && garageEntry.id === 'truck' && ['1', 'empty'].includes(params.get('trailer') ?? '')) {
  if (!mailMode && roadScene) fleetContacts.add({ resolve: body => { if (roadScene.rules.enabled) pushOut(body, roadScene.placementSolids, true); } });
  towing = new Towing(vehicle, terrain, roads, params.get('trailer') !== 'empty', touchDevice, { yard, scene: roadScene, bus: schoolBus, props, solids: hawkesbury ? hawkesbury.solids : churchSite || villageSite || mabouSite ? [...churchSite?.solids ?? [], ...villageSite?.solids ?? [], ...mabouSite?.solids ?? []] : undefined, contacts: quarry || stuntPark || fleetEnabled(garageEntry, params, !mailMode, ERA.modern) ? fleetContacts : undefined }, true, LOW);
  if (towing.attached) scene.add(towing.trailer.root);
  trailerHelpSetting(towing, document.getElementById('settings'), document.getElementById('startOver'));
  if (import.meta.env.DEV) expose({ towing });
  if (fleetEnabled(garageEntry, params, !mailMode, ERA.modern) && towing.attached) {
    fleet = new Fleet(vehicle, towing, terrain, roads, scene, LOW, member => {
      garageEntry = member.entry; vehicleSpec = member.entry.spec; car = member.rig; vehicle = member.vehicle;
      night?.setCar(car);
      if (terrain.paved) terrain.paved.car = getDrivenVehicle();
      ride.select(getDrivenVehicle(), garageEntry); vehicle.touchSpeedLimit = mailMode; vehicle.desktopPull = !touchDevice && !LOW;
      drivenChanged?.();
    }, SEA_LEVEL, fleetContacts, true);
    if (import.meta.env.DEV) expose({ fleet });
  }
} else if (!ERA.modern && garageEntry.id === 'truck' && ['1', 'empty'].includes(params.get('trailer') ?? '')) {
  console.warn('Trailers are not available in 1884; driving without a trailer.');
}
// The animals keep clear of a hitched trailer as well as the truck.
if (roadAnimals && towing) roadAnimals.towed = towing;
if (touchDevice && !bare && !horse && ride.drivingHelp) drivingHelpSetting(document.getElementById('settings'), document.getElementById('startOver'), strong => { vehicle.strongHelp = strong; if (fleet) for (const m of fleet.members) m.vehicle.strongHelp = strong; });
if (horse) shift.damage.reset();
vehicle.damage = horse ? null : shift.damage; vehicle.desktopPull = !touchDevice && !LOW;
if (import.meta.env.DEV) expose({ shift, roadScene, schoolBus, animals, sidewalks, aiDriver });
if (import.meta.env.DEV && night) expose({ night });   // for tools/night-shots.mjs and the guard rail night pictures
// Outside the mail game a door is only a place to look: no shift, no receipt. Mabou has no such door, so it stays quiet.
const churchRoom = churchSite ? await import('./interior-church') : null;
const interiors = mailMode ? new Interiors(() => shift.career.day, () => clock(shift.elapsed), receipt => shift.interiorResult(receipt), bare)
  : churchRoom ? new Interiors(() => 0, () => '', () => {}, bare) : quietInteriors();
if(stuntPark)for(const actor of fleet?fleet.members.map(m=>m.vehicle):[vehicle])fleetContacts.bindVehicle(actor,pose=>stuntPark.contains(pose.x,pose.z,actor.spec.envelope.reach)?terrain.heightAt(pose.x,pose.z):actor.y??0);
resets[resetSlot.interiors] = () => interiors.reset();
const mineSite = AREA.colliery ? new MineSite(roads, terrain, vehicle.bounds, manifest.village, SITE.brand === 'just') : null;
if (mineSite) scene.add(mineSite.group);
if (mineSite?.roadPoint) interiors.register({ id: 'mine', name: 'Mabou Mines', position: mineSite.roadPoint, radius: 14,
  prompt: 'Parcel for the night shift. Signature required.', create: day => new MineInterior(day) });
if (AREA.colliery && params.get('interior') === 'mine') interiors.enter('mine');
if (churchSite && churchRoom) interiors.register(churchRoom.churchDoor(churchSite, mailMode));
if (churchRoom && params.get('interior') === 'church') interiors.enter('church');
// The mini map and the bladder gauge build their own parts of the page.
const hikeBox = playableBox(manifest), hikes = mailMode || !ERA.modern ? [] : hikesFor(AREA.id, roads.roads, manifest.village, hikeBox);
const footpaths = !mailMode && hikes.length ? new Footpaths(hikes, terrain) : null;
if (footpaths) scene.add(footpaths.mesh);
const miniMap = bare ? null : new MiniMap(roads, !mailMode, worldHikeLines(hikes, manifest.village));
if (miniMap) miniMap.cartMap = ERA.cartRoads;
const propertyLayer = propertyLines(miniMap, manifest.village, ERA.modern && params.get('era') !== '1884');
if (propertyLayer && !LOW) propertyLayer.setGround(new PropertyGround(terrain));
const journey = quarryFeature && quarrySite && tripId(params) ? new quarryFeature.QuarryJourney(params, roads, manifest.village, getDrivenVehicle, miniMap, await quarryFeature.loadQuarryRoute(roads.roads,terrain)) : null;
const mapStops: MapStop[] = [], mapMarks: MapMark[] = [], mapCars: { x: number; z: number }[] = [];
let mapTimer = 0;
function refreshMap(): void {
  mapStops.length = mapMarks.length = 0;
  multiplayer?.marks(mapCars);
  if (placesUI) mapMarks.push(...placesUI.marks);
  if (props) for (const stop of shift.run.stops) {
    const i = stop.index, p = i < props.mail.length ? props.mail[i] : props.sites[i - props.mail.length];
    if (p) mapStops.push({ x: p.x, z: p.z, due: shift.remaining[i] > 0 });
  }
  // A place that already has its own mark does not get a second one for its door.
  for (const door of interiors.doors.values()) if (!mapMarks.some(mark => mark.label === door.name)) mapMarks.push({ x: door.position.x, z: door.position.z, label: door.name, rank: 3, radius: door.radius });
}
const relief = mailMode ? new Relief(properties.filter((b) => b.kind === 'house').map((b) => ({ x: b.x - manifest.village[0], z: manifest.village[1] - b.y })),
  terrain, (o) => { if (o.seen) shift.seenAtRoadside(o.house, o.x, o.z); if (params.has('relief')) console.log(`[relief] ${JSON.stringify(o)} calls ${shift.complaints.all.length}`); }, bare) : quietRelief();
resets[resetSlot.relief] = () => relief.reset();
// The car radio plays the author's own songs when the build carries them (audio/radio.json). ?radio=0 leaves it out.
// It is fetched further down, once the title card exists.
let radio: Radio | null = null;
// Get Fired only: callers phone 94.9 about the run (party-line.ts), when the build carries recorded calls.
let partyLine: PartyLine | null = null;
// Test links: ?relief=0.9 sets the gauge (and shows it in a demo drive); ?break=1 steps out as soon as the car has stopped.
const reliefTest = Number(params.get('relief'));
if (reliefTest > 0) relief.level = Math.min(1, reliefTest);
const placeVisit = (x: number, z: number, heading: number) => fleet ? fleet.startVisit(x, z, heading) || fleet.visitQueued : vehicle.place(x, z, heading);
const urlPlacement = fleet ? { bounds: vehicle.bounds, place: placeVisit } : vehicle;
const startPlacement = fleet ? {
  get x() { return vehicle.x; }, get z() { return vehicle.z; }, get heading() { return vehicle.heading; },
  get placementGuard() { return vehicle.placementGuard; }, set placementGuard(guard: Vehicle['placementGuard']) { vehicle.placementGuard = guard; },
  restart(x: number, z: number, heading: number) { const guard = vehicle.placementGuard; fleet!.startVisit(x, z, heading, pose => guard?.(pose) !== false); },
} : vehicle;
// The daily run supplies the start unless the address bar supplies: ?at=east,north,heading
{
  const at = params.get('at')?.split(',').map(Number);
  const driveAt = !mailMode && !params.has('at') ? readDrivePosition(params, manifest.village, vehicle.bounds) : undefined;
  // ?road=Mabou Harbour Road&f=0.4 puts the car on a named road, at a fraction of its longest piece.
  const named = params.get('road');
  const piece = named ? roads.roads.filter((r) => r.name?.toLowerCase() === named.toLowerCase() && !r.bridge).sort((a, b) => b.pts.length - a.pts.length)[0] : undefined;
  if (import.meta.env.DEV && (params.get('at') === 'wharf' || params.get('at') === 'wharf-road')) {
    const roadStart = params.get('at') === 'wharf-road';
    const p = toWorld(roadStart ? 618800.52 : 618657.9, roadStart ? 5105101.83 : 5104815.8);
    placeVisit(p.x, p.z, THREE.MathUtils.degToRad(roadStart ? 168 : 165));
    hookPlaced = true; jumpPlacement++;
  } else if (piece) {
    const k = Math.min(piece.pts.length - 2, Math.floor(THREE.MathUtils.clamp(parseFloat(params.get('f') ?? '0.5'), 0, 1) * (piece.pts.length - 1)));
    const [ax, az] = piece.pts[k], [bx, bz] = piece.pts[k + 1];
    const flip = params.get('dir') === 'back' ? Math.PI : 0;
    placeVisit(ax, az, Math.atan2(bx - ax, -(bz - az)) + flip);
  } else {
    const pose = at && at.length >= 2 ? at : driveAt;
    if (!pose || !placeUrlPose(urlPlacement, manifest.village, pose)) {
      if (journey) journey.place(placeVisit);
      else {
        // ?start=mabou-harbour-road is a player's link: the title card stays, and only this first place changes.
        const asked = startKey(params.get('start'), roads.roads, vehicle.bounds);
        if (!asked || (!placeAtStart(startPlacement, asked) && !fleet?.visitQueued)) placeFirstStop('new-visit');
      }
    }
  }
}

scene.add(shift.group);
// Dust from the rear wheels and the small meter, only while the ride drifts (drift-rules.ts).
const driftFeedback = new DriftFeedback(LOW, !bare);
scene.add(driftFeedback.mesh);
if (import.meta.env.DEV) expose({ driftFeedback });
animals?.registerEvidence(shift.evidence);
document.getElementById('cameraButton')!.addEventListener('click', () => { if (live()) photoRequested = true; });
for (const id of ['cameraButton', 'endShift', 'shiftReport', 'settings']) {
  for (const event of ['pointerdown', 'pointerup', 'pointermove']) document.getElementById(id)?.addEventListener(event, (ev) => ev.stopPropagation());
}
// ?stuffed=first (or a stable props index) gives a close inspection of today's old flyers.
if (mailMode && params.has('stuffed') && props) {
  const asked = Number(params.get('stuffed'));
  const i = Number.isInteger(asked) && asked >= 0 && shift.today.stuffed[asked] ? asked : shift.today.stuffed.findIndex(Boolean);
  const p = props.mail[i];
  if (p) {
    const road = roads.nearest(p.x, p.z, 40);
    if (road) {
      let heading = road.heading;
      if ((p.x - road.x) * Math.cos(heading) + (p.z - road.z) * Math.sin(heading) < 0) heading += Math.PI;
      vehicle.place(road.x - Math.sin(heading) * 3, road.z + Math.cos(heading) * 3, heading);
    }
  }
}

const lawnHouse = mailMode && params.has('lawn') ? properties.find((b) => b.id === Number(params.get('lawn')) && b.kind === 'house') : null;
const lawnDemo = lawnHouse ? new LawnDemo(lawnHouse, manifest.village, vehicle) : null;

// ---- input --------------------------------------------------------------------------------
const keys = new Set<string>();
// Enter or Space on a control that has the focus (Tab, then the key) belongs to that control, not to the game.
// The one exception is Space on the mail button, which throws mail by design.
const ownedByControl = (ev: KeyboardEvent) => (ev.code === 'Enter' || ev.code === 'Space') && ev.target instanceof HTMLElement
  && !(ev.code === 'Space' && ev.target === mailButton) && ev.target.closest('button, input, select, textarea, a[href]') !== null;
// A mouse click or a tap leaves the focus on the button it hit. Hand the focus back, so Space stays the brake.
addEventListener('click', (ev) => { if (ev.detail > 0 && ev.target instanceof HTMLElement) ev.target.closest('button')?.blur(); });
addEventListener('keydown', (ev) => {
  if (!live() || typing(ev)) return;   // a modal or text field owns input
  if (fleet?.busy || fleet && ev.repeat && !keys.has(ev.code)) return;
  if (ownedByControl(ev)) return;
  // The drone's own keys (arrows, Q/E turn, C down, R flies home) never reach the mail, explore or interior keys.
  if (mode === 'fly' && drone.active && DRONE_KEYS.includes(ev.code)) {
    ev.preventDefault(); keys.add(ev.code);
    if (ev.code === 'KeyR' && !ev.repeat) droneHome();
    return;
  }
  // C is the photo key when driving and still lowers the fly camera (with Q) where photos are not taken.
  if (!mailMode && mode === 'fly' && ev.code === 'KeyC') { keys.add(ev.code); return; }
  // G is a mail key, but a door met on a drive still opens with it.
  if (!mailMode && ev.code === 'KeyG' && interiors.doors.size > 0 && !interiors.busy) {
    if (!ev.repeat) { ev.preventDefault(); interiors.enter(); if (interiors.busy) { keys.clear(); touch.steer = touch.throttle = 0; } }
    return;
  }
  if (!mailMode && exploreKey(ev.code)) return;
  if (interiors.busy) {
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'Space'].includes(ev.code)) { ev.preventDefault(); keys.add(ev.code); }
    if (ev.code === 'Escape' && !ev.repeat) { ev.preventDefault(); interiors.leave(); }
    return;
  }
  if (ev.code === 'KeyG' && !ev.repeat) { ev.preventDefault(); interiors.enter(); keys.clear(); touch.steer = touch.throttle = 0; return; }
  keys.add(ev.code);
  if (ev.code === 'KeyC' && !ev.repeat) { ev.preventDefault(); photoRequested = true; }
  if (ev.code === 'Enter' && !ev.repeat) { ev.preventDefault(); shift.end(); return; }
  if (mode === 'drive' && !ev.repeat && (ev.code === 'KeyM' || ev.code === 'KeyE')) { ev.preventDefault(); mailRequested = true; }
  const n = parseInt(ev.key, 10);
  if (n >= 1 && n <= SHOTS.length) applyShot(SHOTS[n - 1]);
  // F launches the drone from the vehicle; F again sets it back on the roof (and leaves a fixed view).
  if (ev.code === 'KeyF' && !ev.repeat) { yardJob?.judge.cancel(); if (mode === 'drive') launchDrone(); else landDrone(); }
  if (ev.code === 'KeyV') view = view === 'chase' ? 'seat' : 'chase';
  if (ev.code === 'KeyR' && !ev.repeat) { multiplayer?.reset(); if (fleet) fleet.respawn(); else vehicle.respawn(); }
  if (ev.code === 'KeyH' && !ev.repeat && mode === 'drive') honk();
  if (ev.code === 'KeyB' && !ev.repeat && mode === 'drive') relief.request();
  if (ev.code === 'KeyT' && !ev.repeat && mode === 'drive') radio?.next();
});
addEventListener('keyup', (ev) => keys.delete(ev.code));
// A key still held when the drone lands (an arrow tilting the camera) must not become a pedal through its key repeat,
// nor a key held while driving fly the drone off at launch: it counts again once let go and pressed afresh.
const heldAtLanding = new Set<string>();
addEventListener('keydown', (ev) => { if (ev.repeat && heldAtLanding.has(ev.code)) ev.stopImmediatePropagation(); }, { capture: true });
addEventListener('keyup', (ev) => heldAtLanding.delete(ev.code));
addEventListener('blur', () => heldAtLanding.clear());
addEventListener('blur', () => keys.clear());
// Only a wheel over the picture sets the drone's speed: scrolling Settings must not.
addEventListener('wheel', (ev) => { if (drone.active) { if (ev.target === canvas) drone.wheel(ev.deltaY); } else flySpeed = THREE.MathUtils.clamp(flySpeed * (ev.deltaY < 0 ? 1.25 : 0.8), 2, 4000); }, { passive: true });

const pointers = new Map<number, { x: number; y: number; sx: number; sy: number }>();
let flyTouch = 0, droneTurn = 0;   // droneTurn: how far a drag has turned the drone since its last frame
// On a phone the visible pad and pedals own the driving input; with a mouse the old drag on the picture still works.
const honk = () => { if (live() && !fleet?.busy && !document.hidden && !interiors.busy && mode === 'drive') { animals?.honk(vehicle); roadScene?.honk(vehicle); roadAnimals?.honk(vehicle); multiplayer?.horn(); ride.honk(); } };
const pad = touchDevice && !bare ? createTouchControls({
  reset: () => { multiplayer?.reset(); if (fleet) fleet.respawn(); else vehicle.respawn(); },
  view: () => { if (!fleet?.busy) view = view === 'chase' ? 'seat' : 'chase'; },
  horn: honk,
}) : null;
const touch = pad?.state ?? { steer: 0, throttle: 0, handbrake: false, chordAt: 0 };
// The drone on a phone: DRONE beside Pause launches it; two sticks and RETURN fly it.
const droneSticks = touchDevice && !bare ? createDroneSticks(() => droneHome()) : null;
if (pad) {
  const top = document.getElementById('phoneTop'), button = createDroneButton(() => { if (live() && !fleet?.busy && !interiors.busy && mode === 'drive') { yardJob?.judge.cancel(); launchDrone(); } });
  top?.insertBefore(button, document.getElementById('gear'));
}
// A controller (gamepad.ts): the same values and the same actions as the keys. Nothing runs until one is used.
const padAct = (action: () => void) => () => { if (!fleet?.busy && !interiors.busy) action(); };
const gamepad = createGamepad({
  horn: honk,
  mail: padAct(() => { if (mailMode) mailRequested = true; }),
  // B changes the view; inside a building (where every other driving button rests) it climbs out, as Esc does.
  view: () => { if (interiors.busy) interiors.leave(); else if (!fleet?.busy) view = view === 'chase' ? 'seat' : 'chase'; },
  pause: () => { if (pauseAllowed()) { pause.toggle(); syncPauseUI(); } },
  reset: padAct(() => { multiplayer?.reset(); if (fleet) fleet.respawn(); else vehicle.respawn(); }),
  radio: padAct(() => radio?.next()),
  photo: padAct(() => { if (mailMode) photoRequested = true; }),
  relief: padAct(() => relief.request()),
  places: padAct(() => placesUI?.open()),
  back: () => { if (replay.active) replay.close(); else if (placesUI?.busy) placesUI.close(); else if (bigMap?.busy) bigMap.close(); else if (pause.blocked && pauseAllowed()) { pause.toggle(); syncPauseUI(); } },
}, touchDevice, () => mode === 'drive' && live());
if (import.meta.env.DEV) expose({ gamepad });   // for tools/gamepad-browser.mjs
ride.configure(!fleet);
if (fleet) shift.startOver = () => { if (drone.active) landDrone(); placeFirstStop(); waitingToDrive = true; camReady = false; };
if (fleet && !bare) {
  updateFleetHud = fleetHud(fleet, () => started && mode === 'drive' && !scenePaused() && !placesUI?.busy && !bigMap?.busy);
  const restart = document.createElement('button'); restart.id = 'fleetStartOver'; restart.textContent = 'Start over with the trailer';
  restart.onclick = () => shift.startOver();
  document.getElementById('settings')?.append(restart);
}
shift.phone = pad !== null;
canvas.addEventListener('pointerdown', (ev) => {
  canvas.setPointerCapture(ev.pointerId);
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, sx: ev.clientX, sy: ev.clientY });
  readTouch();
});
const release = (ev: PointerEvent) => { pointers.delete(ev.pointerId); if (pointers.size < 2) flyTouch = 0; readTouch(); };
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('pointermove', (ev) => {
  const p = pointers.get(ev.pointerId);
  if (!p) return;
  const dx = ev.clientX - p.x, dy = ev.clientY - p.y;
  p.x = ev.clientX; p.y = ev.clientY;
  if (mode === 'drive') { readTouch(); return; }
  if (pointers.size >= 2) { flyTouch = THREE.MathUtils.clamp(flyTouch - dy * 0.02, -1, 1); return; }   // two fingers: drag up to fly forward
  const k = (camera.fov / 51) * 0.0032;
  yaw -= dx * k; droneTurn -= dx * k;
  pitch = THREE.MathUtils.clamp(pitch - dy * k, -1.5, 1.5);
  pendingShot = null;
});

/** Touch driving: the left half of the screen steers by sideways drag; the right half is the pedals (top: go, bottom: brake and reverse). */
function readTouch() {
  if (pad) return;
  touch.steer = 0; touch.throttle = 0;
  if (mode !== 'drive') return;
  for (const p of pointers.values()) {
    if (p.sx < innerWidth / 2) touch.steer = THREE.MathUtils.clamp((p.x - p.sx) / 70, -1, 1);
    else touch.throttle = p.y < innerHeight * 0.62 ? 1 : -1;
  }
}

let chordOn = false;   // the phone's two-pedal handbrake was on last frame
function driveInput(): RideInput {
  if (pause.blocked) return { throttle: 0, steer: 0, handbrake: true };
  const k = (a: string, b: string) => (keys.has(a) || keys.has(b) ? 1 : 0), g = gamepad.state;
  // GO and BRAKE held together a moment at speed are the handbrake, with no brake under it, only on a ride that drifts (the
  // bike and the horse keep their pedals) and not on the fleet's pickup, whose handbrake is its parking latch (fleet.ts).
  const drift = vehicle.spec.drift;
  chordOn = touch.handbrake && !!drift && fleet?.driven.id !== 'truck'
    && phoneHandbrake(drift, (performance.now() - touch.chordAt) / 1000, vehicle.speed, touch.steer + g.steer, chordOn);
  const chord = chordOn;
  const input: RideInput = {
    throttle: THREE.MathUtils.clamp(k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown') + (chord ? 0 : touch.throttle) + g.throttle, -1, 1),
    steer: THREE.MathUtils.clamp(k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft') + touch.steer + g.steer, -1, 1),
    handbrake: keys.has('Space') && document.activeElement !== mailButton || g.handbrake || chord,
    touch: touchDevice && k('KeyW', 'ArrowUp') + k('KeyS', 'ArrowDown') + k('KeyA', 'ArrowLeft') + k('KeyD', 'ArrowRight') === 0,
  };
  if (g.pull) input.pull = true;   // the dirt bike's PULL from a bumper; bike-controls.ts adds Shift and the PULL button
  return input;
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

const DRONE_KEYS = ['KeyQ', 'KeyE', 'KeyC', 'KeyR', 'KeyG', 'KeyM', 'KeyB', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
/** The landing spot: the middle of the vehicle's roof. */
const droneRoof = () => ({ x: vehicle.x, y: vehicle.y + vehicleSpec.height, z: vehicle.z });
function launchDrone(): void {
  const roof = droneRoof();
  drone.launch(roof.x, roof.y, roof.z, -vehicle.heading);
  droneUnder.ground = vehicle.y; droneUnder.floor = vehicle.y + DRONE.clearance;
  for (const code of keys) heldAtLanding.add(code);   // a key held while driving does not fly the drone off by key repeat
  mode = 'fly'; pendingShot = null; keys.clear(); droneTurn = 0;
  yaw = drone.state.yaw; pitch = drone.pitch;
  camera.fov = 62; resize();
}
/** Back to driving: the drone is put away on the roof (F, the end of the return flight, or leaving a fixed view). */
function landDrone(): void {
  for (const code of keys) heldAtLanding.add(code);
  drone.stow(); droneSticks?.show(false); keys.clear();
  mode = 'drive';
}
// Picture tools that only need the car held still and a camera of their own get the old free camera (what F did
// before the drone), so no drone hovers in their pictures or moves their camera.
if (import.meta.env.DEV) expose({ freeCamera: () => { yardJob?.judge.cancel(); if (drone.active) { drone.stow(); droneSticks?.show(false); } mode = 'fly'; pendingShot = null; camera.fov = 51; resize(); } });
/** R or RETURN: fly home; pressed again on the way, land at once. */
function droneHome(): void { if (mode === 'fly' && drone.active && drone.callHome()) landDrone(); }
const droneCommand = { forward: 0, right: 0, up: 0, turn: 0 }, droneRoofAt = { x: 0, y: 0, z: 0 };
const droneUnder: { ground: number | null; floor: number | null } = { ground: null, floor: null };
const droneKey = (code: string) => keys.has(code) ? 1 : 0;
function flyDrone(dt: number) {
  droneSticks?.show(!shift.ended);
  if (pause.blocked) return;
  const stick = droneSticks?.command;
  // Keyboard alone flies it: WASD move it level, ←/→ (or Q/E) turn it, ↑/↓ tilt the camera, Space/Shift (or C) climb
  // and descend. Not Ctrl: Ctrl with W, S or D is the browser's own (close tab, save, bookmark).
  const down = Math.max(droneKey('ShiftLeft'), droneKey('ShiftRight'), droneKey('KeyC'));
  droneCommand.forward = droneKey('KeyW') - droneKey('KeyS') + (stick?.forward ?? 0);
  droneCommand.right = droneKey('KeyD') - droneKey('KeyA') + (stick?.right ?? 0);
  droneCommand.up = droneKey('Space') - down + (stick?.up ?? 0);
  droneCommand.turn = Math.max(droneKey('ArrowLeft'), droneKey('KeyQ')) - Math.max(droneKey('ArrowRight'), droneKey('KeyE')) + (stick?.turn ?? 0);
  // A drag (optional) turns the drone and tilts its camera; the gimbal looks from straight down to a little above level.
  const look = droneTurn; droneTurn = 0;
  drone.gimbal(dt, droneKey('ArrowUp') - droneKey('ArrowDown'), pitch);
  // Ground, trees and roofs under it. Where no land is loaded (or off the map) the last known ground still holds.
  const s = drone.state, surface = terrain.surfaceAt(s.x, s.z);
  if (surface) {
    droneUnder.ground = Math.max(surface.ground, SEA_LEVEL);
    droneUnder.floor = Math.max(droneUnder.ground + surface.canopy, roofAt(s.x, s.z)) + DRONE.clearance;
  }
  droneRoofAt.x = vehicle.x; droneRoofAt.y = vehicle.y + vehicleSpec.height; droneRoofAt.z = vehicle.z;
  const landed = drone.update(dt, droneCommand, droneUnder, droneRoofAt, look);
  yaw = drone.state.yaw; pitch = drone.pitch;
  drone.placeCamera(camera, droneUnder.ground);
  if (landed) landDrone();
}

function fly(dt: number) {
  if (drone.active) { flyDrone(dt); return; }
  if (pause.blocked) return;
  const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) + flyTouch;
  const r = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const u = (keys.has('KeyE') || keys.has('Space') ? 1 : 0) - (keys.has('KeyQ') || keys.has('KeyC') ? 1 : 0);
  if (f || r || u) pendingShot = null;
  const v = flySpeed * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 5 : 1) * dt;
  camera.rotation.set(pitch, yaw, 0);
  const dir = new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation);
  const right = new THREE.Vector3(1, 0, 0).applyEuler(camera.rotation);
  camera.position.addScaledVector(dir, f * v).addScaledVector(right, r * v);
  camera.position.y += u * v;
  const g = terrain.heightAt(camera.position.x, camera.position.z);
  if (g !== null) {
    const floor = Math.max(g, SEA_LEVEL) + 1.2;
    if (pendingShot) camera.position.y = Math.max(g, SEA_LEVEL) + pendingShot.eye!;
    else if (camera.position.y < floor) camera.position.y = floor;
  }
}

// The chase camera trails the car's direction of travel and never dips under the ground.
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
let camHeading = 0, camReady = false;
drivenChanged = () => { ride.resetInput(); animals?.resetVehicleHistory(); mail.reset(); camReady = false; waitingToDrive = false; keys.clear(); pointers.clear(); mailPointers.clear(); pad?.release(); touch.steer = touch.throttle = 0; };
if (fleet) fleet.releaseInput = drivenChanged;
if (fleet) fleet.capturePresentation = () => {
  const restoreRideCamera = ride.checkpointCamera();
  const position = camera.position.clone(), rotation = camera.quaternion.clone(), fov = camera.fov, savedView = view;
  const ready = camReady, heading = camHeading, pos = camPos.clone(), look = camLook.clone();
  return () => { restoreRideCamera(); camera.position.copy(position); camera.quaternion.copy(rotation); camera.fov = fov; camera.updateProjectionMatrix(); view = savedView; camReady = ready; camHeading = heading; camPos.copy(pos); camLook.copy(look); };
};
function chase(dt: number) {
  if (drone.active) landDrone();   // driving again after a reset, a jump or a new shift: the drone is back on the roof
  if (fleet?.camera(camera, dt, view)) return;
  if (ride.chase(camera, dt, view, !camReady || !started)) { camReady = true; return; }
  if (view === 'seat') {
    car.driverEye.getWorldPosition(camera.position);
    camera.rotation.set(vehicle.pitch * 0.8, -vehicle.heading, 0);
    if (camera.fov !== 68) { camera.fov = 68; camera.updateProjectionMatrix(); }
    return;
  }
  const towCamera = !fleet || fleet.driven.id === 'truck' ? towing?.camera() : undefined, chaseFov = towCamera?.fov ?? 58;
  if (camera.fov !== chaseFov) { camera.fov = chaseFov; camera.updateProjectionMatrix(); }
  const moving = Math.hypot(vehicle.vx, vehicle.vz) > 2 && vehicle.speed > 0;
  const want = towCamera && towing!.reverseTime > .5 ? towCamera.heading : moving ? Math.atan2(vehicle.vx, -vehicle.vz) : vehicle.heading;
  if (!camReady) camHeading = want;
  camHeading += Math.atan2(Math.sin(want - camHeading), Math.cos(want - camHeading)) * Math.min(1, 3.5 * dt);
  const back = vehicleSpec.chase.back + (towCamera?.back ?? 0) + Math.min(Math.abs(vehicle.speed) * vehicleSpec.chase.speedBack, vehicleSpec.chase.maxSpeedBack);
  const side = towCamera?.side ?? 0;
  const tx = vehicle.x - Math.sin(camHeading) * back + Math.cos(camHeading) * side, tz = vehicle.z + Math.cos(camHeading) * back + Math.sin(camHeading) * side;
  let ty = vehicle.y + vehicleSpec.chase.height + (towCamera?.height ?? 0);
  const g = terrain.surfaceAt(tx, tz);
  if (g) ty = towCamera?.followGround && !vehicle.airborne
    ? Math.max(g.ground, roads.deckHeight(tx, tz) ?? -Infinity) + vehicleSpec.chase.height + towCamera.height
    : Math.max(ty, g.ground + g.canopy * 0.5 + 1.3);
  const k = camReady ? Math.min(1, 7 * dt) : 1;
  camPos.lerp(new THREE.Vector3(tx, ty, tz), k);
  const lookAhead = towCamera ? -towCamera.lookBack : vehicleSpec.chase.lookAhead;
  const target = new THREE.Vector3(vehicle.x + Math.sin(vehicle.heading) * lookAhead + Math.cos(camHeading) * (towCamera?.lookSide ?? 0), vehicle.y + vehicleSpec.chase.lookHeight, vehicle.z - Math.cos(vehicle.heading) * lookAhead + Math.sin(camHeading) * (towCamera?.lookSide ?? 0));
  if (towCamera?.drop !== undefined) target.y = camPos.y - Math.hypot(target.x - camPos.x, target.z - camPos.z) * towCamera.drop;
  camLook.lerp(target, k);
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  camReady = true;
}

// Instant replay (replay.ts): records the driven ride in every mode; the replay itself runs inside the paused frame.
const replayGround = (x: number, z: number): number | null => { const g = terrain.heightAt(x, z), deck = roads.deckHeight(x, z); return g === null ? null : deck !== null ? Math.max(deck, g) : g; };
let replayResume = false, replayOpener: HTMLElement | null = null;
const replay = new Replay({
  canvas, camera, ground: replayGround, wheelRadius: () => vehicleSpec.wheelRadius,
  floor: (x, z) => { const s = terrain.surfaceAt(x, z); return s ? Math.max(s.ground + s.canopy * 0.5 + 1.3, roads.deckHeight(x, z) ?? -Infinity) : replayGround(x, z); },
  // The towed trailer cannot follow the recording; a trailer parked with the truck while another ride drives stays.
  hide: () => towing?.attached && (!fleet || fleet.driven.id === 'truck') ? [towing.trailer.root] : [],
  brand: SITE.brand === 'just' ? 'just' : 'mail', phone: touchDevice,
  closed: () => {
    if (replayResume) pause.resume();
    replayResume = false;
    sunShadows?.update(0, shadowFocus.set(vehicle.x, vehicle.y, vehicle.z), 0, true);
    syncPauseUI();
    if (replayOpener?.isConnected && replayOpener.offsetParent !== null && (pauseScreen.hidden || pauseScreen.contains(replayOpener))) replayOpener.focus({ preventScroll: true });
    replayOpener = null;
  },
});
if (import.meta.env.DEV) expose({ replay, get replayRig() { return car; } }, false);   // for tools/replay-browser.mjs; not enumerable: ui-check pins the public key set
// Nothing scores, breaks or is shown off at a cemetery, a church ground or the school bus stop: marks there are quiet.
const judiqueChurch = villageSite ? toWorld(VILLAGE_PLACES.church.e, VILLAGE_PLACES.church.n) : null;
const quietSites = history?.trades.filter(s => s.kind === 'church').map(s => ({ x: s.x, z: s.z })) ?? [];
// The war memorial lawn on Mabou's main street gets the same respect as a church ground.
const memorial = mabouSite ? toWorld(MAIN_ITEMS.memorial[0], MAIN_ITEMS.memorial[1]) : null;
const quietGround = (x: number, z: number): boolean => !!cemeteries?.near(x + VE, VN - z, 10)
  || !!animals?.near(x, z, 8)   // a stop at an animal is never shown off
  || quietSites.some(s => Math.hypot(x - s.x, z - s.z) < 60)
  || !!memorial && Math.hypot(x - memorial.x, z - memorial.z) < 25
  || !!churchSite && x >= churchSite.box[0] - 15 && x <= churchSite.box[2] + 15 && z >= churchSite.box[1] - 15 && z <= churchSite.box[3] + 15
  || !!judiqueChurch && Math.hypot(x - judiqueChurch.x, z - judiqueChurch.z) < 60
  || !!schoolBus?.active && Math.hypot(x - schoolBus.solid.x, z - schoolBus.solid.z) < 40;
/** Opens the replay over the paused game: from the R-free key I, the pause screen, the day's report or an end card. */
function openReplay(): boolean {
  if (replay.active) return true;
  if (!started || interiors.busy || placesUI?.busy || multiplayer?.choice.on || settingsPanel.classList.contains('open') || !replay.available) return false;
  const wasBlocked = pause.blocked;
  if (!wasBlocked) pause.toggle();
  replayOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  if (!replay.open(car)) { if (!wasBlocked) pause.resume(); syncPauseUI(); return false; }
  replayResume = !wasBlocked;
  syncPauseUI();
  return true;
}
const replayButton = (id: string): HTMLButtonElement => {
  const button = Object.assign(document.createElement('button'), { id, type: 'button', textContent: 'Watch replay', ariaLabel: 'Watch replay. I' });
  button.addEventListener('click', () => { openReplay(); });
  return button;
};
const pause = new PauseGate();
// The title card, an ending and the places panel are their own modals and keep their own keys.
const pauseAllowed = (): boolean => started && !endings.busy && !placesUI?.busy && !bigMap?.busy;
const pauseButton = Object.assign(document.createElement('button'), { id: 'pauseButton', textContent: 'Pause', ariaLabel: 'Pause game. Esc or P' });
const pauseScreen = document.createElement('div');
pauseScreen.id = 'pauseScreen';
pauseScreen.hidden = true;
pauseScreen.innerHTML = '<section role="dialog" aria-modal="true" aria-labelledby="pauseTitle"><h2 id="pauseTitle">Paused</h2><p class="roomPauseNote" hidden>Room games do not pause</p><pre id="pauseState"></pre><button id="resumeGame">Resume</button><button id="pauseReplay" aria-label="Watch replay. I">Watch replay</button><button id="pauseSettings">Settings</button></section>';
document.body.append(pauseScreen);
(document.getElementById('phoneTop') ?? document.body).append(pauseButton);
const settingsPanel = document.getElementById('settings')!;
const roomPauseNote = Object.assign(document.createElement('p'), { textContent: 'Room games do not pause', hidden: true });
settingsPanel.prepend(roomPauseNote);
function syncPauseUI(): void {
  keys.clear(); pointers.clear(); mailPointers.clear(); mailRequested = photoRequested = false;
  touch.steer = touch.throttle = flyTouch = 0;
  const room = !!multiplayer?.choice.on;
  roomPauseNote.hidden = !room;
  pauseScreen.querySelector<HTMLElement>('.roomPauseNote')!.hidden = !room;
  settingsPanel.classList.toggle('open', pause.blocked && !pause.screen && !document.hidden);
  pauseScreen.hidden = !pause.screen || document.hidden || replay.active;
  if (!pauseScreen.hidden) {
    // Rooms do not pause, so they have no replay; a fresh start has nothing to show yet.
    const watch = document.getElementById('pauseReplay') as HTMLButtonElement;
    watch.hidden = room; watch.disabled = !replay.available;
    document.getElementById('pauseState')!.textContent = [document.getElementById('shiftHud')?.textContent || (mailMode ? 'Shift ready' : 'Free drive'), document.querySelector('#racePanel [role=status]')?.textContent || 'No active race'].join('\n');
    document.getElementById('resumeGame')!.focus();
  }
  syncRoadScenePause();
}
addEventListener('keydown', ev => {
  // The replay owns every key while it shows; Tab, and Enter or Space on its focused control, keep their usual action.
  if (replay.active) { replay.key(ev); ev.stopImmediatePropagation(); return; }
  const typing = ev.target instanceof HTMLElement && ev.target.closest('input,select,textarea');
  if (ev.code === 'KeyI' && !typing && !ev.repeat && !ev.ctrlKey && !ev.metaKey && !ev.altKey && openReplay()) { ev.preventDefault(); ev.stopImmediatePropagation(); return; }
  // Escape still closes the places panel and leaves an interior; those modals own it first.
  const escapeOwned = ev.code === 'Escape' && !pause.blocked && interiors.busy;
  if ((ev.code === 'Escape' && !escapeOwned || ev.code === 'KeyP' && !typing) && pauseAllowed()) {
    ev.preventDefault(); ev.stopImmediatePropagation();
    if (!ev.repeat) { pause.toggle(); syncPauseUI(); }
  } else if (ev.code === 'Tab' && !pauseScreen.hidden) {
    ev.preventDefault();
    const list = [...pauseScreen.querySelectorAll<HTMLButtonElement>('button:not([disabled]):not([hidden])')];
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    list[(at + (ev.shiftKey ? list.length - 1 : 1) + list.length) % list.length]?.focus();
  }
}, { capture: true });
pauseButton.addEventListener('click', () => { if (pauseAllowed()) { pause.toggle(); syncPauseUI(); } });
// Several controls close the Settings panel directly (END SHIFT, Enlarge map, Start over); some notices open it.
// The panel's real state decides the Settings pause, so a closed panel never leaves the game frozen unseen.
new MutationObserver(() => {
  const open = settingsPanel.classList.contains('open');
  if (open !== (pause.blocked && !pause.screen && !document.hidden)) { pause.setSettings(open); syncPauseUI(); }
}).observe(settingsPanel, { attributes: true, attributeFilter: ['class'] });
document.getElementById('resumeGame')!.addEventListener('click', () => { pause.resume(); syncPauseUI(); });
document.getElementById('pauseSettings')!.addEventListener('click', () => { pause.setSettings(true); syncPauseUI(); });
document.getElementById('pauseReplay')!.addEventListener('click', () => { openReplay(); });
for (const element of [pauseScreen, pauseButton]) for (const event of ['pointerdown', 'pointerup', 'pointermove']) element.addEventListener(event, ev => ev.stopPropagation());

// ---- settings -----------------------------------------------------------------------------
{
  const slider = document.getElementById('exag') as HTMLInputElement, label = document.getElementById('exagValue')!;
  const panel = document.getElementById('settings')!;
  slider.value = String(EXAG);
  label.textContent = EXAG.toFixed(1);
  slider.addEventListener('input', () => { label.textContent = (+slider.value).toFixed(1); });
  // The land is rebuilt from the tiles, so a new value reloads the view.
  slider.addEventListener('change', () => {
    try { localStorage.setItem('mmm.exag', slider.value); } catch { /* private window: the choice lasts for this visit only */ }
    // Some hosts drop the address bar's query, so the saved value is the main way; the query is the fallback.
    const q = new URLSearchParams(location.search);
    if (q.has('exag') || stored === null && (() => { try { return localStorage.getItem('mmm.exag') === null; } catch { return true; } })()) {
      q.set('exag', slider.value);
      location.search = q.toString();
    } else location.reload();
  });
  document.getElementById('gear')!.addEventListener('click', () => {
    pause.setSettings(!panel.classList.contains('open'));
    syncPauseUI();
    // A short phone can scroll this panel; each visit starts with END SHIFT in reach.
    if (panel.classList.contains('open')) panel.scrollTop = 0;
  });
}

// ---- loop ---------------------------------------------------------------------------------
// ?cam=east,north,height above sea,heading,pitch,field of view: a free fixed view, for pictures.
// With &camground=1 the height is above the ground, and the view settles on the ground as it loads.
if (params.has('cam')) {
  const c = params.get('cam')!.split(',').map(Number);
  const at = { name: 'cam', e: c[0], n: c[1], heading: c[3] ?? 0, pitch: c[4] ?? -20, fov: c[5] ?? 45 };
  applyShot(params.get('camground') === '1' ? { ...at, eye: c[2] ?? 2 } : { ...at, abs: (c[2] ?? 100) / EXAG });
}
if (SHOTS.length && params.has('shot')) applyShot(SHOTS[THREE.MathUtils.clamp(parseInt(params.get('shot')!, 10) || 1, 1, SHOTS.length) - 1]);
const clearEndingInput = () => {
  pause.resume();
  syncPauseUI();
  keys.clear(); pointers.clear(); mailPointers.clear(); mailRequested = photoRequested = false;
  touch.steer = touch.throttle = 0;
  document.getElementById('settings')?.classList.remove('open');
};
const endings = mailMode ? new Endings(clearEndingInput, () => { shift.startOver(); pause.resetClock(); }) : quietEndings();
// Built with hud=0 too: a fired Shift ends through it. Only its panel follows the bare HUD.
let daily: DailyRun | null = null;
// The card holds only what the area can supply today: the painter or the fish truck only when the scene is really there.
// If a layer failed to load and nine squares cannot be drawn, this is a plain Get Fired run: no short card, no record.
const dailySupply = DAILY ? supplyFor(DAILY, { boxes: !!props?.mail.length,
  lawns: properties.some(b => b.kind === 'house'), relief: relief instanceof Relief, painter: !!roadScene?.painter.enabled, fish: !!roadScene?.rules.enabled }) : null;
const drawn: Square[] | null = DAILY && dailySupply ? drawCard(DAILY.seed, dailySupply) : null;
const dailySquares = drawn?.length === CARD_SIZE ? drawn : null;
const fired = firedMode && shift instanceof Shift && endings instanceof Endings ? new FiredRun(shift, endings, touchDevice, () => pause.resetClock(),
  DAILY && dailySquares ? { limit: DAILY.limit, onEnd: end => daily?.finish(end) } : {}) : null;
if (fired && DAILY && dailySquares && shift instanceof Shift && endings instanceof Endings) daily = new DailyRun(DAILY, dailySquares, AREA.name, shift, fired, endings, () => pause.resetClock(), dailySupply);
if (fired && bare) document.getElementById('firedHud')!.style.display = 'none';
const yardJob = yard && endings instanceof Endings ? ride.yardJob?.(yard) ?? new YardJob(yard, vehicle, terrain, camera, endings) : null;
resets[resetSlot.yardJob] = () => yardJob?.reset();
const deckhand = AREA.coast && ERA.modern ? new Deckhand(manifest.village, terrain) : null;
if (deckhand) { scene.add(deckhand.group); waterReflections?.include(deckhand.group); }
const fishing = fishingSite && endings instanceof Endings ? new Fishing(fishingSite, terrain, vehicle, camera, endings, SEA_LEVEL, LOW) : null;
resets[resetSlot.fishing] = () => fishing?.reset();
if (fishing) { scene.add(fishing.group); waterReflections?.include(fishing.group); }
// Hidden from Object.keys(mmm): ui-check pins the public dev key set.
if (import.meta.env.DEV) expose({ fired, daily }, false);
if (import.meta.env.DEV) expose({ deckhand, yardDog, yardDogSite, yardJob, fishing, endings, shift, interiors, relief, animals, landmarks, mineSite, home, church, village, hawkesbury, mabouMain, porch, porchDog, porchSite });
if (endings instanceof Endings) endings.extra = () => replay.available && !multiplayer?.choice.on ? replayButton('endingReplay') : null;
{
  const report = document.getElementById('shiftReport'), footer = report?.querySelector('.reportFooter');
  if (report && footer && mailMode) {
    const watch = replayButton('reportReplay');
    footer.append(watch);
    const refresh = () => { watch.hidden = !replay.available || !!multiplayer?.choice.on; };
    new MutationObserver(refresh).observe(report, { attributes: true, attributeFilter: ['hidden'] });
    refresh();
  }
}

let fps = 60, quiet = 0, drove = 0, beaconT = 0;
let shiftReady = false;
const beaconMat = car.beacon?.material as THREE.MeshStandardMaterial | undefined;
// The title card holds the game still until the player starts. Test links (any placement or demo parameter)
// skip it; ?title=1 shows it in a test.
const plainVisit = !isTestVisit(params);
let started = bare || (!plainVisit && !params.has('room') && params.get('title') !== '1');
// Today's run shows its card, vehicle and weather on the title card.
const titleDaily = DAILY && dailySquares ? { date: DAILY.date, squares: dailySquares, vehicle: GARAGE.find(g => g.id === DAILY.vehicle)?.name ?? 'Mail car',
  mood: MOODS.find(([m]) => m === DAILY.mood)?.[1] ?? 'Clear' } : undefined;
const title = started ? null : createTitle(touchDevice, () => { started = true; pause.resetClock(); radio?.start(); }, gameMode, SITE.brand === 'just' || !AREA.mailTitle ? AREA.name : undefined, ride.choice, SITE.brand === 'just', SITE.brand !== 'just', ERA, !!terrain.paved, titleDaily);   // runs each time the card closes
startHere({ mode: gameMode, era: ERA.id, area: AREA.id, site: SITE, village: manifest.village, roads: roads.roads, buildings: buildings?.clear ?? [], bounds: vehicle.bounds, multiplayer, place: s => { const placed = placeAtStart(startPlacement, s); if (placed) { waitingToDrive = true; camReady = false; mode = 'drive'; } return placed; } });
quarryFeature?.quarryCard();
// The area's own places stand first in the list; the burial grounds come after them.
const placeList = history?.places ?? [...(AREA.id === 'westbay' ? westBayPlaces() : AREA.id === 'mabou' ? placesFor(manifest.village) : [...(homeSite ? homePlaces() : []), ...(churchSite ? churchPlaces() : []), ...areaPlaces(AREA.id)]), ...(cemeteries?.places ?? []), ...(stuntPark?testParkPlaces(stuntPark,manifest.village):[])];
const placesUI = !mailMode && !bare && (placeList.length || (ERA.modern && !!tallKey)) ? new PlacesUI(placeList, manifest.village, history?.placeRoads ?? roads, {

  canOpen: () => started,
  pause: paused => { started = !paused; clearEndingInput(); },
  jump: (x, z, heading) => { multiplayer?.reset(); if (fleet) fleet.restart(x, z, heading, 'place-jump'); else vehicle.restart(x, z, heading); vehicle.vx = vehicle.vz = vehicle.vy = vehicle.speed = 0; mail.reset(); waitingToDrive = true; camReady = false; mode = 'drive'; pendingShot = null; hookPlaced = false; jumpPlacement++; },
}, hikes) : null;
const bigMap = !mailMode && !bare && ERA.modern ? new BigMap(terrain, roads, placeList.filter(p => !p.trip), hikes, hikeBox, {
  canOpen: () => started && mode !== 'fly',   // in flight M is a drone key (DRONE_KEYS), not the map
  pause: paused => { started = !paused; clearEndingInput(); },
  jump: (x, z, heading) => { multiplayer?.reset(); if (fleet) fleet.restart(x, z, heading, 'place-jump'); else vehicle.restart(x, z, heading); vehicle.vx = vehicle.vz = vehicle.vy = vehicle.speed = 0; mail.reset(); waitingToDrive = true; camReady = false; mode = 'drive'; pendingShot = null; hookPlaced = false; jumpPlacement++; },
}) : null;
if (bigMap && placesUI) { bigMap.phoneTop = false; placesUI.mapButton(() => bigMap.open(null)); }
if (import.meta.env.DEV) {
  expose({ gameMode, get vehicleId() { return garageEntry.id; }, quarry, journey, places: placesUI, miniMap, cemeteries, stockpiles, bigMap, hikes, footpaths });
  // Internal diagnostics preserve the established enumerable dev API.
  expose({ ride, frame }, false);
}

if (title) {
  const more = Object.assign(document.createElement('button'), { textContent: 'Controls, credits and data' });
  more.style.cssText = 'margin-top:12px;width:100%;min-height:40px;border-radius:6px;border:1px solid #6b7780;background:none;color:inherit;font:inherit;cursor:pointer';
  // Reading the card stops the clock, the car and the gauge until it closes.
  more.addEventListener('click', () => { pause.resume(); syncPauseUI(); started = false; roadScene?.setPaused(true); keys.clear(); touch.steer = touch.throttle = 0; document.getElementById('settings')?.classList.remove('open'); title.open(); });
  document.getElementById('settings')?.appendChild(more);
}
// The title card's rows and the body's padMode follow the device used last (gamepad.ts).
gamepad.onDevice(device => { title?.setDevice(device === 'gamepad'); document.body.classList.toggle('padMode', device === 'gamepad'); });
if (!bare && params.get('radio') !== '0') {
  if (ERA.radio && ride.kind !== 'horse') {
  const audioBase = `${import.meta.env.BASE_URL}audio`;
  void loadRadio(audioBase, siteRadio(SITE)).then(next => {
    radio = next; if (SITE.brand === 'just') { title?.setRadio(!!radio); ride.setRadio(!!radio); }
    if (params.get('reception') === '0') radio?.useReception(null);   // every station everywhere, as on the Just Listen page
    if (import.meta.env.DEV) expose({ radio });   // for tools/radio-check.mjs
    if (started) radio?.start();
    if (fired && next) void fetchCalls(audioBase).then(list => {
      if (!list || radio !== next) return;
      const stored = (() => { try { return localStorage.getItem('mmm.mp.handle'); } catch { return null; } })();
      partyLine = new PartyLine(next, list, audioBase, callSign(stored, inventedName()));
      fired.calls = partyLine;
      if (import.meta.env.DEV) expose({ partyLine });   // for tools/party-line-browser.mjs
    });
  });
  }
}
// Engine and tyre sounds (engine-sound.ts): synthesised, and started only by the first tap or key. A horse keeps its own
// hoof sound (horse-sound.ts) under the same stored volume. ?engine=0 leaves the engine out.
const engineSound = !bare && !horse && params.get('engine') !== '0' ? new EngineSound(LOW) : null;
if (!bare) {
  ride.setHoofVolume(savedEngineVolume());
  if (engineSound || horse) engineVolumeSetting(horse ? 'Hoof sound' : 'Engine sound', savedEngineVolume(), v => { if (engineSound) engineSound.setVolume(v); else saveEngineVolume(v); ride.setHoofVolume(v); });
}
if (import.meta.env.DEV) expose({ engineSound });   // for tools/engine-sound-browser.mjs


// Modal input is stopped locally even when a room keeps simulating.
function live(): boolean { return started && !shift.ended && !endings.busy && !pause.blocked; }
function scenePaused(): boolean { return !live() || document.hidden || interiors.busy; }
function syncRoadScenePause(paused = scenePaused()): void { roadScene?.setPaused(paused); ride.pause?.(paused); }
document.addEventListener('visibilitychange', () => {
  // A tab hidden under the replay comes back to the pause screen when the replay closes, as any hidden tab does.
  if (document.hidden && replay.active) replayResume = false;
  pause.setHidden(document.hidden); syncPauseUI();
});

// Segments keep the drive frame's camera, activity and render work between the same updates.
// Endings keep two explicit positions where shared terrain state prevents an independence proof.
type WorldSegment = 'ride' | 'before-camera' | 'landscape' | 'landmarks' | 'after-activities' | 'grass' | 'mirror';
const worldUpdates: Array<{ name?: string; segment: WorldSegment; ending: boolean; endingPosition?: number; update: (dt: number, realDt: number, now: number) => void }> = [
  ...(ride.update ? [{ ...(import.meta.env.DEV ? { name: 'ride' } : {}), segment: 'ride' as const, ending: false, update: (_dt: number, realDt: number) => ride.update!(realDt, !scenePaused() && mode === 'drive') }] : []),
  { ...(import.meta.env.DEV ? { name: 'yard' } : {}), segment: 'before-camera', ending: false, update: dt => yard?.update(dt, vehicle, camera.position) },
  { ...(import.meta.env.DEV ? { name: 'yardDog' } : {}), segment: 'before-camera', ending: false, update: dt => yardDog?.update(dt, vehicle) },
  { ...(import.meta.env.DEV ? { name: 'home' } : {}), segment: 'before-camera', ending: false, update: () => home?.update(camera.position, vehicle) },
  { ...(import.meta.env.DEV ? { name: 'porch' } : {}), segment: 'before-camera', ending: false, update: (dt, _realDt, now) => { porch?.update(camera.position, vehicle); porchDog?.update(dt, vehicle, now / 1000); } },
  { ...(import.meta.env.DEV ? { name: 'church' } : {}), segment: 'before-camera', ending: false, update: (_dt, _realDt, now) => church?.update(camera.position, now) },
  { ...(import.meta.env.DEV ? { name: 'village' } : {}), segment: 'before-camera', ending: false, update: (_dt, _realDt, now) => village?.update(camera.position, now) },
  { ...(import.meta.env.DEV ? { name: 'hawkesbury' } : {}), segment: 'before-camera', ending: false, update: (_dt, _realDt, now) => hawkesbury?.update(camera.position, now) },
  { ...(import.meta.env.DEV ? { name: 'mabouMain' } : {}), segment: 'before-camera', ending: false, update: (_dt, _realDt, now) => mabouMain?.update(camera.position, now) },
  { ...(import.meta.env.DEV ? { name: 'stockpiles' } : {}), segment: 'before-camera', ending: false, update: () => stockpiles?.update(camera.position) },
  { ...(import.meta.env.DEV ? { name: 'cemeteries' } : {}), segment: 'before-camera', ending: false, update: () => cemeteries?.update(camera.position, vehicle) },
  { ...(import.meta.env.DEV ? { name: 'terrain' } : {}), segment: 'landscape', ending: true, update: () => { terrain.update(camera, scenePaused()); wharves?.update(camera.position); } },
  ...(fleet ? [{ ...(import.meta.env.DEV ? { name: 'fleet' } : {}), segment: 'landscape' as const, ending: true, update: (dt: number) => { fleet!.refresh(dt); fleet!.draw(camera.position); updateFleetHud?.(); } }] : []),
  { ...(import.meta.env.DEV ? { name: 'coast' } : {}), segment: 'landscape', ending: true, update: () => coast?.update(camera.position) },
  { ...(import.meta.env.DEV ? { name: 'airport' } : {}), segment: 'landscape', ending: true, update: () => airport?.update(camera.position) },
  { ...(import.meta.env.DEV ? { name: 'quarry' } : {}), segment: 'landscape', ending: true, update: () => quarry?.update(camera.position, vehicle) },
  ...(stuntPark ? [{ ...(import.meta.env.DEV ? { name: 'stuntPark' } : {}), segment: 'landscape' as const, ending: true, update: (dt:number) => stuntPark.update(dt,vehicle,camera.position) }] : []),
  { ...(import.meta.env.DEV ? { name: 'trees' } : {}), segment: 'landscape', ending: true, endingPosition: 1, update: () => trees?.update(terrain.drawnFine, camera.position) },
  { ...(import.meta.env.DEV ? { name: 'landmarks' } : {}), segment: 'landmarks', ending: true, update: () => landmarks?.update(camera) },
  { ...(import.meta.env.DEV ? { name: 'history' } : {}), segment: 'after-activities', ending: false, update: dt => history?.update(camera.position, dt) },
  { ...(import.meta.env.DEV ? { name: 'roads' } : {}), segment: 'after-activities', ending: true, update: () => { roads.update(camera.position); canal?.update(0, vehicle, !multiplayer?.choice.on); } },
  { ...(import.meta.env.DEV ? { name: 'sidewalks' } : {}), segment: 'after-activities', ending: true, update: () => sidewalks?.update() },
  ...(trafficSignals ? [{ ...(import.meta.env.DEV ? { name: 'trafficSignals' } : {}), segment: 'after-activities' as const, ending: false, update: (dt: number, realDt: number) => trafficSignals!.update(dt, camera.position, realDt) }] : []),
  { ...(import.meta.env.DEV ? { name: 'edge' } : {}), segment: 'after-activities', ending: false, update: () => edge?.update(camera.position) },
  { ...(import.meta.env.DEV ? { name: 'mineSite' } : {}), segment: 'after-activities', ending: false, update: () => mineSite?.update(camera.position) },
  { ...(import.meta.env.DEV ? { name: 'deckhand' } : {}), segment: 'after-activities', ending: false, update: dt => deckhand?.update(dt, vehicle, camera.position) },
  { ...(import.meta.env.DEV ? { name: 'fishing' } : {}), segment: 'after-activities', ending: true, update: dt => fishing?.update(dt, camera.position) },
  { ...(import.meta.env.DEV ? { name: 'roadScene' } : {}), segment: 'after-activities', ending: false, update: () => roadScene?.update(camera) },
  { ...(import.meta.env.DEV ? { name: 'schoolBus' } : {}), segment: 'after-activities', ending: false, update: () => schoolBus?.update(camera) },
  { ...(import.meta.env.DEV ? { name: 'ambientTraffic' } : {}), segment: 'after-activities', ending: false, update: () => ambientTraffic?.update(camera, vehicle, !multiplayer?.choice.on) },
  { ...(import.meta.env.DEV ? { name: 'roadAnimals' } : {}), segment: 'after-activities', ending: false, update: dt => roadAnimals?.update(dt, vehicle, !multiplayer?.choice.on) },
  { ...(import.meta.env.DEV ? { name: 'props' } : {}), segment: 'after-activities', ending: true, endingPosition: 7, update: dt => props?.update(camera, dt) },
  { ...(import.meta.env.DEV ? { name: 'harbourLights' } : {}), segment: 'after-activities', ending: false, update: (_dt, _realDt, now) => harbourLights?.update(now / 1000) },
  { ...(import.meta.env.DEV ? { name: 'tall' } : {}), segment: 'after-activities', ending: false, update: (_dt, _realDt, now) => { tall?.update(camera, now / 1000); farTurbines?.update(now / 1000, renderer.domElement.width, renderer.domElement.height); if (tall) (shared.tallViewport.value as THREE.Vector2).set(renderer.domElement.width, renderer.domElement.height); } },
  { ...(import.meta.env.DEV ? { name: 'grass' } : {}), segment: 'grass', ending: false, update: (_dt, realDt) => grass?.update(realDt, camera, vehicle.x, vehicle.z, vehicle.heading, vehicleSpec) },
  { ...(import.meta.env.DEV ? { name: 'mirror' } : {}), segment: 'mirror', ending: true, update: () => waterReflections?.update(camera) },
];
// Build the plain segment arrays once. Frame calls visit only their segment's entries.
const worldSegments: Record<WorldSegment | 'ending' | 'ending-mirror', typeof worldUpdates> = {
  ride: [], 'before-camera': [], landscape: [], landmarks: [], 'after-activities': [], grass: [], mirror: [],
  ending: [], 'ending-mirror': [],
};
const endingWorldUpdates: typeof worldUpdates = [];
for (let i = 0; i < worldUpdates.length; i++) {
  const entry = worldUpdates[i];
  worldSegments[entry.segment].push(entry);
  if (entry.ending) endingWorldUpdates.push(entry);
}
// Positions are zero-based among ending entries: trees follows terrain; props precedes fishing.
for (let i = 0; i < worldUpdates.length; i++) {
  const entry = worldUpdates[i];
  if (entry.ending && entry.endingPosition !== undefined) {
    endingWorldUpdates.splice(endingWorldUpdates.indexOf(entry), 1);
    endingWorldUpdates.splice(entry.endingPosition, 0, entry);
  }
}
for (let i = 0; i < endingWorldUpdates.length; i++) {
  const entry = endingWorldUpdates[i];
  worldSegments[entry.segment === 'mirror' ? 'ending-mirror' : 'ending'].push(entry);
}
const worldCost: Record<string, number> = {};
if (import.meta.env.DEV) expose({ cost: worldCost });
function updateWorld(segment: WorldSegment | 'ending' | 'ending-mirror', dt: number, realDt = dt, now = 0): void {
  const list = worldSegments[segment];
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    // Guard at the call site: the production bundle contains neither clocks nor cost writes.
    if (import.meta.env.DEV) {
      const start = performance.now();
      entry.update(dt, realDt, now);
      worldCost[entry.name!] = performance.now() - start;
    } else entry.update(dt, realDt, now);
  }
}

// The finish pass (finish.ts; finish-choice.ts says when). Without it the world is drawn straight to the screen, as before.
// More cost-check choices (tools/finish-cost.mjs): finishType=byte colour store, finishSmooth=0|1 edge smoothing.
const finishTest = { samples: FINISH.samples,
  type: params.get('finishType') === 'byte' ? THREE.UnsignedByteType : undefined, smooth: params.has('finishSmooth') ? params.get('finishSmooth') === '1' : undefined };
const finish = FINISH.mode ? new Finish(renderer, FINISH.mode, LOW, !!nightLook, FINISH.clouds ? shared as unknown as CloudLight : null, finishTest) : null;
// The interiors do not go through the pass. On a canvas without edge samples they bring their own.
const interiorDraw = !LOW && !FINISH.canvasSamples ? new EdgeSamples(renderer).draw : undefined;
// The cost check times one world draw from here (dev server only).
const drawProbe: { before?: () => void; after?: () => void } | null = import.meta.env.DEV && finish ? {} : null;
// The water check reads the depth of the world just drawn: the pass keeps that in its own picture.
function afterWorld(): void {
  if (!waterReflections) return;
  if (finish?.on) finish.onWorld(() => waterReflections.afterRender(camera)); else waterReflections.afterRender(camera);
}
function drawWorld(): void {
  drawProbe?.before?.();
  if (finish?.on) finish.render(scene, camera); else renderer.render(scene, camera);
  drawProbe?.after?.();
}
if (drawProbe) Object.assign((window as unknown as { mmm?: Record<string, unknown> }).mmm ??= {}, { finish, drawProbe });

const shadowFocus = new THREE.Vector3(), shadowDir = new THREE.Vector3();
function drawEnding(dt: number): void {
  if (ride.update) updateWorld('ride', 0);
  engineSound?.update(dt, null);
  roadScene?.setPaused(true);
  endings.update(dt);
  // A call about the run that waits or plays keeps the radio up under the end card (the Fired call comes here).
  pad?.show(false); radio?.update(false, !partyLine?.wantsAir); partyLine?.update();
  camera.updateMatrixWorld(); sky.position.copy(camera.position);
  updateWorld('ending', 0);
  // LOW water is a backdrop. Enable site clipping only while the wharf/boat is visible.
  renderer.localClippingEnabled = LOW && !!fishing?.group.visible;
  farVisibility?.update(camera,performance.now()/1000);
  updateWorld('ending-mirror', 0);
  try { drawWorld(); } finally { farVisibility?.settle(); waterReflections?.settle(); }
  afterWorld();
}

// Reuse this record: the HUD path allocates no per-frame state object.
const hudState: HudState = {
  mode, mailMode, touchDevice, fps, speed: 0, activeTouchSpeedLimit: 0, roadName: '', surfaceName: '', airborne: false, help: '', jumpLine: '',
  e: 0, n: 0, height: 0, exag: EXAG, sunAz: 0, sunEl: 0, drawn: 0, pending: 0, flySpeed, views: SHOTS.length,
  done: 0, stops: 0, delivered: 0, lawn: 0, ditch: 0, trailerReason: '', atEdge: false, route: !!AREA.route,
  showRuts: params.has('lawn'), ruts: 0, lawns: 0, drone: '',
};
function frame(now: number) {
  if (page.stopped) return;
  try {
  gamepad.poll(now);
  const pauseFrame = pause.frame(now, !!multiplayer?.choice.on);
  if (pauseFrame.paused) {
    syncRoadScenePause(true);
    engineSound?.update(1 / 60, null);   // the pause screen is quiet (paused frames carry no clock: count one display frame)
    if (replay.active) {
      // The world holds still; the recorded ride and the replay camera move. Drawn like an ending: frozen world, moving camera.
      replay.frame(now);
      sky.position.copy(camera.position);
      sunShadows?.update(0, shadowFocus.copy(car.root.position), 0, true);
      updateWorld('ending', 0);
      renderer.localClippingEnabled = LOW && !!fishing?.group.visible;
      updateWorld('ending-mirror', 0);
      // The replay camera moves: re-check far visibility as the drive and ending frames do.
      farVisibility?.update(camera,now/1000);
      try { drawWorld(); } finally { farVisibility?.settle(); waterReflections?.settle(); }
      afterWorld();
      replay.afterRender();
      requestAnimationFrame(frame); return;
    }
    // The simulation holds still, but turning the room Off in Settings removes every other driver at once: the map
    // drops their dots now, once, not after the pause. A paused frame never has a room, so this does not repeat.
    if (miniMap && mapCars.length) {
      refreshMap(); miniMap.redrawNext();
      miniMap.update(0, vehicle.x, vehicle.z, vehicle.heading, mapStops, mapMarks, mapCars);
    }
    if (interiors.busy) interiors.render(renderer, interiorDraw);
    else drawWorld();
    requestAnimationFrame(frame); return;
  }
  // Simulation time excludes paused wall time, including shader/animal animation.
  now = pause.time;
  const frameLive = started && !shift.ended && !endings.busy;
  // The shift clock ignores hidden tabs, interiors and fly mode; endings return before it runs.
  const clockRuns = started && !shift.ended;
  const worldRuns = frameLive && !document.hidden;
  const driving = mode === 'drive';
  const roadPaused = !frameLive || document.hidden || interiors.busy;
  // Playing ignores visibility and interiors, unlike the road scene and the frame's dt.
  const playing = driving && clockRuns;
  // Picture measurement omits the ending gate; ending frames return before measurement.
  const picturePaused = !clockRuns || document.hidden || interiors.busy;
  // Damage also requires the mail game, outdoors, with no demo or daily-start parking.
  const damageActive = mailMode && playing && !interiors.busy && !demo && !waitingToDrive;
  // Until the first pedal after a start or a jump, phones read only the land in view and near the camera.
  terrain.holdBackground = waitingToDrive;
  // Places remain available after a shift; journey progress alone also excludes the places panel.
  const placesEnabled = driving && started;
  const journeyRuns = placesEnabled && !placesUI?.busy && !bigMap?.busy;
  // Mail controls omit started; the title owns input, and the places panel hides the pad separately.
  // A room keeps its frame while Settings or the pause screen is up: no mail is thrown, but the pad (and the
  // race readout inside it) stays painted; driveInput already holds the brake.
  const mailControls = driving && !shift.ended && !pause.blocked;
  const padVisible = driving && !shift.ended && !placesUI?.busy && !bigMap?.busy;
  const clockDt = pauseFrame.dt;
  const realDt = Math.min(clockDt, 0.1);
  const dt = worldRuns ? realDt : 0;
  if (!started) camReady = false;   // behind the title card the camera snaps to the car as the ground arrives
  if (shift.ended) vehicle.vx = vehicle.vz = vehicle.speed = 0;
  if (clockDt > 0) fps += (1 / Math.max(realDt, 1e-3) - fps) * 0.05;   // the zero-length first frame after a pause is not a frame rate
  const qualityReady = quiet > 20 && terrain.pending === 0 && (grass?.pending ?? 0) === 0 && (trees?.pending ?? 0) === 0;
  if (!interiors.busy || endings.busy) quality.frame(clockDt, qualityReady);
  if (endings.busy) {
    drawEnding(realDt); requestAnimationFrame(frame); return;
  }
  syncRoadScenePause(roadPaused);
  if (mode === 'fly') { yardJob?.judge.cancel(); fishing?.judge.cancel(); }
  const loaded = terrain.pending === 0;
  // Picture measurement and the shadow guard skip the same frames: paused, or tiles still pending.
  const pictureBusy = picturePaused || !loaded;
  // The one measurement of the picture at a first visit (picture.ts): only frames of real play count.
  if (picture?.measuring) picture.frame(clockDt, pictureBusy);
  if (lawnDemo?.prepare(terrain, vehicle)) { camReady = false; drove = 0; }
  roadsidePlaying = damageActive;
  vehicle.damageActive = !horse && damageActive;
  if (ride.update) updateWorld('ride', realDt);
  car.setWindowDown?.(shift.damage.windowStuck);
  radio?.setWind(shift.damage.windowStuck, mode === 'drive' ? vehicle.speed : 0);
  radio?.setPlace(vehicle.x + manifest.village[0], manifest.village[1] - vehicle.z);   // reception by place (radio-reception.ts)
  // The engine runs while the carrier drives: not behind the title card, in the fly view, indoors or in a hidden tab.
  if (engineSound) {
    const m = engineMoment;   // one reused record: the frame allocates nothing for the sound
    m.kind = ride.kind; m.speed = vehicle.speed; m.throttle = engineThrottle; m.surface = vehicle.surfaceName; m.airborne = vehicle.airborne;
    // A fleet keeps the trailer on the truck while another member drives: only the truck pulls it.
    m.grade = vehicle.pitch; m.towing = !!towing?.attached && ride.kind === 'truck'; m.radio = !!radio?.audible;
    m.slide = vehicle.drift.slide(vehicle.spec.drift);
    engineSound.update(realDt, playing && mode === 'drive' && !interiors.busy && !document.hidden ? m : null);
  }
  if (interiors.busy) {
    radio?.update(false, true);
    pad?.show(!shift.ended && gamepad.device !== 'gamepad');
    if (shift.updateIndoors(clockRuns ? clockDt : 0)) { quality.frame(0, false); interiors.closeForDay(); shift.end(); }
    else {
      interiors.update(dt, driveInput(), vehicle, false);
      interiors.render(renderer, interiorDraw);
      quality.frame(clockDt, qualityReady);
    }
    // Finish outdoor tile builds on the paused budget while the interior freezes the world.
    terrain.update(camera, true);
    sidewalks?.update();
    quiet = loaded && terrain.pending === 0 ? quiet + 1 : 0; page.ready(quiet > 20 && terrain.failed === 0 && terrain.pending === 0 && (sidewalks?.pending ?? 0) === 0);
    mailRequested = photoRequested = false;
    if (!interiors.busy) { keys.clear(); touch.steer = touch.throttle = 0; camReady = false; }
    requestAnimationFrame(frame); return;
  }
  interiors.update(realDt, driveInput(), vehicle, playing);
  pad?.show(padVisible && gamepad.device !== 'gamepad');   // a controller in use hides the phone pad; a touch brings it back
  if (mode === 'drive') {
    const input = pause.blocked ? driveInput() : devHooks.inputEnabled ? devHooks.demoInput(drove, vehicle, roads, props, lawnDemo, mailMode, driveInput) : driveInput();
    const refusal = Math.abs(vehicle.speed) < 0.15 && input.throttle < 0 ? 0 : (animals?.influence(vehicle).brake ?? 0);
    if (refusal > 0) {
      input.throttle = Math.abs(vehicle.speed) > 0.15 ? -Math.sign(vehicle.speed) * refusal : 0;
      input.handbrake = true; input.held = true;   // a stop for an animal, not a drift
    }
    if (input.throttle !== 0 && (!demo || loaded)) waitingToDrive = false;
    // Keep the daily start parked while coarse terrain is replaced and until the driver uses a pedal.
    if (fleet) { const active = !fleet.busy; driveVehicle(dt, input); if (active && loaded && !animals?.waitingForTerrain) drove += dt; }
    else if (terrain.surfaceAt(vehicle.x, vehicle.z)?.level === undefined) vehicle.place(vehicle.x, vehicle.z, vehicle.heading);
    else {
      if ((refusal > 0 || demo && drove >= demo) && Math.abs(vehicle.speed) < 0.15) { vehicle.place(vehicle.x, vehicle.z, vehicle.heading); vehicle.speed = 0; }
      else if (waitingToDrive) {
        const { x, z, heading } = vehicle;
        driveVehicle(dt, { ...input, throttle: 0, handbrake: true });
        vehicle.place(x, z, heading);
      } else driveVehicle(dt, relief.busy ? { throttle: 0, steer: 0, handbrake: true } : input);
      if ((loaded || lawnDemo?.driving) && !animals?.waitingForTerrain) drove += dt;
    }
    animals?.update(dt, vehicle, camera);
    chase(dt);
  } else {
    fly(dt);
    animals?.update(dt, vehicle, camera);
    camera.rotation.set(pitch, yaw, 0);
  }
  if (endings.busy) { drawEnding(0); requestAnimationFrame(frame); return; }
  const impactSpeed = Math.hypot(vehicle.vx, vehicle.vz);
  const impact = shift.ended ? 1 : mail.update(dt, vehicle,
    mailControls && (mailRequested || keys.has('KeyM') || keys.has('KeyE') ||
      keys.has('Space') && document.activeElement === mailButton ||
      mailPointers.size > 0 || !!(demo && drove < demo && loaded && devHooks.throwMail)), camera);
  mailRequested = false;
  if (impact < 1 && vehicle.damageActive) shift.damage.hit('impact', impactSpeed);
  if (impact < 1) vehicle.drift.hit(vehicle.x, vehicle.z);   // a mailbox knock ends a drift, not clean
  vehicle.vx *= impact; vehicle.vz *= impact; vehicle.speed *= impact;
  // The replay recorder reads the ride and its drawn rig once the frame's motion (and any mailbox knock) is final.
  // The clock's own step (not the 0.1 s physics cap): a long frame on a busy phone still follows the one before it.
  if (dt > 0 && driving) replay.record(vehicle, car, horse ? 'horse' : ride.kind, now / 1000, clockDt, quietGround);
  gamepad.feel(vehicle, dt, playing && mode === 'drive' && !interiors.busy, now);
  driftFeedback.update(dt, vehicle, camera, playing && mode === 'drive' && !interiors.busy);
  updateWorld('before-camera', dt, realDt, now);
  camera.updateMatrixWorld();
  sky.position.copy(camera.position);
  shared.time.value = now / 1000;
  beaconT += dt;
  if (beaconMat) beaconMat.emissiveIntensity = !mailMode ? 0 : Math.abs(vehicle.speed) < 8 ? (Math.sin(beaconT * 9) > 0.3 ? 2.2 : 0.15) : 0.15;   // flashes while it creeps between boxes
  updateWorld('landscape', dt, realDt, now);
  culvertMouths?.update(camera.position);
  updateWorld('landmarks', dt, realDt, now);
  {
    placesUI?.update(vehicle, placesEnabled);
    journey?.update(realDt, journeyRuns);
    if (devHooks.breakEnabled) devHooks.beforeRelief(drove, relief);
    bigMap?.update(vehicle, placesEnabled);
    footpaths?.update(realDt, camera.position);
    relief.update(dt, playing ? clockDt * CLOCK_FACTOR : 0, vehicle, playing && (!demo || reliefTest > 0));
    if (miniMap) {
      miniMap.show(playing);
      mapTimer -= realDt;
      if (mapTimer <= 0) { mapTimer = 0.25; refreshMap(); }
      miniMap.update(realDt, vehicle.x, vehicle.z, vehicle.heading, mapStops, mapMarks, mapCars);
    }
    // Paused frames return early, but a multiplayer room keeps running them: ground property lines still stop while Settings is open.
    propertyLayer?.update?.(vehicle.x, vehicle.z, playing && !pause.blocked && !interiors.busy);
    radio?.update(playing, false);
    partyLine?.update();
  }
  updateWorld('after-activities', dt, realDt, now);
  if (loaded) shiftReady = true;
  if (shiftReady) shift.update(clockRuns ? clockDt : 0, vehicle);
  if (sunShadows) {
    // The shadow box follows the car; with the free camera it sits a little ahead of the lens.
    let reach = 0;
    if (mode === 'drive') shadowFocus.set(vehicle.x, vehicle.y, vehicle.z);
    else {
      // Walk down the line of sight to the ground, in coarse steps: that is what the picture is of.
      shadowDir.set(0, 0, -1).applyQuaternion(camera.quaternion);
      for (reach = 20; reach < 1400; reach *= 1.35) {
        shadowFocus.copy(camera.position).addScaledVector(shadowDir, reach);
        const g = terrain.heightAt(shadowFocus.x, shadowFocus.z);
        if (g !== null && shadowFocus.y <= g) { shadowFocus.y = g; break; }
      }
      if (reach >= 1400) {
        // A high, shallow look meets no ground within reach. Then the box sits on the ground ahead of the camera,
        // as far ahead as the camera is high, and is sized for that height.
        const under = terrain.heightAt(camera.position.x, camera.position.z) ?? SEA_LEVEL;
        const height = Math.max(20, camera.position.y - under), flat = Math.hypot(shadowDir.x, shadowDir.z);
        // A look that is nearly straight down has no "ahead": the box then stays under the camera.
        const ahead = flat > 0.2 ? height / flat : 0;
        shadowFocus.set(camera.position.x + shadowDir.x * ahead, 0, camera.position.z + shadowDir.z * ahead);
        shadowFocus.y = terrain.heightAt(shadowFocus.x, shadowFocus.z) ?? under;
        reach = Math.min(1400, height * 1.5);
      }
    }
    sunShadows.update(realDt, shadowFocus, reach, pictureBusy);
  }
  updateWorld('grass', dt, realDt, now);
  // LOW water is a backdrop. Enable site clipping only while the wharf/boat is visible.
  renderer.localClippingEnabled = LOW && !!fishing?.group.visible;
  aiDriver?.update(camera, vehicle, aiDriverOn(), fleet?.driven.id ?? garageEntry.id);
  multiplayer?.update(realDt, camera, dt > 0 && driving);
  farVisibility?.update(camera,now/1000);
  updateWorld('mirror', dt, realDt, now);
  try { drawWorld(); } finally { farVisibility?.settle(); waterReflections?.settle(); }
  afterWorld();
  if(started&&!farLoading&&(farKey||tallKey)){farLoading=true;setTimeout(()=>{void loadFarViews();},0);}
  // A photo is evidence of what the driver saw: the free camera takes none.
  if (photoRequested) { if (mode === 'drive') shift.takePhoto(vehicle, camera); photoRequested = false; }
  if (devHooks.afterEnabled) devHooks.afterFrame(drove, loaded, mode, vehicle, camera, shift, relief);

  // A page is "settled" when nothing has been loading for a while; screenshots wait for this.
  const waiting = !loaded || (grass?.pending ?? 0) > 0 || (trees?.pending ?? 0) > 0 || (mode === 'fly' && pendingShot !== null && terrain.heightAt(camera.position.x, camera.position.z) === null)
    || (mode === 'drive' && demo > 0 && (drove < demo || Math.abs(vehicle.speed) > 0.15)) || relief.busy
    || !!porch?.waiting || porchDog?.state === 'loading' || !!mabouMain?.waiting;
  quiet = waiting ? 0 : quiet + 1;
  page.ready(quiet > 20 && terrain.failed === 0 && terrain.pending === 0 && (sidewalks?.pending ?? 0) === 0);
  // The clock or report can end the shift above: these final HUD reads must use the new state.
  hudState.padHelp = !touchDevice && mode === 'drive' && gamepad.device === 'gamepad' ? ride.padHelp : '';
  if (mailButton) mailButton.hidden = mode !== 'drive' || shift.ended;
  phoneMailHud?.update(shift, vehicle, mode === 'drive' && !scenePaused());
  if (mailScore && !bare && mailScore.textContent !== mail.tally) mailScore.textContent = mail.tally;
  if (!bare) {
    // Behind the title card the readout said "0 km/h off the map" while the land was still loading: keep it out of sight.
    hud.style.visibility = started ? '' : 'hidden';
    hudState.mode = mode; hudState.fps = fps;
    if (mode === 'drive') {
      hudState.speed = vehicle.speed; hudState.activeTouchSpeedLimit = scenePaused() ? 0 : vehicle.activeTouchSpeedLimit; hudState.surfaceName = vehicle.surfaceName; hudState.airborne = vehicle.airborne;
      hudState.roadName = vehicle.roadName ?? (yardSite?.surface(vehicle.x, vehicle.z) ? 'works yard' : homeSite?.surface(vehicle.x, vehicle.z) ? 'house yard' : 'off the map');
      if (ERA.id === '1884') hudState.roadName = historyRoadName(hudState.roadName, AREA.id);
      if (touchDevice) hudState.jumpLine = ride.jumpLine;
      else if (!mailMode) hudState.help = ride.help;
    } else {
      hudState.e = camera.position.x + VE; hudState.n = VN - camera.position.z; hudState.height = camera.position.y;
      hudState.sunAz = sun.az; hudState.sunEl = sun.el; hudState.drawn = terrain.drawn; hudState.pending = terrain.pending; hudState.flySpeed = flySpeed;
      hudState.drone = drone.active ? drone.readout(touchDevice) : '';
    }
    hudState.done = shift.done; hudState.stops = shift.stops; hudState.delivered = mail.delivered; hudState.lawn = mail.lawn; hudState.ditch = mail.ditch;
    hudState.stuntLine=stuntPark?.hudLine;
    hudState.trailerReason = towing?.reason; hudState.atEdge = vehicle.atEdge;
    if (mailMode && hudState.showRuts) { hudState.ruts = shift.ruts.count; hudState.lawns = shift.ruts.lawns; }
    if (fleet && mode === 'drive') {
      const line = fleet.message || fleet.driven.entry.name;
      hudState.fleetLine = fleet.driven.id === 'truck' && fleet.handbrake && !line.includes('Handbrake on') ? `Handbrake on · ${line}` : line;
    } else hudState.fleetLine = '';
    ride.hud?.(hudState);
    setHud(hud, hudLine(hudState));
  }

  requestAnimationFrame(frame);
  } catch (error) { page.fail(error); }
}
resize();
document.getElementById('boot')?.remove();
// Finalize all initial material hooks before their first compile. Activation only flips a uniform.
if(farKey)curveSceneMaterials(scene,shared);
requestAnimationFrame(frame);
