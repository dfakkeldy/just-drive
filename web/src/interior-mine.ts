import * as THREE from 'three';
import type { InteriorGame, InteriorResult } from './interiors';
import { MineArt } from './mine-art';
import { MineRun } from './mine-rules';
import type { Input } from './vehicle';
const smooth = (v: number) => { const t = THREE.MathUtils.clamp(v, 0, 1); return t * t * (3 - 2 * t); };
/** A self-contained, shadow-free set. Only the nearby tunnel modules are drawn. */
export class MineInterior implements InteriorGame {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, .08, 48);
  readonly run: MineRun;
  private readonly art = new MineArt();
  private readonly modules: { group: THREE.Group; distance: number }[] = [];
  private readonly rig: ReturnType<MineArt['cart']>;
  private readonly headlamp = new THREE.SpotLight(0xffdc9e, 38, 42, .85, .65, 1.1);
  private readonly hand = new THREE.Group();
  private readonly parcelHome = new THREE.Vector3(0, .62, 0);
  private lean = 0;
  private drawDistance = 0;
  private readonly focus = new THREE.Vector3();
  constructor(day: number) {
    this.run = new MineRun(day);
    this.scene.background = new THREE.Color(0x080f12); this.scene.fog = new THREE.Fog(0x080f12, 13, 38);
    this.scene.add(new THREE.HemisphereLight(0x82969a, 0x6e5033, 1.65));
    this.rig = this.art.cart(this.scene);
    this.headlamp.castShadow = false; this.scene.add(this.headlamp, this.headlamp.target);
    this.art.box(this.rig.root, 0xaba077, 0, 1.02, -1.08, .35, .3, .24);
    this.art.glow(this.rig.root, 0xffdf95, 0, 1.02, -1.22, .19);
    for (let d = 0; d <= 196; d += 2) this.segment(d, false);
    for (let stage = 0; stage < 3; stage++) {
      for (let p = 44; p <= 58; p += 2) this.segment(stage * 54 + p, true, stage, p);
      const fork = this.run.layout[stage];
      const board = new THREE.Group(), pos = this.point(stage * 54 + 39);
      board.position.copy(pos); this.scene.add(board);
      this.art.board(board, [`No. ${fork.oldNumber} ${fork.direction > 0 ? '←' : '→'} · OLD`, 'NIGHT SHIFT', `${fork.direction < 0 ? '←' : '→'} No. ${fork.number}`, 'FRESH CHALK'], 0, 3, -2, 3.6, 1.8, true);
      this.modules.push({ group: board, distance: stage * 54 + 39 });
      const end = new THREE.Group(); end.position.copy(this.branchPoint(stage, 59, true)); this.scene.add(end);
      this.art.box(end, 0x252f30, 0, 2.2, -.5, 5.8, 4.6, .7);
      this.art.board(end, ['Moved.', `Try No. ${fork.number}.`, 'THE NIGHT SHIFT'], 0, 2.4, .02, 3.6, 1.8, true, false);
      this.art.box(end, 0x786650, 0, .9, .6, 2, .4, .3);
      this.modules.push({ group: end, distance: stage * 54 + 54 });
    }
    this.coalFace(); this.positionView();
  }
  get result(): InteriorResult | null { return this.run.result; }
  get readout(): string {
    const signed = this.run.phase === 'signed' || this.run.phase === 'returning' || this.run.result?.delivered;
    return `${(this.run.speed * 3.6).toFixed(0)} km/h · ${signed ? 'PARCEL SIGNED' : this.run.phase === 'tipped' ? 'PARCEL LOOSE' : 'PARCEL ABOARD'} · ${Math.floor(this.run.elapsed)} s underground\n${this.run.message}\n${signed ? 'Signature on file: ɯ╱ɯ╲ɯ____' : 'A/D or ←/→: lean · S/↓: brake'}`;
  }
  private baseX(stage: number): number { return this.run.layout.slice(0, stage).reduce((sum, f) => sum + f.direction * 8, 0); }
  private branchPoint(stage: number, p: number, wrong: boolean): THREE.Vector3 {
    const fork = this.run.layout[stage];
    const bend = p >= 12 && p < 42 ? Math.sin((p - 12) / 30 * Math.PI) * 2.6 : 0;
    const x = this.baseX(stage) + (fork ? fork.direction * (wrong ? -1 : 1) * 8 * smooth((p - 42) / 12) : 0) + bend;
    const d = stage * 54 + p; return new THREE.Vector3(x, -d * .11, -d);
  }
  private point(d: number, wrong = false): THREE.Vector3 {
    const stage = Math.min(3, Math.max(0, Math.floor(d / 54))), p = d - stage * 54;
    return this.branchPoint(stage, p, wrong);
  }
  private segment(d: number, wrong: boolean, branchStage?: number, branchProgress?: number): void {
    const a = this.art, g = new THREE.Group();
    const pos = branchStage === undefined ? this.point(d) : this.branchPoint(branchStage, branchProgress!, wrong);
    const next = branchStage === undefined ? this.point(d + .15) : this.branchPoint(branchStage, branchProgress! + .15, wrong);
    g.position.copy(pos); g.rotation.y = Math.atan2(-(next.x - pos.x), -(next.z - pos.z));
    this.scene.add(g); this.modules.push({ group: g, distance: d });
    // Forks open into a chamber, so neither branch has a wall across its mouth.
    const p = d % 54, chamber = d < 162 && p >= 42;
    const width = chamber ? 11 : 3;
    if (chamber) g.rotation.y = 0;
    const end = (branchStage === undefined ? this.point(d + 2) : this.branchPoint(branchStage, branchProgress! + 2, wrong)).sub(pos);
    end.applyAxisAngle(new THREE.Vector3(0, 1, 0), -g.rotation.y);
    const length = end.length();
    const grade = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), end.clone().normalize());
    if (!chamber || !wrong) {
      const floor = a.box(g, 0x534e42, end.x / 2, end.y / 2 - .2, end.z / 2, width * 2, .35, length + .1);
      floor.quaternion.copy(grade);
    }
    if (!chamber) {
      for (const x of [-3.15, 3.15]) {
        a.box(g, 0x394447, x, 2.1, -1, .7, 4.6, 2.2);
        if (d % 6 === 0) a.box(g, 0x836c4b, x * .89, 2.05, 0, .25, 4.1, .3);
      }
    }
    if (!chamber || !wrong) a.box(g, 0x333d40, 0, 4.6, -1, width * 2 + .6, .6, 2.2);
    if (d % 6 === 0 && (!chamber || !wrong)) {
      a.box(g, 0x8b7252, 0, 4.1, 0, width * 2, .28, .35);
      a.box(g, 0x292c29, .8, 3.9, -.6, .05, .45, .05);
      a.box(g, 0x7c7051, .8, 3.6, -.6, .25, .28, .25);
      a.glow(g, 0xe4ad57, .8, 3.57, -.42, .13);
    }
    for (const x of [-.57, .57]) {
      const rail = a.box(g, 0x8b9997, x + end.x / 2, .05 + end.y / 2, end.z / 2, .08, .13, length + .03);
      rail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), end.clone().normalize());
    }
    for (const t of [.25, .75]) {
      const sleeper = a.box(g, t < .5 ? 0x766044 : 0x66553e, end.x * t, end.y * t - .02, end.z * t, 1.9, .15, .22);
      sleeper.quaternion.copy(grade);
    }
    if (!chamber) {
      a.shape(g, a.rock, 0x1b292e, 2.84, 1.6, -1, .28, .75, .9);
      if (d % 4 === 0) {
        a.glow(g, 0x497278, 2.6, 1.7, -.8, .055);
        const drip = a.box(g, 0x759a9e, -1.5, 3.7, -1, .025, .22, .025); drip.name = 'Drip';
      }
    }
  }
  private coalFace(): void {
    const a = this.art, face = new THREE.Group(); face.position.copy(this.point(196)); this.scene.add(face);
    this.modules.push({ group: face, distance: 196 });
    a.box(face, 0x0b171d, 0, 2.2, -2.2, 6, 4.5, 1);
    for (let i = 0; i < 8; i++) a.shape(face, a.rock, 0x202f33, -2.5 + (i % 4) * 1.6, .7 + Math.floor(i / 4) * 2.4, -1.7, .85, 1.2, .55);
    a.box(face, 0x9b7f55, 0, .58, -.6, 2.4, .4, .4);
    a.board(face, ['NIGHT SHIFT', 'SIGN HERE. SLOWLY.'], 0, 3.65, -.8, 3.4, 1.25, true, false);
    a.box(face, 0x9b864f, -1.05, 1.85, -.8, .36, .6, .35);
    a.glow(face, 0xffdc86, -1.05, 1.9, -.58, .22);
    a.box(face, 0x776c46, -1.05, 2.25, -.8, .22, .15, .14);
    face.add(this.hand); this.hand.position.set(.65, 1.8, -1.2);
    a.box(this.hand, 0x3c514d, .2, .08, -.3, .3, .3, 1.3);
    a.box(this.hand, 0xb5a16b, 0, .1, .45, .5, .25, .55);
    for (let i = 0; i < 4; i++) a.box(this.hand, 0xc4ad76, -.19 + i * .125, .12, .8, .10, .16, .37 - Math.abs(i - 1.5) * .045);
    const thumb = a.box(this.hand, 0xb5a16b, -.3, .1, .48, .14, .17, .4); thumb.rotation.y = -.65;
  }
  update(dt: number, input: Input): void {
    this.lean = input.steer;
    this.run.update(dt, { brake: input.throttle < -.1 || input.handbrake, lean: input.steer }); this.positionView();
  }
  private positionView(): void {
    const run = this.run;
    let distance = run.distance;
    if (run.phase === 'returning') distance = 196 * smooth(Math.max(0, run.timer / 4));
    if (run.phase === 'winching') distance = run.stage * 54 + 42 + 12 * smooth(Math.max(0, run.timer / 3));
    this.drawDistance = distance;
    const wrong = run.wrong || run.stage < 3 && run.progress > 42 && run.progress < 48 && this.lean * run.layout[run.stage].direction < -.25;
    const returning = run.phase === 'returning';
    const local = distance - run.stage * 54;
    const pos = returning ? this.point(distance) : this.branchPoint(run.stage, local, wrong);
    const next = returning ? this.point(distance + .25) : this.branchPoint(run.stage, local + .25, wrong);
    const forward = next.clone().sub(pos).normalize();
    this.rig.root.position.copy(pos); this.rig.root.rotation.set(0, Math.atan2(-forward.x, -forward.z), run.phase === 'tipped' ? 1.15 : -this.lean * .04);
    this.rig.parcel.position.copy(this.parcelHome);
    if (run.phase === 'tipped') {
      const flight = Math.min(1, (8 - run.timer) / 1.4); this.rig.parcel.position.set(2 * flight, .6 + Math.sin(flight * Math.PI) * 2, -flight);
      this.rig.parcel.rotation.z = flight * 3;
    } else this.rig.parcel.rotation.z = 0;
    this.rig.parcel.visible = run.phase !== 'returning' && !(run.phase === 'signed' && run.timer < 1);
    if (run.phase === 'signed') this.rig.parcel.position.lerp(new THREE.Vector3(.65, 1.6, .1), smooth((3 - run.timer) / 2));
    this.hand.position.z = run.phase === 'signed' ? -.6 : -1.2;
    this.camera.position.copy(pos).addScaledVector(forward, -4.6); this.camera.position.y += 2.75;
    this.focus.copy(pos).addScaledVector(forward, 7); this.focus.y += 1.8; this.camera.lookAt(this.focus);
    this.headlamp.position.copy(pos).addScaledVector(forward, 1.3); this.headlamp.position.y += 1.65;
    this.headlamp.target.position.copy(pos).addScaledVector(forward, 17); this.headlamp.target.position.y += 1.8;
    for (const module of this.modules) module.group.visible = module.distance > this.drawDistance - 9 && module.distance < this.drawDistance + 40;
  }
  render(renderer: THREE.WebGLRenderer, draw?: (scene: THREE.Scene, camera: THREE.Camera) => void): void {
    const size = renderer.getSize(new THREE.Vector2()), aspect = size.x / size.y;
    if (this.camera.aspect !== aspect) { this.camera.aspect = aspect; this.camera.fov = aspect < .8 ? 74 : 60; this.camera.updateProjectionMatrix(); }
    const exposure = renderer.toneMappingExposure; renderer.toneMappingExposure = 1.05;
    try { if (draw) draw(this.scene, this.camera); else renderer.render(this.scene, this.camera); } finally { renderer.toneMappingExposure = exposure; }
  }
  leave(): void { this.run.leave(); }
  dispose(): void { this.art.dispose(); this.headlamp.dispose(); this.scene.clear(); }
}
