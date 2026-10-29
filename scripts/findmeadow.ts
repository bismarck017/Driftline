import { terrainTypeAt, heightAt, roadCenterNS } from "../src/game/world";
// walk the k=0 road north/south to find the nearest meadow / other biome from spawn
for (const dir of [1, -1]) {
  for (let z = 0; z < 6000; z += 25) {
    const x = roadCenterNS(0, z);
    const h = heightAt(x, z);
    const tt = terrainTypeAt(x, z, h);
    if (tt !== "forest") {
      console.log(`${dir > 0 ? "north" : "south"} z=${z * dir} (${z * dir / 1000}km):`, tt);
      break;
    }
  }
}
// also east-west along the first east-west road (m=0)
import { roadCenterEW } from "../src/game/world";
for (let x = 0; x < 6000; x += 25) {
  const z = roadCenterEW(0, x);
  const h = heightAt(x, z);
  const tt = terrainTypeAt(x, z, h);
  if (tt !== "forest") { console.log(`east x=${x} (${x / 1000}km):`, tt); break; }
}
