import { propsForTile, roadDistance } from "../src/game/world";
let onShoulder = 0, onAsphalt = 0, min = Infinity;
for (let ti = -8; ti <= 8; ti++) for (let tj = -8; tj <= 8; tj++) {
  for (const s of propsForTile(ti, tj)) {
    const d = roadDistance(s.x, s.z);
    if (d < min) min = d;
    if (d < 16) onShoulder++;
    if (d < 6) onAsphalt++;
  }
}
console.log("closest prop to any road centerline:", min.toFixed(1), "m");
console.log("props on shoulder band (<16m):", onShoulder, " props on asphalt (<6m):", onAsphalt);
