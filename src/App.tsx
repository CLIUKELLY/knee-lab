import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Bounds, Center, Float, Html, OrbitControls, Sparkles, useGLTF } from "@react-three/drei";
import { Canvas, ThreeEvent, useFrame } from "@react-three/fiber";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import * as THREE from "three";

gsap.registerPlugin(ScrollTrigger);

type StructureKey = "all" | "bone" | "meniscus" | "cartilage" | "ligament" | "muscle";
type AclState = "normal" | "strain" | "tear";

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
    description: "The knee coordinates bone, cartilage, menisci, ligaments, tendons and muscle to carry load while remaining mobile.",
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
  {
    key: "ligament",
    label: "Ligaments",
    eyebrow: "05 / CONTROL",
    description: "The cruciate and collateral ligaments guide motion and resist excessive translation and rotation.",
    fact: "ACL and PCL cross inside the joint; MCL and LCL reinforce its sides. Tendons are shown with this layer.",
  },
  {
    key: "muscle",
    label: "Muscles",
    eyebrow: "06 / POWER",
    description: "Quadriceps extend the knee, while the hamstrings flex it and the gastrocnemius can assist flexion.",
    fact: "These simplified muscle volumes show relationships, not individual diagnostic anatomy.",
  },
];

const structureByKey = Object.fromEntries(structures.map((item) => [item.key, item])) as Record<
  StructureKey,
  Structure
>;

type TissueKey = Exclude<StructureKey, "all">;

const palette: Record<TissueKey, string> = {
  bone: "#eeeaf2",
  meniscus: "#a9b7ff",
  cartilage: "#69d2ff",
  ligament: "#f0cf86",
  muscle: "#db7f78",
};

function categoryForName(name: string): TissueKey | null {
  const normalized = name.toLowerCase();
  if (normalized.includes("meniscus")) return "meniscus";
  if (normalized.includes("cartilage")) return "cartilage";
  if (["femur", "tibia", "fibula", "patella"].some((part) => normalized.includes(part))) return "bone";
  return null;
}

const pivot = new THREE.Vector3(0.155, -0.36, 0);

function rotateLowerPoint(point: THREE.Vector3, flexion: number) {
  const bend = THREE.MathUtils.degToRad(flexion * -0.58);
  return point.clone().sub(pivot).applyAxisAngle(new THREE.Vector3(1, 0, 0), bend).add(pivot);
}

type StrandProps = {
  name: string;
  points: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
  lowerPoint?: boolean;
  radius?: number;
  category?: "ligament";
  selected: StructureKey;
  xray: boolean;
  exploded: boolean;
  explodeAmount?: number;
  flexion: number;
  tensionMap?: boolean;
  aclState?: AclState;
  onSelect: (key: StructureKey) => void;
  onHover: (label: string | null) => void;
};

function SoftStrand({
  name,
  points,
  lowerPoint = true,
  radius = 0.003,
  category = "ligament",
  selected,
  xray,
  exploded,
  explodeAmount,
  flexion,
  tensionMap = false,
  aclState = "normal",
  onSelect,
  onHover,
}: StrandProps) {
  const isAcl = name.startsWith("ACL");
  const isTorn = isAcl && aclState === "tear";
  const explosion = explodeAmount ?? (exploded ? 1 : 0);
  const load = useMemo(() => {
    const progress = flexion / 130;
    if (name.startsWith("ACL")) return THREE.MathUtils.lerp(0.9, 0.3, Math.min(progress / 0.7, 1));
    if (name.startsWith("PCL")) return THREE.MathUtils.lerp(0.2, 0.92, progress);
    if (name.startsWith("MCL")) return 0.42 - progress * 0.12;
    if (name.startsWith("LCL")) return 0.34 + progress * 0.08;
    return 0.24;
  }, [flexion, name]);

  const geometries = useMemo(() => {
    const updated = points.map((point, index) =>
      lowerPoint && index === points.length - 1 ? rotateLowerPoint(point, flexion) : point.clone(),
    );
    if (isAcl && aclState === "strain") updated[1].add(new THREE.Vector3(0.007, 0, 0.005));
    if (explosion) updated.forEach((point) => point.add(new THREE.Vector3(0, 0, 0.025 * explosion)));
    const curve = new THREE.CatmullRomCurve3(updated);
    if (!isTorn) return [new THREE.TubeGeometry(curve, 28, radius, 8, false)];
    const first = new THREE.CatmullRomCurve3([curve.getPoint(0), curve.getPoint(0.22), curve.getPoint(0.43)]);
    const second = new THREE.CatmullRomCurve3([curve.getPoint(0.57), curve.getPoint(0.78), curve.getPoint(1)]);
    return [
      new THREE.TubeGeometry(first, 15, radius * 0.88, 8, false),
      new THREE.TubeGeometry(second, 15, radius * 0.88, 8, false),
    ];
  }, [aclState, explosion, flexion, isAcl, isTorn, lowerPoint, points, radius]);

  useEffect(() => () => geometries.forEach((geometry) => geometry.dispose()), [geometries]);
  const active = selected === "all" || selected === category;
  const heatColor = useMemo(
    () => new THREE.Color(palette.ligament).lerp(new THREE.Color("#ff456e"), load),
    [load],
  );
  const color = isAcl && aclState !== "normal" ? (aclState === "tear" ? "#ff315f" : "#ff775c") : tensionMap ? heatColor : palette[category];

  return (
    <group
      name={name}
      onPointerOver={(event) => {
        event.stopPropagation();
        document.body.style.cursor = "pointer";
        onHover(name);
      }}
      onPointerOut={() => {
        document.body.style.cursor = "default";
        onHover(null);
      }}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(category);
      }}
    >
      {geometries.map((geometry, index) => (
        <mesh key={index} geometry={geometry} castShadow>
          <meshPhysicalMaterial
            color={color}
            roughness={0.32}
            clearcoat={0.42}
            transparent
            opacity={!active ? 0.055 : xray ? 0.9 : 0.98}
            depthWrite={active}
            emissive={active && (tensionMap || selected === category || (isAcl && aclState !== "normal")) ? color : "#000000"}
            emissiveIntensity={active ? (tensionMap ? 0.18 + load * 0.65 : isAcl && aclState !== "normal" ? 0.6 : selected === category ? 0.16 : 0) : 0}
          />
        </mesh>
      ))}
      {isTorn && active && <Sparkles count={12} position={[0.15, -0.418, -0.01]} scale={0.035} size={1.8} speed={0.8} color="#ff5278" />}
    </group>
  );
}

type MuscleProps = {
  name: string;
  position: [number, number, number];
  scale: [number, number, number];
  rotation?: [number, number, number];
  lower?: boolean;
} & Pick<KneeModelProps, "selected" | "xray" | "exploded" | "explodeAmount" | "flexion" | "onSelect" | "onHover">;

function MuscleVolume({ name, position, scale, rotation = [0, 0, 0], lower, selected, xray, exploded, explodeAmount, flexion, onSelect, onHover }: MuscleProps) {
  const active = selected === "all" || selected === "muscle";
  const base = useMemo(() => new THREE.Vector3(...position), [position]);
  const moved = lower ? rotateLowerPoint(base, flexion) : base;
  const bend = lower ? THREE.MathUtils.degToRad(flexion * -0.58) : 0;
  const explosion = explodeAmount ?? (exploded ? 1 : 0);
  const displayPosition = moved.clone().add(new THREE.Vector3(0, 0, -0.035 * explosion));

  return (
    <mesh
      name={name}
      position={displayPosition}
      scale={scale}
      rotation={[rotation[0] + bend, rotation[1], rotation[2]]}
      castShadow
      onPointerOver={(event) => {
        event.stopPropagation();
        document.body.style.cursor = "pointer";
        onHover(name);
      }}
      onPointerOut={() => {
        document.body.style.cursor = "default";
        onHover(null);
      }}
      onClick={(event) => {
        event.stopPropagation();
        onSelect("muscle");
      }}
    >
      <sphereGeometry args={[1, 28, 18]} />
      <meshPhysicalMaterial
        color={palette.muscle}
        roughness={0.48}
        clearcoat={0.16}
        transparent
        opacity={!active ? 0.04 : xray ? 0.2 : 0.74}
        depthWrite={active && !xray}
        emissive={active && selected === "muscle" ? palette.muscle : "#000000"}
        emissiveIntensity={active && selected === "muscle" ? 0.12 : 0}
      />
    </mesh>
  );
}

function SoftTissues(props: KneeModelProps) {
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const strands: Omit<StrandProps, keyof KneeModelProps | "selected" | "xray" | "exploded" | "flexion" | "onSelect" | "onHover">[] = [
    { name: "ACL · Anterior cruciate ligament", points: [v(0.166, -0.397, -0.032), v(0.148, -0.414, -0.012), v(0.132, -0.438, -0.004)], radius: 0.0034 },
    { name: "PCL · Posterior cruciate ligament", points: [v(0.128, -0.399, -0.031), v(0.139, -0.419, -0.038), v(0.154, -0.437, -0.031)], radius: 0.0038 },
    { name: "MCL · Medial collateral ligament", points: [v(0.093, -0.391, -0.018), v(0.091, -0.434, -0.012), v(0.103, -0.502, -0.004)], radius: 0.0031 },
    { name: "LCL · Lateral collateral ligament", points: [v(0.179, -0.386, -0.021), v(0.192, -0.431, -0.027), v(0.206, -0.471, -0.035)], radius: 0.0028 },
    { name: "Quadriceps tendon", points: [v(0.145, -0.285, 0.042), v(0.149, -0.324, 0.047), v(0.151, -0.361, 0.045)], lowerPoint: false, radius: 0.0062 },
    { name: "Patellar tendon", points: [v(0.151, -0.407, 0.044), v(0.153, -0.454, 0.034), v(0.157, -0.505, 0.015)], radius: 0.006 },
  ];

  return (
    <group>
      {strands.map((strand) => <SoftStrand key={strand.name} {...props} {...strand} />)}
      <MuscleVolume {...props} name="Quadriceps" position={[0.133, -0.17, 0.026]} scale={[0.046, 0.15, 0.035]} rotation={[0.04, 0, -0.04]} />
      <MuscleVolume {...props} name="Hamstrings" position={[0.126, -0.2, -0.057]} scale={[0.036, 0.15, 0.03]} rotation={[-0.05, 0, 0.08]} />
      <MuscleVolume {...props} name="Gastrocnemius" position={[0.146, -0.61, -0.068]} scale={[0.05, 0.15, 0.038]} rotation={[0.06, 0, -0.03]} lower />
    </group>
  );
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
  explodeAmount?: number;
  flexion: number;
  onSelect: (key: StructureKey) => void;
  onHover: (label: string | null) => void;
  viewRotation?: number;
  showMotionGhost?: boolean;
  showLabels?: boolean;
  tensionMap?: boolean;
  aclState?: AclState;
};

const labelsByStructure: Record<StructureKey, { label: string; position: [number, number, number] }[]> = {
  all: [
    { label: "PATELLA", position: [0.15, -0.38, 0.07] },
    { label: "ACL", position: [0.15, -0.415, -0.005] },
    { label: "MENISCI", position: [0.14, -0.44, 0.015] },
    { label: "TIBIA", position: [0.15, -0.55, 0.01] },
  ],
  bone: [
    { label: "FEMUR", position: [0.14, -0.25, 0] },
    { label: "PATELLA", position: [0.15, -0.38, 0.07] },
    { label: "TIBIA", position: [0.15, -0.55, 0.01] },
  ],
  meniscus: [{ label: "MEDIAL + LATERAL MENISCI", position: [0.14, -0.44, 0.02] }],
  cartilage: [{ label: "ARTICULAR CARTILAGE", position: [0.14, -0.415, 0.03] }],
  ligament: [
    { label: "ACL", position: [0.15, -0.415, -0.005] },
    { label: "PCL", position: [0.14, -0.42, -0.04] },
    { label: "MCL", position: [0.09, -0.44, -0.01] },
    { label: "LCL", position: [0.195, -0.43, -0.03] },
  ],
  muscle: [
    { label: "QUADRICEPS", position: [0.13, -0.18, 0.04] },
    { label: "HAMSTRINGS", position: [0.12, -0.22, -0.07] },
    { label: "GASTROCNEMIUS", position: [0.15, -0.62, -0.07] },
  ],
};

function AnatomyLabels({ selected }: { selected: StructureKey }) {
  return (
    <group>
      {labelsByStructure[selected].map((item) => (
        <Html key={item.label} position={item.position} center sprite distanceFactor={2.5} className="anatomy-label-wrap">
          <span className="anatomy-label">{item.label}</span>
        </Html>
      ))}
    </group>
  );
}

function KneeModel({
  selected,
  xray,
  exploded,
  explodeAmount,
  flexion,
  onSelect,
  onHover,
  viewRotation = -0.2,
  showMotionGhost = false,
  showLabels = false,
  tensionMap = false,
  aclState = "normal",
}: KneeModelProps) {
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

  const motionGhosts = useMemo(() => {
    return [0, 0.34, 0.68].map((trailProgress) => {
      const cloned = scene.clone(true);
      cloned.userData.trailProgress = trailProgress;
      cloned.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const isLowerLegBone = /tibia|fibula/i.test(object.name) && !isAnnotation(object.name);
        object.visible = isLowerLegBone;
        object.raycast = () => undefined;
        object.userData.basePosition = object.position.clone();
        object.userData.baseRotation = object.rotation.clone();
        if (!isLowerLegBone) return;
        object.material = new THREE.MeshBasicMaterial({
          color: trailProgress === 0 ? "#9fbaff" : "#6ae0ff",
          wireframe: true,
          transparent: true,
          opacity: 0.08,
          depthWrite: false,
        });
      });
      return cloned;
    });
  }, [scene]);

  useEffect(() => {
    return () => {
      model.traverse((object) => {
        if (object instanceof THREE.Mesh) object.material.dispose();
      });
      motionGhosts.forEach((ghost) => ghost.traverse((object) => {
        if (object instanceof THREE.Mesh && object.visible) object.material.dispose();
      }));
    };
  }, [model, motionGhosts]);

  useFrame((state, delta) => {
    if (!group.current) return;
    const ease = 1 - Math.pow(0.001, delta);
    group.current.rotation.y = THREE.MathUtils.lerp(
      group.current.rotation.y,
      viewRotation + state.pointer.x * 0.08,
      ease,
    );
    group.current.rotation.x = THREE.MathUtils.lerp(group.current.rotation.x, -state.pointer.y * 0.06, ease);

    const bend = THREE.MathUtils.degToRad(flexion * -0.58);
    const pivotShift = pivot.clone().sub(pivot.clone().applyEuler(new THREE.Euler(bend, 0, 0)));

    motionGhosts.forEach((ghost) => {
      const trailProgress = ghost.userData.trailProgress as number;
      ghost.visible = showMotionGhost && flexion > 4;
      const trailBend = bend * trailProgress;
      const trailPivotShift = pivot.clone().sub(pivot.clone().applyEuler(new THREE.Euler(trailBend, 0, 0)));
      ghost.traverse((object) => {
        if (!(object instanceof THREE.Mesh) || !object.visible) return;
        const basePosition = object.userData.basePosition as THREE.Vector3;
        const baseRotation = object.userData.baseRotation as THREE.Euler;
        object.position.copy(basePosition).add(trailPivotShift);
        object.rotation.x = baseRotation.x + trailBend;
        (object.material as THREE.MeshBasicMaterial).opacity = 0.04 + (1 - trailProgress) * 0.08 + (flexion / 130) * 0.04;
      });
    });

    const explosion = explodeAmount ?? (exploded ? 1 : 0);

    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !object.visible) return;
      const category = object.userData.category as TissueKey;
      const material = object.material as THREE.MeshPhysicalMaterial;
      const active = selected === "all" || selected === category;
      const isLowerLeg = /tibia|fibula/i.test(object.name);
      const basePosition = object.userData.basePosition as THREE.Vector3;
      const baseRotation = object.userData.baseRotation as THREE.Euler;
      const targetPosition = basePosition.clone();

      if (explosion) {
        if (/femur/i.test(object.name)) targetPosition.x -= 0.12 * explosion;
        if (/tibia/i.test(object.name)) targetPosition.x += 0.12 * explosion;
        if (/fibula/i.test(object.name)) targetPosition.x += 0.24 * explosion;
        if (/patella/i.test(object.name)) targetPosition.z += 0.18 * explosion;
        if (category === "meniscus") targetPosition.x += 0.06 * explosion;
        if (category === "cartilage") targetPosition.x -= 0.04 * explosion;
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
    <group ref={group} rotation={[0, viewRotation, 0]}>
      <Center>
        <group scale={4.35}>
          {showMotionGhost && motionGhosts.map((ghost, index) => <primitive key={index} object={ghost} />)}
          <primitive
            object={model}
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
          <SoftTissues
            selected={selected}
            xray={xray}
            exploded={exploded}
            explodeAmount={explodeAmount}
            flexion={flexion}
            tensionMap={tensionMap}
            aclState={aclState}
            onSelect={onSelect}
            onHover={onHover}
          />
          {showLabels && <AnatomyLabels selected={selected} />}
        </group>
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
      <directionalLight position={[3, 4, 5]} intensity={4.2} color="#f4f6ff" />
      <directionalLight position={[-4, 1, -3]} intensity={2.5} color="#69d2ff" />
      <pointLight position={[0, -2, 2]} intensity={1.8} color="#9c8cff" />
      <Sparkles count={75} scale={[3.2, 4.4, 2]} size={1.35} speed={0.18} opacity={0.35} color="#8fb5ff" />
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
  const [motionViewKey, setMotionViewKey] = useState(0);
  const [showLabels, setShowLabels] = useState(true);
  const [tensionMap, setTensionMap] = useState(false);
  const [aclState, setAclState] = useState<AclState>("normal");
  const [layerProgress, setLayerProgress] = useState(0);
  const active = structureByKey[selected];
  const layerStructures = structures.slice(1);
  const layerIndex = Math.min(layerStructures.length - 1, Math.floor(layerProgress * layerStructures.length));
  const layerSelected = layerStructures[layerIndex].key;

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
      ScrollTrigger.create({
        trigger: ".layer-explorer",
        start: "top 72%",
        end: "bottom 32%",
        scrub: true,
        onUpdate: (self) => setLayerProgress(Math.round(self.progress * 100) / 100),
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
            <h2>Move it.<br />See it respond.</h2>
            <p>
              The knee is often described as a hinge, but flexion also includes subtle rolling, gliding and rotation.
              Adjust the live model while keeping its tissues, angle and viewing tools in sight.
            </p>
          </div>

          <div
            className="motion-workbench"
            data-reveal
            style={{ "--motion-angle": `${Math.max(4, (flexion / 130) * 78)}deg` } as React.CSSProperties}
          >
            <div className="motion-visual">
              <div className="motion-visual-head">
                <span><i aria-hidden="true" /> LIVE MODEL</span>
                <button type="button" onClick={() => setMotionViewKey((value) => value + 1)}>
                  RESET SIDE VIEW
                </button>
              </div>
              <div className="motion-canvas" aria-label="Live knee flexion model">
                <Scene
                  key={motionViewKey}
                  selected={selected}
                  xray={xray}
                  exploded={exploded}
                  flexion={flexion}
                  onSelect={setSelected}
                  onHover={setHovered}
                  viewRotation={-Math.PI / 2}
                  showMotionGhost
                  showLabels={showLabels}
                  tensionMap={tensionMap}
                  aclState={aclState}
                />
                <div className="motion-scan-beam" aria-hidden="true" />
                {flexion > 4 && <div className="motion-ghost-key" aria-hidden="true"><i /> Motion trail · extension reference</div>}
                <div className="angle-guide" aria-hidden="true">
                  <span>{flexion}°</span>
                </div>
                {hovered && <div className="motion-hover-label">{hovered}</div>}
              </div>
            </div>

            <div className="motion-control">
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

              <div className="motion-control-group">
                <p>Visible tissue</p>
                <div className="motion-layer-options" role="group" aria-label="Choose tissue in live motion model">
                  {structures.map((structure) => (
                    <button
                      key={structure.key}
                      type="button"
                      className={selected === structure.key ? "active" : ""}
                      onClick={() => setSelected(structure.key)}
                    >
                      {structure.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="motion-tool-row" role="group" aria-label="Live model view tools">
                <button type="button" className={xray ? "active" : ""} onClick={() => setXray((value) => !value)}>
                  <Icon name="scan" /> X-ray
                </button>
                <button type="button" className={exploded ? "active" : ""} onClick={() => setExploded((value) => !value)}>
                  <Icon name="layers" /> Explode
                </button>
                <button type="button" className={showLabels ? "active" : ""} onClick={() => setShowLabels((value) => !value)}>
                  + Labels
                </button>
                <button type="button" className={tensionMap ? "active tension-active" : ""} onClick={() => setTensionMap((value) => !value)}>
                  ◉ Tension map
                </button>
              </div>

              <div className="injury-lab">
                <div className="injury-head">
                  <p>ACL INJURY MODE</p>
                  <span>ILLUSTRATIVE</span>
                </div>
                <div className="injury-options" role="group" aria-label="Choose an illustrative ACL condition">
                  {(["normal", "strain", "tear"] as AclState[]).map((state) => (
                    <button
                      key={state}
                      type="button"
                      className={aclState === state ? `active is-${state}` : ""}
                      onClick={() => {
                        setAclState(state);
                        setSelected("ligament");
                      }}
                    >
                      {state}
                    </button>
                  ))}
                </div>
                <p className="injury-note">
                  {aclState === "normal" && "Continuous ACL fibres guide anterior stability."}
                  {aclState === "strain" && "Elongation is exaggerated to make fibre stress visible."}
                  {aclState === "tear" && "A visible gap represents loss of fibre continuity."}
                </p>
              </div>

              {tensionMap && (
                <div className="tension-legend">
                  <span>LOW</span><i aria-hidden="true" /><span>HIGH</span>
                  <p>Colour shows a flexion-based trend only, not measured force. Real loading depends on combined forces and movement.</p>
                </div>
              )}

              <p className="motion-state">
                <span>{flexion < 15 ? "Near full extension" : flexion < 70 ? "Functional flexion" : "Deep flexion"}</span>
                <span>{structureByKey[selected].label}</span>
              </p>
            </div>
          </div>
        </section>

        <section id="learn" className="learn-section">
          <div className="learn-heading" data-reveal>
            <p className="kicker">THE SYSTEM</p>
            <h2>Five tissue systems.<br />One coordinated joint.</h2>
          </div>
          <div className="layer-explorer">
            <div className="layer-sticky" aria-label="Scroll-driven exploded knee anatomy">
              <div className="layer-scene">
                <Scene
                  selected={layerSelected}
                  xray={false}
                  exploded={false}
                  explodeAmount={layerProgress}
                  flexion={0}
                  onSelect={setSelected}
                  onHover={setHovered}
                  viewRotation={-0.55}
                  showLabels
                />
                <div className="layer-hud">
                  <span>EXPLODED ANATOMY</span>
                  <strong>{String(Math.round(layerProgress * 100)).padStart(3, "0")}%</strong>
                </div>
                <div className="layer-progress"><i style={{ height: `${layerProgress * 100}%` }} /></div>
              </div>
            </div>
            <div className="anatomy-grid">
              {layerStructures.map((structure, index) => (
                <article key={structure.key} className={layerSelected === structure.key ? "is-current" : ""}>
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
          <a href="https://3d.nih.gov/entries/3DPX-021003" target="_blank" rel="noreferrer">Sources & model credit ↗</a>
          <span>Soft tissues are educational reconstructions · Not medical advice</span>
        </div>
      </footer>
    </div>
  );
}

useGLTF.preload(`${import.meta.env.BASE_URL}models/knee.glb`);
