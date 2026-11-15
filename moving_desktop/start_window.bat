@echo off
chcp 65001 >nul
cd /d %~dp0
python -c "import psutil" 2>nul || python -m pip install --user psutil
rem 通常ウィンドウで起動（Esc で終了）
start "" pythonw "%~dp0moving_desktop.py" --window
