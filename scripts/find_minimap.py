#!/usr/bin/env python3
"""Locate the minimap in the screenshot and check for the dark road color."""
from PIL import Image
from collections import Counter

img = Image.open("/home/z/my-project/download/verify_spawn_v2.png").convert("RGB")
w, h = img.size

# search each corner for a 148x148 minimap canvas: look for the road color
# (78,78,84) and water/terrain pastel mix in a small region
corners = {
    "top-left": (0, 0, 400, 300),
    "top-right": (w - 400, 0, w, 300),
    "bottom-left": (0, h - 300, 400, h),
    "bottom-right": (w - 400, h - 300, w, h),
}
for name, (x0, y0, x1, y1) in corners.items():
    crop = img.crop((x0, y0, x1, y1))
    cnt = 0
    px = crop.load()
    cw, ch = crop.size
    dark = 0
    for y in range(0, ch, 2):
        for x in range(0, cw, 2):
            r, g, b = px[x, y]
            if abs(r - 78) < 25 and abs(g - 78) < 25 and abs(b - 84) < 25:
                dark += 1
    print(f"{name}: minimap-road-colored pixels = {dark}")
    if dark > 30:
        crop.save(f"/home/z/my-project/download/crop_minimap_{name}.png")
