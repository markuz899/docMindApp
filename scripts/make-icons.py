#!/usr/bin/env python3
"""Generates the DocMind app icon set.

The mark is the product in one image: a documentation page, the one section
retrieval selected (violet), and the retrieval-graph node attached to it (cyan).
Colours are the renderer's own --primary and --accent tokens.

Run only when the artwork changes; the output is committed under resources/.
    python3 scripts/make-icons.py
"""
import colorsys
import pathlib
import shutil
import subprocess

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "resources"

FINAL = 1024
SS = 2               # supersample, then LANCZOS down: PIL shapes are aliased
S = FINAL * SS

PRIMARY_HSL = (262, 83, 64)   # --primary, violet
ACCENT_HSL = (190, 92, 52)    # --accent, cyan
LINE_HSL = (240, 16, 82)      # muted body text


def hsl(h, s, light):
    r, g, b = colorsys.hls_to_rgb(h / 360, light / 100, s / 100)
    return (round(r * 255), round(g * 255), round(b * 255), 255)


def diagonal_gradient(size, start, end):
    """The renderer's `bg-gradient-to-br`: top-left -> bottom-right."""
    grad = Image.new("RGB", (size, size))
    px = grad.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            px[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(start[:3], end[:3]))
    return grad


def artwork():
    primary, accent, line = hsl(*PRIMARY_HSL), hsl(*ACCENT_HSL), hsl(*LINE_HSL)

    # macOS leaves ~8.5% breathing room around the rounded square.
    inset, radius = round(S * 0.085), round(S * 0.225)
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [inset, inset, S - inset - 1, S - inset - 1], radius=radius, fill=255
    )
    img.paste(diagonal_gradient(S, primary, accent), (0, 0), mask)

    draw = ImageDraw.Draw(img)
    x0, x1 = round(S * 0.265), round(S * 0.735)
    y0, y1 = round(S * 0.205), round(S * 0.795)
    draw.rounded_rectangle([x0, y0, x1, y1], radius=round(S * 0.05), fill=(255, 255, 255, 255))

    pad, lh, gap = round(S * 0.058), round(S * 0.030), round(S * 0.070)
    inner = x1 - x0 - 2 * pad
    y = y0 + round(S * 0.085)
    for i in range(5):
        width = inner * (0.58 if i == 4 else 1.0)
        if i == 2:
            # The retrieved section, plus the graph node wired into it.
            box = [x0 + pad, y - round(S * 0.010), x0 + pad + width, y + lh + round(S * 0.010)]
            draw.rounded_rectangle(box, radius=(box[3] - box[1]) // 2, fill=primary)
            nr = round(S * 0.036)
            ny = (box[1] + box[3]) // 2
            draw.ellipse([x0 + pad - nr, ny - nr, x0 + pad + nr, ny + nr], fill=accent)
        else:
            draw.rounded_rectangle(
                [x0 + pad, y, x0 + pad + width, y + lh], radius=lh // 2, fill=line
            )
        y += gap

    return img.resize((FINAL, FINAL), Image.LANCZOS)


def build():
    icon = artwork()
    OUT.mkdir(parents=True, exist_ok=True)

    icon.save(OUT / "icon.png")  # electron-builder uses this for Linux
    icon.save(
        OUT / "icon.ico",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print("wrote resources/icon.png and resources/icon.ico")

    if shutil.which("iconutil") is None:
        print("iconutil not available (macOS only) - skipping icon.icns")
        return

    iconset = OUT / "icon.iconset"
    shutil.rmtree(iconset, ignore_errors=True)
    iconset.mkdir()
    for size in (16, 32, 128, 256, 512):
        icon.resize((size, size), Image.LANCZOS).save(iconset / f"icon_{size}x{size}.png")
        icon.resize((size * 2, size * 2), Image.LANCZOS).save(
            iconset / f"icon_{size}x{size}@2x.png"
        )
    subprocess.run(
        ["iconutil", "-c", "icns", str(iconset), "-o", str(OUT / "icon.icns")], check=True
    )
    shutil.rmtree(iconset, ignore_errors=True)
    print("wrote resources/icon.icns")


if __name__ == "__main__":
    build()
