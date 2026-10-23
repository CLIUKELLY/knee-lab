import * as THREE from "three";

/** A closed, bounded cubic curve with continuous speed across keyframes. */
export function sampleMotion(keyframes: readonly number[], progress: number): number {
  if (!keyframes.length) return 0;
  const values = [...keyframes];
  if (values.length > 1 && values.at(-1) === values[0]) values.pop();
  const count = values.length;
  if (count === 1) return values[0];
  const at = (i: number) => values[(i + count) % count];
  const phase = ((progress % 1) + 1) % 1 * count;
  const i = Math.floor(phase), t = phase - i;
  const slope = (index: number) => {
    const left = at(index) - at(index - 1);
    const right = at(index + 1) - at(index);
    // Flat at turning points; harmonic mean prevents angle overshoot.
    return left * right <= 0 ? 0 : 2 * left * right / (left + right);
  };
  return (2 * t ** 3 - 3 * t ** 2 + 1) * at(i)
    + (t ** 3 - 2 * t ** 2 + t) * slope(i)
    + (-2 * t ** 3 + 3 * t ** 2) * at(i + 1)
    + (t ** 3 - t ** 2) * slope(i + 1);
}

// Approximate joint centre from the source mesh bounds. Educational kinematics.
export const pivot = new THREE.Vector3(0.15, -0.416, -0.025);

export function moveWithTibia(point: THREE.Vector3, flexion: number) {
  return point.sub(pivot).applyAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(flexion)).add(pivot);
}

export function moveWithPatella(point: THREE.Vector3, flexion: number) {
  // A separate, reduced arc keeps the patella travelling around the distal femur.
  return moveWithTibia(point, flexion * 0.62);
}

type AttachmentMotion = "distal" | "all" | "quadriceps" | "patellar" | "rigid";

export function bendStableGeometry(geometry: THREE.BufferGeometry, flexion: number, mode: AttachmentMotion = "distal") {
  if (Math.abs((geometry.userData.lastFlexion ?? Infinity) - flexion) < 0.015) return;
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  if (!geometry.userData.basePositions) {
    geometry.userData.basePositions = new Float32Array(position.array);
    geometry.computeBoundingBox();
    position.setUsage(THREE.DynamicDrawUsage);
  }
  const base = geometry.userData.basePositions as Float32Array;
  const box = geometry.boundingBox!;
  const top = geometry.userData.motionRange?.top ?? box.max.y;
  const bottom = geometry.userData.motionRange?.bottom ?? box.min.y;
  const angle = THREE.MathUtils.degToRad(flexion);
  const c = Math.cos(angle), sn = Math.sin(angle);
  const pc = Math.cos(angle * 0.62), ps = Math.sin(angle * 0.62);
  for (let i = 0; i < position.count; i++) {
    const x = base[i * 3], y = base[i * 3 + 1], z = base[i * 3 + 2];
    const ry = y - pivot.y, rz = z - pivot.z;
    const ty = pivot.y + ry * c - rz * sn;
    const tz = pivot.z + ry * sn + rz * c;
    const py = pivot.y + ry * pc - rz * ps;
    const pz = pivot.z + ry * ps + rz * pc;
    const t = THREE.MathUtils.clamp((top - y) / Math.max(top - bottom, 0.0001), 0, 1);
    const blend = t * t * (3 - 2 * t);
    let nextY: number, nextZ: number;
    if (mode === "rigid") {
      nextY = ty; nextZ = tz;
    } else if (mode === "all") {
      const follow = THREE.MathUtils.smoothstep(t, 0, 0.32);
      nextY = THREE.MathUtils.lerp(y, ty, follow);
      nextZ = THREE.MathUtils.lerp(z, tz, follow);
    } else if (mode === "quadriceps") {
      nextY = THREE.MathUtils.lerp(y, py, blend);
      nextZ = THREE.MathUtils.lerp(z, pz, blend);
    } else if (mode === "patellar") {
      nextY = THREE.MathUtils.lerp(py, ty, blend);
      nextZ = THREE.MathUtils.lerp(pz, tz, blend);
    } else {
      nextY = THREE.MathUtils.lerp(y, ty, blend);
      nextZ = THREE.MathUtils.lerp(z, tz, blend);
    }
    position.setXYZ(i, x, nextY, nextZ);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.userData.lastFlexion = flexion;
}

