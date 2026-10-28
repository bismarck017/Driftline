import { propsForTile, structuresForTile } from "../src/game/world";
let t0 = performance.now();
for (let ti = 0; ti < 3; ti++) for (let tj = 0; tj < 3; tj++) propsForTile(ti, tj);
let t1 = performance.now();
for (let ti = 0; ti < 3; ti++) for (let tj = 0; tj < 3; tj++) structuresForTile(ti, tj);
let t2 = performance.now();
console.log(`propsForTile avg: ${((t1-t0)/9).toFixed(1)}ms, structuresForTile avg: ${((t2-t1)/9).toFixed(2)}ms`);
