// ─────────────────────────────────────────────────────────────────────────────
// The four selectable cars, each built procedurally from rounded low-poly
// geometry with clearcoat paint, slanted glass, spoked wheels, mirrors,
// grilles, exhausts and fender flares — a tactile, premium modelled feel.
// All cars face +Z in local space; origin sits between the wheels at ground.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

export interface CarStats {
  /** top speed in m/s */
  topSpeed: number;
  /** engine acceleration m/s^2 */
  accel: number;
  /** steering/handling factor */
  grip: number;
  /** how much speed is kept off-road */
  offroad: number;
}

export interface CarSpec {
  id: string;
  name: string;
  tag: string;
  body: string; // hex color
  roof: string;
  accent: string;
  stats: CarStats;
  /** display stats 0..1 for the UI bars */
  bars: { speed: number; accel: number; grip: number; offroad: number };
  // geometry
  clearance: number; // ride height
  wheelR: number;
  wheelW: number;
  wheelBase: number; // z distance front/rear axle
  track: number; // x half-distance of wheels
}

export const CARS: CarSpec[] = [
  {
    id: "sedan",
    name: "Coastline",
    tag: "Balanced everyday cruiser",
    body: "#b7cbdd",
    roof: "#f2efe7",
    accent: "#7f94a8",
    stats: { topSpeed: 46, accel: 14, grip: 1.0, offroad: 0.62 },
    bars: { speed: 0.62, accel: 0.6, grip: 0.68, offroad: 0.45 },
    clearance: 0.3,
    wheelR: 0.36,
    wheelW: 0.26,
    wheelBase: 1.42,
    track: 0.82,
  },
  {
    id: "suv",
    name: "Highland",
    tag: "Go-anywhere adventure wagon",
    body: "#c9d8b6",
    roof: "#eef0e6",
    accent: "#8aa07a",
    stats: { topSpeed: 40, accel: 12, grip: 0.92, offroad: 0.95 },
    bars: { speed: 0.52, accel: 0.5, grip: 0.6, offroad: 0.95 },
    clearance: 0.46,
    wheelR: 0.44,
    wheelW: 0.32,
    wheelBase: 1.42,
    track: 0.86,
  },
  {
    id: "truck",
    name: "Mesa",
    tag: "Heavy, honest, unstoppable",
    body: "#e3b39a",
    roof: "#f5ece4",
    accent: "#b5836a",
    stats: { topSpeed: 36, accel: 10.5, grip: 0.85, offroad: 0.9 },
    bars: { speed: 0.42, accel: 0.42, grip: 0.5, offroad: 0.9 },
    clearance: 0.48,
    wheelR: 0.46,
    wheelW: 0.36,
    wheelBase: 1.45,
    track: 0.86,
  },
  {
    id: "sport",
    name: "Blossom",
    tag: "Low, wide, and very quick",
    body: "#f0aec0",
    roof: "#fbdce4",
    accent: "#d98da3",
    stats: { topSpeed: 58, accel: 20, grip: 1.18, offroad: 0.35 },
    bars: { speed: 0.95, accel: 0.95, grip: 0.9, offroad: 0.25 },
    clearance: 0.24,
    wheelR: 0.34,
    wheelW: 0.3,
    wheelBase: 1.38,
    track: 0.86,
  },
];

export interface BuiltCar {
  group: THREE.Group;
  wheels: THREE.Group[]; // spinning part of each wheel
  steerWheels: THREE.Group[]; // yawing (front) part of each wheel
}

// ── material helpers ─────────────────────────────────────────────────────────

function paintMat(color: string): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.32,
    metalness: 0.12,
    clearcoat: 0.65,
    clearcoatRoughness: 0.22,
  });
}

function rbox(w: number, h: number, d: number, r: number): RoundedBoxGeometry {
  return new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.01, h / 2.01, d / 2.01));
}

function add(
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
  rx = 0
): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  if (rx) m.rotation.x = rx;
  m.castShadow = true;
  parent.add(m);
  return m;
}

// ── wheels ───────────────────────────────────────────────────────────────────

function buildWheel(spec: CarSpec, tireMat: THREE.Material, rimMat: THREE.Material, trimMat: THREE.Material): THREE.Group {
  const r = spec.wheelR;
  const w = spec.wheelW;
  const spin = new THREE.Group();

  // tire
  const tireGeo = new THREE.CylinderGeometry(r, r, w, 18);
  tireGeo.rotateZ(Math.PI / 2);
  const tire = new THREE.Mesh(tireGeo, tireMat);
  tire.castShadow = true;
  spin.add(tire);

  // sidewall discs (slightly inset, lighter than the tread) so the wheels
  // read clearly against the soft contact shadow
  const sideGeo = new THREE.CylinderGeometry(r * 0.82, r * 0.82, w + 0.015, 16);
  sideGeo.rotateZ(Math.PI / 2);
  const sideMat = new THREE.MeshStandardMaterial({ color: "#6b6470", roughness: 0.7 });
  const side = new THREE.Mesh(sideGeo, sideMat);
  spin.add(side);

  // rim dish
  const rimGeo = new THREE.CylinderGeometry(r * 0.6, r * 0.6, w * 0.58, 14);
  rimGeo.rotateZ(Math.PI / 2);
  spin.add(new THREE.Mesh(rimGeo, rimMat));

  // five spokes
  for (let i = 0; i < 5; i++) {
    const spokeGeo = new THREE.BoxGeometry(w * 0.5, r * 1.05, 0.055);
    const spoke = new THREE.Mesh(spokeGeo, rimMat);
    spoke.rotation.x = (i / 5) * Math.PI * 2;
    spin.add(spoke);
  }

  // chrome hub
  const hubGeo = new THREE.CylinderGeometry(r * 0.14, r * 0.14, w * 0.72, 10);
  hubGeo.rotateZ(Math.PI / 2);
  spin.add(new THREE.Mesh(hubGeo, rimMat));

  return spin;
}

// ── shared premium details ───────────────────────────────────────────────────

interface CarKit {
  glassMat: THREE.Material;
  trimMat: THREE.Material;
  chromeMat: THREE.Material;
  lightMat: THREE.Material;
  tailMat: THREE.Material;
  accentMat: THREE.Material;
  roofMat: THREE.Material;
  bodyMat: THREE.Material;
}

function addMirrors(kit: CarKit, g: THREE.Object3D, x: number, y: number, z: number): void {
  for (const sx of [-1, 1]) {
    add(g, rbox(0.05, 0.05, 0.1, 0.02), kit.trimMat, sx * (x + 0.07), y, z + 0.06);
    add(g, rbox(0.05, 0.11, 0.17, 0.02), kit.trimMat, sx * (x + 0.12), y + 0.03, z);
  }
}

function addFlares(kit: CarKit, g: THREE.Object3D, spec: CarSpec): void {
  const flareGeo = rbox(spec.wheelW * 1.55, 0.14, spec.wheelR * 1.7, 0.05);
  for (const wz of [spec.wheelBase, -spec.wheelBase]) {
    for (const sx of [-1, 1]) {
      add(g, flareGeo, kit.trimMat, sx * (spec.track + 0.02), spec.wheelR + spec.clearance * 0.42, wz);
    }
  }
}

function addExhausts(kit: CarKit, g: THREE.Object3D, spec: CarSpec, tailZ: number, count: number): void {
  const pipeGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.16, 10);
  pipeGeo.rotateX(Math.PI / 2);
  const y = spec.wheelR + 0.08;
  if (count === 1) {
    add(g, pipeGeo, kit.chromeMat, 0.45, y, tailZ + 0.02);
  } else {
    for (const sx of [-1, 1]) {
      for (const dx of [0, 0.16]) {
        add(g, pipeGeo, kit.chromeMat, sx * (0.35 + dx), y, tailZ + 0.02);
      }
    }
  }
}

// ── the car builder ───────────────────────────────────────────────────────────

export function buildCar(spec: CarSpec): BuiltCar {
  const g = new THREE.Group();

  const kit: CarKit = {
    bodyMat: paintMat(spec.body),
    roofMat: paintMat(spec.roof),
    accentMat: paintMat(spec.accent),
    glassMat: new THREE.MeshPhysicalMaterial({
      color: "#2c3744",
      roughness: 0.07,
      metalness: 0.25,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
    }),
    trimMat: new THREE.MeshStandardMaterial({ color: "#45414a", roughness: 0.55, metalness: 0.2 }),
    chromeMat: new THREE.MeshStandardMaterial({ color: "#d9d5cc", roughness: 0.28, metalness: 0.85 }),
    lightMat: new THREE.MeshStandardMaterial({
      color: "#fff6dc",
      emissive: "#ffeec2",
      emissiveIntensity: 0.85,
      roughness: 0.35,
    }),
    tailMat: new THREE.MeshStandardMaterial({
      color: "#f0908c",
      emissive: "#e26d6d",
      emissiveIntensity: 0.6,
      roughness: 0.4,
    }),
  };

  const wheelR = spec.wheelR;
  // the group origin sits at GROUND level (wheel contact plane), so the
  // body bottom floats just `clearance` above the tarmac
  const groundY = spec.clearance;

  // wheels first (they define the stance)
  const tireMat = new THREE.MeshStandardMaterial({ color: "#3b383e", roughness: 0.88 });
  const rimMat = new THREE.MeshStandardMaterial({ color: "#efe9dd", roughness: 0.3, metalness: 0.4 });
  const wheels: THREE.Group[] = [];
  const steerWheels: THREE.Group[] = [];
  const wheelPos: [number, number][] = [
    [-spec.track, spec.wheelBase],
    [spec.track, spec.wheelBase],
    [-spec.track, -spec.wheelBase],
    [spec.track, -spec.wheelBase],
  ];
  for (const [wx, wz] of wheelPos) {
    const steering = new THREE.Group();
    steering.position.set(wx, wheelR, wz);
    const spin = buildWheel(spec, tireMat, rimMat, kit.trimMat);
    steering.add(spin);
    g.add(steering);
    wheels.push(spin);
    if (wz > 0) steerWheels.push(steering);
  }

  addFlares(kit, g, spec);

  // soft contact shadow — a radial blob at the wheel-contact plane that
  // visually anchors the car to the ground in the stylized art
  const blobCanvas = document.createElement("canvas");
  blobCanvas.width = blobCanvas.height = 128;
  const bctx = blobCanvas.getContext("2d");
  if (bctx) {
    const grad = bctx.createRadialGradient(64, 64, 8, 64, 64, 62);
    grad.addColorStop(0, "rgba(40,32,24,0.34)");
    grad.addColorStop(0.55, "rgba(40,32,24,0.18)");
    grad.addColorStop(1, "rgba(40,32,24,0)");
    bctx.fillStyle = grad;
    bctx.fillRect(0, 0, 128, 128);
  }
  const blobTex = new THREE.CanvasTexture(blobCanvas);
  const shadowBlob = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false })
  );
  shadowBlob.rotation.x = -Math.PI / 2;
  shadowBlob.scale.set(spec.track * 2.6, spec.wheelBase * 3.4, 1);
  shadowBlob.position.y = 0.03;
  shadowBlob.renderOrder = 1;
  g.add(shadowBlob);

  // ── car-specific silhouettes ──
  let noseZ: number;
  let tailZ: number;

  switch (spec.id) {
    case "sedan": {
      const L = 4.5, W = 1.86;
      noseZ = 2.32; tailZ = -2.3;
      add(g, rbox(W, 0.58, L, 0.2), kit.bodyMat, 0, groundY + 0.29, 0);
      add(g, rbox(W - 0.08, 0.16, L - 0.5, 0.07), kit.bodyMat, 0, groundY + 0.66, 0);
      // greenhouse
      add(g, rbox(1.58, 0.4, 1.95, 0.09), kit.glassMat, 0, groundY + 0.94, -0.1);
      // slanted windshield + rear glass
      add(g, rbox(1.5, 0.56, 0.09, 0.04), kit.glassMat, 0, groundY + 1.02, 0.86, 0.42);
      add(g, rbox(1.5, 0.5, 0.09, 0.04), kit.glassMat, 0, groundY + 1.0, -1.05, -0.5);
      // side glass
      for (const sx of [-0.8, 0.8]) add(g, rbox(0.05, 0.32, 1.7, 0.02), kit.glassMat, sx, groundY + 0.95, -0.1);
      // roof
      add(g, rbox(1.48, 0.09, 1.85, 0.045), kit.roofMat, 0, groundY + 1.16, -0.12);
      // shark-fin antenna
      add(g, rbox(0.09, 0.12, 0.24, 0.03), kit.trimMat, 0, groundY + 1.27, -0.9);
      // mirrors
      addMirrors(kit, g, 0.86, groundY + 1.02, 0.62);
      // grille + chrome strip + bumpers
      add(g, rbox(1.06, 0.15, 0.08, 0.03), kit.trimMat, 0, groundY + 0.47, noseZ - 0.02);
      add(g, rbox(1.2, 0.05, 0.08, 0.02), kit.chromeMat, 0, groundY + 0.36, noseZ);
      add(g, rbox(W + 0.02, 0.2, 0.32, 0.07), kit.accentMat, 0, groundY + 0.12, noseZ - 0.12);
      add(g, rbox(W + 0.02, 0.2, 0.28, 0.07), kit.accentMat, 0, groundY + 0.12, tailZ + 0.1);
      // lights
      for (const sx of [-0.62, 0.62]) add(g, rbox(0.4, 0.12, 0.08, 0.03), kit.lightMat, sx, groundY + 0.62, noseZ);
      add(g, rbox(1.32, 0.08, 0.05, 0.02), kit.tailMat, 0, groundY + 0.66, tailZ);
      addExhausts(kit, g, spec, tailZ, 1);
      break;
    }
    case "suv": {
      const L = 4.7, W = 1.94;
      noseZ = 2.42; tailZ = -2.42;
      add(g, rbox(W, 0.78, L, 0.16), kit.bodyMat, 0, groundY + 0.39, 0);
      // beltline accent
      add(g, rbox(W + 0.02, 0.1, L - 0.4, 0.04), kit.accentMat, 0, groundY + 0.78, 0);
      // greenhouse
      add(g, rbox(1.72, 0.52, 2.8, 0.1), kit.glassMat, 0, groundY + 1.28, -0.32);
      add(g, rbox(1.66, 0.55, 0.09, 0.04), kit.glassMat, 0, groundY + 1.36, 1.06, 0.32);
      for (const sx of [-0.87, 0.87]) add(g, rbox(0.05, 0.42, 2.55, 0.02), kit.glassMat, sx, groundY + 1.28, -0.32);
      add(g, rbox(1.64, 0.09, 2.6, 0.04), kit.roofMat, 0, groundY + 1.56, -0.36);
      // roof rails
      for (const sx of [-0.6, 0.6]) add(g, rbox(0.09, 0.08, 2.15, 0.03), kit.trimMat, sx, groundY + 1.66, -0.36);
      // rear roof spoiler
      add(g, rbox(1.55, 0.08, 0.3, 0.03), kit.trimMat, 0, groundY + 1.6, -1.7);
      // mirrors
      addMirrors(kit, g, 0.94, groundY + 1.3, 0.8);
      // side steps
      for (const sx of [-1, 1]) add(g, rbox(0.2, 0.08, 2.3, 0.03), kit.trimMat, sx * (spec.track + 0.16), groundY - 0.28, -0.2);
      // skid plate + bumpers
      add(g, rbox(1.0, 0.22, 0.1, 0.04), kit.accentMat, 0, groundY + 0.14, noseZ);
      add(g, rbox(W + 0.04, 0.24, 0.32, 0.08), kit.accentMat, 0, groundY + 0.12, noseZ - 0.14);
      add(g, rbox(W + 0.04, 0.24, 0.3, 0.08), kit.accentMat, 0, groundY + 0.12, tailZ + 0.12);
      // lights + fog lights
      for (const sx of [-0.66, 0.66]) add(g, rbox(0.42, 0.13, 0.08, 0.03), kit.lightMat, sx, groundY + 0.72, noseZ);
      for (const sx of [-0.75, 0.75]) add(g, rbox(0.18, 0.12, 0.06, 0.02), kit.lightMat, sx, groundY + 0.2, noseZ - 0.05);
      add(g, rbox(1.4, 0.1, 0.05, 0.02), kit.tailMat, 0, groundY + 0.76, tailZ);
      // rear-mounted spare wheel
      const spare = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.2, 18), tireMat);
      spare.rotation.x = Math.PI / 2;
      spare.position.set(0, groundY + 0.5, tailZ - 0.1);
      spare.castShadow = true;
      g.add(spare);
      add(g, new THREE.CylinderGeometry(0.16, 0.16, 0.24, 12).rotateX(Math.PI / 2), kit.chromeMat, 0, groundY + 0.5, tailZ - 0.1);
      addExhausts(kit, g, spec, tailZ, 1);
      break;
    }
    case "truck": {
      const L = 5.1, W = 2.0;
      noseZ = 2.05; tailZ = -2.62;
      const cabZ = 0.9;
      // cab
      add(g, rbox(W, 0.72, 1.9, 0.14), kit.bodyMat, 0, groundY + 0.36, cabZ);
      add(g, rbox(W - 0.1, 0.48, 1.72, 0.09), kit.glassMat, 0, groundY + 0.96, cabZ);
      add(g, rbox(1.62, 0.5, 0.09, 0.04), kit.glassMat, 0, groundY + 0.98, cabZ + 0.86, 0.28);
      add(g, rbox(W - 0.16, 0.1, 1.6, 0.045), kit.roofMat, 0, groundY + 1.24, cabZ);
      for (const sx of [-0.88, 0.88]) add(g, rbox(0.05, 0.36, 1.6, 0.02), kit.glassMat, sx, groundY + 0.96, cabZ);
      // roof light bar
      add(g, rbox(1.3, 0.1, 0.16, 0.04), kit.trimMat, 0, groundY + 1.33, cabZ + 0.3);
      for (const sx of [-0.4, 0, 0.4]) add(g, rbox(0.14, 0.09, 0.1, 0.02), kit.lightMat, sx, groundY + 1.33, cabZ + 0.36);
      // mirrors (tall truck style)
      addMirrors(kit, g, 0.96, groundY + 1.06, cabZ + 0.8);
      // bed
      add(g, rbox(W, 0.4, 2.6, 0.08), kit.bodyMat, 0, groundY + 0.2, -1.3);
      add(g, rbox(W - 0.4, 0.12, 2.3, 0.04), kit.trimMat, 0, groundY + 0.44, -1.3);
      for (const sx of [-0.84, 0.84]) {
        add(g, rbox(0.18, 0.5, 2.6, 0.06), kit.bodyMat, sx, groundY + 0.6, -1.3);
        // bed rails
        add(g, rbox(0.1, 0.08, 2.3, 0.03), kit.chromeMat, sx, groundY + 0.92, -1.3);
      }
      add(g, rbox(W, 0.5, 0.18, 0.06), kit.bodyMat, 0, groundY + 0.6, -2.6);
      // big chrome grille + heavy bumpers
      add(g, rbox(1.5, 0.34, 0.09, 0.04), kit.chromeMat, 0, groundY + 0.44, noseZ);
      add(g, rbox(1.3, 0.24, 0.06, 0.02), kit.trimMat, 0, groundY + 0.44, noseZ - 0.03);
      add(g, rbox(W + 0.08, 0.28, 0.34, 0.09), kit.trimMat, 0, groundY + 0.12, noseZ - 0.12);
      add(g, rbox(W + 0.08, 0.28, 0.3, 0.09), kit.trimMat, 0, groundY + 0.12, tailZ + 0.1);
      // lights + vertical taillights
      for (const sx of [-0.72, 0.72]) add(g, rbox(0.34, 0.15, 0.08, 0.03), kit.lightMat, sx, groundY + 0.78, noseZ);
      for (const sx of [-0.86, 0.86]) add(g, rbox(0.12, 0.4, 0.08, 0.03), kit.tailMat, sx, groundY + 0.68, tailZ);
      addExhausts(kit, g, spec, tailZ, 1);
      break;
    }
    case "sport": {
      const L = 4.55, W = 1.96;
      noseZ = 2.3; tailZ = -2.28;
      const bodyH = 0.46;
      add(g, rbox(W, bodyH, L, 0.18), kit.bodyMat, 0, groundY + bodyH / 2, 0);
      // wedge hood: stepped stack, slightly narrower each time
      add(g, rbox(W - 0.06, 0.12, L - 1.1, 0.07), kit.bodyMat, 0, groundY + bodyH + 0.05, 0.5);
      add(g, rbox(W - 0.16, 0.1, L - 1.6, 0.06), kit.bodyMat, 0, groundY + bodyH + 0.15, 0.55);
      // teardrop canopy set far back
      add(g, rbox(1.44, 0.4, 1.6, 0.11), kit.glassMat, 0, groundY + bodyH + 0.26, -0.5);
      add(g, rbox(1.4, 0.52, 0.09, 0.04), kit.glassMat, 0, groundY + bodyH + 0.28, 0.25, 0.55);
      // fastback rear glass
      add(g, rbox(1.36, 0.5, 0.09, 0.04), kit.glassMat, 0, groundY + bodyH + 0.24, -1.25, -0.6);
      add(g, rbox(1.22, 0.08, 1.0, 0.04), kit.roofMat, 0, groundY + bodyH + 0.48, -0.6);
      for (const sx of [-0.74, 0.74]) add(g, rbox(0.05, 0.3, 1.35, 0.02), kit.glassMat, sx, groundY + bodyH + 0.24, -0.5);
      // mirrors
      addMirrors(kit, g, 0.94, groundY + bodyH + 0.3, 0.42);
      // side skirts
      for (const sx of [-1, 1]) add(g, rbox(0.12, 0.1, 2.0, 0.03), kit.trimMat, sx * (spec.track + 0.18), groundY + 0.06, -0.1);
      // front splitter
      add(g, rbox(W - 0.1, 0.08, 0.4, 0.03), kit.trimMat, 0, groundY + 0.02, noseZ - 0.16);
      // grille opening + sculpted bumpers
      add(g, rbox(1.0, 0.16, 0.08, 0.03), kit.trimMat, 0, groundY + 0.22, noseZ);
      add(g, rbox(W + 0.02, 0.16, 0.28, 0.06), kit.accentMat, 0, groundY + 0.16, noseZ - 0.1);
      // rear diffuser hint
      add(g, rbox(W - 0.2, 0.14, 0.3, 0.04), kit.trimMat, 0, groundY + 0.06, tailZ + 0.08);
      // wing with endplates
      add(g, rbox(1.5, 0.06, 0.32, 0.03), kit.accentMat, 0, groundY + bodyH + 0.38, -2.05);
      for (const sx of [-0.68, 0.68]) {
        add(g, rbox(0.08, 0.26, 0.12, 0.03), kit.trimMat, sx, groundY + bodyH + 0.2, -2.02);
        add(g, rbox(0.06, 0.2, 0.34, 0.03), kit.roofMat, sx, groundY + bodyH + 0.42, -2.05);
      }
      // sleek lights
      for (const sx of [-0.62, 0.62]) add(g, rbox(0.44, 0.09, 0.08, 0.03), kit.lightMat, sx, groundY + 0.34, noseZ);
      add(g, rbox(1.5, 0.07, 0.05, 0.02), kit.tailMat, 0, groundY + 0.42, tailZ);
      addExhausts(kit, g, spec, tailZ, 2);
      break;
    }
  }

  return { group: g, wheels, steerWheels };
}
