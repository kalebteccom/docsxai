"""Regenerate the docsxai favicons and standalone marks.

Two sources of truth, both vector:
  - the mark glyph (the `mark()` paths) -> the solid-color standalone SVGs;
  - docsxai-favicon.svg (the amber tile + white glyph) -> the raster favicons.

    pip install cairosvg pillow
    python3 brand/render.py

For the halo app icons (full-bleed master, squircle, Icon Composer layers),
see hig.py.
"""

import os

import cairosvg
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))

ARC1 = "M17.2 59.8A33 33 0 0 1 59.8 17.2"
ARC2 = "M78.8 36.2A33 33 0 0 1 36.2 78.8"
PAGE = "M37.5 30.5H51.5L58.5 37.5V65.5H37.5Z"
FOLD = "M51.5 30.5V37.5H58.5"
LINES = "M43 47.5H53M43 54.5H50"


def mark(c, fw=10, pw=5.5, dw=3.5, hr=4, rr=7, rw=2.25):
    return (
        f'<path d="{ARC1}" stroke="{c}" stroke-width="{fw}" stroke-linecap="butt" fill="none"/>'
        f'<path d="{ARC2}" stroke="{c}" stroke-width="{fw}" stroke-linecap="butt" fill="none"/>'
        f'<path d="{PAGE}" stroke="{c}" stroke-width="{pw}" fill="none"/>'
        f'<path d="{FOLD}" stroke="{c}" stroke-width="{dw}" fill="none"/>'
        f'<path d="{LINES}" stroke="{c}" stroke-width="{dw}" fill="none"/>'
        f'<circle cx="72" cy="24" r="{hr}" fill="{c}"/>'
        f'<circle cx="72" cy="24" r="{rr}" fill="none" stroke="{c}" stroke-width="{rw}"/>'
    )


# Solid-color standalone marks (the glyph; the header logo uses these).
with open(f"{HERE}/docsxai-mark.svg", "w") as f:
    f.write(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none" '
        f'role="img" aria-label="docsxai">{mark("currentColor")}</svg>'
    )
for name, color in [("black", "#16161A"), ("white", "#FAFAF7")]:
    with open(f"{HERE}/docsxai-mark-{name}.svg", "w") as f:
        f.write(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" '
            f'fill="none">{mark(color)}</svg>'
        )

# Raster favicons: rasterize the amber tile favicon at each size.
fav = open(f"{HERE}/docsxai-favicon.svg", "rb").read()
for px in (16, 32, 48):
    cairosvg.svg2png(
        bytestring=fav,
        write_to=f"{HERE}/favicon-{px}.png",
        output_width=px,
        output_height=px,
    )
cairosvg.svg2png(
    bytestring=fav,
    write_to=f"{HERE}/apple-touch-icon.png",
    output_width=180,
    output_height=180,
)

# Multi-resolution ICO.
imgs = [Image.open(f"{HERE}/favicon-{px}.png") for px in (16, 32, 48)]
imgs[2].save(
    f"{HERE}/favicon.ico",
    format="ICO",
    sizes=[(16, 16), (32, 32), (48, 48)],
    append_images=imgs[:2],
)

print("done")
