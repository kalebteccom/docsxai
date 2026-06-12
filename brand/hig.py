"""Regenerate the docsxai halo app icons + Icon Composer layers.

The halo treatment: the mark on a deep-amber vertical gradient with a soft
amber glow in the upper-right, light glass refractions inside the glyph, and a
faint drop-shadow under the mark. Two outputs:

  - docsxai-halo-fullbleed-1024.png      the master full-bleed app-store icon
  - docsxai-glass-halo-1024.png          the squircle marketing preview
  - icon-composer-layers/                background.png + flat mark.png
    (flat layers for Apple Icon Composer, no baked effects)

Palette lives in the `V` dict below.

    pip install cairosvg pillow
    python3 brand/hig.py
"""

import io
import os

import cairosvg
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
LAYERS = f"{HERE}/icon-composer-layers"
os.makedirs(LAYERS, exist_ok=True)
S = 1024

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


V = {
    "bg_top": "#381C04",
    "bg_bot": "#B45309",
    "glow": "rgba(251,191,36,0.30)",
    "glow_pos": (0.75, 0.18),
    "ink_top": "rgba(255,255,255,0.92)",
    "ink_bot": "rgba(255,255,255,0.55)",
    "spec": "rgba(255,255,255,0.85)",
    "refr": "rgba(46,21,2,0.38)",
}


def render_str(svg, px):
    return Image.open(
        io.BytesIO(cairosvg.svg2png(bytestring=svg.encode(), output_width=px, output_height=px))
    ).convert("RGBA")


# GitHub avatar: white on the same near-black as the siblings for org-page consistency.
av = (
    f'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">'
    f'<rect width="512" height="512" fill="#0D0D0F"/>'
    f'<g transform="translate(102.4,102.4) scale(3.2)">{mark("#FAFAF7")}</g></svg>'
)
render_str(av, 512).save(f"{HERE}/docsxai-avatar-512.png")


def geom():
    box = 0.56 * S * 96 / 76
    return box / 96, (S - box) / 2


def bg_svg():
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{S}" height="{S}">'
        f'<defs>'
        f'<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">'
        f'<stop offset="0" stop-color="{V["bg_top"]}"/>'
        f'<stop offset="1" stop-color="{V["bg_bot"]}"/>'
        f'</linearGradient>'
        f'<radialGradient id="glow" cx="{V["glow_pos"][0]}" cy="{V["glow_pos"][1]}" r="0.75">'
        f'<stop offset="0" stop-color="{V["glow"]}"/>'
        f'<stop offset="1" stop-color="rgba(255,255,255,0)"/>'
        f'</radialGradient></defs>'
        f'<rect width="{S}" height="{S}" fill="url(#bg)"/>'
        f'<rect width="{S}" height="{S}" fill="url(#glow)"/></svg>'
    )


def glass_mark_svg(scale, off, glass=True):
    body = mark("url(#ink)")
    extras = ""
    if glass:
        extras = (
            f'<path d="M19.2 56.3A30 30 0 0 1 56.3 19.2" stroke="{V["refr"]}" stroke-width="0.9" fill="none"/>'
            f'<path d="M76.8 39.7A30 30 0 0 1 39.7 76.8" stroke="{V["refr"]}" stroke-width="0.9" fill="none"/>'
            f'<path d="M13.4 57.9A36 36 0 0 1 57.9 13.4" stroke="{V["spec"]}" stroke-width="0.9" fill="none"/>'
            f'<path d="M82.6 38.1A36 36 0 0 1 38.1 82.6" stroke="{V["spec"]}" stroke-width="0.9" fill="none"/>'
            f'<path d="M37.5 65.5V30.5H51.5" stroke="{V["spec"]}" stroke-width="0.9" fill="none"/>'
            f'<path d="{FOLD}" stroke="{V["spec"]}" stroke-width="0.8" fill="none"/>'
        )
    if glass:
        ink = (
            '<linearGradient id="ink" x1="0" y1="0" x2="0" y2="1">'
            f'<stop offset="0" stop-color="{V["ink_top"]}"/>'
            f'<stop offset="1" stop-color="{V["ink_bot"]}"/>'
            '</linearGradient>'
        )
    else:
        ink = (
            '<linearGradient id="ink" x1="0" y1="0" x2="0" y2="1">'
            '<stop offset="0" stop-color="#FFFFFF"/>'
            '<stop offset="1" stop-color="#FFFFFF"/></linearGradient>'
        )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{S}" height="{S}">'
        f'<defs>{ink}</defs>'
        f'<g transform="translate({off:.1f},{off:.1f}) scale({scale:.4f})">{body}{extras}</g></svg>'
    )


def shadow_layer(scale, off):
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{S}" height="{S}">'
        f'<g transform="translate({off:.1f},{off:.1f}) scale({scale:.4f})">{mark("black")}</g></svg>'
    )
    sh = render_str(svg, S)
    sh.putalpha(sh.split()[3].point(lambda a: int(a * 0.38)))
    sh = sh.filter(ImageFilter.GaussianBlur(14))
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    out.paste(sh, (0, 12), sh)
    return out


scale, off = geom()
master = render_str(bg_svg(), S)
master.alpha_composite(shadow_layer(scale, off))
master.alpha_composite(render_str(glass_mark_svg(scale, off, True), S))
master.convert("RGB").save(f"{HERE}/docsxai-halo-fullbleed-1024.png")

render_str(bg_svg(), S).convert("RGB").save(f"{LAYERS}/background.png")
render_str(glass_mark_svg(scale, off, False), S).save(f"{LAYERS}/mark.png")

SQ, MG, R = 824, 100, 185
mask = render_str(
    f'<svg xmlns="http://www.w3.org/2000/svg" width="{S}" height="{S}">'
    f'<rect x="{MG}" y="{MG}" width="{SQ}" height="{SQ}" rx="{R}" fill="white"/></svg>',
    S,
).split()[3]
p_scale = 0.56 * SQ * 96 / 76 / 96
p_off = (S - p_scale * 96) / 2
tile = render_str(bg_svg(), S)
tile.alpha_composite(shadow_layer(p_scale, p_off))
tile.alpha_composite(render_str(glass_mark_svg(p_scale, p_off, True), S))
edge = (
    f'<svg xmlns="http://www.w3.org/2000/svg" width="{S}" height="{S}">'
    f'<rect x="{MG + 3}" y="{MG + 3}" width="{SQ - 6}" height="{SQ - 6}" rx="{R - 3}" '
    f'fill="none" stroke="rgba(0,0,0,0.28)" stroke-width="6"/>'
    f'<rect x="{MG + 5}" y="{MG + 5}" width="{SQ - 10}" height="{SQ - 10}" rx="{R - 5}" '
    f'fill="none" stroke="rgba(255,255,255,0.30)" stroke-width="2.5"/></svg>'
)
preview = Image.new("RGBA", (S, S), (0, 0, 0, 0))
preview.paste(tile, (0, 0), mask)
preview.alpha_composite(render_str(edge, S))
preview.save(f"{HERE}/docsxai-glass-halo-1024.png")

# Marketing preview sheet: fullbleed / glass / avatar side-by-side.
sheet = Image.new("RGBA", (1180, 420), (242, 240, 235, 255))
a = Image.open(f"{HERE}/docsxai-halo-fullbleed-1024.png").convert("RGBA").resize(
    (320, 320), Image.LANCZOS
)
b = Image.open(f"{HERE}/docsxai-glass-halo-1024.png").resize((320, 320), Image.LANCZOS)
c = Image.open(f"{HERE}/docsxai-avatar-512.png").resize((320, 320), Image.LANCZOS)
sheet.paste(a, (60, 50), a)
sheet.paste(b, (430, 50), b)
sheet.paste(c, (800, 50), c)
sheet.save(f"{HERE}/halo-preview.png")

# xai-family preview: browxai + remotxai + docsxai glass icons side-by-side.
# Optional, only renders when both sibling glass icons are available locally.
bx_glass = os.environ.get(
    "BROWXAI_GLASS",
    os.path.normpath(os.path.join(HERE, "..", "..", "browxai", "brand", "browxai-glass-aurora-1024.png")),
)
rx_glass = os.environ.get(
    "REMOTXAI_GLASS",
    os.path.normpath(os.path.join(HERE, "..", "..", "remotxai", "brand", "remotxai-glass-signal-1024.png")),
)
if os.path.exists(bx_glass) and os.path.exists(rx_glass):
    fam = Image.new("RGBA", (1120, 420), (13, 13, 15, 255))
    bx = Image.open(bx_glass).resize((320, 320), Image.LANCZOS)
    rx = Image.open(rx_glass).resize((320, 320), Image.LANCZOS)
    dx = Image.open(f"{HERE}/docsxai-glass-halo-1024.png").resize((320, 320), Image.LANCZOS)
    fam.paste(bx, (40, 50), bx)
    fam.paste(rx, (400, 50), rx)
    fam.paste(dx, (760, 50), dx)
    fam.save(f"{HERE}/xai-family-preview.png")

print("done")
