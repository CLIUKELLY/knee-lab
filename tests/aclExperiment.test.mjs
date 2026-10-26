import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace('from "three"', `from ${JSON.stringify(import.meta.resolve('three'))}`)).toString('base64')}`;
const motionUrl = moduleUrl(readFileSync(new URL('../src/anatomy/motion.ts', import.meta.url),'utf8'));
const source = readFileSync(new URL('../src/anatomy/aclExperiment.ts', import.meta.url),'utf8').replace('"./motion"',JSON.stringify(motionUrl));
const { solveAnteriorPull, responseAt, attachmentAt, pullDirection, aclInsertion } = await import(moduleUrl(source));
const { moveWithTibia } = await import(motionUrl);
test('equilibrium holds across every supported angle and force in both trials', () => {
  for(let angle=0;angle<=60;angle+=5) for(let force=0;force<=150;force+=5) for(const intact of [true,false]) {
    const r=solveAnteriorPull(force,angle,intact);
    assert.ok(Math.abs(r.resistance-force)<1e-7);
    assert.ok(r.displacement>=0 && r.displacement<16);
    if(!intact) assert.equal(r.tension,0);
    if(!force) assert.equal(r.displacement,0);
  }
});
test('intact restraint reduces displacement and displacement increases with force', () => {
  for(const angle of [0,20,40,60]) {
    let lastIntact=0,lastTorn=0;
    for(let force=1;force<=150;force++) {
      const a=solveAnteriorPull(force,angle,true),b=solveAnteriorPull(force,angle,false);
      assert.ok(a.displacement<b.displacement);
      assert.ok(a.displacement>lastIntact && b.displacement>lastTorn);
      lastIntact=a.displacement;lastTorn=b.displacement;
    }
    assert.equal(responseAt(0,angle,true).tension,0);
  }
});
test('tibial attachment follows bone flexion and applied translation without drift', () => {
  for(const angle of [0,60,20,0]) {
    const expected=moveWithTibia(aclInsertion.clone(),angle);
    expected.add(pullDirection(angle).multiplyScalar(0.01));
    assert.ok(attachmentAt(angle,10).distanceTo(expected)<1e-12);
  }
});
