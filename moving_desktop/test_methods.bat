@echo off
chcp 65001 >nul
cd /d %~dp0
echo === 埋め込み方式テスト ===
echo 4つの方式を順番に10秒ずつ表示します。
echo 画面中央に「方式1」～「方式4」の大きな文字が見えたら、その番号を控えてください。
echo （このウィンドウは最小化して、デスクトップが見える状態にしてください）
echo.
pause
set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY set "PY=python"
type nul > "%~dp0moving_desktop.log"

echo 方式1 を表示中...
%PY% "%~dp0moving_desktop.py" --wallpaper --method progman --label "方式1" --duration 10
echo 方式2 を表示中...
%PY% "%~dp0moving_desktop.py" --wallpaper --method progman-nolayer --label "方式2" --duration 10
echo 方式3 を表示中...
%PY% "%~dp0moving_desktop.py" --wallpaper --method workerw --label "方式3" --duration 10
echo 方式4 を表示中...
%PY% "%~dp0moving_desktop.py" --wallpaper --no-embed --label "方式4" --duration 10

echo.
echo === テスト終了 ===
echo 見えた方式の番号と、下のログをClaudeに送ってください。
echo.
powershell -NoProfile -Command "Get-Content -Encoding UTF8 '%~dp0moving_desktop.log'"
pause
