@echo off
chcp 65001 >nul
cd /d %~dp0
echo === AI使用量の取得テスト（1回だけ集計して表示します） ===
set "PY=python"
where py >nul 2>nul && set "PY=py -3"
%PY% "%~dp0ai_usage_collector.py" --once
pause
