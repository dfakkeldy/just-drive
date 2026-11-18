import * as THREE from 'three';

let sky: THREE.CubeTexture | undefined;
/** Small, deterministic sky/ground probe shared by truck materials only. No scene or car material is changed. */
export function truckReflections(): THREE.CubeTexture {
  if (sky) return sky;
  const size = 64, faces: THREE.DataTexture[] = [];
  for (let face = 0; face < 6; face++) {
    const bytes = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = 2 * (x + .5) / size - 1, v = 2 * (y + .5) / size - 1;
      const d = new THREE.Vector3(...([[1, -v, -u], [-1, -v, u], [u, 1, v], [u, -1, -v], [u, -v, 1], [-u, -v, -1]][face] as [number, number, number])).normalize();
      const horizon = Math.exp(-((d.y / .14) ** 2));
      const cloud = Math.exp(-(((d.y - .38) / .16) ** 2)) * (.85 + .15 * Math.cos(Math.atan2(d.z, d.x) * 2 + .7));
      const sun = Math.pow(Math.max(0, d.dot(new THREE.Vector3(-.55, .65, .52).normalize())), 24);
      // A broad warm horizon and a cool sky make a long highlight bend around a crowned black panel.
      const rgb = d.y >= 0 ? [83 + 85 * horizon + 74 * cloud + 45 * sun, 112 + 66 * horizon + 71 * cloud + 38 * sun, 148 + 36 * horizon + 63 * cloud + 27 * sun]
        : [38 + 66 * horizon, 42 + 61 * horizon, 39 + 54 * horizon];
      const i = (y * size + x) * 4;
      for (let k = 0; k < 3; k++) bytes[i + k] = Math.min(255, rgb[k]);
      bytes[i + 3] = 255;
    }
    const texture = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat); texture.needsUpdate = true; faces.push(texture);
  }
  sky = new THREE.CubeTexture(faces); sky.name = 'Truck-only sky reflection'; sky.colorSpace = THREE.SRGBColorSpace;
  sky.generateMipmaps = true; sky.minFilter = THREE.LinearMipmapLinearFilter; sky.needsUpdate = true;
  return sky;
}
