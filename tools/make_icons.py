"""Рисует иконки «Пробки» без внешних зависимостей, кроме Pillow.

Запуск: python tools/make_icons.py
Результат: assets/icon-192.png, assets/icon-512.png, assets/icon-maskable-512.png
"""

from __future__ import annotations

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
S = 1024
rng = random.Random(7)


def rounded(draw: ImageDraw.ImageDraw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def make_base() -> Image.Image:
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # тёмная ореховая рама
    rounded(d, (18, 18, S - 18, S - 18), 190, (46, 31, 21, 255))
    rounded(d, (40, 40, S - 40, S - 40), 170, (77, 52, 35, 255))
    # пробка
    rounded(d, (72, 72, S - 72, S - 72), 148, (190, 139, 94, 255))
    # фактура пробки
    for _ in range(2600):
        x = rng.randint(84, S - 85)
        y = rng.randint(84, S - 85)
        r = rng.randint(0, 2)
        tone = rng.choice([(160, 111, 72), (181, 129, 84), (173, 122, 80), (199, 150, 103)])
        a = rng.randint(12, 38)
        d.ellipse((x - r, y - r, x + r, y + r), fill=(*tone, a))
    # лёгкая тень внутри
    shine = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shine)
    sd.ellipse((-S * 0.35, -S * 0.55, S * 1.1, S * 0.22), fill=(255, 240, 210, 22))
    img = Image.alpha_composite(img, shine)
    return img


def note(base: Image.Image, size, center, angle, fill, ink=(60, 45, 24, 255), lines=3):
    w, h = size
    layer = Image.new("RGBA", (w + 80, h + 80), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    x0, y0 = 40, 40
    # тень
    sh = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((x0 + 8, y0 + 16, x0 + w + 8, y0 + h + 16), radius=8, fill=(40, 23, 10, 80))
    sh = sh.filter(ImageFilter.GaussianBlur(12))
    layer = Image.alpha_composite(layer, sh)
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle((x0, y0, x0 + w, y0 + h), radius=5, fill=fill)
    # скотч
    tape_w, tape_h = int(w * 0.44), 38
    tx = x0 + (w - tape_w) // 2
    d.rounded_rectangle((tx, y0 - 9, tx + tape_w, y0 + tape_h - 9), radius=2, fill=(244, 230, 194, 170))
    d.line((tx + 5, y0 + 4, tx + tape_w - 5, y0 + 4), fill=(255, 250, 230, 80), width=2)
    # строки
    pad = int(w * 0.13)
    for i in range(lines):
        yy = y0 + pad + i * int(h * 0.17)
        ww = int(w * (0.72 if i % 3 else 0.5))
        d.rounded_rectangle((x0 + pad, yy, x0 + pad + ww, yy + 9), radius=4, fill=(*ink[:3], 105))
    # загнутый уголок
    d.polygon([(x0 + w - 42, y0 + h), (x0 + w, y0 + h - 42), (x0 + w, y0 + h)], fill=(0, 0, 0, 22))
    layer = layer.rotate(angle, resample=Image.BICUBIC, expand=False, center=(layer.width // 2, layer.height // 2))
    ox = int(center[0] - layer.width / 2)
    oy = int(center[1] - layer.height / 2)
    base.alpha_composite(layer, (ox, oy))


def make_icon(maskable: bool = False) -> Image.Image:
    img = make_base()
    if maskable:
        # безопасная зона: содержимое ближе к центру
        shift = 0
    else:
        shift = 0
    note(img, (330, 380), (365 + shift, 470), 8, (255, 226, 132, 255), lines=3)
    note(img, (360, 400), (640 - shift, 540), -7, (190, 222, 242, 255), lines=3)
    note(img, (270, 315), (505, 690), 4, (249, 188, 199, 255), lines=2)
    # канцелярская кнопка на центральной записке
    d = ImageDraw.Draw(img)
    c = (640 - shift, 405)
    d.ellipse((c[0] - 26, c[1] - 26, c[0] + 26, c[1] + 26), fill=(138, 102, 49, 255))
    d.ellipse((c[0] - 17, c[1] - 19, c[0] + 13, c[1] + 9), fill=(214, 174, 109, 255))
    d.ellipse((c[0] - 7, c[1] - 14, c[0] + 5, c[1] - 2), fill=(248, 225, 182, 190))
    # небольшая тень по краю
    edge = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(edge).rounded_rectangle((72, 72, S - 72, S - 72), radius=148, outline=(40, 23, 10, 90), width=8)
    img = Image.alpha_composite(img, edge)
    return img


def save(img: Image.Image, path: Path, size: int):
    img.resize((size, size), Image.LANCZOS).save(path, "PNG", optimize=True)


def main():
    ASSETS.mkdir(parents=True, exist_ok=True)
    icon = make_icon()
    save(icon, ASSETS / "icon-512.png", 512)
    save(icon, ASSETS / "icon-192.png", 192)
    # maskable: тот же рисунок; содержимое уже внутри безопасной зоны
    save(icon, ASSETS / "icon-maskable-512.png", 512)
    print("Готово: assets/icon-192.png, assets/icon-512.png, assets/icon-maskable-512.png")


if __name__ == "__main__":
    main()
