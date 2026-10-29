// Audit of the new world generation: road winding, house placement rules,
// vegetation density & house/road exclusion. Run with: bun scripts/audit_world.ts
import {
  TILE,
  ROAD_HALF,
  ROAD_SHOULDER,
  roadDistance,
  roadInfo,
  heightAt,
  surfaceHeightAt,
  terrainTypeAt,
  riverDistance,
  propsForTile,
  structuresForTile,
  roadCenterNS,
} from "../src/game/world";

const tiles: [number, number][] = [];
for (let tj = -6; tj <= 6; tj++) for (let ti = -6; ti <= 6; ti++) tiles.push([ti, tj]);

// ── 1. Road winding audit ─────────────────────────────────────────────────────
// Sample the k=0 road: how much does heading vary? A grid road would be ~0.
let maxTurn = 0;
let prevHeading: number | null = null;
for (let z = 0; z < 4000; z += 5) {
  const x = roadCenterNS(0, z);
  const x2 = roadCenterNS(0, z + 5);
  const h = Math.atan2(x2 - x, 5);
  if (prevHeading !== null) maxTurn = Math.max(maxTurn, Math.abs(h - prevHeading));
  prevHeading = h;
}
console.log("road k=0 over 4000m: max heading change per 5m =", maxTurn.toFixed(3), "rad (grid would be ~0)");

// curvature: second derivative of the centerline
let maxCurv = 0;
for (let z = 0; z < 4000; z += 5) {
  const a = roadCenterNS(0, z - 5);
  const b = roadCenterNS(0, z);
  const c = roadCenterNS(0, z + 5);
  maxCurv = Math.max(maxCurv, Math.abs(c - 2 * b + a));
}
console.log("max centerline curvature per 5m cell =", maxCurv.toFixed(2), "m (higher = snakier)");

// ── 2. House audit over 13x13 tiles ───────────────────────────────────────────
let houses = 0;
let violations: string[] = [];
let minRoadDist = Infinity;
let maxRoadDist = 0;
let maxSlope = 0;
const allHouses: { x: number; z: number; y: number; scale: number }[] = [];
for (const [ti, tj] of tiles) {
  for (const h of structuresForTile(ti, tj)) {
    houses++;
    allHouses.push(h);
    const rd = roadDistance(h.x, h.z);
    const ri = roadInfo(h.x, h.z);
    minRoadDist = Math.min(minRoadDist, rd);
    maxRoadDist = Math.max(maxRoadDist, rd);
    if (rd < ROAD_SHOULDER + 2) violations.push(`house on/near asphalt at ${h.x.toFixed(0)},${h.z.toFixed(0)} rd=${rd}`);
    if (rd > ROAD_SHOULDER + 7 + 17 + 0.01) violations.push(`house too far from road at ${h.x},${h.z} rd=${rd}`);
    if (ri.otherDist < ROAD_HALF + 13) violations.push(`house in crossing at ${h.x},${h.z}`);
    if (riverDistance(h.x, h.z) < 9 * 3.1 + 5) violations.push(`house in river at ${h.x},${h.z}`);
    if (h.y + 0.15 < heightAt(h.x, h.z) - 0.01 && false) { /* y is surface-based */ }
    const ground = surfaceHeightAt(h.x, h.z);
    if (Math.abs((h.y + 0.15) - ground) > 0.001) violations.push(`house y not on rendered surface at ${h.x},${h.z}`);
    if (heightAt(h.x, h.z) < 1.4) violations.push(`house below beach line at ${h.x},${h.z}`);
    const h0 = heightAt(h.x, h.z);
    const s = Math.max(
      Math.abs(heightAt(h.x + 2.6, h.z) - h0),
      Math.abs(heightAt(h.x - 2.6, h.z) - h0),
      Math.abs(heightAt(h.x, h.z + 2.6) - h0),
      Math.abs(heightAt(h.x, h.z - 2.6) - h0),
    );
    maxSlope = Math.max(maxSlope, s);
    // wall must not poke above ground on any corner more than plinth can hide (0.5)
  }
}
// min pairwise distance between houses (no overlapping buildings)
let minPair = Infinity;
for (let i = 0; i < allHouses.length; i++)
  for (let j = i + 1; j < allHouses.length; j++) {
    const d = Math.hypot(allHouses[i].x - allHouses[j].x, allHouses[i].z - allHouses[j].z);
    if (d < minPair) minPair = d;
  }
console.log(`houses in 13x13 tiles: ${houses} (${(houses / (13 * 13)).toFixed(2)} per tile)`);
console.log(`  road distance range: ${minRoadDist.toFixed(1)} .. ${maxRoadDist.toFixed(1)} (asphalt at ${ROAD_HALF}, shoulder ${ROAD_SHOULDER})`);
console.log(`  max site slope over 2.6m: ${maxSlope.toFixed(2)} (limit 0.85)`);
console.log(`  min pairwise house distance: ${minPair.toFixed(1)}m`);
if (violations.length) console.log("  VIOLATIONS:\n   " + violations.join("\n   "));
else console.log("  ✓ no house rule violations");

// ── 3. Vegetation audit ──────────────────────────────────────────────────────
const biomeCount: Record<string, number> = {};
let treeCount = 0;
let vegViolations: string[] = [];
let onRoad = 0;
let inHouse = 0;
let hoverErr = 0;
let total = 0;
for (const [ti, tj] of tiles) {
  const hs = structuresForTile(ti, tj);
  for (const p of propsForTile(ti, tj)) {
    total++;
    if (p.kind === 0 || p.kind === 1 || p.kind === 5 || p.kind === 7 || p.kind === 8) treeCount++;
    const rd = roadDistance(p.x, p.z);
    if (rd < ROAD_SHOULDER + 4 - 1e-6) { onRoad++; vegViolations.push(`veg in road margin at ${p.x.toFixed(0)},${p.z.toFixed(0)} rd=${rd.toFixed(1)}`); }
    if (riverDistance(p.x, p.z) < 9 * 3.1 + 4) vegViolations.push(`veg in river at ${p.x},${p.z}`);
    // rendered-surface contact: prop y must equal surface height
    if (Math.abs(p.y - surfaceHeightAt(p.x, p.z)) > 0.001) { hoverErr++; }
    // house exclusion (3x3 rule)
    let near = false;
    for (const h of hs) {
      const rad = 9 + h.scale * 4;
      if ((p.x - h.x) ** 2 + (p.z - h.z) ** 2 < rad * rad) { near = true; break; }
    }
    if (near) {
      // may legitimately be a neighbour-cell house; full check against all houses
      for (const h of allHouses) {
        const rad = 9 + h.scale * 4;
        if ((p.x - h.x) ** 2 + (p.z - h.z) ** 2 < rad * rad) { inHouse++; vegViolations.push(`veg inside house yard at ${p.x.toFixed(0)},${p.z.toFixed(0)} (house ${h.x.toFixed(0)},${h.z.toFixed(0)})`); break; }
      }
    }
    const h = heightAt(p.x, p.z);
    if (h >= 0.9) {
      const b = terrainTypeAt(p.x, p.z, h);
      biomeCount[b] = (biomeCount[b] || 0) + 1;
    }
  }
}
console.log(`vegetation total: ${total} (~${(total / (13 * 13)).toFixed(1)} per tile, trees: ${(treeCount / (13 * 13)).toFixed(1)})`);
console.log("  by biome:", JSON.stringify(biomeCount));
console.log(`  on/near road: ${onRoad}, inside house yards: ${inHouse}, y mismatches: ${hoverErr}`);
if (vegViolations.length) console.log("  VIOLATIONS (first 10):\n   " + vegViolations.slice(0, 10).join("\n   "));
else console.log("  ✓ no vegetation rule violations");

// ── 4. Clearing / biodiversity check ─────────────────────────────────────────
// count empty tiles & tiles without trees (natural clearings)
let emptyTiles = 0;
let treelessTiles = 0;
for (const [ti, tj] of tiles) {
  const spots = propsForTile(ti, tj);
  if (spots.length === 0) emptyTiles++;
  if (!spots.some((s) => [0, 1, 5, 7, 8].includes(s.kind))) treelessTiles++;
}
console.log(`empty tiles: ${emptyTiles}/169, treeless tiles: ${treelessTiles}/169 (clearings keep biodiversity)`);
