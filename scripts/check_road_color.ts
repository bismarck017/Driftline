/**
 * Sanity check: what albedo does terrainColorAt produce on/around the road
 * at the spawn area, and what screen value should we expect after the
 * ~2.1x lighting + ACES + sRGB output transform?
 */
import { terrainColorAt, roadInfo, heightAt, findRoadSpawn } from "../src/game/world";

const spawn = findRoadSpawn();
console.log("spawn:", spawn);

const spots: [string, number, number][] = [
  ["road center", spawn.x, spawn.z],
  ["road +3", spawn.x + 3, spawn.z],
  ["road edge +5.5", spawn.x + 5.5, spawn.z],
  ["shoulder +10", spawn.x + 10, spawn.z],
  ["off-road +40", spawn.x + 40, spawn.z],
];

for (const [label, x, z] of spots) {
  const ri = roadInfo(x, z);
  const h = heightAt(x, z);
  const out: [number, number, number] = [0, 0, 0];
  terrainColorAt(x, z, h, out);
  // crude screen estimate: albedo * 2.1 (lights) -> ACES(approx x^0.9 clip) -> sRGB^(1/2.2)
  const screen = out.map((c) => Math.round(255 * Math.pow(Math.min(1, c * 2.1), 0.9)));
  console.log(
    `${label.padEnd(16)} rd=${ri.dist.toFixed(1).padStart(5)}  albedo=(${out.map((v) => v.toFixed(3)).join(", ")})`
  );
}
