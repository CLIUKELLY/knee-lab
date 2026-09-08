import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Bounds, Center, Float, Html, OrbitControls, Sparkles, useGLTF } from "@react-three/drei";
import { Canvas, ThreeEvent, useFrame } from "@react-three/fiber";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import * as THREE from "three";

gsap.registerPlugin(ScrollTrigger);

type StructureKey = "all" | "bone" | "meniscus" | "cartilage";

type Structure = {
  key: StructureKey;
  label: string;
  eyebrow: string;
  description: string;
  fact: string;
};

const structures: Structure[] = [
  {
    key: "all",
    label: "Whole joint",
    eyebrow: "01 / SYSTEM",
    description: "The knee coordinates bone, cartilage and fibrocartilage to carry load while remaining mobile.",
    fact: "It behaves like a modified hinge, combining flexion with small rotations and gliding movements.",
  },
  {
    key: "bone",
    label: "Bones",
    eyebrow: "02 / FRAME",
    description: "The femur meets the tibia while the patella protects the front of the joint and improves leverage.",
    fact: "Four bones appear here: femur, tibia, fibula and patella.",
  },
  {
    key: "meniscus",
    label: "Menisci",
    eyebrow: "03 / CUSHION",
    description: "Two crescent-shaped pads help spread load across the top of the tibia.",
    fact: "Their wedge-like geometry also contributes to joint stability.",
  },
  {
    key: "cartilage",
    label: "Cartilage",
    eyebrow: "04 / GLIDE",
    description: "Smooth articular cartilage covers contact surfaces so the bones can move with very little friction.",
    fact: "Unlike most tissues, articular cartilage has no direct blood supply.",
  },
];

const structureByKey = Object.fromEntries(structures.map((item) => [item.key, item])) as Record<
  StructureKey,
  Structure
>;

const palette: Record<Exclude<StructureKey, "all">, string> = {
  bone: "#ece4d6",
  meniscus: "#8df0c5",
  cartilage: "#61d9ed",
};

function categoryForName(name: string): Exclude<StructureKey, "all"> | null {
  const normalized = name.toLowerCase();
  if (normalized.includes("meniscus")) return "meniscus";
  if (normalized.includes("cartilage")) return "cartilage";
  if (["femur", "tibia", "fibula", "patella"].some((part) => normalized.includes(part))) return "bone";
  return null;
}

function isAnnotation(name: string) {
  const normalized = name.toLowerCase();
  return ["enthesis", "condyle", "surface", "fossa", "point", "perichondular"].some((term) =>
    normalized.includes(term),
  );
}

type KneeModelProps = {
  selected: StructureKey;
  xray: boolean;
  exploded: boolean;
  flexion: number;
  onSelect: (key: StructureKey) => void;
  onHover: (label: string | null) => void;
};

function KneeModel({ selected, xray, exploded, flexion, onSelect, onHover }: KneeModelProps) {
  const group = useRef<THREE.Group>(null);
  const { scene } = useGLTF(`${import.meta.env.BASE_URL}models/knee.glb`);

  const model = useMemo(() => {
    const cloned = scene.clone(true);
    cloned.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const category = categoryForName(object.name);
      object.userData.category = category;
      object.userData.annotation = isAnnotation(object.name);
      object.userData.basePosition = object.position.clone();
      object.userData.baseRotation = object.rotation.clone();
      object.castShadow = true;
      object.receiveShadow = true;

      if (!category || object.userData.annotation) {
        object.visible = false;
        return;
      }

      object.material = new THREE.MeshPhysicalMaterial({
        color: palette[category],
        roughness: category === "bone" ? 0.38 : 0.22,
        metalness: 0,
        clearcoat: category === "bone" ? 0.15 : 0.55,
        clearcoatRoughness: 0.32,
        transmission: category === "bone" ? 0 : 0.08,
        transparent: true,
        opacity: category === "cartilage" ? 0.72 : 0.98,
        side: THREE.DoubleSide,
      });
    });
    return cloned;
  }, [scene]);

  useEffect(() => {
    return () => {
      model.traverse((object) => {
        if (object instanceof THREE.Mesh) object.material.dispose();
      });
    };
  }, [model]);

  useFrame((state, delta) => {
    if (!group.current) return;
    const ease = 1 - Math.pow(0.001, delta);
    group.current.rotation.y = THREE.MathUtils.lerp(group.current.rotation.y, state.pointer.x * 0.12 - 0.2, ease);
    group.current.rotation.x = THREE.MathUtils.lerp(group.current.rotation.x, -state.pointer.y * 0.06, ease);

    const bend = THREE.MathUtils.degToRad(flexion * -0.58);
    const pivot = new THREE.Vector3(0.155, -0.36, 0);
    const pivotShift = pivot.clone().sub(pivot.clone().applyEuler(new THREE.Euler(bend, 0, 0)));

    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !object.visible) return;
      const category = object.userData.category as Exclude<StructureKey, "all">;
      const material = object.material as THREE.MeshPhysicalMaterial;
      const active = selected === "all" || selected === category;
      const isLowerLeg = /tibia|fibula/i.test(object.name);
      const basePosition = object.userData.basePosition as THREE.Vector3;
      const baseRotation = object.userData.baseRotation as THREE.Euler;
      const targetPosition = basePosition.clone();

      if (exploded) {
        if (/femur/i.test(object.name)) targetPosition.x -= 0.12;
        if (/tibia/i.test(object.name)) targetPosition.x += 0.12;
        if (/fibula/i.test(object.name)) targetPosition.x += 0.24;
        if (/patella/i.test(object.name)) targetPosition.z += 0.18;
        if (category === "meniscus") targetPosition.x += 0.06;
        if (category === "cartilage") targetPosition.x -= 0.04;
      }

      if (isLowerLeg) targetPosition.add(pivotShift);
      object.position.lerp(targetPosition, ease);
      object.rotation.x = THREE.MathUtils.lerp(object.rotation.x, baseRotation.x + (isLowerLeg ? bend : 0), ease);

      const defaultOpacity = category === "cartilage" ? 0.68 : 0.98;
      const xrayOpacity = category === "bone" ? 0.12 : 0.84;
      const targetOpacity = !active ? 0.055 : xray ? xrayOpacity : defaultOpacity;
      material.opacity = THREE.MathUtils.lerp(material.opacity, targetOpacity, ease);
      material.depthWrite = material.opacity > 0.5;
      material.wireframe = xray && category === "bone";
      material.emissive.set(active && selected !== "all" ? palette[category] : "#000000");
      material.emissiveIntensity = active && selected !== "all" ? 0.12 : 0;
    });
  });

  const resolveEventCategory = (event: ThreeEvent<PointerEvent>) => {
    const category = categoryForName(event.object.name);
    return isAnnotation(event.object.name) ? null : category;
  };

  return (
    <group ref={group}>
      <Center>
        <primitive
          object={model}
          scale={4.35}
          onPointerOver={(event: ThreeEvent<PointerEvent>) => {
            const category = resolveEventCategory(event);
            if (!category) return;
            event.stopPropagation();
            document.body.style.cursor = "pointer";
            onHover(structureByKey[category].label);
          }}
          onPointerOut={() => {
            document.body.style.cursor = "default";
            onHover(null);
          }}
          onClick={(event: ThreeEvent<MouseEvent>) => {
            const category = categoryForName(event.object.name);
            if (!category || isAnnotation(event.object.name)) return;
            event.stopPropagation();
            onSelect(category);
          }}
        />
      </Center>
    </group>
  );
}

function Scene(props: KneeModelProps) {
  return (
    <Canvas
      camera={{ position: [0.2, 0.05, 3.9], fov: 30 }}
      dpr={[1, 1.8]}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
    >
      <ambientLight intensity={1.25} />
      <directionalLight position={[3, 4, 5]} intensity={4.2} color="#fff3df" />
      <directionalLight position={[-4, 1, -3]} intensity={2.5} color="#61d9ed" />
      <pointLight position={[0, -2, 2]} intensity={1.8} color="#8df0c5" />
      <Sparkles count={75} scale={[3.2, 4.4, 2]} size={1.35} speed={0.18} opacity={0.35} color="#8df0c5" />
      <Suspense
        fallback={
          <Html center>
            <div className="model-loading">Preparing anatomy</div>
          </Html>
        }
      >
        <Float speed={0.85} rotationIntensity={0.06} floatIntensity={0.09}>
          <Bounds fit clip observe margin={1.22}>
            <KneeModel {...props} />
          </Bounds>
        </Float>
      </Suspense>
      <OrbitControls
        makeDefault
        enablePan={false}
        enableZoom
        minDistance={2.4}
        maxDistance={6}
        dampingFactor={0.055}
        minPolarAngle={Math.PI * 0.25}
        maxPolarAngle={Math.PI * 0.75}
      />
    </Canvas>
  );
}

function Icon({ name }: { name: "layers" | "scan" }) {
  if (name === "scan") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m12 3 8 4.5-8 4.5-8-4.5L12 3ZM4 12l8 4.5 8-4.5M4 16.5l8 4.5 8-4.5" />
    </svg>
  );
}

const quizOptions = [
  { label: "Menisci", correct: true },
  { label: "Patella", correct: false },
  { label: "Fibula", correct: false },
];

export default function App() {
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLElement>(null);
  const [selected, setSelected] = useState<StructureKey>("all");
  const [xray, setXray] = useState(false);
  const [exploded, setExploded] = useState(false);
  const [flexion, setFlexion] = useState(0);
  const [hovered, setHovered] = useState<string | null>(null);
  const [quizAnswer, setQuizAnswer] = useState<boolean | null>(null);
  const active = structureByKey[selected];

  useLayoutEffect(() => {
    const context = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((element) => {
        gsap.fromTo(
          element,
          { y: 48, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 1,
            ease: "power3.out",
            scrollTrigger: { trigger: element, start: "top 86%", once: true },
          },
        );
      });
    }, root);
    return () => context.revert();
  }, []);

  const updateScanner = (event: React.PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--scan-x", `${event.clientX - rect.left}px`);
    event.currentTarget.style.setProperty("--scan-y", `${event.clientY - rect.top}px`);
  };

  return (
    <div ref={root} className="site-shell">
      <header className="topbar">
        <a className="brand" href="#explore" aria-label="Knee Lab, return to explorer">
          <span className="brand-mark" aria-hidden="true" />
          KNEE LAB
        </a>
        <nav aria-label="Primary navigation">
          <a href="#explore">Explore</a>
          <a href="#motion">Motion</a>
          <a href="#learn">Learn</a>
        </nav>
        <span className="edition">ANATOMY STUDY 001</span>
      </header>

      <main>
        <section
          ref={stage}
          id="explore"
          className={`hero-stage${xray ? " is-xray" : ""}`}
          onPointerMove={updateScanner}
        >
          <div className="hero-copy">
            <p className="kicker">INTERACTIVE ANATOMY</p>
            <h1>
              Built to <em>bend.</em>
            </h1>
            <p className="intro">
              Look beneath the surface of the human knee. Rotate the model, isolate each tissue and change the way the
              joint moves.
            </p>
            <div className="mouse-hint" aria-hidden="true">
              <span /> Drag to rotate · Scroll to zoom
            </div>
          </div>

          <div className="model-viewport" aria-label="Interactive three-dimensional model of a human knee">
            <Scene
              selected={selected}
              xray={xray}
              exploded={exploded}
              flexion={flexion}
              onSelect={setSelected}
              onHover={setHovered}
            />
            <div className="model-orbit orbit-one" aria-hidden="true" />
            <div className="model-orbit orbit-two" aria-hidden="true" />
            {hovered && <div className="hover-label">{hovered}</div>}
          </div>

          <aside className="structure-panel" aria-live="polite">
            <p>{active.eyebrow}</p>
            <h2>{active.label}</h2>
            <div className="panel-rule" />
            <p className="panel-description">{active.description}</p>
            <p className="panel-fact">{active.fact}</p>
          </aside>

          <div className="structure-tabs" role="group" aria-label="Choose anatomical layer">
            {structures.map((structure) => (
              <button
                key={structure.key}
                type="button"
                className={selected === structure.key ? "active" : ""}
                onClick={() => setSelected(structure.key)}
              >
                <span className="tab-index">0{structures.indexOf(structure) + 1}</span>
                {structure.label}
              </button>
            ))}
          </div>

          <div className="view-tools" role="group" aria-label="Model view tools">
            <button type="button" className={xray ? "active" : ""} onClick={() => setXray((value) => !value)}>
              <Icon name="scan" /> X-ray
            </button>
            <button
              type="button"
              className={exploded ? "active" : ""}
              onClick={() => setExploded((value) => !value)}
            >
              <Icon name="layers" /> Explode
            </button>
          </div>
          <div className="scanner" aria-hidden="true" />
        </section>

        <section id="motion" className="motion-section">
          <div className="section-number">02</div>
          <div className="motion-copy" data-reveal>
            <p className="kicker">MOTION LAB</p>
            <h2>One joint.<br />More than one motion.</h2>
            <p>
              The knee is often described as a hinge, but flexion also includes subtle rolling, gliding and rotation.
              Move the control to explore an educational approximation of knee flexion.
            </p>
          </div>
          <div className="motion-control" data-reveal>
            <div className="angle-readout">
              <span>{String(flexion).padStart(3, "0")}</span>
              <sup>°</sup>
            </div>
            <label htmlFor="flexion-range">Knee flexion</label>
            <input
              id="flexion-range"
              type="range"
              min="0"
              max="130"
              step="1"
              value={flexion}
              onChange={(event) => setFlexion(Number(event.target.value))}
              style={{ "--progress": `${(flexion / 130) * 100}%` } as React.CSSProperties}
            />
            <div className="range-scale">
              <span>EXTENDED</span>
              <span>DEEP FLEXION</span>
            </div>
            <p className="motion-state">
              {flexion < 15 ? "Near full extension" : flexion < 70 ? "Functional flexion" : "Deep flexion"}
            </p>
          </div>
        </section>

        <section id="learn" className="learn-section">
          <div className="learn-heading" data-reveal>
            <p className="kicker">THE SYSTEM</p>
            <h2>Three materials.<br />One coordinated joint.</h2>
          </div>
          <div className="anatomy-grid">
            {structures.slice(1).map((structure, index) => (
              <article key={structure.key} data-reveal>
                <div className={`material-swatch swatch-${structure.key}`}>
                  <span>0{index + 1}</span>
                </div>
                <h3>{structure.label}</h3>
                <p>{structure.description}</p>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(structure.key);
                    document.getElementById("explore")?.scrollIntoView({ behavior: "smooth" });
                  }}
                >
                  View in model <span aria-hidden="true">↗</span>
                </button>
              </article>
            ))}
          </div>
        </section>

        <section className="quiz-section">
          <div className="quiz-card" data-reveal>
            <p className="kicker">QUICK CHECK</p>
            <h2>Which structure distributes load between the femur and tibia?</h2>
            <div className="quiz-options">
              {quizOptions.map((option) => (
                <button
                  type="button"
                  key={option.label}
                  className={quizAnswer !== null && option.correct ? "correct" : ""}
                  onClick={() => setQuizAnswer(option.correct)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {quizAnswer !== null && (
              <p className={`quiz-result ${quizAnswer ? "is-correct" : ""}`} aria-live="polite">
                {quizAnswer
                  ? "Correct — the medial and lateral menisci increase contact area and distribute load."
                  : "Not quite. Look for the two crescent-shaped pads between the femur and tibia."}
              </p>
            )}
          </div>
        </section>
      </main>

      <footer>
        <a className="brand" href="#explore">
          <span className="brand-mark" aria-hidden="true" />
          KNEE LAB
        </a>
        <p>Interactive anatomy study by Kelly Liu.</p>
        <div>
          <a href="https://3d.nih.gov/entries/3DPX-021003" target="_blank" rel="noreferrer">Model credit ↗</a>
          <span>Educational illustration · Not medical advice</span>
        </div>
      </footer>
    </div>
  );
}

useGLTF.preload(`${import.meta.env.BASE_URL}models/knee.glb`);
