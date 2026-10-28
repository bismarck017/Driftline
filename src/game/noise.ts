// Deterministic, seedable noise utilities for the procedural world.
// The whole world exists as pure math: same input -> same output, no storage needed.

/** 2D integer hash -> [0,1) */
export function hash2d(ix: number, iy: number, seed = 0): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 1D integer hash -> [0,1) */
export function hash1d(i: number, seed = 0): number {
  let h = Math.imul(i, 2654435761) + Math.imul(seed, 40503);
  h = Math.imul(h ^ (h >>> 15), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Smooth value noise in 2D, output [0,1] */
export function valueNoise2(x: number, y: number, seed = 0): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const a = hash2d(ix, iy, seed);
  const b = hash2d(ix + 1, iy, seed);
  const c = hash2d(ix, iy + 1, seed);
  const d = hash2d(ix + 1, iy + 1, seed);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

/** Smooth value noise in 1D, output [0,1] */
export function valueNoise1(x: number, seed = 0): number {
  const ix = Math.floor(x);
  const fx = fade(x - ix);
  const a = hash1d(ix, seed);
  const b = hash1d(ix + 1, seed);
  return a + (b - a) * fx;
}

/** Fractal brownian motion in 2D, output roughly [0,1] */
export function fbm2(x: number, y: number, octaves: number, seed = 0): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let fx = x;
  let fy = y;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise2(fx, fy, seed + i * 131) * amp;
    norm += amp;
    amp *= 0.5;
    fx *= 2.03;
    fy *= 2.01;
  }
  return sum / norm;
}

/** Fractal brownian motion in 1D, output roughly [0,1] */
export function fbm1(x: number, octaves: number, seed = 0): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let fx = x;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise1(fx, seed + i * 57) * amp;
    norm += amp;
    amp *= 0.5;
    fx *= 2.05;
  }
  return sum / norm;
}

/** Small seeded PRNG (mulberry32) */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
