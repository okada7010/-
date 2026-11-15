@echo off
chcp 65001 >nul
cd /d %~dp0
call :findpy || goto :nopy
%PY% -c "import psutil" 2>nul || %PY% -m pip install --user psutil
if errorlevel 1 goto :fail
rem コンソールを出さずにウィジェット型（パネルだけを最背面に表示）で起動
start "" %PYW% "%~dp0moving_desktop.py" --widget %*
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
