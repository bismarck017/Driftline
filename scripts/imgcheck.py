from PIL import Image
import sys
for name in ["verify_day", "verify_night", "verify_sunset", "verify_cycled_night", "verify_pause_menu"]:
    p = f"/home/z/my-project/download/{name}.png"
    im = Image.open(p).convert("RGB").resize((180, 108))
    px = list(im.getdata())
    n = len(px)
    r = sum(x[0] for x in px)/n; g = sum(x[1] for x in px)/n; b = sum(x[2] for x in px)/n
    # sample sky region (top quarter) and ground region (bottom third)
    top = [px[i] for i in range(0, n//4)]
    bot = [px[i] for i in range(2*n//3, n)]
    tr = sum(x[0] for x in top)/len(top); tg = sum(x[1] for x in top)/len(top); tb = sum(x[2] for x in top)/len(top)
    br = sum(x[0] for x in bot)/len(bot); bg = sum(x[1] for x in bot)/len(bot); bb = sum(x[2] for x in bot)/len(bot)
    print(f"{name}: avg=({r:.0f},{g:.0f},{b:.0f}) sky=({tr:.0f},{tg:.0f},{tb:.0f}) ground=({br:.0f},{bg:.0f},{bb:.0f})")
