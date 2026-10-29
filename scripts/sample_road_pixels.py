#!/usr/bin/env python3
"""Sample road + terrain pixel colors from a Driftline screenshot."""
from PIL import Image

img = Image.open("/home/z/my-project/download/verify_spawn_v2.png").convert("RGB")
w, h = img.size
print(f"size: {w}x{h}")

# The chase camera puts the road running up the middle of the frame from bottom
# to the horizon. Sample a vertical strip near frame centre-x, lower half.
px = img.load()

def region(x0, x1, y0, y1, label):
    """average color of a box region"""
    rs = gs = bs = n = 0
    for y in range(y0, y1, 2):
        for x in range(x0, x1, 2):
            r, g, b = px[x, y]
            rs += r; gs += g; bs += b; n += 1
    print(f"{label:28s} avg RGB = ({rs//n:3d}, {gs//n:3d}, {bs//n:3d})")

# center column strip (road ahead of car)
region(w//2 - 30, w//2 + 30, int(h*0.55), int(h*0.70), "road ahead (centre)")
region(w//2 - 30, w//2 + 30, int(h*0.75), int(h*0.90), "road near (centre-low)")
# sides (terrain)
region(int(w*0.05), int(w*0.25), int(h*0.55), int(h*0.75), "terrain left")
region(int(w*0.75), int(w*0.95), int(h*0.55), int(h*0.75), "terrain right")

# histogram of the lower-central band to find the darkest big cluster (asphalt)
from collections import Counter
c = Counter()
for y in range(int(h*0.5), int(h*0.95), 3):
    for x in range(w//2 - 120, w//2 + 120, 3):
        r, g, b = px[x, y]
        c[(r//16*16, g//16*16, b//16*16)] += 1
print("\ntop-8 color clusters (lower centre band, quantised):")
for col, n in c.most_common(8):
    print(f"  RGB≈{col}  x{n}")
