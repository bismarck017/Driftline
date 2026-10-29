"use client";

import { useEffect, useRef } from "react";
import { heightAt, roadDistance, terrainTypeAt, ROAD_HALF, ROAD_SHOULDER } from "@/game/world";
import type { HudStats } from "@/game/engine";

const SAMPLES = 96; // 96x96 world samples
const WORLD_PER_PIXEL = 4.8; // minimap coverage ≈ 460 world units
const SIZE = 148; // css pixels

// pastel map palette
const MAP_COLORS: Record<string, [number, number, number]> = {
  ocean: [142, 199, 205],
  beach: [236, 223, 197],
  meadow: [186, 216, 173],
  forest: [140, 190, 148],
  desert: [235, 209, 177],
  highlands: [200, 194, 185],
  snow: [242, 243, 244],
};

/**
 * Live minimap: samples the world math model around the player every 400ms
 * (biome shading, water, roads) and overlays the player arrow each HUD tick.
 * Map is drawn with up = +z (north), right = +x, matching the world exactly.
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
          const wz = pz + half - (j + 0.5) * WORLD_PER_PIXEL; // up = +z (north)
          const h = heightAt(wx, wz);
          let r = 0, g = 0, b = 0;
          if (h < 0) {
            // water depth shading
            const d = Math.min(1, -h / 9);
            r = 172 - d * 55;
            g = 214 - d * 55;
            b = 216 - d * 40;
          } else {
            const rd = roadDistance(wx, wz);
            if (rd < ROAD_HALF) {
              // asphalt (slightly wider than half so thin roads stay visible)
              r = 78; g = 78; b = 84;
            } else if (rd < ROAD_SHOULDER) {
              // shoulder band
              r = 200; g = 192; b = 180;
            } else {
              const tt = terrainTypeAt(wx, wz, h);
              const col = MAP_COLORS[tt] ?? MAP_COLORS.meadow;
              // gentle elevation shading
              const t = Math.min(1, h / 32);
              r = col[0] + t * 26;
              g = col[1] + t * 22;
              b = col[2] + t * 20;
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

  // composite: base image + north marker + player arrow
  useEffect(() => {
    const canvas = canvasRef.current;
    const base = baseRef.current;
    if (!canvas || !base) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(base, 0, 0, SIZE, SIZE);

    // player arrow — heading 0 (north / +z) points up, east rotates clockwise
    const cx = SIZE / 2;
    const cy = SIZE / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(stats.heading);
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(7.5, 8);
    ctx.lineTo(0, 4);
    ctx.lineTo(-7.5, 8);
    ctx.closePath();
    ctx.fillStyle = "#fffdf7";
    ctx.strokeStyle = "rgba(60,50,40,0.55)";
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // north chip
    ctx.beginPath();
    ctx.arc(12, 12, 9, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,253,247,0.9)";
    ctx.fill();
    ctx.strokeStyle = "rgba(60,50,40,0.35)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#57534e";
    ctx.font = "bold 10px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("N", 12, 13);
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
