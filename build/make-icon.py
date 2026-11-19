"""画桌伴的 icon.ico：墨色圆角方块，两只米白圆眼睛（小岛的脸）。

一次性画图脚本，不进产品依赖；跑法：python build/make-icon.py（要 Pillow）
- 每一档都按 8 倍大画好再缩下来，边缘不糊也不锯齿；
- 颜色跟小岛一样：墨 #1f1d1a、眼睛 #f5f1e8；浅色、深色任务栏上都看得清；
- 写到 build/icon.ico，再原样拷一份到 app/assets/icon.ico（两份是同一个文件）。

拼完读回来核：每一档都在，像素跟画出来的一致。以后换图标改下面的尺寸和比例再跑。
"""
import hashlib
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
OUT = HERE / "icon.ico"
RUNTIME_OUT = HERE.parent / "app" / "assets" / "icon.ico"

# Windows 各种缩放下会挑的那几档：100% 的 16/32、125% 的 20/40、150% 的 24/48、200% 的 32/64，大图 256
SIZES = (16, 20, 24, 32, 40, 48, 64, 256)
INK = (31, 29, 26, 255)
EYE = (245, 241, 232, 255)
SCALE = 8

# 比例都按方块边长算
MARGIN = 0.0625  # 四周留白
RADIUS = 0.24    # 圆角
EYE_R = 0.12     # 眼睛半径
EYE_GAP = 0.21   # 眼睛圆心离中线
EYE_Y = 0.5      # 眼睛圆心的高度


def draw(size):
    big = size * SCALE
    im = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    m = max(SCALE, round(big * MARGIN))
    tile = big - 2 * m
    d.rounded_rectangle((m, m, big - m - 1, big - m - 1), radius=round(tile * RADIUS), fill=INK)
    r = tile * EYE_R
    cy = m + tile * EYE_Y
    for side in (-1, 1):
        cx = big / 2 + side * tile * EYE_GAP
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=EYE)
    return im.resize((size, size), Image.LANCZOS)


def build():
    frames = {s: draw(s) for s in SIZES}
    big = frames[256]
    big.save(OUT, format="ICO", sizes=[(s, s) for s in SIZES], append_images=[frames[s] for s in SIZES if s != 256])
    return frames


def verify(frames):
    ico = Image.open(OUT)
    got = sorted(w for (w, h) in ico.info["sizes"] if w == h)
    assert got == list(SIZES), f"ico 里的尺寸不对: {got}"
    for size in SIZES:
        ico.size = (size, size)
        ico.load()
        back = ico.copy()
        assert back.mode == "RGBA" and back.size == (size, size), (size, back.mode, back.size)
        assert back.tobytes() == frames[size].tobytes(), f"{size} 档像素跟画的不一致"
    print(f"读回核对通过：{'/'.join(str(s) for s in got)}，像素逐档一致")


def main():
    frames = build()
    verify(frames)
    RUNTIME_OUT.write_bytes(OUT.read_bytes())
    digest = hashlib.sha256(OUT.read_bytes()).hexdigest()
    print(f"写出 {OUT} 和 {RUNTIME_OUT}（同一份），SHA-256 {digest}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main()
