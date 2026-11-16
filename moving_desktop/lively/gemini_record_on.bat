@echo off
chcp 65001 >nul
cd /d %~dp0
echo === Gemini CLI の使用量を記録する設定をオンにします ===
echo （%USERPROFILE%\.gemini\settings.json に追記。元のファイルはバックアップします）
echo.
set "PY=python"
where py >nul 2>nul && set "PY=py -3"
%PY% "%~dp0ai_usage_collector.py" --setup-gemini
echo.
pause
