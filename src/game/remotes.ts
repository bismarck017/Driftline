// ─────────────────────────────────────────────────────────────────────────────
// Remote players — renders everyone else in the room.
//
// Each remote gets a locally built car (identical procedural world, so their
// reported coordinates are valid in our terrain), a name tag sprite, and an
// inverted-hull outline shell. Movement is interpolated ~150 ms behind the
// 15 Hz server snapshots so other cars glide instead of stuttering.
//
// The outline is the far-away beacon: it's visible while the other car is
// more than OUTLINE_DIST away and fades out as you close in, so up close
// you just see a clean car.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from "three";
import { buildCar, CARS } from "./cars";
import type { RemoteInfo, SnapRow } from "./net";

const OUTLINE_DIST = 500; // metres — closer than this, the shell fades out
const INTERP_DELAY = 150; // ms behind the newest snapshot
const STALE_AFTER = 5_000; // ms without data before we stop extrapolating

interface SnapPoint {
  t: number; // local receive time, ms
  x: number;
  y: number;
  z: number;
  h: number;
  s: number;
  st: number;
}

interface RemoteEntry {
  info: RemoteInfo;
  car: ReturnType<typeof buildCar>;
  outline: THREE.Group;
  outlineMat: THREE.MeshBasicMaterial;
  label: THREE.Sprite;
  labelW: number;
  wheelR: number;
  states: SnapPoint[];
  spin: number;
  // last rendered (or extrapolated) pose
  cur: { x: number; y: number; z: number; h: number; s: number; st: number };
}

/** Shortest signed angle from a to b, in radians. */
function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class RemotePlayers {
  private scene: THREE.Scene;
  private players = new Map<string, RemoteEntry>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  get count(): number {
    return this.players.size;
  }

  /** Reconcile the room roster: spawn cars for newcomers, drop departed ones. */
  applyRoster(list: RemoteInfo[]) {
    const seen = new Set(list.map((p) => p.id));
    for (const info of list) {
      if (!this.players.has(info.id)) this.spawn(info);
      else this.players.get(info.id)!.info = info; // name/car may have been refined
    }
    for (const id of [...this.players.keys()]) {
      if (!seen.has(id)) this.despawn(id);
    }
  }

  /** Buffer one batch of server snapshots, stamped with local arrival time. */
  applySnap(states: Map<string, SnapRow>) {
    const now = performance.now();
    for (const [id, row] of states) {
      const e = this.players.get(id);
      if (!e) continue; // roster for this player hasn't arrived yet — will build on it
      e.states.push({ t: now, x: row[0], y: row[1], z: row[2], h: row[3], s: row[4], st: row[5] });
      // keep a ~1 s tail
      while (e.states.length > 2 && e.states[0].t < now - 1000) e.states.shift();
    }
  }

  private spawn(info: RemoteInfo) {
    const spec = CARS.find((c) => c.id === info.car) ?? CARS[0];
    const car = buildCar(spec);

    // ── inverted-hull outline: a BackSide shell inflated a touch ──
    const outlineMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    });
    const outline = car.group.clone(true);
    outline.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if ((o as THREE.SpotLight).isSpotLight || (o as unknown as THREE.Light).isLight) {
        o.visible = false;
        return;
      }
      if (mesh.isMesh) {
        const m = mesh.material as THREE.MeshStandardMaterial;
        if (m && m.map) {
          o.visible = false; // skip the contact-shadow decal
          return;
        }
        mesh.material = outlineMat;
      }
    });
    outline.scale.setScalar(1.045);
    outline.visible = true;

    // ── name tag ──
    const label = makeLabel(info.name, spec.accent);
    const labelW = 2.1; // world metres at base scale

    this.scene.add(car.group, outline, label);
    this.players.set(info.id, {
      info,
      car,
      outline,
      outlineMat,
      label,
      labelW,
      wheelR: spec.wheelR,
      states: [],
      spin: 0,
      cur: { x: 0, y: 0, z: 0, h: 0, s: 0, st: 0 },
    });
  }

  private despawn(id: string) {
    const e = this.players.get(id);
    if (!e) return;
    this.scene.remove(e.car.group, e.outline, e.label);
    e.car.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
    e.car.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.dispose();
    });
    e.outlineMat.dispose();
    (e.label.material as THREE.SpriteMaterial).map?.dispose();
    (e.label.material as THREE.Material).dispose();
    this.players.delete(id);
  }

  /** Advance every remote to its interpolated pose for this frame. */
  update(dt: number, localPos: THREE.Vector3) {
    const now = performance.now();
    const target = now - INTERP_DELAY;

    for (const e of this.players.values()) {
      const st = e.states;
      if (st.length === 0) continue;

      let pose: SnapPoint;
      if (st.length === 1 || target <= st[0].t) {
        pose = st[0];
      } else {
        // find the bracketing pair
        let i = st.length - 1;
        while (i > 0 && st[i].t > target) i--;
        if (i === st.length - 1) {
          // newest sample is older than the render clock — extrapolate a
          // little along the last heading, capped, so hiccups stay smooth
          const last = st[i];
          const age = Math.min(target - last.t, STALE_AFTER);
          const drift = last.s * (age / 1000);
          const dirX = Math.sin(last.h);
          const dirZ = Math.cos(last.h);
          pose = {
            ...last,
            t: target,
            x: last.x + dirX * drift,
            z: last.z + dirZ * drift,
          };
        } else {
          const a = st[i];
          const b = st[i + 1];
          const u = (target - a.t) / Math.max(b.t - a.t, 1);
          pose = {
            t: target,
            x: a.x + (b.x - a.x) * u,
            y: a.y + (b.y - a.y) * u,
            z: a.z + (b.z - a.z) * u,
            h: a.h + angleDelta(a.h, b.h) * u,
            s: a.s + (b.s - a.s) * u,
            st: a.st + (b.st - a.st) * u,
          };
        }
      }

      e.cur = { x: pose.x, y: pose.y, z: pose.z, h: pose.h, s: pose.s, st: pose.st };

      // car body
      const g = e.car.group;
      g.position.set(pose.x, pose.y, pose.z);
      g.rotation.set(0, 0, 0);
      g.rotateY(pose.h);

      // wheels: steer the fronts, spin all four from their reported speed
      e.spin += (pose.s / e.wheelR) * dt;
      e.car.steerWheels.forEach((w) => (w.rotation.y = pose.st));
      e.car.wheels.forEach((w) => (w.rotation.x = -e.spin));

      // outline: on when far, fading smoothly out as you approach
      const dist = Math.hypot(pose.x - localPos.x, pose.z - localPos.z);
      const wantOutline = dist > OUTLINE_DIST ? 0.9 : 0;
      e.outlineMat.opacity += (wantOutline - e.outlineMat.opacity) * Math.min(1, dt * 4);
      e.outline.position.copy(g.position);
      e.outline.rotation.copy(g.rotation);
      e.outline.scale.setScalar(1.045);

      // name tag floats above the roof, gently growing with distance so it
      // stays legible at range
      const grow = Math.min(1 + dist / 150, 3.4);
      e.label.position.set(pose.x, pose.y + 2.05 + grow * 0.12, pose.z);
      const w = e.labelW * grow;
      e.label.scale.set(w, w * 0.25, 1);
    }
  }

  dispose() {
    for (const id of [...this.players.keys()]) this.despawn(id);
  }
}

/** Rounded pill with the player's name — crisp at any camera distance. */
function makeLabel(name: string, accent: string): THREE.Sprite {
  const pad = 24;
  const fontSize = 52;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  ctx.font = `bold ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
  const textW = Math.min(ctx.measureText(name).width, 640);
  canvas.width = Math.ceil(textW + pad * 2.6);
  canvas.height = 96;

  const c = canvas.getContext("2d")!;
  const r = 44;
  c.fillStyle = "rgba(41, 37, 36, 0.82)";
  c.beginPath();
  c.roundRect(4, 10, canvas.width - 8, 76, r);
  c.fill();
  c.fillStyle = accent;
  c.beginPath();
  c.arc(canvas.width / 2, 10 + 38, 9, 0, Math.PI * 2);
  c.fill();
  c.font = `bold ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillStyle = "#f6efe2";
  c.fillText(name, canvas.width / 2, 10 + 40, textW + 8);

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  sprite.renderOrder = 5;
  return sprite;
}
