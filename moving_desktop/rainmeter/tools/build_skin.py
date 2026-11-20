# -*- coding: utf-8 -*-
"""Rainmeter スキン（ClaudeMonitor.ini）を生成する。
Rainmeter は日本語を含む ini を UTF-16 LE（BOM 付き）で読むため、このスクリプトで書き出す。
使い方: python build_skin.py <出力先 ClaudeMonitor.ini>
"""
import sys

W = 460
COL = {
    "Bg": "6,6,14,225", "Edge": "52,52,76,255", "Text": "242,242,255,255", "Sub": "139,139,168,255",
    "Track": "27,27,42,255", "Cpu": "126,232,255,255", "Mem": "255,126,182,255",
    "Down": "157,255,126,255", "Up": "255,216,77,255", "Gpu": "201,167,255,255", "Claude": "224,138,95,255",
    "Yellow": "255,216,77,255", "Red": "239,68,68,255",
}

out = []
w = out.append

w("""[Rainmeter]
Update=1000
AccurateText=1
DynamicWindowSize=1
ContextTitle=集計プログラムを開始（ai_usage_start.bat）
ContextAction=["#@#ai_usage_start.bat"]
ContextTitle2=集計プログラムを停止（ai_usage_stop.bat）
ContextAction2=["#@#ai_usage_stop.bat"]
ContextTitle3=取得テスト（ai_usage_check.bat）
ContextAction3=["#@#ai_usage_check.bat"]
ContextTitle4=キャラ（アリス）の表示／非表示
ContextAction4=[!ToggleConfig "ClaudeMonitor\\Alice" "Alice.ini"]

[Metadata]
Name=Claude Monitor
Author=APT
Information=時計・CPU・メモリ・GPU・ネットと、Claude の利用枠（5時間・週間）・Claude Code の日別トークンを表示します。Claude の値は @Resources の ai_usage_collector.py が書き出す claude.txt から読みます。
Version=1.0
License=社内利用

[Variables]
@Include=#@#state.inc
Font=Yu Gothic UI""")
for k, v in COL.items():
    w(f"{k}={v}")
w("""
; ============ 初回だけキャラのスキンも表示する ============
[mFirstRun]
Measure=Calc
Formula=#AliceShown#
IfCondition=(mFirstRun = 0)
IfTrueAction=[!ActivateConfig "ClaudeMonitor\\Alice" "Alice.ini"][!WriteKeyValue Variables AliceShown 1 "#@#state.inc"]

; ============ 計測 ============
[MeasureCPU]
Measure=CPU
Processor=0

[MeasureRAM]
Measure=PhysicalMemory

[MeasureRAMTotal]
Measure=PhysicalMemory
Total=1

[MeasureRAMPct]
Measure=Calc
Formula=MeasureRAMTotal > 0 ? (MeasureRAM / MeasureRAMTotal * 100) : 0
MinValue=0
MaxValue=100

[MeasureNetIn]
Measure=NetIn
Interface=Best

[MeasureNetOut]
Measure=NetOut
Interface=Best

; GPU（Windows のパフォーマンスカウンター。全 GPU の 3D エンジン使用率）
[MeasureGPU]
Measure=UsageMonitor
Alias=GPU
Index=0
MinValue=0
MaxValue=100

[MeasureVRAM]
Measure=UsageMonitor
Alias=VRAM
Index=0

[MeasureOne]
Measure=Calc
Formula=1
MinValue=0
MaxValue=1

[MeasureTime]
Measure=Time
Format=%H:%M:%S

[MeasureDate]
Measure=Time
Format=%Y年%m月%d日（%a）
FormatLocale=ja-JP

; ============ Claude（ai_usage_collector.py が書き出す claude.txt） ============
[MeasureClaude]
Measure=WebParser
URL=file://#@#claude.txt
CodePage=65001
UpdateRate=30
""")
keys = ["error", "five", "five_reset", "week", "week_reset", "extra", "today", "total7", "updated"]
for i in range(1, 8):
    keys += [f"d{i}", f"l{i}", f"v{i}"]
regexp = "(?m)" + r"\n".join(f"{k}=(.*)" for k in keys)
w(f'RegExp="{regexp}"')
w("")
num = {"five", "week", "extra"} | {f"d{i}" for i in range(1, 8)}
for idx, k in enumerate(keys, 1):
    w(f"[m_{k}]\nMeasure=WebParser\nURL=[MeasureClaude]\nStringIndex={idx}")
    if k in num:
        w("MinValue=0\nMaxValue=100")
    if k in ("five", "week", "extra"):
        meter = {"five": "MeterFive", "week": "MeterWeek", "extra": "MeterExtraBar"}[k]
        opt = "BarColor" if k == "extra" else "LineColor"
        w(f"IfCondition=(m_{k} >= 90)\nIfTrueAction=[!SetOption {meter} {opt} \"#Red#\"][!UpdateMeter {meter}]")
        w(f"IfCondition2=(m_{k} >= 70) && (m_{k} < 90)\nIfTrueAction2=[!SetOption {meter} {opt} \"#Yellow#\"][!UpdateMeter {meter}]")
        w(f"IfCondition3=(m_{k} < 70)\nIfTrueAction3=[!SetOption {meter} {opt} \"#Claude#\"][!UpdateMeter {meter}]")
    if k == "updated":
        w("IfMatch=^$\nIfMatchAction=[!ShowMeter MeterNotice]\nIfNotMatchAction=[!HideMeter MeterNotice]")
    w("")

w("""; ============ 見た目の共通設定 ============
[sText]
FontFace=#Font#
FontColor=#Text#
FontSize=10
AntiAlias=1
SolidColor=0,0,0,1

[sSub]
FontFace=#Font#
FontColor=#Sub#
FontSize=9
AntiAlias=1

[sRing]
Solid=1
AntiAlias=1
StartAngle=2.356
RotationAngle=4.712
""")

H = 0  # 最後に背景の高さを決める
body = []
b = body.append

# ---- 時計
b("""[MeterClock]
Meter=String
MeterStyle=sText
MeasureName=MeasureTime
X=22
Y=14
FontSize=34
FontWeight=700

[MeterDate]
Meter=String
MeterStyle=sSub
MeasureName=MeasureDate
X=24
Y=66
FontSize=11
""")

# ---- PC：CPU・メモリのリング、ネット
def ring(name, measure, cx, cy, r, width, color, track=True):
    s = ""
    if track:
        s += (f"[{name}Track]\nMeter=Roundline\nMeterStyle=sRing\nMeasureName=MeasureOne\n"
              f"X={cx - r}\nY={cy - r}\nW={2 * r}\nH={2 * r}\nLineStart={r - width}\nLineLength={r}\n"
              f"LineColor=#Track#\n\n")
    s += (f"[{name}]\nMeter=Roundline\nMeterStyle=sRing\nMeasureName={measure}\n"
          f"X={cx - r}\nY={cy - r}\nW={2 * r}\nH={2 * r}\nLineStart={r - width}\nLineLength={r}\n"
          f"LineColor={color}\n\n")
    return s

y = 100
b("[MeterPCTitle]\nMeter=String\nMeterStyle=sText\nText=PC\nX=22\nY=%d\nFontSize=12\nFontWeight=700\n" % y)
cy = y + 72
# CPU・メモリ・GPU の円ゲージを横に3つ
for name, measure, cx, label, color in (("MeterCPU", "MeasureCPU", 80, "CPU", "#Cpu#"),
                                         ("MeterRAM", "MeasureRAMPct", W // 2, "メモリ", "#Mem#"),
                                         ("MeterGPU", "MeasureGPU", W - 80, "GPU", "#Gpu#")):
    b(ring(name, measure, cx, cy, 44, 9, color))
    b(f"[{name}Val]\nMeter=String\nMeterStyle=sText\nMeasureName={measure}\nText=%1%\nNumOfDecimals=0\nX={cx}\nY={cy - 12}\nStringAlign=Center\nFontSize=16\nFontWeight=700\n")
    b(f"[{name}Label]\nMeter=String\nMeterStyle=sText\nText={label}\nX={cx}\nY={cy + 30}\nStringAlign=Center\nFontColor={color}\nFontWeight=700\n")
b(f"[MeterRAMDetail]\nMeter=String\nMeterStyle=sSub\nMeasureName=MeasureRAM\nMeasureName2=MeasureRAMTotal\nText=%1B / %2B\nAutoScale=1\nNumOfDecimals=1\nX={W // 2}\nY={cy + 50}\nStringAlign=Center\n")
b(f"[MeterGPUDetail]\nMeter=String\nMeterStyle=sSub\nMeasureName=MeasureVRAM\nText=VRAM %1B\nAutoScale=1\nNumOfDecimals=1\nX={W - 80}\nY={cy + 50}\nStringAlign=Center\n")
# ネット（ゲージの下に1行）
ny = cy + 74
b(f"[MeterNetTitle]\nMeter=String\nMeterStyle=sText\nText=ネット\nX=22\nY={ny + 2}\nFontColor=#Down#\nFontWeight=700\n")
b(f"[MeterNetIn]\nMeter=String\nMeterStyle=sText\nMeasureName=MeasureNetIn\nText=↓ %1B/s\nAutoScale=1\nNumOfDecimals=1\nX=90\nY={ny}\nFontSize=13\nFontColor=#Down#\n")
b(f"[MeterNetOut]\nMeter=String\nMeterStyle=sText\nMeasureName=MeasureNetOut\nText=↑ %1B/s\nAutoScale=1\nNumOfDecimals=1\nX=270\nY={ny}\nFontSize=13\nFontColor=#Up#\n")

# ---- CPU / メモリ / GPU のグラフ
gy = ny + 36
b(f"[MeterGraphTitle]\nMeter=String\nMeterStyle=sSub\nText=CPU・メモリ・GPU（直近）\nX=22\nY={gy}\n")
b(f"[MeterGraph]\nMeter=Line\nMeasureName=MeasureCPU\nMeasureName2=MeasureRAMPct\nMeasureName3=MeasureGPU\nX=22\nY={gy + 20}\nW={W - 44}\nH=60\n"
  f"LineCount=3\nLineColor=#Cpu#\nLineColor2=#Mem#\nLineColor3=#Gpu#\nSolidColor=5,5,10,255\nAntiAlias=1\nAutoScale=0\n")

# ---- Claude
y = gy + 100
b(f"[MeterSep]\nMeter=Shape\nShape=Line 22,{y},{W - 22},{y} | StrokeWidth 1 | Stroke Color #Edge#\n")
y += 14
b(f"[MeterClaudeTitle]\nMeter=String\nMeterStyle=sText\nText=Claude 使用状況\nX=22\nY={y}\nFontSize=15\nFontWeight=700\nFontColor=#Claude#\n")
b(f"[MeterError]\nMeter=String\nMeterStyle=sText\nMeasureName=m_error\nX={W - 22}\nY={y + 4}\nStringAlign=Right\nFontSize=9\nFontColor=#Red#\nW=260\nClipString=1\n")
b(f"[MeterNotice]\nMeter=String\nMeterStyle=sSub\nText=右クリック →「集計プログラムを開始」で表示されます\nX=22\nY={y + 32}\nHidden=1\n")
cy = y + 40 + 70
for name, key, cx, label in (("MeterFive", "five", 125, "5時間枠"), ("MeterWeek", "week", W - 125, "週間")):
    b(ring(name, f"m_{key}", cx, cy, 70, 13, "#Claude#"))
    b(f"[{name}Val]\nMeter=String\nMeterStyle=sText\nMeasureName=m_{key}\nText=%1\nX={cx - 6}\nY={cy - 26}\nStringAlign=Center\nFontSize=30\nFontWeight=700\n")
    b(f"[{name}Pct]\nMeter=String\nMeterStyle=sSub\nText=%\nX={cx + 30}\nY={cy - 8}\nFontSize=12\n")
    b(f"[{name}Label]\nMeter=String\nMeterStyle=sText\nText={label}\nX={cx}\nY={cy + 26}\nStringAlign=Center\nFontColor=#Claude#\nFontWeight=700\nFontSize=11\n")
    b(f"[{name}Reset]\nMeter=String\nMeterStyle=sSub\nMeasureName=m_{key}_reset\nX={cx}\nY={cy + 76}\nStringAlign=Center\n")
y = cy + 104
b(f"[MeterExtraLabel]\nMeter=String\nMeterStyle=sText\nText=追加利用\nX=22\nY={y}\nFontSize=11\n")
b(f"[MeterExtraVal]\nMeter=String\nMeterStyle=sText\nMeasureName=m_extra\nText=%1%\nX={W - 22}\nY={y}\nStringAlign=Right\nFontSize=11\nFontWeight=700\nFontColor=#Claude#\n")
b(f"[MeterExtraTrack]\nMeter=Shape\nShape=Rectangle 22,{y + 24},{W - 44},8,4 | Fill Color #Track# | StrokeWidth 0\n")
b(f"[MeterExtraBar]\nMeter=Bar\nMeasureName=m_extra\nX=22\nY={y + 24}\nW={W - 44}\nH=8\nBarOrientation=Horizontal\nBarColor=#Claude#\n")

# ---- 日別トークン
y += 48
b(f"[MeterDailyTitle]\nMeter=String\nMeterStyle=sText\nText=Claude Code 日別トークン（このPC・7日）\nX=22\nY={y}\nFontSize=10\nFontWeight=700\n")
y += 26
ch = 110
b(f"[MeterDailyBg]\nMeter=Shape\nShape=Rectangle 22,{y},{W - 44},{ch} | Fill Color 5,5,10,255 | StrokeWidth 0\n")
gw = (W - 44) / 7
for i in range(1, 8):
    cx = int(22 + gw * (i - 0.5))
    bw = int(gw * 0.56)
    color = "#Claude#" if i == 7 else "224,138,95,160"
    b(f"[MeterBar{i}]\nMeter=Bar\nMeasureName=m_d{i}\nX={cx - bw // 2}\nY={y + 18}\nW={bw}\nH={ch - 18}\nBarOrientation=Vertical\nBarColor={color}\n")
    b(f"[MeterBarVal{i}]\nMeter=String\nMeterStyle=sSub\nMeasureName=m_v{i}\nX={cx}\nY={y + 2}\nStringAlign=Center\nFontSize=8\n")
    b(f"[MeterBarLabel{i}]\nMeter=String\nMeterStyle=sSub\nMeasureName=m_l{i}\nX={cx}\nY={y + ch + 4}\nStringAlign=Center\nFontSize=9\n"
      + ("FontColor=#Text#\nFontWeight=700\n" if i == 7 else ""))
y += ch + 28
b(f"[MeterTodayLabel]\nMeter=String\nMeterStyle=sSub\nText=今日\nX=22\nY={y + 8}\nFontSize=10\n")
b(f"[MeterToday]\nMeter=String\nMeterStyle=sText\nMeasureName=m_today\nX=60\nY={y}\nFontSize=18\nFontWeight=700\nFontColor=#Claude#\n")
b(f"[MeterTotalLabel]\nMeter=String\nMeterStyle=sSub\nText=7日合計\nX={W // 2}\nY={y + 8}\nFontSize=10\n")
b(f"[MeterTotal]\nMeter=String\nMeterStyle=sText\nMeasureName=m_total7\nX={W // 2 + 58}\nY={y}\nFontSize=18\nFontWeight=700\n")
y += 38
b(f"[MeterUpdated]\nMeter=String\nMeterStyle=sSub\nMeasureName=m_updated\nText=更新 %1\nX={W - 22}\nY={y}\nStringAlign=Right\nFontSize=8\n")
H = y + 26

w(f"""; ============ 表示 ============
[MeterBackground]
Meter=Shape
Shape=Rectangle 0,0,{W},{H},16 | Fill Color #Bg# | StrokeWidth 1.5 | Stroke Color #Edge#
""")
out.extend(body)

text = "\r\n".join("\n".join(out).split("\n")) + "\r\n"
with open(sys.argv[1], "wb") as f:
    f.write(b"\xff\xfe" + text.encode("utf-16-le"))
print("written", sys.argv[1], "height", H)
