import { useLanguage } from "../i18n/Language";
import { Component, type ReactNode, Suspense, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Html, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { aclOrigin, attachmentAt, pullDirection, responseAt, solveAnteriorPull, experimentParameters } from "../anatomy/aclExperiment";
import { pivot } from "../anatomy/motion";
import { useVisibleCanvas } from "../hooks/useVisibleCanvas";
type Trial = ReturnType<typeof solveAnteriorPull>;
function TrialModel({ flexion, result, intact, offset }: {
    flexion: number;
    result: Trial;
    intact: boolean;
    offset: number;
}) {
    const { t } = useLanguage();
    const viewport = useThree(state => state.viewport);
    const { scene } = useGLTF(`${import.meta.env.BASE_URL}models/knee.glb`);
    const model = useMemo(() => {
        const clone = scene.clone(true);
        clone.traverse((object) => {
            if (!(object instanceof THREE.Mesh))
                return;
            const annotation = /enthesis|condyle|surface|fossa|point|perichondular/i.test(object.name);
            object.visible = !annotation && /femur|tibia|fibula|patella/i.test(object.name) && !/cartilage/i.test(object.name);
            object.userData.restPosition = object.position.clone();
            object.userData.restRotation = object.rotation.clone();
            if (!object.visible)
                return;
            object.material = new THREE.MeshStandardMaterial({ color: "#dce3f5", roughness: 0.6, transparent: true, opacity: 0.33, depthWrite: false, side: THREE.DoubleSide,
                clippingPlanes: [new THREE.Plane(new THREE.Vector3(0, 1, 0), 1.13), new THREE.Plane(new THREE.Vector3(0, -1, 0), 1.13)] });
        });
        return clone;
    }, [scene]);
    useEffect(() => () => model.traverse((object) => {
        if (object instanceof THREE.Mesh && object.visible)
            (object.material as THREE.Material).dispose();
    }), [model]);
    useLayoutEffect(() => {
        model.traverse((object) => {
            if (!(object instanceof THREE.Mesh) || !object.visible)
                return;
            const lower = /tibia|fibula/i.test(object.name);
            const angle = THREE.MathUtils.degToRad(flexion * (lower ? 1 : /patella/i.test(object.name) ? 0.62 : 0));
            const shift = pivot.clone().sub(pivot.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), angle));
            object.position.copy(object.userData.restPosition).add(shift);
            if (lower)
                object.position.add(pullDirection(flexion).multiplyScalar(result.displacement / 1000));
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
        return intervals.map(([a, b]) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([curve.getPoint(a), curve.getPoint((a + b) / 2), curve.getPoint(b)]), 32, 0.003, 12, false));
    }, [flexion, result.displacement, intact]);
    useEffect(() => () => geometries.forEach(g => g.dispose()), [geometries]);
    const color = intact ? "#f0cf86" : "#ff7794";
    return <group position={[offset * viewport.width / 4, 0, 0]} rotation={[0, -0.7, 0]} scale={Math.min(13, viewport.width * 2.4)}>
    <group position={pivot.clone().multiplyScalar(-1)}>
      <primitive object={model} dispose={null}/>
      {geometries.map((geometry, i) => <mesh key={i} geometry={geometry}><meshStandardMaterial color={color} roughness={0.4}/></mesh>)}
      {[aclOrigin, insertion].map((point, i) => <mesh key={i} position={point}><sphereGeometry args={[0.0042, 16, 12]}/><meshBasicMaterial color={color}/></mesh>)}
      <mesh position={restInsertion}><sphereGeometry args={[0.0045, 16, 12]}/><meshBasicMaterial color="#8fb5ff" wireframe/></mesh>
      <arrowHelper args={[pullDirection(flexion), new THREE.Vector3(0.21, -0.48, 0.015), 0.06, "#69d2ff", 0.012, 0.008]}/>
    </group>
  </group>;
}
class ModelBoundary extends Component<{
    children: ReactNode;
    fallback: ReactNode;
}, {
    failed: boolean;
}> {
    state = { failed: false };
    static getDerivedStateFromError() { return { failed: true }; }
    render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
function Diagram({ flexion, intact, torn }: {
    flexion: number;
    intact: Trial;
    torn: Trial;
}) {
    const { t } = useLanguage();
    const project = (point: THREE.Vector3) => ({ x: 145 + (point.z - pivot.z) * 1300, y: 125 - (point.y - pivot.y) * 1300 });
    const start = project(aclOrigin);
    const base = project(attachmentAt(flexion));
    return <svg viewBox="0 0 600 280" className="acl-diagram" role="img" aria-label={t("Schematic side view: ACL landmarks follow flexion and tibial translation. Bone outlines are illustrative.")}>
    <defs><marker id="acl-pull-tip" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6" fill="#69d2ff"/></marker></defs>
    {[intact, torn].map((result, index) => {
            const end = project(attachmentAt(flexion, result.displacement));
            const shift = pullDirection(flexion).multiplyScalar(result.displacement * 1.3);
            const color = index === 0 ? '#f0cf86' : '#ff7794';
            const mid = { x: start.x + (end.x - start.x) * 0.4, y: start.y + (end.y - start.y) * 0.4 };
            const tip = { x: start.x + (end.x - start.x) * 0.62, y: start.y + (end.y - start.y) * 0.62 };
            return <g key={index} transform={`translate(${index * 300},0)`}>
        <path d="M118 15 L118 76 C96 91 105 123 127 125 C145 131 152 113 165 122 C188 125 198 101 176 80 L171 15" fill="#b7c4e321" stroke="#b7c4e3" strokeWidth="2"/>
        <g transform={`translate(${shift.z},${-shift.y}) rotate(${flexion},145,125)`}>
          <path d="M106 137 Q145 127 187 138 L179 166 L165 169 L164 260 L123 260 L121 170 L108 166 Z" fill="#b7c4e321" stroke="#b7c4e3" strokeWidth="2"/>
        </g>
        <circle cx={base.x} cy={base.y} r="6" fill="none" stroke="#8fb5ff" strokeDasharray="2 2"/>
        {index === 0 ? <path d={`M${start.x},${start.y} L${end.x},${end.y}`} stroke={color} strokeWidth="7" strokeLinecap="round"/> : <path d={`M${start.x},${start.y} L${mid.x},${mid.y} M${tip.x},${tip.y} L${end.x},${end.y}`} stroke={color} strokeWidth="7" strokeLinecap="round"/>}
        {[start, end].map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="5" fill={color} stroke="#080c1b"/>)}
        <line x1="210" y1="155" x2={210 + 35 * Math.cos(flexion * Math.PI / 180)} y2={155 + 35 * Math.sin(flexion * Math.PI / 180)} stroke="#69d2ff" strokeWidth="2" markerEnd="url(#acl-pull-tip)"/>
        <text x="25" y="45" fill="#aab5cf" fontSize="10">{t("FEMUR")}</text><text x="210" y="230" fill="#aab5cf" fontSize="10">{t("TIBIA")}</text>
      </g>;
        })}
  </svg>;
}
function ForceChart({ flexion, force, intact, torn }: {
    flexion: number;
    force: number;
    intact: Trial;
    torn: Trial;
}) {
    const { t } = useLanguage();
    const x = (f: number) => 42 + f / 150 * 470;
    const y = (d: number) => 190 - d / 16 * 162;
    const path = (connected: boolean) => Array.from({ length: 76 }, (_, i) => `${i ? "L" : "M"}${x(i * 2)},${y(solveAnteriorPull(i * 2, flexion, connected).displacement)}`).join(" ");
    return <svg className="acl-chart" viewBox="0 0 550 235" role="img" aria-label={t(`Applied force versus anterior displacement. At ${force} newtons: intact ${intact.displacement.toFixed(1)} millimetres, torn ${torn.displacement.toFixed(1)} millimetres.`)}>
    {[0, 4, 8, 12, 16].map(d => <g key={d}><line x1="42" x2="512" y1={y(d)} y2={y(d)} stroke="#ffffff14"/><text x="32" y={y(d) + 4} textAnchor="end">{t(d)}</text></g>)}
    {[0, 50, 100, 150].map(f => <text key={f} x={x(f)} y="209" textAnchor="middle">{t(f)}</text>)}
    <text x="42" y="16">{t("Anterior displacement (mm)")}</text><text x="512" y="230" textAnchor="end">{t("Applied force (N)")}</text>
    <path d={path(true)} fill="none" stroke="#f0cf86" strokeWidth="3"/><path d={path(false)} fill="none" stroke="#ff7794" strokeWidth="3"/>
    <line x1={x(force)} x2={x(force)} y1="28" y2="190" stroke="#8fb5ff" strokeDasharray="4 4"/>
    <circle cx={x(force)} cy={y(intact.displacement)} r="5" fill="#f0cf86"/><circle cx={x(force)} cy={y(torn.displacement)} r="5" fill="#ff7794"/>
  </svg>;
}
export default function AclExperiment() {
    const { t } = useLanguage();
    const [view, setView] = useState<"3d" | "diagram">("3d");
    const [force, setForce] = useState(80);
    const [flexion, setFlexion] = useState(20);
    const { ref, visible } = useVisibleCanvas("200px");
    const intact = solveAnteriorPull(force, flexion, true);
    const torn = solveAnteriorPull(force, flexion, false);
    const baselineLength = responseAt(0, flexion, true).length;
    return <section id="experiment" className="acl-experiment">
    <div className="acl-heading"><div><p className="kicker">{t("STABILITY LAB / EXPERIMENT 01")}</p><h2>{t("Same pull.")}<br />{t("Different restraint.")}</h2></div><p>{t("Hold the femur still. Pull the tibia forward. Explore how an intact ACL adds restraint, and how its attachments move with knee flexion.")}</p></div>
    <div className="acl-science-note"><strong>{t("Lachman-inspired anterior laxity experiment")}</strong><p>{t("At approximately 20\u201330\u00B0 of flexion, stabilizing the femur and drawing the tibia anteriorly follows the principle of the Lachman test. The anterior drawer test is usually performed at about 90\u00B0 and is not reproduced by this 0\u201360\u00B0 demo. ")}<a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC5997333/" target="_blank" rel="noreferrer">{t("Clinical study \u2197")}</a></p><p className="acl-evidence-status">{t("Documented clinical principle \u00B7 Illustrative simulation values \u00B7 Not fitted to experimental measurements")}</p></div>
    <div className="acl-layout"><div className="acl-visual">
      <div className="acl-results">{[{ label: "INTACT ACL", trial: intact, className: "intact" }, { label: "TORN ACL", trial: torn, className: "torn" }].map(item => <div key={item.label} className={item.className}><span>{t(item.label)}</span><strong>{t(item.trial.displacement.toFixed(1))}<small>{t(" mm")}</small></strong><p>{t("Anterior displacement")}</p></div>)}</div>
      <div className="acl-view-switch" role="group" aria-label={t("Experiment view")}><button type="button" aria-pressed={view === "3d"} onClick={() => setView("3d")}>{t("3D anatomy")}</button><button type="button" aria-pressed={view === "diagram"} onClick={() => setView("diagram")}>{t("2D diagram")}</button></div>
      <div ref={ref} className="acl-canvas" role="img" aria-label={t("Side-by-side educational 3D comparison of intact and torn ACL under the same anterior pull")}>
        {view === "diagram" ? <Diagram flexion={flexion} intact={intact} torn={torn}/> : visible && <ModelBoundary fallback={<><p className="acl-fallback">{t("3D unavailable on this device \u00B7 Showing a schematic")}</p><Diagram flexion={flexion} intact={intact} torn={torn}/></>}><Canvas orthographic camera={{ position: [0, 0, 6], zoom: 100, near: 0.1, far: 30 }} dpr={[1, 1.5]} gl={{ antialias: true, localClippingEnabled: true }} frameloop="demand">
          <ambientLight intensity={1.5}/><directionalLight position={[2, 3, 5]} intensity={2}/>
          <Suspense fallback={<Html center>{t("Preparing experiment\u2026")}</Html>}><TrialModel flexion={flexion} result={intact} intact offset={-1}/><TrialModel flexion={flexion} result={torn} intact={false} offset={1}/></Suspense>
        </Canvas></ModelBoundary>}
      </div>
      <p className="acl-key">{t("\u25CF Attachment landmarks \u00B7 ")}<span>{t("\u25CB Unloaded tibial landmark")}</span>{t(" \u00B7 Cyan arrow: anterior pull")}</p>
      <p className="acl-caption">{t("Femur fixed \u00B7 Same flexion and force \u00B7 Joint detail cropped \u00B7 Diagram outlines are schematic")}</p>
    </div><div className="acl-controls">
      <label htmlFor="acl-force">{t("Anterior pull ")}<strong>{t(force)}{t(" N")}</strong></label><input id="acl-force" type="range" min="0" max="150" step="1" value={force} onChange={e => setForce(Number(e.target.value))}/><div className="acl-range"><span>{t("NO PULL")}</span><span>{t("150 N")}</span></div>
      <label htmlFor="acl-flexion">{t("Knee flexion ")}<strong>{t(flexion)}{t("\u00B0")}</strong></label><input id="acl-flexion" type="range" min="0" max="60" step="1" value={flexion} onChange={e => setFlexion(Number(e.target.value))}/><div className="acl-range"><span>{t("EXTENDED")}</span><span>{t("60\u00B0")}</span></div>
      <button type="button" className="acl-reset" onClick={() => setFlexion(25)}>{t("Lachman position \u00B7 25\u00B0")}</button>
      <div className="acl-readouts"><p>{t("Intact ACL tension ")}<strong>{t(intact.tension.toFixed(1))}{t(" N")}</strong></p><p>{t("ACL endpoint distance ")}<strong>{t(intact.length.toFixed(1))}{t(" mm")}</strong></p><p>{t("Unloaded distance at ")}{t(flexion)}{t("\u00B0 ")}<strong>{t(baselineLength.toFixed(1))}{t(" mm")}</strong></p></div>
      <button type="button" className="acl-reset" onClick={() => { setForce(80); setFlexion(20); }}>{t("Reset experiment \u21BA")}</button>
      <p className="acl-observation">{t(force === 0 ? "No pull: both models share the same unloaded pose." : "The torn ACL carries no force here. The remaining restraint still resists the pull, so the tibia does not move freely.")}</p>
    </div></div>
    <div className="acl-bottom"><div><p className="acl-output-label">{t("SIMULATION OUTPUT \u00B7 NOT EXPERIMENTAL DATA")}</p><div className="acl-chart-key"><span>{t("\u25CF Intact ACL")}</span><span>{t("\u25CF Torn ACL")}</span></div><ForceChart flexion={flexion} force={force} intact={intact} torn={torn}/></div><details><summary>{t("How this teaching model works")}</summary><p>{t("One degree of freedom: anterior tibial translation along the tibia\u2019s local anterior axis. The pull direction rotates with the tibia. A prescribed hinge sets flexion; landmarks follow the bones. The solver balances the applied force against an ACL tension-only spring plus an aggregate spring representing other restraints. Both trials use identical parameters except ACL continuity.")}</p><p>{t("Illustrative parameters: remaining restraint = ")}{t(experimentParameters.otherStiffness)}{t("d + ")}{t(experimentParameters.otherCubic)}{t("d\u00B3 N (d in mm); ACL stiffness = ")}{t(experimentParameters.aclStiffness)}{t(" N/mm with a ")}{t(experimentParameters.toeLength)}{t(" mm toe region. ACL tension is projected onto the pull direction.")}</p><p>{t("The unloaded ACL length is reset at each flexion angle. This does not predict physiological flexion-dependent tension. Landmarks are approximate; no bone contact, wrapping, muscle forces, or patient calibration is included. Endpoint distance is not measured tissue strain. The split ligament illustrates discontinuity; torn stumps are not simulated.")}</p><p>{t("All numbers are outputs of this unvalidated teaching model, not clinical measurements or injury thresholds.")}</p><a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC4876308/" target="_blank" rel="noreferrer">{t("Further reading: Open Knee biomechanics \u2197")}</a></details></div>
    <div className="acl-evidence">
      <div className="acl-evidence-heading"><p className="kicker">{t("SCIENTIFIC BASIS & PUBLIC DATA")}</p><h3>{t("Evidence behind the experiment.")}</h3><p>{t("Real experiments measure load and tibial motion. These sources support the test principle and offer data for future calibration. Their measurements have not been imported into the curves above.")}</p></div>
      <div className="acl-source-grid">
        <article><span>{t("01 / CLINICAL PRINCIPLE")}</span><h4>{t("Lachman & anterior drawer")}</h4><p>{t("A clinical diagnostic study describes Lachman testing at 15\u201330\u00B0 and anterior drawer testing at 90\u00B0. Our demo illustrates anterior restraint; it does not reproduce the full examination or provide a diagnostic grade.")}</p><a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC5997333/" target="_blank" rel="noreferrer">{t("Read the clinical study \u2197")}</a></article>
        <article><span>{t("02 / EXPERIMENTAL DATA")}</span><h4>{t("Natural Knee Data \u00B7 University of Denver")}</h4><p>{t("Measured loads, joint motion and ligament attachment landmarks.")}</p><details className="acl-source-details"><summary>{t("Protocol & limitations")}</summary><p>{t("Cadaveric knee laxity data: measured loads, six-degree-of-freedom motion, processed spreadsheets, and digitized ACL/PCL/MCL/LCL attachment points. Includes intact and cruciate-resected conditions; resection protocols must be checked before any ACL-only comparison.")}</p></details><p className="acl-source-meta">{t("Public access \u00B7 Non-commercial reuse under the repository agreement \u00B7 Citation required")}</p><a href="https://digitalcommons.du.edu/natural_knee_data/6/" target="_blank" rel="noreferrer">{t("DU03 dataset & download links \u2197")}</a><a href="https://doi.org/10.1115/1.4033882" target="_blank" rel="noreferrer">{t("Harris et al., 2016 \u00B7 Methods \u2197")}</a></article>
        <article><span>{t("03 / EXPERIMENTAL DATA + MODELS")}</span><h4>{t("Open Knee(s) \u00B7 Cleveland Clinic")}</h4><p>{t("Robotic loading tests at four flexion angles, with specimen geometry and models.")}</p><details className="acl-source-details"><summary>{t("Protocol & limitations")}</summary><p>{t("Robotic joint tests include anterior\u2013posterior loading up to \u00B1100 N at 0\u00B0, 30\u00B0, 60\u00B0, and 90\u00B0. Also provides specimen geometry and finite element models. Suitable for studying load\u2013motion relationships; these are specimen-specific experiments, not universal normal values.")}</p></details><p className="acl-source-meta">{t("Project lists CC BY 4.0 \u00B7 Check the selected release\u2019s terms")}</p><a href="https://simtk.org/projects/openknee" target="_blank" rel="noreferrer">{t("Open Knee(s) project \u2197")}</a><a href="https://doi.org/10.1007/s10439-022-03074-0" target="_blank" rel="noreferrer">{t("Chokhandre et al., 2023 \u00B7 Protocol \u2197")}</a></article>
        <article><span>{t("04 / EXPERIMENTAL DATA + SIMULATIONS")}</span><h4>{t("Dryad \u00B7 Specimen S192803")}</h4><p>{t("Experimental laxity measurements, processing code and separate simulation results.")}</p><details className="acl-source-details"><summary>{t("Protocol & limitations")}</summary><p>{t("Includes robotic and knee laxity apparatus measurements, plus models and processing code. The data description lists anterior loading trials at 30\u00B0 with 0\u201340 lb settings. Experimental Dynamics_Data and simulated Results are separate; simulation CSVs must not be presented as measurements.")}</p></details><p className="acl-source-meta">{t("Andreassen et al., 2024 \u00B7 DOI: 10.5061/dryad.zkh1893gw \u00B7 See dataset reuse terms")}</p><a href="https://datadryad.org/dataset/doi:10.5061/dryad.zkh1893gw" target="_blank" rel="noreferrer">{t("Dataset, README & files \u2197")}</a></article>
      </div>
    </div>
  </section>;
}
