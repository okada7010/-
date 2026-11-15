# -*- coding: utf-8 -*-
"""
動くデスクトップ（ライブ壁紙＋システムモニター）

  ・背景：CPU負荷に応じて速さと色が変わるパーティクルアニメーション
  ・右側パネル：時計 / CPU / メモリ / ネット速度（↓受信 ↑送信）のゲージとグラフ

起動方法:
  python moving_desktop.py              … Windowsは壁紙モード（アイコンの裏で動く）、それ以外はウィンドウ
  python moving_desktop.py --window     … 通常ウィンドウで表示（Esc で終了）
  python moving_desktop.py --wallpaper  … 壁紙モードを強制

壁紙モードの終了:
  stop.bat を実行（同じフォルダに stop.flag を作成 → 1秒以内に終了し、元の壁紙に戻ります）

必要ライブラリ: psutil（pip install psutil）
"""
import argparse
import datetime
import math
import os
import platform
import random
import sys
import time
import tkinter as tk
import tkinter.font as tkfont
from collections import deque

import psutil

# ============================================================
# 設定（お好みで変更してください）
# ============================================================
FPS = 30                  # 描画フレームレート
STAT_INTERVAL_MS = 500    # 計測間隔（ミリ秒）
HISTORY_LEN = 120         # グラフの履歴点数（120点 × 0.5秒 = 60秒）
PARTICLE_COUNT = 70       # 背景パーティクル数
LINK_DIST = 150           # パーティクル同士を線で結ぶ距離（px, 1080p基準）
PANEL_SIDE = "right"      # パネル位置 "right" / "left"

# 色
BG_TOP = (8, 12, 28)
BG_BOTTOM = (18, 26, 54)
PANEL_BG = "#0d1530"
PANEL_EDGE = "#24345f"
TEXT = "#e6ecff"
SUBTEXT = "#8a97c0"
TRACK = "#1c2748"
C_CPU = "#38d6ff"
C_MEM = "#c77dff"
C_DOWN = "#4ade80"
C_UP = "#fb923c"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STOP_FLAG = os.path.join(BASE_DIR, "stop.flag")
LOG_FILE = os.path.join(BASE_DIR, "moving_desktop.log")


def log(msg):
    """pythonw では画面にエラーが出ないため、ログファイルに記録する"""
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(f"{datetime.datetime.now():%Y-%m-%d %H:%M:%S} {msg}\n")
    except Exception:
        pass


def _excepthook(etype, value, tb):
    import traceback
    log("ERROR\n" + "".join(traceback.format_exception(etype, value, tb)))


sys.excepthook = _excepthook
IS_WIN = platform.system() == "Windows"
WEEK_JA = "月火水木金土日"


# ============================================================
# ユーティリティ
# ============================================================
def lerp(a, b, t):
    return a + (b - a) * t


def rgb_hex(rgb):
    return "#%02x%02x%02x" % tuple(max(0, min(255, int(c))) for c in rgb)


def mix(c1, c2, t):
    return tuple(lerp(a, b, t) for a, b in zip(c1, c2))


def fmt_speed(bps):
    """bytes/sec → 見やすい表記"""
    bits = bps * 8
    if bits >= 1e9:
        return f"{bits / 1e9:.2f} Gbps"
    if bits >= 1e6:
        return f"{bits / 1e6:.1f} Mbps"
    if bits >= 1e3:
        return f"{bits / 1e3:.0f} kbps"
    return f"{bits:.0f} bps"


def fmt_bytes(n):
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} PB"


def pick_font(root):
    fams = set(tkfont.families(root))
    for f in ("Yu Gothic UI", "Meiryo UI", "Meiryo", "Noto Sans CJK JP", "Noto Sans JP",
              "Segoe UI", "DejaVu Sans"):
        if f in fams:
            return f
    return "TkDefaultFont"


# ============================================================
# Windows：壁紙（デスクトップアイコンの裏）への埋め込み
# ============================================================
class WallpaperHost:
    def __init__(self, method="auto"):
        import ctypes
        from ctypes import wintypes
        self.ct = ctypes
        self.wt = wintypes
        self.u32 = ctypes.windll.user32
        self.embedded = False
        self.keep_bottom = False
        self.wallpaper_path = None
        self.method = method

    @staticmethod
    def set_dpi_aware():
        try:
            import ctypes
            ctypes.windll.shcore.SetProcessDpiAwareness(2)
        except Exception:
            try:
                import ctypes
                ctypes.windll.user32.SetProcessDPIAware()
            except Exception:
                pass

    def virtual_screen(self):
        g = self.u32.GetSystemMetrics
        # SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, SM_CXSCREEN, SM_CYSCREEN
        return g(76), g(77), g(0), g(1)

    def _setup_api(self):
        u32, wt = self.u32, self.wt
        H = wt.HWND
        u32.FindWindowW.restype = H
        u32.FindWindowExW.restype = H
        u32.FindWindowExW.argtypes = [H, H, wt.LPCWSTR, wt.LPCWSTR]
        u32.GetParent.restype = H
        u32.GetParent.argtypes = [H]
        u32.SetParent.restype = H
        u32.SetParent.argtypes = [H, H]
        u32.SetWindowPos.argtypes = [H, H, self.ct.c_int, self.ct.c_int, self.ct.c_int,
                                     self.ct.c_int, wt.UINT]
        u32.MoveWindow.argtypes = [H, self.ct.c_int, self.ct.c_int, self.ct.c_int, self.ct.c_int,
                                   wt.BOOL]
        u32.SendMessageTimeoutW.argtypes = [H, wt.UINT, wt.WPARAM, wt.LPARAM, wt.UINT,
                                            wt.UINT, self.ct.POINTER(self.ct.c_size_t)]
        u32.SetLayeredWindowAttributes.argtypes = [H, wt.DWORD, wt.BYTE, wt.DWORD]
        if self.ct.sizeof(self.ct.c_void_p) == 8:
            u32.GetWindowLongPtrW.restype = self.ct.c_ssize_t
            u32.GetWindowLongPtrW.argtypes = [H, self.ct.c_int]
            u32.SetWindowLongPtrW.argtypes = [H, self.ct.c_int, self.ct.c_ssize_t]
            self.get_style = u32.GetWindowLongPtrW
            self.set_style = u32.SetWindowLongPtrW
        else:
            self.get_style = u32.GetWindowLongW
            self.set_style = u32.SetWindowLongW

    def _find_targets(self):
        """(方式, progman, defview, workerw) を返す"""
        u32, ct, wt = self.u32, self.ct, self.wt
        progman = u32.FindWindowW("Progman", None)
        if not progman:
            return None, None, None, None
        # Progman に 0x052C を送ると、壁紙描画用の WorkerW が生成される
        res = ct.c_size_t()
        u32.SendMessageTimeoutW(progman, 0x052C, 0xD, 0x1, 0, 1000, ct.byref(res))
        u32.SendMessageTimeoutW(progman, 0x052C, 0, 0, 0, 1000, ct.byref(res))

        # Windows 11 24H2 以降：SHELLDLL_DefView と WorkerW が Progman の子
        defview = u32.FindWindowExW(progman, None, "SHELLDLL_DefView", None)
        workerw = u32.FindWindowExW(progman, None, "WorkerW", None)
        if defview and workerw:
            return "24H2", progman, defview, workerw

        # 従来方式：SHELLDLL_DefView を持つトップレベル窓の次の WorkerW
        found = {"w": None}
        enum_proc = ct.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)

        def cb(hwnd, _):
            if u32.FindWindowExW(hwnd, None, "SHELLDLL_DefView", None):
                w = u32.FindWindowExW(None, hwnd, "WorkerW", None)
                if w:
                    found["w"] = w
            return True

        u32.EnumWindows(enum_proc(cb), 0)
        if found["w"]:
            return "classic", progman, None, found["w"]
        return None, progman, None, None

    def embed(self, root):
        u32, ct = self.u32, self.ct
        self._setup_api()
        # 現在の壁紙パス（終了時に再描画するため）
        buf = ct.create_unicode_buffer(520)
        if u32.SystemParametersInfoW(0x0073, 520, buf, 0):  # SPI_GETDESKWALLPAPER
            self.wallpaper_path = buf.value

        root.update_idletasks()
        hwnd = u32.GetParent(root.winfo_id()) or root.winfo_id()
        vx, vy, w, h = self.virtual_screen()
        mode, progman, defview, workerw = self._find_targets()
        log(f"embed: mode={mode} progman={progman} defview={defview} workerw={workerw} "
            f"screen=({vx},{vy},{w},{h})")
        GWL_STYLE, GWL_EXSTYLE = -16, -20
        WS_CHILD, WS_POPUP = 0x40000000, 0x80000000
        WS_EX_LAYERED = 0x00080000
        SWP_NOMOVE, SWP_NOSIZE, SWP_NOACTIVATE = 0x2, 0x1, 0x10
        method = self.method
        if method == "auto":
            method = "progman" if mode == "24H2" else "classic"
        log(f"embed: method={method}")
        try:
            if mode == "24H2" and method in ("progman", "progman-nolayer"):
                # 子ウィンドウにして Progman の中で
                # 「アイコン(DefView)の下・壁紙(WorkerW)の上」に置く
                st = self.get_style(hwnd, GWL_STYLE)
                self.set_style(hwnd, GWL_STYLE, (st & ~WS_POPUP) | WS_CHILD)
                if method == "progman":
                    ex = self.get_style(hwnd, GWL_EXSTYLE)
                    self.set_style(hwnd, GWL_EXSTYLE, ex | WS_EX_LAYERED)
                    u32.SetLayeredWindowAttributes(hwnd, 0, 255, 0x2)  # LWA_ALPHA
                u32.SetParent(hwnd, progman)
                u32.MoveWindow(hwnd, -vx, -vy, w, h, True)
                u32.SetWindowPos(hwnd, defview, 0, 0, 0, 0,
                                 SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE)
                u32.SetWindowPos(workerw, hwnd, 0, 0, 0, 0,
                                 SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE)
                self.embedded = True
            elif mode == "24H2" and method == "workerw":
                # 壁紙を描いている WorkerW の子にする
                st = self.get_style(hwnd, GWL_STYLE)
                self.set_style(hwnd, GWL_STYLE, (st & ~WS_POPUP) | WS_CHILD)
                u32.SetParent(hwnd, workerw)
                u32.MoveWindow(hwnd, 0, 0, w, h, True)
                self.embedded = True
            elif mode == "classic":
                u32.SetParent(hwnd, workerw)
                # WorkerW のクライアント座標は仮想スクリーン左上が原点 → プライマリモニタへ配置
                u32.MoveWindow(hwnd, -vx, -vy, w, h, True)
                self.embedded = True
        except Exception as e:
            log(f"embed failed: {e!r}")
            self.embedded = False
        if not self.embedded:
            self.fallback(root)
        log(f"embedded={self.embedded}")
        root.after(1500, lambda: self.dump(root))
        return self.embedded

    def dump(self, root):
        """診断用：自分の窓の状態と、Progman の子ウィンドウの重なり順をログに出す"""
        try:
            u32, ct, wt = self.u32, self.ct, self.wt
            hwnd = u32.GetParent(root.winfo_id()) or root.winfo_id()
            rc = wt.RECT()
            u32.GetWindowRect(hwnd, ct.byref(rc))
            log(f"self: hwnd={hwnd} visible={u32.IsWindowVisible(hwnd)} "
                f"rect=({rc.left},{rc.top},{rc.right},{rc.bottom}) parent={u32.GetParent(hwnd)}")
            progman = u32.FindWindowW("Progman", None)
            u32.GetWindow.restype = wt.HWND
            u32.GetWindow.argtypes = [wt.HWND, wt.UINT]
            child = u32.GetWindow(progman, 5)  # GW_CHILD（重なり順の上から）
            order = []
            buf = ct.create_unicode_buffer(64)
            while child:
                u32.GetClassNameW(child, buf, 64)
                order.append(f"{buf.value}({child},vis={u32.IsWindowVisible(child)})")
                child = u32.GetWindow(child, 2)  # GW_HWNDNEXT
            log("progman children (top->bottom): " + " > ".join(order))
        except Exception as e:
            log(f"dump failed: {e!r}")

    def fallback(self, root):
        """埋め込みできない場合：最背面の全画面ウィンドウとして表示"""
        try:
            self._setup_api()
            hwnd = self.u32.GetParent(root.winfo_id()) or root.winfo_id()
            if self.u32.GetParent(hwnd):
                self.u32.SetParent(hwnd, None)
            _, _, w, h = self.virtual_screen()
            self.u32.SetWindowPos(hwnd, 1, 0, 0, w, h, 0x0010)  # HWND_BOTTOM
            self.keep_bottom = True
        except Exception as e:
            log(f"fallback failed: {e!r}")

    def restore_wallpaper(self):
        # 元の壁紙を再設定してデスクトップを再描画
        # 埋め込んだ場合だけ、取得できた壁紙パスで再設定する（未取得時に壁紙を消さないため）
        if not self.embedded or self.wallpaper_path is None:
            return
        try:
            self.u32.SystemParametersInfoW(0x0014, 0, self.wallpaper_path, 0)  # SPI_SETDESKWALLPAPER
        except Exception:
            pass


# ============================================================
# 本体
# ============================================================
class MovingDesktop:
    def __init__(self, root, width, height):
        self.root = root
        self.W, self.H = width, height
        self.s = height / 1080.0
        self.font = pick_font(root)

        self.cv = tk.Canvas(root, width=width, height=height, highlightthickness=0, bd=0,
                            bg=rgb_hex(BG_TOP))
        self.cv.pack(fill="both", expand=True)

        # 計測データ
        self.cpu_hist = deque([0.0] * HISTORY_LEN, maxlen=HISTORY_LEN)
        self.mem_hist = deque([0.0] * HISTORY_LEN, maxlen=HISTORY_LEN)
        self.down_hist = deque([0.0] * HISTORY_LEN, maxlen=HISTORY_LEN)
        self.up_hist = deque([0.0] * HISTORY_LEN, maxlen=HISTORY_LEN)
        self.cpu = self.mem = 0.0
        self.down = self.up = 0.0
        self.cores = psutil.cpu_percent(percpu=True)
        self.disp = {"cpu": 0.0, "mem": 0.0, "net": 0.0}  # ゲージ表示用（なめらか補間）
        net = psutil.net_io_counters()
        self.last_net = (net.bytes_recv, net.bytes_sent, time.time())
        psutil.cpu_percent(None)
        self.boot = psutil.boot_time()

        self._build_background()
        self._build_particles()
        self._layout_panel()
        self._build_panel()

        self.root.after(100, self.update_stats)
        self.root.after(0, self.animate)
        self.root.after(1000, self.check_stop)

    # ---------- 背景 ----------
    def _build_background(self):
        steps = 64
        for i in range(steps):
            y0 = self.H * i / steps
            y1 = self.H * (i + 1) / steps + 1
            c = rgb_hex(mix(BG_TOP, BG_BOTTOM, i / (steps - 1)))
            self.cv.create_rectangle(0, y0, self.W, y1, fill=c, outline="", tags="bg")

    def _build_particles(self):
        self.parts = []
        for _ in range(PARTICLE_COUNT):
            r = random.uniform(2.0, 4.5) * self.s
            p = {
                "x": random.uniform(0, self.W), "y": random.uniform(0, self.H),
                "vx": random.uniform(-1, 1), "vy": random.uniform(-1, 1), "r": r,
            }
            p["id"] = self.cv.create_oval(0, 0, 0, 0, fill=C_CPU, outline="", tags="part")
            self.parts.append(p)
        self.link_dist = LINK_DIST * self.s

    # ---------- パネル ----------
    def _layout_panel(self):
        s = self.s
        pw = int(460 * s)
        margin = int(40 * s)
        if PANEL_SIDE == "left":
            self.px0 = margin
        else:
            self.px0 = self.W - pw - margin
        self.px1 = self.px0 + pw
        self.py0 = int(40 * s)
        self.py1 = self.H - int(80 * s)  # タスクバー分を空ける
        self.pad = int(26 * s)

    def F(self, size, weight="normal"):
        return (self.font, max(7, int(size * self.s)), weight)

    def _build_panel(self):
        cv, s = self.cv, self.s
        x0, x1, y0, y1, pad = self.px0, self.px1, self.py0, self.py1, self.pad
        self.panel_rect = self._round_rect(x0, y0, x1, y1, int(22 * s), fill=PANEL_BG,
                                           outline=PANEL_EDGE, width=max(1, int(2 * s)),
                                           tags="panel")
        ix0, ix1 = x0 + pad, x1 - pad
        y = y0 + pad

        # 時計
        self.t_time = cv.create_text(ix0, y, anchor="nw", text="", fill=TEXT,
                                     font=self.F(54, "bold"), tags="panel")
        y += int(92 * s)
        self.t_date = cv.create_text(ix0, y, anchor="nw", text="", fill=SUBTEXT,
                                     font=self.F(16), tags="panel")
        self.t_uptime = cv.create_text(ix1, y, anchor="ne", text="", fill=SUBTEXT,
                                       font=self.F(12), tags="panel")
        y += int(46 * s)

        # ゲージ ×3
        gw = (ix1 - ix0) / 3
        gr = int(min(gw * 0.42, 62 * s))
        gy = y + gr + int(6 * s)
        self.gauges = {}
        for i, (key, label, col) in enumerate((("cpu", "CPU", C_CPU), ("mem", "メモリ", C_MEM),
                                              ("net", "ネット", C_DOWN))):
            cx = ix0 + gw * (i + 0.5)
            self.gauges[key] = self._make_gauge(cx, gy, gr, label, col)
        y = gy + gr + int(40 * s)

        self.t_mem_detail = cv.create_text(ix0, y, anchor="nw", text="", fill=SUBTEXT,
                                           font=self.F(12), tags="panel")
        self.t_cpu_detail = cv.create_text(ix1, y, anchor="ne", text="", fill=SUBTEXT,
                                           font=self.F(12), tags="panel")
        y += int(34 * s)

        # CPU / メモリ グラフ
        y = self._section_title(ix0, ix1, y, "CPU / メモリ  (60秒)",
                                [("CPU", C_CPU), ("MEM", C_MEM)])
        gh = int(110 * s)
        self.g1 = (ix0, y, ix1, y + gh)
        self._graph_frame(self.g1)
        self.l_cpu = cv.create_line(0, 0, 0, 0, fill=C_CPU, width=max(1, int(2 * s)),
                                    smooth=True, tags="panel")
        self.l_mem = cv.create_line(0, 0, 0, 0, fill=C_MEM, width=max(1, int(2 * s)),
                                    smooth=True, tags="panel")
        y += gh + int(24 * s)

        # ネットワーク グラフ
        y = self._section_title(ix0, ix1, y, "ネットワーク  (60秒)",
                                [("↓受信", C_DOWN), ("↑送信", C_UP)])
        self.g2 = (ix0, y, ix1, y + gh)
        self._graph_frame(self.g2)
        self.l_down = cv.create_line(0, 0, 0, 0, fill=C_DOWN, width=max(1, int(2 * s)),
                                     smooth=True, tags="panel")
        self.l_up = cv.create_line(0, 0, 0, 0, fill=C_UP, width=max(1, int(2 * s)),
                                   smooth=True, tags="panel")
        self.t_netmax = cv.create_text(ix1 - int(6 * s), y + int(4 * s), anchor="ne", text="",
                                       fill=SUBTEXT, font=self.F(10), tags="panel")
        y += gh + int(10 * s)
        self.t_down = cv.create_text(ix0, y, anchor="nw", text="", fill=C_DOWN,
                                     font=self.F(17, "bold"), tags="panel")
        self.t_up = cv.create_text((ix0 + ix1) / 2, y, anchor="nw", text="", fill=C_UP,
                                   font=self.F(17, "bold"), tags="panel")
        y += int(32 * s)
        self.t_nettotal = cv.create_text(ix0, y, anchor="nw", text="", fill=SUBTEXT,
                                         font=self.F(11), tags="panel")
        y += int(34 * s)

        # コア別
        self.t_core_title = cv.create_text(ix0, y, anchor="nw", text="コア別使用率",
                                           fill=TEXT, font=self.F(13, "bold"), tags="panel")
        y += int(28 * s)
        n = len(self.cores)
        avail_h = max(int(30 * s), (y1 - pad) - y)
        cols = max(1, min(n, 16))
        rows = math.ceil(n / cols)
        gap = max(2, int(4 * s))
        bw = ((ix1 - ix0) - gap * (cols - 1)) / cols
        bh = min(int(70 * s), (avail_h - gap * (rows - 1)) / rows)
        self.core_bars = []
        for i in range(n):
            r_, c_ = divmod(i, cols)
            bx0 = ix0 + c_ * (bw + gap)
            by1 = y + (r_ + 1) * bh + r_ * gap
            by0 = by1 - bh
            cv.create_rectangle(bx0, by0, bx0 + bw, by1, fill=TRACK, outline="", tags="panel")
            bar = cv.create_rectangle(bx0, by1, bx0 + bw, by1, fill=C_CPU, outline="",
                                      tags="panel")
            self.core_bars.append((bar, bx0, by0, bx0 + bw, by1))
        # パネルの高さを中身に合わせる
        bottom = y + rows * bh + (rows - 1) * gap + pad
        if bottom < y1:
            self.cv.coords(self.panel_rect, *self._round_pts(x0, y0, x1, bottom, int(22 * s)))

    def _section_title(self, ix0, ix1, y, title, legends):
        cv, s = self.cv, self.s
        cv.create_text(ix0, y, anchor="nw", text=title, fill=TEXT, font=self.F(13, "bold"),
                       tags="panel")
        x = ix1
        for label, col in reversed(legends):
            t = cv.create_text(x, y + int(2 * s), anchor="ne", text=label, fill=col,
                               font=self.F(11), tags="panel")
            bb = cv.bbox(t)
            x = bb[0] - int(14 * s)
        return y + int(28 * s)

    def _graph_frame(self, box):
        x0, y0, x1, y1 = box
        self.cv.create_rectangle(x0, y0, x1, y1, fill="#0a1026", outline=PANEL_EDGE,
                                 tags="panel")
        for k in (1, 2, 3):
            yy = y0 + (y1 - y0) * k / 4
            self.cv.create_line(x0, yy, x1, yy, fill="#16203f", dash=(2, 4), tags="panel")

    def _make_gauge(self, cx, cy, r, label, col):
        cv, s = self.cv, self.s
        w = max(4, int(11 * s))
        box = (cx - r, cy - r, cx + r, cy + r)
        cv.create_arc(*box, start=-45, extent=270, style="arc", outline=TRACK, width=w,
                      tags="panel")
        arc = cv.create_arc(*box, start=225, extent=0, style="arc", outline=col, width=w,
                            tags="panel")
        val = cv.create_text(cx, cy - int(4 * s), text="0", fill=TEXT,
                             font=self.F(22, "bold"), tags="panel")
        unit = cv.create_text(cx, cy + int(22 * s), text="%", fill=SUBTEXT,
                              font=self.F(10), tags="panel")
        cv.create_text(cx, cy + r + int(6 * s), text=label, fill=col, font=self.F(13, "bold"),
                       tags="panel")
        return {"arc": arc, "val": val, "unit": unit}

    @staticmethod
    def _round_pts(x0, y0, x1, y1, r):
        return [x0 + r, y0, x1 - r, y0, x1, y0, x1, y0 + r, x1, y1 - r, x1, y1,
                x1 - r, y1, x0 + r, y1, x0, y1, x0, y1 - r, x0, y0 + r, x0, y0]

    def _round_rect(self, x0, y0, x1, y1, r, **kw):
        return self.cv.create_polygon(self._round_pts(x0, y0, x1, y1, r), smooth=True, **kw)

    # ---------- 計測 ----------
    def update_stats(self):
        try:
            self.cpu = psutil.cpu_percent(None)
            self.cores = psutil.cpu_percent(percpu=True)
            vm = psutil.virtual_memory()
            self.mem = vm.percent
            self.vm = vm
            net = psutil.net_io_counters()
            now = time.time()
            r0, s0, t0 = self.last_net
            dt = max(1e-3, now - t0)
            self.down = max(0.0, (net.bytes_recv - r0) / dt)
            self.up = max(0.0, (net.bytes_sent - s0) / dt)
            self.last_net = (net.bytes_recv, net.bytes_sent, now)
            self.net_total = (net.bytes_recv, net.bytes_sent)

            self.cpu_hist.append(self.cpu)
            self.mem_hist.append(self.mem)
            self.down_hist.append(self.down)
            self.up_hist.append(self.up)
            self._draw_stats()
        except Exception as e:  # 計測失敗でも止めない
            print("stat error:", e, file=sys.stderr)
        self.root.after(STAT_INTERVAL_MS, self.update_stats)

    def _net_scale(self):
        peak = max(max(self.down_hist), max(self.up_hist), 1.0)
        # 1-2-5 刻みのきりのいい最大値（bytes/s）
        bits = peak * 8
        mag = 10 ** math.floor(math.log10(bits))
        for m in (1, 2, 5, 10):
            if bits <= m * mag:
                return m * mag / 8
        return 10 * mag / 8

    def _draw_stats(self):
        cv = self.cv
        vm = self.vm
        cv.itemconfigure(self.t_mem_detail,
                         text=f"メモリ {fmt_bytes(vm.used)} / {fmt_bytes(vm.total)}")
        freq = psutil.cpu_freq() if hasattr(psutil, "cpu_freq") else None
        ftxt = f"  {freq.current / 1000:.2f} GHz" if freq and freq.current else ""
        cv.itemconfigure(self.t_cpu_detail, text=f"{len(self.cores)} スレッド{ftxt}")

        self._set_line(self.l_cpu, self.g1, self.cpu_hist, 100.0)
        self._set_line(self.l_mem, self.g1, self.mem_hist, 100.0)
        scale = self._net_scale()
        self._set_line(self.l_down, self.g2, self.down_hist, scale)
        self._set_line(self.l_up, self.g2, self.up_hist, scale)
        cv.itemconfigure(self.t_netmax, text=f"最大 {fmt_speed(scale)}")
        cv.itemconfigure(self.t_down, text=f"↓ {fmt_speed(self.down)}")
        cv.itemconfigure(self.t_up, text=f"↑ {fmt_speed(self.up)}")
        rt, st = self.net_total
        cv.itemconfigure(self.t_nettotal,
                         text=f"起動後の合計  ↓ {fmt_bytes(rt)}   ↑ {fmt_bytes(st)}")

        for (bar, x0, y0, x1, y1), v in zip(self.core_bars, self.cores):
            top = y1 - (y1 - y0) * v / 100.0
            cv.coords(bar, x0, top, x1, y1)
            cv.itemconfigure(bar, fill=self._load_color(v))

    def _set_line(self, item, box, data, vmax):
        x0, y0, x1, y1 = box
        n = len(data)
        pts = []
        for i, v in enumerate(data):
            x = x0 + (x1 - x0) * i / (n - 1)
            y = y1 - 2 - (y1 - y0 - 4) * min(1.0, v / vmax)
            pts += [x, y]
        self.cv.coords(item, *pts)

    @staticmethod
    def _load_color(v):
        # 0%:シアン → 60%:黄 → 100%:赤
        c0, c1, c2 = (56, 214, 255), (250, 204, 21), (239, 68, 68)
        t = v / 100.0
        if t < 0.6:
            return rgb_hex(mix(c0, c1, t / 0.6))
        return rgb_hex(mix(c1, c2, (t - 0.6) / 0.4))

    # ---------- アニメーション ----------
    def animate(self):
        t0 = time.perf_counter()
        cv, s = self.cv, self.s
        load = self.cpu / 100.0
        speed = (0.4 + 2.6 * load) * s
        pcol = self._load_color(self.cpu)
        lcol_rgb = (90, 150, 230)

        # パーティクル移動
        for p in self.parts:
            p["x"] += p["vx"] * speed
            p["y"] += p["vy"] * speed
            if p["x"] < 0 or p["x"] > self.W:
                p["vx"] *= -1
                p["x"] = min(max(p["x"], 0), self.W)
            if p["y"] < 0 or p["y"] > self.H:
                p["vy"] *= -1
                p["y"] = min(max(p["y"], 0), self.H)
            r = p["r"]
            cv.coords(p["id"], p["x"] - r, p["y"] - r, p["x"] + r, p["y"] + r)
            cv.itemconfigure(p["id"], fill=pcol)

        # 近いパーティクル同士を線で結ぶ
        cv.delete("link")
        d2max = self.link_dist ** 2
        parts = self.parts
        for i in range(len(parts)):
            a = parts[i]
            for j in range(i + 1, len(parts)):
                b = parts[j]
                dx = a["x"] - b["x"]
                dy = a["y"] - b["y"]
                d2 = dx * dx + dy * dy
                if d2 < d2max:
                    t = 1 - math.sqrt(d2) / self.link_dist
                    col = rgb_hex(mix(BG_BOTTOM, lcol_rgb, t))
                    cv.create_line(a["x"], a["y"], b["x"], b["y"], fill=col, tags="link")
        cv.tag_raise("part")
        cv.tag_raise("panel")

        # ゲージをなめらかに追従
        scale = self._net_scale()
        targets = {"cpu": self.cpu, "mem": self.mem,
                   "net": min(100.0, self.down / scale * 100.0 if scale else 0)}
        for k, g in self.gauges.items():
            self.disp[k] = lerp(self.disp[k], targets[k], 0.18)
            v = self.disp[k]
            cv.itemconfigure(g["arc"], start=225 - 270 * v / 100.0, extent=270 * v / 100.0)
            if k == "net":
                txt = fmt_speed(self.down).split()
                cv.itemconfigure(g["val"], text=txt[0])
                cv.itemconfigure(g["unit"], text="↓ " + txt[1])
            else:
                cv.itemconfigure(g["val"], text=f"{v:.0f}")

        # 時計
        now = datetime.datetime.now()
        cv.itemconfigure(self.t_time, text=now.strftime("%H:%M:%S"))
        cv.itemconfigure(self.t_date,
                         text=f"{now.year}年{now.month:02d}月{now.day:02d}日（{WEEK_JA[now.weekday()]}）")
        up = int(time.time() - self.boot)
        d, rem = divmod(up, 86400)
        h, rem = divmod(rem, 3600)
        m = rem // 60
        cv.itemconfigure(self.t_uptime, text=f"稼働 {d}日 {h:02d}:{m:02d}")

        elapsed = (time.perf_counter() - t0) * 1000
        self.root.after(max(1, int(1000 / FPS - elapsed)), self.animate)

    # ---------- 終了監視 ----------
    def check_stop(self):
        if os.path.exists(STOP_FLAG):
            try:
                os.remove(STOP_FLAG)
            except OSError:
                pass
            self.root.quit()
            return
        self.root.after(1000, self.check_stop)


def main():
    ap = argparse.ArgumentParser(description="動くデスクトップ")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--window", action="store_true", help="通常ウィンドウで表示")
    g.add_argument("--wallpaper", action="store_true", help="壁紙モード（Windowsのみ）")
    ap.add_argument("--size", help="ウィンドウサイズ 例: 1600x900（--window時）")
    ap.add_argument("--no-embed", action="store_true",
                    help="壁紙に埋め込まず、最背面の全画面ウィンドウとして表示")
    ap.add_argument("--method", default="auto",
                    choices=["auto", "progman", "progman-nolayer", "workerw"],
                    help="埋め込み方式（見えない場合に切り替え）")
    ap.add_argument("--label", help="画面中央に大きく表示する文字（方式テスト用）")
    ap.add_argument("--duration", type=float, help="指定秒数で自動終了（方式テスト用）")
    args = ap.parse_args()

    wallpaper = (args.wallpaper or (IS_WIN and not args.window)) and IS_WIN
    if os.path.exists(STOP_FLAG):
        os.remove(STOP_FLAG)

    host = None
    if IS_WIN:
        WallpaperHost.set_dpi_aware()
    root = tk.Tk()
    root.title("動くデスクトップ")
    root.configure(bg=rgb_hex(BG_TOP))

    if wallpaper:
        host = WallpaperHost(args.method)
        _, _, w, h = host.virtual_screen()
        root.overrideredirect(True)
        root.geometry(f"{w}x{h}+0+0")
    else:
        if args.size:
            w, h = (int(v) for v in args.size.lower().split("x"))
        else:
            w = int(root.winfo_screenwidth() * 0.8)
            h = int(root.winfo_screenheight() * 0.8)
        root.geometry(f"{w}x{h}")
        root.resizable(False, False)
        root.bind("<Escape>", lambda e: root.quit())

    app = MovingDesktop(root, w, h)
    if args.label:
        app.cv.create_text(w / 2, h / 2, text=args.label, fill="#ffffff",
                           font=app.F(90, "bold"), tags="panel")
    if args.duration:
        root.after(int(args.duration * 1000), root.quit)

    if host:
        def do_embed():
            if args.no_embed:
                host.fallback(root)
            else:
                host.embed(root)
        root.after(300, do_embed)

        def keep_bottom():
            # 埋め込みなしの場合、他のウィンドウより前に出ないよう最背面を維持
            if host.keep_bottom:
                try:
                    hwnd = host.u32.GetParent(root.winfo_id()) or root.winfo_id()
                    host.u32.SetWindowPos(hwnd, 1, 0, 0, 0, 0, 0x2 | 0x1 | 0x10)
                except Exception:
                    pass
            root.after(2000, keep_bottom)
        root.after(2500, keep_bottom)

    root.report_callback_exception = lambda *a: _excepthook(*a)
    log(f"start: mode={'wallpaper' if wallpaper else 'window'} python={sys.version.split()[0]} "
        f"os={platform.platform()}")

    try:
        root.mainloop()
    finally:
        if host:
            host.restore_wallpaper()
        try:
            root.destroy()
        except Exception:
            pass


if __name__ == "__main__":
    main()
