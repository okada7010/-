@echo off
chcp 65001 >nul
rem 作業フォルダはユーザーフォルダにする（スキンのフォルダを使用中にしないため）
cd /d %USERPROFILE%
rem AI使用量コレクターを常駐起動（画面は出ません。終了は ai_usage_stop.bat）
where pyw >nul 2>nul && (start "" pyw -3 "%~dp0ai_usage_collector.py" & exit /b)
where pythonw >nul 2>nul && (start "" pythonw "%~dp0ai_usage_collector.py" & exit /b)
echo Python が見つかりません。python.org からインストールしてください。
pause
