export const GRAVITY = 9.81;
const LANDING_DROP = 1.25; // metres below the top of the flight
const MAX_LAUNCH_SPEED = Math.sqrt(2 * GRAVITY * 3); // limit the rise above takeoff to three metres
const APPROACH = .5;
const LIP_DROP = .15;
export const LEDGE_DROP = .5;

/** Compare the incoming tangent with the support the ride is about to reach. */
export function crestVelocity(
  heightAt: (x: number, z: number, referenceY: number) => number | null,
  x: number, z: number, vx: number, vz: number, dt: number, height: number | null,
  referenceY: number, edgeOnly = false, supportGrade = 0,
): number | null {
  const speed = Math.hypot(vx, vz);
  if (height === null || speed <= .05) return null;
  const dx = vx / speed, dz = vz / speed;
  const next = heightAt(x + vx * dt, z + vz * dt, referenceY + supportGrade * speed * dt);
  if (next === null) return null;
  const drop = height - next;
  const ledge = drop >= LEDGE_DROP;
  const lip = drop > LIP_DROP;
  if (speed <= 3 && !ledge) return null;
  if (edgeOnly && !lip) return null;

  const back = heightAt(x - dx * APPROACH, z - dz * APPROACH, referenceY - supportGrade * APPROACH);
  if (back === null) return null;
  const grade = (height - back) / APPROACH;
  const gravityDrop = .5 * GRAVITY * dt * dt;
  if (grade * speed * dt + drop <= gravityDrop + .0001) return null;
  const far = heightAt(x - dx * APPROACH * 3, z - dz * APPROACH * 3, referenceY - supportGrade * APPROACH * 3);
  if (far === null) return null;
  const earlierGrade = (back - far) / (2 * APPROACH);
  // A raised edge can affect one sample. Both parts of the approach must support the launch grade.
  if (Math.abs(grade - earlierGrade) > .22) return null;
  const launchGrade = Math.min(grade, earlierGrade);
  const velocity = Math.min(launchGrade * speed, MAX_LAUNCH_SPEED);
  if (ledge) return speed <= 3 ? 0 : velocity;
  if (velocity * dt + drop <= gravityDrop + .0001) return null;
  // An exact 2.5% approach can round slightly below its grade at a sampled point.
  if (launchGrade + 1e-9 < .025) return null;
  if (!edgeOnly) {
    const look = 1.5;
    const ahead = heightAt(x + dx * look, z + dz * look, referenceY + supportGrade * look);
    if (ahead === null || ahead > height + .035 * look) return null;
    const clearance = height + launchGrade * look - .5 * GRAVITY * (look / speed) ** 2 - ahead;
    if (clearance < .18) {
      // A lip can release the ride with less clearance if the lower support
      // persists between the step and the longer probe.
      if (!lip || clearance <= 0 || height - ahead <= LIP_DROP) return null;
      const between = heightAt(x + dx * APPROACH, z + dz * APPROACH, referenceY + supportGrade * APPROACH);
      if (between === null || height - between <= LIP_DROP) return null;
    }
  }
  return velocity;
}

export function hardLanding(peak: number | null, support: number): boolean {
  return peak !== null && peak - support > LANDING_DROP;
}
