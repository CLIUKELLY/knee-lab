export type StructureKey = "all" | "bone" | "meniscus" | "cartilage" | "ligament" | "muscle";
export type AclState = "normal" | "strain" | "tear";
export type MuscleScope = "knee" | "regional";
export type MotionView = "side" | "quarter" | "front";

export type Structure = {
  key: StructureKey;
  label: string;
  eyebrow: string;
  description: string;
  fact: string;
};

export const structures: Structure[] = [
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

export const structureByKey = Object.fromEntries(structures.map((item) => [item.key, item])) as Record<StructureKey, Structure>;

export type AnatomyEntity = {
  id: string;
  layer: "ligament" | "muscle";
  label: string;
  shortLabel: string;
  role: string;
  origin: string;
  insertion: string;
  sourceLabel: string;
  sourceUrl: string;
};

export const anatomyEntities: AnatomyEntity[] = [
  { id: "acl", layer: "ligament", label: "Anterior cruciate ligament", shortLabel: "ACL", role: "Resists anterior tibial translation and contributes to rotational stability.", origin: "Posteromedial aspect of the lateral femoral condyle.", insertion: "Anterior intercondylar area of the tibia.", sourceLabel: "NCBI Bookshelf · ACL anatomy", sourceUrl: "https://www.ncbi.nlm.nih.gov/books/NBK499848/" },
  { id: "pcl", layer: "ligament", label: "Posterior cruciate ligament", shortLabel: "PCL", role: "Resists posterior tibial translation, especially as the knee flexes.", origin: "Lateral surface of the medial femoral condyle.", insertion: "Posterior intercondylar area of the tibia.", sourceLabel: "NCBI Bookshelf · PCL anatomy", sourceUrl: "https://www.ncbi.nlm.nih.gov/books/NBK535416/" },
  { id: "mcl", layer: "ligament", label: "Medial collateral ligament", shortLabel: "MCL", role: "Resists valgus stress and helps stabilize the medial knee.", origin: "Medial femoral epicondyle.", insertion: "Medial proximal tibia.", sourceLabel: "NCBI Bookshelf · MCL anatomy", sourceUrl: "https://www.ncbi.nlm.nih.gov/books/NBK507780/" },
  { id: "lcl", layer: "ligament", label: "Lateral collateral ligament", shortLabel: "LCL", role: "Resists varus stress and supports the lateral knee.", origin: "Lateral femoral epicondyle.", insertion: "Fibular head.", sourceLabel: "NCBI Bookshelf · Knee anatomy", sourceUrl: "https://www.ncbi.nlm.nih.gov/books/NBK500017/" },
  { id: "rectus-femoris", layer: "muscle", label: "Rectus femoris", shortLabel: "Rectus femoris", role: "Extends the knee and assists hip flexion.", origin: "Anterior inferior iliac spine; proximal path is cropped in this model.", insertion: "Patella through the quadriceps tendon, continuing to the tibial tuberosity through the patellar ligament.", sourceLabel: "NCBI · Anterior thigh anatomy", sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/30860696/" },
  { id: "vastus-medialis", layer: "muscle", label: "Vastus medialis", shortLabel: "Vastus medialis", role: "Extends the knee and contributes to patellar tracking.", origin: "Medial femur along the intertrochanteric line and linea aspera.", insertion: "Medial patella and tibial tuberosity through the extensor mechanism.", sourceLabel: "NCBI · Anterior thigh anatomy", sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/30860696/" },
  { id: "vastus-lateralis", layer: "muscle", label: "Vastus lateralis", shortLabel: "Vastus lateralis", role: "Extends the knee and supports the lateral extensor mechanism.", origin: "Greater trochanter and lateral lip of the linea aspera.", insertion: "Lateral patella and tibial tuberosity through the extensor mechanism.", sourceLabel: "NCBI · Anterior thigh anatomy", sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/30860696/" },
  { id: "biceps-femoris", layer: "muscle", label: "Biceps femoris", shortLabel: "Biceps femoris", role: "Flexes the knee and externally rotates the flexed leg.", origin: "Ischial tuberosity (long head) and linea aspera (short head); proximal path is cropped.", insertion: "Fibular head.", sourceLabel: "NCBI Bookshelf · Hamstring anatomy", sourceUrl: "https://www.ncbi.nlm.nih.gov/books/NBK546688/" },
  { id: "semitendinosus", layer: "muscle", label: "Semitendinosus", shortLabel: "Semitendinosus", role: "Flexes the knee and internally rotates the flexed leg.", origin: "Ischial tuberosity; proximal path is cropped in this model.", insertion: "Medial proximal tibia as part of the pes anserinus.", sourceLabel: "NCBI Bookshelf · Hamstring anatomy", sourceUrl: "https://www.ncbi.nlm.nih.gov/books/NBK546688/" },
  { id: "gastrocnemius", layer: "muscle", label: "Gastrocnemius", shortLabel: "Gastrocnemius", role: "Plantarflexes the ankle and can assist knee flexion.", origin: "Posterior aspects of the medial and lateral femoral condyles.", insertion: "Calcaneus through the Achilles tendon, beyond this crop.", sourceLabel: "NCBI Bookshelf · Gastrocnemius anatomy", sourceUrl: "https://www.ncbi.nlm.nih.gov/books/NBK532946/" },
];

export const entityById = Object.fromEntries(anatomyEntities.map((entity) => [entity.id, entity])) as Record<string, AnatomyEntity>;

export function entityIdForModelName(name: string) {
  const normalized = name.toLowerCase();
  if (normalized.startsWith("acl")) return "acl";
  if (normalized.startsWith("pcl")) return "pcl";
  if (normalized.startsWith("mcl")) return "mcl";
  if (normalized.startsWith("lcl")) return "lcl";
  if (normalized.includes("rectus femoris")) return "rectus-femoris";
  if (normalized.includes("vastus medialis")) return "vastus-medialis";
  if (normalized.includes("vastus lateralis")) return "vastus-lateralis";
  if (normalized.includes("biceps femoris")) return "biceps-femoris";
  if (normalized.includes("semitendinosus")) return "semitendinosus";
  if (normalized.includes("gastrocnemius")) return "gastrocnemius";
  return null;
}

export type MovementPreset = {
  id: "manual" | "walking" | "squat" | "stairs";
  label: string;
  keyframes: number[];
  duration: number;
  description: string;
};

export const movementPresets: MovementPreset[] = [
  { id: "manual", label: "Manual", keyframes: [], duration: 0, description: "Drag the control to inspect any flexion angle." },
  { id: "walking", label: "Walking", keyframes: [5, 18, 60, 35, 8], duration: 3200, description: "A simplified educational flexion cycle—not a gait analysis." },
  { id: "squat", label: "Squat", keyframes: [5, 30, 65, 100, 125, 90, 45, 5], duration: 5200, description: "A simplified descent and return through deep flexion." },
  { id: "stairs", label: "Stairs", keyframes: [8, 35, 75, 45, 12], duration: 3600, description: "A simplified step-up flexion pattern—not measured loading." },
];
