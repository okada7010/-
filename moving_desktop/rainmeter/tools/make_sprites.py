# -*- coding: utf-8 -*-
"""アリス風の女の子（オリジナルのドット絵）とキラキラの PNG を作る。
Lively 版（index.html）と同じドット絵。
使い方: python make_sprites.py <出力フォルダ>
  girl_<向き>_<ポーズ>.png … 向き 0=左 1=右、ポーズ 0=立ち 1,2=歩き
  spark_<n>.png             … キラキラ（色違い 6 種）
"""
import os
import sys

from PIL import Image

DOT = 5  # 1 ドットの大きさ（px）
BODY = [
    "....hhhhhh....",
    "...bbbbbbbb...",
    "..hhhhhhhhhh..",
    "..hhsssssshh..",
    "..hhsesssesh..",
    "..hhsssmsssh..",
    "..hhhssssshh..",
    "..hHhdaaadhHh.",
    "...hdaaaaadh..",
    "...ddaaaaadd..",
    "..sddaaaaadds.",
    "...ddaaaaadd..",
    "..dddaaaaaddd.",
    ".ddddaaaaadddd",
    ".DdddAaaaAdddD",
    ".DDDDDDDDDDDD.",
]
LEGS = [
    ["....ww..ww....", "....ww..ww....", "....kk..kk...."],
    ["...ww....ww...", "..ww......ww..", "..kk......kk.."],
    [".....wwww.....", ".....ww.ww....", ".....kk.kk...."],
]
COL = {"h": "#ffd84d", "H": "#e0a82e", "b": "#4b4b66", "s": "#ffd9b8", "e": "#3b5bff",
       "m": "#ff7eb6", "d": "#4f8cff", "D": "#2f5fd0", "a": "#ffffff", "A": "#d8d8ee",
       "w": "#f2f2ff", "k": "#5b4b70"}
SPARK = ["#ff7eb6", "#ffd84d", "#7ee8ff", "#9dff7e", "#ffffff", "#c9a7ff"]


def rgba(hx):
    hx = hx.lstrip("#")
    return tuple(int(hx[i:i + 2], 16) for i in (0, 2, 4)) + (255,)


def girl(face, pose):
    rows = BODY + LEGS[pose]
    w = len(rows[0])
    img = Image.new("RGBA", (w * DOT, len(rows) * DOT), (0, 0, 0, 0))
    for r, row in enumerate(rows):
        for c in range(w):
            ch = row[c if face == 1 else w - 1 - c]
            if ch == ".":
                continue
            for y in range(DOT):
                for x in range(DOT):
                    img.putpixel((c * DOT + x, r * DOT + y), rgba(COL[ch]))
    return img


def spark(col):
    u = 3
    img = Image.new("RGBA", (3 * u, 3 * u), (0, 0, 0, 0))
    for cx, cy in ((1, 0), (0, 1), (1, 1), (2, 1), (1, 2)):
        for y in range(u):
            for x in range(u):
                img.putpixel((cx * u + x, cy * u + y), rgba(col))
    return img


def main(out):
    os.makedirs(out, exist_ok=True)
    for face in (0, 1):
        for pose in (0, 1, 2):
            girl(face, pose).save(os.path.join(out, f"girl_{face}_{pose}.png"))
    for i, c in enumerate(SPARK):
        spark(c).save(os.path.join(out, f"spark_{i}.png"))
    print("sprites ->", out)


if __name__ == "__main__":
    main(sys.argv[1])
