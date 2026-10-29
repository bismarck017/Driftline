import { isOnRoad, roadDistance, surfaceHeightAt, terrainTypeAt } from "../src/game/world";

for (const [x, z] of [[-31.4, 19], [-32.2, 31], [-31.4, 8]] as [number, number][]) {
  const h = surfaceHeightAt(x, z);
  const ha = surfaceHeightAt(x, z + 2);
  const hb = surfaceHeightAt(x, z - 2);
  console.log(
    `x=${x} z=${z} h=${h.toFixed(2)} slope=${((ha - hb) / 4).toFixed(3)} onRoad=${isOnRoad(x, z)} roadDist=${roadDistance(x, z).toFixed(1)} terrain=${terrainTypeAt(x, z, h)}`
  );
}
