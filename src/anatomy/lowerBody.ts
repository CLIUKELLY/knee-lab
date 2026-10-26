export type Point2 = { forward: number; height: number };
export type Activity = "manual" | "walking" | "squat" | "stairs";
export const THIGH = 0.44;
export const SHIN = 0.43;
export const ANKLE_HEIGHT = 0.08;
export const STEP_HEIGHT = 0.18;
export const WALK_STRIDE = 0.36;
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const smooth = (x: number) => { const t = clamp(x); return t * t * t * (10 + t * (-15 + 6 * t)); };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export function solveLeg(hip: Point2, ankle: Point2, contact: boolean) {
  const dx = ankle.forward - hip.forward, dy = ankle.height - hip.height;
  const distance = Math.hypot(dx, dy);
  const d = Math.max(0.0001, Math.min(THIGH + SHIN - 0.000001, distance));
  const along = (THIGH * THIGH - SHIN * SHIN + d * d) / (2 * d);
  const perpendicular = Math.sqrt(Math.max(0, THIGH * THIGH - along * along));
  const knee = { forward: hip.forward + dx / distance * along - dy / distance * perpendicular,
    height: hip.height + dy / distance * along + dx / distance * perpendicular };
  const flexion = Math.acos(clamp((d*d - THIGH*THIGH - SHIN*SHIN)/(2*THIGH*SHIN), -1, 1)) * 180 / Math.PI;
  return { hip, knee, ankle, flexion, contact, reachable: distance <= THIGH + SHIN && distance >= Math.abs(THIGH - SHIN) };
}
export function squatPose(angle: number) {
  const q = clamp(angle, 0, 130) * Math.PI / 180;
  const shinLean = q * 0.23;
  const ankle = { forward: 0, height: ANKLE_HEIGHT };
  const knee = { forward: SHIN * Math.sin(shinLean), height: ANKLE_HEIGHT + SHIN * Math.cos(shinLean) };
  const hip = { forward: knee.forward - THIGH * Math.sin(q - shinLean), height: knee.height + THIGH * Math.cos(q - shinLean) };
  return { hip, left: solveLeg(hip, {...ankle}, true), right: solveLeg(hip, {...ankle}, true) };
}
export function sampleLowerBody(activity: Activity, progress: number, manualAngle = 0) {
  const phase = ((progress % 1) + 1) % 1;
  if (activity === "manual" || activity === "squat") {
    const depth = (1 - Math.cos(phase * 2 * Math.PI)) / 2;
    const pose = squatPose(activity === "manual" ? manualAngle : 5 + 115 * depth);
    return { ...pose, phase, phaseLabel: activity === "manual" ? "Both feet planted" : phase < 0.5 ? "Lowering · feet planted" : "Rising · feet planted", beltOffset: 0 };
  }
  if (activity === "walking") {
    const foot = (p: number) => {
      const stance = p < 0.62;
      const swing = (p - 0.62) / 0.38;
      // Body-relative stance moves back at belt speed; swing returns the foot.
      const velocity = -WALK_STRIDE / 0.62 * 0.38;
      const h = swing * swing * (3 - 2 * swing);
      const forward = stance ? WALK_STRIDE / 2 - WALK_STRIDE * p / 0.62 : mix(-WALK_STRIDE / 2, WALK_STRIDE / 2, h) + velocity * (2*swing**3 - 3*swing**2 + swing);
      const height = ANKLE_HEIGHT + (stance ? 0 : 0.11 * Math.sin(Math.PI * swing) ** 2);
      return { ankle: { forward, height }, stance };
    };
    const left = foot(phase), right = foot((phase + 0.5) % 1);
    const reach = Math.sqrt(left.ankle.forward**4 + right.ankle.forward**4);
    const hip = { forward: 0, height: ANKLE_HEIGHT + Math.sqrt(0.864**2 - reach) };
    return { hip, left: solveLeg(hip, left.ankle, left.stance), right: solveLeg(hip, right.ankle, right.stance), phase,
      phaseLabel: "Alternating stance & swing", beltOffset: phase * WALK_STRIDE / 0.62 };
  }
  // A single step-up and return: the lead foot plants before the pelvis rises.
  const up = (1 - Math.cos(phase * 2 * Math.PI)) / 2;
  const transfer = smooth((up - 0.35) / 0.65);
  const hip = { forward: mix(-0.03, 0.36, transfer), height: mix(0.875, 1.035, transfer) };
  const stepFoot = (start: number, end: number, u: number) => {
    const t = clamp(u), s = smooth(t);
    return { forward: mix(start, end, s), height: ANKLE_HEIGHT + STEP_HEIGHT * s + 0.25 * Math.sin(Math.PI * t) ** 2 };
  };
  const lead = stepFoot(0.04, 0.46, up / 0.42);
  const trail = stepFoot(-0.16, 0.34, (up - 0.5) / 0.5);
  return { hip, left: solveLeg(hip, lead, up >= 0.42 || up === 0), right: solveLeg(hip, trail, up <= 0.5 || up === 1), phase,
    phaseLabel: phase < 0.5 ? "Step up · left foot leads" : "Controlled return", beltOffset: 0 };
}
export type LowerBodyPose = ReturnType<typeof sampleLowerBody>;
