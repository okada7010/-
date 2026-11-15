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
