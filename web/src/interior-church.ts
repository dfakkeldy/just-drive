import * as THREE from 'three';
import type { Door, InteriorGame, InteriorResult } from './interiors';
import { CHURCH_DOOR_RADIUS, CHURCH_ROOM, churchDoorPosition, churchRail, railPoint, type ChurchRoom } from './church-room';
import { ChurchRoomArt, type ChurchRoomParts } from './church-room-art';
import { ChurchVisit } from './church-room-rules';
import type { ChurchSite } from './church-site';
import type { Input } from './vehicle';

/** A quiet walk through the church on a rail. Shadow-free; the gallery's furniture is drawn only from up there. */
export class ChurchInterior implements InteriorGame {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(68, 1, .05, 40);
  readonly visit: ChurchVisit;
  readonly parts: ChurchRoomParts;
  private readonly art = new ChurchRoomArt();
  private readonly eye = new THREE.Vector3();
  private readonly aim = new THREE.Vector3();
  private readonly want = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly size = new THREE.Vector2();
  private touch = false;
  private settled = false;
  constructor(mail: boolean, private readonly room: ChurchRoom = CHURCH_ROOM) {
    this.visit = new ChurchVisit(churchRail(room), mail);
    this.scene.background = new THREE.Color(0x20282b);
    // The ground colour is nearly as bright as the sky colour: the ceiling and the gallery soffits face down, and they are pale.
    this.scene.add(new THREE.HemisphereLight(0xf2f7f8, 0xd9dcd6, 2.2));
    // Daylight from the side windows gives the boards and pews their form. Nothing casts a shadow.
    const day = new THREE.DirectionalLight(0xfff4e2, .75); day.position.set(-.4, 1, .8); day.castShadow = false;
    this.scene.add(day);
    this.parts = this.art.build(room);
    this.scene.add(this.parts.groups.nave, this.parts.groups.vestry, this.parts.groups.loft);
    this.view(0);
  }
  get result(): InteriorResult | null { return this.visit.result; }
  get readout(): string {
    const keys = this.touch ? 'WALK: go on · BACK: step back · pad: look' : 'W/↑: walk · S/↓: step back · A/D or ←/→: look';
    const words = this.visit.message;
    return words ? `${words}\n${keys}` : keys;
  }
  update(dt: number, input: Input): void {
    this.touch = !!input.touch;
    this.visit.update(dt, { walk: input.throttle, look: input.steer });
    this.view(dt);
  }
  private view(dt: number): void {
    const visit = this.visit, p = visit.position, eye = this.room.fit.eye;
    this.eye.set(p.x, p.y + eye, p.z);
    // At a stop the visitor faces what the words describe; between stops, the way ahead.
    if (visit.halted || visit.distance < .05) { const look = visit.stop.look; this.want.set(look.x, look.y, look.z); }
    else {
      const ahead = railPoint(visit.rail, visit.distance + 1.4);
      this.want.set(ahead.x - p.x, ahead.y - p.y, ahead.z - p.z);
      if (this.want.lengthSq() < 1e-6) this.want.copy(this.aim).sub(this.eye);
      this.want.normalize().multiplyScalar(5).add(this.eye);
    }
    if (!this.settled) { this.aim.copy(this.want); this.settled = true; }
    else this.aim.lerp(this.want, 1 - Math.exp(-dt * 3.2));
    this.camera.position.copy(this.eye);
    this.want.copy(this.aim).sub(this.eye).applyAxisAngle(this.up, -visit.lookAngle).add(this.eye);
    this.camera.lookAt(this.want);
    this.parts.groups.loft.visible = this.eye.y > 2.3;
    this.parts.letter.visible = visit.letter;
  }
  render(renderer: THREE.WebGLRenderer, draw?: (scene: THREE.Scene, camera: THREE.Camera) => void): void {
    const size = renderer.getSize(this.size), aspect = size.x / size.y;
    if (this.camera.aspect !== aspect) { this.camera.aspect = aspect; this.camera.fov = aspect < .8 ? 80 : 68; this.camera.updateProjectionMatrix(); }
    const exposure = renderer.toneMappingExposure; renderer.toneMappingExposure = 1;
    try { if (draw) draw(this.scene, this.camera); else renderer.render(this.scene, this.camera); } finally { renderer.toneMappingExposure = exposure; }
  }
  leave(): void { this.visit.leave(); }
  dispose(): void { this.art.dispose(); this.scene.clear(); }
}

/** The door at the foot of the tower steps. Outside the mail game a visit can be repeated and leaves nothing. */
export function churchDoor(site: Pick<ChurchSite, 'world'>, mail: boolean): Door {
  return {
    id: 'church', name: 'River Denys Mountain church', position: churchDoorPosition(site), radius: CHURCH_DOOR_RADIUS,
    prompt: mail ? 'One letter for the vestry. Go in quietly.' : 'Step inside for a quiet look.',
    leave: 'STEP OUT · Esc', controls: { go: 'WALK', brake: 'BACK', steer: 'LOOK' }, repeat: !mail,
    create: () => new ChurchInterior(mail),
  };
}
