import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Bounds, Center, Float, Html, OrbitControls, Sparkles, useGLTF } from "@react-three/drei";
import { Canvas, ThreeEvent, useFrame } from "@react-three/fiber";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import * as THREE from "three";

gsap.registerPlugin(ScrollTrigger);

type StructureKey = "all" | "bone" | "meniscus" | "cartilage" | "ligament" | "muscle";
type AclState = "normal" | "strain" | "tear";
type MuscleScope = "knee" | "regional";
type MotionView = "side" | "quarter" | "front";

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
    fact: "The reconstruction separates four quadriceps components, posterior hamstrings and both gastrocnemius heads.",
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

type TissueTextureKind = "ligament" | "muscle" | "bone" | "cartilage" | "meniscus";

function tissueNoise(x: number, y: number) {
  const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function createTissueTexture(kind: TissueTextureKind) {
  const width = 160;
  const height = 96;
  const data = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const noise = tissueNoise(x, y);
      let value = 235;

      if (kind === "ligament") {
        const longFibre = Math.pow(0.5 + 0.5 * Math.cos(y * 1.55 + Math.sin(x * 0.07) * 0.7), 4);
        const fibril = Math.pow(0.5 + 0.5 * Math.cos(y * 4.9 + x * 0.025), 10);
        value = 184 + longFibre * 48 + fibril * 20 + noise * 5;
      } else if (kind === "muscle") {
        const fascicle = Math.pow(0.5 + 0.5 * Math.cos(x * 1.12 + Math.sin(y * 0.08)), 5);
        const crossBand = 0.5 + 0.5 * Math.cos(y * 0.72);
        value = 178 + fascicle * 48 + crossBand * 17 + noise * 7;
      } else if (kind === "bone") {
        const pore = noise > 0.93 ? -42 : noise * 16;
        value = 220 + pore;
      } else if (kind === "meniscus") {
        const lamella = 0.5 + 0.5 * Math.cos(y * 0.42 + Math.sin(x * 0.12));
        value = 202 + lamella * 35 + noise * 8;
      } else {
        const glide = 0.5 + 0.5 * Math.sin(x * 0.08 + y * 0.05);
        value = 226 + glide * 18 + noise * 3;
      }

      const channel = Math.round(THREE.MathUtils.clamp(value, 130, 255));
      const index = (y * width + x) * 4;
      data[index] = channel;
      data[index + 1] = channel;
      data[index + 2] = channel;
      data[index + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = 8;
  const repeat: Record<TissueTextureKind, [number, number]> = {
    ligament: [2.4, 2.2],
    muscle: [4.5, 2.8],
    bone: [5, 7],
    cartilage: [2, 3],
    meniscus: [3.5, 2.5],
  };
  texture.repeat.set(...repeat[kind]);
  return texture;
}

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

  const fascicleGeometries = useMemo(() => {
    const offsets = [
      new THREE.Vector3(-radius * 0.34, 0, 0),
      new THREE.Vector3(radius * 0.34, 0, 0),
      new THREE.Vector3(0, 0, -radius * 0.3),
      new THREE.Vector3(0, 0, radius * 0.3),
    ];

    return offsets.flatMap((offset, offsetIndex) => {
      const updated = points.map((point, index) => {
        const moved = lowerPoint && index === points.length - 1 ? rotateLowerPoint(point, flexion) : point.clone();
        const taper = 0.72 + Math.sin((index + offsetIndex) * 1.7) * 0.16;
        return moved.add(offset.clone().multiplyScalar(taper));
      });
      if (isAcl && aclState === "strain") updated[1].add(new THREE.Vector3(0.007, 0, 0.005));
      if (explosion) updated.forEach((point) => point.add(new THREE.Vector3(0, 0, 0.025 * explosion)));
      const curve = new THREE.CatmullRomCurve3(updated);
      const fibreRadius = Math.max(radius * 0.105, 0.00034);
      if (!isTorn) return [new THREE.TubeGeometry(curve, 24, fibreRadius, 5, false)];
      return [
        new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3([curve.getPoint(0), curve.getPoint(0.24), curve.getPoint(0.42)]),
          12,
          fibreRadius,
          5,
          false,
        ),
        new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3([curve.getPoint(0.58), curve.getPoint(0.76), curve.getPoint(1)]),
          12,
          fibreRadius,
          5,
          false,
        ),
      ];
    });
  }, [aclState, explosion, flexion, isAcl, isTorn, lowerPoint, points, radius]);

  useEffect(() => () => geometries.forEach((geometry) => geometry.dispose()), [geometries]);
  useEffect(() => () => fascicleGeometries.forEach((geometry) => geometry.dispose()), [fascicleGeometries]);
  const active = selected === "all" || selected === category;
  const fibreTexture = useMemo(() => createTissueTexture("ligament"), []);
  useEffect(() => () => fibreTexture.dispose(), [fibreTexture]);
  useFrame((state) => {
    fibreTexture.offset.x = tensionMap ? state.clock.elapsedTime * (0.012 + load * 0.018) : 0;
  });
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
            map={fibreTexture}
            bumpMap={fibreTexture}
            bumpScale={0.0011}
            roughness={0.46}
            clearcoat={0.18}
            sheen={0.72}
            sheenColor="#fff3d6"
            sheenRoughness={0.54}
            transparent
            opacity={!active ? 0.055 : xray ? 0.9 : 0.98}
            depthWrite={active}
            emissive={active && (tensionMap || selected === category || (isAcl && aclState !== "normal")) ? color : "#000000"}
            emissiveIntensity={active ? (tensionMap ? 0.18 + load * 0.65 : isAcl && aclState !== "normal" ? 0.6 : selected === category ? 0.16 : 0) : 0}
          />
        </mesh>
      ))}
      {fascicleGeometries.map((geometry, index) => (
        <mesh key={`fascicle-${index}`} geometry={geometry}>
          <meshPhysicalMaterial
            color={color}
            map={fibreTexture}
            roughness={0.5}
            sheen={0.9}
            sheenColor="#fff9e8"
            sheenRoughness={0.4}
            transparent
            opacity={!active ? 0 : xray ? 0.36 : 0.58}
            depthWrite={false}
            emissive={tensionMap || (isAcl && aclState !== "normal") ? color : "#000000"}
            emissiveIntensity={tensionMap ? 0.22 + load * 0.42 : isAcl && aclState !== "normal" ? 0.3 : 0}
          />
        </mesh>
      ))}
      {isTorn && active && <Sparkles count={12} position={[0.15, -0.418, -0.01]} scale={0.035} size={1.8} speed={0.8} color="#ff5278" />}
    </group>
  );
}

type MusclePath = {
  name: string;
  points: [number, number, number][];
  radius: number;
  depth: number;
  color: string;
  pennation: number;
  lowerMode?: "distal" | "all";
  scope?: "regional";
};

const musclePaths: MusclePath[] = [
  {
    name: "Rectus femoris",
    points: [[0.145, -0.015, 0.048], [0.146, -0.12, 0.056], [0.148, -0.235, 0.054], [0.151, -0.325, 0.048]],
    radius: 0.026,
    depth: 0.72,
    color: "#cf6e69",
    pennation: 0.08,
  },
  {
    name: "Vastus medialis",
    points: [[0.112, -0.035, 0.018], [0.103, -0.15, 0.028], [0.107, -0.265, 0.038], [0.139, -0.348, 0.048]],
    radius: 0.03,
    depth: 0.74,
    color: "#d87d73",
    pennation: 0.42,
  },
  {
    name: "Vastus lateralis",
    points: [[0.18, -0.025, 0.012], [0.191, -0.14, 0.022], [0.188, -0.26, 0.034], [0.16, -0.35, 0.047]],
    radius: 0.033,
    depth: 0.78,
    color: "#c76565",
    pennation: -0.34,
  },
  {
    name: "Vastus intermedius",
    points: [[0.146, -0.045, 0.004], [0.146, -0.16, 0.008], [0.148, -0.27, 0.018], [0.151, -0.345, 0.038]],
    radius: 0.024,
    depth: 0.62,
    color: "#ad5559",
    pennation: 0.16,
  },
  {
    name: "Biceps femoris · long head",
    points: [[0.18, -0.015, -0.06], [0.19, -0.15, -0.07], [0.198, -0.31, -0.058], [0.206, -0.47, -0.034]],
    radius: 0.024,
    depth: 0.72,
    color: "#b85b60",
    pennation: -0.24,
    lowerMode: "distal",
  },
  {
    name: "Biceps femoris · short head",
    points: [[0.185, -0.12, -0.045], [0.195, -0.22, -0.052], [0.201, -0.34, -0.048], [0.206, -0.47, -0.034]],
    radius: 0.017,
    depth: 0.66,
    color: "#a85159",
    pennation: 0.3,
    lowerMode: "distal",
  },
  {
    name: "Semitendinosus",
    points: [[0.116, -0.015, -0.058], [0.107, -0.15, -0.073], [0.1, -0.31, -0.058], [0.104, -0.51, -0.008]],
    radius: 0.019,
    depth: 0.68,
    color: "#b15a61",
    pennation: 0.2,
    lowerMode: "distal",
  },
  {
    name: "Semimembranosus",
    points: [[0.102, -0.02, -0.075], [0.094, -0.15, -0.086], [0.096, -0.3, -0.076], [0.108, -0.452, -0.045]],
    radius: 0.022,
    depth: 0.73,
    color: "#9f4d57",
    pennation: -0.14,
    lowerMode: "distal",
  },
  {
    name: "Sartorius",
    points: [[0.192, -0.01, 0.038], [0.171, -0.15, 0.042], [0.138, -0.32, 0.027], [0.104, -0.51, 0.004]],
    radius: 0.007,
    depth: 0.52,
    color: "#d9877e",
    pennation: 0.06,
    lowerMode: "distal",
  },
  {
    name: "Gracilis",
    points: [[0.084, -0.01, -0.005], [0.084, -0.18, -0.009], [0.091, -0.35, -0.006], [0.104, -0.505, 0.001]],
    radius: 0.0075,
    depth: 0.56,
    color: "#c77670",
    pennation: 0.05,
    lowerMode: "distal",
  },
  {
    name: "Medial gastrocnemius",
    points: [[0.116, -0.405, -0.052], [0.108, -0.49, -0.078], [0.112, -0.61, -0.08], [0.125, -0.72, -0.058]],
    radius: 0.031,
    depth: 0.76,
    color: "#c96b65",
    pennation: 0.3,
    lowerMode: "all",
  },
  {
    name: "Lateral gastrocnemius",
    points: [[0.178, -0.405, -0.052], [0.184, -0.49, -0.075], [0.18, -0.605, -0.078], [0.167, -0.715, -0.057]],
    radius: 0.029,
    depth: 0.74,
    color: "#bd615f",
    pennation: -0.28,
    lowerMode: "all",
  },
  {
    name: "Popliteus",
    points: [[0.178, -0.39, -0.035], [0.163, -0.415, -0.05], [0.145, -0.445, -0.058], [0.128, -0.475, -0.055]],
    radius: 0.009,
    depth: 0.58,
    color: "#a65057",
    pennation: 0.46,
    lowerMode: "distal",
  },
  {
    name: "Plantaris",
    points: [[0.183, -0.375, -0.06], [0.19, -0.43, -0.075], [0.18, -0.56, -0.082], [0.17, -0.73, -0.068]],
    radius: 0.0055,
    depth: 0.55,
    color: "#c27a72",
    pennation: -0.12,
    lowerMode: "all",
    scope: "regional",
  },
  {
    name: "Soleus",
    points: [[0.15, -0.465, -0.065], [0.15, -0.55, -0.08], [0.15, -0.67, -0.078], [0.15, -0.78, -0.06]],
    radius: 0.037,
    depth: 0.72,
    color: "#b85f5c",
    pennation: 0.38,
    lowerMode: "all",
    scope: "regional",
  },
  {
    name: "Tibialis anterior",
    points: [[0.174, -0.465, 0.026], [0.181, -0.55, 0.042], [0.177, -0.67, 0.045], [0.17, -0.78, 0.036]],
    radius: 0.017,
    depth: 0.67,
    color: "#cf746b",
    pennation: -0.22,
    lowerMode: "all",
    scope: "regional",
  },
  {
    name: "Fibularis longus",
    points: [[0.205, -0.475, -0.004], [0.214, -0.555, -0.014], [0.21, -0.675, -0.021], [0.201, -0.78, -0.017]],
    radius: 0.013,
    depth: 0.62,
    color: "#bd655f",
    pennation: 0.2,
    lowerMode: "all",
    scope: "regional",
  },
  {
    name: "Extensor digitorum longus",
    points: [[0.19, -0.48, 0.018], [0.198, -0.56, 0.028], [0.195, -0.68, 0.03], [0.188, -0.78, 0.024]],
    radius: 0.011,
    depth: 0.6,
    color: "#c96d66",
    pennation: -0.18,
    lowerMode: "all",
    scope: "regional",
  },
];

function muscleRadiusAt(t: number, radius: number) {
  const belly = Math.pow(Math.max(0, Math.sin(Math.PI * t)), 0.58);
  const asymmetry = 0.92 + 0.08 * Math.sin((t - 0.18) * Math.PI);
  return radius * (0.09 + belly * 0.91) * asymmetry;
}

function createMuscleSurface(curve: THREE.CatmullRomCurve3, radius: number, depth: number) {
  const segments = 34;
  const radialSegments = 16;
  const frames = curve.computeFrenetFrames(segments, false);
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const center = curve.getPointAt(t);
    const width = muscleRadiusAt(t, radius);
    for (let j = 0; j <= radialSegments; j += 1) {
      const angle = (j / radialSegments) * Math.PI * 2;
      const point = center
        .clone()
        .add(frames.normals[i].clone().multiplyScalar(Math.cos(angle) * width))
        .add(frames.binormals[i].clone().multiplyScalar(Math.sin(angle) * width * depth));
      positions.push(point.x, point.y, point.z);
      uvs.push(j / radialSegments, t);
    }
  }

  for (let i = 0; i < segments; i += 1) {
    for (let j = 0; j < radialSegments; j += 1) {
      const a = i * (radialSegments + 1) + j;
      const b = (i + 1) * (radialSegments + 1) + j;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return { geometry, frames, segments };
}

function MuscleBundle({ muscle, selected, xray, exploded, explodeAmount, flexion, onSelect, onHover }: { muscle: MusclePath } & Pick<KneeModelProps, "selected" | "xray" | "exploded" | "explodeAmount" | "flexion" | "onSelect" | "onHover">) {
  const active = selected === "all" || selected === "muscle";
  const explosion = explodeAmount ?? (exploded ? 1 : 0);
  const muscleTexture = useMemo(() => createTissueTexture("muscle"), []);
  const generated = useMemo(() => {
    const points = muscle.points.map((point, index) => {
      const vector = new THREE.Vector3(...point);
      const shouldRotate = muscle.lowerMode === "all" || (muscle.lowerMode === "distal" && index === muscle.points.length - 1);
      const moved = shouldRotate ? rotateLowerPoint(vector, flexion) : vector;
      return moved.add(new THREE.Vector3(0, 0, -0.035 * explosion));
    });
    const curve = new THREE.CatmullRomCurve3(points);
    const surface = createMuscleSurface(curve, muscle.radius, muscle.depth);
    const fibres = Array.from({ length: 7 }, (_, fibreIndex) => {
      const baseAngle = (fibreIndex / 7) * Math.PI * 2;
      const fibrePoints = Array.from({ length: 20 }, (_, pointIndex) => {
        const t = 0.035 + (pointIndex / 19) * 0.93;
        const frameIndex = Math.min(surface.segments, Math.round(t * surface.segments));
        const phase = baseAngle + muscle.pennation * (t - 0.5);
        const width = muscleRadiusAt(t, muscle.radius) * 1.012;
        return curve
          .getPointAt(t)
          .add(surface.frames.normals[frameIndex].clone().multiplyScalar(Math.cos(phase) * width))
          .add(surface.frames.binormals[frameIndex].clone().multiplyScalar(Math.sin(phase) * width * muscle.depth));
      });
      return new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(fibrePoints),
        22,
        Math.max(0.0003, muscle.radius * 0.018),
        4,
        false,
      );
    });
    return { body: surface.geometry, fibres };
  }, [explosion, flexion, muscle]);

  useEffect(() => () => {
    generated.body.dispose();
    generated.fibres.forEach((geometry) => geometry.dispose());
  }, [generated]);
  useEffect(() => () => muscleTexture.dispose(), [muscleTexture]);

  return (
    <group
      name={muscle.name}
      onPointerOver={(event) => {
        event.stopPropagation();
        document.body.style.cursor = "pointer";
        onHover(muscle.name);
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
      <mesh geometry={generated.body} castShadow receiveShadow>
        <meshPhysicalMaterial
          color={muscle.color}
          map={muscleTexture}
          bumpMap={muscleTexture}
          bumpScale={0.0014}
          roughness={0.68}
          clearcoat={0.035}
          sheen={0.38}
          sheenColor="#ffb6a9"
          sheenRoughness={0.82}
          transparent
          opacity={!active ? 0.035 : xray ? 0.16 : 0.86}
          depthWrite={active && !xray}
          emissive={active && selected === "muscle" ? muscle.color : "#000000"}
          emissiveIntensity={active && selected === "muscle" ? 0.055 : 0}
        />
      </mesh>
      {generated.fibres.map((geometry, index) => (
        <mesh key={index} geometry={geometry}>
          <meshPhysicalMaterial
            color="#f2a091"
            roughness={0.74}
            sheen={0.5}
            sheenColor="#ffd3c8"
            transparent
            opacity={!active ? 0 : xray ? 0.14 : 0.42}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
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
      {musclePaths
        .filter((muscle) => muscle.scope !== "regional" || props.muscleScope === "regional")
        .map((muscle) => <MuscleBundle key={muscle.name} {...props} muscle={muscle} />)}
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
  muscleScope?: MuscleScope;
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
    { label: "RECTUS FEMORIS", position: [0.145, -0.17, 0.07] },
    { label: "VASTUS MEDIALIS", position: [0.105, -0.25, 0.045] },
    { label: "VASTUS LATERALIS", position: [0.19, -0.2, 0.035] },
    { label: "HAMSTRINGS", position: [0.105, -0.25, -0.085] },
    { label: "GASTROCNEMIUS", position: [0.15, -0.61, -0.09] },
  ],
};

function AnatomyLabels({ selected, muscleScope }: { selected: StructureKey; muscleScope: MuscleScope }) {
  const labels = selected === "muscle" && muscleScope === "regional"
    ? [
        { label: "GASTROCNEMIUS", position: [0.15, -0.61, -0.09] as [number, number, number] },
        { label: "SOLEUS", position: [0.15, -0.66, -0.105] as [number, number, number] },
        { label: "TIBIALIS ANTERIOR", position: [0.18, -0.62, 0.065] as [number, number, number] },
        { label: "FIBULARIS LONGUS", position: [0.215, -0.59, -0.01] as [number, number, number] },
      ]
    : labelsByStructure[selected];
  return (
    <group>
      {labels.map((item) => (
        <Html
          key={item.label}
          position={item.position}
          center
          sprite
          distanceFactor={3}
          zIndexRange={[30, 10]}
          className="anatomy-label-wrap"
          style={{ pointerEvents: "none" }}
        >
          <span className="anatomy-label"><i aria-hidden="true" />{item.label}</span>
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
  muscleScope = "knee",
}: KneeModelProps) {
  const group = useRef<THREE.Group>(null);
  const { scene } = useGLTF(`${import.meta.env.BASE_URL}models/knee.glb`);
  const surfaceTextures = useMemo(
    () => ({
      bone: createTissueTexture("bone"),
      meniscus: createTissueTexture("meniscus"),
      cartilage: createTissueTexture("cartilage"),
      ligament: createTissueTexture("ligament"),
      muscle: createTissueTexture("muscle"),
    }),
    [],
  );

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
        map: surfaceTextures[category],
        bumpMap: surfaceTextures[category],
        bumpScale: category === "bone" ? 0.00055 : category === "meniscus" ? 0.00034 : 0.00012,
        roughness: category === "bone" ? 0.48 : category === "meniscus" ? 0.34 : 0.16,
        metalness: 0,
        clearcoat: category === "bone" ? 0.12 : 0.68,
        clearcoatRoughness: category === "cartilage" ? 0.14 : 0.3,
        transmission: category === "bone" ? 0 : category === "cartilage" ? 0.16 : 0.06,
        thickness: category === "cartilage" ? 0.025 : 0.008,
        ior: category === "cartilage" ? 1.42 : 1.5,
        sheen: category === "meniscus" ? 0.42 : 0.12,
        sheenColor: new THREE.Color(category === "meniscus" ? "#dbe3ff" : "#ffffff"),
        sheenRoughness: 0.6,
        transparent: true,
        opacity: category === "cartilage" ? 0.72 : 0.98,
        side: THREE.DoubleSide,
      });
    });
    return cloned;
  }, [scene, surfaceTextures]);

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
          color: trailProgress === 0 ? "#dce7ff" : "#b9efff",
          wireframe: true,
          transparent: true,
          opacity: 0.025,
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
      Object.values(surfaceTextures).forEach((texture) => texture.dispose());
    };
  }, [model, motionGhosts, surfaceTextures]);

  useFrame((_state, delta) => {
    if (!group.current) return;
    const ease = 1 - Math.pow(0.001, delta);

    const bend = THREE.MathUtils.degToRad(flexion * -0.58);
    const pivotShift = pivot.clone().sub(pivot.clone().applyEuler(new THREE.Euler(bend, 0, 0)));

    motionGhosts.forEach((ghost) => {
      const trailProgress = ghost.userData.trailProgress as number;
      ghost.visible = showMotionGhost && flexion > 8;
      const trailBend = bend * trailProgress;
      const trailPivotShift = pivot.clone().sub(pivot.clone().applyEuler(new THREE.Euler(trailBend, 0, 0)));
      ghost.traverse((object) => {
        if (!(object instanceof THREE.Mesh) || !object.visible) return;
        const basePosition = object.userData.basePosition as THREE.Vector3;
        const baseRotation = object.userData.baseRotation as THREE.Euler;
        object.position.copy(basePosition).add(trailPivotShift);
        object.rotation.x = baseRotation.x + trailBend;
        (object.material as THREE.MeshBasicMaterial).opacity =
          0.012 + (1 - trailProgress) * 0.025 + (flexion / 130) * 0.015;
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
            muscleScope={muscleScope}
            onSelect={onSelect}
            onHover={onHover}
          />
          {showLabels && <AnatomyLabels selected={selected} muscleScope={muscleScope} />}
        </group>
      </Center>
    </group>
  );
}

function Scene({ stableView = false, ...props }: KneeModelProps & { stableView?: boolean }) {
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
        <Float
          speed={stableView ? 0 : 0.85}
          rotationIntensity={stableView ? 0 : 0.025}
          floatIntensity={stableView ? 0 : 0.06}
        >
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
        enableDamping
        dampingFactor={0.09}
        rotateSpeed={0.48}
        zoomSpeed={0.7}
        minPolarAngle={Math.PI * 0.25}
        maxPolarAngle={Math.PI * 0.75}
        minAzimuthAngle={-Math.PI * 0.72}
        maxAzimuthAngle={Math.PI * 0.72}
        mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }}
        touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
        onStart={() => document.body.classList.add("is-orbiting")}
        onEnd={() => document.body.classList.remove("is-orbiting")}
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
  const [motionView, setMotionView] = useState<MotionView>("side");
  const [showLabels, setShowLabels] = useState(true);
  const [tensionMap, setTensionMap] = useState(false);
  const [aclState, setAclState] = useState<AclState>("normal");
  const [muscleScope, setMuscleScope] = useState<MuscleScope>("knee");
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

  const setMotionViewPreset = (view: MotionView) => {
    setMotionView(view);
    setMotionViewKey((value) => value + 1);
  };

  const motionViewRotation: Record<MotionView, number> = {
    side: -Math.PI / 2,
    quarter: -Math.PI / 4,
    front: 0,
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
              muscleScope={muscleScope}
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
            {selected === "muscle" && (
              <div className="origin-disclaimer">
                <span>PROXIMAL PATHS ARE CROPPED</span>
                <p>Rectus femoris continues to the pelvis; biceps femoris long head, semitendinosus and semimembranosus continue to the ischial tuberosity.</p>
              </div>
            )}
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
            {selected === "muscle" && (
              <button
                type="button"
                className={muscleScope === "regional" ? "active" : ""}
                onClick={() => setMuscleScope((value) => value === "knee" ? "regional" : "knee")}
              >
                {muscleScope === "regional" ? "Regional on" : "Regional"}
              </button>
            )}
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
                <div className="view-presets" role="group" aria-label="Model view">
                  {(["side", "quarter", "front"] as MotionView[]).map((view) => (
                    <button
                      key={view}
                      type="button"
                      className={motionView === view ? "active" : ""}
                      aria-pressed={motionView === view}
                      onClick={() => setMotionViewPreset(view)}
                    >
                      {view === "quarter" ? "3/4" : view}
                    </button>
                  ))}
                </div>
              </div>
              <div className="motion-canvas" aria-label="Live knee flexion model">
                <Scene
                  key={motionViewKey}
                  selected={selected}
                  xray={xray}
                  exploded={exploded}
                  flexion={flexion}
                  muscleScope={muscleScope}
                  onSelect={setSelected}
                  onHover={setHovered}
                  viewRotation={motionViewRotation[motionView]}
                  stableView
                  showMotionGhost
                  showLabels={showLabels}
                  tensionMap={tensionMap}
                  aclState={aclState}
                />
                <div className="motion-scan-beam" aria-hidden="true" />
                {flexion > 8 && <div className="motion-ghost-key" aria-hidden="true"><i /> Light motion trail · extension reference</div>}
                <div className="orbit-hint" aria-hidden="true">DRAG · ROTATE&nbsp;&nbsp; / &nbsp;&nbsp;WHEEL · ZOOM</div>
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

              {selected === "muscle" && (
                <div className="muscle-scope-control">
                  <div className="injury-head">
                    <p>MUSCLE SCOPE</p>
                    <span>ANATOMY LAYER</span>
                  </div>
                  <div className="scope-options" role="group" aria-label="Choose muscle display scope">
                    <button type="button" className={muscleScope === "knee" ? "active" : ""} onClick={() => setMuscleScope("knee")}>Knee mechanics</button>
                    <button type="button" className={muscleScope === "regional" ? "active" : ""} onClick={() => setMuscleScope("regional")}>Regional anatomy</button>
                  </div>
                  <p>
                    {muscleScope === "knee"
                      ? "Shows muscles that cross or directly control the knee. Upper paths continue beyond this cropped model."
                      : "Adds proximal lower-leg muscles for regional completeness; several primarily act on the ankle."}
                  </p>
                </div>
              )}

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
                  muscleScope={muscleScope}
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
