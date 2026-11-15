@echo off
chcp 65001 >nul
cd /d %~dp0
rem psutil が無ければインストール
python -c "import psutil" 2>nul || python -m pip install --user psutil
rem コンソールを出さずに壁紙モードで起動
start "" pythonw "%~dp0moving_desktop.py" --wallpaper
