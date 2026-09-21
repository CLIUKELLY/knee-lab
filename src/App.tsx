import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Bounds, Center, Float, Html, OrbitControls, Sparkles, useGLTF } from "@react-three/drei";
import { Canvas, ThreeEvent, useFrame } from "@react-three/fiber";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import * as THREE from "three";
import {
  anatomyEntities,
  entityById,
  entityIdForModelName,
  movementPresets,
  structureByKey,
  structures,
  type AclState,
  type MuscleScope,
  type MovementPreset,
  type StructureKey,
} from "./anatomy/data";
import { usePerformanceMode } from "./hooks/usePerformanceMode";
import { useVisibleCanvas } from "./hooks/useVisibleCanvas";

gsap.registerPlugin(ScrollTrigger);

type TissueKey = Exclude<StructureKey, "all">;
type FlexionRef = { current: number };

const palette: Record<TissueKey, string> = {
  bone: "#eeeaf2",
  meniscus: "#a9b7ff",
  cartilage: "#69d2ff",
  ligament: "#f0cf86",
  muscle: "#db7f78",
};

const MOTION_DURATION_SCALE = 3;

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

function bendStableGeometry(geometry: THREE.BufferGeometry, flexion: number) {
  if (geometry.userData.lastFlexion === flexion) return;
  const position = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!position) return;

  if (!geometry.userData.basePositions) {
    geometry.userData.basePositions = new Float32Array(position.array as ArrayLike<number>);
    const normal = geometry.getAttribute("normal") as THREE.BufferAttribute | undefined;
    if (normal) geometry.userData.baseNormals = new Float32Array(normal.array as ArrayLike<number>);
  }

  const basePositions = geometry.userData.basePositions as Float32Array;
  const baseNormals = geometry.userData.baseNormals as Float32Array | undefined;
  const normal = geometry.getAttribute("normal") as THREE.BufferAttribute | undefined;
  const maxBend = THREE.MathUtils.degToRad(flexion * -0.58);

  for (let index = 0; index < position.count; index += 1) {
    const offset = index * 3;
    const x = basePositions[offset];
    const y = basePositions[offset + 1];
    const z = basePositions[offset + 2];
    const weight = THREE.MathUtils.smoothstep(pivot.y - y, 0.005, 0.115);
    const bend = maxBend * weight;
    const cosine = Math.cos(bend);
    const sine = Math.sin(bend);
    const relativeY = y - pivot.y;
    const relativeZ = z - pivot.z;

    position.setXYZ(
      index,
      x,
      pivot.y + relativeY * cosine - relativeZ * sine,
      pivot.z + relativeY * sine + relativeZ * cosine,
    );

    if (normal && baseNormals) {
      const normalX = baseNormals[offset];
      const normalY = baseNormals[offset + 1];
      const normalZ = baseNormals[offset + 2];
      normal.setXYZ(index, normalX, normalY * cosine - normalZ * sine, normalY * sine + normalZ * cosine);
    }
  }

  position.needsUpdate = true;
  if (normal) normal.needsUpdate = true;
  geometry.userData.lastFlexion = flexion;
}

type StrandProps = {
  name: string;
  points: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
  lowerPoint?: boolean;
  radius?: number;
  category?: "ligament";
  selected: StructureKey;
  selectedEntity: string | null;
  xray: boolean;
  exploded: boolean;
  explodeAmount?: number;
  flexion: number;
  renderedFlexion: FlexionRef;
  tensionMap?: boolean;
  aclState?: AclState;
  onSelect: (key: StructureKey) => void;
  onEntitySelect: (id: string | null) => void;
  onHover: (label: string | null) => void;
};

function SoftStrand({
  name,
  points,
  lowerPoint = true,
  radius = 0.003,
  category = "ligament",
  selected,
  selectedEntity,
  xray,
  exploded,
  explodeAmount,
  flexion,
  renderedFlexion,
  tensionMap = false,
  aclState = "normal",
  onSelect,
  onEntitySelect,
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
    const updated = points.map((point) => point.clone());
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
  }, [aclState, explosion, isAcl, isTorn, points, radius]);

  const fascicleGeometries = useMemo(() => {
    const offsets = [
      new THREE.Vector3(-radius * 0.34, 0, 0),
      new THREE.Vector3(radius * 0.34, 0, 0),
      new THREE.Vector3(0, 0, -radius * 0.3),
      new THREE.Vector3(0, 0, radius * 0.3),
    ];

    return offsets.flatMap((offset, offsetIndex) => {
      const updated = points.map((point, index) => {
        const moved = point.clone();
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
  }, [aclState, explosion, isAcl, isTorn, points, radius]);

  useEffect(() => () => geometries.forEach((geometry) => geometry.dispose()), [geometries]);
  useEffect(() => () => fascicleGeometries.forEach((geometry) => geometry.dispose()), [fascicleGeometries]);
  const entityId = entityIdForModelName(name);
  const active = selected === "all" || (selected === category && (!selectedEntity || selectedEntity === entityId));
  const fibreTexture = useMemo(() => createTissueTexture("ligament"), []);
  useEffect(() => () => fibreTexture.dispose(), [fibreTexture]);
  useFrame((state) => {
    if (lowerPoint) {
      geometries.forEach((geometry) => bendStableGeometry(geometry, renderedFlexion.current));
      fascicleGeometries.forEach((geometry) => bendStableGeometry(geometry, renderedFlexion.current));
    }
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
        onEntitySelect(entityId);
      }}
    >
      {geometries.map((geometry, index) => (
        <mesh key={index} geometry={geometry} castShadow frustumCulled={false}>
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
            transparent={!active || xray}
            opacity={!active ? 0.055 : xray ? 0.9 : 1}
            depthWrite={active && !xray}
            emissive={active && (tensionMap || selected === category || (isAcl && aclState !== "normal")) ? color : "#000000"}
            emissiveIntensity={active ? (tensionMap ? 0.18 + load * 0.65 : isAcl && aclState !== "normal" ? 0.6 : selected === category ? 0.16 : 0) : 0}
          />
        </mesh>
      ))}
      {fascicleGeometries.map((geometry, index) => (
        <mesh key={`fascicle-${index}`} geometry={geometry} frustumCulled={false} renderOrder={2}>
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

function MuscleBundle({ muscle, selected, selectedEntity, xray, exploded, explodeAmount, renderedFlexion, onSelect, onEntitySelect, onHover }: { muscle: MusclePath; renderedFlexion: FlexionRef } & Pick<KneeModelProps, "selected" | "selectedEntity" | "xray" | "exploded" | "explodeAmount" | "onSelect" | "onEntitySelect" | "onHover">) {
  const entityId = entityIdForModelName(muscle.name);
  const active = selected === "all" || (selected === "muscle" && (!selectedEntity || selectedEntity === entityId));
  const explosion = explodeAmount ?? (exploded ? 1 : 0);
  const muscleTexture = useMemo(() => createTissueTexture("muscle"), []);
  const generated = useMemo(() => {
    const points = muscle.points.map((point) => {
      const vector = new THREE.Vector3(...point);
      return vector.add(new THREE.Vector3(0, 0, -0.035 * explosion));
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
  }, [explosion, muscle]);

  useEffect(() => () => {
    generated.body.dispose();
    generated.fibres.forEach((geometry) => geometry.dispose());
  }, [generated]);
  useEffect(() => () => muscleTexture.dispose(), [muscleTexture]);
  useFrame(() => {
    if (!muscle.lowerMode) return;
    bendStableGeometry(generated.body, renderedFlexion.current);
    generated.fibres.forEach((geometry) => bendStableGeometry(geometry, renderedFlexion.current));
  });

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
        onEntitySelect(entityId);
      }}
    >
      <mesh geometry={generated.body} castShadow receiveShadow frustumCulled={false}>
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
          transparent={!active || xray}
          opacity={!active ? 0.035 : xray ? 0.16 : 1}
          depthWrite={active && !xray}
          emissive={active && selected === "muscle" ? muscle.color : "#000000"}
          emissiveIntensity={active && selectedEntity === entityId ? 0.22 : active && selected === "muscle" ? 0.055 : 0}
        />
      </mesh>
      {generated.fibres.map((geometry, index) => (
        <mesh key={index} geometry={geometry} frustumCulled={false} renderOrder={2}>
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

function SoftTissues(props: KneeModelProps & { renderedFlexion: FlexionRef }) {
  const strands = useMemo<Omit<StrandProps, keyof KneeModelProps | "renderedFlexion">[]>(() => {
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    return [
      { name: "ACL · Anterior cruciate ligament", points: [v(0.166, -0.397, -0.032), v(0.148, -0.414, -0.012), v(0.132, -0.438, -0.004)], radius: 0.0034 },
      { name: "PCL · Posterior cruciate ligament", points: [v(0.128, -0.399, -0.031), v(0.139, -0.419, -0.038), v(0.154, -0.437, -0.031)], radius: 0.0038 },
      { name: "MCL · Medial collateral ligament", points: [v(0.093, -0.391, -0.018), v(0.091, -0.434, -0.012), v(0.103, -0.502, -0.004)], radius: 0.0031 },
      { name: "LCL · Lateral collateral ligament", points: [v(0.179, -0.386, -0.021), v(0.192, -0.431, -0.027), v(0.206, -0.471, -0.035)], radius: 0.0028 },
      { name: "Quadriceps tendon", points: [v(0.145, -0.285, 0.042), v(0.149, -0.324, 0.047), v(0.151, -0.361, 0.045)], lowerPoint: false, radius: 0.0062 },
      { name: "Patellar tendon", points: [v(0.151, -0.407, 0.044), v(0.153, -0.454, 0.034), v(0.157, -0.505, 0.015)], radius: 0.006 },
    ];
  }, []);

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
  selectedEntity: string | null;
  xray: boolean;
  exploded: boolean;
  explodeAmount?: number;
  flexion: number;
  flexionSource?: FlexionRef;
  onSelect: (key: StructureKey) => void;
  onEntitySelect: (id: string | null) => void;
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

const entityLabelPositions: Record<string, { label: string; position: [number, number, number] }> = {
  acl: { label: "ACL", position: [0.15, -0.415, -0.005] },
  pcl: { label: "PCL", position: [0.14, -0.42, -0.04] },
  mcl: { label: "MCL", position: [0.09, -0.44, -0.01] },
  lcl: { label: "LCL", position: [0.195, -0.43, -0.03] },
  "rectus-femoris": { label: "RECTUS FEMORIS", position: [0.145, -0.17, 0.07] },
  "vastus-medialis": { label: "VASTUS MEDIALIS", position: [0.105, -0.25, 0.045] },
  "vastus-lateralis": { label: "VASTUS LATERALIS", position: [0.19, -0.2, 0.035] },
  "biceps-femoris": { label: "BICEPS FEMORIS", position: [0.195, -0.27, -0.085] },
  semitendinosus: { label: "SEMITENDINOSUS", position: [0.1, -0.28, -0.09] },
  gastrocnemius: { label: "GASTROCNEMIUS", position: [0.15, -0.61, -0.09] },
};

function AnatomyLabels({ selected, selectedEntity, muscleScope }: { selected: StructureKey; selectedEntity: string | null; muscleScope: MuscleScope }) {
  const labels = selectedEntity && entityLabelPositions[selectedEntity]
    ? [entityLabelPositions[selectedEntity]]
    : selected === "muscle" && muscleScope === "regional"
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
  selectedEntity,
  xray,
  exploded,
  explodeAmount,
  flexion,
  flexionSource,
  onSelect,
  onEntitySelect,
  onHover,
  viewRotation = -0.2,
  showMotionGhost = false,
  showLabels = false,
  tensionMap = false,
  aclState = "normal",
  muscleScope = "knee",
}: KneeModelProps) {
  const group = useRef<THREE.Group>(null);
  const renderedFlexion = useRef(flexion);
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
    if (!showMotionGhost) return [];
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
  }, [scene, showMotionGhost]);

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
    const targetFlexion = flexionSource?.current ?? flexion;
    renderedFlexion.current = THREE.MathUtils.damp(renderedFlexion.current, targetFlexion, 22, delta);
    const visualFlexion = renderedFlexion.current;

    const bend = THREE.MathUtils.degToRad(visualFlexion * -0.58);
    const pivotShift = pivot.clone().sub(pivot.clone().applyEuler(new THREE.Euler(bend, 0, 0)));

    if (showMotionGhost) {
      motionGhosts.forEach((ghost) => {
        const trailProgress = ghost.userData.trailProgress as number;
        ghost.visible = true;
        const trailBend = bend * trailProgress;
        const trailPivotShift = pivot.clone().sub(pivot.clone().applyEuler(new THREE.Euler(trailBend, 0, 0)));
        ghost.traverse((object) => {
          if (!(object instanceof THREE.Mesh) || !object.visible) return;
          const basePosition = object.userData.basePosition as THREE.Vector3;
          const baseRotation = object.userData.baseRotation as THREE.Euler;
          object.position.copy(basePosition).add(trailPivotShift);
          object.rotation.x = baseRotation.x + trailBend;
          const reveal = THREE.MathUtils.smoothstep(visualFlexion, 2, 24);
          (object.material as THREE.MeshBasicMaterial).opacity =
            reveal * (0.008 + (1 - trailProgress) * 0.02 + (visualFlexion / 130) * 0.012);
        });
      });
    }

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
      object.position.copy(targetPosition);
      object.rotation.x = baseRotation.x + (isLowerLeg ? bend : 0);

      const defaultOpacity = category === "cartilage" ? 0.68 : 1;
      const xrayOpacity = category === "bone" ? 0.12 : 0.84;
      const targetOpacity = !active ? 0.055 : xray ? xrayOpacity : defaultOpacity;
      const shouldBeTransparent = !active || xray || category === "cartilage";
      if (material.transparent !== shouldBeTransparent) {
        material.transparent = shouldBeTransparent;
        material.needsUpdate = true;
      }
      material.opacity = THREE.MathUtils.lerp(material.opacity, targetOpacity, ease);
      material.depthWrite = !shouldBeTransparent;
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
            selectedEntity={selectedEntity}
            xray={xray}
            exploded={exploded}
            explodeAmount={explodeAmount}
            flexion={flexion}
            renderedFlexion={renderedFlexion}
            tensionMap={tensionMap}
            aclState={aclState}
            muscleScope={muscleScope}
            onSelect={onSelect}
            onEntitySelect={onEntitySelect}
            onHover={onHover}
          />
          {showLabels && <AnatomyLabels selected={selected} selectedEntity={selectedEntity} muscleScope={muscleScope} />}
        </group>
      </Center>
    </group>
  );
}

function Scene({ stableView = false, lockRotation = false, ...props }: KneeModelProps & { stableView?: boolean; lockRotation?: boolean }) {
  const performanceMode = usePerformanceMode();
  const { ref, visible } = useVisibleCanvas("320px 0px");
  return (
    <div ref={ref} className="scene-frame" data-quality={performanceMode}>
      {visible && <Canvas
        camera={{ position: [0.2, 0.05, 3.9], fov: 30 }}
        dpr={performanceMode === "reduced" ? [1, 1.25] : [1, 1.8]}
        frameloop="always"
        gl={{ antialias: performanceMode === "full", alpha: true, powerPreference: "high-performance" }}
      >
        <ambientLight intensity={1.25} />
        <directionalLight position={[3, 4, 5]} intensity={4.2} color="#f4f6ff" />
        <directionalLight position={[-4, 1, -3]} intensity={2.5} color="#69d2ff" />
        <pointLight position={[0, -2, 2]} intensity={1.8} color="#9c8cff" />
        {!stableView && <Sparkles count={performanceMode === "reduced" ? 20 : 75} scale={[3.2, 4.4, 2]} size={1.35} speed={0.18} opacity={0.35} color="#8fb5ff" />}
        <Suspense fallback={<Html center><div className="model-loading">Preparing anatomy</div></Html>}>
          <Float speed={stableView || performanceMode === "reduced" ? 0 : 0.85} rotationIntensity={stableView ? 0 : 0.025} floatIntensity={stableView ? 0 : 0.06}>
            <Bounds fit clip observe margin={1.22}>
              <KneeModel {...props} />
            </Bounds>
          </Float>
        </Suspense>
        <OrbitControls
          makeDefault
          enablePan={false}
          enableZoom
          enableRotate={!lockRotation}
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
          onStart={() => {
            if (!lockRotation) document.body.classList.add("is-orbiting");
          }}
          onEnd={() => document.body.classList.remove("is-orbiting")}
        />
      </Canvas>}
    </div>
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
  const motionFlexion = useRef(0);
  const [selected, setSelected] = useState<StructureKey>("all");
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);
  const [xray, setXray] = useState(false);
  const [exploded, setExploded] = useState(false);
  const [flexion, setFlexion] = useState(0);
  const [hovered, setHovered] = useState<string | null>(null);
  const [quizAnswer, setQuizAnswer] = useState<boolean | null>(null);
  const [showLabels, setShowLabels] = useState(true);
  const [tensionMap, setTensionMap] = useState(false);
  const [aclState, setAclState] = useState<AclState>("normal");
  const [muscleScope, setMuscleScope] = useState<MuscleScope>("knee");
  const [layerProgress, setLayerProgress] = useState(0);
  const [movementId, setMovementId] = useState<MovementPreset["id"]>("manual");
  const performanceMode = usePerformanceMode();
  const active = structureByKey[selected];
  const activeEntity = selectedEntity ? entityById[selectedEntity] : null;
  const activeMovement = movementPresets.find((item) => item.id === movementId) ?? movementPresets[0];
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

  useEffect(() => {
    const preset = movementPresets.find((item) => item.id === movementId);
    if (!preset || preset.id === "manual" || performanceMode === "reduced") return;
    let frame = 0;
    const startedAt = performance.now();
    let lastUpdate = 0;
    const duration = preset.duration * MOTION_DURATION_SCALE;
    const animate = (now: number) => {
      const elapsed = (now - startedAt) % duration;
      const progress = elapsed / duration;
      const segmentCount = preset.keyframes.length - 1;
      const segment = Math.min(segmentCount - 1, Math.floor(progress * segmentCount));
      const localProgress = progress * segmentCount - segment;
      const eased = localProgress * localProgress * (3 - 2 * localProgress);
      const angle = THREE.MathUtils.lerp(preset.keyframes[segment], preset.keyframes[segment + 1], eased);
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

  const selectLayer = (key: StructureKey) => {
    setSelected(key);
    setSelectedEntity(null);
  };

  const selectEntity = (id: string | null) => {
    setSelectedEntity(id);
    if (id) setSelected(entityById[id].layer);
  };

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
              selectedEntity={selectedEntity}
              xray={xray}
              exploded={exploded}
              flexion={0}
              muscleScope={muscleScope}
              onSelect={selectLayer}
              onEntitySelect={selectEntity}
              onHover={setHovered}
            />
            <div className="model-orbit orbit-one" aria-hidden="true" />
            <div className="model-orbit orbit-two" aria-hidden="true" />
            {hovered && <div className="hover-label">{hovered}</div>}
          </div>

          <aside className="structure-panel" aria-live="polite">
            <p>{activeEntity ? `${active.eyebrow} / STRUCTURE` : active.eyebrow}</p>
            <h2>{activeEntity?.shortLabel ?? active.label}</h2>
            <div className="panel-rule" />
            <p className="panel-description">{activeEntity?.role ?? active.description}</p>
            {activeEntity ? (
              <div className="entity-evidence">
                <dl>
                  <div><dt>Origin</dt><dd>{activeEntity.origin}</dd></div>
                  <div><dt>Insertion</dt><dd>{activeEntity.insertion}</dd></div>
                </dl>
                <a href={activeEntity.sourceUrl} target="_blank" rel="noreferrer">{activeEntity.sourceLabel} ↗</a>
                <span>Educational reconstruction · not medical advice</span>
              </div>
            ) : <p className="panel-fact">{active.fact}</p>}
            {selected === "muscle" && !activeEntity && (
              <div className="origin-disclaimer">
                <span>PROXIMAL PATHS ARE CROPPED</span>
                <p>Rectus femoris continues to the pelvis; biceps femoris long head, semitendinosus and semimembranosus continue to the ischial tuberosity.</p>
              </div>
            )}
            {(selected === "ligament" || selected === "muscle") && (
              <div className="entity-picker" role="group" aria-label={`Choose an individual ${selected}`}>
                <button type="button" className={!selectedEntity ? "active" : ""} onClick={() => setSelectedEntity(null)}>All</button>
                {anatomyEntities.filter((entity) => entity.layer === selected).map((entity) => (
                  <button key={entity.id} type="button" className={selectedEntity === entity.id ? "active" : ""} onClick={() => selectEntity(entity.id)}>
                    {entity.shortLabel}
                  </button>
                ))}
              </div>
            )}
          </aside>

          <div className="structure-tabs" role="group" aria-label="Choose anatomical layer">
            {structures.map((structure) => (
              <button
                key={structure.key}
                type="button"
                className={selected === structure.key ? "active" : ""}
                onClick={() => selectLayer(structure.key)}
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
              This simplified motion view stays locked to one side and isolates flexion in a single plane.
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
                <span>FIXED SIDE VIEW</span>
              </div>
              <div className="motion-canvas" aria-label="Live knee flexion model">
                <Scene
                  selected={selected}
                  selectedEntity={selectedEntity}
                  xray={xray}
                  exploded={exploded}
                  flexion={flexion}
                  flexionSource={motionFlexion}
                  muscleScope={muscleScope}
                  onSelect={selectLayer}
                  onEntitySelect={selectEntity}
                  onHover={setHovered}
                  viewRotation={-Math.PI / 2}
                  stableView
                  lockRotation
                  showMotionGhost={movementId === "manual"}
                  showLabels={showLabels}
                  tensionMap={tensionMap}
                  aclState={aclState}
                />
                {movementId === "manual" && flexion > 8 && <div className="motion-ghost-key" aria-hidden="true"><i /> Light motion trail · extension reference</div>}
                <div className="orbit-hint" aria-hidden="true">FIXED VIEW&nbsp;&nbsp; / &nbsp;&nbsp;WHEEL · ZOOM</div>
                <div className="angle-guide" aria-hidden="true">
                  <span>{flexion}°</span>
                </div>
                {hovered && <div className="motion-hover-label">{hovered}</div>}
              </div>
            </div>

            <div className="motion-control">
              <div className="movement-presets">
                <div className="injury-head">
                  <p>MOVEMENT</p>
                  <span>EDUCATIONAL</span>
                </div>
                <div className="preset-options" role="group" aria-label="Choose a movement preset">
                  {movementPresets.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className={movementId === preset.id ? "active" : ""}
                      onClick={() => {
                        setMovementId(preset.id);
                      }}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <p>{performanceMode === "reduced" && movementId !== "manual" ? "Animation is paused because reduced-motion mode is active." : activeMovement.description}</p>
              </div>
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
                onChange={(event) => {
                  setMovementId("manual");
                  const angle = Number(event.target.value);
                  motionFlexion.current = angle;
                  setFlexion(angle);
                }}
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
                      onClick={() => selectLayer(structure.key)}
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
                        setSelectedEntity("acl");
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
                <span>{activeEntity?.shortLabel ?? structureByKey[selected].label}</span>
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
                  selectedEntity={null}
                  xray={false}
                  exploded={false}
                  explodeAmount={layerProgress}
                  flexion={0}
                  muscleScope={muscleScope}
                  onSelect={selectLayer}
                  onEntitySelect={selectEntity}
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
                      selectLayer(structure.key);
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
