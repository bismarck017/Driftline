// Headless test of the world math model + tile build math (no WebGL).
import { findRoadSpawn, heightAt, propsForTile, terrainColorAt, TILE } from "../src/game/world";

const t0 = performance.now();

// spawn search
const spawn = findRoadSpawn();
console.log("spawn:", spawn, `${(performance.now() - t0).toFixed(1)}ms`);

// height sampling spread
const t1 = performance.now();
let acc = 0;
for (let i = 0; i < 20000; i++) {
  acc += heightAt((i * 37) % 5000 - 2500, (i * 91) % 5000 - 2500);
}
console.log("20k heightAt:", `${(performance.now() - t1).toFixed(1)}ms`, acc.toFixed(0));

// terrain color sampling (what buildTile does per vertex)
const t2 = performance.now();
const rgb: [number, number, number] = [0, 0, 0];
for (let i = 0; i < 1681 * 25; i++) {
  terrainColorAt(i % 160, (i * 7) % 160, 5, rgb);
}
console.log("42k colorAt:", `${(performance.now() - t2).toFixed(1)}ms`);

// props for 25 tiles
const t3 = performance.now();
let n = 0;
for (let ti = -2; ti <= 2; ti++) for (let tj = -2; tj <= 2; tj++) n += propsForTile(ti, tj).length;
console.log("25 tiles props:", n, `${(performance.now() - t3).toFixed(1)}ms`);

console.log("TOTAL:", `${(performance.now() - t0).toFixed(1)}ms`);
