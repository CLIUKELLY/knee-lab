import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';

const source = readFileSync(new URL('../src/anatomy/motion.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
  .replace('from "three"', `from ${JSON.stringify(import.meta.resolve('three'))}`);
const { sampleMotion, pivot, moveWithTibia, moveWithPatella, bendStableGeometry } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const near = (a, b, epsilon = 1e-6) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);

test('shin rotation preserves length, matches the selected angle and bends posteriorly', () => {
  const base = pivot.clone().add(new THREE.Vector3(0, -0.3, 0));
  for (const angle of [0, 30, 60, 90, 130]) {
    const result = moveWithTibia(base.clone(), angle);
    near(result.distanceTo(pivot), 0.3);
    near(THREE.MathUtils.radToDeg(base.clone().sub(pivot).angleTo(result.clone().sub(pivot))), angle);
    if (angle > 0) assert.ok(result.z < pivot.z);
  }
});

test('closed preset curves stay bounded and have continuous position and speed', () => {
  for (const keys of [[5,18,60,35,8], [5,30,65,100,125,90,45,5], [8,35,75,45,12]]) {
    for (let i = 0; i < 10000; i++) {
      const value = sampleMotion(keys, i / 10000);
      assert.ok(value >= Math.min(...keys) - 1e-6 && value <= Math.max(...keys) + 1e-6);
    }
    const count = keys.at(-1) === keys[0] ? keys.length - 1 : keys.length;
    for (let i = 0; i <= count; i++) {
      const t = i / count, h = 1e-6;
      const left = (sampleMotion(keys, t) - sampleMotion(keys, t-h)) / h;
      const right = (sampleMotion(keys, t+h) - sampleMotion(keys, t)) / h;
      near(left, right, 0.04);
    }
    near(sampleMotion(keys, 0), sampleMotion(keys, 1));
  }
});

test('soft-tissue attachments follow their bones without accumulating deformation', () => {
  const start = new THREE.Vector3(0.14, -0.39, 0.02);
  const end = new THREE.Vector3(0.15, -0.49, 0.01);
  for (const mode of ['distal', 'quadriceps', 'patellar', 'rigid', 'all']) {
    const geometry = new THREE.BufferGeometry().setFromPoints([start, start.clone().lerp(end, 0.5), end]);
    for (const angle of [90, 130, 20, 90]) bendStableGeometry(geometry, angle, mode);
    const positions = geometry.getAttribute('position');
    const expectedStart = mode === 'rigid' ? moveWithTibia(start.clone(),90) : mode === 'patellar' ? moveWithPatella(start.clone(),90) : start;
    const expectedEnd = mode === 'quadriceps' ? moveWithPatella(end.clone(),90) : moveWithTibia(end.clone(),90);
    near(new THREE.Vector3().fromBufferAttribute(positions,0).distanceTo(expectedStart), 0);
    near(new THREE.Vector3().fromBufferAttribute(positions,2).distanceTo(expectedEnd), 0);
    bendStableGeometry(geometry,0,mode);
    near(new THREE.Vector3().fromBufferAttribute(positions,0).distanceTo(start),0);
    near(new THREE.Vector3().fromBufferAttribute(positions,2).distanceTo(end),0);
    geometry.dispose();
  }
});

test('torn ligament fragments retain the original attachment interval', () => {
  const fullStart = new THREE.Vector3(0.16, -0.397, -0.032);
  const fullEnd = new THREE.Vector3(0.132, -0.438, -0.004);
  const mid = fullStart.clone().lerp(fullEnd,0.4);
  const geometry = new THREE.BufferGeometry().setFromPoints([fullStart, mid]);
  geometry.userData.motionRange = { top: fullStart.y, bottom: fullEnd.y };
  bendStableGeometry(geometry,90);
  const fragmentEnd = new THREE.Vector3().fromBufferAttribute(geometry.getAttribute('position'),1);
  assert.ok(fragmentEnd.distanceTo(moveWithTibia(mid.clone(),90)) > 0.001, 'torn tip must not become a tibial attachment');
  geometry.dispose();
});

test('bone attachment range governs flexion even when mesh extends past an endpoint', () => {
  const proximal = new THREE.Vector3(0.146, -0.30, 0.05);
  const distal = new THREE.Vector3(0.15, -0.36, 0.045);
  // Simulates a tapered muscle mesh containing a small outlying surface vertex.
  const geometry = new THREE.BufferGeometry().setFromPoints([
    proximal,
    proximal.clone().lerp(distal, 0.5),
    distal,
    distal.clone().add(new THREE.Vector3(0.005, -0.004, 0)),
  ]);
  geometry.userData.motionRange = { top: proximal.y, bottom: distal.y };
  const attr = geometry.getAttribute('position');
  for (const angle of [0, 45, 90, 120, 0]) {
    bendStableGeometry(geometry, angle, 'quadriceps');
    const actualProximal = new THREE.Vector3().fromBufferAttribute(attr, 0);
    const actualDistal = new THREE.Vector3().fromBufferAttribute(attr, 2);
    near(actualProximal.distanceTo(proximal), 0);
    near(actualDistal.distanceTo(moveWithPatella(distal.clone(), angle)), 0);
  }
  geometry.dispose();
});

test('biceps distal insertion remains attached to tibia/fibula frame at multiple angles', () => {
  const proximal = new THREE.Vector3(0.19, -0.12, -0.05);
  const fibularInsertion = new THREE.Vector3(0.206, -0.47, -0.034);
  const geometry = new THREE.BufferGeometry().setFromPoints([
    proximal, proximal.clone().lerp(fibularInsertion, 0.5), fibularInsertion,
  ]);
  geometry.userData.motionRange = { top: proximal.y, bottom: fibularInsertion.y };
  for (const angle of [0, 45, 90, 120, 0]) {
    bendStableGeometry(geometry, angle, 'distal');
    const distal = new THREE.Vector3().fromBufferAttribute(geometry.getAttribute('position'), 2);
    near(distal.distanceTo(moveWithTibia(fibularInsertion.clone(), angle)), 0);
  }
  geometry.dispose();
});
