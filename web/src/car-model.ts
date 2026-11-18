/**
 * The Blender-built mail car (tools/blender/mail-car.py), as the same rig the code car gives the game.
 *
 * This file is the car's own part: which nodes the game drives, the mail trim, the plate and sign variants.
 * Reading the model file is shared plumbing (glb-model.ts, `loadGlbScene`); only `loadBlenderCar` touches it.
 * Nothing here imports the code car, so a caller can fall back to it when the file does not load.
 */
import * as THREE from 'three';
import { loadGlbScene } from './glb-model';
import type { Car } from './car';

/** The see-through materials, by name: their opacity here. They never write depth. */
const CLEAR: Record<string, number> = { 'Front glass': .30, 'Rear tint': .80, 'Lamp lens': .20 };
/** The car's atlas (tools/blender/car_art.py) holds two signs and two plates side by side; a slide picks one. */
const SIGN_WITHOUT_WORDS = .5, OFF_DUTY_PLATE = .25;
/** As on the code car: the mud film shows at this strength until setDirt() says otherwise. */
const MUD = .78;
/** Anisotropic filtering for the car's pictures (the loader's own value is 1). */
const SHARPNESS = 4;
/** How bright the head lamps burn. They are always on, like a Canadian car's daytime lamps: the game has no switch. */
const HEAD_LAMPS = 1.5;

export interface BlenderCar {
  /** A new car. `mailTrim` false leaves off the roof sign, the lamp and the mail plate; `cleanText` leaves the words off the sign. */
  create(mailTrim?: boolean, cleanText?: boolean): Car;
}

const files = new Map<string, Promise<BlenderCar>>();
const fileName = (low: boolean): string => `${low ? 'mail-car-low' : 'mail-car'}.glb`;
/** The materials that carry a picture. A file whose picture did not decode is not used. */
const PICTURED = ['Sign atlas', 'Head lamp', 'Mud overlay'];

/** Forgets a load that the caller gave up on, so a file that arrives too late is not kept (the next call asks again). */
export function forgetBlenderCar(low = false): void { files.delete(fileName(low)); }

/** Loads the car's file once (the LOW file for phones). Rejects when it cannot be fetched or read in `limitMs`. */
export function loadBlenderCar(low = false, limitMs = 8000): Promise<BlenderCar> {
  const file = fileName(low);
  let ready = files.get(file);
  if (!ready) {
    ready = loadGlbScene(file, limitMs).then(model => {
      // The sign and the plates are read at a slant from the road: keep their words sharp there.
      const pictured = new Set<string>();
      model.traverse(part => {
        if (!(part instanceof THREE.Mesh)) return;
        const material = part.material as THREE.MeshStandardMaterial, picture = material.map;
        if (!picture?.image) return;
        pictured.add(material.name);
        if (picture.anisotropy !== SHARPNESS) { picture.anisotropy = SHARPNESS; picture.needsUpdate = true; }
      });
      // GLTFLoader goes on without a picture that does not decode. A car without its sign or mud is not the car.
      for (const name of PICTURED) if (!pictured.has(name)) throw new Error(`Blender car: the picture of ${name} did not load`);
      return { create: (mailTrim = true, cleanText = false) => build(model, mailTrim, cleanText) };
    });
    // A later visit may try again. This forgets by name: after forgetBlenderCar it may drop a newer load of the
    // same file. That costs one more download, never a wrong car.
    ready.catch(() => files.delete(file));
    files.set(file, ready);
  }
  return ready;
}

function slide(material: THREE.MeshStandardMaterial, x: number): void {
  if (!material.map) return;
  const picture = material.map.clone();
  picture.offset.x = x; picture.needsUpdate = true;
  material.map = picture;
  if (material.emissiveMap) material.emissiveMap = picture;
}

function build(model: THREE.Group, mailTrim: boolean, cleanText: boolean): Car {
  // One car is a copy of the file's tree. The geometry is shared; the materials are this car's own, because the
  // game changes them for each car (lamps, mud, the sign's words).
  const copy = model.clone(true);
  const own = new Map<THREE.Material, THREE.MeshStandardMaterial>(), materials = new Map<string, THREE.MeshStandardMaterial>();
  copy.traverse(part => {
    if (!(part instanceof THREE.Mesh)) return;
    const shared = part.material as THREE.MeshStandardMaterial;
    let mine = own.get(shared);
    if (!mine) { mine = shared.clone(); own.set(shared, mine); if (!materials.has(mine.name)) materials.set(mine.name, mine); }
    part.material = mine; part.castShadow = true;
  });
  const root = copy.getObjectByName('car_root') as THREE.Group | undefined;
  if (!root) throw new Error('Blender car: no node called car_root');
  root.removeFromParent();   // the file's scene object is not part of the car
  const node = (name: string): THREE.Object3D => {
    const found = root.getObjectByName(name);
    if (!found) throw new Error(`Blender car: no node called ${name}`);
    return found;
  };
  const mesh = (name: string): THREE.Mesh => {
    const found = node(name);
    if (!(found instanceof THREE.Mesh)) throw new Error(`Blender car: ${name} is not a mesh`);
    return found;
  };
  const material = (name: string): THREE.MeshStandardMaterial => {
    const found = materials.get(name);
    if (!found) throw new Error(`Blender car: no material called ${name}`);
    return found;
  };
  const body = node('body') as THREE.Group;
  const beacon = mesh('beacon'), signLight = mesh('sign_light'), driverWindow = mesh('driver_window');
  const brakeLights = ['brake_left_brake', 'brake_left_upper', 'brake_right_brake', 'brake_right_upper'].map(mesh);
  for (const [name, opacity] of Object.entries(CLEAR)) {
    const glass = materials.get(name);   // the LOW car has no clear lamp lens
    if (glass) { glass.transparent = true; glass.depthWrite = false; glass.opacity = opacity; }
  }
  // The game drives these two by emissiveIntensity, from the same starting values as the code car.
  const red = material('Brake red'); red.emissive.setHex(0xee1020); red.emissiveIntensity = .30;
  const amber = material('Amber beacon'); amber.emissive.setHex(0xff8b00); amber.emissiveIntensity = .8;
  material('Head lamp').emissiveIntensity = HEAD_LAMPS;
  const mud = material('Mud overlay');
  mud.transparent = true; mud.depthWrite = false; mud.polygonOffset = true; mud.polygonOffsetFactor = -2; mud.opacity = MUD;
  // The sign box has its own copy of the atlas material, so its slide does not move the plates (and the reverse).
  const plates = material('Sign atlas'), sign = plates.clone();
  signLight.material = sign;
  if (cleanText) slide(sign, SIGN_WITHOUT_WORDS);
  if (!mailTrim) { slide(plates, OFF_DUTY_PLATE); node('roof_kit').visible = beacon.visible = signLight.visible = false; }
  const windowY = driverWindow.position.y;
  return {
    root, body,
    wheels: { fl: node('wheel_fl'), fr: node('wheel_fr'), rl: node('wheel_rl'), rr: node('wheel_rr') },
    steer: { fl: node('steer_fl'), fr: node('steer_fr') },
    beacon, signLight, brakeLights, driverEye: node('driver_eye'), driverWindow,
    setWindowDown(down: boolean): void { driverWindow.position.y = windowY + (down ? -.52 : 0); driverWindow.visible = !down; },
    setDirt(amount: number): void { mud.opacity = Number.isFinite(amount) ? THREE.MathUtils.clamp(amount, 0, 1) : 0; mud.visible = mud.opacity > 0; },
  };
}
