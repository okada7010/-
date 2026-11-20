# -*- coding: utf-8 -*-
"""歩くキャラクターのスキン（ClaudeMonitor\\Alice\\Alice.ini）を生成する（UTF-16 LE）。
画像は ClaudeMonitor\\@Resources\\alice\\（make_sprites.py で作成）。
使い方: python build_alice.py <出力 Alice.ini>
"""
import sys

SW, SH = 70, 95          # キャラ画像の大きさ
TOP = 24                 # キャラの上端（上にキラキラ・揺れの余白）
SPARKS = 6

ini = f"""[Rainmeter]
Update=100
AccurateText=1
ContextTitle=歩くはばを変える（Variables の Range）
ContextAction=[!EditSkin]

[Metadata]
Name=Alice
Author=APT
Information=アリス風の女の子（オリジナルのドット絵）が横に歩いて往復します。CPU 負荷が上がると速く歩き、ときどき立ち止まります。
Version=1.0

[Variables]
; 歩くはば（px）。広げるとスキンの横幅も広がります
Range=600
; 歩く速さ（CPU 0% のとき / CPU 100% で増える分。100ms あたりの px）
SpeedBase=3
SpeedCpu=12
; 立ち止まりやすさ（1000 分の いくつ）と、立ち止まる長さ（×0.1秒）
PauseChance=6
PauseLength=25

[MeasureCPU]
Measure=CPU
Processor=0

[mRand]
Measure=Calc
Formula=Random
LowBound=0
HighBound=1000
UpdateRandom=1

[mT]
Measure=Calc
Formula=(mT + 1) % 100000

[mPause]
Measure=Calc
Formula=(mPause > 0) ? (mPause - 1) : ((mRand < #PauseChance#) ? #PauseLength# : 0)

[mDir]
Measure=Calc
Formula=(mDir = 0) ? 1 : ((mX >= #Range#) ? -1 : ((mX <= 0) ? 1 : mDir))

[mSpeed]
Measure=Calc
Formula=#SpeedBase# + MeasureCPU / 100 * #SpeedCpu#

[mX]
Measure=Calc
Formula=Clamp(mX + ((mPause > 0) ? 0 : mDir * mSpeed), 0, #Range#)

[mFace]
Measure=Calc
Formula=(mDir < 0) ? 0 : 1

[mPose]
Measure=Calc
Formula=(mPause > 0) ? 0 : (1 + (Floor(mT / 2) % 2))

[mBob]
Measure=Calc
Formula=Round(Sin(mT * 0.2) * 4)

[MeterArea]
Meter=Image
X=0
Y=0
W=(#Range# + {SW} + 120)
H={TOP + SH + 16}
SolidColor=0,0,0,1
DynamicVariables=1
"""
# キラキラ：キャラの後ろ（進む向きの反対側）に並べ、順番にまたたかせる
for i in range(SPARKS):
    back = 14 + i * 17
    dy = (18, 46, 30, 64, 40, 78)[i]
    ini += f"""
[MeterSpark{i}]
Meter=Image
ImageName=#@#alice\\spark_{i}.png
X=(60 + [mX:0] + (([mFace:0] = 1) ? (-{back} - 9) : ({SW} + {back})))
Y=({TOP + dy} + [mBob:0] * {(-1) ** i})
ImageAlpha=(((([mT:0] + {i * 5}) % 30) < 15) ? (255 - (([mT:0] + {i * 5}) % 30) * 14) : 0)
DynamicVariables=1
"""
ini += f"""
[MeterGirl]
Meter=Image
ImageName=#@#alice\\girl_[mFace:0]_[mPose:0].png
X=(60 + [mX:0])
Y=({TOP} + [mBob:0])
DynamicVariables=1
"""

text = "\r\n".join(ini.split("\n"))
with open(sys.argv[1], "wb") as f:
    f.write(b"\xff\xfe" + text.encode("utf-16-le"))
print("written", sys.argv[1])
