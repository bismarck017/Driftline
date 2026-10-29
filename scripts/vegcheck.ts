import { propsForTile, surfaceHeightAt, roadDistance, terrainTypeAt, heightAt } from "../src/game/world";
import type { PropSpot } from "../src/game/world";

const KIND_NAMES = ["round tree","pine","bush","rock","cactus","snowy tree","flower","tall pine"];
let total = 0, flowers = 0, tallPines = 0, onRoad = 0, hover = 0, perTile: number[] = [];
let meadowTiles = 0, meadowTrees = 0, meadowFlowers = 0, openTiles = 0;
const seen = new Map<number, number>();

for (let ti = -8; ti <= 8; ti++) {
  for (let tj = -8; tj <= 8; tj++) {
    const spots: PropSpot[] = propsForTile(ti, tj);
    total += spots.length;
    perTile.push(spots.length);
    let tileHasMeadow = false, tileMeadowTrees = 0, tileMeadowFlowers = 0;
    for (const s of spots) {
      seen.set(s.kind, (seen.get(s.kind) ?? 0) + 1);
      // ground lock: y must equal the RENDERED surface exactly
      if (Math.abs(s.y - surfaceHeightAt(s.x, s.z)) > 1e-6) hover++;
      // road exclusion with margin
      if (roadDistance(s.x, s.z) < 22) onRoad++;
      if (s.kind === 6) flowers++;
      if (s.kind === 7) tallPines++;
      const h = heightAt(s.x, s.z);
      if (terrainTypeAt(s.x, s.z, h) === "meadow") {
        tileHasMeadow = true;
        if (s.kind === 0 || s.kind === 1 || s.kind === 7) tileMeadowTrees++;
        if (s.kind === 6) tileMeadowFlowers++;
      }
    }
    if (tileHasMeadow) {
      meadowTiles++;
      meadowTrees += tileMeadowTrees;
      meadowFlowers += tileMeadowFlowers;
      if (tileMeadowTrees <= 3) openTiles++; // open meadow / clearing tile
    }
  }
}

console.log("tiles sampled:", 17 * 17, " total props:", total, " avg/tile:", (total / 289).toFixed(1));
console.log("props hovering above ground mesh:", hover, " props within 22m of road centerline:", onRoad);
console.log("flowers:", flowers, " tall pines:", tallPines);
console.log("kinds present:", [...seen.entries()].map(([k, n]) => `${KIND_NAMES[k]}=${n}`).join(", "));
console.log("meadow tiles:", meadowTiles, " avg trees/meadow tile:", meadowTiles ? (meadowTrees / meadowTiles).toFixed(1) : "-",
  " avg flowers/meadow tile:", meadowTiles ? (meadowFlowers / meadowTiles).toFixed(1) : "-");
console.log("open meadow tiles (<=3 trees):", openTiles, "of", meadowTiles);
