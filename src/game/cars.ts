// ─────────────────────────────────────────────────────────────────────────────
// The four selectable cars, each built procedurally from rounded-box low-poly
// geometry with soft pastel colorways. All cars face +Z in local space.
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
    clearance: 0.42,
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
    clearance: 0.62,
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
    clearance: 0.6,
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
    clearance: 0.32,
    wheelR: 0.34,
    wheelW: 0.3,
    wheelBase: 1.38,
    track: 0.86,
  },
];

export interface BuiltCar {
  group: THREE.Group;
  wheels: THREE.Group[]; // front wheels first (index 0,1 = front)
  steerWheels: THREE.Group[];
}

function mat(color: string, roughness = 0.38, metalness = 0.06): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, flatShading: false });
}

function rbox(w: number, h: number, d: number, r: number): RoundedBoxGeometry {
  return new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.01, h / 2.01, d / 2.01));
}

function addMesh(
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  material: THREE.Material,
  x: number,
  y: number,
  z: number
): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = false;
  parent.add(m);
  return m;
}

/** Build one car. Forward = +Z. Origin is at ground level between the wheels. */
export function buildCar(spec: CarSpec): BuiltCar {
  const g = new THREE.Group();
  const bodyMat = mat(spec.body, 0.32);
  const roofMat = mat(spec.roof, 0.5);
  const accentMat = mat(spec.accent, 0.42, 0.12);
  const glassMat = new THREE.MeshStandardMaterial({
    color: "#37414e",
    roughness: 0.12,
    metalness: 0.35,
  });
  const darkMat = mat("#5a565e", 0.6);
  const lightMat = new THREE.MeshStandardMaterial({
    color: "#fff6dc",
    emissive: "#ffeec2",
    emissiveIntensity: 0.75,
    roughness: 0.4,
  });
  const tailMat = new THREE.MeshStandardMaterial({
    color: "#f0908c",
    emissive: "#e26d6d",
    emissiveIntensity: 0.5,
    roughness: 0.4,
  });

  const wheelR = spec.wheelR;
  const clearance = spec.clearance;
  const groundY = wheelR + clearance; // body bottom sits here

  // ── wheels ──
  const tireMat = mat("#4c484c", 0.85);
  const rimMat = mat("#efeae0", 0.35, 0.4);
  const tireGeo = new THREE.CylinderGeometry(wheelR, wheelR, spec.wheelW, 16);
  tireGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(wheelR * 0.55, wheelR * 0.55, spec.wheelW + 0.02, 12);
  rimGeo.rotateZ(Math.PI / 2);

  const wheels: THREE.Group[] = [];
  const steerWheels: THREE.Group[] = [];
  const wheelPos: [number, number][] = [
    [-spec.track, spec.wheelBase], // front left
    [spec.track, spec.wheelBase], // front right
    [-spec.track, -spec.wheelBase], // rear left
    [spec.track, -spec.wheelBase], // rear right
  ];
  for (const [wx, wz] of wheelPos) {
    const steering = new THREE.Group();
    steering.position.set(wx, wheelR, wz);
    const spin = new THREE.Group();
    const tire = new THREE.Mesh(tireGeo, tireMat);
    tire.castShadow = true;
    spin.add(tire);
    spin.add(new THREE.Mesh(rimGeo, rimMat));
    steering.add(spin);
    g.add(steering);
    wheels.push(spin);
    if (wz > 0) steerWheels.push(steering);
  }

  // ── car-specific silhouette ──
  switch (spec.id) {
    case "sedan": {
      const length = 4.5;
      const width = 1.86;
      const bodyH = 0.62;
      // lower body
      const lower = rbox(width, bodyH, length, 0.16);
      addMesh(g, lower, bodyMat, 0, groundY + bodyH / 2, 0);
      // hood + trunk shoulders
      const shoulder = rbox(width - 0.06, 0.16, length - 0.7, 0.08);
      addMesh(g, shoulder, bodyMat, 0, groundY + bodyH + 0.07, -0.05);
      // cabin (glass)
      const cabin = rbox(1.6, 0.5, 2.15, 0.14);
      addMesh(g, cabin, glassMat, 0, groundY + bodyH + 0.32, -0.18);
      // roof
      const roof = rbox(1.52, 0.1, 1.95, 0.05);
      addMesh(g, roof, roofMat, 0, groundY + bodyH + 0.6, -0.18);
      // accent side skirts
      addMesh(g, rbox(width + 0.04, 0.12, length - 1.6, 0.05), accentMat, 0, groundY + 0.05, 0);
      break;
    }
    case "suv": {
      const length = 4.7;
      const width = 1.94;
      const bodyH = 0.8;
      const lower = rbox(width, bodyH, length, 0.14);
      addMesh(g, lower, bodyMat, 0, groundY + bodyH / 2, 0);
      const shoulder = rbox(width - 0.04, 0.18, length - 0.5, 0.08);
      addMesh(g, shoulder, bodyMat, 0, groundY + bodyH + 0.08, -0.1);
      // long glass cabin
      const cabin = rbox(1.72, 0.62, 2.9, 0.14);
      addMesh(g, cabin, glassMat, 0, groundY + bodyH + 0.44, -0.35);
      const roof = rbox(1.66, 0.1, 2.75, 0.05);
      addMesh(g, roof, roofMat, 0, groundY + bodyH + 0.78, -0.35);
      // roof rails
      for (const sx of [-0.62, 0.62]) {
        addMesh(g, rbox(0.08, 0.07, 2.3, 0.03), darkMat, sx, groundY + bodyH + 0.9, -0.35);
      }
      // rear-mounted spare hint
      addMesh(g, rbox(0.36, 0.36, 0.18, 0.06), accentMat, 0, groundY + bodyH + 0.3, -length / 2 - 0.06);
      break;
    }
    case "truck": {
      const length = 5.1;
      const width = 2.0;
      const bodyH = 0.72;
      // cab
      const cab = rbox(width, bodyH, 1.9, 0.13);
      addMesh(g, cab, bodyMat, 0, groundY + bodyH / 2, 0.9);
      // glass band of cab
      const glass = rbox(width - 0.1, 0.5, 1.7, 0.1);
      addMesh(g, glass, glassMat, 0, groundY + bodyH + 0.24, 0.9);
      const cabRoof = rbox(width - 0.14, 0.1, 1.62, 0.05);
      addMesh(g, cabRoof, roofMat, 0, groundY + bodyH + 0.52, 0.9);
      // bed
      const bed = rbox(width, 0.34, 2.7, 0.08);
      addMesh(g, bed, bodyMat, 0, groundY + 0.17, -1.35);
      const bedFloor = rbox(width - 0.34, 0.1, 2.4, 0.04);
      addMesh(g, bedFloor, darkMat, 0, groundY + 0.4, -1.35);
      for (const sx of [-0.83, 0.83]) {
        addMesh(g, rbox(0.16, 0.42, 2.7, 0.06), bodyMat, sx, groundY + 0.5, -1.35);
      }
      addMesh(g, rbox(width, 0.42, 0.16, 0.06), bodyMat, 0, groundY + 0.5, -2.68);
      // front bumper
      addMesh(g, rbox(width + 0.06, 0.24, 0.3, 0.07), accentMat, 0, groundY + 0.1, 2.0);
      break;
    }
    case "sport": {
      const length = 4.55;
      const width = 1.96;
      const bodyH = 0.5;
      const lower = rbox(width, bodyH, length, 0.18);
      addMesh(g, lower, bodyMat, 0, groundY + bodyH / 2, 0);
      // wedge hood
      const hood = rbox(width - 0.05, 0.14, length - 1.15, 0.07);
      addMesh(g, hood, bodyMat, 0, groundY + bodyH + 0.06, 0.45);
      // sculpted glass canopy set far back
      const cabin = rbox(1.5, 0.44, 1.7, 0.16);
      addMesh(g, cabin, glassMat, 0, groundY + bodyH + 0.22, -0.45);
      const roof = rbox(1.3, 0.09, 1.15, 0.045);
      addMesh(g, roof, roofMat, 0, groundY + bodyH + 0.48, -0.55);
      // side accent blades
      for (const sx of [-width / 2 + 0.03, width / 2 - 0.03]) {
        addMesh(g, rbox(0.06, 0.09, length - 1.4, 0.03), accentMat, sx, groundY + 0.08, 0);
      }
      // rear wing
      addMesh(g, rbox(1.5, 0.06, 0.34, 0.03), accentMat, 0, groundY + bodyH + 0.34, -2.05);
      for (const sx of [-0.55, 0.55]) {
        addMesh(g, rbox(0.08, 0.26, 0.12, 0.03), darkMat, sx, groundY + bodyH + 0.18, -2.02);
      }
      break;
    }
  }

  // ── shared details: lights & plates ──
  const bodyTop = spec.id === "truck" ? spec.clearance + spec.wheelR : spec.clearance + spec.wheelR;
  const noseZ = spec.id === "truck" ? 2.05 : spec.id === "suv" ? 2.42 : spec.id === "sport" ? 2.3 : 2.32;
  const tailZ = spec.id === "truck" ? -2.62 : spec.id === "sport" ? -2.28 : -2.3;
  for (const sx of [-0.55, 0.55]) {
    addMesh(g, rbox(0.34, 0.14, 0.1, 0.04), lightMat, sx, bodyTop + 0.34, noseZ);
    addMesh(g, rbox(0.34, 0.13, 0.09, 0.04), tailMat, sx, bodyTop + 0.38, tailZ);
  }
  addMesh(g, rbox(0.9, 0.2, 0.06, 0.02), darkMat, 0, bodyTop + 0.18, tailZ + 0.02);

  return { group: g, wheels, steerWheels };
}
