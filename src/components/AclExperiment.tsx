import { Suspense, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Html, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { aclOrigin, attachmentAt, pullDirection, responseAt, solveAnteriorPull, experimentParameters } from "../anatomy/aclExperiment";
import { pivot } from "../anatomy/motion";
import { useVisibleCanvas } from "../hooks/useVisibleCanvas";

type Trial = ReturnType<typeof solveAnteriorPull>;
function TrialModel({ flexion, result, intact, offset }: { flexion: number; result: Trial; intact: boolean; offset: number }) {
  const viewport = useThree(state => state.viewport);
  const { scene } = useGLTF(`${import.meta.env.BASE_URL}models/knee.glb`);
  const model = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const annotation = /enthesis|condyle|surface|fossa|point|perichondular/i.test(object.name);
      object.visible = !annotation && /femur|tibia|fibula|patella/i.test(object.name) && !/cartilage/i.test(object.name);
      object.userData.restPosition = object.position.clone();
      object.userData.restRotation = object.rotation.clone();
      if (!object.visible) return;
      object.material = new THREE.MeshStandardMaterial({ color: "#dce3f5", roughness: 0.6, transparent: true, opacity: 0.33, depthWrite: false, side: THREE.DoubleSide,
        clippingPlanes: [new THREE.Plane(new THREE.Vector3(0, 1, 0), 1.13), new THREE.Plane(new THREE.Vector3(0, -1, 0), 1.13)] });
    });
    return clone;
  }, [scene]);
  useEffect(() => () => model.traverse((object) => {
    if (object instanceof THREE.Mesh && object.visible) (object.material as THREE.Material).dispose();
  }), [model]);
  useLayoutEffect(() => {
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !object.visible) return;
      const lower = /tibia|fibula/i.test(object.name);
      const angle = THREE.MathUtils.degToRad(flexion * (lower ? 1 : /patella/i.test(object.name) ? 0.62 : 0));
      const shift = pivot.clone().sub(pivot.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), angle));
      object.position.copy(object.userData.restPosition).add(shift);
      if (lower) object.position.add(pullDirection(flexion).multiplyScalar(result.displacement / 1000));
      object.rotation.copy(object.userData.restRotation);
      object.rotation.x += angle;
    });
  }, [model, flexion, result.displacement]);
  const insertion = attachmentAt(flexion, result.displacement);
  const restInsertion = attachmentAt(flexion);
  const geometries = useMemo(() => {
    const end = attachmentAt(flexion, result.displacement);
    const curve = new THREE.CatmullRomCurve3([aclOrigin, aclOrigin.clone().lerp(end, 0.5), end]);
    const intervals = intact ? [[0, 1]] : [[0, 0.4], [0.62, 1]];
    return intervals.map(([a,b]) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([curve.getPoint(a), curve.getPoint((a+b)/2), curve.getPoint(b)]), 32, 0.003, 12, false));
  }, [flexion, result.displacement, intact]);
  useEffect(() => () => geometries.forEach(g => g.dispose()), [geometries]);
  const color = intact ? "#f0cf86" : "#ff7794";
  return <group position={[offset * viewport.width / 4, 0, 0]} rotation={[0, -0.7, 0]} scale={Math.min(13, viewport.width * 2.4)}>
    <group position={pivot.clone().multiplyScalar(-1)}>
      <primitive object={model} dispose={null} />
      {geometries.map((geometry, i) => <mesh key={i} geometry={geometry}><meshStandardMaterial color={color} roughness={0.4} /></mesh>)}
      {[aclOrigin, insertion].map((point, i) => <mesh key={i} position={point}><sphereGeometry args={[0.0042, 16, 12]} /><meshBasicMaterial color={color} /></mesh>)}
      <mesh position={restInsertion}><sphereGeometry args={[0.0045, 16, 12]} /><meshBasicMaterial color="#8fb5ff" wireframe /></mesh>
      <arrowHelper args={[pullDirection(flexion), new THREE.Vector3(0.21, -0.48, 0.015), 0.06, "#69d2ff", 0.012, 0.008]} />
    </group>
  </group>;
}

function ForceChart({ flexion, force, intact, torn }: { flexion: number; force: number; intact: Trial; torn: Trial }) {
  const x = (f: number) => 42 + f / 150 * 470;
  const y = (d: number) => 190 - d / 16 * 162;
  const path = (connected: boolean) => Array.from({ length: 76 }, (_, i) => `${i ? "L" : "M"}${x(i*2)},${y(solveAnteriorPull(i*2, flexion, connected).displacement)}`).join(" ");
  return <svg className="acl-chart" viewBox="0 0 550 235" role="img" aria-label={`Applied force versus anterior displacement. At ${force} newtons: intact ${intact.displacement.toFixed(1)} millimetres, torn ${torn.displacement.toFixed(1)} millimetres.`}>
    {[0,4,8,12,16].map(d => <g key={d}><line x1="42" x2="512" y1={y(d)} y2={y(d)} stroke="#ffffff14" /><text x="32" y={y(d)+4} textAnchor="end">{d}</text></g>)}
    {[0,50,100,150].map(f => <text key={f} x={x(f)} y="209" textAnchor="middle">{f}</text>)}
    <text x="42" y="16">Anterior displacement (mm)</text><text x="512" y="230" textAnchor="end">Applied force (N)</text>
    <path d={path(true)} fill="none" stroke="#f0cf86" strokeWidth="3" /><path d={path(false)} fill="none" stroke="#ff7794" strokeWidth="3" />
    <line x1={x(force)} x2={x(force)} y1="28" y2="190" stroke="#8fb5ff" strokeDasharray="4 4" />
    <circle cx={x(force)} cy={y(intact.displacement)} r="5" fill="#f0cf86" /><circle cx={x(force)} cy={y(torn.displacement)} r="5" fill="#ff7794" />
  </svg>;
}

export default function AclExperiment() {
  const [force, setForce] = useState(80);
  const [flexion, setFlexion] = useState(20);
  const { ref, visible } = useVisibleCanvas("200px");
  const intact = solveAnteriorPull(force, flexion, true);
  const torn = solveAnteriorPull(force, flexion, false);
  const baselineLength = responseAt(0, flexion, true).length;
  return <section id="experiment" className="acl-experiment">
    <div className="acl-heading"><div><p className="kicker">STABILITY LAB / EXPERIMENT 01</p><h2>Same pull.<br />Different restraint.</h2></div><p>Hold the femur still. Pull the tibia forward. Explore how an intact ACL adds restraint, and how its attachments move with knee flexion.</p></div>
    <div className="acl-layout"><div className="acl-visual">
      <div className="acl-results">{[{ label: "INTACT ACL", trial: intact, className: "intact" }, { label: "TORN ACL", trial: torn, className: "torn" }].map(item => <div key={item.label} className={item.className}><span>{item.label}</span><strong>{item.trial.displacement.toFixed(1)}<small> mm</small></strong><p>Anterior displacement</p></div>)}</div>
      <div ref={ref} className="acl-canvas" role="img" aria-label="Side-by-side educational 3D comparison of intact and torn ACL under the same anterior pull">
        {visible && <Canvas orthographic camera={{ position: [0, 0, 6], zoom: 100, near: 0.1, far: 30 }} dpr={[1, 1.5]} gl={{ antialias: true, localClippingEnabled: true }} frameloop="demand">
          <ambientLight intensity={1.5} /><directionalLight position={[2, 3, 5]} intensity={2} />
          <Suspense fallback={<Html center>Preparing experiment…</Html>}><TrialModel flexion={flexion} result={intact} intact offset={-1} /><TrialModel flexion={flexion} result={torn} intact={false} offset={1} /></Suspense>
        </Canvas>}
      </div>
      <p className="acl-key">● Attachment landmarks · <span>○ Unloaded tibial landmark</span> · Cyan arrow: anterior pull</p>
      <p className="acl-caption">Femur fixed · Same flexion and force · Joint detail cropped for visibility</p>
    </div><div className="acl-controls">
      <label htmlFor="acl-force">Anterior pull <strong>{force} N</strong></label><input id="acl-force" type="range" min="0" max="150" step="1" value={force} onChange={e => setForce(Number(e.target.value))} /><div className="acl-range"><span>NO PULL</span><span>150 N</span></div>
      <label htmlFor="acl-flexion">Knee flexion <strong>{flexion}°</strong></label><input id="acl-flexion" type="range" min="0" max="60" step="1" value={flexion} onChange={e => setFlexion(Number(e.target.value))} /><div className="acl-range"><span>EXTENDED</span><span>60°</span></div>
      <div className="acl-readouts"><p>Intact ACL tension <strong>{intact.tension.toFixed(1)} N</strong></p><p>ACL endpoint distance <strong>{intact.length.toFixed(1)} mm</strong></p><p>Unloaded distance at {flexion}° <strong>{baselineLength.toFixed(1)} mm</strong></p></div>
      <button type="button" className="acl-reset" onClick={() => { setForce(80); setFlexion(20); }}>Reset experiment ↺</button>
      <p className="acl-observation">{force === 0 ? "No pull: both models share the same unloaded pose." : "The torn ACL carries no force here. The remaining restraint still resists the pull, so the tibia does not move freely."}</p>
    </div></div>
    <div className="acl-bottom"><div><div className="acl-chart-key"><span>● Intact ACL</span><span>● Torn ACL</span></div><ForceChart flexion={flexion} force={force} intact={intact} torn={torn} /></div><details><summary>How this teaching model works</summary><p>One degree of freedom: anterior tibial translation along the tibia’s local anterior axis. The pull direction rotates with the tibia. A prescribed hinge sets flexion; landmarks follow the bones. The solver balances the applied force against an ACL tension-only spring plus an aggregate spring representing other restraints. Both trials use identical parameters except ACL continuity.</p><p>Illustrative parameters: remaining restraint = {experimentParameters.otherStiffness}d + {experimentParameters.otherCubic}d³ N (d in mm); ACL stiffness = {experimentParameters.aclStiffness} N/mm with a {experimentParameters.toeLength} mm toe region. ACL tension is projected onto the pull direction.</p><p>The unloaded ACL length is reset at each flexion angle. This does not predict physiological flexion-dependent tension. Landmarks are approximate; no bone contact, wrapping, muscle forces, or patient calibration is included. Endpoint distance is not measured tissue strain. The split ligament illustrates discontinuity; torn stumps are not simulated.</p><p>All numbers are outputs of this unvalidated teaching model, not clinical measurements or injury thresholds.</p><a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC4876308/" target="_blank" rel="noreferrer">Further reading: Open Knee biomechanics ↗</a></details></div>
  </section>;
}
