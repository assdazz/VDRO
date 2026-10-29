from pathlib import Path

from PIL import Image, ImageDraw

S = 1024
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

pad = 54
d.rounded_rectangle(
    (pad, pad, S - pad, S - pad),
    radius=190,
    fill=(5, 5, 5, 255),
    outline=(250, 255, 105, 255),
    width=18,
)

baseline = 560
for x, top, w in [
    (300, 420, 58),
    (405, 330, 58),
    (512, 260, 58),
    (619, 350, 58),
    (724, 450, 58),
]:
    bottom = baseline + (baseline - top) // 2
    d.rounded_rectangle(
        (x - w // 2, top, x + w // 2, bottom),
        radius=26,
        fill=(250, 255, 105, 255),
    )

out = Path(__file__).resolve().parent.parent / "assets"
out.mkdir(parents=True, exist_ok=True)
img.save(out / "vdro-icon.png")
img.save(
    out / "vdro.ico",
    format="ICO",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
print(out / "vdro.ico")
