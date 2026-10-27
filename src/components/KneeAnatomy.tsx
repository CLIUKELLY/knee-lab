import { useLanguage } from "../i18n/Language";
import { useEffect, useMemo, useRef } from "react";
import { Center, Html, Sparkles, useGLTF } from "@react-three/drei";
import { ThreeEvent, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { anatomyEntities, entityById, entityIdForModelName, structureByKey, type AclState, type MuscleScope, type StructureKey } from "../anatomy/data";
import { pivot, moveWithTibia, moveWithPatella, bendStableGeometry } from "../anatomy/motion";
type TissueKey = Exclude<StructureKey, "all">;
type FlexionRef = {
    current: number;
};
const palette: Record<TissueKey, string> = {
    bone: "#eeeaf2",
    meniscus: "#a9b7ff",
    cartilage: "#69d2ff",
    ligament: "#f0cf86",
    muscle: "#db7f78",
};
const ignoreRaycast: THREE.Mesh["raycast"] = () => { };
function categoryForName(name: string): TissueKey | null {
    const normalized = name.toLowerCase();
    if (normalized.includes("meniscus"))
        return "meniscus";
    if (normalized.includes("cartilage"))
        return "cartilage";
    if (["femur", "tibia", "fibula", "patella"].some((part) => normalized.includes(part)))
        return "bone";
    return null;
}
type TissueTextureKind = "ligament" | "muscle" | "bone" | "cartilage" | "meniscus";
function tissueNoise(x: number, y: number) {
    const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return value - Math.floor(value);
}
export function createTissueTexture(kind: TissueTextureKind) {
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
            }
            else if (kind === "muscle") {
                const fascicle = Math.pow(0.5 + 0.5 * Math.cos(x * 1.12 + Math.sin(y * 0.08)), 5);
                const crossBand = 0.5 + 0.5 * Math.cos(y * 0.72);
                value = 178 + fascicle * 48 + crossBand * 17 + noise * 7;
            }
            else if (kind === "bone") {
                const pore = noise > 0.93 ? -42 : noise * 16;
                value = 220 + pore;
            }
            else if (kind === "meniscus") {
                const lamella = 0.5 + 0.5 * Math.cos(y * 0.42 + Math.sin(x * 0.12));
                value = 202 + lamella * 35 + noise * 8;
            }
            else {
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
    texture.generateMipmaps = true;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.anisotropy = 8;
    const repeat: Record<TissueTextureKind, [
        number,
        number
    ]> = {
        ligament: [2.4, 2.2],
        muscle: [4.5, 2.8],
        bone: [5, 7],
        cartilage: [2, 3],
        meniscus: [3.5, 2.5],
    };
    texture.repeat.set(...repeat[kind]);
    return texture;
}
function createLigamentSurface(curve: THREE.CatmullRomCurve3, segments: number, radius: number, radialSegments: number, name: string) {
    const geometry = new THREE.TubeGeometry(curve, segments, radius, radialSegments, false);
    const position = geometry.getAttribute("position");
    // Collateral ligament and extensor tendons have a broad, flattened profile.
    const flat = /MCL|tendon/i.test(name);
    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const centre = curve.getPointAt(t);
        const flare = 1 + 0.35 * Math.pow(Math.abs(2 * t - 1), 3);
        for (let j = 0; j <= radialSegments; j++) {
            const k = i * (radialSegments + 1) + j;
            position.setXYZ(k, centre.x + (position.getX(k) - centre.x) * flare * (flat ? 1.8 : 1.12), position.getY(k), centre.z + (position.getZ(k) - centre.z) * (flat ? 0.48 : 0.82));
        }
    }
    geometry.computeVertexNormals();
    return geometry;
}
type StrandProps = {
    name: string;
    points: [
        THREE.Vector3,
        THREE.Vector3,
        THREE.Vector3
    ];
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
function SoftStrand({ name, points, lowerPoint = true, radius = 0.003, category = "ligament", selected, selectedEntity, xray, exploded, explodeAmount, flexion, renderedFlexion, tensionMap = false, aclState = "normal", onSelect, onEntitySelect, onHover, }: StrandProps) {
    const { t } = useLanguage();
    const isAcl = name.startsWith("ACL");
    const isTorn = isAcl && aclState === "tear";
    const explosion = explodeAmount ?? (exploded ? 1 : 0);
    const load = useMemo(() => {
        const progress = flexion / 130;
        if (name.startsWith("ACL"))
            return THREE.MathUtils.lerp(0.9, 0.3, Math.min(progress / 0.7, 1));
        if (name.startsWith("PCL"))
            return THREE.MathUtils.lerp(0.2, 0.92, progress);
        if (name.startsWith("MCL"))
            return 0.42 - progress * 0.12;
        if (name.startsWith("LCL"))
            return 0.34 + progress * 0.08;
        return 0.24;
    }, [flexion, name]);
    const geometries = useMemo(() => {
        const updated = points.map((point) => point.clone());
        if (isAcl && aclState === "strain")
            updated[1].add(new THREE.Vector3(0.007, 0, 0.005));
        if (explosion)
            updated.forEach((point) => point.add(new THREE.Vector3(0, 0, 0.025 * explosion)));
        const curve = new THREE.CatmullRomCurve3(updated);
        if (!isTorn)
            return [createLigamentSurface(curve, 48, radius, 16, name)];
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
            if (isAcl && aclState === "strain")
                updated[1].add(new THREE.Vector3(0.007, 0, 0.005));
            if (explosion)
                updated.forEach((point) => point.add(new THREE.Vector3(0, 0, 0.025 * explosion)));
            const curve = new THREE.CatmullRomCurve3(updated);
            const fibreRadius = Math.max(radius * 0.105, 0.00034);
            if (!isTorn)
                return [new THREE.TubeGeometry(curve, 24, fibreRadius, 5, false)];
            return [
                new THREE.TubeGeometry(new THREE.CatmullRomCurve3([curve.getPoint(0), curve.getPoint(0.24), curve.getPoint(0.42)]), 12, fibreRadius, 5, false),
                new THREE.TubeGeometry(new THREE.CatmullRomCurve3([curve.getPoint(0.58), curve.getPoint(0.76), curve.getPoint(1)]), 12, fibreRadius, 5, false),
            ];
        });
    }, [aclState, explosion, isAcl, isTorn, points, radius]);
    // Share one attachment interval across intact/torn pieces and surface fibres.
    // Otherwise each tear fragment would incorrectly acquire two new attachments.
    [...geometries, ...fascicleGeometries].forEach((geometry) => {
        geometry.userData.motionRange = { top: points[0].y, bottom: points[2].y };
    });
    useEffect(() => () => geometries.forEach((geometry) => geometry.dispose()), [geometries]);
    useEffect(() => () => fascicleGeometries.forEach((geometry) => geometry.dispose()), [fascicleGeometries]);
    const entityId = entityIdForModelName(name);
    const active = selected === "all" || (selected === category && (!selectedEntity || selectedEntity === entityId));
    const fibreTexture = useMemo(() => createTissueTexture("ligament"), []);
    useEffect(() => () => fibreTexture.dispose(), [fibreTexture]);
    useFrame((state) => {
        if (lowerPoint || name.startsWith("Quadriceps")) {
            geometries.forEach((geometry) => bendStableGeometry(geometry, renderedFlexion.current, name.startsWith("Patellar") ? "patellar" : name.startsWith("Quadriceps") ? "quadriceps" : "distal"));
            fascicleGeometries.forEach((geometry) => bendStableGeometry(geometry, renderedFlexion.current, name.startsWith("Patellar") ? "patellar" : name.startsWith("Quadriceps") ? "quadriceps" : "distal"));
        }
        fibreTexture.offset.x = tensionMap ? state.clock.elapsedTime * (0.012 + load * 0.018) : 0;
    });
    const heatColor = useMemo(() => new THREE.Color(palette.ligament).lerp(new THREE.Color("#ff456e"), load), [load]);
    const color = isAcl && aclState !== "normal" ? (aclState === "tear" ? "#ff315f" : "#ff775c") : tensionMap ? heatColor : palette[category];
    return (<group name={name} onPointerOver={(event) => {
            event.stopPropagation();
            document.body.style.cursor = "pointer";
            onHover(name);
        }} onPointerOut={() => {
            document.body.style.cursor = "default";
            onHover(null);
        }} onClick={(event) => {
            if (event.delta > 4)
                return;
            event.stopPropagation();
            onSelect(category);
            onEntitySelect(entityId);
        }}>
      {geometries.map((geometry, index) => (<mesh key={index} geometry={geometry} raycast={active ? THREE.Mesh.prototype.raycast : ignoreRaycast} castShadow frustumCulled={false}>
          <meshPhysicalMaterial color={color} map={fibreTexture} bumpMap={fibreTexture} bumpScale={0.00028} roughness={0.46} clearcoat={0.18} sheen={0.72} sheenColor="#fff3d6" sheenRoughness={0.54} transparent={!active || xray} opacity={!active ? 0.055 : xray ? 0.9 : 1} depthWrite={active && !xray} emissive={active && (tensionMap || selected === category || (isAcl && aclState !== "normal")) ? color : "#000000"} emissiveIntensity={active ? (tensionMap ? 0.18 + load * 0.65 : isAcl && aclState !== "normal" ? 0.6 : selected === category ? 0.16 : 0) : 0}/>
        </mesh>))}
      {fascicleGeometries.map((geometry, index) => (<mesh key={`fascicle-${index}`} geometry={geometry} visible={active} raycast={ignoreRaycast} frustumCulled={false} renderOrder={2}>
          <meshPhysicalMaterial color={color} map={fibreTexture} roughness={0.5} sheen={0.9} sheenColor="#fff9e8" sheenRoughness={0.4} transparent opacity={!active ? 0 : xray ? 0.36 : 0.58} depthWrite={false} emissive={tensionMap || (isAcl && aclState !== "normal") ? color : "#000000"} emissiveIntensity={tensionMap ? 0.22 + load * 0.42 : isAcl && aclState !== "normal" ? 0.3 : 0}/>
        </mesh>))}
      {isTorn && active && <Sparkles count={12} position={[0.15, -0.418, -0.01]} scale={0.035} size={1.8} speed={0.8} color="#ff5278"/>}
    </group>);
}
type MusclePath = {
    name: string;
    points: [
        number,
        number,
        number
    ][];
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
    const belly = Math.pow(Math.max(0, Math.sin(Math.PI * THREE.MathUtils.smoothstep(t, 0.06, 0.94))), 0.8);
    const asymmetry = 0.92 + 0.08 * Math.sin((t - 0.18) * Math.PI);
    return radius * (0.09 + belly * 0.91) * asymmetry;
}
function createMuscleSurface(curve: THREE.CatmullRomCurve3, radius: number, depth: number) {
    const segments = 56;
    const radialSegments = 24;
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
function MuscleBundle({ muscle, selected, selectedEntity, xray, exploded, explodeAmount, renderedFlexion, onSelect, onEntitySelect, onHover }: {
    muscle: MusclePath;
    renderedFlexion: FlexionRef;
} & Pick<KneeModelProps, "selected" | "selectedEntity" | "xray" | "exploded" | "explodeAmount" | "onSelect" | "onEntitySelect" | "onHover">) {
    const { t } = useLanguage();
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
        const colours: number[] = [];
        const baseColour = new THREE.Color(muscle.color);
        const tendonColour = new THREE.Color("#e6d8bf");
        const uv = surface.geometry.getAttribute("uv");
        for (let i = 0; i < uv.count; i++) {
            const t = uv.getY(i);
            const tendon = 1 - THREE.MathUtils.smoothstep(Math.min(t, 1 - t), 0.035, 0.22);
            const colour = baseColour.clone().lerp(tendonColour, tendon * 0.9);
            colours.push(colour.r, colour.g, colour.b);
        }
        surface.geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
        const fibres = Array.from({ length: 10 }, (_, fibreIndex) => {
            const baseAngle = (fibreIndex / 10) * Math.PI * 2;
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
            return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(fibrePoints), 22, Math.max(0.0003, muscle.radius * 0.018), 4, false);
        });
        return { body: surface.geometry, fibres };
    }, [explosion, muscle]);
    useEffect(() => () => {
        generated.body.dispose();
        generated.fibres.forEach((geometry) => geometry.dispose());
    }, [generated]);
    useEffect(() => () => muscleTexture.dispose(), [muscleTexture]);
    useFrame(() => {
        const mode = muscle.lowerMode === "all" && muscle.scope === "regional" && muscle.name !== "Plantaris"
            ? "rigid" : muscle.lowerMode ?? "quadriceps";
        bendStableGeometry(generated.body, renderedFlexion.current, mode);
        generated.fibres.forEach((geometry) => bendStableGeometry(geometry, renderedFlexion.current, mode));
    });
    return (<group name={muscle.name} onPointerOver={(event) => {
            event.stopPropagation();
            document.body.style.cursor = "pointer";
            onHover(muscle.name);
        }} onPointerOut={() => {
            document.body.style.cursor = "default";
            onHover(null);
        }} onClick={(event) => {
            if (event.delta > 4)
                return;
            event.stopPropagation();
            onSelect("muscle");
            onEntitySelect(entityId);
        }}>
      <mesh geometry={generated.body} raycast={active ? THREE.Mesh.prototype.raycast : ignoreRaycast} castShadow receiveShadow frustumCulled={false}>
        <meshPhysicalMaterial color="#ffffff" vertexColors map={muscleTexture} bumpMap={muscleTexture} bumpScale={0.00045} roughness={0.68} clearcoat={0.035} sheen={0.38} sheenColor="#ffb6a9" sheenRoughness={0.82} transparent={!active || xray} opacity={!active ? 0.035 : xray ? 0.16 : 1} depthWrite={active && !xray} emissive={active && selected === "muscle" ? muscle.color : "#000000"} emissiveIntensity={active && selectedEntity === entityId ? 0.22 : active && selected === "muscle" ? 0.055 : 0}/>
      </mesh>
      {generated.fibres.map((geometry, index) => (<mesh key={index} geometry={geometry} visible={active} raycast={ignoreRaycast} frustumCulled={false} renderOrder={2}>
          <meshPhysicalMaterial color="#f2a091" roughness={0.74} sheen={0.5} sheenColor="#ffd3c8" transparent opacity={!active ? 0 : xray ? 0.14 : 0.42} depthWrite={false}/>
        </mesh>))}
    </group>);
}
function SoftTissues(props: KneeModelProps & {
    renderedFlexion: FlexionRef;
}) {
    const { t } = useLanguage();
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
    return (<group>
      {strands.map((strand) => <SoftStrand key={strand.name} {...props} {...strand}/>)}
      {musclePaths
            .filter((muscle) => muscle.scope !== "regional" || props.muscleScope === "regional")
            .map((muscle) => <MuscleBundle key={muscle.name} {...props} muscle={muscle}/>)}
    </group>);
}
function isAnnotation(name: string) {
    const normalized = name.toLowerCase();
    return ["enthesis", "condyle", "surface", "fossa", "point", "perichondular"].some((term) => normalized.includes(term));
}
export type KneeModelProps = {
    selected: StructureKey;
    selectedEntity: string | null;
    xray: boolean;
    exploded: boolean;
    explodeAmount?: number;
    flexion: number;
    flexionSource?: FlexionRef;
    boneContextOpacity?: number;
    onSelect: (key: StructureKey) => void;
    onEntitySelect: (id: string | null) => void;
    onHover: (label: string | null) => void;
    viewRotation?: number;
    showMotionGhost?: boolean;
    showLabels?: boolean;
    tensionMap?: boolean;
    aclState?: AclState;
    muscleScope?: MuscleScope;
    anatomicalSpace?: boolean;
};
const labelsByStructure: Record<StructureKey, {
    label: string;
    position: [
        number,
        number,
        number
    ];
}[]> = {
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
const entityLabelPositions: Record<string, {
    label: string;
    position: [
        number,
        number,
        number
    ];
}> = {
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
function AnatomyLabels({ selected, selectedEntity, muscleScope, renderedFlexion, distanceFactor = 3 }: {
    selected: StructureKey;
    selectedEntity: string | null;
    muscleScope: MuscleScope;
    renderedFlexion: FlexionRef;
    distanceFactor?: number;
}) {
    const { t } = useLanguage();
    const group = useRef<THREE.Group>(null);
    useFrame(() => {
        group.current?.children.forEach((child, index) => {
            const item = labels[index];
            if (!item)
                return;
            const point = new THREE.Vector3(...item.position);
            if (/PATELLA/.test(item.label))
                moveWithPatella(point, renderedFlexion.current);
            else if (/TIBIA|MENISC|SOLEUS|GASTROCNEMIUS|FIBULARIS/.test(item.label))
                moveWithTibia(point, renderedFlexion.current);
            else if (/ACL|PCL|MCL|LCL/.test(item.label))
                point.lerp(moveWithTibia(point.clone(), renderedFlexion.current), 0.5);
            child.position.copy(point);
        });
    });
    const labels = selectedEntity && entityLabelPositions[selectedEntity]
        ? [entityLabelPositions[selectedEntity]]
        : selected === "muscle" && muscleScope === "regional"
            ? [
                { label: "GASTROCNEMIUS", position: [0.15, -0.61, -0.09] as [
                        number,
                        number,
                        number
                    ] },
                { label: "SOLEUS", position: [0.15, -0.66, -0.105] as [
                        number,
                        number,
                        number
                    ] },
                { label: "TIBIALIS ANTERIOR", position: [0.18, -0.62, 0.065] as [
                        number,
                        number,
                        number
                    ] },
                { label: "FIBULARIS LONGUS", position: [0.215, -0.59, -0.01] as [
                        number,
                        number,
                        number
                    ] },
            ]
            : labelsByStructure[selected];
    return (<group ref={group}>
      {labels.map((item) => (<Html key={item.label} position={item.position} center sprite distanceFactor={distanceFactor} zIndexRange={[30, 10]} className="anatomy-label-wrap" style={{ pointerEvents: "none" }}>
          <span className="anatomy-label"><i aria-hidden="true"/>{t(item.label)}</span>
        </Html>))}
    </group>);
}
export function KneeModel({ selected, selectedEntity, xray, exploded, explodeAmount, flexion, flexionSource, onSelect, onEntitySelect, onHover, viewRotation = -0.2, boneContextOpacity = 0.055, showMotionGhost = false, showLabels = false, tensionMap = false, aclState = "normal", muscleScope = "knee", anatomicalSpace = false, }: KneeModelProps) {
    const { t } = useLanguage();
    const group = useRef<THREE.Group>(null);
    const renderedFlexion = useRef(flexion);
    const { scene } = useGLTF(`${import.meta.env.BASE_URL}models/knee.glb`);
    const surfaceTextures = useMemo(() => ({
        bone: createTissueTexture("bone"),
        meniscus: createTissueTexture("meniscus"),
        cartilage: createTissueTexture("cartilage"),
        ligament: createTissueTexture("ligament"),
        muscle: createTissueTexture("muscle"),
    }), []);
    const model = useMemo(() => {
        const cloned = scene.clone(true);
        cloned.traverse((object) => {
            if (!(object instanceof THREE.Mesh))
                return;
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
        if (!showMotionGhost)
            return [];
        return [0, 0.34, 0.68].map((trailProgress) => {
            const cloned = scene.clone(true);
            cloned.userData.trailProgress = trailProgress;
            cloned.traverse((object) => {
                if (!(object instanceof THREE.Mesh))
                    return;
                const isLowerLegBone = /tibia|fibula/i.test(object.name) && !isAnnotation(object.name);
                object.visible = isLowerLegBone;
                object.raycast = () => undefined;
                object.userData.basePosition = object.position.clone();
                object.userData.baseRotation = object.rotation.clone();
                if (!isLowerLegBone)
                    return;
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
                if (object instanceof THREE.Mesh && object.visible)
                    object.material.dispose();
            });
        };
    }, [model]);
    useEffect(() => () => {
        motionGhosts.forEach((ghost) => ghost.traverse((object) => {
            if (object instanceof THREE.Mesh && object.visible)
                object.material.dispose();
        }));
    }, [motionGhosts]);
    useEffect(() => () => Object.values(surfaceTextures).forEach((texture) => texture.dispose()), [surfaceTextures]);
    useFrame((_state, delta) => {
        if (!group.current)
            return;
        const ease = 1 - Math.pow(0.001, delta);
        const targetFlexion = flexionSource?.current ?? flexion;
        renderedFlexion.current = anatomicalSpace ? targetFlexion : THREE.MathUtils.damp(renderedFlexion.current, targetFlexion, 22, delta);
        if (Math.abs(renderedFlexion.current - targetFlexion) < 0.01)
            renderedFlexion.current = targetFlexion;
        const visualFlexion = renderedFlexion.current;
        const bend = THREE.MathUtils.degToRad(visualFlexion);
        const pivotShift = pivot.clone().sub(pivot.clone().applyEuler(new THREE.Euler(bend, 0, 0)));
        if (showMotionGhost) {
            motionGhosts.forEach((ghost) => {
                const trailProgress = ghost.userData.trailProgress as number;
                ghost.visible = true;
                const trailBend = bend * trailProgress;
                const trailPivotShift = pivot.clone().sub(pivot.clone().applyEuler(new THREE.Euler(trailBend, 0, 0)));
                ghost.traverse((object) => {
                    if (!(object instanceof THREE.Mesh) || !object.visible)
                        return;
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
            if (!(object instanceof THREE.Mesh) || !object.visible)
                return;
            const category = object.userData.category as TissueKey;
            const material = object.material as THREE.MeshPhysicalMaterial;
            const active = selected === "all" || selected === category;
            object.raycast = active ? THREE.Mesh.prototype.raycast : ignoreRaycast;
            const isLowerLeg = /tibia|fibula|meniscus/i.test(object.name);
            const isPatella = /patella/i.test(object.name);
            const basePosition = object.userData.basePosition as THREE.Vector3;
            const baseRotation = object.userData.baseRotation as THREE.Euler;
            const targetPosition = basePosition.clone();
            if (explosion) {
                if (/femur/i.test(object.name))
                    targetPosition.x -= 0.12 * explosion;
                if (/tibia/i.test(object.name))
                    targetPosition.x += 0.12 * explosion;
                if (/fibula/i.test(object.name))
                    targetPosition.x += 0.24 * explosion;
                if (/patella/i.test(object.name))
                    targetPosition.z += 0.18 * explosion;
                if (category === "meniscus")
                    targetPosition.x += 0.06 * explosion;
                if (category === "cartilage")
                    targetPosition.x -= 0.04 * explosion;
            }
            if (isLowerLeg)
                targetPosition.add(pivotShift);
            if (isPatella) {
                const patellaBend = bend * 0.62;
                targetPosition.add(pivot.clone().sub(pivot.clone().applyEuler(new THREE.Euler(patellaBend, 0, 0))));
            }
            object.position.copy(targetPosition);
            object.rotation.x = baseRotation.x + (isLowerLeg ? bend : isPatella ? bend * 0.62 : 0);
            const defaultOpacity = category === "cartilage" ? 0.68 : 1;
            const xrayOpacity = category === "bone" ? 0.12 : 0.84;
            const targetOpacity = !active ? (category === "bone" ? boneContextOpacity : 0.055) : xray ? xrayOpacity : defaultOpacity;
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
    }, -1);
    const resolveEventCategory = (event: ThreeEvent<PointerEvent>) => {
        const category = categoryForName(event.object.name);
        return isAnnotation(event.object.name) ? null : category;
    };
    const anatomy = <>
          {showMotionGhost && motionGhosts.map((ghost, index) => <primitive key={index} object={ghost}/>)}
          <primitive object={model} onPointerOver={(event: ThreeEvent<PointerEvent>) => {
            const category = resolveEventCategory(event);
            if (!category)
                return;
            event.stopPropagation();
            document.body.style.cursor = "pointer";
            onHover(structureByKey[category].label);
        }} onPointerOut={() => {
            document.body.style.cursor = "default";
            onHover(null);
        }} onClick={(event: ThreeEvent<MouseEvent>) => {
            if (event.delta > 4)
                return;
            const category = categoryForName(event.object.name);
            if (!category || isAnnotation(event.object.name))
                return;
            event.stopPropagation();
            onSelect(category);
        }}/>
          <SoftTissues selected={selected} selectedEntity={selectedEntity} xray={xray} exploded={exploded} explodeAmount={explodeAmount} flexion={flexion} renderedFlexion={renderedFlexion} tensionMap={tensionMap} aclState={aclState} muscleScope={muscleScope} onSelect={onSelect} onEntitySelect={onEntitySelect} onHover={onHover}/>
          {showLabels && <AnatomyLabels selected={selected} selectedEntity={selectedEntity} muscleScope={muscleScope} renderedFlexion={renderedFlexion} distanceFactor={anatomicalSpace ? 1.2 : 3}/>}
    </>;
    return <group ref={group} rotation={[0, viewRotation, 0]}>
      {anatomicalSpace ? anatomy : <Center><group scale={4.35}>{anatomy}</group></Center>}
    </group>;
}
