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
  surfaceHeightAt,
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
  clock: string; // "14:23"
  tod: number; // time of day in hours [0, 24)
  // drivetrain / gauge cluster
  gear: number; // -1 = R, 0 = N, 1..N = forward gear
  revs: number; // 0..1 (0 = idle, 1 = redline)
  distance: number; // metres travelled
  locked: boolean; // wheels locked & skidding under heavy braking
}

export interface EngineOptions {
  renderRadius: number; // 1 => 3x3, 2 => 5x5
  shadows: boolean;
  onHud?: (s: HudStats) => void;
  timeOfDay?: number; // starting hour [0, 24)
  cycleEnabled?: boolean; // advance time automatically?
  dayLength?: number; // real seconds per in-world day
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

// ── Day-night environment ─────────────────────────────────────────────────────
// Keyframed pastel palettes over 24h: deep night -> dawn rose -> morning mist ->
// bright pastel noon -> golden hour -> peach sunset -> violet twilight -> night.
// Terrain keeps its vibrant vertex colours; the cycle only modulates sky, fog,
// lights, water tint and exposure, so the world stays pastel at every hour.

interface EnvKey {
  t: number;
  top: string;
  hor: string;
  bot: string;
  fog: string;
  sunC: string;
  sunI: number;
  hemiS: string;
  hemiG: string;
  hemiI: number;
  night: number;
  exp: number;
  water: string;
}

const ENV_KEYS: EnvKey[] = [
  { t: 0, top: "#20263f", hor: "#454c6e", bot: "#333953", fog: "#363d5c", sunC: "#aeb9dd", sunI: 0.32, hemiS: "#3a4468", hemiG: "#2e3246", hemiI: 0.34, night: 1, exp: 0.94, water: "#46517a" },
  { t: 4.6, top: "#2b3455", hor: "#6d5f80", bot: "#454a6b", fog: "#565a80", sunC: "#cabbd0", sunI: 0.38, hemiS: "#4c5379", hemiG: "#3a3c55", hemiI: 0.4, night: 0.85, exp: 0.97, water: "#6b6b95" },
  { t: 6.3, top: "#7b6d9e", hor: "#f2b8a0", bot: "#d9a99a", fog: "#e7c2ad", sunC: "#ffc9a3", sunI: 1.05, hemiS: "#8f86ad", hemiG: "#b08a7a", hemiI: 0.6, night: 0.22, exp: 1.02, water: "#d9b3a8" },
  { t: 9, top: "#8fb8d8", hor: "#f6e3c8", bot: "#e6d9c2", fog: "#efe1cc", sunC: "#ffe8cc", sunI: 1.65, hemiS: "#c5dbe8", hemiG: "#c3bba8", hemiI: 0.8, night: 0, exp: 1.06, water: "#e8e2d4" },
  { t: 13, top: "#9ec4dd", hor: "#f6e9d2", bot: "#e8dcc8", fog: "#f3e7d3", sunC: "#fff2dd", sunI: 1.9, hemiS: "#d7e8ee", hemiG: "#c9c2b2", hemiI: 0.85, night: 0, exp: 1.06, water: "#ffffff" },
  { t: 16.8, top: "#93b3d4", hor: "#f6ddc0", bot: "#e6d0b8", fog: "#efdcbf", sunC: "#ffe0b8", sunI: 1.75, hemiS: "#c9d8e4", hemiG: "#c4b49e", hemiI: 0.8, night: 0, exp: 1.05, water: "#f2e0cf" },
  { t: 18.7, top: "#8a76a8", hor: "#f5ad8d", bot: "#d99f92", fog: "#e6b19b", sunC: "#ffab7d", sunI: 1.1, hemiS: "#9d8fae", hemiG: "#a8837a", hemiI: 0.6, night: 0.22, exp: 1.0, water: "#e2b3a2" },
  { t: 20.2, top: "#3c4470", hor: "#8a6a85", bot: "#4f5273", fog: "#6b5f7f", sunC: "#d0a8c8", sunI: 0.45, hemiS: "#565b85", hemiG: "#47445f", hemiI: 0.42, night: 0.75, exp: 0.96, water: "#7d7ba0" },
  { t: 24, top: "#20263f", hor: "#454c6e", bot: "#333953", fog: "#363d5c", sunC: "#aeb9dd", sunI: 0.32, hemiS: "#3a4468", hemiG: "#2e3246", hemiI: 0.34, night: 1, exp: 0.94, water: "#46517a" },
];

interface EnvCompiled {
  t: number;
  top: THREE.Color;
  hor: THREE.Color;
  bot: THREE.Color;
  fog: THREE.Color;
  sunC: THREE.Color;
  sunI: number;
  hemiS: THREE.Color;
  hemiG: THREE.Color;
  hemiI: number;
  night: number;
  exp: number;
  water: THREE.Color;
}

let envKeysCompiled: EnvCompiled[] | null = null;
function getEnvKeys(): EnvCompiled[] {
  if (!envKeysCompiled) {
    envKeysCompiled = ENV_KEYS.map((k) => ({
      t: k.t,
      top: new THREE.Color(k.top),
      hor: new THREE.Color(k.hor),
      bot: new THREE.Color(k.bot),
      fog: new THREE.Color(k.fog),
      sunC: new THREE.Color(k.sunC),
      sunI: k.sunI,
      hemiS: new THREE.Color(k.hemiS),
      hemiG: new THREE.Color(k.hemiG),
      hemiI: k.hemiI,
      night: k.night,
      exp: k.exp,
      water: new THREE.Color(k.water),
    }));
  }
  return envKeysCompiled;
}

/** Scratch result of sampling the 24h environment. */
type EnvSample = EnvCompiled;

function sampleEnv(tod: number, out: EnvSample): EnvSample {
  const keys = getEnvKeys();
  const t = ((tod % 24) + 24) % 24;
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  let u = (t - a.t) / (b.t - a.t);
  u = u * u * (3 - 2 * u); // smoothstep for buttery transitions
  out.t = t;
  out.top.lerpColors(a.top, b.top, u);
  out.hor.lerpColors(a.hor, b.hor, u);
  out.bot.lerpColors(a.bot, b.bot, u);
  out.fog.lerpColors(a.fog, b.fog, u);
  out.sunC.lerpColors(a.sunC, b.sunC, u);
  out.hemiS.lerpColors(a.hemiS, b.hemiS, u);
  out.hemiG.lerpColors(a.hemiG, b.hemiG, u);
  out.water.lerpColors(a.water, b.water, u);
  out.sunI = lerp(a.sunI, b.sunI, u);
  out.hemiI = lerp(a.hemiI, b.hemiI, u);
  out.night = lerp(a.night, b.night, u);
  out.exp = lerp(a.exp, b.exp, u);
  return out;
}

const _env: EnvSample = {
  t: 0,
  top: new THREE.Color(),
  hor: new THREE.Color(),
  bot: new THREE.Color(),
  fog: new THREE.Color(),
  sunC: new THREE.Color(),
  sunI: 1,
  hemiS: new THREE.Color(),
  hemiG: new THREE.Color(),
  hemiI: 0.8,
  night: 0,
  exp: 1,
  water: new THREE.Color(),
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
  private waterTime = { value: 0 };

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
  private stuckTimer = 0; // bogged-in-water watchdog

  // drivetrain & tire state
  private gear = 1;
  private gearTop: number[] = []; // shift points (m/s) per forward gear
  private revs = 0;
  private odometer = 0; // metres travelled
  private lockProg = 0; // brake-lockup accumulation 0..1
  private locked = false;
  private throttleIn = false;
  private revBlend = 0; // 0 = chase cam behind, 1 = reverse cam ahead

  // day-night state
  private todHours = 10; // in-world hour [0, 24)
  private cycleEnabled = true;
  private dayLength = 240; // real seconds per in-world day
  private hemi!: THREE.HemisphereLight;
  private skyU!: Record<string, THREE.IUniform>;
  private waterTint = { value: new THREE.Color(1, 1, 1) };
  private headlights!: THREE.SpotLight;
  private glowMats: [THREE.MeshStandardMaterial, number][] = [];
  private _sunDir = new THREE.Vector3();

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

    this.todHours = ((opts.timeOfDay ?? 10) % 24 + 24) % 24;
    this.cycleEnabled = opts.cycleEnabled ?? true;
    this.dayLength = opts.dayLength ?? 240;

    // ── pastel sky dome (with day-night stars + moon) ──
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
        sunColor: { value: new THREE.Color(0xfff2dd) },
        night: { value: 0 },
        time: this.waterTime, // shared clock (also drives the star twinkle)
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
        uniform vec3 sunColor;
        uniform float night;
        uniform float time;
        varying vec3 vDir;
        void main() {
          float h = vDir.y;
          vec3 col = h > 0.0 ? mix(horizon, top, pow(min(h, 1.0), 0.62))
                             : mix(horizon, bottom, min(-h * 3.0, 1.0));
          vec3 sd = normalize(sunDir);
          vec3 dir = normalize(vDir);
          float sunDot = max(dot(dir, sd), 0.0);
          float sunVis = smoothstep(-0.10, 0.06, sd.y);
          float sun = pow(sunDot, 240.0) * 0.9 + pow(sunDot, 8.0) * 0.16;
          col += sunColor * sun * (1.0 - night) * sunVis;
          // moon rides the opposite arc, crisp pale disc + faint glow
          vec3 md = -sd;
          float moonDot = max(dot(dir, md), 0.0);
          float moonVis = smoothstep(-0.10, 0.06, md.y);
          float moon = pow(moonDot, 900.0) * 1.1 + pow(moonDot, 90.0) * 0.10;
          col += vec3(0.85, 0.90, 1.0) * moon * night * moonVis;
          // starfield — hash-jittered points per cell, twinkling, fading at horizon
          if (night > 0.02 && h > 0.02) {
            vec3 sp = dir * 190.0;
            vec3 cell = floor(sp);
            vec3 f = fract(sp) - 0.5;
            float h1 = fract(sin(dot(cell, vec3(127.1, 311.7, 74.7))) * 43758.5453);
            float h2 = fract(sin(dot(cell, vec3(269.5, 183.3, 246.1))) * 28001.8384);
            float h3 = fract(sin(dot(cell, vec3(113.5, 271.9, 124.6))) * 31373.5453);
            vec3 jitter = (vec3(h1, h2, h3) - 0.5) * 0.55;
            float d = length(f - jitter);
            float star = smoothstep(0.16, 0.02, d) * step(0.992, h2);
            float tw = 0.65 + 0.35 * sin(time * 2.0 + h1 * 41.0);
            col += vec3(0.92, 0.94, 1.0) * star * tw * night * smoothstep(0.02, 0.25, h);
          }
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.sky = new THREE.Mesh(skyGeo, skyMat);
    this.skyU = skyMat.uniforms as Record<string, THREE.IUniform>;
    this.scene.add(this.sky);

    // ── lighting ──
    const hemi = new THREE.HemisphereLight(0xd7e8ee, 0xc9c2b2, 0.85);
    this.hemi = hemi;
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
      this.sun.shadow.bias = -0.0002;
      this.sun.shadow.normalBias = 0.04;
    }
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // ── water time uniform + tiles ──
    this.tiles = new TileManager(this.scene, opts.renderRadius, { time: this.waterTime, tint: this.waterTint });

    // ── the player's car ──
    this.built = buildCar(car);
    this.scene.add(this.built.group);

    // gearbox: shift points as widening fractions of the road top speed
    const pattern = car.id === "sport" ? [0.24, 0.4, 0.55, 0.7, 0.86, 1.02] : [0.3, 0.48, 0.66, 0.84, 1.02];
    this.gearTop = pattern.map((f) => f * car.stats.topSpeed);

    // headlight beam (auto-on at night) + boosted emissive lamps
    this.headlights = new THREE.SpotLight(0xffe3ae, 0, 85, 0.62, 0.55, 1);
    this.headlights.position.set(0, 0.85, 1.5);
    const beamTarget = new THREE.Object3D();
    beamTarget.position.set(0, 0.1, 14);
    this.built.group.add(this.headlights, beamTarget);
    this.headlights.target = beamTarget;
    this.headlights.castShadow = false;
    this.built.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && (m as THREE.MeshStandardMaterial).isMeshStandardMaterial && m.emissiveIntensity > 0) {
        if (!this.glowMats.some((g) => g[0] === m)) this.glowMats.push([m, m.emissiveIntensity]);
      }
    });

    const spawn = findRoadSpawn();
    this.pos.set(spawn.x, surfaceHeightAt(spawn.x, spawn.z), spawn.z);
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

  // ── day-night public API ─────────────────────────────────────────────────────

  /** Enable/disable the automatic day-night cycle; optionally change the day
   *  length (real seconds per in-world 24h). When disabled, time freezes at
   *  its current value until lockTimeOfDay() is called. */
  setCycle(enabled: boolean, dayLengthSeconds?: number) {
    this.cycleEnabled = enabled;
    if (dayLengthSeconds !== undefined) this.dayLength = Math.max(30, dayLengthSeconds);
  }

  /** Freeze the world at a specific hour [0, 24). Disables the cycle. */
  lockTimeOfDay(hours: number) {
    this.cycleEnabled = false;
    this.todHours = ((hours % 24) + 24) % 24;
  }

  /** Current time of day in hours [0, 24). */
  get timeOfDay(): number {
    return this.todHours;
  }

  /**
   * Push the current time of day into every visual system: sky gradient, sun
   * and moon discs, stars, fog, hemisphere + directional lights, water tint,
   * tone-mapping exposure and the car's automatic headlights.
   */
  private applyEnvironment() {
    const e = sampleEnv(this.todHours, _env);

    // sun/moon arc: 6:00 sunrise in the east, 12:00 high noon, 18:00 sunset west
    const a = ((this.todHours - 6) / 24) * Math.PI * 2;
    this._sunDir.set(Math.cos(a), Math.sin(a), 0.38).normalize();

    (this.skyU.top.value as THREE.Color).copy(e.top);
    (this.skyU.horizon.value as THREE.Color).copy(e.hor);
    (this.skyU.bottom.value as THREE.Color).copy(e.bot);
    (this.skyU.sunColor.value as THREE.Color).copy(e.sunC);
    (this.skyU.sunDir.value as THREE.Vector3).copy(this._sunDir);
    (this.skyU.night as THREE.IUniform).value = e.night;

    (this.scene.fog as THREE.Fog).color.copy(e.fog);
    this.hemi.color.copy(e.hemiS);
    this.hemi.groundColor.copy(e.hemiG);
    this.hemi.intensity = e.hemiI;
    this.sun.color.copy(e.sunC);
    this.sun.intensity = e.sunI;
    this.renderer.toneMappingExposure = e.exp;
    this.waterTint.value.copy(e.water);

    // automatic headlights — fade in through twilight, boost the lamp glow
    const hl = clamp(e.night * 1.25, 0, 1);
    this.headlights.intensity = 30 * hl;
    for (const [m, base] of this.glowMats) m.emissiveIntensity = base * (1 + 1.9 * hl);
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
    this.pos.set(spawn.x, surfaceHeightAt(spawn.x, spawn.z), spawn.z);
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
    const h = surfaceHeightAt(this.pos.x, this.pos.z);
    const onRoad = isOnRoad(this.pos.x, this.pos.z);
    const inWater = h < 0.35; // shallow water / river fords

    let surfaceFactor = onRoad ? 1 : s.offroad;
    if (inWater) surfaceFactor *= 0.25;
    // heavy viscous drag in water — rivers can be forded slowly, lakes will bog you down
    if (inWater) this.speed -= this.speed * 2.4 * dt;

    // ── gearbox: auto shift up through the speed ranges, back down on lift ──
    const roadTop = s.topSpeed;
    const hi = this.gearTop[this.gear - 1];
    const lo = this.gear > 1 ? this.gearTop[this.gear - 2] * 0.92 : 0;
    if (this.speed > hi && this.gear < this.gearTop.length) this.gear++;
    else if (this.speed < lo && this.gear > 1) this.gear--;

    // revs within the current gear, with a little launch flare and a
    // scaled "reverse gear" band when backing up
    let revNorm = clamp((this.speed - lo) / Math.max(hi - lo, 1), 0, 1);
    if (throttle && this.speed < 1.5) revNorm = Math.max(revNorm, 0.5);
    if (this.speed < -0.3) revNorm = clamp(Math.abs(this.speed) / (roadTop * 0.25), 0, 1) * 0.85;
    this.revs = lerp(this.revs, revNorm, 1 - Math.exp(-8 * dt));

    // longitudinal
    const topSpeed = roadTop * (onRoad ? 1 : lerp(s.offroad, 1, 0.25));
    if (throttle) {
      const powerCurve = 1 - Math.max(this.speed, 0) / (topSpeed * 1.35);
      const torque = lerp(0.62, 1, revNorm); // short gears pull harder
      this.speed += s.accel * Math.max(powerCurve, 0) * torque * surfaceFactor * dt;
    }
    if (brake && this.speed > 0.5) {
      // heavy braking — the fronts can lock and the car skids. At speed the
      // pedal overpowers the tires almost immediately (real stomp = lock);
      // parking-speed stops stay controlled because lock builds slowly there.
      const lockGain = (this.speed > 9 ? 3.4 : 0.9) * (onRoad ? 1 : 1.5);
      this.lockProg = clamp(this.lockProg + lockGain * dt, 0, 1);
      this.speed -= (this.lockProg >= 1 ? 13.5 : 26) * dt;
    } else if (brake) {
      this.speed -= s.accel * 0.45 * surfaceFactor * dt; // reverse
    } else {
      this.lockProg = Math.max(0, this.lockProg - 3 * dt);
    }
    this.locked = this.lockProg >= 1 && this.speed > 4;
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
    const ahead = surfaceHeightAt(this.pos.x + dirX * 2, this.pos.z + dirZ * 2);
    const behind = surfaceHeightAt(this.pos.x - dirX * 2, this.pos.z - dirZ * 2);
    const slope = (ahead - behind) / 4;
    this.speed -= slope * 16 * dt;
    // steep faces act like walls: extra braking beyond ~50% grade so the car
    // can't claw its way up cliffs (this is what prevented sinking/porpoising)
    if (slope > 0.5 && this.speed > 0) this.speed -= (slope - 0.5) * 120 * dt;
    if (slope < -0.5 && this.speed < 0) this.speed -= (slope + 0.5) * 120 * dt;

    // steering — the yaw the tires can actually deliver is capped by grip,
    // so inertia limits how fast the car changes direction at speed
    const speedRatio = clamp(Math.abs(this.speed) / 10, 0, 1);
    const steerRate = 1.9 * s.grip * (handbrake ? 1.7 : 1);
    const desired = steerIn * steerRate * speedRatio * (this.speed < 0 ? -1 : 1);
    const latMax = 12.5 * s.grip * (this.locked ? 0.34 : 1) * (handbrake ? 1.55 : 1);
    const yawMax = latMax / Math.max(Math.abs(this.speed), 2.5);
    this.heading += clamp(desired, -yawMax, yawMax) * dt;
    // locked wheels keep their momentum — the nose keeps drifting with committed
    // steering input, so you counter-steer through the slide
    if (this.locked) this.heading += this.steerAngle * 0.4 * clamp(this.speed / 30, 0, 1) * dt;
    this.steerAngle = lerp(this.steerAngle, steerIn * 0.42, 1 - Math.exp(-10 * dt));

    // torque steer: a hard launch tugs the nose to one side until speed builds
    if (throttle && this.speed > -0.1) {
      const decay = 1 - clamp(this.speed / 9, 0, 1);
      this.heading -= (0.05 + s.accel * 0.004) * decay * decay * dt;
    }

    // integrate position
    this.pos.x += dirX * this.speed * dt;
    this.pos.z += dirZ * this.speed * dt;
    this.odometer += Math.abs(this.speed) * dt;
    this.throttleIn = !!throttle;

    // fell into deep water? respawn (river beds carve to ~-1.9, so anything
    // below -1.35 is undriveable — never leave the car floating there)
    const newH = surfaceHeightAt(this.pos.x, this.pos.z);
    if (newH < -1.35) {
      this.respawn();
      return;
    }

    // bogged down in shallow water (heavy drag, no traction)? after a few
    // seconds of barely moving, rescue the player back onto the road
    if (inWater && Math.abs(this.speed) < 0.6) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 3) {
        this.stuckTimer = 0;
        this.respawn();
        return;
      }
    } else {
      this.stuckTimer = 0;
    }

    // ground follow with soft suspension — anti-sink:
    //  · body height = average of the four wheel contact points (physical)
    //  · if the terrain pokes up under the chassis centre (crest), lift to clear
    //  · rise quickly (no lagging into uphills), settle down gently (airtime)
    const hFL = surfaceHeightAt(this.pos.x - dirZ * 1.1 + dirX * 1.4, this.pos.z + dirX * 1.1 + dirZ * 1.4);
    const hFR = surfaceHeightAt(this.pos.x + dirZ * 1.1 + dirX * 1.4, this.pos.z - dirX * 1.1 + dirZ * 1.4);
    const hRL = surfaceHeightAt(this.pos.x - dirZ * 1.1 - dirX * 1.4, this.pos.z + dirX * 1.1 - dirZ * 1.4);
    const hRR = surfaceHeightAt(this.pos.x + dirZ * 1.1 - dirX * 1.4, this.pos.z - dirX * 1.1 - dirZ * 1.4);
    const hC = surfaceHeightAt(this.pos.x, this.pos.z);
    const avg = (hFL + hFR + hRL + hRR) / 4;
    const groundH = Math.max(avg, hC - 0.15);
    const targetY = Math.max(groundH, -0.15);
    const rate = targetY >= this.smoothY ? 30 : 13;
    this.smoothY = lerp(this.smoothY, targetY, 1 - Math.exp(-rate * dt));
    // hard floor: the rendered surface IS the physics surface (surfaceHeightAt
    // interpolates the exact mesh triangles), so with a tight tolerance the
    // wheels can visibly touch the ground everywhere — no sink, no hover
    this.pos.y = Math.max(this.smoothY, Math.max(hFL, hFR, hRL, hRR, hC) - 0.1);

    // body attitude from terrain (reuse the wheel samples — cheap and smooth)
    const forwardPitch = Math.atan2((hFL + hFR) / 2 - (hRL + hRR) / 2, 2.8);
    const sideRoll = Math.atan2((hFL + hRL) / 2 - (hFR + hRR) / 2, 2.2);
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

    // reversing? the camera swings around to the front and looks down the
    // car's path of travel, so you can see where you're backing into
    this.revBlend = lerp(this.revBlend, this.speed < -0.6 ? 1 : 0, 1 - Math.exp(-3.2 * dt));
    const side = dist * (2 * this.revBlend - 1); // -dist behind .. +dist ahead
    const camX = this.pos.x + dirX * side;
    const camZ = this.pos.z + dirZ * side;
    const groundClear = surfaceHeightAt(camX, camZ) + 1.6;
    const camY = Math.max(this.pos.y + height, groundClear);

    _camPos.set(camX, camY, camZ);
    this.camera.position.lerp(_camPos, 1 - Math.exp(-(far ? 3 : 6) * dt));

    const lookSide = 7 * (1 - 2 * this.revBlend); // ahead .. behind
    _look.set(this.pos.x + dirX * lookSide, this.pos.y + 1.6, this.pos.z + dirZ * lookSide);
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
    if (this.cycleEnabled) {
      this.todHours = (this.todHours + (24 / this.dayLength) * dt) % 24;
    }
    this.applyEnvironment();
    this.updatePhysics(dt);
    this.tiles.update(this.pos.x, this.pos.z);

    // shadow frustum follows the car (snapped to reduce shimmer); the light
    // itself comes from the sun by day and the moon by night
    const sx = Math.round(this.pos.x / 2) * 2;
    const sz = Math.round(this.pos.z / 2) * 2;
    _lightDir.copy(this._sunDir);
    if (_lightDir.y <= 0) _lightDir.multiplyScalar(-1); // moonlight
    _lightDir.y = Math.max(Math.abs(_lightDir.y), 0.3); // keep shadows well-conditioned
    _lightDir.normalize();
    this.sun.position.set(sx + _lightDir.x * 150, _lightDir.y * 150, sz + _lightDir.z * 150);
    this.sun.target.position.set(sx, 0, sz);

    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);

    // HUD ~16x per second (keeps the rev bar lively)
    this.hudTimer += dt;
    if (this.hudTimer > 0.06 && this.onHud) {
      this.hudTimer = 0;
      const h = surfaceHeightAt(this.pos.x, this.pos.z);
      const tt = h < 0.35 && !isOnRoad(this.pos.x, this.pos.z) ? "ocean" : terrainTypeAt(this.pos.x, this.pos.z, Math.max(h, 0));
      if (typeof window !== "undefined" && (window as unknown as Record<string, unknown>).__dlDebug) {
        console.log(
          `[dl] x=${this.pos.x.toFixed(1)} z=${this.pos.z.toFixed(1)} carY=${this.pos.y.toFixed(2)} terrain=${h.toFixed(2)} agl=${(this.pos.y - h).toFixed(2)}`
        );
      }
      const hh = Math.floor(this.todHours);
      const mm = Math.floor((this.todHours - hh) * 60);
      const clock = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
      this.onHud({
        kmh: Math.round(Math.abs(this.speed) * 3.6),
        biome: BIOME_LABEL[tt] ?? tt,
        x: this.pos.x,
        z: this.pos.z,
        tilesLoaded: this.tiles.loadedCount,
        heading: this.heading,
        onRoad: isOnRoad(this.pos.x, this.pos.z),
        clock,
        tod: this.todHours,
        gear: this.speed < -0.3 ? -1 : Math.abs(this.speed) < 0.3 && !this.throttleIn ? 0 : this.gear,
        revs: this.revs,
        distance: this.odometer,
        locked: this.locked,
      });
    }
  };
}

// scratch vectors
const _camPos = new THREE.Vector3();
const _look = new THREE.Vector3();
const _lightDir = new THREE.Vector3();

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
    if (bd > 6 || surfaceHeightAt(bx, z) < 1.2) continue;
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
