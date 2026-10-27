import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../src/anatomy/lowerBody.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {sampleLowerBody,squatPose,THIGH,SHIN,ANKLE_HEIGHT,STEP_HEIGHT}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const dist=(a,b)=>Math.hypot(a.forward-b.forward,a.height-b.height);
test('every activity preserves leg segment lengths and reachable ankle targets',()=>{
 for(const activity of ['walking','squat','stairs'])for(let i=0;i<=1000;i++){
  const p=sampleLowerBody(activity,i/1000);
  for(const leg of [p.left,p.right]){
   assert.ok(leg.reachable, `${activity} ${i} unreachable`);
   assert.ok(Math.abs(dist(leg.hip,leg.knee)-THIGH)<1e-5);
   assert.ok(Math.abs(dist(leg.knee,leg.ankle)-SHIN)<1e-5);
   assert.ok(leg.ankle.height>=ANKLE_HEIGHT-1e-8);
  }
 }
});
test('squat fixes both feet while the pelvis lowers and moves back',()=>{
 const start=squatPose(5),bottom=squatPose(120);
 assert.ok(bottom.hip.height<start.hip.height && bottom.hip.forward<start.hip.forward);
 for(let angle=0;angle<=130;angle++){
  const p=squatPose(angle);for(const leg of [p.left,p.right]){
   assert.equal(leg.ankle.forward,0);assert.equal(leg.ankle.height,ANKLE_HEIGHT);assert.ok(leg.contact);
   assert.ok(Math.abs(leg.flexion-angle)<0.2);
  }
 }
});
test('walking alternates support and keeps stance feet on the floor',()=>{
 for(let i=0;i<1000;i++){
  const p=sampleLowerBody('walking',i/1000);
  assert.ok(p.left.contact||p.right.contact);
  for(const leg of [p.left,p.right])if(leg.contact)assert.equal(leg.ankle.height,ANKLE_HEIGHT);
 }
 assert.equal(sampleLowerBody('walking',0.3).left.contact,sampleLowerBody('walking',0.8).right.contact);
});
test('step-up places both feet on the platform and returns continuously',()=>{
 const top=sampleLowerBody('stairs',0.5),start=sampleLowerBody('stairs',0);
 for(const leg of [top.left,top.right])assert.ok(Math.abs(leg.ankle.height-ANKLE_HEIGHT-STEP_HEIGHT)<1e-8);
 assert.ok(top.hip.height>start.hip.height);
 for(const activity of ['walking','squat','stairs']){
  const a=sampleLowerBody(activity,1-1e-7),b=sampleLowerBody(activity,1e-7);
  assert.ok(dist(a.hip,b.hip)<1e-5);assert.ok(dist(a.left.ankle,b.left.ankle)<1e-5);assert.ok(dist(a.right.ankle,b.right.ankle)<1e-5);
 }
});
test('detailed knee frame rotates the femur and reconstructs the planted or swinging ankle',()=>{
 for(const activity of ['walking','squat','stairs'])for(let i=0;i<100;i++){
  const pose=sampleLowerBody(activity,i/100);
  for(const leg of [pose.left,pose.right]){
   const thigh=Math.atan2(leg.hip.forward-leg.knee.forward,leg.hip.height-leg.knee.height);
   const shin=thigh+leg.flexion*Math.PI/180;
   const ankle={forward:leg.knee.forward-SHIN*Math.sin(shin),height:leg.knee.height-SHIN*Math.cos(shin)};
   assert.ok(dist(ankle,leg.ankle)<1e-5);
  }
 }
});
