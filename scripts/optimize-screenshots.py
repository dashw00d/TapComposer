#!/usr/bin/env python3
"""Shrink docs/screenshots/*.png: cap width at 1280 px (mobile shots 780 px) and quantize to a palette.

Requires Pillow. Usage: python3 scripts/optimize-screenshots.py
"""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent / "docs" / "screenshots"
for path in sorted(root.glob("*.png")):
    image = Image.open(path).convert("RGB")
    limit = 780 if "mobile" in path.name else 1280
    if image.width > limit:
        image = image.resize((limit, round(image.height * limit / image.width)), Image.LANCZOS)
    image.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(
        path, optimize=True
    )
    print(f"{path.name}: {image.width}x{image.height}, {path.stat().st_size // 1024} KB")
