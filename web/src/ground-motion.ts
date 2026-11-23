export const GRAVITY = 9.81;
const LANDING_DROP = 1.25; // metres below the top of the flight
const MAX_LAUNCH_SPEED = Math.sqrt(2 * GRAVITY * 3); // limit the rise above takeoff to three metres
const APPROACH = .5;

/** Compare the incoming tangent with the support the ride is about to reach. */
export function crestVelocity(
  heightAt: (x: number, z: number, referenceY: number) => number | null,
  x: number, z: number, vx: number, vz: number, dt: number, height: number | null,
  referenceY: number, edgeOnly = false,
): number | null {
  const speed = Math.hypot(vx, vz);
  if (height === null || speed <= 3) return null;
  const dx = vx / speed, dz = vz / speed;
  const next = heightAt(x + vx * dt, z + vz * dt, referenceY);
  if (next === null || edgeOnly && height - next <= .15) return null;
  const back = heightAt(x - dx * APPROACH, z - dz * APPROACH, referenceY);
  if (back === null) return null;
  const grade = (height - back) / APPROACH;
  const tangent = grade * speed;
  const gravityDrop = .5 * GRAVITY * dt * dt;
  if ((tangent * dt) - (next - height) <= gravityDrop + .0001) return null;

  // A raised seam can look like an uphill ramp from one sample. Require a matching approach behind it.
  const far = heightAt(x - dx * APPROACH * 3, z - dz * APPROACH * 3, referenceY);
  if (far === null) return null;
  const earlierGrade = (back - far) / (2 * APPROACH);
  if (Math.abs(grade - earlierGrade) > .22) return null;
  // The two back grades are centred .75 m apart. Extrapolate to the point of departure.
  const launchGrade = grade + (grade - earlierGrade) / 3;
  if (launchGrade < -.02) return null;
  const rise = launchGrade * speed * dt;
  if (rise - (next - height) <= gravityDrop + .0001) return null;
  if (height - next > .15) {
    // Low seams on flat support should settle. A ramp lip or a deliberate drop can release the ride.
    if (launchGrade < .02 && height - next < .5) return null;
  } else {
    // An isolated sample can open a tiny gap without room for flight. Check farther down the route.
    const look = 1.5;
    const ahead = heightAt(x + dx * look, z + dz * look, referenceY);
    if (ahead === null || ahead > height + .035 * look) return null;
    if (height + launchGrade * look - .5 * GRAVITY * (look / speed) ** 2 - ahead < .065) return null;
  }
  return Math.min(launchGrade * speed, MAX_LAUNCH_SPEED);
}

export function hardLanding(peak: number | null, support: number): boolean {
  return peak !== null && peak - support > LANDING_DROP;
}
