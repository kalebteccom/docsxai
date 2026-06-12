import cairosvg
from PIL import Image, ImageFilter
import io, os

import pathlib
OUT = str(pathlib.Path(__file__).resolve().parent)
LAYERS = f"{OUT}/icon-composer-layers"
os.makedirs(LAYERS, exist_ok=True)
S = 1024

# Hugged geometry: 300-degree loop, gap centered on the escaping line
ARC = "M74.1 55A27 27 0 1 1 67.1 28.9"
DASH1 = "M36 41H84"
DASH2 = "M36 53H58"
# Optical center of the mark (line extends right): x 50.25, y 48
OCX, OCY = 50.25, 48

def mark(c, aw=9, tw=6.5):
    return (f'<path d="{ARC}" stroke="{c}" stroke-width="{aw}" stroke-linecap="butt" fill="none"/>'
            f'<path d="{DASH1}" stroke="{c}" stroke-width="{tw}" stroke-linecap="butt" fill="none"/>'
            f'<path d="{DASH2}" stroke="{c}" stroke-width="{tw}" stroke-linecap="butt" fill="none"/>')

V = {
    "bg_top": "#2A1505", "bg_bot": "#A06410",
    "glow": "rgba(255,205,120,0.30)", "glow_pos": (0.75, 0.18),
    "ink_top": "rgba(255,255,255,0.92)", "ink_bot": "rgba(255,255,255,0.55)",
    "spec": "rgba(255,255,255,0.85)", "refr": "rgba(40,22,2,0.38)",
}
TILE_TOP, TILE_BOT = "#7A4E0C", "#C8901C"

def render_str(svg, px_w, px_h=None):
    return Image.open(io.BytesIO(cairosvg.svg2png(
        bytestring=svg.encode(), output_width=px_w,
        output_height=px_h or px_w))).convert("RGBA")

# ---------- monochrome set ----------
with open(f"{OUT}/docsxai-mark.svg", "w") as f:
    f.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none" '
            f'role="img" aria-label="docsxai">{mark("currentColor")}</svg>')
for name, c in [("black", "#16161A"), ("white", "#FAFAF7")]:
    with open(f"{OUT}/docsxai-mark-{name}.svg", "w") as f:
        f.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none">{mark(c)}</svg>')

# GitHub avatar: white on family near-black, optically centered
s_av = 4.55
av = f'''<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
<rect width="512" height="512" fill="#0D0D0F"/>
<g transform="translate({256 - OCX * s_av:.1f},{256 - OCY * s_av:.1f}) scale({s_av})">{mark("#FAFAF7")}</g></svg>'''
render_str(av, 512).save(f"{OUT}/docsxai-avatar-512.png")

# ---------- glass set ----------
GLASS_SCALE = 8.45  # ring outer (63u) -> ~52% of 1024, sibling-equivalent presence
def offsets(scale):
    return S / 2 - OCX * scale, S / 2 - OCY * scale

def bg_svg():
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{S}" height="{S}">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="{V['bg_top']}"/><stop offset="1" stop-color="{V['bg_bot']}"/>
</linearGradient>
<radialGradient id="glow" cx="{V['glow_pos'][0]}" cy="{V['glow_pos'][1]}" r="0.75">
<stop offset="0" stop-color="{V['glow']}"/><stop offset="1" stop-color="rgba(255,255,255,0)"/>
</radialGradient></defs>
<rect width="{S}" height="{S}" fill="url(#bg)"/>
<rect width="{S}" height="{S}" fill="url(#glow)"/></svg>'''

def glass_mark_svg(scale, ox, oy, glass=True):
    body = mark("url(#ink)")
    extras = ""
    if glass:
        extras = (f'<path d="M18.9 58.6A31 31 0 0 1 58.6 18.9" stroke="{V["spec"]}" stroke-width="0.9" fill="none"/>'
                  f'<path d="M25.9 56A23.5 23.5 0 0 1 56 25.9" stroke="{V["refr"]}" stroke-width="0.9" fill="none"/>'
                  f'<path d="M37 38.4H83" stroke="{V["spec"]}" stroke-width="0.9" fill="none"/>'
                  f'<path d="M37 50.4H57" stroke="{V["spec"]}" stroke-width="0.9" fill="none"/>')
    ink = (f'<linearGradient id="ink" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="96">'
           f'<stop offset="0" stop-color="{V["ink_top"]}"/><stop offset="1" stop-color="{V["ink_bot"]}"/>'
           f'</linearGradient>') if glass else \
          ('<linearGradient id="ink" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="96">'
           '<stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#FFFFFF"/></linearGradient>')
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{S}" height="{S}">
<defs>{ink}</defs>
<g transform="translate({ox:.1f},{oy:.1f}) scale({scale:.4f})">{body}{extras}</g></svg>'''

def shadow_layer(scale, ox, oy):
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{S}" height="{S}">
<g transform="translate({ox:.1f},{oy:.1f}) scale({scale:.4f})">{mark("black")}</g></svg>'''
    sh = render_str(svg, S)
    sh.putalpha(sh.split()[3].point(lambda a: int(a * 0.38)))
    sh = sh.filter(ImageFilter.GaussianBlur(14))
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    out.paste(sh, (0, 12), sh)
    return out

ox, oy = offsets(GLASS_SCALE)
master = render_str(bg_svg(), S)
master.alpha_composite(shadow_layer(GLASS_SCALE, ox, oy))
master.alpha_composite(render_str(glass_mark_svg(GLASS_SCALE, ox, oy, True), S))
master.convert("RGB").save(f"{OUT}/docsxai-ember-fullbleed-1024.png")

render_str(bg_svg(), S).convert("RGB").save(f"{LAYERS}/background.png")
render_str(glass_mark_svg(GLASS_SCALE, ox, oy, False), S).save(f"{LAYERS}/mark.png")

SQ, MG, R = 824, 100, 185
mask = render_str(f'<svg xmlns="http://www.w3.org/2000/svg" width="{S}" height="{S}">'
                  f'<rect x="{MG}" y="{MG}" width="{SQ}" height="{SQ}" rx="{R}" fill="white"/></svg>', S).split()[3]
p_scale = GLASS_SCALE * SQ / S
pox, poy = S / 2 - OCX * p_scale, S / 2 - OCY * p_scale
tile = render_str(bg_svg(), S)
tile.alpha_composite(shadow_layer(p_scale, pox, poy))
tile.alpha_composite(render_str(glass_mark_svg(p_scale, pox, poy, True), S))
edge = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{S}" height="{S}">
<rect x="{MG+3}" y="{MG+3}" width="{SQ-6}" height="{SQ-6}" rx="{R-3}" fill="none" stroke="rgba(0,0,0,0.28)" stroke-width="6"/>
<rect x="{MG+5}" y="{MG+5}" width="{SQ-10}" height="{SQ-10}" rx="{R-5}" fill="none" stroke="rgba(255,255,255,0.30)" stroke-width="2.5"/></svg>'''
preview = Image.new("RGBA", (S, S), (0, 0, 0, 0))
preview.paste(tile, (0, 0), mask)
preview.alpha_composite(render_str(edge, S))
preview.save(f"{OUT}/docsxai-glass-ember-1024.png")

# ---------- tile favicons ----------
fav = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
<defs><linearGradient id="t" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="{TILE_TOP}"/><stop offset="1" stop-color="{TILE_BOT}"/>
</linearGradient></defs>
<rect width="96" height="96" rx="21" fill="url(#t)"/>
<g transform="translate({48 - OCX * 0.8:.1f},{48 - OCY * 0.8:.1f}) scale(0.8)">{mark("#FFFFFF", aw=10, tw=7.5)}</g>
</svg>'''
with open(f"{OUT}/docsxai-favicon.svg", "w") as f:
    f.write(fav)

fav16 = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
<defs><linearGradient id="t" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="{TILE_TOP}"/><stop offset="1" stop-color="{TILE_BOT}"/>
</linearGradient></defs>
<rect width="96" height="96" rx="21" fill="url(#t)"/>
<g transform="translate({48 - OCX * 0.84:.1f},{48 - OCY * 0.84:.1f}) scale(0.84)">
<path d="{ARC}" stroke="#FFFFFF" stroke-width="13" stroke-linecap="butt" fill="none"/>
<path d="M34 41H88" stroke="#FFFFFF" stroke-width="10" stroke-linecap="butt" fill="none"/>
</g></svg>'''

def fav_render(svg, px, path):
    cairosvg.svg2png(bytestring=svg.encode(), write_to=path, output_width=px, output_height=px)

fav_render(fav16, 16, f"{OUT}/favicon-16.png")
for px in (32, 48, 180):
    name = "apple-touch-icon.png" if px == 180 else f"favicon-{px}.png"
    fav_render(fav, px, f"{OUT}/{name}")
imgs = [Image.open(f"{OUT}/favicon-{px}.png") for px in (16, 32, 48)]
imgs[2].save(f"{OUT}/favicon.ico", format="ICO",
             sizes=[(16,16),(32,32),(48,48)], append_images=imgs[:2])

# ---------- previews ----------
strip = Image.new("RGBA", (560, 180), (28, 27, 34, 255))
big = Image.open(f"{OUT}/favicon-48.png").resize((128,128), Image.LANCZOS)
f16 = Image.open(f"{OUT}/favicon-16.png").resize((128,128), Image.NEAREST)
f32 = Image.open(f"{OUT}/favicon-32.png").resize((128,128), Image.NEAREST)
strip.paste(big, (40, 26), big); strip.paste(f16, (216, 26), f16); strip.paste(f32, (392, 26), f32)
strip.save(f"{OUT}/favicon-tile-preview.png")

sheet = Image.new("RGBA", (1180, 420), (242, 240, 235, 255))
a = Image.open(f"{OUT}/docsxai-ember-fullbleed-1024.png").convert("RGBA").resize((320,320), Image.LANCZOS)
b = Image.open(f"{OUT}/docsxai-glass-ember-1024.png").resize((320,320), Image.LANCZOS)
c = Image.open(f"{OUT}/docsxai-avatar-512.png").resize((320,320), Image.LANCZOS)
sheet.paste(a, (60,50), a); sheet.paste(b, (430,50), b); sheet.paste(c, (800,50), c)
sheet.save(f"{OUT}/ember-preview.png")

fam = Image.new("RGBA", (1120, 420), (13, 13, 15, 255))
bx = Image.open(os.environ.get("BROWXAI_GLASS", f"{OUT}/../../browxai/brand/browxai-glass-aurora-1024.png")).resize((320,320), Image.LANCZOS)
rx = Image.open(os.environ.get("REMOTXAI_GLASS", f"{OUT}/../../remotxai/brand/remotxai-glass-signal-1024.png")).resize((320,320), Image.LANCZOS)
dx = Image.open(f"{OUT}/docsxai-glass-ember-1024.png").resize((320,320), Image.LANCZOS)
fam.paste(bx, (40,50), bx); fam.paste(rx, (400,50), rx); fam.paste(dx, (760,50), dx)
fam.save(f"{OUT}/xai-family-trio.png")
print("done")
