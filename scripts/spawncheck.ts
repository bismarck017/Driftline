import { findRoadSpawn, heightAt, surfaceHeightAt, roadDistance, isOnRoad } from "../src/game/world";
const s = findRoadSpawn();
console.log("spawn:", s);
console.log("heightAt:", heightAt(s.x, s.z).toFixed(2));
console.log("surfaceAt:", surfaceHeightAt(s.x, s.z).toFixed(2));
console.log("roadDist:", roadDistance(s.x, s.z).toFixed(2), "onRoad:", isOnRoad(s.x, s.z));
console.log("at 9.7,63.1 surface:", surfaceHeightAt(9.7, 63.1).toFixed(2), "height:", heightAt(9.7, 63.1).toFixed(2));
