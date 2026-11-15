# 動くデスクトップ（ライブ壁紙＋システムモニター）

Windowsのデスクトップ（アイコンの裏側）で動く壁紙です。CPU、メモリ、ネット速度をリアルタイムで表示します。

![screenshot](screenshot.png)

## 表示する内容
| 項目 | 内容 |
|---|---|
| 背景 | パーティクルのアニメーション。CPU負荷が上がると速くなり、色はシアン→黄→赤に変わる |
| 時計 | 時刻・日付（yyyy年MM月dd日）・PCの稼働時間 |
| ゲージ | CPU% ／ メモリ% ／ ネット受信速度 |
| グラフ | CPU・メモリの直近60秒、ネットワーク受信・送信の直近60秒（目盛りは自動調整） |
| 数値 | 受信速度・送信速度（bps表記）、起動後の合計通信量、メモリ使用量、スレッド数・クロック |
| コア別 | 論理コアごとの使用率バー |

## 必要なもの
- Python 3.8 以降（python.org版を推奨。インストール時に「Add to PATH」にチェックを入れる）
- psutil（start.bat が自動でインストールします）

## 使い方
| ファイル | 動作 |
|---|---|
| `start.bat` | 壁紙モードで起動（アイコンの裏で動きます） |
| `stop.bat` | 終了（1秒以内に止まり、元の壁紙に戻ります） |
| `start_window.bat` | 通常ウィンドウで起動（試し見用。Escで終了） |
| `autostart_on.bat` / `autostart_off.bat` | Windows起動時の自動起動を登録／解除 |

## カスタマイズ
`moving_desktop.py` 冒頭の「設定」を書き換えます。
- `FPS`：描画フレームレート（負荷を下げたい場合は 15～20）
- `PARTICLE_COUNT`：背景の粒の数
- `PANEL_SIDE`：パネルの位置（`"right"` / `"left"`）
- 色（`C_CPU` など）

## 注意
- 壁紙モードはプライマリモニターに表示します。
- Windows 11 24H2以降で、アイコンの裏に埋め込めない場合は、最背面の全画面ウィンドウとして表示します。この場合も `stop.bat` で終了できます。
- CPU負荷の目安は1コアの1割程度です（FPS 30、粒70個、フルHDの場合。テスト環境での実測値）。ノートPCのバッテリー駆動時はFPSを下げることをお勧めします。

## 付録：batファイルの中身（手元で作成する場合）
メモ帳に貼り付け、ファイル名を指定して保存してください（文字コード：UTF-8）。

### start.bat
```bat
@echo off
chcp 65001 >nul
cd /d %~dp0
rem psutil が無ければインストール
python -c "import psutil" 2>nul || python -m pip install --user psutil
rem コンソールを出さずに壁紙モードで起動
start "" pythonw "%~dp0moving_desktop.py" --wallpaper
```

### start_window.bat
```bat
@echo off
chcp 65001 >nul
cd /d %~dp0
python -c "import psutil" 2>nul || python -m pip install --user psutil
rem 通常ウィンドウで起動（Esc で終了）
start "" pythonw "%~dp0moving_desktop.py" --window
```

### stop.bat
```bat
@echo off
rem 停止フラグを作成 → 1秒以内に終了して元の壁紙に戻ります
type nul > "%~dp0stop.flag"
```

### autostart_on.bat
```bat
@echo off
chcp 65001 >nul
rem Windows起動時に自動で動くデスクトップを開始（スタートアップにショートカットを作成）
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\MovingDesktop.lnk');$s.TargetPath='%~dp0start.bat';$s.WorkingDirectory='%~dp0';$s.WindowStyle=7;$s.Save()"
echo スタートアップに登録しました。
pause
```

### autostart_off.bat
```bat
@echo off
chcp 65001 >nul
powershell -NoProfile -Command "Remove-Item -ErrorAction SilentlyContinue ([Environment]::GetFolderPath('Startup')+'\MovingDesktop.lnk')"
echo スタートアップから解除しました。
pause
```
