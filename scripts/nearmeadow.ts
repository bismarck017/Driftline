import { terrainTypeAt, heightAt } from "../src/game/world";
// nearest meadow point to the car at (359, 737)
let best: [number, number, number] | null = null;
for (let x = 100; x < 1400; x += 30) {
  for (let z = 300; z < 1200; z += 30) {
    const h = heightAt(x, z);
    if (h > 1.5 && terrainTypeAt(x, z, h) === "meadow") {
      const d = Math.hypot(x - 359, z - 737);
      if (!best || d < best[2]) best = [x, z, d];
    }
  }
}
console.log(best ? `nearest meadow: (${best[0]}, ${best[1]}) distance ${best[2].toFixed(0)}m` : "none found");
