/**
 * Stylized, faceless geometric figure for the Boss (three invented options, resembling no real person).
 * Follows painter-art.ts and deckhand.ts: vertex-coloured Mesher geometry, no photographs, no realistic faces.
 */
import * as THREE from 'three';
import { Mesher, type RGB } from './yard-kit';
import type { BossLookId } from './depot-rules';

export interface BossFigure {
  readonly root: THREE.Group;
  readonly head: THREE.Group;
  readonly rightArm: THREE.Group;
  dispose(): void;
}

const rgb = (hex: number): RGB => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};

const SKIN = rgb(0xd4a988);
const DARK = rgb(0x1f252b);
const PAPER = rgb(0xf2ede0);
const WOOD = rgb(0x7c5534);
const BRASS = rgb(0xc89d42);
const RED_PEN = rgb(0xb8352f);

interface Palette {
  coat: RGB;
  shirt: RGB;
  tie: RGB;
  trousers: RGB;
  accent: RGB;
  hat: RGB;
  prop: RGB;
}

const PALETTES: Record<BossLookId, Palette> = {
  // Option A: oxblood dispatch windbreaker echoing boss-car.ts (0x7c1d26) + amber safety lanyard (0xe89b2d)
  windbreaker: {
    coat: rgb(0x7c1d26),
    shirt: rgb(0xede6d5),
    tie: rgb(0x28313a),
    trousers: rgb(0x2d343b),
    accent: rgb(0xe89b2d),
    hat: rgb(0x262e36),
    prop: WOOD,
  },
  // Option B: heavy charcoal-navy overcoat + tweed flat cap + thick oxblood binder
  overcoat: {
    coat: rgb(0x2d3742),
    shirt: rgb(0xe3e7ea),
    tie: rgb(0x7c1d26),
    trousers: rgb(0x232930),
    accent: rgb(0x8e99a3),
    hat: rgb(0x6d5d4b),
    prop: rgb(0x7b2229),
  },
  // Option C: rolled-sleeve pale-blue shirt + olive utility supervisor vest + yellow legal pad
  vest: {
    coat: rgb(0x4c5844),
    shirt: rgb(0x8ea9ba),
    tie: rgb(0x3a4337),
    trousers: rgb(0x283545),
    accent: rgb(0xd8b848),
    hat: rgb(0x3b3530),
    prop: rgb(0xe4cb62),
  },
};

/** Build one Boss figure in local coordinates: facing +Z, feet on y=0 (standing) or seat at y=0.46 (seated). */
export function buildBossCharacter(look: BossLookId, pose: 'standing' | 'seated'): BossFigure {
  const p = PALETTES[look];
  const root = new THREE.Group();
  root.name = `The Boss (${look}, ${pose})`;
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const geometries: THREE.BufferGeometry[] = [];
  const meshOf = (m: Mesher, name: string): THREE.Mesh => {
    const g = m.geometry();
    geometries.push(g);
    const mesh = new THREE.Mesh(g, material);
    mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = false;
    return mesh;
  };

  // ---- Torso, legs and left arm (static body) ----
  const body = new Mesher();
  const torsoY = pose === 'seated' ? 0.84 : 1.06;

  if (pose === 'standing') {
    for (const side of [-1, 1]) {
      body.box(side * 0.12, 0.42, 0, 0.17, 0.72, 0.2, p.trousers);
      body.box(side * 0.12, 0.06, 0.05, 0.19, 0.12, 0.31, DARK);
    }
  } else {
    // Seated thighs forward (+Z) and shins down to floor
    for (const side of [-1, 1]) {
      body.box(side * 0.14, 0.49, 0.22, 0.18, 0.16, 0.46, p.trousers);
      body.box(side * 0.14, 0.24, 0.42, 0.16, 0.44, 0.16, p.trousers);
      body.box(side * 0.14, 0.05, 0.47, 0.18, 0.1, 0.26, DARK);
    }
  }

  // Torso jacket / vest / coat
  const torsoH = look === 'overcoat' ? 0.76 : 0.64;
  const torsoW = look === 'overcoat' ? 0.54 : 0.49;
  body.box(0, torsoY, 0, torsoW, torsoH, 0.29, p.coat);
  // Shirt front + collar V
  body.box(0, torsoY + 0.16, 0.145, 0.16, 0.28, 0.025, p.shirt);
  body.box(0, torsoY + 0.3, 0.02, 0.22, 0.08, 0.22, p.shirt);
  // Tie or zipper/lanyard front detail
  if (look === 'windbreaker') {
    // Dark front zip + bright amber dispatch lanyard & ID card
    body.box(0, torsoY - 0.05, 0.152, 0.026, 0.48, 0.015, DARK);
    body.box(0.08, torsoY + 0.13, 0.155, 0.032, 0.22, 0.014, p.accent);
    body.box(0.08, torsoY - 0.02, 0.158, 0.085, 0.11, 0.016, PAPER);
    body.box(0.08, torsoY + 0.02, 0.164, 0.085, 0.024, 0.01, p.accent);
    // Collar flaps
    for (const side of [-1, 1]) body.box(side * 0.13, torsoY + 0.27, 0.14, 0.1, 0.11, 0.04, p.coat);
  } else if (look === 'overcoat') {
    // Wide lapels + oxblood tie + double buttons
    body.box(0, torsoY + 0.11, 0.156, 0.055, 0.28, 0.015, p.tie);
    for (const side of [-1, 1]) {
      body.box(side * 0.13, torsoY + 0.17, 0.154, 0.095, 0.34, 0.028, p.coat);
      body.box(side * 0.07, torsoY - 0.08, 0.155, 0.03, 0.03, 0.02, DARK);
      body.box(side * 0.07, torsoY - 0.2, 0.155, 0.03, 0.03, 0.02, DARK);
    }
    if (pose === 'standing') {
      // Coat skirt below waist
      body.box(0, torsoY - 0.45, -0.01, 0.56, 0.26, 0.31, p.coat);
    }
  } else {
    // Option C: quilted vest pockets, pens in chest pocket, belt & brass buckle
    body.box(0, torsoY - 0.3, 0, 0.51, 0.065, 0.31, DARK);
    body.box(0, torsoY - 0.3, 0.158, 0.075, 0.065, 0.02, BRASS);
    body.box(-0.14, torsoY + 0.12, 0.155, 0.11, 0.12, 0.02, rgb(0x3b4635));
    body.box(-0.16, torsoY + 0.2, 0.16, 0.016, 0.07, 0.016, RED_PEN);
    body.box(-0.12, torsoY + 0.2, 0.16, 0.016, 0.07, 0.016, p.accent);
    body.box(0.14, torsoY - 0.08, 0.155, 0.13, 0.14, 0.02, rgb(0x3b4635));
  }

  // Left arm (holds clipboard / binder in front of chest or rests on desk)
  const sleeve = look === 'vest' ? p.shirt : p.coat;
  const shoulderY = torsoY + 0.22;
  body.box(-0.31, shoulderY - 0.14, 0.03, 0.14, 0.32, 0.15, sleeve);
  if (pose === 'seated') {
    body.box(-0.27, shoulderY - 0.19, 0.23, 0.12, 0.12, 0.36, look === 'vest' ? SKIN : sleeve);
    body.box(-0.22, shoulderY - 0.19, 0.42, 0.11, 0.09, 0.12, SKIN);
  } else {
    // Left forearm angled forward holding the clipboard/binder/pad
    body.box(-0.25, shoulderY - 0.28, 0.19, 0.12, 0.12, 0.32, look === 'vest' ? SKIN : sleeve);
    body.box(-0.18, shoulderY - 0.27, 0.35, 0.11, 0.09, 0.11, SKIN);
    // Clipboard / binder / yellow pad held in left hand
    body.box(-0.08, shoulderY - 0.22, 0.41, 0.27, 0.34, 0.028, p.prop);
    body.box(-0.08, shoulderY - 0.22, 0.428, 0.23, 0.28, 0.012, look === 'vest' ? p.prop : PAPER);
    body.box(-0.08, shoulderY - 0.06, 0.436, 0.09, 0.035, 0.02, BRASS);
  }
  root.add(meshOf(body, 'boss-body'));

  // ---- Head group (pivots at neck so the Boss can nod/glance) ----
  const head = new THREE.Group();
  head.position.set(0, torsoY + 0.36, 0);
  const hm = new Mesher();
  // Neck + stylized faceless head block (zero facial features: matches painter-art.ts and deckhand.ts)
  hm.box(0, 0.04, 0, 0.13, 0.09, 0.13, SKIN);
  hm.box(0, 0.19, 0.01, 0.23, 0.26, 0.23, SKIN);
  if (look === 'windbreaker') {
    // Structured dispatch visor cap with brim forward (+Z) and small amber bar
    hm.box(0, 0.33, 0.0, 0.255, 0.11, 0.255, p.hat);
    hm.box(0, 0.295, 0.17, 0.24, 0.03, 0.15, p.hat);
    hm.box(0, 0.33, 0.13, 0.09, 0.03, 0.015, p.accent);
  } else if (look === 'overcoat') {
    // Tweed flat cap + minimal brow-frame spectacle bar (still faceless)
    hm.box(0, 0.325, 0.02, 0.265, 0.08, 0.29, p.hat);
    hm.box(0, 0.295, 0.16, 0.23, 0.025, 0.09, p.hat);
    hm.box(0, 0.21, 0.132, 0.19, 0.022, 0.018, BRASS);
    for (const side of [-1, 1]) hm.box(side * 0.055, 0.195, 0.13, 0.065, 0.048, 0.012, DARK);
  } else {
    // Neat geometric hair cap (no hat)
    hm.box(0, 0.32, -0.01, 0.245, 0.08, 0.25, p.hat);
    hm.box(0, 0.24, -0.115, 0.24, 0.15, 0.04, p.hat);
  }
  head.add(meshOf(hm, 'boss-head'));
  root.add(head);

  // ---- Right arm group (pivots at right shoulder for tapping pen / gesturing) ----
  const rightArm = new THREE.Group();
  rightArm.position.set(0.31, shoulderY, 0.02);
  const am = new Mesher();
  am.box(0, -0.14, 0.01, 0.14, 0.31, 0.15, sleeve);
  am.box(-0.04, -0.27, 0.19, 0.115, 0.115, 0.31, look === 'vest' ? SKIN : sleeve);
  am.box(-0.08, -0.27, 0.35, 0.105, 0.09, 0.11, SKIN);
  // Pen held in right hand
  am.box(-0.11, -0.27, 0.43, 0.018, 0.018, 0.16, RED_PEN);
  rightArm.add(meshOf(am, 'boss-arm'));
  root.add(rightArm);

  return {
    root,
    head,
    rightArm,
    dispose() {
      for (const g of geometries) g.dispose();
      material.dispose();
    },
  };
}
