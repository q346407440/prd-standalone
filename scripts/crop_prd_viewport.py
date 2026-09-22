#!/usr/bin/env python3
"""Crop a viewport PNG using CSS rect × PNG/viewport scale (PRD 67% workflow)."""
import json
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("Pillow required: pip install Pillow", file=sys.stderr)
    sys.exit(1)


def crop_viewport(png_path, rect, inner_w, inner_h, out_path, pad=10):
    img = Image.open(png_path)
    pw, ph = img.size
    sx = pw / float(inner_w)
    sy = ph / float(inner_h)
    left = max(0, int(rect["x"] * sx) - pad)
    top = max(0, int(rect["y"] * sy) - pad)
    right = min(pw, int((rect["x"] + rect["width"]) * sx) + pad)
    bottom = min(ph, int((rect["y"] + rect["height"]) * sy) + pad)
    cropped = img.crop((left, top, right, bottom))
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    cropped.save(out_path)
    print(json.dumps({"out": str(out_path), "size": cropped.size}))


if __name__ == "__main__":
    # argv: viewport.png rect.json innerW innerH out.png [pad]
    png_path = sys.argv[1]
    rect = json.loads(sys.argv[2]) if sys.argv[2].startswith("{") else json.loads(Path(sys.argv[2]).read_text())
    inner_w = float(sys.argv[3])
    inner_h = float(sys.argv[4])
    out_path = sys.argv[5]
    pad = int(sys.argv[6]) if len(sys.argv) > 6 else 10
    crop_viewport(png_path, rect, inner_w, inner_h, out_path, pad=pad)
