// ─────────────────────────────────────────────────────────────────────────────
// The four selectable cars, modelled as stylized low-poly silhouettes.
// Each body is a single extruded side-profile (with real wheel arches cut
// into the outline) instead of stacked boxes — clean, chunky, deliberate.
//   Coastline — Volvo V60-inspired Scandinavian sport wagon
//   Highland  — Lexus GX-inspired boxy adventure SUV
//   Mesa      — Rivian R1T-inspired electric pickup
//   Blossom   — Porsche 911-inspired fastback coupe
// All cars face +Z in local space; origin sits between the wheels at ground.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from "three";

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
    tag: "Scandinavian sport wagon",
    body: "#b7cbdd",
    roof: "#f2efe7",
    accent: "#7f94a8",
    stats: { topSpeed: 46, accel: 14, grip: 1.0, offroad: 0.62 },
    bars: { speed: 0.62, accel: 0.6, grip: 0.68, offroad: 0.45 },
    clearance: 0.3,
    wheelR: 0.36,
    wheelW: 0.26,
    wheelBase: 1.4,
    track: 0.82,
  },
  {
    id: "suv",
    name: "Highland",
    tag: "Boxy go-anywhere SUV",
    body: "#c9d8b6",
    roof: "#eef0e6",
    accent: "#8aa07a",
    stats: { topSpeed: 40, accel: 12, grip: 0.92, offroad: 0.95 },
    bars: { speed: 0.52, accel: 0.5, grip: 0.6, offroad: 0.95 },
    clearance: 0.46,
    wheelR: 0.44,
    wheelW: 0.32,
    wheelBase: 1.46,
    track: 0.86,
  },
  {
    id: "truck",
    name: "Mesa",
    tag: "Quiet, capable electric pickup",
    body: "#e3b39a",
    roof: "#f5ece4",
    accent: "#b5836a",
    stats: { topSpeed: 36, accel: 10.5, grip: 0.85, offroad: 0.9 },
    bars: { speed: 0.42, accel: 0.42, grip: 0.5, offroad: 0.9 },
    clearance: 0.48,
    wheelR: 0.46,
    wheelW: 0.36,
    wheelBase: 1.5,
    track: 0.86,
  },
  {
    id: "sport",
    name: "Blossom",
    tag: "Rear-engined icon, but pastel",
    body: "#f0aec0",
    roof: "#fbdce4",
    accent: "#d98da3",
    stats: { topSpeed: 58, accel: 20, grip: 1.18, offroad: 0.35 },
    bars: { speed: 0.95, accel: 0.95, grip: 0.9, offroad: 0.25 },
    clearance: 0.24,
    wheelR: 0.34,
    wheelW: 0.3,
    wheelBase: 1.24,
    track: 0.92,
  },
];

export interface BuiltCar {
  group: THREE.Group;
  wheels: THREE.Group[]; // spinning part of each wheel
  steerWheels: THREE.Group[]; // yawing (front) part of each wheel
}

// ── material helpers ─────────────────────────────────────────────────────────

/** Matte stylized paint — reads as low-poly under the pastel world lighting. */
function paintMat(color: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.42,
    metalness: 0.05,
    flatShading: true,
  });
}

function box(
  parent: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
  rx = 0
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  if (rx) m.rotation.x = rx;
  m.castShadow = true;
  parent.add(m);
  return m;
}

// ── side-profile extrusion ───────────────────────────────────────────────────

type ProfileCmd =
  | { p: [number, number] } // straight line to (z, y)
  | { arch: { z: number; y: number; r: number; bottom: number } }; // wheel arch

/**
 * Builds a solid car body from its side silhouette. The outline is drawn in
 * (z, y) space — z runs along the car (+z = nose), y is height — then extruded
 * across the width and centered on x = 0.
 */
function extrudeProfile(
  cmds: ProfileCmd[],
  width: number,
  material: THREE.Material
): THREE.Mesh {
  const shape = new THREE.Shape();
  const first = cmds[0];
  if (!first || !("p" in first)) throw new Error("profile must start with a point");
  shape.moveTo(first.p[0], first.p[1]);

  for (let i = 1; i < cmds.length; i++) {
    const c = cmds[i];
    if ("p" in c) {
      shape.lineTo(c.p[0], c.p[1]);
    } else {
      const { z, y, r, bottom } = c.arch;
      // angle below horizontal where the arch meets the rocker line
      const dy = Math.max(0, y - bottom);
      const a = Math.asin(Math.min(1, dy / r));
      // walk to the arch opening (lineTo keeps arcs crisp and kink-free)
      shape.lineTo(z - r * Math.cos(a), bottom);
      // upper arc over the wheel, traversed clockwise (from +z side to -z side)
      shape.absarc(z, y, r, Math.PI + a, -a, true);
    }
  }
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: false,
    curveSegments: 6,
  });
  // shape-x → car-z, extrusion → car-x, centered
  geo.rotateY(-Math.PI / 2);
  geo.translate(width / 2, 0, 0);

  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  return mesh;
}

// ── wheels: chunky flat-shaded drums ─────────────────────────────────────────

function buildWheel(spec: CarSpec, tireMat: THREE.Material, rimMat: THREE.Material): THREE.Group {
  const r = spec.wheelR;
  const w = spec.wheelW;
  const spin = new THREE.Group();

  const tireGeo = new THREE.CylinderGeometry(r, r, w, 10);
  tireGeo.rotateZ(Math.PI / 2);
  const tire = new THREE.Mesh(tireGeo, tireMat);
  tire.castShadow = true;
  spin.add(tire);

  // rim pokes just past the tire sidewall on both faces
  const rimGeo = new THREE.CylinderGeometry(r * 0.58, r * 0.58, w * 1.06, 10);
  rimGeo.rotateZ(Math.PI / 2);
  const rim = new THREE.Mesh(rimGeo, rimMat);
  spin.add(rim);

  const hubGeo = new THREE.CylinderGeometry(r * 0.18, r * 0.18, w * 1.1, 8);
  hubGeo.rotateZ(Math.PI / 2);
  spin.add(new THREE.Mesh(hubGeo, rimMat));

  return spin;
}

// ── the car builder ───────────────────────────────────────────────────────────

export function buildCar(spec: CarSpec): BuiltCar {
  const g = new THREE.Group();

  const kit = {
    bodyMat: paintMat(spec.body),
    roofMat: paintMat(spec.roof),
    accentMat: paintMat(spec.accent),
    glassMat: new THREE.MeshStandardMaterial({
      color: "#2e3a46",
      roughness: 0.16,
      metalness: 0.35,
      flatShading: true,
    }),
    trimMat: new THREE.MeshStandardMaterial({ color: "#3c3a42", roughness: 0.6, flatShading: true }),
    lightMat: new THREE.MeshStandardMaterial({
      color: "#fff6dc",
      emissive: "#ffeec2",
      emissiveIntensity: 0.9,
      roughness: 0.35,
      flatShading: true,
    }),
    tailMat: new THREE.MeshStandardMaterial({
      color: "#f0908c",
      emissive: "#e26d6d",
      emissiveIntensity: 0.65,
      roughness: 0.4,
      flatShading: true,
    }),
  };

  const tireMat = new THREE.MeshStandardMaterial({ color: "#3b383e", roughness: 0.9, flatShading: true });
  const rimMat = new THREE.MeshStandardMaterial({ color: "#efe9dd", roughness: 0.35, metalness: 0.35, flatShading: true });

  const wheelR = spec.wheelR;

  // wheels (they define the stance)
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
    const spin = buildWheel(spec, tireMat, rimMat);
    steering.add(spin);
    g.add(steering);
    wheels.push(spin);
    if (wz > 0) steerWheels.push(steering);
  }

  // ── car-specific silhouettes ──
  switch (spec.id) {
    // Coastline — long roof, sleek tailgate: a Volvo V60-style wagon
    case "sedan": {
      const W = 1.86;
      const bottom = 0.3;
      const fz = spec.wheelBase;
      const rz = -spec.wheelBase;

      g.add(
        extrudeProfile(
          [
            { p: [-2.3, bottom] },
            { arch: { z: rz, y: wheelR, r: 0.47, bottom } },
            { arch: { z: fz, y: wheelR, r: 0.47, bottom } },
            { p: [2.34, bottom] },
            { p: [2.46, 0.86] }, // raked nose face
            { p: [2.2, 1.0] }, // hood lip
            { p: [1.0, 1.04] }, // cowl
            { p: [-2.1, 1.04] }, // beltline to the tailgate corner
            { p: [-2.42, 0.95] }, // tailgate
            { p: [-2.44, 0.6] },
          ],
          W,
          kit.bodyMat
        )
      );

      // glass canopy: windshield → long roof → raked tailgate glass
      g.add(
        extrudeProfile(
          [
            { p: [1.0, 1.04] },
            { p: [0.44, 1.4] },
            { p: [-1.52, 1.32] },
            { p: [-2.1, 1.04] },
          ],
          W - 0.3,
          kit.glassMat
        )
      );
      // roof panel
      box(g, W - 0.36, 0.06, 2.04, kit.roofMat, 0, 1.39, -0.54);
      // roof rails
      for (const sx of [-1, 1]) box(g, 0.05, 0.05, 1.6, kit.trimMat, sx * 0.55, 1.47, -0.55);

      // face: headlights + a hint of Thor's-hammer ticks
      for (const sx of [-1, 1]) {
        box(g, 0.36, 0.07, 0.06, kit.lightMat, sx * 0.6, 0.72, 2.43, 0.21);
        box(g, 0.07, 0.09, 0.06, kit.lightMat, sx * 0.6, 0.63, 2.41, 0.21);
      }
      box(g, 0.8, 0.2, 0.06, kit.trimMat, 0, 0.6, 2.4, 0.21);
      // tail: vertical Volvo lamps
      for (const sx of [-1, 1]) box(g, 0.08, 0.32, 0.05, kit.tailMat, sx * 0.58, 0.78, -2.43);
      // mirrors
      for (const sx of [-1, 1]) box(g, 0.1, 0.07, 0.14, kit.trimMat, sx * 0.97, 1.16, 0.78);
      break;
    }

    // Highland — upright glasshouse, flat roof: a Lexus GX-style SUV
    case "suv": {
      const W = 2.0;
      const bottom = 0.42;
      const fz = spec.wheelBase;
      const rz = -spec.wheelBase;

      g.add(
        extrudeProfile(
          [
            { p: [-2.4, bottom] },
            { arch: { z: rz, y: wheelR, r: 0.55, bottom } },
            { arch: { z: fz, y: wheelR, r: 0.55, bottom } },
            { p: [2.3, bottom] },
            { p: [2.46, 1.02] }, // tall upright nose
            { p: [2.2, 1.1] }, // hood lip
            { p: [0.62, 1.16] }, // cowl
            { p: [-2.16, 1.18] }, // rising beltline
            { p: [-2.42, 1.1] }, // upright tail
            { p: [-2.44, 0.62] },
          ],
          W,
          kit.bodyMat
        )
      );

      // glass canopy: raked windshield → flat long roof → upright rear glass
      g.add(
        extrudeProfile(
          [
            { p: [0.62, 1.16] },
            { p: [0.16, 1.66] },
            { p: [-1.62, 1.66] },
            { p: [-2.1, 1.2] },
          ],
          W - 0.32,
          kit.glassMat
        )
      );
      box(g, W - 0.38, 0.07, 1.86, kit.roofMat, 0, 1.7, -0.73);
      for (const sx of [-1, 1]) box(g, 0.06, 0.06, 1.7, kit.trimMat, sx * 0.58, 1.78, -0.73);

      // face: tall spindle grille + square lamps
      box(g, 0.92, 0.34, 0.06, kit.trimMat, 0, 0.86, 2.38, 0.26);
      for (const sx of [-1, 1]) box(g, 0.34, 0.12, 0.06, kit.lightMat, sx * 0.68, 1.0, 2.4, 0.26);
      // tail: tall vertical lamps
      for (const sx of [-1, 1]) box(g, 0.1, 0.36, 0.05, kit.tailMat, sx * 0.72, 0.86, -2.43);
      // chunky side steps
      for (const sx of [-1, 1]) box(g, 0.16, 0.09, 1.9, kit.trimMat, sx * 0.94, 0.36, -0.1);
      // mirrors
      for (const sx of [-1, 1]) box(g, 0.12, 0.08, 0.14, kit.trimMat, sx * 1.06, 1.3, 0.55);
      break;
    }

    // Mesa — stubby EV nose, bed with sail pillars: a Rivian R1T-style pickup
    case "truck": {
      const W = 2.02;
      const bottom = 0.44;
      const fz = spec.wheelBase;
      const rz = -spec.wheelBase;

      g.add(
        extrudeProfile(
          [
            { p: [-2.5, bottom] },
            { arch: { z: rz, y: wheelR, r: 0.56, bottom } },
            { arch: { z: fz, y: wheelR, r: 0.56, bottom } },
            { p: [2.24, bottom] },
            { p: [2.44, 0.92] }, // rounded EV nose
            { p: [1.9, 1.04] }, // hood
            { p: [0.85, 1.1] }, // cowl
            { p: [-2.3, 1.1] }, // bed rail
            { p: [-2.48, 1.02] }, // tailgate
            { p: [-2.5, 0.6] },
          ],
          W,
          kit.bodyMat
        )
      );

      // cab canopy: EV cab with vertical rear glass
      g.add(
        extrudeProfile(
          [
            { p: [0.85, 1.1] },
            { p: [0.38, 1.52] },
            { p: [-0.52, 1.52] },
            { p: [-0.7, 1.12] },
          ],
          W - 0.32,
          kit.glassMat
        )
      );
      box(g, W - 0.38, 0.07, 1.0, kit.roofMat, 0, 1.56, -0.07);
      // sail pillars linking the cab to the bed rails
      for (const sx of [-1, 1]) {
        box(g, 0.12, 0.44, 0.34, kit.bodyMat, sx * 0.72, 1.32, -0.9, -0.4);
      }
      // tonneau bed + rail caps
      box(g, 1.58, 0.05, 1.66, kit.trimMat, 0, 1.12, -1.6);
      for (const sx of [-1, 1]) box(g, 0.12, 0.05, 1.72, kit.accentMat, sx * 0.86, 1.13, -1.56);

      // face: stadium headlights (no grille — it's electric)
      for (const sx of [-1, 1]) {
        const pillGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.22, 8);
        pillGeo.rotateZ(Math.PI / 2);
        const pill = new THREE.Mesh(pillGeo, kit.lightMat);
        pill.position.set(sx * 0.6, 0.76, 2.36);
        pill.rotation.x = 0.4;
        pill.castShadow = true;
        g.add(pill);
      }
      box(g, 1.96, 0.16, 0.14, kit.trimMat, 0, 0.46, 2.28); // front bumper
      // full-width tail light bar
      box(g, 1.7, 0.06, 0.05, kit.tailMat, 0, 1.02, -2.5);
      box(g, 1.96, 0.16, 0.14, kit.trimMat, 0, 0.46, -2.42); // rear bumper
      // mirrors
      for (const sx of [-1, 1]) box(g, 0.12, 0.08, 0.14, kit.trimMat, sx * 1.06, 1.32, 0.62);
      break;
    }

    // Blossom — fender crests, set-back canopy, fastback: a 911-style coupe
    case "sport": {
      const W = 1.92;
      const bottom = 0.22;
      const fz = spec.wheelBase;
      const rz = -spec.wheelBase;

      g.add(
        extrudeProfile(
          [
            { p: [-2.16, bottom] },
            { arch: { z: rz, y: wheelR, r: 0.45, bottom } },
            { arch: { z: fz, y: wheelR, r: 0.45, bottom } },
            { p: [2.08, bottom] },
            { p: [2.2, 0.5] }, // soft nose
            { p: [1.98, 0.74] }, // front fender crest
            { p: [1.05, 0.66] }, // hood dip
            { p: [0.6, 0.8] }, // cowl
            { p: [0.0, 0.74] }, // low mid-body
            { p: [-1.55, 0.88] }, // rear haunch
            { p: [-2.05, 0.94] }, // ducktail
            { p: [-2.18, 0.62] },
          ],
          W,
          kit.bodyMat
        )
      );

      // glass canopy: steep windshield → flyline roof → long fastback glass
      g.add(
        extrudeProfile(
          [
            { p: [0.6, 0.8] },
            { p: [0.1, 1.16] },
            { p: [-0.65, 1.12] },
            { p: [-1.8, 0.9] },
            { p: [-1.0, 0.79] },
            { p: [0.0, 0.74] },
          ],
          W - 0.4,
          kit.glassMat
        )
      );
      box(g, 1.46, 0.06, 0.8, kit.roofMat, 0, 1.17, -0.28);

      // round headlight discs on the fenders
      for (const sx of [-1, 1]) {
        const lampGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.07, 10);
        lampGeo.rotateX(Math.PI / 2);
        const lamp = new THREE.Mesh(lampGeo, kit.lightMat);
        lamp.position.set(sx * 0.6, 0.66, 1.96);
        lamp.rotation.x = 0.46;
        lamp.castShadow = true;
        g.add(lamp);
      }
      // full-width tail light bar on the ducktail
      box(g, 1.34, 0.05, 0.05, kit.tailMat, 0, 0.86, -2.14);
      // twin exhausts
      for (const sx of [-1, 1]) {
        const exGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.12, 8);
        exGeo.rotateX(Math.PI / 2);
        const ex = new THREE.Mesh(exGeo, kit.trimMat);
        ex.position.set(sx * 0.18, 0.29, -2.12);
        g.add(ex);
      }
      // mirrors
      for (const sx of [-1, 1]) box(g, 0.09, 0.06, 0.12, kit.trimMat, sx * 1.0, 0.94, 0.52);
      break;
    }
  }

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

  return { group: g, wheels, steerWheels };
}
