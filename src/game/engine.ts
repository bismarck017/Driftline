// ─────────────────────────────────────────────────────────────────────────────
// Game engine: renderer setup, pastel sky & lighting, arcade car physics on the
// procedural terrain, chase camera, and the per-frame tile streaming loop.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from "three";
import { TileManager } from "./tiles";
import { buildCar, type CarSpec, type BuiltCar } from "./cars";
import { clamp, lerp } from "./noise";
import {
  TILE,
  heightAt,
  isOnRoad,
  roadDistance,
  terrainTypeAt,
  findRoadSpawn,
} from "./world";

export interface HudStats {
  kmh: number;
  biome: string;
  x: number;
  z: number;
  tilesLoaded: number;
  heading: number; // radians
  onRoad: boolean;
}

export interface EngineOptions {
  renderRadius: number; // 1 => 3x3, 2 => 5x5
  shadows: boolean;
  onHud?: (s: HudStats) => void;
}

const BIOME_LABEL: Record<string, string> = {
  ocean: "Open Water",
  beach: "Shoreline",
  meadow: "Meadowlands",
  forest: "Pinewood",
  desert: "Dunes",
  highlands: "Highlands",
  snow: "Snowfield",
};

export class DriveGame {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private raf = 0;
  private paused = false;
  private disposed = false;

  private tiles: TileManager;
  private sun: THREE.DirectionalLight;
  private sky: THREE.Mesh;
  private waterTime: { value: number };

  private car: CarSpec;
  private built: BuiltCar;
  private pos = new THREE.Vector3();
  private heading = 0;
  private speed = 0;
  private steerAngle = 0;
  private pitch = 0;
  private roll = 0;
  private smoothY = 0;
  private wheelSpin = 0;
  private cameraMode = 0; // 0 chase, 1 far cinematic
  private hudTimer = 0;

  private keys = new Set<string>();
  private opts: EngineOptions;
  private onHud?: (s: HudStats) => void;
  private resizeHandler: () => void;

  constructor(canvas: HTMLCanvasElement, car: CarSpec, opts: EngineOptions) {
    this.canvas = canvas;
    this.car = car;
    this.opts = opts;
    this.onHud = opts.onHud;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.shadowMap.enabled = opts.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xf3e7d3, opts.renderRadius * TILE * 0.7, opts.renderRadius * TILE * 1.55 + 120);

    this.camera = new THREE.PerspectiveCamera(58, 1, 0.3, 6000);

    // ── pastel sky dome ──
    const skyGeo = new THREE.SphereGeometry(3200, 24, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x9ec4dd) },
        horizon: { value: new THREE.Color(0xf6e9d2) },
        bottom: { value: new THREE.Color(0xe8dcc8) },
        sunDir: { value: new THREE.Vector3(0.45, 0.55, 0.35).normalize() },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform vec3 top;
        uniform vec3 horizon;
        uniform vec3 bottom;
        uniform vec3 sunDir;
        varying vec3 vDir;
        void main() {
          float h = vDir.y;
          vec3 col = h > 0.0 ? mix(horizon, top, pow(min(h, 1.0), 0.62))
                             : mix(horizon, bottom, min(-h * 3.0, 1.0));
          float sun = pow(max(dot(normalize(vDir), normalize(sunDir)), 0.0), 220.0);
          float halo = pow(max(dot(normalize(vDir), normalize(sunDir)), 0.0), 8.0) * 0.16;
          col += vec3(1.0, 0.95, 0.8) * (sun * 0.9 + halo);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.sky = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(this.sky);

    // ── lighting ──
    const hemi = new THREE.HemisphereLight(0xd7e8ee, 0xc9c2b2, 0.85);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xfff2dd, 1.9);
    this.sun.position.set(60, 90, 40);
    if (opts.shadows) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(2048, 2048);
      const c = this.sun.shadow.camera;
      c.left = -95;
      c.right = 95;
      c.top = 95;
      c.bottom = -95;
      c.near = 1;
      c.far = 400;
      this.sun.shadow.bias = -0.0004;
      this.sun.shadow.normalBias = 0.6;
    }
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // ── water time uniform + tiles ──
    this.waterTime = { value: 0 };
    this.tiles = new TileManager(this.scene, opts.renderRadius, { time: this.waterTime });

    // ── the player's car ──
    this.built = buildCar(car);
    this.scene.add(this.built.group);

    const spawn = findRoadSpawn();
    this.pos.set(spawn.x, heightAt(spawn.x, spawn.z), spawn.z);
    this.heading = spawn.heading;
    this.smoothY = this.pos.y;
    this.tiles.preload(this.pos.x, this.pos.z);

    // ── input ──
    this.resizeHandler = () => this.resize();
    window.addEventListener("resize", this.resizeHandler);
    this.resize();
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  }

  // ── public API ─────────────────────────────────────────────────────────────

  start() {
    this.clock.start();
    this.loop();
  }

  pause() {
    this.paused = true;
  }

  resume() {
    if (!this.disposed) {
      this.paused = false;
      this.clock.getDelta(); // swallow the pause gap
    }
  }

  setRenderRadius(r: number) {
    this.opts.renderRadius = r;
    this.tiles.setRadius(r);
    (this.scene.fog as THREE.Fog).near = r * TILE * 0.7;
    (this.scene.fog as THREE.Fog).far = r * TILE * 1.55 + 120;
  }

  setShadows(on: boolean) {
    this.opts.shadows = on;
    this.renderer.shadowMap.enabled = on;
    this.sun.castShadow = on;
    // materials need a nudge to recompile
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (m) {
        if (Array.isArray(m)) m.forEach((mm) => mm.needsUpdate = true);
        else m.needsUpdate = true;
      }
    });
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resizeHandler);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.built.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
    this.built.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.dispose();
    });
    this.tiles.disposeAll();
    this.sky.geometry.dispose();
    (this.sky.material as THREE.Material).dispose();
    this.renderer.dispose();
  }

  // ── input handlers ──────────────────────────────────────────────────────────

  /** Normalize key events: prefer e.code, fall back to e.key (some environments
   *  omit `code`, e.g. automated browsers / some IMEs). */
  private keyFor(e: KeyboardEvent): string {
    if (e.code) return e.code;
    switch (e.key) {
      case "ArrowUp":
      case "ArrowDown":
      case "ArrowLeft":
      case "ArrowRight":
        return e.key;
      case " ":
        return "Space";
      default:
        if (e.key.length === 1) return `Key${e.key.toUpperCase()}`;
        return `Key${e.key}`;
    }
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const code = this.keyFor(e);
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(code)) {
      e.preventDefault();
    }
    if (e.repeat) return;
    this.keys.add(code);
    if (code === "KeyC") this.cameraMode = 1 - this.cameraMode;
    if (code === "KeyR") this.respawn();
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(this.keyFor(e));
  };
  private onBlur = () => {
    this.keys.clear();
  };

  // ── helpers ────────────────────────────────────────────────────────────────

  private resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private respawn() {
    const spawn = findRoadSpawnNearest(this.pos.x, this.pos.z);
    this.pos.set(spawn.x, heightAt(spawn.x, spawn.z), spawn.z);
    this.heading = spawn.heading;
    this.speed = 0;
    this.smoothY = this.pos.y;
  }

  // ── physics ────────────────────────────────────────────────────────────────

  private updatePhysics(dt: number) {
    const s = this.car.stats;
    const k = this.keys;

    // inputs
    const throttle = k.has("KeyW") || k.has("ArrowUp") ? 1 : 0;
    const brake = k.has("KeyS") || k.has("ArrowDown") ? 1 : 0;
    const steerIn = (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0) - (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0);
    const handbrake = k.has("Space");

    // surface conditions
    const h = heightAt(this.pos.x, this.pos.z);
    const onRoad = isOnRoad(this.pos.x, this.pos.z);
    const inWater = h < 0.35; // shallow water / river fords

    let surfaceFactor = onRoad ? 1 : s.offroad;
    if (inWater) surfaceFactor *= 0.25;
    // heavy viscous drag in water — rivers can be forded slowly, lakes will bog you down
    if (inWater) this.speed -= this.speed * 2.4 * dt;

    // longitudinal
    const topSpeed = s.topSpeed * (onRoad ? 1 : lerp(s.offroad, 1, 0.25));
    if (throttle) {
      const powerCurve = 1 - Math.max(this.speed, 0) / (topSpeed * 1.35);
      this.speed += s.accel * Math.max(powerCurve, 0) * surfaceFactor * dt;
    }
    if (brake) {
      if (this.speed > 0.5) this.speed -= 26 * dt;
      else this.speed -= s.accel * 0.45 * surfaceFactor * dt; // reverse
    }
    if (handbrake) this.speed -= Math.sign(this.speed) * 14 * dt;

    // drag & rolling resistance
    const drag = onRoad ? 0.06 : 0.16;
    this.speed -= this.speed * drag * dt;
    this.speed -= Math.sign(this.speed) * (onRoad ? 0.8 : 2.2) * dt;
    if (Math.abs(this.speed) < 0.02 && !throttle && !brake) this.speed = 0;
    this.speed = clamp(this.speed, -topSpeed * 0.25, topSpeed);

    // slope gravity: steeper climbs bleed speed, descents add it
    const dirX = Math.sin(this.heading);
    const dirZ = Math.cos(this.heading);
    const ahead = heightAt(this.pos.x + dirX * 2, this.pos.z + dirZ * 2);
    const behind = heightAt(this.pos.x - dirX * 2, this.pos.z - dirZ * 2);
    const slope = (ahead - behind) / 4;
    this.speed -= slope * 16 * dt;

    // steering
    const speedRatio = clamp(Math.abs(this.speed) / 10, 0, 1);
    const steerRate = 1.9 * s.grip * (handbrake ? 1.7 : 1);
    const effectiveSteer = steerIn * steerRate * speedRatio * (this.speed < 0 ? -1 : 1) * dt;
    this.heading += effectiveSteer;
    this.steerAngle = lerp(this.steerAngle, steerIn * 0.42, 1 - Math.exp(-10 * dt));

    // integrate position
    this.pos.x += dirX * this.speed * dt;
    this.pos.z += dirZ * this.speed * dt;

    // fell into deep water? respawn
    const newH = heightAt(this.pos.x, this.pos.z);
    if (newH < -2.6) {
      this.respawn();
      return;
    }

    // ground follow with soft suspension
    const wheelH =
      (heightAt(this.pos.x + dirX * 1.4, this.pos.z + dirZ * 1.4) +
        heightAt(this.pos.x - dirX * 1.4, this.pos.z - dirZ * 1.4) +
        heightAt(this.pos.x - dirZ * 1.1, this.pos.z + dirX * 1.1) +
        heightAt(this.pos.x + dirZ * 1.1, this.pos.z - dirX * 1.1)) /
      4;
    const targetY = Math.max(wheelH, -0.15) + this.car.wheelR;
    this.smoothY = lerp(this.smoothY, targetY, 1 - Math.exp(-14 * dt));
    this.pos.y = this.smoothY;

    // body attitude from terrain
    const forwardPitch = Math.atan2(
      heightAt(this.pos.x + dirX * 1.4, this.pos.z + dirZ * 1.4) - heightAt(this.pos.x - dirX * 1.4, this.pos.z - dirZ * 1.4),
      2.8
    );
    const sideRoll = Math.atan2(
      heightAt(this.pos.x - dirZ * 1.1, this.pos.z + dirX * 1.1) - heightAt(this.pos.x + dirZ * 1.1, this.pos.z - dirX * 1.1),
      2.2
    );
    this.pitch = lerp(this.pitch, forwardPitch, 1 - Math.exp(-8 * dt));
    this.roll = lerp(this.roll, sideRoll + this.steerAngle * clamp(this.speed / 40, 0, 1) * 0.18, 1 - Math.exp(-8 * dt));

    // apply to car mesh
    this.built.group.position.copy(this.pos);
    this.built.group.rotation.set(0, 0, 0);
    this.built.group.rotateY(this.heading);
    this.built.group.rotateX(-this.pitch); // nose up on climb
    this.built.group.rotateZ(-this.roll);

    // wheels: steer + spin
    this.wheelSpin += (this.speed / this.car.wheelR) * dt;
    this.built.steerWheels.forEach((w) => {
      w.rotation.y = this.steerAngle;
    });
    this.built.wheels.forEach((w) => {
      w.rotation.x = -this.wheelSpin;
    });
  }

  // ── camera ─────────────────────────────────────────────────────────────────

  private updateCamera(dt: number) {
    const dirX = Math.sin(this.heading);
    const dirZ = Math.cos(this.heading);
    const sp = Math.abs(this.speed);
    const far = this.cameraMode === 1;
    const dist = (far ? 16 : 8.2) + sp * (far ? 0.16 : 0.09);
    const height = far ? 9.5 : 3.1 + sp * 0.012;

    const camX = this.pos.x - dirX * dist;
    const camZ = this.pos.z - dirZ * dist;
    const groundClear = heightAt(camX, camZ) + 1.6;
    const camY = Math.max(this.pos.y + height, groundClear);

    _camPos.set(camX, camY, camZ);
    this.camera.position.lerp(_camPos, 1 - Math.exp(-(far ? 3 : 6) * dt));

    _look.set(this.pos.x + dirX * 7, this.pos.y + 1.6, this.pos.z + dirZ * 7);
    this.camera.lookAt(_look);

    const fov = 56 + clamp(sp / 60, 0, 1) * 10;
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov = lerp(this.camera.fov, fov, 1 - Math.exp(-4 * dt));
      this.camera.updateProjectionMatrix();
    }

    // keep the sky dome centred on the camera
    this.sky.position.copy(this.camera.position);
  }

  // ── main loop ──────────────────────────────────────────────────────────────

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.paused) return;

    this.waterTime.value += dt;
    this.updatePhysics(dt);
    this.tiles.update(this.pos.x, this.pos.z);

    // shadow frustum follows the car (snapped to reduce shimmer)
    const sx = Math.round(this.pos.x / 2) * 2;
    const sz = Math.round(this.pos.z / 2) * 2;
    this.sun.position.set(sx + 60, 95, sz + 40);
    this.sun.target.position.set(sx, 0, sz);

    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);

    // HUD ~8x per second
    this.hudTimer += dt;
    if (this.hudTimer > 0.12 && this.onHud) {
      this.hudTimer = 0;
      const h = heightAt(this.pos.x, this.pos.z);
      const tt = h < 0.35 && !isOnRoad(this.pos.x, this.pos.z) ? "ocean" : terrainTypeAt(this.pos.x, this.pos.z, Math.max(h, 0));
      this.onHud({
        kmh: Math.round(Math.abs(this.speed) * 3.6),
        biome: BIOME_LABEL[tt] ?? tt,
        x: this.pos.x,
        z: this.pos.z,
        tilesLoaded: this.tiles.loadedCount,
        heading: this.heading,
        onRoad: isOnRoad(this.pos.x, this.pos.z),
      });
    }
  };
}

// scratch vectors
const _camPos = new THREE.Vector3();
const _look = new THREE.Vector3();

/** Spawn on the road lattice closest to a given position (for the R-key reset). */
function findRoadSpawnNearest(px: number, pz: number): { x: number; z: number; heading: number } {
  const fallback = findRoadSpawn();
  let best = fallback;
  let bestD = Infinity;
  // coarse scan around the player, then refine
  for (let z = pz - 480; z <= pz + 480; z += 48) {
    let bx = px;
    let bd = Infinity;
    for (let dx = -300; dx <= 300; dx += 6) {
      const d = roadDistance(px + dx, z);
      if (d < bd) {
        bd = d;
        bx = px + dx;
      }
    }
    if (bd > 6 || heightAt(bx, z) < 1.2) continue;
    const x2 = bestNextX(bx, z + 1);
    const cand = { x: bx, z, heading: Math.atan2(x2 - bx, 1) };
    const d = (bx - px) ** 2 + (z - pz) ** 2;
    if (d < bestD) {
      bestD = d;
      best = cand;
    }
  }
  return bestD < Infinity ? best : fallback;
}

function bestNextX(bx: number, z: number): number {
  let best = bx;
  let bd = Infinity;
  for (let dx = -4; dx <= 4; dx += 2) {
    const d = roadDistance(bx + dx, z);
    if (d < bd) {
      bd = d;
      best = bx + dx;
    }
  }
  return best;
}
