import * as THREE from 'three';
import type { Photo, PhotoFact } from './complaints';
export interface Subject extends PhotoFact { label: string; y?: number; active: boolean }
/** Other modules can register mutable subjects. Photos store copies, never live references. */
export class Evidence {
  readonly subjects = new Map<string, Subject>();
  readonly photos: Photo[] = [];
  private readonly point = new THREE.Vector3();
  register(subject: PhotoFact & { label?: string; y?: number; active?: boolean }): Subject {
    const registered = Object.assign(subject, { label: subject.label ?? subject.kind, active: subject.active ?? true });
    this.subjects.set(subject.id, registered); return registered;
  }
  unregister(id: string): void { this.subjects.delete(id); }
  take(at: number, x: number, z: number, heading: number, camera: THREE.Camera): Photo {
    const facts: PhotoFact[] = [], labels: string[] = [];
    camera.updateMatrixWorld();
    for (const s of this.subjects.values()) {
      const dx = s.x - x, dz = s.z - z, d2 = dx * dx + dz * dz;
      if (!s.active || d2 > (45 + s.radius) ** 2) continue;
      this.point.set(s.x, s.y ?? 0, s.z).project(camera);
      const inView = this.point.z >= -1 && this.point.z <= 1 && Math.abs(this.point.x) <= 1.08 && Math.abs(this.point.y) <= 1.08;
      const ahead = dx * Math.sin(heading) - dz * Math.cos(heading);
      const across = Math.abs(dx * Math.cos(heading) + dz * Math.sin(heading));
      if (!inView && !(ahead >= 0 && across <= Math.max(3, ahead * .65))) continue;
      facts.push({ id: s.id, kind: s.kind, x: s.x, z: s.z, radius: s.radius, road: s.road, target: s.target, blocking: s.blocking });
      labels.push(s.label);
    }
    const photo = { at, facts, caption: labels.length ? [...new Set(labels)].join(' · ') : 'Road. No supporting evidence.' };
    this.photos.push(photo); return photo;
  }
}
