"""Generate Mizunara app icons: a wood shogi koma (piece) on a warm wood-grain background."""
import math
from PIL import Image, ImageDraw, ImageFont, ImageFilter

SIZE = 512
FONT_PATH = r"C:\Windows\Fonts\yumindb.ttf"


def lerp(a, b, t):
    return a + (b - a) * t


def make_background(size):
    img = Image.new("RGB", (size, size))
    px = img.load()
    top = (58, 38, 20)
    bottom = (32, 20, 11)
    for y in range(size):
        t = y / (size - 1)
        r = int(lerp(top[0], bottom[0], t))
        g = int(lerp(top[1], bottom[1], t))
        b = int(lerp(top[2], bottom[2], t))
        for x in range(size):
            px[x, y] = (r, g, b)

    # subtle wood grain: wavy horizontal lines
    grain = Image.new("L", (size, size), 0)
    gpx = grain.load()
    for y in range(size):
        base = 40 + 18 * math.sin(y * 0.045) + 10 * math.sin(y * 0.013 + 2)
        for x in range(size):
            wobble = 6 * math.sin(x * 0.02 + y * 0.01)
            v = base + wobble
            gpx[x, y] = max(0, min(60, int(v)))
    grain = grain.filter(ImageFilter.GaussianBlur(1.2))
    img = Image.composite(Image.new("RGB", (size, size), (90, 60, 30)), img, grain)

    # rounded-square mask with soft vignette corners handled by caller
    return img


def rounded_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def koma_polygon(cx, cy, w, h):
    # pentagon "house" shape pointing up, like a shogi piece
    top = (cx, cy - h * 0.52)
    right_shoulder = (cx + w * 0.44, cy - h * 0.22)
    bottom_right = (cx + w * 0.5, cy + h * 0.5)
    bottom_left = (cx - w * 0.5, cy + h * 0.5)
    left_shoulder = (cx - w * 0.44, cy - h * 0.22)
    return [top, right_shoulder, bottom_right, bottom_left, left_shoulder]


def draw_koma(img, cx, cy, w, h):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    poly = koma_polygon(cx, cy, w, h)

    # soft drop shadow
    shadow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    shifted = [(x, y + 14) for x, y in poly]
    sd.polygon(shifted, fill=(0, 0, 0, 140))
    shadow = shadow.filter(ImageFilter.GaussianBlur(14))
    img.alpha_composite(shadow)

    # gradient-filled piece body via vertical bands
    top_y = min(p[1] for p in poly)
    bot_y = max(p[1] for p in poly)
    grad = Image.new("RGBA", img.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(grad)
    light = (247, 226, 178)
    mid = (222, 178, 108)
    dark = (156, 112, 55)
    steps = int(bot_y - top_y) + 1
    for i in range(steps):
        t = i / max(1, steps - 1)
        if t < 0.55:
            tt = t / 0.55
            col = tuple(int(lerp(light[k], mid[k], tt)) for k in range(3))
        else:
            tt = (t - 0.55) / 0.45
            col = tuple(int(lerp(mid[k], dark[k], tt)) for k in range(3))
        y = top_y + i
        gd.line([(0, y), (img.size[0], y)], fill=col + (255,))

    mask = Image.new("L", img.size, 0)
    md = ImageDraw.Draw(mask)
    md.polygon(poly, fill=255)
    img.paste(grad, (0, 0), mask)

    # bevel edge highlight
    outline = Image.new("RGBA", img.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(outline)
    od.polygon(poly, outline=(90, 58, 24, 255), width=5)
    img.alpha_composite(outline)

    top_edge = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ted = ImageDraw.Draw(top_edge)
    ted.line([poly[4], poly[0], poly[1]], fill=(255, 244, 220, 180), width=4)
    top_edge = top_edge.filter(ImageFilter.GaussianBlur(1))
    img.alpha_composite(top_edge)

    return poly


def draw_char(img, cx, cy, text, size, color):
    font = ImageFont.truetype(FONT_PATH, size)
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    bbox = d.textbbox((0, 0), text, font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    pos = (cx - w / 2 - bbox[0], cy - h / 2 - bbox[1])
    # subtle engraved shadow then main stroke
    d.text((pos[0] + 2, pos[1] + 3), text, font=font, fill=(30, 16, 6, 130))
    d.text(pos, text, font=font, fill=color)
    img.alpha_composite(layer)


def build(size, radius, maskless=False):
    bg = make_background(size)
    img = bg.convert("RGBA")

    cx, cy = size * 0.5, size * 0.53
    w, h = size * 0.62, size * 0.72
    draw_koma(img, cx, cy, w, h)
    draw_char(img, cx, cy + size * 0.02, "王", int(size * 0.34), (120, 26, 20, 255))

    if not maskless:
        mask = rounded_mask(size, radius)
        out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        out.paste(img, (0, 0), mask)
        return out
    return img


if __name__ == "__main__":
    icon512 = build(512, 96)
    icon512.save("icons/icon-512.png")

    icon192 = build(192, 36)
    icon192.save("icons/icon-192.png")

    # maskable icon: full-bleed background, no rounding (safe-zone padding built into layout)
    maskable = build(512, 0, maskless=True)
    maskable.save("icons/icon-maskable-512.png")

    print("icons written")
