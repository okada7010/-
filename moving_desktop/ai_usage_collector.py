# -*- coding: utf-8 -*-
"""
AI使用量コレクター（動くデスクトップ Lively 版の付属ツール）

PC上で動かし、次の値を集計して書き出します。
  ・Lively 版：壁紙フォルダに usage.js（index.html が1分ごとに読み込む）
  ・Rainmeter 版：このファイルと同じフォルダに claude.txt（スキンが30秒ごとに読み込む）

  ・Claude 利用枠（claude.ai と Claude Code 共通）… 5時間枠・週間枠の使用率％とリセット時刻
      Claude Code のログイン情報（~/.claude/.credentials.json）を使って取得します。
      ※ Claude Code の /usage と同じ情報源ですが、公開仕様ではないため将来変わる可能性があります。
      ※ ログイン情報は Anthropic への問い合わせにだけ使い、ファイルには書き出しません。
  ・Claude Code の日別トークン量（直近7日）… ~/.claude/projects/**/*.jsonl から集計
  ・Gemini CLI の日別トークン量（直近7日）
      ~/.gemini/tmp/*/chats/*.json（会話記録）または Gemini CLI のテレメトリ出力ファイルから集計

起動:
  pythonw ai_usage_collector.py            … 常駐（1分ごとに更新）
  python  ai_usage_collector.py --once     … 1回だけ集計して内容を表示（動作確認用）
  python  ai_usage_collector.py --out "C:\\path\\to\\wallpaper"   … 書き出し先を指定
  python  ai_usage_collector.py --setup-gemini … Gemini CLI の記録（テレメトリのファイル出力）をオンにする
終了:
  同じフォルダに stop_collector.flag を作る（ai_usage_stop.bat）
"""
import argparse
import datetime as dt
import glob
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STOP_FLAG = os.path.join(BASE_DIR, "stop_collector.flag")
LOG_FILE = os.path.join(BASE_DIR, "ai_usage_collector.log")
RAINMETER_FILE = os.path.join(BASE_DIR, "claude.txt")   # Rainmeter スキンが読むファイル
WALLPAPER_TITLE = "動くデスクトップ"

INTERVAL_SEC = 60          # 集計間隔
LIMIT_INTERVAL_SEC = 600   # Claude 利用枠の問い合わせ間隔（控えめに10分）
DAYS = 7                   # 日別グラフの日数

HOME = os.path.expanduser("~")
CLAUDE_DIR = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(HOME, ".claude")
GEMINI_DIR = os.path.join(HOME, ".gemini")
# Lively 版・Rainmeter 版で共有する、利用枠の取得結果とロック
SHARED_DIR = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.join(HOME, ".cache"), "ClaudeMonitor")
CACHE_FILE = os.path.join(SHARED_DIR, "limits_cache.json")


def log(msg):
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(f"{dt.datetime.now():%Y-%m-%d %H:%M:%S} {msg}\n")
    except OSError:
        pass


def local_date(ts):
    """ISO 8601 / エポック → ローカル日付文字列 yyyy-mm-dd"""
    try:
        if isinstance(ts, (int, float)):
            d = dt.datetime.fromtimestamp(ts / 1000 if ts > 1e12 else ts)
        else:
            d = dt.datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
            if d.tzinfo:
                d = d.astimezone()
        return d.strftime("%Y-%m-%d")
    except Exception:
        return None


def day_keys():
    today = dt.date.today()
    return [(today - dt.timedelta(days=i)).isoformat() for i in range(DAYS - 1, -1, -1)]


def recent_files(pattern, days=DAYS + 1):
    limit = time.time() - days * 86400
    out = []
    for p in glob.glob(pattern, recursive=True):
        try:
            if os.path.getmtime(p) >= limit:
                out.append(p)
        except OSError:
            pass
    return out


# ------------------------------------------------------------
# Claude 利用枠（5時間・週間）
# ------------------------------------------------------------
def read_claude_token():
    path = os.path.join(CLAUDE_DIR, ".credentials.json")
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return (data.get("claudeAiOauth") or {}).get("accessToken")
    except (OSError, ValueError):
        return None


def fetch_claude_limits():
    token = read_claude_token()
    if not token:
        return {"error": "Claude Code のログイン情報が見つかりません（Claude Code にログインしてください）"}
    req = urllib.request.Request(
        "https://api.anthropic.com/api/oauth/usage",
        headers={
            "Authorization": f"Bearer {token}",
            "anthropic-beta": "oauth-2025-04-20",
            "User-Agent": "moving-desktop-usage/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            raw = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            return {"error": "ログインの有効期限切れ（Claude Code を一度起動すると更新されます）",
                    "code": e.code}
        if e.code == 429:
            try:
                retry = int(e.headers.get("Retry-After") or 0)
            except ValueError:
                retry = 0
            return {"error": "Anthropic 側の回数制限", "code": 429, "retry_after": retry}
        return {"error": f"取得失敗（HTTP {e.code}）", "code": e.code}
    except Exception as e:
        return {"error": f"取得失敗（{type(e).__name__}）"}

    names = {
        "five_hour": "5時間枠",
        "seven_day": "週間（全モデル）",
        "seven_day_opus": "週間（Opus）",
        "seven_day_sonnet": "週間（Sonnet）",
        "seven_day_oauth_apps": "週間（連携アプリ）",
        "extra_usage": "追加利用",
    }
    limits = []
    for key, val in raw.items():
        if isinstance(val, dict) and isinstance(val.get("utilization"), (int, float)):
            limits.append({
                "key": key,
                "label": names.get(key, key),
                "pct": float(val["utilization"]),
                "resets_at": val.get("resets_at"),
            })
    order = list(names)
    limits.sort(key=lambda x: order.index(x["key"]) if x["key"] in order else 99)
    return {"limits": limits}


# ------------------------------------------------------------
# Claude Code の日別トークン量
# ------------------------------------------------------------
def claude_code_daily():
    keys = day_keys()
    daily = {k: {"in": 0, "out": 0, "cache": 0} for k in keys}
    seen = set()
    files = recent_files(os.path.join(CLAUDE_DIR, "projects", "**", "*.jsonl"))
    for path in files:
        try:
            with open(path, encoding="utf-8", errors="ignore") as f:
                for line in f:
                    if '"usage"' not in line:
                        continue
                    try:
                        o = json.loads(line)
                    except ValueError:
                        continue
                    msg = o.get("message") or {}
                    u = msg.get("usage")
                    if not isinstance(u, dict):
                        continue
                    uid = (msg.get("id"), o.get("requestId"))
                    if uid != (None, None):
                        if uid in seen:
                            continue
                        seen.add(uid)
                    d = local_date(o.get("timestamp"))
                    if d not in daily:
                        continue
                    daily[d]["in"] += int(u.get("input_tokens") or 0)
                    daily[d]["out"] += int(u.get("output_tokens") or 0)
                    daily[d]["cache"] += int(u.get("cache_creation_input_tokens") or 0) \
                        + int(u.get("cache_read_input_tokens") or 0)
        except OSError:
            continue
    return [{"date": k, **daily[k]} for k in keys], len(files)


# ------------------------------------------------------------
# Gemini CLI の日別トークン量
# ------------------------------------------------------------
def _iter_json_objects(text):
    """連結された JSON（テレメトリ出力）を1つずつ取り出す"""
    dec = json.JSONDecoder()
    i, n = 0, len(text)
    while i < n:
        j = text.find("{", i)
        if j < 0:
            break
        try:
            obj, end = dec.raw_decode(text, j)
            yield obj
            i = end
        except ValueError:
            i = j + 1


def _walk(o):
    if isinstance(o, dict):
        yield o
        for v in o.values():
            yield from _walk(v)
    elif isinstance(o, list):
        for v in o:
            yield from _walk(v)


def gemini_daily():
    keys = day_keys()
    daily = {k: {"in": 0, "out": 0, "cache": 0} for k in keys}
    sources = []

    # 1) 会話記録（~/.gemini/tmp/<project>/chats/*.json）
    chat_files = recent_files(os.path.join(GEMINI_DIR, "tmp", "*", "chats", "*.json"))
    for path in chat_files:
        try:
            with open(path, encoding="utf-8", errors="ignore") as f:
                data = json.load(f)
        except (OSError, ValueError):
            continue
        for m in (data.get("messages") or []) if isinstance(data, dict) else []:
            tok = m.get("tokens") if isinstance(m, dict) else None
            if not isinstance(tok, dict):
                continue
            d = local_date(m.get("timestamp"))
            if d not in daily:
                continue
            daily[d]["in"] += int(tok.get("input") or 0)
            daily[d]["out"] += int(tok.get("output") or 0) + int(tok.get("thoughts") or 0)
            daily[d]["cache"] += int(tok.get("cached") or 0)
    if chat_files:
        sources.append(f"会話記録 {len(chat_files)}件")

    # 2) テレメトリ出力（settings.json の telemetry.outfile）
    if not any(v["in"] or v["out"] for v in daily.values()):
        outfiles = []
        try:
            with open(os.path.join(GEMINI_DIR, "settings.json"), encoding="utf-8") as f:
                tel = (json.load(f).get("telemetry") or {})
            if tel.get("outfile"):
                p = os.path.expanduser(tel["outfile"])
                outfiles.append(p if os.path.isabs(p) else os.path.join(HOME, p))
        except (OSError, ValueError, AttributeError):
            pass
        outfiles += glob.glob(os.path.join(GEMINI_DIR, "telemetry*.log"))
        for path in dict.fromkeys(outfiles):
            try:
                with open(path, encoding="utf-8", errors="ignore") as f:
                    text = f.read()
            except OSError:
                continue
            for obj in _iter_json_objects(text):
                for a in _walk(obj):
                    if a.get("event.name") != "gemini_cli.api_response":
                        continue
                    d = local_date(a.get("event.timestamp") or obj.get("timestamp")
                                   or obj.get("hrTime"))
                    if d not in daily:
                        continue
                    daily[d]["in"] += int(a.get("input_token_count") or 0)
                    daily[d]["out"] += int(a.get("output_token_count") or 0) \
                        + int(a.get("thoughts_token_count") or 0)
                    daily[d]["cache"] += int(a.get("cached_content_token_count") or 0)
            sources.append("テレメトリ")
    return [{"date": k, **daily[k]} for k in keys], sources


# ------------------------------------------------------------
# 書き出し先（Lively のライブラリから自動で探す）
# ------------------------------------------------------------
def find_wallpaper_dirs():
    local = os.environ.get("LOCALAPPDATA", "")
    patterns = [
        os.path.join(local, "Lively Wallpaper", "Library", "wallpapers", "*", "LivelyInfo.json"),
        os.path.join(local, "Packages", "*LivelyWallpaper*", "LocalCache", "Local",
                     "Lively Wallpaper", "Library", "wallpapers", "*", "LivelyInfo.json"),
    ]
    dirs = []
    for pat in patterns:
        for p in glob.glob(pat):
            try:
                with open(p, encoding="utf-8-sig") as f:
                    if json.load(f).get("Title") == WALLPAPER_TITLE:
                        dirs.append(os.path.dirname(p))
            except (OSError, ValueError):
                pass
    return dirs


def write_outputs(data, dirs):
    body = json.dumps(data, ensure_ascii=False)
    js = "window.AI_USAGE = " + body + ";\n"
    for d in dirs:
        try:
            tmp = os.path.join(d, "usage.js.tmp")
            with open(tmp, "w", encoding="utf-8") as f:
                f.write(js)
            os.replace(tmp, os.path.join(d, "usage.js"))
        except OSError as e:
            log(f"write failed {d}: {e!r}")


# ------------------------------------------------------------
# Rainmeter 用のテキスト（claude.txt）
# ------------------------------------------------------------
def fmt_tok(n):
    if n >= 1e9:
        return f"{n / 1e9:.1f}B"
    if n >= 1e6:
        return f"{n / 1e6:.1f}M"
    if n >= 1e3:
        return f"{n / 1e3:.0f}K"
    return str(int(n))


def fmt_reset(iso):
    if not iso:
        return ""
    try:
        t = dt.datetime.fromisoformat(str(iso).replace("Z", "+00:00")).astimezone()
    except ValueError:
        return ""
    sec = (t - dt.datetime.now().astimezone()).total_seconds()
    if sec <= 0:
        return "まもなくリセット"
    h, m = int(sec // 3600), int(sec % 3600 // 60)
    if h >= 24:
        return f"{t.month}/{t.day} {t:%H:%M} リセット"
    return f"あと{h}時間{m}分でリセット"


def write_rainmeter(data, path):
    """Rainmeter スキンが WebParser で読む key=value 形式のテキストを書き出す"""
    cl = data.get("claude", {})
    lim = {L["key"]: L for L in cl.get("limits", [])}
    five, week, extra = lim.get("five_hour"), lim.get("seven_day"), lim.get("extra_usage")
    daily = cl.get("daily", [])
    tot = [d["in"] + d["out"] for d in daily]
    mx = max(tot + [1])
    lines = {
        "error": cl.get("error", ""),
        "five": f"{five['pct']:.0f}" if five else "0",
        "five_reset": fmt_reset(five.get("resets_at")) if five else "",
        "week": f"{week['pct']:.0f}" if week else "0",
        "week_reset": fmt_reset(week.get("resets_at")) if week else "",
        "extra": f"{extra['pct']:.0f}" if extra else "0",
        "today": fmt_tok(tot[-1]) if tot else "0",
        "total7": fmt_tok(sum(tot)),
        "updated": dt.datetime.now().strftime("%m/%d %H:%M"),
    }
    for i in range(7):
        d = daily[i] if i < len(daily) else None
        lines[f"d{i + 1}"] = f"{(tot[i] / mx * 100):.0f}" if d else "0"
        lines[f"l{i + 1}"] = d["date"][5:].replace("-", "/") if d else ""
        lines[f"v{i + 1}"] = fmt_tok(tot[i]) if d and tot[i] else ""
    body = "".join(f"{k}={v}\n" for k, v in lines.items()) + "end=1\n"
    try:
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8", newline="\n") as f:
            f.write(body)
        os.replace(tmp, path)
    except OSError as e:
        log(f"write rainmeter failed: {e!r}")


def _load_cache():
    try:
        with open(CACHE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _save_cache(c):
    try:
        os.makedirs(SHARED_DIR, exist_ok=True)
        tmp = CACHE_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(c, f, ensure_ascii=False)
        os.replace(tmp, CACHE_FILE)
    except OSError as e:
        log(f"cache write failed: {e!r}")


def get_limits(force=False):
    """利用枠を返す。問い合わせは共有キャッシュで間引き、失敗時は時間をおいて再試行し、前回の値を使う"""
    c = _load_cache()
    now = time.time()
    if force or now >= c.get("next_try", 0):
        r = fetch_claude_limits()
        if "limits" in r:
            c.update(limits=r["limits"], fetched_at=now, fail=0, error="",
                     next_try=now + LIMIT_INTERVAL_SEC)
        else:
            fail = c.get("fail", 0) + 1
            if r.get("code") == 429:      # 回数制限：15分→30分→60分と間隔をあける
                wait = max(r.get("retry_after", 0), min(3600, 900 * 2 ** (fail - 1)))
            else:
                wait = min(3600, 300 * fail)
            c.update(fail=fail, error=r["error"], next_try=now + wait)
            log(f"limits error: {r['error']} (retry in {wait}s)")
        _save_cache(c)
    out = {"limits": c.get("limits", [])}
    if c.get("fail"):
        if c.get("fetched_at"):
            t = dt.datetime.fromtimestamp(c["fetched_at"]).strftime("%H:%M")
            out["error"] = f"{c['error']}：{t} 時点の値"
        else:
            out["error"] = c.get("error", "")
    return out


def acquire_lock():
    """同じフォルダの集計プログラムの二重起動を防ぐ（取れなければ None）"""
    # ロックはスキン／壁紙のフォルダの外（共有フォルダ）に置く。フォルダを開いたままにすると、
    # Rainmeter や Lively の更新時にフォルダを移動できなくなるため
    import hashlib
    os.makedirs(SHARED_DIR, exist_ok=True)
    key = hashlib.md5(BASE_DIR.lower().encode("utf-8")).hexdigest()[:12]
    path = os.path.join(SHARED_DIR, f"collector_{key}.lock")
    f = open(path, "a+")
    try:
        if os.name == "nt":
            import msvcrt
            f.seek(0)
            msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return f
    except OSError:
        f.close()
        return None


def collect(state, force=False):
    state["limits"] = get_limits(force)
    cc, n_cc = claude_code_daily()
    gm, gm_src = gemini_daily()
    return {
        "updated": dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "claude": {**state["limits"], "daily": cc, "files": n_cc},
        "gemini": {"daily": gm, "sources": gm_src},
    }


def setup_gemini():
    """Gemini CLI の settings.json に、トークン量を記録する設定を追加する（元のファイルはバックアップ）"""
    path = os.path.join(GEMINI_DIR, "settings.json")
    outfile = os.path.join(GEMINI_DIR, "telemetry.log").replace("\\", "/")
    data = {}
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8-sig") as f:
                text = f.read()
            data = json.loads(text) if text.strip() else {}
        except ValueError:
            print("settings.json の形式を読み取れませんでした（コメント入りなど）。")
            print("手動で次の内容を追加してください：")
            print(json.dumps({"telemetry": {"enabled": True, "target": "local",
                                            "outfile": outfile, "logPrompts": False}},
                             ensure_ascii=False, indent=2))
            return 1
        backup = path + "." + dt.datetime.now().strftime("%Y%m%d%H%M%S") + ".bak"
        with open(backup, "w", encoding="utf-8") as f:
            f.write(text)
        print("バックアップ:", backup)
    else:
        os.makedirs(GEMINI_DIR, exist_ok=True)
    tel = data.get("telemetry") if isinstance(data.get("telemetry"), dict) else {}
    tel.update({"enabled": True, "target": "local", "outfile": outfile, "logPrompts": False})
    data["telemetry"] = tel
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print("設定しました:", path)
    print(json.dumps({"telemetry": tel}, ensure_ascii=False, indent=2))
    print("\nこのあと Gemini CLI を使うと、トークン量が", outfile, "に記録されます。")
    print("（プロンプトの本文は記録しない設定です）")
    return 0


def main():
    # 作業フォルダを共有フォルダへ移す（スキンのフォルダを使用中にしないため）
    try:
        os.makedirs(SHARED_DIR, exist_ok=True)
        os.chdir(SHARED_DIR)
    except OSError:
        pass
    ap = argparse.ArgumentParser(description="AI使用量コレクター")
    ap.add_argument("--once", action="store_true", help="1回だけ集計して表示")
    ap.add_argument("--out", action="append", help="usage.js の書き出し先フォルダ（複数可）")
    ap.add_argument("--setup-gemini", action="store_true", help="Gemini CLI の記録をオンにする")
    args = ap.parse_args()

    if args.setup_gemini:
        sys.exit(setup_gemini())

    if os.path.exists(STOP_FLAG):
        os.remove(STOP_FLAG)
    state = {}

    if args.once:
        data = collect(state)
        dirs = args.out or find_wallpaper_dirs()
        print(json.dumps(data, ensure_ascii=False, indent=2))
        print("\n書き出し先:", dirs or "（見つかりません。Lively に壁紙を追加してから実行するか、--out で指定してください）")
        write_outputs(data, dirs + [BASE_DIR] if BASE_DIR not in dirs else dirs)
        write_rainmeter(data, RAINMETER_FILE)
        print("Rainmeter 用:", RAINMETER_FILE)
        return

    lock = acquire_lock()
    if lock is None:
        log("already running")   # すでに動いているので何もしない
        return
    log("start")
    while not os.path.exists(STOP_FLAG):
        try:
            dirs = args.out or find_wallpaper_dirs()
            data = collect(state)
            write_outputs(data, dirs + ([BASE_DIR] if BASE_DIR not in dirs else []))
            write_rainmeter(data, RAINMETER_FILE)
        except Exception as e:
            log(f"collect error: {e!r}")
        for _ in range(INTERVAL_SEC):
            if os.path.exists(STOP_FLAG):
                break
            time.sleep(1)
    os.remove(STOP_FLAG)
    log("stop")


if __name__ == "__main__":
    main()
