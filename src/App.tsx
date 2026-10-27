import { KneeModel, type KneeModelProps } from "./components/KneeAnatomy";
import LowerBodyMotion from "./components/LowerBodyMotion";
import { sampleLowerBody } from "./anatomy/lowerBody";
import { useLanguage, LanguageToggle } from "./i18n/Language";
import { Suspense, memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Bounds, Html, OrbitControls, Sparkles, useGLTF } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import * as THREE from "three";
import { anatomyEntities, entityById, movementPresets, structureByKey, structures, type AclState, type MuscleScope, type MovementPreset, type StructureKey, } from "./anatomy/data";
import { usePerformanceMode } from "./hooks/usePerformanceMode";
import { useVisibleCanvas } from "./hooks/useVisibleCanvas";
import AclExperiment from "./components/AclExperiment";
gsap.registerPlugin(ScrollTrigger);
const MOTION_DURATION_SCALE = 3;
function JointActivityFrame({rotationSource, children}: {rotationSource?: {current:number}; children: React.ReactNode}) {
    const group = useRef<THREE.Group>(null);
    useFrame(() => { if (group.current) group.current.rotation.z = rotationSource?.current ?? 0; }, -2);
    return <group ref={group}>{children}</group>;
}
const Scene = memo(function Scene({ stableView = false, lockRotation = false, thighRotationSource, ...props }: KneeModelProps & {
    stableView?: boolean;
    lockRotation?: boolean;
    thighRotationSource?: {current:number};
}) {
    const { t } = useLanguage();
    const performanceMode = usePerformanceMode();
    const { ref, visible } = useVisibleCanvas("320px 0px");
    return (<div ref={ref} className="scene-frame" data-quality={performanceMode}>
      {visible && <Canvas camera={{ position: [0.2, 0.05, 3.9], fov: 30 }} dpr={performanceMode === "reduced" ? [1, 1.25] : [1, 1.5]} frameloop="always" gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}>
        <ambientLight intensity={0.85}/>
        <hemisphereLight args={["#f3f6ff", "#343047", 1.25]}/>
        <directionalLight position={[3, 4, 5]} intensity={2.8} color="#f4f6ff"/>
        <directionalLight position={[-4, 1, -3]} intensity={1.4} color="#c7dcff"/>
        <pointLight position={[0, -2, 2]} intensity={0.8} color="#d9cbff"/>
        {!stableView && <Sparkles count={performanceMode === "reduced" ? 20 : 75} scale={[3.2, 4.4, 2]} size={1.35} speed={0.18} opacity={0.35} color="#8fb5ff"/>}
        <Suspense fallback={<Html center><div className="model-loading">{t("Preparing anatomy")}</div></Html>}>
          <Bounds fit clip margin={1.22} maxDuration={0}>
            <JointActivityFrame rotationSource={thighRotationSource}><KneeModel {...props}/></JointActivityFrame>
          </Bounds>
        </Suspense>
        <OrbitControls makeDefault enablePan={false} enableZoom enableRotate={!lockRotation} minDistance={2.4} maxDistance={6} enableDamping dampingFactor={0.065} rotateSpeed={0.48} zoomSpeed={0.7} minPolarAngle={Math.PI * 0.25} maxPolarAngle={Math.PI * 0.75} minAzimuthAngle={-Math.PI * 0.72} maxAzimuthAngle={Math.PI * 0.72} mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }} touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }} onStart={() => {
                if (!lockRotation)
                    document.body.classList.add("is-orbiting");
            }} onEnd={() => document.body.classList.remove("is-orbiting")}/>
      </Canvas>}
    </div>);
});
function Icon({ name }: {
    name: "layers" | "scan";
}) {
    const { t } = useLanguage();
    if (name === "scan") {
        return (<svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16"/>
      </svg>);
    }
    return (<svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m12 3 8 4.5-8 4.5-8-4.5L12 3ZM4 12l8 4.5 8-4.5M4 16.5l8 4.5 8-4.5"/>
    </svg>);
}
const quizOptions = [
    { label: "Menisci", correct: true },
    { label: "Patella", correct: false },
    { label: "Fibula", correct: false },
];
export default function App() {
    const { t, language } = useLanguage();
    useEffect(() => {
        const frame = requestAnimationFrame(() => ScrollTrigger.refresh());
        return () => cancelAnimationFrame(frame);
    }, [language]);
    const root = useRef<HTMLDivElement>(null);
    const stage = useRef<HTMLElement>(null);
    const motionFlexion = useRef(0);
    const motionPhase = useRef(0);
    const motionThighAngle = useRef(0);
    const [motionView, setMotionView] = useState<"body" | "knee">("knee");
    const [selected, setSelected] = useState<StructureKey>("all");
    const [selectedEntity, setSelectedEntity] = useState<string | null>(null);
    const [xray, setXray] = useState(false);
    const [exploded, setExploded] = useState(false);
    const [flexion, setFlexion] = useState(0);
    const [hovered, setHoveredState] = useState<string | null>(null);
    const hoverClearFrame = useRef<number | null>(null);
    const setHovered = useCallback((label: string | null) => {
        if (hoverClearFrame.current !== null)
            cancelAnimationFrame(hoverClearFrame.current);
        hoverClearFrame.current = null;
        if (label !== null)
            setHoveredState(label);
        else
            hoverClearFrame.current = requestAnimationFrame(() => {
                setHoveredState(null);
                hoverClearFrame.current = null;
            });
    }, []);
    useEffect(() => () => {
        if (hoverClearFrame.current !== null)
            cancelAnimationFrame(hoverClearFrame.current);
    }, []);
    const [quizAnswer, setQuizAnswer] = useState<boolean | null>(null);
    const [showLabels, setShowLabels] = useState(true);
    const [tensionMap, setTensionMap] = useState(false);
    const [aclState, setAclState] = useState<AclState>("normal");
    const [muscleScope, setMuscleScope] = useState<MuscleScope>("knee");
    const [layerProgress, setLayerProgress] = useState(0);
    const [layerIndex, setLayerIndex] = useState(0);
    const [movementId, setMovementId] = useState<MovementPreset["id"]>("manual");
    const performanceMode = usePerformanceMode();
    const active = structureByKey[selected];
    const activeEntity = selectedEntity ? entityById[selectedEntity] : null;
    const activeMovement = movementPresets.find((item) => item.id === movementId) ?? movementPresets[0];
    const layerStructures = structures.slice(1);
    const layerSelected = layerStructures[layerIndex].key;
    useLayoutEffect(() => {
        const context = gsap.context(() => {
            gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((element) => {
                gsap.fromTo(element, { y: 48, opacity: 0 }, {
                    y: 0,
                    opacity: 1,
                    duration: 1,
                    ease: "power3.out",
                    scrollTrigger: { trigger: element, start: "top 86%", once: true },
                });
            });
            // Match the active tissue to the card at the viewport reading line.
            // A percentage of the whole section drifts away from the actual cards.
            const cards = gsap.utils.toArray<HTMLElement>(".anatomy-grid article");
            const updateLayer = () => {
                const readingLine = window.innerHeight * 0.6;
                let closest = 0;
                let distance = Infinity;
                cards.forEach((card, index) => {
                    const rect = card.getBoundingClientRect();
                    const nextDistance = Math.abs((rect.top + rect.bottom) / 2 - readingLine);
                    if (nextDistance < distance) {
                        distance = nextDistance;
                        closest = index;
                    }
                });
                setLayerIndex(closest);
            };
            ScrollTrigger.create({
                trigger: ".layer-explorer",
                start: "top 72%",
                end: "bottom 32%",
                scrub: true,
                onUpdate: (self) => {
                    setLayerProgress(self.progress);
                    updateLayer();
                },
                onRefresh: updateLayer,
            });
        }, root);
        return () => context.revert();
    }, []);
    useEffect(() => {
        const preset = movementPresets.find((item) => item.id === movementId);
        motionPhase.current = 0;
        motionThighAngle.current = 0;
        if (!preset || preset.id === "manual") return;
        if (performanceMode === "reduced") {
            const pose = sampleLowerBody(preset.id, 0);
            const angle = pose.left.flexion;
            motionThighAngle.current = Math.atan2(pose.hip.forward-pose.left.knee.forward, pose.hip.height-pose.left.knee.height);
            motionFlexion.current = angle;
            setFlexion(Math.round(angle));
            return;
        }
        let frame = 0;
        const startedAt = performance.now();
        let lastUpdate = 0;
        const duration = preset.duration * MOTION_DURATION_SCALE;
        const animate = (now: number) => {
            const elapsed = (now - startedAt) % duration;
            const progress = elapsed / duration;
            motionPhase.current = progress;
            const pose = sampleLowerBody(preset.id, progress);
            const angle = pose.left.flexion;
            motionThighAngle.current = Math.atan2(pose.hip.forward-pose.left.knee.forward, pose.hip.height-pose.left.knee.height);
            motionFlexion.current = angle;
            if (now - lastUpdate >= 100) {
                setFlexion(Math.round(angle));
                lastUpdate = now;
            }
            frame = requestAnimationFrame(animate);
        };
        frame = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(frame);
    }, [movementId, performanceMode]);
    const selectLayer = useCallback((key: StructureKey) => {
        setSelected(key);
        setSelectedEntity(null);
        setHovered(null);
    }, [setHovered]);
    const selectEntity = useCallback((id: string | null) => {
        setSelectedEntity(id);
        if (id)
            setSelected(entityById[id].layer);
    }, []);
    const updateScanner = (event: React.PointerEvent<HTMLElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        event.currentTarget.style.setProperty("--scan-x", `${event.clientX - rect.left}px`);
        event.currentTarget.style.setProperty("--scan-y", `${event.clientY - rect.top}px`);
    };
    return (<div ref={root} className="site-shell">
      <header className="topbar">
        <a className="brand" href="#explore" aria-label={t("Knee Lab, return to explorer")}>
          <span className="brand-mark" aria-hidden="true"/>{t("KNEE LAB")}</a>
        <nav aria-label={t("Primary navigation")}>
          <a href="#explore">{t("Explore")}</a>
          <a href="#motion">{t("Motion")}</a>
            <a href="#experiment">{t("Experiment")}</a>
          <a href="#learn">{t("Learn")}</a>
        </nav>
        <div className="header-tools"><span className="edition">{t("ANATOMY STUDY 001")}</span><LanguageToggle /></div>
      </header>

      <main>
        <section ref={stage} id="explore" className={`hero-stage${xray ? " is-xray" : ""}`} onPointerMove={updateScanner}>
          <div className="hero-copy">
            <p className="kicker">{t("INTERACTIVE ANATOMY")}</p>
            <h1>{t("Built to ")}<em>{t("bend.")}</em>
            </h1>
            <p className="intro">{t("Look beneath the surface of the human knee. Rotate the model, isolate each tissue and change the way the joint moves.")}</p>
            <div className="mouse-hint" aria-hidden="true">
              <span />{t(" Drag to rotate \u00B7 Scroll to zoom")}</div>
          </div>

          <div className="model-viewport" aria-label={t("Interactive three-dimensional model of a human knee")}>
            <Scene selected={selected} selectedEntity={selectedEntity} xray={xray} exploded={exploded} flexion={0} muscleScope={muscleScope} onSelect={selectLayer} onEntitySelect={selectEntity} onHover={setHovered}/>
            <div className="model-orbit orbit-one" aria-hidden="true"/>
            <div className="model-orbit orbit-two" aria-hidden="true"/>
            {hovered && <div className="hover-label">{t(hovered)}</div>}
          </div>

          <aside className="structure-panel" aria-live="polite">
            <p>{t(activeEntity ? `${active.eyebrow} / STRUCTURE` : active.eyebrow)}</p>
            <h2>{t(activeEntity?.shortLabel ?? active.label)}</h2>
            <div className="panel-rule"/>
            <p className="panel-description">{t(activeEntity?.role ?? active.description)}</p>
            {activeEntity ? (<div className="entity-evidence">
                <dl>
                  <div><dt>{t("Origin")}</dt><dd>{t(activeEntity.origin)}</dd></div>
                  <div><dt>{t("Insertion")}</dt><dd>{t(activeEntity.insertion)}</dd></div>
                </dl>
                <a href={activeEntity.sourceUrl} target="_blank" rel="noreferrer">{t(activeEntity.sourceLabel)}{t(" \u2197")}</a>
                <span>{t("Educational reconstruction \u00B7 not medical advice")}</span>
              </div>) : <p className="panel-fact">{t(active.fact)}</p>}
            {selected === "muscle" && !activeEntity && (<div className="origin-disclaimer">
                <span>{t("PROXIMAL PATHS ARE CROPPED")}</span>
                <p>{t("Rectus femoris continues to the pelvis; biceps femoris long head, semitendinosus and semimembranosus continue to the ischial tuberosity.")}</p>
              </div>)}
            {(selected === "ligament" || selected === "muscle") && (<div className="entity-picker" role="group" aria-label={t(`Choose an individual ${selected}`)}>
                <button type="button" className={!selectedEntity ? "active" : ""} onClick={() => setSelectedEntity(null)}>{t("All")}</button>
                {anatomyEntities.filter((entity) => entity.layer === selected).map((entity) => (<button key={entity.id} type="button" className={selectedEntity === entity.id ? "active" : ""} onClick={() => selectEntity(entity.id)}>
                    {t(entity.shortLabel)}
                  </button>))}
              </div>)}
          </aside>

          <div className="structure-tabs" role="group" aria-label={t("Choose anatomical layer")}>
            {structures.map((structure) => (<button key={structure.key} type="button" className={selected === structure.key ? "active" : ""} onClick={() => selectLayer(structure.key)}>
                <span className="tab-index">{t("0")}{t(structures.indexOf(structure) + 1)}</span>
                {t(structure.label)}
              </button>))}
          </div>

          <div className="view-tools" role="group" aria-label={t("Model view tools")}>
            <button type="button" className={xray ? "active" : ""} onClick={() => setXray((value) => !value)}>
              <Icon name="scan"/>{t(" X-ray")}</button>
            <button type="button" className={exploded ? "active" : ""} onClick={() => setExploded((value) => !value)}>
              <Icon name="layers"/>{t(" Explode")}</button>
            {selected === "muscle" && (<button type="button" className={muscleScope === "regional" ? "active" : ""} onClick={() => setMuscleScope((value) => value === "knee" ? "regional" : "knee")}>
                {t(muscleScope === "regional" ? "Regional on" : "Regional")}
              </button>)}
          </div>
          <div className="scanner" aria-hidden="true"/>
        </section>

        <section id="motion" className="motion-section">
          <div className="section-number">{t("02")}</div>
          <div className="motion-copy" data-reveal>
            <p className="kicker">{t("MOTION LAB")}</p>
            <h2>{t("Move it.")}<br />{t("See it respond.")}</h2>
            <p>{t("Explore how both legs coordinate at the hips, knees and ankles. Compare planted-foot squats, alternating walking steps and a step-up with a controlled return.")}</p>
          </div>

          <div className="motion-workbench" data-reveal style={{ "--motion-angle": `${Math.max(4, (flexion / 130) * 78)}deg` } as React.CSSProperties}>
            <div className="motion-visual">
              <div className="motion-visual-head">
                <span><i aria-hidden="true"/>{t(" LIVE MODEL")}</span>
                <span>{t(motionView === "body" ? "BOTH LEGS · HIP TO FOOT" : "KNEE DETAIL")}</span>
              </div>
              <div className="motion-view-tabs" role="group" aria-label={t("Movement view")}>
                <button type="button" aria-pressed={motionView === "knee"} onClick={() => setMotionView("knee")}>{t("Knee detail")}</button>
                <button type="button" aria-pressed={motionView === "body"} onClick={() => setMotionView("body")}>{t("Both legs")}</button>
              </div>
              <div className="motion-canvas" aria-label={t("Live knee flexion model")}>
                {motionView === "body" ? <LowerBodyMotion activity={movementId} phaseRef={motionPhase} manualAngle={flexion} reducedMotion={performanceMode === "reduced"} anatomy={{selected,selectedEntity,xray,exploded,showLabels,tensionMap,aclState,muscleScope,onSelect:selectLayer,onEntitySelect:selectEntity,onHover:setHovered}} /> : <>
                <Scene selected={selected} selectedEntity={selectedEntity} xray={xray} exploded={exploded} flexion={flexion} flexionSource={motionFlexion} muscleScope={muscleScope} onSelect={selectLayer} onEntitySelect={selectEntity} onHover={setHovered} viewRotation={-Math.PI / 2} thighRotationSource={motionThighAngle} stableView lockRotation showMotionGhost={false} showLabels={showLabels} tensionMap={tensionMap} aclState={aclState}/>

                <div className="orbit-hint" aria-hidden="true">{t("FIXED VIEW\u00A0\u00A0 / \u00A0\u00A0WHEEL \u00B7 ZOOM")}</div>
                <div className="angle-guide" aria-hidden="true">
                  <span>{t(flexion)}{t("\u00B0")}</span>
                </div>
                {hovered && <div className="motion-hover-label">{t(hovered)}</div>}
                </>}
                </div>
            </div>

            <div className="motion-control">
              <div className="movement-presets">
                <div className="injury-head">
                  <p>{t("MOVEMENT")}</p>
                  <span>{t("EDUCATIONAL")}</span>
                </div>
                <div className="preset-options" role="group" aria-label={t("Choose a movement preset")}>
                  {movementPresets.map((preset) => (<button key={preset.id} type="button" className={movementId === preset.id ? "active" : ""} onClick={() => {
                setMovementId(preset.id);

            }}>
                      {t(preset.label)}
                    </button>))}
                </div>
                <p>{t(performanceMode === "reduced" && movementId !== "manual" ? "Animation is paused because reduced-motion mode is active." : activeMovement.description)}</p>
              </div>
              <div className="angle-readout">
                <span>{t(String(flexion).padStart(3, "0"))}</span>
                <sup>{t("\u00B0")}</sup>
              </div>
              <label htmlFor="flexion-range">{t(motionView === "body" ? "Left knee flexion" : "Knee flexion")}</label>
              <input id="flexion-range" type="range" min="0" max="130" step="1" value={flexion} onChange={(event) => {
            setMovementId("manual");
            const angle = Number(event.target.value);
            motionFlexion.current = angle;
            setFlexion(angle);
        }} style={{ "--progress": `${(flexion / 130) * 100}%` } as React.CSSProperties}/>
              <div className="range-scale">
                <span>{t("EXTENDED")}</span>
                <span>{t("DEEP FLEXION")}</span>
              </div>

              <div className="motion-control-group">
                <p>{t("Visible tissue")}</p>
                <div className="motion-layer-options" role="group" aria-label={t("Choose tissue in live motion model")}>
                  {structures.map((structure) => (<button key={structure.key} type="button" className={selected === structure.key ? "active" : ""} onClick={() => selectLayer(structure.key)}>
                      {t(structure.label)}
                    </button>))}
                </div>
              </div>

              <div className="motion-tool-row" role="group" aria-label={t("Live model view tools")}>
                <button type="button" className={xray ? "active" : ""} onClick={() => setXray((value) => !value)}>
                  <Icon name="scan"/>{t(" X-ray")}</button>
                <button type="button" className={exploded ? "active" : ""} onClick={() => setExploded((value) => !value)}>
                  <Icon name="layers"/>{t(" Explode")}</button>
                <button type="button" className={showLabels ? "active" : ""} onClick={() => setShowLabels((value) => !value)}>{t("+ Labels")}</button>
                <button type="button" className={tensionMap ? "active tension-active" : ""} onClick={() => setTensionMap((value) => !value)}>{t("\u25C9 Tension map")}</button>
              </div>

              {selected === "muscle" && (<div className="muscle-scope-control">
                  <div className="injury-head">
                    <p>{t("MUSCLE SCOPE")}</p>
                    <span>{t("ANATOMY LAYER")}</span>
                  </div>
                  <div className="scope-options" role="group" aria-label={t("Choose muscle display scope")}>
                    <button type="button" className={muscleScope === "knee" ? "active" : ""} onClick={() => setMuscleScope("knee")}>{t("Knee mechanics")}</button>
                    <button type="button" className={muscleScope === "regional" ? "active" : ""} onClick={() => setMuscleScope("regional")}>{t("Regional anatomy")}</button>
                  </div>
                  <p>
                    {t(muscleScope === "knee"
                ? "Shows muscles that cross or directly control the knee. Upper paths continue beyond this cropped model."
                : "Adds proximal lower-leg muscles for regional completeness; several primarily act on the ankle.")}
                  </p>
                </div>)}

              <div className="injury-lab">
                <div className="injury-head">
                  <p>{t("ACL INJURY MODE")}</p>
                  <span>{t("ILLUSTRATIVE")}</span>
                </div>
                <div className="injury-options" role="group" aria-label={t("Choose an illustrative ACL condition")}>
                  {(["normal", "strain", "tear"] as AclState[]).map((state) => (<button key={state} type="button" className={aclState === state ? `active is-${state}` : ""} onClick={() => {
                setAclState(state);
                setSelected("ligament");
                setSelectedEntity("acl");
            }}>
                      {t(state)}
                    </button>))}
                </div>
                <p className="injury-note">
                  {t(aclState === "normal" && "Continuous ACL fibres guide anterior stability.")}
                  {t(aclState === "strain" && "Elongation is exaggerated to make fibre stress visible.")}
                  {t(aclState === "tear" && "A visible gap represents loss of fibre continuity.")}
                </p>
              </div>

              {tensionMap && (<div className="tension-legend">
                  <span>{t("LOW")}</span><i aria-hidden="true"/><span>{t("HIGH")}</span>
                  <p>{t("Colour shows a flexion-based trend only, not measured force. Real loading depends on combined forces and movement.")}</p>
                </div>)}

              <p className="motion-state">
                <span>{t(flexion < 15 ? "Near full extension" : flexion < 70 ? "Functional flexion" : "Deep flexion")}</span>
                <span>{t(motionView === "body" ? "Both legs" : activeEntity?.shortLabel ?? structureByKey[selected].label)}</span>
              </p>
            </div>
          </div>
        </section>

        <AclExperiment />

        <section id="learn" className="learn-section">
          <div className="learn-heading" data-reveal>
            <p className="kicker">{t("THE SYSTEM")}</p>
            <h2>{t("Five tissue systems.")}<br />{t("One coordinated joint.")}</h2>
          </div>
          <div className="layer-explorer">
            <div className="layer-sticky" aria-label={t("Scroll-driven exploded knee anatomy")}>
              <div className="layer-scene">
                <Scene stableView lockRotation boneContextOpacity={0.3} selected={layerSelected} selectedEntity={null} xray={false} exploded={false} explodeAmount={layerProgress} flexion={0} muscleScope={muscleScope} onSelect={selectLayer} onEntitySelect={selectEntity} onHover={setHovered} viewRotation={-0.55} showLabels/>
                <div className="layer-hud">
                  <span>{t("EXPLODED ANATOMY")}</span>
                  <strong>{t(String(Math.round(layerProgress * 100)).padStart(3, "0"))}{t("%")}</strong>
                </div>
                <div className="layer-progress"><i style={{ height: `${layerProgress * 100}%` }}/></div>
              </div>
            </div>
            <div className="anatomy-grid">
              {layerStructures.map((structure, index) => (<article key={structure.key} className={layerSelected === structure.key ? "is-current" : ""}>
                  <div className={`material-swatch swatch-${structure.key}`}>
                    <span>{t("0")}{t(index + 1)}</span>
                  </div>
                  <h3>{t(structure.label)}</h3>
                  <p>{t(structure.description)}</p>
                  <button type="button" onClick={() => {
                selectLayer(structure.key);
                document.getElementById("explore")?.scrollIntoView({ behavior: "smooth" });
            }}>{t("View in model ")}<span aria-hidden="true">{t("\u2197")}</span>
                  </button>
                </article>))}
            </div>
          </div>
        </section>

        <section className="quiz-section">
          <div className="quiz-card" data-reveal>
            <p className="kicker">{t("QUICK CHECK")}</p>
            <h2>{t("Which structure distributes load between the femur and tibia?")}</h2>
            <div className="quiz-options">
              {quizOptions.map((option) => (<button type="button" key={option.label} className={quizAnswer !== null && option.correct ? "correct" : ""} onClick={() => setQuizAnswer(option.correct)}>
                  {t(option.label)}
                </button>))}
            </div>
            {quizAnswer !== null && (<p className={`quiz-result ${quizAnswer ? "is-correct" : ""}`} aria-live="polite">
                {t(quizAnswer
                ? "Correct — the medial and lateral menisci increase contact area and distribute load."
                : "Not quite. Look for the two crescent-shaped pads between the femur and tibia.")}
              </p>)}
          </div>
        </section>
      </main>

      <footer>
        <a className="brand" href="#explore">
          <span className="brand-mark" aria-hidden="true"/>{t("KNEE LAB")}</a>
        <p>{t("Interactive anatomy study by Kelly Liu.")}</p>
        <div>
          <a href="https://3d.nih.gov/entries/3DPX-021003" target="_blank" rel="noreferrer">{t("Sources & model credit \u2197")}</a>
          <span>{t("Soft tissues are educational reconstructions \u00B7 Not medical advice")}</span>
        </div>
      </footer>
    </div>);
}
useGLTF.preload(`${import.meta.env.BASE_URL}models/knee.glb`);
