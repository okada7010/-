@echo off
chcp 65001 >nul
cd /d %~dp0
rem AI使用量コレクターを常駐起動（画面は出ません。終了は ai_usage_stop.bat）
where pyw >nul 2>nul && (start "" pyw -3 "%~dp0ai_usage_collector.py" & exit /b)
where pythonw >nul 2>nul && (start "" pythonw "%~dp0ai_usage_collector.py" & exit /b)
echo Python が見つかりません。python.org からインストールしてください。
pause
