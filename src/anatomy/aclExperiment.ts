import * as THREE from "three";
import { moveWithTibia } from "./motion";

// Demonstration parameters, deliberately uncalibrated: not patient estimates.
export const experimentParameters = { otherStiffness: 4, otherCubic: 0.04, aclStiffness: 80, toeLength: 2 };
export const aclOrigin = new THREE.Vector3(0.166, -0.397, -0.032);
export const aclInsertion = new THREE.Vector3(0.132, -0.438, -0.004);
export function pullDirection(flexion: number) {
  return new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(flexion));
}
export function attachmentAt(flexion: number, displacementMm = 0) {
  return moveWithTibia(aclInsertion.clone(), flexion).add(pullDirection(flexion).multiplyScalar(displacementMm / 1000));
}
export function responseAt(displacementMm: number, flexion: number, intact: boolean) {
  const { otherStiffness, otherCubic, aclStiffness, toeLength } = experimentParameters;
  const baseline = attachmentAt(flexion).sub(aclOrigin).length() * 1000;
  const direction = attachmentAt(flexion, displacementMm).sub(aclOrigin);
  const length = direction.length() * 1000;
  const extension = Math.max(0, length - baseline);
  const tension = !intact ? 0 : aclStiffness * (extension < toeLength ? extension * extension / (2 * toeLength) : extension - toeLength / 2);
  const aclResistance = tension * Math.max(0, direction.dot(pullDirection(flexion)) / direction.length());
  const otherResistance = otherStiffness * displacementMm + otherCubic * displacementMm ** 3;
  return { length, extension, tension, aclResistance, otherResistance, resistance: aclResistance + otherResistance };
}
export function solveAnteriorPull(force: number, flexion: number, intact: boolean) {
  let lower = 0, upper = 40;
  for (let i = 0; i < 60; i++) {
    const mid = (lower + upper) / 2;
    if (responseAt(mid, flexion, intact).resistance < force) lower = mid;
    else upper = mid;
  }
  const displacement = force === 0 ? 0 : (lower + upper) / 2;
  return { displacement, ...responseAt(displacement, flexion, intact) };
}
