#!/usr/bin/env python3
"""Crop a viewport PNG using CSS-pixel rect and inner viewport size (67% zoom flow)."""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image


def main() -> None:
    if len(sys.argv) != 9:
        print(
            "Usage: crop-viewport-png.py <in.png> <out.png> "
            "<innerWidth> <innerHeight> <left> <top> <right> <bottom>",
            file=sys.stderr,
        )
        sys.exit(2)
    path_in = Path(sys.argv[1])
    path_out = Path(sys.argv[2])
    iw, ih, left, top, right, bottom = map(float, sys.argv[3:9])
    im = Image.open(path_in)
    pw, ph = im.size
    sx = pw / iw
    sy = ph / ih
    box = (
        max(0, int(left * sx)),
        max(0, int(top * sy)),
        min(pw, int(right * sx)),
        min(ph, int(bottom * sy)),
    )
    if box[2] <= box[0] or box[3] <= box[1]:
        print("Invalid crop box", box, "png", pw, ph, "inner", iw, ih, file=sys.stderr)
        sys.exit(1)
    im.crop(box).save(path_out)


if __name__ == "__main__":
    main()
