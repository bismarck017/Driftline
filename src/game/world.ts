// ─────────────────────────────────────────────────────────────────────────────
// The mathematical world model.
// The entire open world exists as pure functions of (x, z):
//   · elevation (heightmap-style fractal noise)
//   · terrain type / biome (temperature + moisture fields)
//   · rivers (carved channels below the water plane)
//   · water coverage (global sea level, oceans & lakes emerge naturally)
//   · roads (a warped lattice defined by GLOBAL functions of one axis,
//     so every tile computes the exact same centerline -> roads can never
//     be interrupted at tile borders)
// Terrain meshes for nearby tiles are built by sampling these functions,
// so adjacent tiles always match perfectly at their shared border.
// ─────────────────────────────────────────────────────────────────────────────
import { fbm1, fbm2, smoothstep, lerp, clamp, mulberry32 } from "./noise";

export const TILE = 160; // world units per tile
export const SEA_LEVEL = 0;

// Terrain mesh discretisation — the SINGLE SOURCE OF TRUTH shared by the tile
// builder (visuals) and every physics / placement query, so the ground the car
// drives on is exactly the surface you see on screen.
export const TERRAIN_SEGMENTS = 64; // terrain quads per tile edge
export const TERRAIN_GRID = TILE / TERRAIN_SEGMENTS; // metres per quad (2.5)

// ── Elevation ────────────────────────────────────────────────────────────────

/** Macro terrain shape (continents / oceans), roughly [-1, 1] */
function macroAt(x: number, z: number): number {
  return fbm2(x * 0.0012, z * 0.0012, 3, 71) * 2 - 1;
}

/** Low-frequency-only height used as the smooth profile roads follow */
export function smoothHeight(x: number, z: number): number {
  return macroAt(x, z) * 24 + 7;
}

/** Full detailed base terrain (before roads / rivers) */
function baseHeight(x: number, z: number): number {
  const hills = (fbm2(x * 0.0062, z * 0.0062, 4, 23) * 2 - 1) * 5.2;
  const detail = (fbm2(x * 0.031, z * 0.031, 2, 91) * 2 - 1) * 1.1;
  return smoothHeight(x, z) + hills + detail;
}

// ── Roads ────────────────────────────────────────────────────────────────────
// A lattice of curving country roads. "Vertical" roads run north-south with a
// centerline x = k*SPACING + warpNS(z); "horizontal" roads run east-west with
// z = m*SPACING + warpEW(x). Because warp is a pure function of the axis
// coordinate, every tile evaluates identical centerlines -> perfectly
// continuous, never-interrupted roads across any tile boundary.
// The warp itself mixes two frequencies — long sweeping bends plus tighter
// s-shaped squiggles — so roads read as lazy snaky country lanes instead of
// a city grid. A larger spacing keeps crossings rare and the landscape open.

export const ROAD_SPACING = 460;
export const ROAD_HALF = 6.0; // asphalt half width (two lanes)
export const ROAD_SHOULDER = 16; // flatten blend distance (gentle causeway banks)
const WARP_AMPL = 118; // long sweeping bends
const WIGGLE_AMPL = 26; // tighter s-curves laid on top

function warpNS(z: number): number {
  return (
    (fbm1(z * 0.0019, 3, 1007) - 0.5) * 2 * WARP_AMPL +
    (fbm1(z * 0.0088, 2, 131) - 0.5) * 2 * WIGGLE_AMPL
  );
}
function warpEW(x: number): number {
  return (
    (fbm1(x * 0.0018, 3, 2003) - 0.5) * 2 * WARP_AMPL +
    (fbm1(x * 0.0086, 2, 337) - 0.5) * 2 * WIGGLE_AMPL
  );
}

/** Rich query about the nearest road — used for painting and physics. */
export interface RoadInfo {
  /** distance to the nearest road centerline */
  dist: number;
  /** orientation of the nearest road: 0 = north-south, 1 = east-west */
  axis: 0 | 1;
  /** coordinate along the road (z for NS roads, x for EW roads) */
  along: number;
  /** distance to the nearest road of the OTHER orientation (intersection test) */
  otherDist: number;
}

export function roadInfo(x: number, z: number): RoadInfo {
  const wNS = warpNS(z);
  const kv = Math.round((x - wNS) / ROAD_SPACING);
  let bestV = Infinity;
  for (let dk = -1; dk <= 1; dk++) {
    const k = kv + dk;
    const d = Math.abs(x - (k * ROAD_SPACING + wNS));
    if (d < bestV) bestV = d;
  }
  const wEW = warpEW(x);
  const mh = Math.round((z - wEW) / ROAD_SPACING);
  let bestH = Infinity;
  for (let dm = -1; dm <= 1; dm++) {
    const m = mh + dm;
    const d = Math.abs(z - (m * ROAD_SPACING + wEW));
    if (d < bestH) bestH = d;
  }
  if (bestV <= bestH) return { dist: bestV, axis: 0, along: z, otherDist: bestH };
  return { dist: bestH, axis: 1, along: x, otherDist: bestV };
}

/** Distance from (x,z) to the nearest road centerline */
export function roadDistance(x: number, z: number): number {
  return roadInfo(x, z).dist;
}

/** Centerline x of the north-south road k at depth z (for marking meshes) */
export function roadCenterNS(k: number, z: number): number {
  return k * ROAD_SPACING + warpNS(z);
}

/** Centerline z of the east-west road m at position x (for marking meshes) */
export function roadCenterEW(m: number, x: number): number {
  return m * ROAD_SPACING + warpEW(x);
}

/** Road curvature bound (total warp amplitude) — used to bound candidate searches */
export const ROAD_WARP = WARP_AMPL + WIGGLE_AMPL;

/** 1.0 on the asphalt, fading to 0 at the shoulder edge */
export function roadMask(x: number, z: number): number {
  return 1 - smoothstep(ROAD_HALF, ROAD_SHOULDER, roadDistance(x, z));
}

/** True when the point sits on asphalt (used for physics + coloring) */
export function isOnRoad(x: number, z: number): boolean {
  return roadDistance(x, z) < ROAD_HALF;
}

// ── Rivers ───────────────────────────────────────────────────────────────────
// Rivers are also global warped lattice lines (offset from the roads), carved
// down below sea level so the water plane fills them.

const RIVER_SPACING = 520;
const RIVER_HALF = 9;

function riverWarpNS(z: number): number {
  return (fbm1(z * 0.0016, 3, 311) - 0.5) * 2 * 130;
}
function riverWarpEW(x: number): number {
  return (fbm1(x * 0.0017, 3, 733) - 0.5) * 2 * 130;
}

export function riverDistance(x: number, z: number): number {
  const kv = Math.round((x - riverWarpNS(z)) / RIVER_SPACING);
  let best = Infinity;
  for (let dk = -1; dk <= 1; dk++) {
    const k = kv + dk;
    const d = Math.abs(x - (k * RIVER_SPACING + riverWarpNS(z)));
    if (d < best) best = d;
  }
  const mh = Math.round((z - riverWarpEW(x)) / RIVER_SPACING);
  for (let dm = -1; dm <= 1; dm++) {
    const m = mh + dm;
    const d = Math.abs(z - (m * RIVER_SPACING + riverWarpEW(x)));
    if (d < best) best = d;
  }
  return best;
}

// ── Final terrain height ─────────────────────────────────────────────────────

/**
 * Definitive terrain height at any world point.
 * Roads are flattened onto the smooth macro profile and always kept above the
 * water plane (causeway/bridge effect); rivers are carved below sea level,
 * except where a road crosses (the road wins, forming a bridge).
 */
export function heightAt(x: number, z: number): number {
  let h = baseHeight(x, z);

  const rm = roadMask(x, z);
  if (rm > 0.001) {
    const roadH = Math.max(smoothHeight(x, z), SEA_LEVEL + 1.1);
    h = lerp(h, roadH, rm);
  }

  const rd = riverDistance(x, z);
  if (rd < RIVER_HALF * 3.2) {
    // carve influence fades to zero at ~3x half width
    let influence = 1 - smoothstep(RIVER_HALF, RIVER_HALF * 3.1, rd);
    // roads bridge over rivers
    influence *= 1 - smoothstep(0.25, 0.65, rm);
    if (influence > 0) {
      const bank = Math.max(0, rd - RIVER_HALF * 0.85) * 0.5;
      const target = SEA_LEVEL - 1.9 + bank;
      h = lerp(h, Math.min(h, target), influence);
    }
  }
  return h;
}

/**
 * Height of the RENDERED terrain surface at any world point.
 *
 * Tile meshes are PlaneGeometry grids (TERRAIN_SEGMENTS quads per tile edge)
 * whose vertices sit exactly on heightAt() at the global TERRAIN_GRID lattice,
 * and each quad is split along its anti-diagonal exactly like three.js does
 * (triangles a-b-d and b-c-d -> the u+v = g diagonal). Sampling the same four
 * lattice corners with the same two barycentric planes returns the height of
 * the visible triangle surface itself — bit-identical at the nodes — so
 * wheels, camera, road markings and props can never sink below or hover
 * above the mesh, no matter how bumpy the detail noise is between vertices.
 */
export function surfaceHeightAt(x: number, z: number): number {
  const g = TERRAIN_GRID;
  const gx = Math.floor(x / g);
  const gz = Math.floor(z / g);
  const u = x - gx * g; // fraction across the quad, along +x
  const v = z - gz * g; // fraction across the quad, along +z
  const x0 = gx * g;
  const z0 = gz * g;
  const h00 = heightAt(x0, z0);
  const h10 = heightAt(x0 + g, z0);
  const h01 = heightAt(x0, z0 + g);
  if (u + v <= g) {
    // lower-left triangle: corners (0,0) (g,0) (0,g)
    return h00 + ((h10 - h00) * u + (h01 - h00) * v) / g;
  }
  // upper-right triangle: corners (0,g) (g,g) (g,0)
  const h11 = heightAt(x0 + g, z0 + g);
  return h01 + ((u + v - g) / g) * (h11 - h01) + ((g - v) / g) * (h10 - h01);
}

// ── Biomes / terrain types ───────────────────────────────────────────────────

export type TerrainType =
  | "ocean"
  | "beach"
  | "meadow"
  | "forest"
  | "desert"
  | "highlands"
  | "snow";

function temperature(x: number, z: number): number {
  return fbm2(x * 0.00042 + 9.7, z * 0.00042 - 3.1, 2, 555);
}
function moisture(x: number, z: number): number {
  return fbm2(x * 0.00058 - 4.2, z * 0.00058 + 8.8, 2, 888);
}

export function terrainTypeAt(x: number, z: number, h: number): TerrainType {
  if (h < SEA_LEVEL) return "ocean";
  if (h < 1.4) return "beach";
  const t = temperature(x, z);
  const m = moisture(x, z);
  if (h > 26) return t < 0.55 ? "snow" : "highlands";
  if (h > 19) return t < 0.38 ? "snow" : "highlands";
  if (t > 0.62 && m < 0.42) return "desert";
  if (m > 0.58) return "forest";
  return "meadow";
}

// Pastel palette as linear-ish [r,g,b] triples (0..1)
type RGB = [number, number, number];
const C = {
  ocean: [0.62, 0.82, 0.82] as RGB, // soft seabed teal
  beach: [0.93, 0.87, 0.72] as RGB, // warm sand
  meadow: [0.66, 0.83, 0.63] as RGB, // pastel grass green
  meadowB: [0.76, 0.88, 0.7] as RGB, // lighter grass
  forest: [0.52, 0.74, 0.57] as RGB, // sage green
  desert: [0.93, 0.83, 0.68] as RGB, // pastel sand / pinkish dune
  highlands: [0.76, 0.72, 0.68] as RGB, // warm grey rock
  snow: [0.95, 0.94, 0.94] as RGB, // off white
  // NOTE: vertex colours are LINEAR albedo values. Real asphalt is genuinely
  // ~0.04-0.10 linear; with the scene's ~2.1x combined lighting, 0.055 reads
  // as RGB ~95 dark grey on screen, contrasting strongly with the pastel terrain.
  road: [0.055, 0.055, 0.065] as RGB, // dark grey asphalt
  roadEdge: [0.82, 0.79, 0.73] as RGB, // pale gravel shoulder
};

/**
 * Terrain color for a mesh vertex. Blends biome colors with height/slope
 * variation and paints the road surface + shoulders.
 */
export function terrainColorAt(x: number, z: number, h: number, out: RGB): void {
  const tt = terrainTypeAt(x, z, h);
  let base: RGB;
  switch (tt) {
    case "ocean":
      base = C.ocean;
      break;
    case "beach":
      base = C.beach;
      break;
    case "meadow":
      base = fbm2(x * 0.02, z * 0.02, 2, 12) > 0.5 ? C.meadow : C.meadowB;
      break;
    case "forest":
      base = C.forest;
      break;
    case "desert":
      base = C.desert;
      break;
    case "highlands":
      base = C.highlands;
      break;
    default:
      base = C.snow;
  }

  // gentle per-vertex brightness jitter for a handmade feel
  const jitter = 0.94 + fbm2(x * 0.09, z * 0.09, 1, 5) * 0.12;
  out[0] = base[0] * jitter;
  out[1] = base[1] * jitter;
  out[2] = base[2] * jitter;

  // road paint: asphalt, wheel tracks, dashed centerline, lane edges,
  // gravel shoulder band — all deterministic so tiles match seamlessly
  const ri = roadInfo(x, z);
  const rd = ri.dist;
  if (rd < ROAD_SHOULDER) {
    if (rd < ROAD_HALF) {
      // dark asphalt core — near-opaque so the edge reads crisply
      const t = smoothstep(ROAD_HALF - 0.6, ROAD_HALF, rd);
      out[0] = lerp(out[0], C.road[0], 0.97);
      out[1] = lerp(out[1], C.road[1], 0.97);
      out[2] = lerp(out[2], C.road[2], 0.97);
      if (Math.abs(rd - ROAD_HALF * 0.4) < ROAD_HALF * 0.16) {
        // polished wheel tracks: a faint lighter sheen on dark asphalt
        const wear = 1.07 - 0.03 * t;
        out[0] *= wear;
        out[1] *= wear;
        out[2] *= wear;
      }
      // (crisp dashed centerlines and lane-edge lines are built as real
      // meshes by the tile builder, so they stay sharp at any vertex density)
      // soften into the shoulder at the very edge
      out[0] = lerp(out[0], C.roadEdge[0], t * 0.55);
      out[1] = lerp(out[1], C.roadEdge[1], t * 0.55);
      out[2] = lerp(out[2], C.roadEdge[2], t * 0.55);
    } else {
      // gravel shoulder band
      const t = 1 - smoothstep(ROAD_HALF, ROAD_SHOULDER, rd);
      out[0] = lerp(out[0], C.roadEdge[0], t * 0.85);
      out[1] = lerp(out[1], C.roadEdge[1], t * 0.85);
      out[2] = lerp(out[2], C.roadEdge[2], t * 0.85);
    }
  }
}

/** Is this point under the water plane? */
export function isWater(x: number, z: number): boolean {
  return heightAt(x, z) < SEA_LEVEL;
}

// ── Structures (houses, barns, cabins) ──────────────────────────────────────
// Deterministic building sites along the road network. Each road is stepped at
// fixed world-anchored stations; a hashed RNG decides whether a station gets a
// house, on which side, and how far from the asphalt. Sites must sit on dry,
// flattish ground away from rivers and crossings — so little clusters of
// pastel homes naturally appear wherever the roads cross pleasant terrain.

export interface HouseSpot {
  x: number;
  z: number;
  y: number;
  rot: number; // yaw, door facing the road
  variant: number; // 0 cottage, 1 house, 2 barn, 3 cabin
  scale: number;
  wall: number; // wall colour index
  roof: number; // roof colour index
}

export const HOUSE_PALETTE_SIZE = 6; // wall/roof colour counts in the tile builder

const HOUSE_STEP = 52; // metres between potential house stations along a road

function tryHouse(
  x: number,
  z: number,
  axis: 0 | 1,
  side: 1 | -1,
  rng: () => number,
  out: HouseSpot[],
): void {
  const h = heightAt(x, z);
  if (h < 1.4) return; // needs dry, firm ground (above the beach line)
  // flatter ground only — a plinth can hide a little slope, not a hillside
  const dh = Math.max(
    Math.abs(heightAt(x + 2.6, z) - h),
    Math.abs(heightAt(x - 2.6, z) - h),
    Math.abs(heightAt(x, z + 2.6) - h),
    Math.abs(heightAt(x, z - 2.6) - h),
  );
  if (dh > 0.95) return;
  if (riverDistance(x, z) < RIVER_HALF * 3.1 + 5) return;
  const ri = roadInfo(x, z);
  if (ri.otherDist < ROAD_HALF + 13) return; // keep crossings clear
  if (ri.dist < ROAD_SHOULDER + 2) return; // never on the asphalt itself
  const tt = terrainTypeAt(x, z, h);
  const r = rng();
  let variant: number;
  if (tt === "meadow") variant = r < 0.42 ? 0 : r < 0.8 ? 1 : 2;
  else if (tt === "forest") variant = r < 0.72 ? 3 : 0;
  else if (tt === "highlands") variant = r < 0.85 ? 3 : 0;
  else if (tt === "snow") variant = 3; // cosy cabins in the snowfield
  else if (tt === "desert") variant = r < 0.6 ? 1 : 0;
  else return; // no buildings on beaches or in the water
  const jitter = (rng() - 0.5) * 0.22;
  // door (local +z) faces back toward the road it serves
  const rot =
    axis === 0
      ? -side * Math.PI * 0.5 + jitter
      : (side > 0 ? Math.PI : 0) + jitter;
  out.push({
    x,
    z,
    y: surfaceHeightAt(x, z) - 0.15, // plinth sinks slightly into the ground
    rot,
    variant,
    scale: 0.92 + rng() * 0.2,
    wall: Math.floor(rng() * HOUSE_PALETTE_SIZE) % HOUSE_PALETTE_SIZE,
    roof: Math.floor(rng() * HOUSE_PALETTE_SIZE) % HOUSE_PALETTE_SIZE,
  });
}

function houseSitesForCell(ti: number, tj: number): HouseSpot[] {
  const ox = ti * TILE;
  const oz = tj * TILE;
  const spots: HouseSpot[] = [];
  // Every station belongs to exactly ONE cell: the cell containing its station
  // POINT (the point on the centerline). Anchoring by the along-axis coordinate
  // alone would make every cell in the same row rebuild the same house.
  const inX = (x: number) => x >= ox && x < ox + TILE;
  const inZ = (z: number) => z >= oz && z < oz + TILE;
  // north-south roads: house stations along z
  const kMin = Math.floor((ox - ROAD_WARP) / ROAD_SPACING) - 1;
  const kMax = Math.ceil((ox + TILE + ROAD_WARP) / ROAD_SPACING) + 1;
  for (let k = kMin; k <= kMax; k++) {
    const jMin = Math.floor((oz - ROAD_WARP) / HOUSE_STEP);
    const jMax = Math.ceil((oz + TILE + ROAD_WARP) / HOUSE_STEP);
    for (let j = jMin; j <= jMax; j++) {
      const z = j * HOUSE_STEP;
      const x0 = roadCenterNS(k, z);
      if (!inX(x0) || !inZ(z)) continue;
      const rng = mulberry32(
        (Math.imul(k, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ 0x51ce) >>> 0,
      );
      if (rng() >= 0.6) continue;
      const side = rng() < 0.5 ? -1 : 1;
      const lat = ROAD_SHOULDER + 7 + rng() * 17;
      tryHouse(x0 + side * lat, z, 0, side, rng, spots);
    }
  }
  // east-west roads: stations along x
  const mMin = Math.floor((oz - ROAD_WARP) / ROAD_SPACING) - 1;
  const mMax = Math.ceil((oz + TILE + ROAD_WARP) / ROAD_SPACING) + 1;
  for (let m = mMin; m <= mMax; m++) {
    const jMin = Math.floor((ox - ROAD_WARP) / HOUSE_STEP);
    const jMax = Math.ceil((ox + TILE + ROAD_WARP) / HOUSE_STEP);
    for (let j = jMin; j <= jMax; j++) {
      const x = j * HOUSE_STEP;
      const z0 = roadCenterEW(m, x);
      if (!inX(x) || !inZ(z0)) continue;
      const rng = mulberry32(
        (Math.imul(m, 0x9e3779b1) ^ Math.imul(j, 0x85ebca6b) ^ 0x4a11) >>> 0,
      );
      if (rng() >= 0.6) continue;
      const side = rng() < 0.5 ? -1 : 1;
      const lat = ROAD_SHOULDER + 7 + rng() * 17;
      tryHouse(x, z0 + side * lat, 1, side, rng, spots);
    }
  }
  return spots;
}

/** Deterministic structures anchored in this tile (rendered by the tile builder). */
export function structuresForTile(ti: number, tj: number): HouseSpot[] {
  return houseSitesForCell(ti, tj);
}

// ── Props placement (trees, rocks…) ───────────────────────────────────────────

export interface PropSpot {
  x: number;
  z: number;
  y: number;
  scale: number;
  rot: number;
  kind: number; // 0 round tree, 1 pine, 2 bush, 3 rock, 4 cactus, 5 snowy tree,
  //            6 wildflower, 7 tall pine, 8 palm
}

/**
 * Deterministic prop placement for one tile.
 *
 * Biodiversity rules:
 *  · a large-scale "grove" noise field clusters trees into natural woodland
 *    patches, while low-field areas stay open (clearings / open meadows);
 *  · dense old-growth cores (high cluster value) grow tall pines;
 *  · meadows mix scattered groves, wildflowers and bushes;
 *  · roads keep a wide clear margin so no canopy or cactus ever touches the
 *    asphalt; rivers and water are kept clear too;
 *  · buildings and their yards are kept clear too (3x3 cell search);
 *  · every prop sits on the RENDERED surface (surfaceHeightAt) so nothing
 *    hovers above or sinks below the visible mesh;
 *  · steep slopes reject plants (rocks don't mind them).
 */
export function propsForTile(ti: number, tj: number): PropSpot[] {
  const rng = mulberry32((Math.imul(ti, 73856093) ^ Math.imul(tj, 19349663)) >>> 0);
  const spots: PropSpot[] = [];
  // structures in the 3x3 neighbourhood — trees never grow through a building
  const houses: HouseSpot[] = [];
  for (let dj = -1; dj <= 1; dj++)
    for (let di = -1; di <= 1; di++)
      houses.push(...houseSitesForCell(ti + di, tj + dj));

  const attempts = 520; // ~2.5x the old density; cluster fields keep glades open
  for (let i = 0; i < attempts; i++) {
    const x = (ti + rng()) * TILE;
    const z = (tj + rng()) * TILE;
    const h = heightAt(x, z);
    if (h < 0.9) continue;
    // wide margin around roads: no vegetation on or over the asphalt
    if (roadDistance(x, z) < ROAD_SHOULDER + 4) continue;
    if (riverDistance(x, z) < RIVER_HALF * 3.1 + 4) continue;
    // keep clear of houses and their little yards
    let blocked = false;
    for (const hs of houses) {
      const dx = x - hs.x;
      const dz = z - hs.z;
      const rad = 9 + hs.scale * 4;
      if (dx * dx + dz * dz < rad * rad) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;

    const tt = terrainTypeAt(x, z, h);
    // grove / glade mask — drives clustering AND clearings
    const cluster = fbm2(x * 0.0042, z * 0.0042, 2, 4242);
    let kind = -1;
    if (tt === "forest") {
      // dense woodland in high-cluster zones, natural glades in low ones
      const dense = cluster > 0.32 ? 0.96 : 0.34;
      if (rng() < dense) {
        const r = rng();
        // old-growth cores favor tall pines, elsewhere pine/round mix
        kind = cluster > 0.56 && r < 0.42 ? 7 : r < 0.5 ? 1 : 0;
      } else if (rng() < 0.35) {
        kind = 2; // bushes fill the glades
      }
    } else if (tt === "meadow") {
      const grove = smoothstep(0.48, 0.7, cluster);
      const r = rng();
      const treeP = 0.07 + 0.55 * grove; // open meadows stay open
      if (r < treeP) kind = rng() < 0.35 ? 1 : rng() < 0.6 ? 0 : 7;
      else if (r < treeP + 0.3) kind = 6; // wildflower carpets
      else if (r < treeP + 0.4) kind = 2;
    } else if (tt === "beach") {
      const r = rng();
      if (r < 0.16) kind = 8; // palms leaning over the sand
      else if (r < 0.21) kind = 3;
      else if (r < 0.24) kind = 2;
    } else if (tt === "desert") {
      const patch = smoothstep(0.42, 0.7, cluster);
      const r = rng();
      if (r < 0.14 + 0.6 * patch) kind = 4; // cactus in patches
      else if (r < 0.3 + 0.6 * patch) kind = 3;
    } else if (tt === "highlands") {
      const r = rng();
      if (r < 0.36) kind = 3;
      else if (r < 0.36 + (cluster > 0.5 ? 0.32 : 0.08)) kind = 1;
    } else if (tt === "snow") {
      const p = cluster > 0.55 ? 0.55 : 0.16;
      if (rng() < p) kind = 5;
    }
    if (kind < 0) continue;

    // avoid steep slopes for plants (rocks are fine)
    if (kind !== 3) {
      const dh = Math.abs(heightAt(x + 2, z) - heightAt(x - 2, z)) + Math.abs(heightAt(x, z + 2) - heightAt(x, z - 2));
      const limit = kind === 6 ? 3.4 : 2.6;
      if (dh > limit) continue;
    }
    spots.push({
      x,
      z,
      // sit on the RENDERED surface, never the analytic one (anti float/sink)
      y: surfaceHeightAt(x, z),
      scale: kind === 6 ? 0.8 + rng() * 0.7 : kind === 8 ? 0.9 + rng() * 0.5 : 0.75 + rng() * 0.6,
      rot: rng() * Math.PI * 2,
      kind,
    });
  }
  return spots;
}

// ── Spawn helper ─────────────────────────────────────────────────────────────

/**
 * Find a pleasant starting point on a road: walks along the k=0 north-south
 * road until the surface is dry and reasonably flat.
 */
export function findRoadSpawn(): { x: number; z: number; heading: number } {
  const step = 6;
  for (let z = 0; z < 3000; z += step) {
    const x = 0 * ROAD_SPACING + warpNS(z); // k = 0 road centerline
    const h = heightAt(x, z);
    if (h > 1.2) {
      const slope = Math.abs(heightAt(x, z + 4) - h);
      if (slope < 0.5) {
        // heading = tangent of the road (dx/dz)
        const x2 = 0 * ROAD_SPACING + warpNS(z + 1);
        const heading = Math.atan2(x2 - x, 1);
        return { x, z, heading };
      }
    }
  }
  return { x: 0, z: 0, heading: 0 };
}

/** Map bounds are infinite, but keep a soft sane range for the minimap. */
export const MINIMAP_WORLD_RANGE = 12000;
