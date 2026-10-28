#!/usr/bin/env python3
"""Crop key regions from the spawn screenshot for close inspection."""
from PIL import Image

img = Image.open("/home/z/my-project/download/verify_spawn_v2.png").convert("RGB")
w, h = img.size

# road strip ahead of the car (above the car, centre of frame)
img.crop((w//2 - 200, int(h*0.30), w//2 + 200, int(h*0.55))).save(
    "/home/z/my-project/download/crop_road_ahead.png")
# car region
img.crop((w//2 - 350, int(h*0.50), w//2 + 350, int(h*0.95))).save(
    "/home/z/my-project/download/crop_car.png")
# full left terrain for reference
img.crop((0, int(h*0.30), int(w*0.30), int(h*0.60))).save(
    "/home/z/my-project/download/crop_terrain.png")

# objective check: row-by-row scan down the exact centre column
px = img.load()
print("centre column samples (y%, R,G,B):")
for ypct in [20, 30, 35, 40, 45, 50, 55, 60, 70, 80, 90]:
    y = int(h * ypct / 100)
    r, g, b = px[w // 2, y]
    print(f"  {ypct:3d}%  ({r:3d},{g:3d},{b:3d})")

# widest dark-run detection: for each row in lower half, count how many
# contiguous dark pixels (all channels < 110) around centre
print("\ndark-run width per row (centre):")
for ypct in [35, 40, 45, 50, 55, 60, 65, 70, 75, 80]:
    y = int(h * ypct / 100)
    best = run = 0
    for x in range(w//2 - 400, w//2 + 400):
        r, g, b = px[x, y]
        if max(r, g, b) < 110:
            run += 1
            best = max(best, run)
        else:
            run = 0
    print(f"  y={ypct:3d}%  dark run = {best}px")
