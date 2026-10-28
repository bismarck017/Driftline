"use client";

import { useEffect, useRef } from "react";
import { heightAt, roadDistance, ROAD_HALF } from "@/game/world";
import type { HudStats } from "@/game/engine";

const SAMPLES = 64; // 64x64 world samples
const WORLD_PER_PIXEL = 6.4; // minimap coverage ≈ 410 world units
const SIZE = 148; // css pixels

/**
 * Live minimap: samples the world math model around the player every 400ms
 * (terrain shade, water, roads) and overlays the player arrow each HUD tick.
 */
export function Minimap({ stats }: { stats: HudStats }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const pxRef = useRef(stats.x);
  const pzRef = useRef(stats.z);

  // latest player position, mirrored outside of render for the sampler interval
  useEffect(() => {
    pxRef.current = stats.x;
    pzRef.current = stats.z;
  }, [stats.x, stats.z]);

  // resample the world into an offscreen base image
  useEffect(() => {
    let alive = true;
    const sample = () => {
      if (!alive) return;
      const px = pxRef.current;
      const pz = pzRef.current;
      let base = baseRef.current;
      if (!base) {
        base = document.createElement("canvas");
        base.width = SAMPLES;
        base.height = SAMPLES;
        baseRef.current = base;
      }
      const bctx = base.getContext("2d");
      if (!bctx) return;
      const img = bctx.createImageData(SAMPLES, SAMPLES);
      const half = (SAMPLES * WORLD_PER_PIXEL) / 2;
      for (let j = 0; j < SAMPLES; j++) {
        for (let i = 0; i < SAMPLES; i++) {
          const wx = px - half + (i + 0.5) * WORLD_PER_PIXEL;
          const wz = pz + half - (j + 0.5) * WORLD_PER_PIXEL; // up = +z
          const h = heightAt(wx, wz);
          let r = 0, g = 0, b = 0;
          if (h < 0) {
            // water
            const d = Math.min(1, -h / 8);
            r = 150 - d * 60;
            g = 200 - d * 70;
            b = 205 - d * 40;
          } else {
            const rd = roadDistance(wx, wz);
            if (rd < ROAD_HALF) {
              r = 118; g = 112; b = 108; // asphalt
            } else {
              // land pastel shading by elevation
              const t = Math.min(1, h / 30);
              r = 178 - t * 60;
              g = 208 - t * 70;
              b = 160 - t * 55;
              if (h > 24) {
                r = 235; g = 236; b = 238; // snow caps
              }
            }
          }
          const o = (j * SAMPLES + i) * 4;
          img.data[o] = r;
          img.data[o + 1] = g;
          img.data[o + 2] = b;
          img.data[o + 3] = 255;
        }
      }
      bctx.putImageData(img, 0, 0);
    };
    sample();
    const id = setInterval(sample, 400);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // composite: base image + player arrow
  useEffect(() => {
    const canvas = canvasRef.current;
    const base = baseRef.current;
    if (!canvas || !base) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(base, 0, 0, SIZE, SIZE);

    // player arrow (heading 0 = +z = up)
    const cx = SIZE / 2;
    const cy = SIZE / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-stats.heading);
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(7, 8);
    ctx.lineTo(0, 4);
    ctx.lineTo(-7, 8);
    ctx.closePath();
    ctx.fillStyle = "#fffdf7";
    ctx.strokeStyle = "rgba(60,50,40,0.55)";
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }, [stats]);

  return (
    <canvas
      ref={canvasRef}
      width={SIZE}
      height={SIZE}
      className="rounded-2xl border border-white/60 shadow-lg shadow-stone-900/10"
      style={{ width: SIZE, height: SIZE }}
      aria-label="Minimap"
    />
  );
}
