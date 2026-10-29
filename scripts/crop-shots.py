"""Crop + upscale regions of a gameplay screenshot for close inspection."""
import sys
from PIL import Image

src = sys.argv[1] if len(sys.argv) > 1 else "/home/z/my-project/download/shots/v4.png"
img = Image.open(src)
w, h = img.size
print("source:", img.size)

# center strip: road ahead of the car (car sits slightly below center)
crops = {
    "road-ahead": (int(w * 0.25), int(h * 0.30), int(w * 0.75), int(h * 0.62)),
    "car-close": (int(w * 0.25), int(h * 0.45), int(w * 0.75), int(h * 0.85)),
    "minimap": (int(w * 0.80), int(h * 0.03), w, int(h * 0.30)),
}
for name, box in crops.items():
    c = img.crop(box)
    c = c.resize((c.width * 3, c.height * 3), Image.LANCZOS)
    out = f"/home/z/my-project/download/shots/crop-{name}.png"
    c.save(out)
    print("saved", out)
