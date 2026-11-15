# 動くデスクトップ（ライブ壁紙＋システムモニター） v2

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
| `start_simple.bat` | 壁紙に埋め込まず、最背面の全画面ウィンドウで起動（start.bat で表示されないとき用） |
| `debug.bat` | 診断用。Pythonの状態を確認し、エラーやログを画面に表示する |
| `autostart_on.bat` / `autostart_off.bat` | Windows起動時の自動起動を登録／解除 |

## カスタマイズ
`moving_desktop.py` 冒頭の「設定」を書き換えます。
- `FPS`：描画フレームレート（負荷を下げたい場合は 15～20）
- `PARTICLE_COUNT`：背景の粒の数
- `PANEL_SIDE`：パネルの位置（`"right"` / `"left"`）
- 色（`C_CPU` など）

## うまく表示されないとき（一瞬映って消える など）
1. `debug.bat` を実行し、表示された内容（特に赤字のエラーやログ）を確認します。
2. ログは同じフォルダの `moving_desktop.log` に残ります。`embed: mode=...` の行で、どの方式で埋め込んだかがわかります。
3. 壁紙の裏に隠れてしまう場合は、`start_simple.bat` を使ってください（アイコンは隠れますが、常に最背面に表示されます）。

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
call :findpy || goto :nopy
%PY% -c "import psutil" 2>nul || %PY% -m pip install --user psutil
if errorlevel 1 goto :fail
rem コンソールを出さずに壁紙モードで起動
start "" %PYW% "%~dp0moving_desktop.py" --wallpaper %*
exit /b

:findpy
where py >nul 2>nul && (set "PY=py -3" & set "PYW=pyw -3" & exit /b 0)
where python >nul 2>nul && python -c "import sys" >nul 2>nul && (set "PY=python" & set "PYW=pythonw" & exit /b 0)
exit /b 1

:nopy
echo Python が見つかりません。python.org からインストールしてください（Add to PATH にチェック）。
pause
exit /b 1

:fail
echo psutil のインストールに失敗しました。debug.bat を実行して内容を確認してください。
pause
exit /b 1
```

### start_window.bat
```bat
@echo off
chcp 65001 >nul
cd /d %~dp0
call :findpy || goto :nopy
%PY% -c "import psutil" 2>nul || %PY% -m pip install --user psutil
if errorlevel 1 goto :fail
rem コンソールを出さずに通常ウィンドウで起動（Esc で終了）
start "" %PYW% "%~dp0moving_desktop.py" --window %*
exit /b

:findpy
where py >nul 2>nul && (set "PY=py -3" & set "PYW=pyw -3" & exit /b 0)
where python >nul 2>nul && python -c "import sys" >nul 2>nul && (set "PY=python" & set "PYW=pythonw" & exit /b 0)
exit /b 1

:nopy
echo Python が見つかりません。python.org からインストールしてください（Add to PATH にチェック）。
pause
exit /b 1

:fail
echo psutil のインストールに失敗しました。debug.bat を実行して内容を確認してください。
pause
exit /b 1
```

### start_simple.bat
```bat
@echo off
chcp 65001 >nul
cd /d %~dp0
call :findpy || goto :nopy
%PY% -c "import psutil" 2>nul || %PY% -m pip install --user psutil
if errorlevel 1 goto :fail
rem コンソールを出さずに最背面の全画面ウィンドウで起動（埋め込みなし）
start "" %PYW% "%~dp0moving_desktop.py" --wallpaper --no-embed %*
exit /b

:findpy
where py >nul 2>nul && (set "PY=py -3" & set "PYW=pyw -3" & exit /b 0)
where python >nul 2>nul && python -c "import sys" >nul 2>nul && (set "PY=python" & set "PYW=pythonw" & exit /b 0)
exit /b 1

:nopy
echo Python が見つかりません。python.org からインストールしてください（Add to PATH にチェック）。
pause
exit /b 1

:fail
echo psutil のインストールに失敗しました。debug.bat を実行して内容を確認してください。
pause
exit /b 1
```

### stop.bat
```bat
@echo off
rem 停止フラグを作成 → 1秒以内に終了して元の壁紙に戻ります
type nul > "%~dp0stop.flag"
```

### debug.bat
```bat
@echo off
chcp 65001 >nul
cd /d %~dp0
echo === 動くデスクトップ 診断 ===
set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY where python >nul 2>nul && set "PY=python"
if not defined PY (echo Python が見つかりません & pause & exit /b 1)
echo 使用するPython: %PY%
%PY% --version
%PY% -c "import psutil; print('psutil', psutil.__version__)"
%PY% -c "import tkinter; print('tkinter OK')"
echo.
echo --- 壁紙モードで起動します（エラーがあればここに表示されます。終了は stop.bat） ---
%PY% "%~dp0moving_desktop.py" --wallpaper
echo.
echo --- ログ（moving_desktop.log の最後の部分） ---
powershell -NoProfile -Command "Get-Content -Tail 30 -Encoding UTF8 '%~dp0moving_desktop.log'"
pause
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
