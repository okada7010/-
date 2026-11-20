# -*- coding: utf-8 -*-
"""Rainmeter 用パッケージ ClaudeMonitor_v1.rmskin を作る。
- スキン ini は build_skin.py で生成（UTF-16 LE）
- @Resources に集計プログラムと bat を入れる（moving_desktop/ 直下のものを使う）
.rmskin = ZIP ＋ 末尾 16 バイト（ZIP のサイズ 8 バイト ＋ フラグ 1 バイト ＋ "RMSKIN\\0" 7 バイト）
使い方: python package.py <出力フォルダ>
"""
import io
import os
import struct
import subprocess
import sys
import tempfile
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
RM = os.path.dirname(HERE)                 # moving_desktop/rainmeter
SRC = os.path.dirname(RM)                  # moving_desktop
OUT = sys.argv[1] if len(sys.argv) > 1 else RM
VERSION = "1.5"

ini = os.path.join(RM, "ClaudeMonitor", "ClaudeMonitor.ini")
alice = os.path.join(RM, "ClaudeMonitor", "Alice", "Alice.ini")
subprocess.run([sys.executable, os.path.join(HERE, "build_skin.py"), ini], check=True)
subprocess.run([sys.executable, os.path.join(HERE, "build_alice.py"), alice], check=True)
sprites = tempfile.mkdtemp()
subprocess.run([sys.executable, os.path.join(HERE, "make_sprites.py"), sprites], check=True)

resources = ["ai_usage_collector.py", "ai_usage_start.bat", "ai_usage_stop.bat", "ai_usage_check.bat",
             "ai_usage_autostart_on.bat", "ai_usage_autostart_off.bat"]
rmskin_ini = (
    "[rmskin]\r\nName=Claude Monitor\r\nAuthor=APT\r\nVersion=%s\r\n"
    "MinimumRainmeter=4.5.0\r\nMinimumWindows=10.0\r\n"
    "LoadType=Skin\r\nLoad=ClaudeMonitor\\ClaudeMonitor.ini\r\n" % VERSION
)

buf = io.BytesIO()
with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("RMSKIN.ini", rmskin_ini)
    z.write(ini, "Skins/ClaudeMonitor/ClaudeMonitor.ini")
    z.write(alice, "Skins/ClaudeMonitor/Alice/Alice.ini")
    z.writestr("Skins/ClaudeMonitor/@Resources/state.inc", "[Variables]\r\nAliceShown=0\r\n")
    for f in sorted(os.listdir(sprites)):
        z.write(os.path.join(sprites, f), "Skins/ClaudeMonitor/@Resources/alice/" + f)
    for f in resources:
        z.write(os.path.join(SRC, f), "Skins/ClaudeMonitor/@Resources/" + f)
data = buf.getvalue()
path = os.path.join(OUT, f"ClaudeMonitor_v{VERSION}.rmskin")
with open(path, "wb") as f:
    # 末尾 16 バイト: ZIP のサイズ(int64) + フラグ(1バイト) + "RMSKIN\\0"(7バイト)
    f.write(data + struct.pack("<q", len(data)) + b"\x00" + b"RMSKIN\x00")
print("written", path, len(data))
