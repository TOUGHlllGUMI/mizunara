"""Remove white background from the pasted 王将 koma artwork and rebuild the app icon set."""
from collections import deque
from PIL import Image, ImageFilter

SRC = r"C:\Users\user\OneDrive\ドキュメント\画像\Screenshots\スクリーンショット 2026-08-11 160209.png"


def flood_remove_bg(img, thresh=24):
    img = img.convert("RGBA")
    w, h = img.size
    px = img.load()
    visited = bytearray(w * h)
    q = deque()

    def bg_like(c1, c2):
        return max(abs(c1[0] - c2[0]), abs(c1[1] - c2[1]), abs(c1[2] - c2[2])) <= thresh

    for x in range(w):
        for y in (0, h - 1):
            idx = y * w + x
            if not visited[idx]:
                q.append((x, y)); visited[idx] = 1
    for y in range(h):
        for x in (0, w - 1):
            idx = y * w + x
            if not visited[idx]:
                q.append((x, y)); visited[idx] = 1

    seed_color = px[0, 0]
    alpha = bytearray([255]) * (w * h)

    while q:
        x, y = q.popleft()
        idx = y * w + x
        c = px[x, y]
        if not bg_like(c, seed_color):
            continue
        alpha[idx] = 0
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h:
                nidx = ny * w + nx
                if not visited[nidx]:
                    visited[nidx] = 1
                    q.append((nx, ny))

    out = Image.new("RGBA", (w, h))
    for y in range(h):
        for x in range(w):
            idx = y * w + x
            r, g, b, a = px[x, y]
            out.putpixel((x, y), (r, g, b, alpha[idx]))

    # soften the cut edge slightly
    r, g, b, a = out.split()
    a = a.filter(ImageFilter.GaussianBlur(0.6))
    out = Image.merge("RGBA", (r, g, b, a))
    return out


def bbox_with_margin(img, margin_frac=0.04):
    bbox = img.split()[3].getbbox()
    x0, y0, x1, y1 = bbox
    w, h = img.size
    mx = int((x1 - x0) * margin_frac)
    my = int((y1 - y0) * margin_frac)
    x0 = max(0, x0 - mx); y0 = max(0, y0 - my)
    x1 = min(w, x1 + mx); y1 = min(h, y1 + my)
    return img.crop((x0, y0, x1, y1))


def square_canvas(img, size, pad_frac=0.06):
    img = img.copy()
    w, h = img.size
    scale = (size * (1 - 2 * pad_frac)) / max(w, h)
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    img = img.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(img, ((size - nw) // 2, (size - nh) // 2), img)
    return canvas


def rounded_mask(size, radius):
    from PIL import ImageDraw
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def wood_bg(size):
    import math
    img = Image.new("RGB", (size, size))
    px = img.load()
    top = (58, 38, 20); bottom = (32, 20, 11)
    for y in range(size):
        t = y / (size - 1)
        r = int(top[0] + (bottom[0] - top[0]) * t)
        g = int(top[1] + (bottom[1] - top[1]) * t)
        b = int(top[2] + (bottom[2] - top[2]) * t)
        for x in range(size):
            px[x, y] = (r, g, b)
    return img.convert("RGBA")


if __name__ == "__main__":
    raw = Image.open(SRC)
    cut = flood_remove_bg(raw)
    cut = bbox_with_margin(cut)
    cut.save("icons/koma-cutout.png")

    # icon-512 / icon-192: koma artwork centered on the app's wood background, rounded square
    for size, radius, name in [(512, 96, "icons/icon-512.png"), (192, 36, "icons/icon-192.png")]:
        bg = wood_bg(size)
        koma = square_canvas(cut, size, pad_frac=0.05)
        bg.alpha_composite(koma)
        mask = rounded_mask(size, radius)
        out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        out.paste(bg, (0, 0), mask)
        out.save(name)

    # maskable icon: extra safe-zone padding (icon content within ~80% center circle)
    bg = wood_bg(512)
    koma = square_canvas(cut, 512, pad_frac=0.16)
    bg.alpha_composite(koma)
    bg.save("icons/icon-maskable-512.png")

    print("done", cut.size)
